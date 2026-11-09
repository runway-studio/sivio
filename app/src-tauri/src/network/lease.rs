//! Keep the helper lease alive independently of UI/control/lifecycle locks.
use super::*;
use tokio::sync::watch;

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub(super) enum RenewalError {
    #[error("owner session is stale or invalid")]
    Stale,
    #[error("{0}")]
    Other(String),
}

pub(super) struct Heartbeat {
    task: tokio::task::JoinHandle<()>,
    status: watch::Receiver<std::result::Result<(), RenewalError>>,
}

impl Heartbeat {
    pub fn start(owner: ipc::OwnerCredentials, proof: ipc::OwnerSessionProof) -> Self {
        Self::spawn(Duration::from_secs(5), move || {
            let owner = owner.clone();
            let proof = proof.clone();
            async move {
                match tokio::time::timeout(Duration::from_secs(3), ipc::renew_owner(&owner, &proof))
                    .await
                {
                    Ok(Ok(response)) if response.code == 0 => Ok(()),
                    Ok(Ok(response)) if response.code == ipc::ServiceErrorCode::StaleOwnerSession as u16 => Err(RenewalError::Stale),
                    Ok(Ok(response)) => Err(RenewalError::Other(response.message)),
                    Ok(Err(error)) => Err(RenewalError::Other(error.to_string())),
                    Err(_) => Err(RenewalError::Other("helper lease renewal timed out".into())),
                }
            }
        })
    }

    fn spawn<F, Fut>(period: Duration, mut renew: F) -> Self
    where
        F: FnMut() -> Fut + Send + 'static,
        Fut: std::future::Future<Output = std::result::Result<(), RenewalError>> + Send,
    {
        let (sender, status) = watch::channel(Ok(()));
        let task = tokio::spawn(async move {
            let mut timer = tokio::time::interval(period);
            timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                timer.tick().await;
                let result = renew().await;
                if result != *sender.borrow() {
                    if let Err(error) = &result {
                        log::warn!("Network helper lease renewal failed: {error}");
                    }
                }
                let stale = result == Err(RenewalError::Stale);
                if sender.send(result).is_err() || stale {
                    break;
                }
            }
        });
        Self { task, status }
    }

    pub fn latest(&self) -> std::result::Result<(), RenewalError> {
        self.status.borrow().clone()
    }
}

