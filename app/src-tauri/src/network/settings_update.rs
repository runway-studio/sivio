//! A running settings change commits only after the candidate is ready.
use super::*;
use std::future::Future;

#[derive(Clone, Copy, Default)]
struct Status {
    running: bool,
    starting: bool,
    managed: bool,
    proxy_suspended: bool,
}

trait Backend: Sync {
    fn write(&self) -> &Mutex<()>;
    fn read(&self) -> Result<Catalog>;
    fn save(&self, catalog: &Catalog) -> Result<()>;
    fn status(&self, old: &Catalog) -> impl Future<Output = Result<Status>> + Send;
    fn validate(
        &self,
        old: &Catalog,
        next: &Catalog,
        status: Status,
    ) -> impl Future<Output = Result<()>> + Send;
    fn stop(&self) -> impl Future<Output = Result<()>> + Send;
    fn start(
        &self,
        catalog: &Catalog,
        suspend_proxy: bool,
    ) -> impl Future<Output = Result<()>> + Send;
    fn failed(&self, message: &str) -> impl Future<Output = ()> + Send;
}

async fn apply(backend: &impl Backend, settings: Settings, revision: &str) -> Result<Value> {
    apply_with_start(backend, settings, revision, false).await
}

async fn apply_with_start(
    backend: &impl Backend,
    settings: Settings,
    revision: &str,
    start_if_stopped: bool,
) -> Result<Value> {
    apply_action(backend, settings, revision, start_if_stopped, false).await
}

async fn apply_action(
    backend: &impl Backend,
    settings: Settings,
    revision: &str,
    start_if_stopped: bool,
    take_over_proxy: bool,
) -> Result<Value> {
    let _write = backend.write().lock().await;
    let old = backend.read()?;
    ensure!(
        revision == digest(&serde_json::to_vec(&old.settings)?),
        "network settings changed; reload before saving"
    );
    if !start_if_stopped && serde_json::to_value(&old.settings)? == serde_json::to_value(&settings)?
    {
        return Ok(json!({"saved":true,"restarted":false}));
    }
    let mut status = backend.status(&old).await?;
    status.starting = start_if_stopped && !status.running;
    let mut next = old.clone();
    next.settings = settings;
    let mut validation_status = status;
    if take_over_proxy {
        validation_status.proxy_suspended = false;
    }
    backend.validate(&old, &next, validation_status).await?;
    let current = backend.read()?;
    ensure!(
        current.storage_revision == old.storage_revision
            && serde_json::to_value(&current)? == serde_json::to_value(&old)?,
        "network configuration changed during validation; reload before saving"
    );
    if !status.running && !status.starting {
        if let Err(error) = backend.save(&next) {
            restore_catalog(backend, &old, &next)
                .with_context(|| format!("保存失败且旧配置恢复失败：{error:#}"))?;
            bail!("保存失败；旧配置保持不变，网络保持停止：{error:#}");
        }
        return Ok(json!({"saved":true,"restarted":false}));
    }
    // An unrelated setting must not reclaim a system proxy changed by another app.
    let suspend = !take_over_proxy
        && status.proxy_suspended
        && same_proxy_intent(&old.settings, &next.settings);
    let result = async {
        if status.running {
            backend.stop().await?;
        }
        backend.start(&next, suspend).await?;
        // The repository CAS protects against a different writer during startup.
        backend.save(&next)
    }
    .await;
    if let Err(error) = result {
        // A failed start may still own a process, session or listeners. Confirm
        // cleanup before starting the original core on those same resources.
        let recovery = async {
            backend.stop().await.context("无法确认候选网络已清理")?;
            restore_catalog(backend, &old, &next)?;
            if status.running {
                backend
                    .start(&old, status.proxy_suspended)
                    .await
                    .context("无法重新启动旧网络")?;
            }
            Ok::<(), anyhow::Error>(())
        }
        .await;
        match recovery {
            Ok(()) if status.running => bail!("应用失败；旧配置保持不变，旧网络已恢复：{error:#}"),
            Ok(()) => bail!("启动失败；旧配置保持不变，网络保持停止：{error:#}"),
            Err(recovery) => {
                let message = format!(
                    "应用失败；旧网络恢复失败，请清理并重新载入配置：{error:#}；{recovery:#}"
                );
                backend.failed(&message).await;
                bail!(message);
            }
        }
    }
    Ok(json!({"saved":true,"restarted":status.running,"started":status.starting}))
}

