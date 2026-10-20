//! Device-local scheduling reservations. No prompts, credentials or provider URLs.
use super::{Group, Strategy};
use crate::{app_config::AppType, database::Database, provider::Provider};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const TABLE_SQL: &str = "CREATE TABLE IF NOT EXISTS routing_group_scheduler (app TEXT NOT NULL, group_id TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(app,group_id));";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ranking {
    pub provider_id: String,
    pub model: String,
    /// Before this request's reservation; includes previous failed dispatches.
    pub dispatches: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota: Option<super::quota::Evidence>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    pub strategy: Strategy,
    pub ranking: Vec<Ranking>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback_reason: Option<String>,
}
#[derive(Serialize, Deserialize)]
struct State {
    fingerprint: String,
    cursor: usize,
    counts: Vec<u64>,
}
fn fingerprint(group: &Group) -> String {
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&group.members).expect("members serialize"))
    )
}
fn read_state(conn: &rusqlite::Connection, app: &str, group: &Group) -> Result<State, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT state FROM routing_group_scheduler WHERE app=?1 AND group_id=?2",
            params![app, group.id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let state: Option<State> = raw
        .map(|s| serde_json::from_str(&s))
        .transpose()
        .map_err(|e| format!("Invalid routing counters: {e}"))?;
    let key = fingerprint(group);
    Ok(state
        .filter(|s| s.fingerprint == key && s.counts.len() == group.members.len())
        .unwrap_or(State {
            fingerprint: key,
            cursor: 0,
            counts: vec![0; group.members.len()],
        }))
}
fn save_state(
    conn: &rusqlite::Connection,
    app: &str,
    group: &Group,
    state: &State,
) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO routing_group_scheduler(app,group_id,state) VALUES(?1,?2,?3)",
        params![
            app,
            group.id,
            serde_json::to_string(state).map_err(|e| e.to_string())?
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn current_group(
    conn: &rusqlite::Connection,
    app: &str,
    group: &Group,
) -> Result<Option<Group>, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key=?1",
            [format!("routing_groups_{app}")],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let groups: Vec<Group> =
        serde_json::from_str(raw.as_deref().unwrap_or("[]")).map_err(|e| e.to_string())?;
    Ok(groups.into_iter().find(|g| g.id == group.id))
}

/// Atomically reserve a first choice, so concurrent requests cannot all pick
/// the same lowest counter. Requests retain the resulting immutable ordering.
pub fn select(
    db: &Database,
    app: &AppType,
    group: &Group,
    providers: Vec<Provider>,
) -> Result<(Vec<Provider>, Selection), String> {
    select_with_quota(db, app, group, providers, &[])
}
pub fn select_with_quota(
    db: &Database,
    app: &AppType,
    group: &Group,
    providers: Vec<Provider>,
    quotas: &[super::quota::Evidence],
) -> Result<(Vec<Provider>, Selection), String> {
    if providers.is_empty()
        || providers.len() != group.members.len()
        || providers
            .iter()
            .zip(&group.members)
            .any(|(p, m)| p.id != m.provider_id)
    {
        return Err("Invalid routing group candidates".into());
    }
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if current_group(&tx, app.as_str(), group)?.as_ref() != Some(group) {
        return Err("路由组配置已变化，请重试请求".into());
    }
    let mut state = read_state(&tx, app.as_str(), group)?;
    let mut indices: Vec<usize> = (0..providers.len()).collect();
    match group.strategy {
        Strategy::Smart | Strategy::Pace => {
            indices.sort_by(|&a, &b| {
                let category = |i: usize| match quotas.get(i).map(|q| q.status.as_str()) {
                    Some("ready") => 0,
                    Some("exhausted") => 2,
                    _ => 1,
                };
                category(a)
                    .cmp(&category(b))
                    .then_with(|| match (quotas.get(a), quotas.get(b)) {
                        (Some(aq), Some(bq)) if category(a) == 0 => {
                            if group.strategy == Strategy::Smart {
                                aq.resets_at.cmp(&bq.resets_at)
                            } else {
                                bq.pace_per_hour
                                    .unwrap_or(0.0)
                                    .total_cmp(&aq.pace_per_hour.unwrap_or(0.0))
                            }
                        }
                        _ => std::cmp::Ordering::Equal,
                    })
                    .then(a.cmp(&b))
            });
        }
        Strategy::Order => {}
        Strategy::Rotate => {
            indices.rotate_left(state.cursor % providers.len());
            state.cursor = (state.cursor % providers.len() + 1) % providers.len();
        }
        Strategy::Usage => indices.sort_by_key(|&i| (state.counts[i], i)),
    }
    let selection = Selection {
        strategy: group.strategy,
        fallback_reason: (matches!(group.strategy, Strategy::Smart | Strategy::Pace)
            && !quotas.iter().any(|q| q.status == "ready"))
        .then(|| "no_usable_quota".into()),
        ranking: indices
            .iter()
            .map(|&i| Ranking {
                provider_id: group.members[i].provider_id.clone(),
                model: group.members[i].model.clone(),
                dispatches: state.counts[i],
                quota: quotas.get(i).cloned(),
            })
            .collect(),
    };
    state.counts[indices[0]] = state.counts[indices[0]].saturating_add(1);
    save_state(&tx, app.as_str(), group, &state)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok((
        indices.into_iter().map(|i| providers[i].clone()).collect(),
        selection,
    ))
}

