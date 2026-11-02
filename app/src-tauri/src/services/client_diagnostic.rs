//! In-memory bounded diagnostic lifecycle. Last result per client; no prompts/outputs persisted.
use super::workspace_readiness::{self, CheckState, Snapshot};
use crate::{app_config::AppType, store::AppState};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tokio::sync::watch;

const DEADLINE: Duration = Duration::from_secs(30);
const TTL_MS: i64 = 600_000;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub app: String,
    pub configuration_revision: String,
    pub credential_epoch: String,
    pub network_generation: u64,
    pub outbound_revision: String,
}
impl From<&Snapshot> for Identity {
    fn from(s: &Snapshot) -> Self {
        Self {
            app: s.app.clone(),
            configuration_revision: s.configuration_revision.clone(),
            credential_epoch: s.credential_epoch.clone(),
            network_generation: s.network_generation,
            outbound_revision: s.outbound_revision.clone(),
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub run_id: String,
    pub app: String,
    pub provider_id: String,
    pub model: String,
    pub identity: Identity,
    pub observed_at: i64,
    pub state: CheckState,
    pub reason_code: String,
    pub purpose: &'static str,
    pub budget_enforcement: &'static str,
    pub cost_status: &'static str,
}
struct Entry {
    run: Run,
    cancel: watch::Sender<bool>,
}
#[derive(Default)]
struct Store {
    entries: HashMap<String, Entry>,
}
fn store() -> &'static Mutex<Store> {
    static STORE: OnceLock<Mutex<Store>> = OnceLock::new();
    STORE.get_or_init(Default::default)
}
impl Store {
    fn begin(
        &mut self,
        identity: Identity,
        provider_id: String,
        model: String,
    ) -> Result<(Run, watch::Receiver<bool>), String> {
        if self
            .entries
            .get(&identity.app)
            .is_some_and(|e| e.run.state == CheckState::Pending)
        {
            return Err("diagnostic_busy".into());
        }
        let (cancel, rx) = watch::channel(false);
        let run = Run {
            run_id: uuid::Uuid::new_v4().to_string(),
            app: identity.app.clone(),
            identity,
            provider_id,
            model,
            observed_at: chrono::Utc::now().timestamp_millis(),
            state: CheckState::Pending,
            reason_code: "diagnostic_pending".into(),
            purpose: "diagnostic",
            budget_enforcement: "not_enabled",
            cost_status: "unknown",
        };
        self.entries.insert(
            run.app.clone(),
            Entry {
                run: run.clone(),
                cancel,
            },
        );
        Ok((run, rx))
    }
    fn finish(&mut self, run: &Run, state: CheckState, reason: &str) {
        if let Some(e) = self.entries.get_mut(&run.app) {
            if e.run.run_id == run.run_id && e.run.state == CheckState::Pending {
                e.run.state = state;
                e.run.reason_code = reason.into();
                e.run.observed_at = chrono::Utc::now().timestamp_millis();
            }
        }
    }
    fn cancel(&mut self, id: &str) -> bool {
        if let Some(e) = self.entries.values_mut().find(|e| e.run.run_id == id) {
            if e.run.state == CheckState::Pending {
                let _ = e.cancel.send(true);
                e.run.state = CheckState::Fail;
                e.run.reason_code = "diagnostic_cancelled".into();
            }
            return true;
        }
        false
    }
    fn latest(&mut self, identity: &Identity, now: i64) -> Option<Run> {
        let e = self.entries.get_mut(&identity.app)?;
        if &e.run.identity != identity
            || now < e.run.observed_at
            || now - e.run.observed_at >= TTL_MS
        {
            let _ = e.cancel.send(true);
            e.run.state = CheckState::Stale;
            e.run.reason_code = "diagnostic_stale".into();
        }
        Some(e.run.clone())
    }
}
pub fn latest(identity: &Identity, now: i64) -> Option<Run> {
    store()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .latest(identity, now)
}
pub fn cancel(id: &str) -> bool {
    store().lock().unwrap_or_else(|e| e.into_inner()).cancel(id)
}

pub async fn snapshot(state: &AppState, app: &AppType) -> Result<Snapshot, String> {
    let state_copy = state.clone();
    let app_copy = app.clone();
    let local = tokio::task::spawn_blocking(move || {
        workspace_readiness::local_facts(&state_copy, &app_copy)
    })
    .await
    .map_err(|_| "readiness_unavailable")??;
    let gateway = state
        .proxy_service
        .get_status()
        .await
        .map_err(|_| "gateway_status_unavailable")?;
    Ok(workspace_readiness::assemble(
        local,
        gateway.running,
        crate::network::outbound::observe()?,
        chrono::Utc::now().timestamp_millis(),
    ))
}
/// Stage A admission explicitly has no budget enforcement. Stage B attaches ledger/policy here.
/// Kept separate from production scheduling: no group reservation, retry or breaker mutation.
async fn dispatch(state: &AppState, app: &AppType, run: &Run) -> Result<(), &'static str> {
    let state_copy = state.clone();
    let provider_id = run.provider_id.clone();
    let app_copy = app.clone();
    let provider = tokio::task::spawn_blocking(move || {
        state_copy
            .db
            .get_provider_by_id(&provider_id, app_copy.as_str())
    })
    .await
    .map_err(|_| "configuration_unavailable")?
    .map_err(|_| "configuration_unavailable")?
    .ok_or("provider_missing")?;
    let request = crate::proxy::providers::diagnostic::prepare(app, &provider, &run.model)?;
    let (client, _) = crate::network::outbound::diagnostic_snapshot()
        .await
        .map_err(|_| "outbound_failed")?;
    // Recheck after preparing transport and before any upstream request bytes.
    let before = snapshot(state, app)
        .await
        .map_err(|_| "configuration_unavailable")?;
    if Identity::from(&before) != run.identity {
        return Err("diagnostic_stale");
    }
    crate::proxy::providers::diagnostic::send(client, request).await
}
pub async fn start(
    state: AppState,
    app: AppType,
    expected: Identity,
    provider_id: String,
    model: String,
    active_probe: bool,
) -> Result<Run, String> {
    if provider_id.len() > 512
        || model.len() > 512
        || provider_id.is_empty()
        || model.trim().is_empty()
    {
        return Err("invalid_model".into());
    }
    if !active_probe {
        return Err("active_probe_requires_confirmation".into());
    }
    let current = snapshot(&state, &app).await?;
    if Identity::from(&current) != expected {
        return Err("diagnostic_stale".into());
    }
    let (run, mut cancelled) =
        store()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .begin(expected, provider_id, model)?;
    let worker_run = run.clone();
    tokio::spawn(async move {
        let operation = async {
            let result = dispatch(&state, &app, &worker_run).await;
            let after = snapshot(&state, &app).await;
            if after.as_ref().map(Identity::from).ok().as_ref() != Some(&worker_run.identity) {
                Err("diagnostic_stale")
            } else {
                result
            }
        };
        let result = tokio::select! {
            biased;
            _=cancelled.changed()=>Err("diagnostic_cancelled"),
            result=tokio::time::timeout(DEADLINE,operation)=>result.unwrap_or(Err("diagnostic_timeout")),
        };
        let (state, reason) = match result {
            Ok(()) => (CheckState::Pass, "model_verified"),
            Err("diagnostic_stale") => (CheckState::Stale, "diagnostic_stale"),
            Err(
                reason @ ("model_verification_unsupported" | "credential_verification_unsupported"),
            ) => (CheckState::Unsupported, reason),
            Err(reason) => (CheckState::Fail, reason),
        };
        store()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .finish(&worker_run, state, reason);
    });
    Ok(run)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn identity() -> Identity {
        Identity {
            app: "claude".into(),
            configuration_revision: "c".into(),
            credential_epoch: "k".into(),
            network_generation: 1,
            outbound_revision: "o".into(),
        }
    }
    #[test]
    fn busy_cancel_retry_rejects_late_result() {
        let mut s = Store::default();
        let (old, _) = s.begin(identity(), "p".into(), "m".into()).unwrap();
        assert!(s.begin(identity(), "p".into(), "m".into()).is_err());
        assert!(s.cancel(&old.run_id));
        let (new, _) = s.begin(identity(), "p".into(), "m".into()).unwrap();
        s.finish(&old, CheckState::Pass, "model_verified");
        assert_eq!(
            s.latest(&identity(), new.observed_at).unwrap().state,
            CheckState::Pending
        );
        s.finish(&new, CheckState::Fail, "authentication_failed");
        assert_eq!(
            s.latest(&identity(), chrono::Utc::now().timestamp_millis())
                .unwrap()
                .reason_code,
            "authentication_failed"
        );
    }
    #[test]
    fn versions_expiry_and_reverting_do_not_resurrect_success() {
        for field in 0..5 {
            let mut s = Store::default();
            let (run, _) = s.begin(identity(), "p".into(), "m".into()).unwrap();
            s.finish(&run, CheckState::Pass, "model_verified");
            let now = s.entries["claude"].run.observed_at;
            let mut changed = identity();
            match field {
                0 => changed.configuration_revision = "changed".into(),
                1 => changed.credential_epoch = "changed".into(),
                2 => changed.network_generation += 1,
                3 => changed.outbound_revision = "changed".into(),
                _ => {}
            }
            assert_eq!(
                s.latest(&changed, if field == 4 { now + TTL_MS } else { now })
                    .unwrap()
                    .state,
                CheckState::Stale
            );
            assert_eq!(s.latest(&identity(), now).unwrap().state, CheckState::Stale);
        }
    }
}
