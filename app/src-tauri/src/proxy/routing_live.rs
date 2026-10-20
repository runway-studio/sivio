//! Session-scoped, bounded routing telemetry. No headers, URLs, credentials or bodies.
use super::route_trace::{Candidate, Decision};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

const MAX_RECORDS: usize = 256;
const MAX_SCOPES: usize = 512;
fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
fn active(phase: &str) -> bool {
    matches!(phase, "selecting" | "connecting" | "streaming")
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub decision: Decision,
    pub phase: String,
    pub current_provider: Option<Candidate>,
    pub updated_at: i64,
    pub rerouted: bool,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub app: String,
    pub group_id: String,
    pub requests: u64,
    pub active: u64,
    pub rerouted: u64,
    pub completed: u64,
    pub failed: u64,
    pub interrupted: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub started_at: i64,
    pub now: i64,
    pub records: Vec<Record>,
    pub stats: Vec<Stats>,
    pub omitted: u64,
}
struct Inner {
    started_at: i64,
    records: Vec<Record>,
    stats: BTreeMap<(String, String), Stats>,
    omitted: u64,
}
pub struct Store(Mutex<Inner>);
impl Default for Store {
    fn default() -> Self {
        Self(Mutex::new(Inner {
            started_at: now(),
            records: vec![],
            stats: BTreeMap::new(),
            omitted: 0,
        }))
    }
}
fn scope(d: &Decision) -> (String, String) {
    (
        d.app.clone(),
        d.group.as_ref().map(|g| g.id.clone()).unwrap_or_default(),
    )
}
impl Store {
    pub fn snapshot(&self) -> Snapshot {
        let inner = self.0.lock().unwrap_or_else(|e| e.into_inner());
        Snapshot {
            started_at: inner.started_at,
            now: now(),
            records: inner.records.iter().rev().cloned().collect(),
            stats: inner.stats.values().cloned().collect(),
            omitted: inner.omitted,
        }
    }
    pub fn register(self: &Arc<Self>, decision: Decision) -> Option<Arc<Lease>> {
        // Only routing-group requests belong to this workspace.
        decision.group.as_ref()?;
        let mut inner = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let key = scope(&decision);
        if (!inner.stats.contains_key(&key) && inner.stats.len() >= MAX_SCOPES)
            || (inner.records.len() >= MAX_RECORDS
                && inner.records.iter().all(|r| active(&r.phase)))
        {
            inner.omitted += 1;
            return None;
        }
        if inner.records.len() >= MAX_RECORDS {
            let i = inner
                .records
                .iter()
                .position(|r| !active(&r.phase))
                .unwrap();
            inner.records.remove(i);
        }
        let stats = inner.stats.entry(key.clone()).or_insert_with(|| Stats {
            app: key.0,
            group_id: key.1,
            ..Stats::default()
        });
        stats.requests += 1;
        stats.active += 1;
        let id = decision.id.clone();
        inner.records.push(Record {
            decision,
            phase: "selecting".into(),
            current_provider: None,
            updated_at: now(),
            rerouted: false,
        });
        Some(Arc::new(Lease {
            store: self.clone(),
            id,
        }))
    }
    fn update(
        &self,
        id: &str,
        decision: Option<Decision>,
        phase: Option<&str>,
        provider: Option<Candidate>,
    ) {
        let mut inner = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let Some(record) = inner.records.iter_mut().find(|r| r.decision.id == id) else {
            return;
        };
        if !active(&record.phase) {
            return;
        }
        if let Some(d) = decision {
            record.decision = d;
        }
        let mut rerouted = false;
        if let Some(p) = provider {
            if !record.rerouted
                && record
                    .current_provider
                    .as_ref()
                    .is_some_and(|old| old.id != p.id)
            {
                record.rerouted = true;
                rerouted = true;
            }
            record.current_provider = Some(p);
        }
        record.updated_at = now();
        if let Some(phase) = phase {
            record.phase = phase.into();
        }
        let terminal = !active(&record.phase);
        let key = scope(&record.decision);
        let phase = record.phase.clone();
        if terminal {
            record.decision.elapsed_ms = record
                .updated_at
                .saturating_sub(record.decision.created_at)
                .max(0) as u64;
            if phase == "interrupted" {
                record.decision.body_state = "interrupted".into();
            }
        }
        let stats = inner.stats.get_mut(&key).unwrap();
        if rerouted {
            stats.rerouted += 1;
        }
        if terminal {
            stats.active = stats.active.saturating_sub(1);
            match phase.as_str() {
                "completed" => stats.completed += 1,
                "failed" => stats.failed += 1,
                _ => stats.interrupted += 1,
            }
        }
    }
}
pub struct Lease {
    store: Arc<Store>,
    id: String,
}
impl Lease {
    pub fn update(&self, decision: Decision, phase: Option<&str>, provider: Option<Candidate>) {
        self.store.update(&self.id, Some(decision), phase, provider);
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        self.store.update(&self.id, None, Some("interrupted"), None);
    }
}
/// Retry-After is an upstream advisory, never a local scheduler cooldown.
pub fn retry_at(value: &str, now_ms: i64) -> Option<i64> {
    let value = value.trim();
    let deadline = if let Ok(seconds) = value.parse::<u64>() {
        now_ms.checked_add(i64::try_from(seconds).ok()?.checked_mul(1000)?)?
    } else {
        chrono::DateTime::parse_from_rfc2822(value)
            .ok()?
            .timestamp_millis()
    };
    (deadline >= now_ms && deadline - now_ms <= 7 * 24 * 60 * 60 * 1000).then_some(deadline)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        database::Database,
        provider::Provider,
        proxy::{hyper_client::ProxyResponse, route_trace::Recorder, ProxyError},
        services::routing_groups::{Group, Member, Strategy},
    };
    use futures::StreamExt;
    fn provider(id: &str) -> Provider {
        Provider::with_id(id.into(), id.into(), serde_json::json!({}), None)
    }
    fn recorder(store: Arc<Store>, app: &str) -> Recorder {
        Recorder::new(
            Arc::new(Database::memory().unwrap()),
            app,
            "group-alias",
            "group_order",
            &[provider("a"), provider("b")],
        )
        .with_group(Some(Group {
            id: "same-id".into(),
            name: "Daily".into(),
            strategy: Strategy::Order,
            members: vec![
                Member {
                    provider_id: "a".into(),
                    model: "a-model".into(),
                },
                Member {
                    provider_id: "b".into(),
                    model: "b-model".into(),
                },
            ],
        }))
        .with_live(store)
    }
    #[test]
    fn routing_live_retry_after_validates_and_bounds_advisory() {
        let now = 1445412470000;
        assert_eq!(retry_at("35", now), Some(now + 35000));
        assert_eq!(
            retry_at("Wed, 21 Oct 2015 07:28:00 GMT", now),
            Some(now + 10000)
        );
        for v in [
            "-3",
            "NaN",
            "99999999999999999999999",
            "604801",
            "Wed, 21 Oct 2015 07:00:00 GMT",
        ] {
            assert!(retry_at(v, now).is_none());
        }
    }
    #[tokio::test]
    async fn routing_live_concurrent_failover_stream_and_drop_count_once() {
        let store = Arc::new(Store::default());
        let first = recorder(store.clone(), "claude");
        let second = recorder(store.clone(), "codex");
        first.note_dispatch(&provider("a"));
        first.note_retry_after(Some("35"));
        first.attempt(
            &provider("a"),
            Some("a-model"),
            "upstream_error",
            Some(429),
            12,
        );
        first.note_dispatch(&provider("b"));
        first.note_dispatch(&provider("b")); // same-member retries do not increment rerouting
        first.attempt(&provider("b"), Some("b-model"), "accepted", Some(200), 20);
        first.finish(None).await;
        let snapshot = store.snapshot();
        assert_eq!(snapshot.records.len(), 2);
        let stat = snapshot.stats.iter().find(|s| s.app == "claude").unwrap();
        assert_eq!(
            (stat.requests, stat.active, stat.rerouted, stat.completed),
            (1, 1, 1, 0)
        );
        assert_eq!(snapshot.records[1].phase, "streaming");
        assert!(snapshot.records[1].decision.attempts[0].retry_at.is_some());
        let response = first.observe_response(ProxyResponse::buffered(
            http::StatusCode::OK,
            http::HeaderMap::new(),
            bytes::Bytes::from_static(b"PRIVATE_BODY"),
        ));
        drop(first);
        assert_eq!(
            store.snapshot().stats[0].active,
            1,
            "body guard owns the live lease"
        );
        let mut body = response.bytes_stream();
        while let Some(chunk) = body.next().await {
            chunk.unwrap();
        }
        drop(body);
        drop(second);
        let snapshot = store.snapshot();
        let stat = snapshot.stats.iter().find(|s| s.app == "claude").unwrap();
        assert_eq!(
            (
                stat.requests,
                stat.active,
                stat.rerouted,
                stat.completed,
                stat.interrupted
            ),
            (1, 0, 1, 1, 0)
        );
        assert_eq!(
            snapshot
                .stats
                .iter()
                .find(|s| s.app == "codex")
                .unwrap()
                .interrupted,
            1
        );
        let raw = serde_json::to_string(&snapshot).unwrap();
        assert!(!raw.contains("PRIVATE_BODY"));
    }
    #[tokio::test]
    async fn routing_live_read_error_final_failure_and_cancellation_are_distinct() {
        let store = Arc::new(Store::default());
        let failed = recorder(store.clone(), "claude");
        failed
            .finish(Some(&ProxyError::Timeout("PRIVATE".into())))
            .await;
        failed
            .finish(Some(&ProxyError::Timeout("PRIVATE".into())))
            .await;
        drop(failed);
        let reading = recorder(store.clone(), "claude");
        reading.finish(None).await;
        let response = ProxyResponse::streamed(
            http::StatusCode::OK,
            http::HeaderMap::new(),
            futures::stream::iter([Err(std::io::Error::other("PRIVATE"))]),
        );
        let mut body = reading.observe_response(response).bytes_stream();
        while body.next().await.is_some() {}
        drop(body);
        drop(reading);
        let cancelled = recorder(store.clone(), "claude");
        cancelled.finish(None).await;
        let response = cancelled.observe_response(ProxyResponse::buffered(
            http::StatusCode::OK,
            http::HeaderMap::new(),
            bytes::Bytes::new(),
        ));
        drop(response);
        drop(cancelled);
        let snapshot = store.snapshot();
        let s = &snapshot.stats[0];
        assert_eq!(
            (s.requests, s.failed, s.interrupted, s.active),
            (3, 2, 1, 0)
        );
        assert!(!serde_json::to_string(&snapshot)
            .unwrap()
            .contains("PRIVATE"));
    }
    #[tokio::test]
    async fn routing_live_late_protocol_error_after_model_is_not_completed() {
        for payload in [
            r#"{"type":"error","error":{"message":"PRIVATE_ERROR"}}"#,
            r#"{"type":"response.failed","response":{"status":"failed"}}"#,
            r#"{"error":{"code":429,"message":"PRIVATE_ERROR"}}"#,
        ] {
            let store = Arc::new(Store::default());
            let recorder = recorder(store.clone(), "claude");
            recorder.finish(None).await;
            let bytes = format!("data: {{\"model\":\"reported\"}}\n\ndata: {payload}\n\n");
            let mut headers = http::HeaderMap::new();
            headers.insert(
                "content-type",
                http::HeaderValue::from_static("text/event-stream"),
            );
            let response = ProxyResponse::buffered(
                http::StatusCode::OK,
                headers,
                bytes::Bytes::from(bytes.clone()),
            );
            let mut stream = recorder.observe_response(response).bytes_stream();
            let mut out = Vec::new();
            while let Some(chunk) = stream.next().await {
                out.extend(chunk.unwrap());
            }
            assert_eq!(out, bytes.as_bytes());
            let snapshot = store.snapshot();
            assert_eq!(snapshot.records[0].phase, "failed");
            assert_eq!(snapshot.records[0].decision.body_state, "upstream_error");
            assert_eq!(
                snapshot.records[0].decision.response_model.as_deref(),
                Some("reported")
            );
            assert_eq!(
                (
                    snapshot.stats[0].failed,
                    snapshot.stats[0].completed,
                    snapshot.stats[0].active
                ),
                (1, 0, 0)
            );
            assert!(!serde_json::to_string(&snapshot)
                .unwrap()
                .contains("PRIVATE_ERROR"));
        }
    }

    #[test]
    fn routing_live_capacity_retains_active_and_counts_evicted_completed() {
        let store = Arc::new(Store::default());
        let d = recorder(Arc::new(Store::default()), "claude");
        drop(d);
        // Reuse one seed rather than create hundreds of databases.
        let seed_store = Arc::new(Store::default());
        let _seed = recorder(seed_store.clone(), "claude");
        let mut decision = seed_store.snapshot().records[0].decision.clone();
        let mut leases = vec![];
        for i in 0..MAX_RECORDS {
            decision.id = i.to_string();
            leases.push(store.register(decision.clone()).unwrap());
        }
        decision.id = "overflow".into();
        assert!(store.register(decision.clone()).is_none());
        assert_eq!(store.snapshot().omitted, 1);
        drop(leases.remove(0));
        assert!(store.register(decision.clone()).is_some());
        assert_eq!(store.snapshot().records.len(), MAX_RECORDS);
        assert_eq!(store.snapshot().stats[0].requests, MAX_RECORDS as u64 + 1);
        drop(leases);
        assert_eq!(store.snapshot().stats[0].active, 0);
    }
}