/// Called once per fallback dispatch, not per response chunk or rectifier retry.
/// A late response from an older membership must not reset newer counters.
pub fn record_fallback(
    db: &Database,
    app: &str,
    group: &Group,
    provider_id: &str,
) -> Result<(), String> {
    let Some(index) = group
        .members
        .iter()
        .position(|m| m.provider_id == provider_id)
    else {
        return Ok(());
    };
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if !current_group(&tx, app, group)?.is_some_and(|g| g.members == group.members) {
        return Ok(());
    }
    let mut state = read_state(&tx, app, group)?;
    state.counts[index] = state.counts[index].saturating_add(1);
    save_state(&tx, app, group, &state)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::routing_groups::Member;
    fn group(strategy: Strategy) -> Group {
        Group {
            id: "group".into(),
            name: "Daily".into(),
            strategy,
            members: ["a", "b", "c"]
                .into_iter()
                .map(|id| Member {
                    provider_id: id.into(),
                    model: format!("model-{id}"),
                })
                .collect(),
        }
    }
    fn save(db: &Database, app: &AppType, g: &Group) {
        db.set_setting(
            &format!("routing_groups_{}", app.as_str()),
            &serde_json::to_string(&vec![g]).unwrap(),
        )
        .unwrap();
    }
    fn choose(db: &Database, app: &AppType, g: &Group) -> Selection {
        let providers = g
            .members
            .iter()
            .map(|m| {
                Provider::with_id(
                    m.provider_id.clone(),
                    m.provider_id.clone(),
                    serde_json::json!({}),
                    None,
                )
            })
            .collect();
        select(db, app, g, providers).unwrap().1
    }
    #[test]
    fn legacy_groups_default_to_order_and_unknown_strategies_fail() {
        let raw = r#"{"id":"old","name":"Old","members":[{"providerId":"a","model":"model-a"}]}"#;
        let legacy: Group = serde_json::from_str(raw).unwrap();
        assert_eq!(legacy.strategy, Strategy::Order);
        assert!(serde_json::from_str::<Group>(
            &raw.replace("\"id\":", "\"strategy\":\"unsupported\",\"id\":")
        )
        .is_err());
    }
    #[test]
    fn rotate_persists_across_database_reopen_and_isolates_clients() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("schedule.db");
        let open = || {
            let db = Database::memory().unwrap();
            *db.conn.lock().unwrap() = rusqlite::Connection::open(&path).unwrap();
            db.create_tables().unwrap();
            db
        };
        let g = group(Strategy::Rotate);
        {
            let db = open();
            save(&db, &AppType::Claude, &g);
            assert_eq!(
                choose(&db, &AppType::Claude, &g).ranking[0].provider_id,
                "a"
            );
        }
        let db = open();
        assert_eq!(
            choose(&db, &AppType::Claude, &g).ranking[0].provider_id,
            "b"
        );
        save(&db, &AppType::Codex, &g);
        assert_eq!(choose(&db, &AppType::Codex, &g).ranking[0].provider_id, "a");
        assert_eq!(
            choose(&db, &AppType::Claude, &g).ranking[0].provider_id,
            "c"
        );
        assert_eq!(
            choose(&db, &AppType::Claude, &g).ranking[0].provider_id,
            "a"
        );
    }
    #[test]
    fn concurrent_reservations_balance_both_strategies() {
        for strategy in [Strategy::Rotate, Strategy::Usage] {
            let db = std::sync::Arc::new(Database::memory().unwrap());
            let g = group(strategy);
            save(&db, &AppType::Claude, &g);
            let handles: Vec<_> = (0..30)
                .map(|_| {
                    let db = db.clone();
                    let g = g.clone();
                    std::thread::spawn(move || {
                        choose(&db, &AppType::Claude, &g).ranking[0]
                            .provider_id
                            .clone()
                    })
                })
                .collect();
            let selected: Vec<_> = handles.into_iter().map(|t| t.join().unwrap()).collect();
            for id in ["a", "b", "c"] {
                assert_eq!(selected.iter().filter(|v| v.as_str() == id).count(), 10);
            }
        }
    }
    #[test]
    fn usage_counts_fallbacks_and_retains_state_on_rename_and_strategy_change() {
        let db = Database::memory().unwrap();
        let mut g = group(Strategy::Order);
        save(&db, &AppType::Claude, &g);
        choose(&db, &AppType::Claude, &g);
        record_fallback(&db, "claude", &g, "b").unwrap();
        g.strategy = Strategy::Usage;
        g.name = "Renamed".into();
        save(&db, &AppType::Claude, &g);
        let picked = choose(&db, &AppType::Claude, &g);
        assert_eq!(
            picked
                .ranking
                .iter()
                .map(|r| (r.provider_id.as_str(), r.dispatches))
                .collect::<Vec<_>>(),
            vec![("c", 0), ("a", 1), ("b", 1)]
        );
        assert_eq!(
            choose(&db, &AppType::Claude, &g).ranking[0].provider_id,
            "a"
        );
    }
    #[test]
    fn member_changes_reset_and_old_requests_cannot_contaminate_counters() {
        let db = Database::memory().unwrap();
        let g = group(Strategy::Rotate);
        save(&db, &AppType::Claude, &g);
        choose(&db, &AppType::Claude, &g);
        let mut edited = g.clone();
        edited.members[0].model = "new-model".into();
        save(&db, &AppType::Claude, &edited);
        assert_eq!(
            choose(&db, &AppType::Claude, &edited).ranking[0].dispatches,
            0
        );
        record_fallback(&db, "claude", &g, "b").unwrap();
        let next = choose(&db, &AppType::Claude, &edited);
        assert_eq!(next.ranking[0].provider_id, "b");
        assert_eq!(next.ranking[0].dispatches, 0);
        let providers = g
            .members
            .iter()
            .map(|m| {
                Provider::with_id(
                    m.provider_id.clone(),
                    "".into(),
                    serde_json::json!({}),
                    None,
                )
            })
            .collect();
        assert!(select(&db, &AppType::Claude, &g, providers).is_err());
        db.set_setting("routing_groups_claude", "[]").unwrap();
        record_fallback(&db, "claude", &edited, "b").unwrap();
    }
    #[test]
    fn smart_pace_rank_quota_then_unknown_then_exhausted_and_explain_fallback() {
        let db = Database::memory().unwrap();
        let providers = || {
            ["a", "b", "c"]
                .into_iter()
                .map(|id| Provider::with_id(id.into(), id.into(), serde_json::json!({}), None))
                .collect()
        };
        let evidence = |status: &str, reset: i64, pace: f64| super::super::quota::Evidence {
            source: "kimi".into(),
            status: status.into(),
            window: Some("weekly_limit".into()),
            queried_at: Some(1),
            remaining_percent: Some(40.0),
            resets_at: Some(reset),
            pace_per_hour: Some(pace),
        };
        for strategy in [Strategy::Smart, Strategy::Pace] {
            let g = group(strategy);
            save(&db, &AppType::Claude, &g);
            let quotas = vec![
                evidence("ready", 30, 1.0),
                evidence("ready", 10, 4.0),
                evidence("unsupported", 0, 0.0),
            ];
            let (ordered, selection) =
                select_with_quota(&db, &AppType::Claude, &g, providers(), &quotas).unwrap();
            assert_eq!(
                ordered.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(),
                vec!["b", "a", "c"]
            );
            assert!(selection.fallback_reason.is_none());
            assert_eq!(
                selection.ranking[0].quota.as_ref().unwrap().resets_at,
                Some(10)
            );
            let quotas = vec![
                evidence("exhausted", 10, 0.0),
                evidence("missing_weekly", 30, 0.0),
                evidence("unsupported", 0, 0.0),
            ];
            let (ordered, selection) =
                select_with_quota(&db, &AppType::Claude, &g, providers(), &quotas).unwrap();
            assert_eq!(
                ordered.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(),
                vec!["b", "c", "a"]
            );
            assert_eq!(
                selection.fallback_reason.as_deref(),
                Some("no_usable_quota")
            );
            let (_, selection) =
                select_with_quota(&db, &AppType::Claude, &g, providers(), &[]).unwrap();
            assert_eq!(selection.ranking[0].provider_id, "a");
            assert!(selection.fallback_reason.is_some());
        }
        let g = group(Strategy::Pace);
        save(&db, &AppType::Claude, &g);
        let quotas = vec![
            evidence("ready", 10, 1.0),
            evidence("ready", 30, 4.0),
            evidence("ready", 10, 4.0),
        ];
        let (ordered, _) =
            select_with_quota(&db, &AppType::Claude, &g, providers(), &quotas).unwrap();
        assert_eq!(
            ordered.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(),
            vec!["b", "c", "a"]
        );
    }
}
