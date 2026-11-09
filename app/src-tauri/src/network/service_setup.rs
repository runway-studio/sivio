//! On-demand service preparation. Never prompt during background initialization.
use super::*;

pub(super) const APP_RESTART_MESSAGE: &str =
    "Sivio 运行期间 App 文件已被替换或删除，请完全退出后从应用程序目录打开完整的 App，再启用网络。";

fn reports_replaced_code(success: bool, diagnostic: &str) -> bool {
    // This diagnostic comes from codesign verifying our own live PID. ENOENT
    // means its on-disk code disappeared, not that the helper is unregistered.
    !success
        && (diagnostic.contains("the code on disk does not match what is running")
            || diagnostic.contains("No such file or directory"))
}

/// A bundle replaced or deleted underneath a live process cannot be repaired by registering
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
            .env("LC_ALL", "C")
            .args(["--verify", "--verbose=2", &std::process::id().to_string()])
            .kill_on_drop(true)
            .output(),
    )
    .await
    else {
        return false;
    };
    let changed = reports_replaced_code(
        output.status.success(),
        &String::from_utf8_lossy(&output.stderr),
    );
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
        if !resume_enabled()? {
            return Ok(());
        }
        let actual = tauri::async_runtime::spawn_blocking(sysproxy::Sysproxy::snapshot)
            .await
            .ok()
            .and_then(Result::ok);
        let helper_ready = managed_mode(&catalog.settings)
            .await
            .is_ok_and(|managed| managed);
        let policy = launch_policy(&mut catalog.settings, actual.as_ref(), helper_ready);
        start_with_proxy_policy(app, state, &catalog, policy)
            .await
            .map(|_| ())
    }
    .await;
    if let Err(error) = result {
        state.runtime.lock().await.error = Some(format!("网络准备未完成：{error}"));
    }
    let _ = app.emit("network-runtime-changed", ());
}

// Device-local user intent; excluded from portable configuration and sync.
// Missing records retain the existing automatic-preparation behavior.
fn resume_from(path: &Path) -> Result<bool> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(serde_json::from_slice::<bool>(&bytes)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(true),
        Err(error) => Err(error.into()),
    }
}
fn resume_enabled() -> Result<bool> {
    resume_from(&root()?.join("resume-network.json"))
}
pub(super) fn remember_running(running: bool) -> Result<()> {
    atomic(
        &root()?.join("resume-network.json"),
        &serde_json::to_vec(&running)?,
    )
}

fn launch_policy(
    settings: &mut Settings,
    actual: Option<&sysproxy::ProxySnapshot>,
    helper_ready: bool,
) -> StartPolicy {
    let external = actual.is_none_or(|snapshot| {
        !snapshot.is_all_disabled()
            && proxy_guard::changed(snapshot, &proxy_guard::config(settings))
    });
    let needs_approval = ipc::proxy_destination::needs_revision9(&settings.proxy_host)
        && settings.proxy_host != "localhost";
    let suspend_proxy = external || !helper_ready || needs_approval;
    // Reuse previously authorized settings without prompting during launch.
    // Preserve another app's active proxy, including when our saved mode is TUN.
    if suspend_proxy {
        settings.tun = false;
    }
    StartPolicy {
        suspend_proxy,
        destination_approved: false,
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn launch_restores_saved_modes_but_preserves_external_proxy_and_authorization() {
        let settings = Settings {
            system_proxy: true,
            tun: true,
            mixed_port: 7891,
            ..Default::default()
        };
        let disabled = sysproxy::ProxySnapshot::default();
        let mut restored = settings.clone();
        assert!(!launch_policy(&mut restored, Some(&disabled), true).suspend_proxy);
        assert!(restored.tun);
        let mut external = disabled.clone();
        external.http = sysproxy::ProxyEndpoint {
            host: "127.0.0.1".into(),
            port: 7890,
            enable: true,
            switched_on: true,
        };
        for (snapshot, ready) in [
            (Some(&external), true),
            (None, true),
            (Some(&disabled), false),
        ] {
            let mut candidate = settings.clone();
            assert!(launch_policy(&mut candidate, snapshot, ready).suspend_proxy);
            assert!(!candidate.tun);
            assert!(candidate.system_proxy); // Keep saved intent for explicit reapply.
        }
        let mut remote = settings;
        remote.proxy_host = "192.168.1.2".into();
        assert!(launch_policy(&mut remote, Some(&disabled), true).suspend_proxy);
        assert!(!remote.tun);
    }
    #[test]
    fn explicit_stop_survives_relaunch_and_invalid_intent_does_not_enable_network() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("resume-network.json");
        assert!(resume_from(&path).unwrap());
        std::fs::write(&path, "false").unwrap();
        assert!(!resume_from(&path).unwrap());
        std::fs::write(&path, "true").unwrap();
        assert!(resume_from(&path).unwrap());
        std::fs::write(&path, "invalid").unwrap();
        assert!(resume_from(&path).is_err());
    }
    #[test]
    fn replaced_running_code_is_distinct_from_missing_service_or_untrusted_signature() {
        assert!(reports_replaced_code(
            false,
            "67887: the code on disk does not match what is running\n"
        ));
        assert!(reports_replaced_code(
            false,
            "39506: No such file or directory\n"
        ));
        for diagnostic in [
            "CSSMERR_TP_NOT_TRUSTED",
            "code object is not signed at all",
            "no such process",
            "",
        ] {
            assert!(!reports_replaced_code(false, diagnostic));
        }
        assert!(!reports_replaced_code(
            true,
            "the code on disk does not match what is running"
        ));
        assert!(!reports_replaced_code(true, "No such file or directory"));
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