fn same_proxy_intent(old: &Settings, next: &Settings) -> bool {
    old.system_proxy == next.system_proxy && proxy_guard::config(old) == proxy_guard::config(next)
}

// Subscription payloads must be committed before activation so their new
// revision can be resolved. Use the same cleanup/CAS recovery as settings.
async fn apply_profile(
    backend: &impl Backend,
    old: &Catalog,
    next: &Catalog,
    running: bool,
    suspended: bool,
) -> Result<()> {
    let current = backend.read()?;
    ensure!(
        current.storage_revision == old.storage_revision
            && serde_json::to_value(&current)? == serde_json::to_value(old)?,
        "network configuration changed while downloading; reload before updating"
    );
    let result = async {
        if running {
            backend.stop().await?;
        }
        backend.save(next)?;
        if running {
            backend.start(next, suspended).await?;
        }
        Ok::<(), anyhow::Error>(())
    }
    .await;
    if let Err(error) = result {
        let recovery = async {
            if running {
                backend
                    .stop()
                    .await
                    .context("cannot confirm subscription runtime cleanup")?;
            }
            restore_catalog(backend, old, next)?;
            if running {
                backend.start(old, suspended).await?;
            }
            Ok::<(), anyhow::Error>(())
        }
        .await;
        match recovery {
            Ok(()) => bail!(
                "Subscription update failed; previous configuration and runtime restored: {error}"
            ),
            Err(recovery) => {
                let message = format!(
                    "Subscription update failed; recovery requires cleanup: {error}; {recovery}"
                );
                if running {
                    backend.failed(&message).await;
                }
                bail!(message);
            }
        }
    }
    Ok(())
}

pub(super) async fn activate_profile(
    app: &tauri::AppHandle,
    state: &NetworkState,
    old: &Catalog,
    next: &Catalog,
    running: bool,
    suspended: bool,
) -> Result<()> {
    // Caller already holds NetworkState.write across download and validation.
    apply_profile(&Live { app, state }, old, next, running, suspended).await
}

fn restore_catalog(backend: &impl Backend, old: &Catalog, next: &Catalog) -> Result<()> {
    let current = backend.read()?;
    let value = serde_json::to_value(&current)?;
    if value == serde_json::to_value(old)? {
        ensure!(
            current.storage_revision == old.storage_revision,
            "配置被其他操作修改，已保留该修改，请重新载入"
        );
        return Ok(());
    }
    // A write can report a durability error after replacement. Restore only
    // our exact candidate, using its fresh CAS revision; never undo another writer.
    ensure!(
        value == serde_json::to_value(next)?,
        "配置被其他操作修改，已保留该修改，请重新载入"
    );
    let mut rollback = old.clone();
    rollback.storage_revision = current.storage_revision;
    backend.save(&rollback).context("旧配置恢复失败")
}

struct Live<'a> {
    app: &'a tauri::AppHandle,
    state: &'a NetworkState,
}