impl Drop for Heartbeat {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Rebuild only the managed run whose heartbeat was rejected. Release the write lock
/// between attempts so a manual stop, profile switch or app update can cancel them.
pub(super) async fn reconnect(app: &tauri::AppHandle, state: &NetworkState, mut generation: u64) {
    let mut previous = None;
    let mut attempts = 0;
    let mut delay = 0;
    while attempts < 3 {
        tokio::time::sleep(Duration::from_secs(delay)).await;
        let _write = state.write.lock().await;
        let mut runtime = state.runtime.lock().await;
        if runtime.generation != generation || runtime.phase != "failed" || runtime.recovery_required
            || crate::update_install::installing() {
            return;
        }
        let (expired, profile, tun, tripped) = if let Some(previous) = &previous {
            previous
        } else {
            let (Some(session), Some(profile)) = (&runtime.session, &runtime.active) else { return };
            let connection = (session.generation, profile.clone(), runtime.tun, runtime.proxy_guard.tripped);
            // A rejected proof will never renew. Do not schedule another recovery
            // loop on the next health tick if these bounded attempts fail.
            runtime.lease = None;
            previous.insert(connection)
        };
        let result = async {
            let mut catalog = read_catalog()?;
            ensure!(catalog.active.as_ref() == Some(profile), "活动配置已更改");
            service_setup::require_current_app().await?;
            let version = ipc::get_version().await?;
            ensure!(version.code == 0 && version.data.is_some_and(|v| v.supports_client(
                ipc::ProtocolVersion::current(), ipc::MIN_SERVICE_REVISION_FOR_RECONNECT)),
                "自动重连需要新版网络服务，请在网络设置中安装 / 修复服务");
            if runtime.session.is_some() {
                let status = ipc::get_status(&credentials()?).await?;
                ensure!(status.code == 0 && status.data.is_some_and(|s| !s.is_active),
                    "网络服务尚未释放旧连接，或已有其他连接");
                // The helper has already cleaned up this session. Only release
                // our local listeners here; never send a stop for another session.
                runtime.session = None;
                stop_inner(&mut runtime).await?;
            }
            drop(runtime);
            catalog.settings.tun &= *tun;
            let external = if catalog.settings.tun || catalog.settings.system_proxy {
                let actual = tauri::async_runtime::spawn_blocking(sysproxy::Sysproxy::snapshot).await??;
                !actual.is_all_disabled() && proxy_guard::changed(&actual, &proxy_guard::config(&catalog.settings))
            } else {
                false
            };
            ensure!(!catalog.settings.tun || !external, "当前系统代理已由其他应用接管");
            let suspend_proxy = *tripped || external;
            if catalog.settings.system_proxy && !suspend_proxy
                && ipc::proxy_destination::needs_revision9(&catalog.settings.proxy_host)
                && catalog.settings.proxy_host != "localhost" {
                ensure!(state.approved_proxy_target.lock().await.as_ref() == Some(&proxy_guard::config(&catalog.settings)),
                    "系统代理目标已更改，需手动确认");
            }
            let policy = StartPolicy {
                expired_generation: Some(*expired),
                suspend_proxy,
                destination_approved: true,
            };
            start_with_proxy_policy(app, state, &catalog, policy).await
        }.await;
        if let Err(error) = &result {
            // A Mac may wake away from Wi-Fi. Wait for a primary service without
            // spending the core restart budget while no start is possible.
            if matches!(error.downcast_ref::<sysproxy::Error>(), Some(sysproxy::Error::NoActiveNetworkService)) {
                delay = 15;
            } else {
                attempts += 1;
                delay = if attempts == 1 { 5 } else { 15 };
            }
            let mut runtime = state.runtime.lock().await;
            generation = runtime.generation;
            runtime.phase = "failed".into();
            runtime.error = Some(format!("网络自动重连失败：{error}"));
        }
        let _ = app.emit("network-runtime-changed", ());
        if result.is_ok() { return; }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn renews_while_runtime_is_locked_and_stops_with_session() {
        let state = NetworkState::default();
        let mut runtime = state.runtime.lock().await;
        let (sender, mut ticks) = tokio::sync::mpsc::unbounded_channel();
        runtime.lease = Some(Heartbeat::spawn(Duration::from_millis(5), move || {
            let sender = sender.clone();
            async move {
                sender.send(()).unwrap();
                Ok(())
            }
        }));
        // Retain the same lock used by long controller and lifecycle operations.
        for _ in 0..3 {
            tokio::time::timeout(Duration::from_secs(1), ticks.recv())
                .await
                .unwrap()
                .unwrap();
        }
        let lease = runtime.lease.take().unwrap();
        let task = lease.task.abort_handle();
        drop(lease);
        tokio::time::timeout(Duration::from_secs(1), async {
            while !task.is_finished() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        while ticks.try_recv().is_ok() {}
        assert_eq!(ticks.recv().await, None);
    }

    #[tokio::test]
    async fn stale_proof_stays_rejected_until_replaced() {
        let (sender, mut attempts) = tokio::sync::mpsc::unbounded_channel();
        let mut heartbeat = Heartbeat::spawn(Duration::from_millis(1), move || {
            sender.send(()).unwrap();
            async { Err(RenewalError::Stale) }
        });
        heartbeat.status.changed().await.unwrap();
        assert_eq!(heartbeat.latest(), Err(RenewalError::Stale));
        assert_eq!(attempts.recv().await, Some(()));
        assert_eq!(attempts.recv().await, None);
    }

    #[tokio::test]
    async fn reports_failure_and_subsequent_recovery() {
        let mut attempts = 0;
        let mut heartbeat = Heartbeat::spawn(Duration::from_millis(5), move || {
            attempts += 1;
            let result = if attempts == 1 {
                Err(RenewalError::Other("unavailable".into()))
            } else {
                Ok(())
            };
            async move { result }
        });
        heartbeat.status.changed().await.unwrap();
        assert_eq!(heartbeat.latest(), Err(RenewalError::Other("unavailable".into())));
        heartbeat.status.changed().await.unwrap();
        assert_eq!(heartbeat.latest(), Ok(()));
    }
}
