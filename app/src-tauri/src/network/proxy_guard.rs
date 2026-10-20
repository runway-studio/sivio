//! Observe shared macOS proxy ownership without coupling it to the independent core lifetime.
use super::*;
#[derive(Default)]
pub(super) struct Guard {
    pub last: Option<std::time::Instant>,
    pub tripped: bool,
    target: Option<(Duration, ipc::MacosProxyConfig)>,
}
impl Guard {
    pub(super) fn configured(settings: &Settings) -> Self {
        Self {
            target: (settings.system_proxy && settings.proxy_guard).then(|| {
                (
                    Duration::from_secs(settings.proxy_guard_seconds),
                    config(settings),
                )
            }),
            ..Default::default()
        }
    }
}
pub(super) fn config(settings: &Settings) -> ipc::MacosProxyConfig {
    if settings.proxy_mode == "pac" {
        ipc::MacosProxyConfig::Pac {
            url: format!(
                "http://{}:{}/commands/pac",
                ipc::proxy_destination::authority(&settings.proxy_host),
                settings.pac_port
            ),
        }
    } else {
        ipc::MacosProxyConfig::Global {
            host: settings.proxy_host.clone(),
            port: settings.mixed_port,
            bypass: effective_bypass(settings).into(),
        }
    }
}
pub(super) fn effective_bypass(settings: &Settings) -> &str {
    if settings.use_default_bypass {
        "localhost,127.*,::1"
    } else {
        &settings.bypass
    }
}
pub(super) fn validate(settings: &Settings) -> Result<()> {
    let bypass = effective_bypass(settings);
    ensure!(
        bypass.len() <= 8192 && !bypass.contains('\0'),
        "Proxy bypass is too long or contains NUL"
    );
    ensure!(
        (1..=3600).contains(&settings.proxy_guard_seconds),
        "Proxy guard interval must be 1–3600 seconds"
    );
    if settings.bypass_check {
        ensure!(
            bypass.split(',').all(|part| {
                let part = part.trim();
                !part.is_empty()
                    && part
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || "-._:*?/<>[]".contains(c))
            }),
            "Invalid bypass syntax; use comma-separated hosts, wildcards or IP ranges"
        );
    }
    Ok(())
}
pub(super) fn changed(snapshot: &sysproxy::ProxySnapshot, desired: &ipc::MacosProxyConfig) -> bool {
    match desired {
        ipc::MacosProxyConfig::Global { host, port, bypass } => {
            !snapshot.matches_global(&sysproxy::Sysproxy {
                host: host.clone(),
                port: *port,
                bypass: bypass.clone(),
                enable: true,
            })
        }
        ipc::MacosProxyConfig::Pac { url } => !snapshot.matches_pac(&sysproxy::Autoproxy {
            url: url.clone(),
            enable: true,
        }),
        _ => true,
    }
}

/// A restart is not a new user takeover of shared macOS proxy settings.
pub(super) async fn suspended(
    settings: &Settings,
    managed_running: bool,
    tripped: bool,
) -> Result<bool> {
    if tripped || !managed_running || !settings.system_proxy {
        return Ok(tripped);
    }
    Ok(
        tauri::async_runtime::spawn_blocking(sysproxy::Sysproxy::snapshot)
            .await?
            .as_ref()
            .map_or(true, |actual| changed(actual, &config(settings))),
    )
}
pub(super) async fn reconcile(runtime: &mut Runtime) {
    let Some((interval, desired)) = runtime.proxy_guard.target.clone() else {
        return;
    };
    if runtime.phase != "running" || !runtime.managed || runtime.proxy_guard.tripped {
        return;
    }
    if runtime
        .proxy_guard
        .last
        .is_some_and(|at| at.elapsed() < interval)
    {
        return;
    }
    runtime.proxy_guard.last = Some(std::time::Instant::now());
    let actual = tauri::async_runtime::spawn_blocking(sysproxy::Sysproxy::snapshot).await;
    observe(
        runtime,
        actual.as_ref().ok().and_then(|result| result.as_ref().ok()),
        &desired,
    );
}