impl Backend for Live<'_> {
    fn write(&self) -> &Mutex<()> {
        &self.state.write
    }
    fn read(&self) -> Result<Catalog> {
        read_catalog()
    }
    fn save(&self, catalog: &Catalog) -> Result<()> {
        save_catalog(catalog)
    }
    async fn status(&self, old: &Catalog) -> Result<Status> {
        let runtime = self.state.runtime.lock().await;
        ensure!(
            ["running", "stopped"].contains(&runtime.phase.as_str()),
            "网络正在切换或需要清理，请稍后重试"
        );
        let running = runtime.phase == "running";
        if running {
            ensure!(
                runtime.active == old.active,
                "活动订阅已变化，请重新载入设置"
            );
        }
        let suspended = runtime.proxy_guard.tripped;
        let managed = runtime.managed;
        drop(runtime);
        // Read shared OS state immediately; the periodic guard may not have
        // observed an external change yet. An unreadable state fails closed.
        let proxy_suspended =
            proxy_guard::suspended(&old.settings, running && managed, suspended).await?;
        Ok(Status {
            running,
            starting: false,
            managed,
            proxy_suspended,
        })
    }
    async fn validate(&self, old: &Catalog, next: &Catalog, status: Status) -> Result<()> {
        let data = next.active.as_ref().map(|id| secret_get(id)).transpose()?;
        let yaml = data
            .as_ref()
            .map(|v| text(v, "yaml"))
            .transpose()?
            .unwrap_or("{}");
        let name = next
            .profiles
            .iter()
            .find(|p| Some(&p.id) == next.active.as_ref())
            .map(|p| p.name.as_str())
            .unwrap_or("Sivio");
        let composed = compose_with_profile(
            yaml,
            &next.settings,
            Path::new("/tmp/si-check.sock"),
            data.as_ref().and_then(|v| v.get("enhancement")),
            name,
        )?;
        validate_core(&checked_core(self.app, &next.settings.core)?, &composed).await?;
        if status.running || status.starting {
            // All dependency and permission failures known in advance must be
            // rejected while the original network is still serving requests.
            let mut requirements = next.settings.clone();
            if status.proxy_suspended && same_proxy_intent(&old.settings, &next.settings) {
                requirements.system_proxy = false;
            }
            service_setup::ensure_ready(self.app, &requirements).await?;
            let managed = managed_mode(&requirements).await?;
            ensure!(
                !status.running || managed == status.managed || (!status.managed && managed),
                "网络服务状态已变化，请重新启动网络后重试"
            );
            port::check_settings(
                &next.settings,
                status.running.then_some(&old.settings),
                managed,
            )?;
            let old_yaml = compose_with_profile(
                yaml,
                &old.settings,
                Path::new("/tmp/si-check.sock"),
                data.as_ref().and_then(|v| v.get("enhancement")),
                name,
            )?;
            port::check_dns(
                &composed,
                status.running.then_some(old_yaml.as_str()),
                managed,
            )?;
            if !status.proxy_suspended || !same_proxy_intent(&old.settings, &next.settings) {
                approve_proxy_destination(self.app, self.state, &next.settings).await?;
            }
        }
        Ok(())
    }
    async fn stop(&self) -> Result<()> {
        shutdown(self.state).await
    }
    async fn start(&self, catalog: &Catalog, suspend_proxy: bool) -> Result<()> {
        // The candidate was approved during preflight, and the old runtime's
        // destination was approved before it originally started. Recovery must
        // never block on a new confirmation dialog after stopping the network.
        start_with_proxy_policy(
            self.app,
            self.state,
            catalog,
            StartPolicy {
                suspend_proxy,
                destination_approved: true,
                ..Default::default()
            },
        )
        .await
        .map(|_| ())
    }
    async fn failed(&self, message: &str) {
        let mut runtime = self.state.runtime.lock().await;
        runtime.phase = "failed".into();
        runtime.recovery_required = true;
        runtime.error = Some(message.into());
        outbound::core(None, runtime.generation, false);
    }
}

pub(super) async fn save(
    app: &tauri::AppHandle,
    state: &NetworkState,
    args: &Value,
) -> Result<Value> {
    let settings =
        serde_json::from_value(args.get("settings").context("missing settings")?.clone())?;
    let revision = text(args, "baseRevision")?;
    let start_if_stopped = args
        .get("startIfStopped")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let take_over = args
        .get("takeOverProxy")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let result = if start_if_stopped || take_over {
        apply_action(&Live { app, state }, settings, revision, true, take_over).await
    } else {
        apply(&Live { app, state }, settings, revision).await
    };
    if result.is_ok() && (start_if_stopped || take_over) {
        let _write = state.write.lock().await;
        if state.runtime.lock().await.phase == "running" {
            service_setup::remember_running(true)?;
        }
    }
    let _ = app.emit("network-runtime-changed", ());
    result
}

#[cfg(test)]
mod tests;
