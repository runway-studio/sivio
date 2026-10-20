//! Member-bound quota snapshots. No credentials, account identifiers or URLs in evidence.
use crate::{app_config::AppType, provider::Provider, services::subscription::SubscriptionQuota};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    future::Future,
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::Manager;
use tokio::sync::Mutex;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub source: String,
    pub status: String,
    pub window: Option<String>,
    pub queried_at: Option<i64>,
    pub remaining_percent: Option<f64>,
    pub resets_at: Option<i64>,
    pub pace_per_hour: Option<f64>,
}
impl Evidence {
    fn unavailable(source: &str, status: &str) -> Self {
        Self {
            source: source.into(),
            status: status.into(),
            window: None,
            queried_at: None,
            remaining_percent: None,
            resets_at: None,
            pace_per_hour: None,
        }
    }
}
#[derive(Clone)]
struct Snapshot {
    source: String,
    quota: Option<SubscriptionQuota>,
    status: String,
}
impl Snapshot {
    fn error(source: &str, status: &str) -> Self {
        Self {
            source: source.into(),
            quota: None,
            status: status.into(),
        }
    }
}
struct Entry {
    at: Instant,
    snapshot: Snapshot,
}
type Slot = Arc<Mutex<Option<Entry>>>;
#[cfg(test)]
#[derive(Clone)]
enum Fixture {
    Endpoint(String, String),
}
#[derive(Default)]
pub struct Cache {
    entries: Mutex<HashMap<String, Slot>>,
    #[cfg(test)]
    fixtures: Mutex<HashMap<String, Fixture>>,
}
pub fn fingerprint(app: &AppType, provider: &Provider) -> String {
    // Model projections are intentionally excluded: one account's limits apply
    // across that provider's groups. Actual credentials and metadata stay in memory.
    let default_meta = crate::provider::ProviderMeta::default();
    let meta = provider.meta.as_ref().unwrap_or(&default_meta);
    // Runtime endpoint timestamps and unordered metadata maps are not identity.
    // Hash only fields that affect which credential/account is queried.
    let bytes = serde_json::to_vec(&(
        app.as_str(),
        &provider.id,
        provider.resolve_usage_credentials(app),
        &meta.provider_type,
        &meta.auth_binding,
        &meta.usage_script,
    ))
    .expect("provider serializes");
    format!("{:x}", Sha256::digest(bytes))
}
impl Cache {
    async fn get<F, Fut>(&self, key: String, source: &str, fetch: F) -> Snapshot
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<SubscriptionQuota, String>>,
    {
        let slot = {
            let mut entries = self.entries.lock().await;
            if !entries.contains_key(&key) && entries.len() >= 256 {
                entries.clear();
            }
            entries.entry(key).or_default().clone()
        };
        // Includes waiting for another request's refresh; never hold SQLite here.
        tokio::time::timeout(Duration::from_secs(3), async {
            let mut entry = slot.lock().await;
            if let Some(cached) = entry.as_ref() {
                let ttl = if cached.snapshot.quota.as_ref().is_some_and(|q| q.success) {
                    60
                } else {
                    15
                };
                let crossed_reset = cached.snapshot.quota.as_ref().is_some_and(|q| {
                    q.tiers.iter().any(|t| {
                        t.resets_at
                            .as_deref()
                            .and_then(parse_reset)
                            .is_some_and(|r| {
                                r > q.queried_at.unwrap_or(0)
                                    && r <= chrono::Utc::now().timestamp_millis()
                            })
                    })
                });
                if cached.at.elapsed() < Duration::from_secs(ttl) && !crossed_reset {
                    return cached.snapshot.clone();
                }
            }
            let snapshot = match tokio::time::timeout(Duration::from_millis(2500), fetch()).await {
                Ok(Ok(quota)) => Snapshot {
                    source: source.into(),
                    quota: Some(quota),
                    status: "ready".into(),
                },
                Ok(Err(_)) => Snapshot::error(source, "unavailable"),
                Err(_) => Snapshot::error(source, "timeout"),
            };
            *entry = Some(Entry {
                at: Instant::now(),
                snapshot: snapshot.clone(),
            });
            snapshot
        })
        .await
        .unwrap_or_else(|_| Snapshot::error(source, "timeout"))
    }
    #[cfg(test)]
    pub(crate) async fn test_endpoint(
        &self,
        app: &AppType,
        provider: &Provider,
        url: String,
        key: String,
    ) {
        self.fixtures
            .lock()
            .await
            .insert(fingerprint(app, provider), Fixture::Endpoint(url, key));
    }
}
fn parse_reset(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|v| v.timestamp_millis())
}
fn native_source(base: &str) -> Option<&'static str> {
    let url = url::Url::parse(base).ok()?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|p| p != 443)
    {
        return None;
    }
    // Do not send an inference key to a vendor detected through a substring in
    // an unrelated relay URL. Separate control-plane account credentials are not proven bindings.
    if !matches!(
        url.host_str()?,
        "api.kimi.com"
            | "open.bigmodel.cn"
            | "api.z.ai"
            | "api.minimaxi.com"
            | "api.minimax.cn"
            | "api.minimax.io"
            | "zenmux.ai"
            | "opencode.ai"
            | "api.commandcode.ai"
    ) {
        return None;
    }
    crate::services::coding_plan::detect_provider_id(base)
}
async fn collect_one(
    cache: &Cache,
    app: &AppType,
    provider: &Provider,
    handle: Option<&tauri::AppHandle>,
) -> Snapshot {
    let key = fingerprint(app, provider);
    #[cfg(test)]
    {
        let fixture = cache.fixtures.lock().await.get(&key).cloned();
        if let Some(fixture) = fixture {
            return match fixture {
                Fixture::Endpoint(base, api_key) => {
                    cache
                        .get(key, "zenmux", || async {
                            crate::services::coding_plan::get_routing_plan_quota(&base, &api_key)
                                .await
                        })
                        .await
                }
            };
        }
    }
    if provider.is_codex_oauth() {
        let Some(id) = provider
            .meta
            .as_ref()
            .and_then(|m| m.managed_account_id_for("codex_oauth"))
            .filter(|id| !id.trim().is_empty())
        else {
            return Snapshot::error("codex_oauth", "unbound_account");
        };
        let Some(manager) = handle
            .and_then(|h| h.try_state::<crate::commands::CodexOAuthState>())
            .map(|state| state.0.clone())
        else {
            return Snapshot::error("codex_oauth", "unavailable");
        };
        let Some(account) = manager
            .list_accounts()
            .await
            .into_iter()
            .find(|a| a.id == id && !a.reauth_required)
        else {
            return Snapshot::error("codex_oauth", "unavailable");
        };
        let Ok(workspace) = manager.chatgpt_account_id_for_account(&id).await else {
            return Snapshot::error("codex_oauth", "unavailable");
        };
        let identity = format!(
            "{:x}",
            Sha256::digest(format!(
                "{key}:{}:{}:{workspace}",
                account.authenticated_at, account.login
            ))
        );
        let snapshot = cache
            .get(identity, "codex_oauth", || async {
                crate::commands::query_codex_oauth_quota_for(&manager, &id).await
            })
            .await;
        let unchanged = manager.list_accounts().await.into_iter().any(|a| {
            a.id == id
                && a.authenticated_at == account.authenticated_at
                && a.login == account.login
                && !a.reauth_required
        }) && manager
            .chatgpt_account_id_for_account(&id)
            .await
            .ok()
            .as_ref()
            == Some(&workspace);
        return if unchanged {
            snapshot
        } else {
            Snapshot::error("codex_oauth", "changed_binding")
        };
    }
    let (base, key_value) = provider.resolve_usage_credentials(app);
    let Some(source) = native_source(&base) else {
        return Snapshot::error("none", "unsupported");
    };
    let script = provider.meta.as_ref().and_then(|m| m.usage_script.as_ref());
    // An explicitly configured usage account that differs from inference is not evidence for this member.
    if script.is_some_and(|s| {
        s.api_key
            .as_deref()
            .is_some_and(|k| !k.trim().is_empty() && k.trim() != key_value)
            || s.base_url.as_deref().is_some_and(|b| {
                !b.trim().is_empty() && b.trim().trim_end_matches('/') != base.trim_end_matches('/')
            })
    }) {
        return Snapshot::error(source, "changed_binding");
    }
    if script.and_then(|s| s.coding_plan_provider.as_deref()) == Some("zhipu_team") {
        return Snapshot::error(source, "unsupported");
    }
    cache
        .get(key, source, || async {
            crate::services::coding_plan::get_routing_plan_quota(&base, &key_value).await
        })
        .await
}
/// Fetch at most ten members concurrently, each with a three-second budget.
pub async fn collect(
    cache: &Cache,
    app: &AppType,
    providers: &[Provider],
    strategy: super::Strategy,
    handle: Option<&tauri::AppHandle>,
) -> Vec<Evidence> {
    futures::future::join_all(providers.iter().map(|p| async {
        let snapshot = collect_one(cache, app, p, handle).await;
        assess(&snapshot, strategy, chrono::Utc::now().timestamp_millis())
    }))
    .await
}
fn assess(snapshot: &Snapshot, strategy: super::Strategy, now: i64) -> Evidence {
    let mut out = Evidence::unavailable(&snapshot.source, &snapshot.status);
    let Some(quota) = &snapshot.quota else {
        return out;
    };
    out.queried_at = quota.queried_at;
    if !quota.success
        || !matches!(
            quota.credential_status,
            crate::services::subscription::CredentialStatus::Valid
        )
    {
        out.status = "unavailable".into();
        return out;
    }
    if !quota
        .queried_at
        .is_some_and(|t| t <= now && now.saturating_sub(t) <= 300_000)
    {
        out.status = "stale".into();
        return out;
    }
    if quota.tiers.is_empty() {
        out.status = "missing_window".into();
        return out;
    }
    let mut windows = Vec::new();
    let mut exhausted = false;
    for tier in &quota.tiers {
        if !tier.utilization.is_finite() || !(0.0..=100.0).contains(&tier.utilization) {
            out.status = "invalid".into();
            return out;
        }
        let reset = tier.resets_at.as_deref().and_then(parse_reset);
        if reset.is_some_and(|r| r <= now) {
            out.status = "stale".into();
            return out;
        }
        exhausted |= tier.utilization >= 100.0;
        if let Some(reset) = reset {
            windows.push((tier.name.as_str(), 100.0 - tier.utilization, reset));
        }
    }
    if exhausted {
        out.status = "exhausted".into();
        out.remaining_percent = Some(0.0);
        out.resets_at = windows.iter().map(|w| w.2).max();
        return out;
    }
    let chosen = if strategy == super::Strategy::Pace {
        windows
            .iter()
            .filter(|w| matches!(w.0, "seven_day" | "weekly_limit" | "weekly" | "7_day"))
            .min_by(|a, b| pace(a.1, a.2, now).total_cmp(&pace(b.1, b.2, now)))
    } else {
        windows.iter().min_by_key(|w| w.2)
    };
    if let Some((window, remaining, reset)) = chosen {
        out.window = Some((*window).into());
        out.status = "ready".into();
        out.remaining_percent = Some(*remaining);
        out.resets_at = Some(*reset);
        if strategy == super::Strategy::Pace {
            out.pace_per_hour = Some(pace(*remaining, *reset, now));
        }
    } else {
        out.status = if strategy == super::Strategy::Pace {
            "missing_weekly"
        } else {
            "missing_reset"
        }
        .into();
    }
    out
}
fn pace(remaining: f64, reset: i64, now: i64) -> f64 {
    remaining / ((reset.saturating_sub(now) as f64 / 3_600_000.0).max(1.0 / 60.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::{
        routing_groups::Strategy,
        subscription::{CredentialStatus, QuotaTier},
    };
    use std::sync::atomic::{AtomicUsize, Ordering};
    const NOW: i64 = 1_792_490_000_000;
    fn sample(tiers: &[(&str, f64, Option<i64>)]) -> Snapshot {
        Snapshot {
            source: "kimi".into(),
            status: "ready".into(),
            quota: Some(SubscriptionQuota {
                tool: "coding_plan".into(),
                credential_status: CredentialStatus::Valid,
                credential_message: None,
                success: true,
                tiers: tiers
                    .iter()
                    .map(|(name, used, reset)| QuotaTier {
                        name: (*name).into(),
                        utilization: *used,
                        resets_at: reset.map(|r| {
                            chrono::DateTime::from_timestamp_millis(r)
                                .unwrap()
                                .to_rfc3339()
                        }),
                        used_value_usd: None,
                        max_value_usd: None,
                    })
                    .collect(),
                extra_usage: None,
                reset_credits: None,
                credits_balance: None,
                error: None,
                queried_at: Some(NOW),
            }),
        }
    }
    #[test]
    fn smart_pace_scores_real_windows_and_rejects_unusable_snapshots() {
        let valid = sample(&[
            ("five_hour", 20.0, Some(NOW + 3_600_000)),
            ("weekly_limit", 50.0, Some(NOW + 36_000_000)),
        ]);
        let smart = assess(&valid, Strategy::Smart, NOW);
        assert_eq!(smart.remaining_percent, Some(80.0));
        assert_eq!(smart.window.as_deref(), Some("five_hour"));
        let pace = assess(&valid, Strategy::Pace, NOW);
        assert_eq!(pace.pace_per_hour, Some(5.0));
        for (snapshot, expected) in [
            (sample(&[("five_hour", 101.0, Some(NOW + 1000))]), "invalid"),
            (
                sample(&[("five_hour", f64::NAN, Some(NOW + 1000))]),
                "invalid",
            ),
            (sample(&[("weekly_limit", 1.0, Some(NOW))]), "stale"),
            (
                sample(&[
                    ("five_hour", 100.0, None),
                    ("weekly_limit", 10.0, Some(NOW + 1000)),
                ]),
                "exhausted",
            ),
            (
                sample(&[("five_hour", 1.0, Some(NOW + 1000))]),
                "missing_weekly",
            ),
            (sample(&[("weekly_limit", 0.0, None)]), "missing_weekly"),
            (sample(&[]), "missing_window"),
        ] {
            assert_eq!(assess(&snapshot, Strategy::Pace, NOW).status, expected);
        }
        let mut old = valid.clone();
        old.quota.as_mut().unwrap().queried_at = Some(NOW - 300_001);
        assert_eq!(assess(&old, Strategy::Smart, NOW).status, "stale");
        old.quota.as_mut().unwrap().queried_at = Some(NOW + 1);
        assert_eq!(assess(&old, Strategy::Smart, NOW).status, "stale");
        assert_eq!(
            assess(&sample(&[("five_hour", 0.0, None)]), Strategy::Smart, NOW).status,
            "missing_reset"
        );
        assert_eq!(
            assess(
                &sample(&[("weekly_limit", 99.0, Some(NOW + 1))]),
                Strategy::Pace,
                NOW
            )
            .pace_per_hour,
            Some(60.0)
        );
        let multiple = sample(&[
            ("weekly_limit", 50.0, Some(NOW + 36_000_000)),
            ("seven_day", 10.0, Some(NOW + 3_600_000)),
        ]);
        assert_eq!(
            assess(&multiple, Strategy::Pace, NOW).pace_per_hour,
            Some(5.0)
        );
    }
    #[tokio::test]
    async fn quota_cache_coalesces_concurrent_queries_and_caches_failures() {
        let cache = Cache::default();
        let calls = AtomicUsize::new(0);
        let outcomes = futures::future::join_all((0..20).map(|_| {
            cache.get("member".into(), "kimi", || async {
                calls.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(20)).await;
                Ok(sample(&[]).quota.unwrap())
            })
        }))
        .await;
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(outcomes.len(), 20);
        for _ in 0..2 {
            cache
                .get("failure".into(), "kimi", || async {
                    calls.fetch_add(1, Ordering::SeqCst);
                    Err("SECRET_ERROR".into())
                })
                .await;
        }
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        let snapshot = cache
            .get("failure".into(), "kimi", || async {
                panic!("negative cache missing")
            })
            .await;
        assert!(
            !serde_json::to_string(&assess(&snapshot, Strategy::Smart, NOW))
                .unwrap()
                .contains("SECRET")
        );
    }
    #[tokio::test]
    async fn quota_cache_times_out_and_refreshes_at_reset_and_ttl() {
        let cache = Cache::default();
        let calls = AtomicUsize::new(0);
        let timed = cache
            .get("slow".into(), "kimi", || async {
                tokio::time::sleep(Duration::from_secs(10)).await;
                unreachable!()
            })
            .await;
        assert_eq!(timed.status, "timeout");
        assert_eq!(
            cache
                .get("slow".into(), "kimi", || async {
                    panic!("timeout must be cached")
                })
                .await
                .status,
            "timeout"
        );
        let snapshot = sample(&[("five_hour", 10.0, Some(NOW + 1000))]);
        let slot = Arc::new(Mutex::new(Some(Entry {
            at: Instant::now(),
            snapshot,
        })));
        cache
            .entries
            .lock()
            .await
            .insert("reset".into(), slot.clone());
        cache
            .get("reset".into(), "kimi", || async {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok(sample(&[]).quota.unwrap())
            })
            .await;
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        slot.lock().await.as_mut().unwrap().at = Instant::now() - Duration::from_secs(61);
        cache
            .get("reset".into(), "kimi", || async {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok(sample(&[]).quota.unwrap())
            })
            .await;
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }
    #[test]
    fn quota_binding_fingerprints_and_native_hosts_are_isolated() {
        let mut p = Provider::with_id(
            "a".into(),
            "a".into(),
            serde_json::json!({"env":{"ANTHROPIC_BASE_URL":"https://api.kimi.com/coding","ANTHROPIC_AUTH_TOKEN":"key-a"}}),
            None,
        );
        let key = fingerprint(&AppType::Claude, &p);
        p.meta = Some(crate::provider::ProviderMeta::default());
        assert_eq!(key, fingerprint(&AppType::Claude, &p));
        p.meta.as_mut().unwrap().custom_endpoints.insert(
            "endpoint".into(),
            crate::settings::CustomEndpoint {
                url: "https://api.kimi.com/coding".into(),
                added_at: 1,
                last_used: Some(2),
            },
        );
        assert_eq!(
            key,
            fingerprint(&AppType::Claude, &p),
            "unrelated runtime metadata must not invalidate quota identity"
        );
        assert_ne!(key, fingerprint(&AppType::Codex, &p));
        p.settings_config["env"]["ANTHROPIC_AUTH_TOKEN"] = serde_json::json!("key-b");
        assert_ne!(key, fingerprint(&AppType::Claude, &p));
        assert_eq!(
            native_source("https://api.kimi.com/coding/v1"),
            Some("kimi")
        );
        for base in [
            "http://api.kimi.com/coding",
            "https://evil.test/api.kimi.com/coding",
            "https://api.kimi.com.evil.test/coding",
            "https://user:pass@api.kimi.com/coding",
            "https://api.kimi.com:9999/coding",
            "https://ark.cn-beijing.volces.com/api/plan",
        ] {
            assert!(native_source(base).is_none(), "{base}");
        }
    }
    #[tokio::test]
    async fn quota_collection_does_not_borrow_unbound_or_app_wide_accounts() {
        let mut p = Provider::with_id("a".into(), "a".into(), serde_json::json!({}), None);
        p.meta = Some(
            serde_json::from_value(serde_json::json!({"providerType":"codex_oauth"})).unwrap(),
        );
        let data = collect(
            &Cache::default(),
            &AppType::Claude,
            &[p],
            Strategy::Smart,
            None,
        )
        .await;
        assert_eq!(data[0].status, "unbound_account");
    }
}