fn observe(
    runtime: &mut Runtime,
    actual: Option<&sysproxy::ProxySnapshot>,
    desired: &ipc::MacosProxyConfig,
) {
    if actual.is_none_or(|snapshot| changed(snapshot, desired)) {
        // Disabled is also an external edit. Do not write, clear the helper journal,
        // stop the core, or turn an ownership warning into a runtime failure.
        runtime.proxy_guard.tripped = true;
    }
}

pub(super) async fn reapply(runtime: &mut Runtime, settings: &Settings) -> Result<()> {
    ensure!(
        runtime.phase == "running" && runtime.managed && settings.system_proxy,
        "Start the managed network with system proxy enabled first"
    );
    let proof = runtime
        .session
        .as_ref()
        .context("Network session unavailable")?;
    let owner = credentials()?;
    runtime.proxy_guard.tripped = true;
    // This is an explicit user takeover. Release our old journal with CAS first;
    // external edits remain intact and become the new rollback baseline.
    for desired in [ipc::MacosProxyConfig::Disabled, config(settings)] {
        let response = ipc::set_system_proxy(&owner, proof, &desired).await?;
        ensure!(
            response.code == 0 && matches!(response.data, Some(ipc::ProxyApplyOutcome::Applied)),
            "系统代理未能应用，内核继续运行：{}",
            response.message
        );
    }
    runtime.proxy_guard = Guard::configured(settings);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn external_disable_or_switch_never_changes_core_or_lease() {
        let settings = Settings {
            mixed_port: 7891,
            system_proxy: true,
            ..Default::default()
        };
        let desired = config(&settings);
        let mut runtime = Runtime {
            phase: "running".into(),
            managed: true,
            port: Some(7891),
            generation: 7,
            session: Some(ipc::OwnerSessionProof {
                generation: 7,
                token: "fixture".into(),
            }),
            proxy_guard: Guard::configured(&settings),
            ..Default::default()
        };
        let mut ours = sysproxy::ProxySnapshot::default();
        let endpoint = sysproxy::ProxyEndpoint {
            host: "127.0.0.1".into(),
            port: 7891,
            enable: true,
            switched_on: true,
        };
        ours.http = endpoint.clone();
        ours.https = endpoint.clone();
        ours.socks = endpoint;
        ours.bypass = "localhost,127.*,::1".into();
        observe(&mut runtime, Some(&ours), &desired);
        assert!(!runtime.proxy_guard.tripped);
        let mut other = ours.clone();
        other.http.port = 7890;
        for actual in [Some(sysproxy::ProxySnapshot::default()), Some(other), None] {
            observe(&mut runtime, actual.as_ref(), &desired);
            assert!(runtime.proxy_guard.tripped);
            assert_eq!(runtime.phase, "running");
            assert_eq!(runtime.port, Some(7891));
            assert_eq!(runtime.session.as_ref().unwrap().generation, 7);
            assert!(runtime.error.is_none());
        }
    }
    #[test]
    fn external_proxy_changes_are_detected_and_bypass_checks_are_bounded() {
        let desired = config(&Settings::default());
        let mut snapshot = sysproxy::ProxySnapshot::default();
        snapshot.http = sysproxy::ProxyEndpoint {
            host: "127.0.0.1".into(),
            port: 7890,
            enable: true,
            switched_on: true,
        };
        assert!(changed(&snapshot, &desired));
        assert!(changed(&sysproxy::ProxySnapshot::default(), &desired));
        let mut settings = Settings {
            bypass: "bad value".into(),
            use_default_bypass: false,
            ..Default::default()
        };
        assert!(validate(&settings).is_err());
        settings.bypass_check = false;
        assert!(validate(&settings).is_ok());
        settings.bypass = "x".repeat(8193);
        assert!(validate(&settings).is_err());
        settings.use_default_bypass = true;
        assert!(validate(&settings).is_ok());
    }
}
