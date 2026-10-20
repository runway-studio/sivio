//! On-demand service preparation. Never prompt during background initialization.
use super::*;

pub(super) const APP_RESTART_MESSAGE: &str =
    "Sivio 运行期间 App 文件已被替换，请完全退出后打开新版 App，再启用网络。";

fn reports_replaced_code(success: bool, diagnostic: &str) -> bool {
    !success && diagnostic.contains("the code on disk does not match what is running")
}

/// A bundle replaced underneath a live process cannot be repaired by registering
/// another hash. Check the running PID, not just the (valid) replacement on disk.
pub(super) async fn running_code_changed() -> bool {
    use std::sync::atomic::{AtomicBool, Ordering};
    static REPLACED: AtomicBool = AtomicBool::new(false);
    if REPLACED.load(Ordering::Relaxed) {
        return true;
    }
    let Ok(Ok(output)) = tokio::time::timeout(
        Duration::from_secs(3),
        Command::new("/usr/bin/codesign")
            .args(["--verify", "--verbose=2", &std::process::id().to_string()])
            .kill_on_drop(true)
            .output(),
    )
    .await else {
        return false;
    };
    let changed = reports_replaced_code(output.status.success(), &String::from_utf8_lossy(&output.stderr));
    if changed {
        REPLACED.store(true, Ordering::Relaxed);
    }
    changed
}

pub(super) async fn require_current_app() -> Result<()> {
    ensure!(!running_code_changed().await, APP_RESTART_MESSAGE);
    Ok(())
}

pub(super) fn signer_pin(requirement: &str) -> Option<&str> {
    let requirement = requirement
        .lines()
        .find_map(|line| line.strip_prefix("designated => "))?;
    let pin = requirement
        .strip_prefix("identifier \"local.siassist.desktop\" and certificate leaf = H\"")?
        .strip_suffix('"')?;
    (pin.len() == 40 && pin.bytes().all(|b| b.is_ascii_hexdigit())).then_some(pin)
}

pub(super) async fn ensure_ready(app: &tauri::AppHandle, settings: &Settings) -> Result<()> {
    if !settings.system_proxy && !settings.tun {
        return Ok(());
    }
    if managed_mode(settings).await.is_ok_and(|managed| managed) {
        return Ok(());
    }
    // A deliberate user enable triggers the OS installation authorization once.
    // Refusal is returned to the user, never retried by a worker.
    install(app).await?;
    ensure!(
        managed_mode(settings).await?,
        "网络服务仍不可用，请重试修复服务"
    );
    Ok(())
}

pub(super) async fn prepare_on_launch(app: &tauri::AppHandle, state: &NetworkState) {
    let result = async {
        let mut catalog = read_catalog()?;
        if catalog.active.is_none() {
            return Ok(());
        }
        // Prepare a useful core without requiring privileges or taking over a
        // different app's proxy. TUN is activated only by a deliberate user action.
        catalog.settings.tun = false;
        start_with_proxy_policy(
            app,
            state,
            &catalog,
            StartPolicy {
                suspend_proxy: true,
                destination_approved: false,
            },
        )
        .await
        .map(|_| ())
    }
    .await;
    if let Err(error) = result {
        state.runtime.lock().await.error = Some(format!("网络准备未完成：{error}"));
    }
    let _ = app.emit("network-runtime-changed", ());
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replaced_running_code_is_distinct_from_missing_service_or_untrusted_signature() {
        assert!(reports_replaced_code(false, "67887: the code on disk does not match what is running\n"));
        for diagnostic in ["CSSMERR_TP_NOT_TRUSTED", "code object is not signed at all", "no such process", ""] {
            assert!(!reports_replaced_code(false, diagnostic));
        }
        assert!(!reports_replaced_code(true, "the code on disk does not match what is running"));
    }
    #[test]
    fn only_exact_desktop_certificate_requirements_can_be_registered() {
        let pin = "A".repeat(40);
        let rule = format!(
            "designated => identifier \"local.siassist.desktop\" and certificate leaf = H\"{pin}\""
        );
        assert_eq!(signer_pin(&rule), Some(pin.as_str()));
        assert!(signer_pin(&rule.replace("local.siassist.desktop", "other.app")).is_none());
        assert!(signer_pin(&format!("{rule} or true")).is_none());
        assert!(signer_pin(&rule.replace(&pin, &"x".repeat(40))).is_none());
        assert!(signer_pin("designated => identifier \"local.siassist.desktop\"").is_none());
    }
}
