//! Owner generation leases survive daemon restarts without counting sleep as a lost GUI.
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{io::{Read, Write}, path::Path, time::{SystemTime, UNIX_EPOCH}};
use super::{desired::ActiveOwnerState, paths::service_paths};

const LEASE_NS: u64 = 30_000_000_000;
const WAKE_GRACE_NS: u64 = 10_000_000_000;
const SLEEP_DETECTION_NS: u64 = 2_000_000_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Clock { pub awake: u64, pub continuous: u64, pub boot: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Lease {
    owner_key: String,
    generation: u64,
    deadline: u64,
    observed: Clock,
}

impl Lease {
    fn new(owner: &ActiveOwnerState, now: Clock) -> Self {
        Self { owner_key: owner.owner_key.clone(), generation: owner.generation,
            deadline: now.awake.saturating_add(LEASE_NS), observed: now }
    }
    fn matches(&self, owner: &ActiveOwnerState) -> bool {
        self.owner_key == owner.owner_key && self.generation == owner.generation
    }
    /// Returns whether wake grace was newly granted, so it can be persisted before accepting IPC.
    fn observe(&mut self, now: &Clock) -> bool {
        if now.boot != self.observed.boot || now.awake < self.observed.awake { return false; }
        let slept = now.continuous.saturating_sub(self.observed.continuous)
            .saturating_sub(now.awake.saturating_sub(self.observed.awake)) > SLEEP_DETECTION_NS;
        let grace = slept && now.awake < self.deadline;
        if grace { self.deadline = now.awake.saturating_add(WAKE_GRACE_NS); }
        self.observed = now.clone();
        grace
    }
    fn live(&self, now: &Clock) -> bool {
        now.boot == self.observed.boot && now.awake >= self.observed.awake && now.awake < self.deadline
    }
}

#[cfg(target_os="macos")]
pub(crate) fn clock() -> Result<Clock> {
    #[repr(C)] struct Timebase { numer:u32, denom:u32 }
    unsafe extern "C" {
        fn mach_absolute_time() -> u64;
        fn mach_continuous_time() -> u64;
        fn mach_timebase_info(info:*mut Timebase) -> i32;
    }
    static BOOT: once_cell::sync::OnceCell<String> = once_cell::sync::OnceCell::new();
    let boot = BOOT.get_or_try_init(|| -> Result<String> {
        let output=std::process::Command::new("/usr/sbin/sysctl").args(["-n","kern.bootsessionuuid"]).output()?;
        ensure!(output.status.success(), "cannot read boot identity");
        let value=String::from_utf8(output.stdout)?.trim().to_owned();
        ensure!(!value.is_empty() && value.len()<128,"invalid boot identity"); Ok(value)
    })?;
    let mut base=Timebase{numer:0,denom:0};
    ensure!(unsafe { mach_timebase_info(&mut base) }==0 && base.denom>0,"clock timebase unavailable");
    let ns=|t:u64| ((t as u128 * base.numer as u128)/base.denom as u128).min(u64::MAX as u128) as u64;
    Ok(Clock { awake:ns(unsafe {mach_absolute_time()}), continuous:ns(unsafe {mach_continuous_time()}), boot:boot.clone() })
}

#[cfg(not(target_os="macos"))]
pub(crate) fn clock() -> Result<Clock> {
    anyhow::bail!("SI owner leases currently require macOS clocks")
}

fn lease_path() -> Result<std::path::PathBuf> { Ok(service_paths()?.persistent_state_dir().join("owner-lease.json")) }
pub(crate) fn write_private<T:Serialize>(path:&Path, value:&T) -> Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let parent=path.parent().context("journal has no parent")?;
    super::platform_security::ensure_private_service_directory(parent)?;
    super::platform_security::secure_private_service_file_if_exists(path)?;
    let stamp=SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let tmp=parent.join(format!(".journal-{}-{stamp}",std::process::id()));
    let result=(|| -> Result<()> {
        let mut file=std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600)
            .custom_flags(platform_lib::O_NOFOLLOW).open(&tmp)?;
        file.write_all(&serde_json::to_vec(value)?)?;file.sync_all()?;drop(file);
        std::fs::rename(&tmp,path)?; std::fs::File::open(parent)?.sync_all()?; Ok(())
    })();
    if result.is_err() { let _=std::fs::remove_file(&tmp); }
    result
}

