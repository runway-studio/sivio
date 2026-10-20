use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};
#[derive(Serialize, Deserialize)]
struct Trust {
    #[serde(default)]
    hashes: Vec<String>,
    #[serde(default)]
    signers: Vec<String>,
}
fn path() -> Result<std::path::PathBuf> {
    Ok(super::paths::service_paths()?
        .persistent_state_dir()
        .join("trusted-clients.json"))
}
pub(crate) fn verify(context: &kode_bridge::RequestContext) -> Result<()> {
    let token = context
        .client_info
        .peer_credentials
        .audit_token
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("peer audit token unavailable"))?;
    let trust: Trust =
        super::lease::read_private(&path()?)?.ok_or_else(|| anyhow::anyhow!("client trust is not configured"))?;
    ensure!(
        sysproxy::verify_audit_client_signers(token, &trust.hashes, &trust.signers)?,
        "caller code signature rejected"
    );
    Ok(())
}
/// Called only by the elevated installer; the service never exposes this as an IPC mutation.
pub fn register(hashes: Vec<String>) -> Result<()> {
    register_with_signers(hashes, vec![])
}
pub fn register_with_signers(hashes: Vec<String>, signers: Vec<String>) -> Result<()> {
    ensure!(
        unsafe { platform_lib::geteuid() } == 0,
        "client trust registration requires root"
    );
    ensure!(
        hashes.len() + signers.len() > 0
            && hashes.len() + signers.len() <= 32
            && hashes
                .iter()
                .chain(&signers)
                .all(|s| s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit())),
        "invalid client code hashes"
    );
    super::lease::write_private(&path()?, &Trust { hashes, signers })
}
