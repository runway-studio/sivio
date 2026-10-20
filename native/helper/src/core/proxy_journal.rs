//! Recovery uses a service-scoped compare-and-swap under the native preferences lock.
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use super::{lease::{read_private, write_private}, paths::service_paths};

#[derive(Default, Serialize, Deserialize)]
struct Journal { changes: Vec<sysproxy::NativeProxyChange> }
fn path()->Result<std::path::PathBuf>{Ok(service_paths()?.persistent_state_dir().join("network-ownership.json"))}

pub(crate) fn prepare(change:&sysproxy::NativeProxyChange)->std::io::Result<()> {
    let result=(||->Result<()> {
        let path=path()?;
        let mut journal:Journal=read_private(&path)?.unwrap_or_default();
        ensure!(journal.changes.len()<1024,"network journal needs recovery before another write");
        if let Some(old)=journal.changes.iter().rev().find(|old|old.service_id==change.service_id) {
            ensure!(sysproxy::native_snapshots_equal(&old.after,&change.before)?,"external proxy modification; explicit takeover required");
        }
        journal.changes.push(change.clone());
        write_private(&path,&journal)
    })();
    result.map_err(std::io::Error::other)
}

pub(crate) fn restore()->Result<()> {
    let path=path()?;
    let Some(mut journal):Option<Journal>=read_private(&path)? else{return Ok(())};
    if journal.changes.is_empty() {return Ok(())}
    let remaining=restore_changes(&journal.changes,sysproxy::restore_owned_native)?;
    journal.changes=remaining;
    write_private(&path,&journal)?;
    ensure!(journal.changes.is_empty(),"network services unavailable; recovery journal retained");
    Ok(())
}

/// Compact only after SCPreferences accepted the write. Interrupted writes retain their undo chain.
pub(crate) fn commit() -> Result<()> {
    let path=path()?;
    let mut journal:Journal=read_private(&path)?.context("proxy journal missing after write")?;
    let mut compacted:Vec<sysproxy::NativeProxyChange>=Vec::new();
    for change in journal.changes {
        if let Some(old)=compacted.iter_mut().find(|old|old.service_id==change.service_id) {
            old.after=change.after;
        } else {compacted.push(change);}
    }
    journal.changes=compacted;
    write_private(&path,&journal)
}

fn restore_changes(changes:&[sysproxy::NativeProxyChange],mut restore:impl FnMut(&sysproxy::NativeProxyChange)->sysproxy::Result<sysproxy::RestoreOutcome>)->Result<Vec<sysproxy::NativeProxyChange>> {
    let mut remaining=Vec::new();
    for change in changes.iter().rev() {
        match restore(change) {
            Ok(sysproxy::RestoreOutcome::MissingService)=>remaining.push(change.clone()),
            Ok(sysproxy::RestoreOutcome::ExternalChange)=>tracing::warn!("External network ownership preserved"),
            Ok(_)=>{},
            Err(error)=>return Err(error).context("owned network recovery incomplete"),
        }
    }
    remaining.reverse();Ok(remaining)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pending_write_is_undone_before_committed_predecessor() {
        let first=sysproxy::NativeProxyChange{service_id:"wifi".into(),before:vec![1],after:vec![2]};
        let pending=sysproxy::NativeProxyChange{service_id:"wifi".into(),before:vec![2],after:vec![3]};
        for initial in [vec![2],vec![3],vec![9]] {
            let mut current=initial.clone();
            let remaining=restore_changes(&[first.clone(),pending.clone()],|change| {
                if current==change.before {return Ok(sysproxy::RestoreOutcome::AlreadyRestored)}
                if current!=change.after {return Ok(sysproxy::RestoreOutcome::ExternalChange)}
                current=change.before.clone();Ok(sysproxy::RestoreOutcome::Restored)
            }).unwrap();
            assert!(remaining.is_empty());
            assert_eq!(current,if initial==vec![9]{vec![9]}else{vec![1]});
        }
    }
    #[test]
    fn missing_service_and_failed_write_retain_recovery_work() {
        let change=sysproxy::NativeProxyChange{service_id:"wifi".into(),before:vec![1],after:vec![2]};
        let remaining=restore_changes(&[change.clone()],|_|Ok(sysproxy::RestoreOutcome::MissingService)).unwrap();
        assert_eq!(remaining,vec![change.clone()]);
        assert!(restore_changes(&[change],|_|Err(std::io::Error::other("injected write failure").into())).is_err());
    }
}
