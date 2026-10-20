//! Explicit local script approval is outside portable settings/database restores.
use anyhow::{bail, ensure, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::RwLock,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
static STATUS: RwLock<Option<Value>> = RwLock::new(None);
#[derive(Serialize, Deserialize)]
struct Approval {
    path: PathBuf,
    sha256: String,
}
fn approval_file() -> PathBuf {
    crate::config::get_app_config_dir().join("startup-script-approval.json")
}
fn approved() -> Result<Option<Approval>> {
    let file = approval_file();
    if !file.exists() {
        return Ok(None);
    }
    use std::os::unix::fs::MetadataExt;
    let metadata = std::fs::symlink_metadata(&file)?;
    ensure!(
        metadata.file_type().is_file()
            && metadata.uid() == unsafe { libc::geteuid() }
            && metadata.mode() & 0o077 == 0
            && metadata.len() < 16 * 1024,
        "Startup approval has unsafe permissions"
    );
    Ok(Some(serde_json::from_slice(&std::fs::read(file)?)?))
}
fn script(path: &Path) -> Result<(Vec<u8>, &'static str)> {
    ensure!(path.is_absolute(), "Choose an absolute script path");
    let metadata = std::fs::metadata(path)?;
    ensure!(
        metadata.is_file() && metadata.len() <= 1024 * 1024,
        "Startup script must be a file no larger than 1 MiB"
    );
    let interpreter = match path.extension().and_then(|s| s.to_str()) {
        Some("sh") => "/bin/bash",
        Some("ps1") if Path::new("/opt/homebrew/bin/pwsh").is_file() => "/opt/homebrew/bin/pwsh",
        Some("ps1") if Path::new("/usr/local/bin/pwsh").is_file() => "/usr/local/bin/pwsh",
        Some("ps1") => bail!("Install PowerShell before authorizing a .ps1 startup script"),
        _ => bail!("Choose a .sh or .ps1 startup script"),
    };
    use std::io::Read;
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= 1024 * 1024, "Startup script exceeds 1 MiB");
    Ok((bytes, interpreter))
}
fn approved_script(approval: &Approval) -> Result<(Vec<u8>, &'static str)> {
    let (bytes, interpreter) = script(&approval.path)?;
    ensure!(
        format!("{:x}", Sha256::digest(&bytes)) == approval.sha256,
        "Startup script changed; select and authorize it again"
    );
    Ok((bytes, interpreter))
}
pub fn snapshot() -> Value {
    STATUS
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .unwrap_or(json!({"state":"none"}))
}
pub async fn choose(app: &tauri::AppHandle) -> Result<Value> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Value> {
        let Some(file) = handle.dialog().file().set_title("选择并授权本机启动脚本 / Authorize local startup script").add_filter("Shell / PowerShell", &["sh", "ps1"]).blocking_pick_file() else {return Ok(snapshot())};
        let path = file.into_path().map_err(|_|anyhow::anyhow!("Only local scripts are supported"))?.canonicalize()?;
        let (bytes, _) = script(&path)?;
        let confirmed = handle.dialog().message(format!("此脚本将在每次 Sivio 启动时以你的用户身份执行，可修改文件和访问网络。只授权你信任的本机脚本。内容改变后必须重新授权。\n\nThis script will run at every Sivio startup with your user permissions, including file and network access. Approve only trusted local scripts; changed contents require approval again.\n\n{}",path.display())).title("启动脚本授权 / Startup script approval").buttons(MessageDialogButtons::OkCancel).blocking_show();
        if !confirmed {return Ok(snapshot())}
        let approval = Approval {path: path.clone(), sha256: format!("{:x}", Sha256::digest(&bytes))};
        let destination = approval_file();
        let mut temporary = tempfile::NamedTempFile::new_in(destination.parent().context("Approval directory missing")?)?;
        use std::io::Write; temporary.write_all(&serde_json::to_vec(&approval)?)?; temporary.as_file().sync_all()?; temporary.persist(&destination)?;
        let value = json!({"state":"ready-next-start","path":path});
        *STATUS.write().unwrap_or_else(|e|e.into_inner()) = Some(value.clone());
        Ok(value)
    }).await?
}
pub fn clear() -> Result<Value> {
    match std::fs::remove_file(approval_file()) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    let value = json!({"state":"none"});
    *STATUS.write().unwrap_or_else(|e| e.into_inner()) = Some(value.clone());
    Ok(value)
}
pub fn start() {
    tauri::async_runtime::spawn(async {
        let result = async {
            let approved = tauri::async_runtime::spawn_blocking(approved).await??;
            let Some(approval) = approved else {
                return Ok::<_, anyhow::Error>(());
            };
            *STATUS.write().unwrap_or_else(|e| e.into_inner()) =
                Some(json!({"state":"running","path":approval.path}));
            let copy = Approval {
                path: approval.path.clone(),
                sha256: approval.sha256.clone(),
            };
            let (_, interpreter) =
                tauri::async_runtime::spawn_blocking(move || approved_script(&copy)).await??;
            // Run the approved canonical path so $0/BASH_SOURCE and sibling
            // resources retain normal script semantics. Approval is not a
            // boundary against another process already running as this user.
            let mut command = tokio::process::Command::new(interpreter);
            if interpreter == "/bin/bash" {
                command.args(["--noprofile", "--norc"]);
            } else {
                command.args(["-NoProfile", "-NonInteractive", "-File"]);
            }
            let status = tokio::time::timeout(
                std::time::Duration::from_secs(30),
                command
                    .arg(&approval.path)
                    .current_dir(approval.path.parent().context("Script parent missing")?)
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .kill_on_drop(true)
                    .status(),
            )
            .await
            .context("Startup script exceeded 30 seconds")??;
            ensure!(status.success(), "Startup script exited unsuccessfully");
            *STATUS.write().unwrap_or_else(|e| e.into_inner()) =
                Some(json!({"state":"completed","path":approval.path}));
            Ok(())
        }
        .await;
        if let Err(error) = result {
            *STATUS.write().unwrap_or_else(|e| e.into_inner()) =
                Some(json!({"state":"failed","error":error.to_string()}));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn changed_scripts_and_unsupported_inputs_are_rejected_before_execution() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("fixture.sh");
        std::fs::write(&path, "exit 0\n").unwrap();
        let approval = Approval {
            path: path.clone(),
            sha256: format!("{:x}", Sha256::digest(b"exit 0\n")),
        };
        assert_eq!(approved_script(&approval).unwrap().1, "/bin/bash");
        std::fs::write(&path, "exit 1\n").unwrap();
        assert!(approved_script(&approval).is_err());
        assert!(script(directory.path()).is_err());
        let unsupported = directory.path().join("fixture.txt");
        std::fs::write(&unsupported, "exit 0").unwrap();
        assert!(script(&unsupported).is_err());
        std::fs::write(&path, vec![b'x'; 1024 * 1024 + 1]).unwrap();
        assert!(script(&path).is_err());
    }
}