pub(crate) fn read_private<T:serde::de::DeserializeOwned>(path:&Path) -> Result<Option<T>> {
    use std::os::unix::fs::OpenOptionsExt;
    super::platform_security::secure_private_service_file_if_exists(path)?;
    let mut file=match std::fs::OpenOptions::new().read(true).custom_flags(platform_lib::O_NOFOLLOW).open(path) {
        Err(e) if e.kind()==std::io::ErrorKind::NotFound => return Ok(None), result=>result?,
    };
    ensure!(file.metadata()?.len()<=8*1024*1024,"journal too large");
    let mut bytes=Vec::new();file.read_to_end(&mut bytes)?;Ok(Some(serde_json::from_slice(&bytes)?))
}

pub(crate) fn issue(owner:&ActiveOwnerState) -> Result<()> { write_private(&lease_path()?,&Lease::new(owner,clock()?)) }
pub(crate) fn renew(owner:&ActiveOwnerState) -> Result<()> {
    let now=clock()?;
    let mut lease:Lease=read_private(&lease_path()?)?.context("owner has no lease")?;
    ensure!(lease.matches(owner),"stale owner generation");
    lease.observe(&now);
    ensure!(lease.live(&now),"owner lease expired");
    write_private(&lease_path()?,&Lease::new(owner,now))
}
pub(crate) fn is_live(owner:&ActiveOwnerState) -> Result<bool> {
    let Some(mut lease):Option<Lease>=read_private(&lease_path()?)? else {return Ok(false)};
    if !lease.matches(owner) {return Ok(false)}
    let now=clock()?;
    if lease.observe(&now) {write_private(&lease_path()?,&lease)?;}
    Ok(lease.live(&now))
}
pub(crate) fn clear() -> Result<()> {
    match std::fs::remove_file(lease_path()?) {
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(()),result=>Ok(result?),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn now(awake:u64,continuous:u64)->Clock {Clock {awake:awake*1_000_000_000,continuous:continuous*1_000_000_000,boot:"A".into()}}
    fn owner()->ActiveOwnerState {ActiveOwnerState {owner_key:"501".into(),identity:crate::OwnerIdentity::Unix{uid:501,gid:20},app_data_root:"/fixture".into(),generation:7,session_token_hash:String::new()}}
    #[test]
    fn expiry_survives_serialization_and_rejects_stale_generation() {
        let lease=Lease::new(&owner(),now(0,0));
        let restored:Lease=serde_json::from_slice(&serde_json::to_vec(&lease).unwrap()).unwrap();
        assert!(restored.live(&now(29,29)));assert!(!restored.live(&now(30,30)));
        let mut stale=owner();stale.generation=6;assert!(!restored.matches(&stale));
        let mut reboot=now(1,1);reboot.boot="B".into();assert!(!restored.live(&reboot));
    }
    #[test]
    fn wake_grace_is_not_regranted_by_restarting_daemon() {
        let mut lease=Lease::new(&owner(),now(0,0));
        assert!(lease.observe(&now(4,604)));assert!(lease.live(&now(13,613)));
        let mut restored:Lease=serde_json::from_slice(&serde_json::to_vec(&lease).unwrap()).unwrap();
        assert!(!restored.observe(&now(14,614)));assert!(!restored.live(&now(14,614)));
    }
    #[test]
    fn expired_owner_is_not_resurrected_by_sleep() {
        let mut lease=Lease::new(&owner(),now(0,0));
        lease.observe(&now(31,31));
        assert!(!lease.observe(&now(32,632)));assert!(!lease.live(&now(32,632)));
    }
}
