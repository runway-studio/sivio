//! Bounded, metadata-only routing evidence. Never persist bodies, URLs or headers.
use super::{hyper_client::ProxyResponse, ProxyError};
use crate::{
    database::{lock_conn, Database},
    error::AppError,
    provider::Provider,
};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use std::time::Instant;

pub const TABLE_SQL: &str = "CREATE TABLE IF NOT EXISTS route_decisions (id TEXT PRIMARY KEY, app TEXT NOT NULL, created_at INTEGER NOT NULL, record TEXT NOT NULL); CREATE INDEX IF NOT EXISTS route_decisions_time ON route_decisions(created_at DESC);";
fn bounded(value: &str) -> String {
    value.chars().take(256).collect()
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub id: String,
    pub name: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attempt {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_at: Option<i64>,
    pub provider: Candidate,
    pub outbound_model: Option<String>,
    pub result: String,
    pub status: Option<u16>,
    pub elapsed_ms: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    pub id: String,
    pub app: String,
    pub created_at: i64,
    pub request_model: String,
    pub mode: String,
    #[serde(default)]
    pub group: Option<crate::services::routing_groups::Group>,
    #[serde(default)]
    pub selection: Option<crate::services::routing_groups::scheduler::Selection>,
    pub candidates: Vec<Candidate>,
    pub attempts: Vec<Attempt>,
    pub result: String,
    pub elapsed_ms: u64,
    pub response_model: Option<String>,
    pub body_state: String,
}
fn candidate(p: &Provider) -> Candidate {
    Candidate {
        id: bounded(&p.id),
        name: bounded(&p.name),
    }
}
pub fn error_kind(error: &ProxyError) -> (&'static str, Option<u16>) {
    match error {
        ProxyError::UpstreamError { status, .. } => ("upstream_error", Some(*status)),
        ProxyError::Timeout(_) | ProxyError::StreamIdleTimeout(_) => ("timeout", None),
        ProxyError::AuthError(_) => ("auth_error", None),
        ProxyError::ConfigError(_)
        | ProxyError::InvalidRequest(_)
        | ProxyError::TransformError(_) => ("config_error", None),
        ProxyError::AllProvidersCircuitOpen => ("circuit_open", None),
        ProxyError::NoProvidersConfigured | ProxyError::NoAvailableProvider => {
            ("no_provider", None)
        }
        _ => ("forward_error", None),
    }
}
impl Database {
    pub fn save_route_decision(&self, decision: &Decision) -> Result<(), AppError> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;
        let record =
            serde_json::to_string(decision).map_err(|e| AppError::Message(e.to_string()))?;
        tx.execute(
            "INSERT OR REPLACE INTO route_decisions(id,app,created_at,record) VALUES(?1,?2,?3,?4)",
            rusqlite::params![decision.id, decision.app, decision.created_at, record],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        tx.execute("DELETE FROM route_decisions WHERE id NOT IN (SELECT id FROM route_decisions ORDER BY created_at DESC, id DESC LIMIT 500)", []).map_err(|e| AppError::Database(e.to_string()))?;
        tx.commit().map_err(|e| AppError::Database(e.to_string()))
    }
    pub fn route_decisions(&self, app: Option<&str>) -> Result<Vec<Decision>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt=conn.prepare("SELECT record FROM route_decisions WHERE (?1 IS NULL OR app=?1) ORDER BY created_at DESC,id DESC LIMIT 200").map_err(|e|AppError::Database(e.to_string()))?;
        let rows = stmt
            .query_map([app], |row| row.get::<_, String>(0))
            .map_err(|e| AppError::Database(e.to_string()))?;
        rows.map(|row| {
            let raw = row.map_err(|e| AppError::Database(e.to_string()))?;
            serde_json::from_str(&raw).map_err(|e| AppError::Database(e.to_string()))
        })
        .collect()
    }
}
#[derive(Clone)]
pub struct Recorder {
    db: Arc<Database>,
    inner: Arc<Mutex<Decision>>,
    start: Instant,
    live: Option<Arc<super::routing_live::Lease>>,
    retry_at: Arc<Mutex<Option<i64>>>,
}
impl Recorder {
    pub fn new(
        db: Arc<Database>,
        app: &str,
        model: &str,
        mode: &str,
        providers: &[Provider],
    ) -> Self {
        Self {
            db,
            start: Instant::now(),
            live: None,
            retry_at: Arc::new(Mutex::new(None)),
            inner: Arc::new(Mutex::new(Decision {
                id: uuid::Uuid::new_v4().to_string(),
                app: app.into(),
                created_at: chrono::Utc::now().timestamp_millis(),
                request_model: bounded(model),
                mode: mode.into(),
                group: None,
                selection: None,
                candidates: providers.iter().take(100).map(candidate).collect(),
                attempts: vec![],
                result: "pending".into(),
                elapsed_ms: 0,
                response_model: None,
                body_state: "not_received".into(),
            })),
        }
    }
    pub fn with_group(self, group: Option<crate::services::routing_groups::Group>) -> Self {
        if let Ok(mut decision) = self.inner.lock() {
            decision.group = group;
        }
        self
    }
    pub fn with_selection(
        self,
        selection: Option<crate::services::routing_groups::scheduler::Selection>,
    ) -> Self {
        if let Ok(mut decision) = self.inner.lock() {
            decision.selection = selection;
        }
        self
    }
    pub fn with_live(mut self, store: Arc<super::routing_live::Store>) -> Self {
        if let Ok(d) = self.inner.lock() { self.live = store.register(d.clone()); }
        self
    }
    fn publish(&self, phase: Option<&str>, provider: Option<Candidate>) {
        if let (Some(live), Ok(d)) = (&self.live, self.inner.lock()) {
            live.update(d.clone(), phase, provider);
        }
    }
    pub fn note_retry_after(&self, value: Option<&str>) {
        if let Ok(mut at) = self.retry_at.lock() {
            *at = value.and_then(|v| super::routing_live::retry_at(v, chrono::Utc::now().timestamp_millis()));
        }
    }
    pub fn note_dispatch(&self, provider: &Provider) {
        self.publish(Some("connecting"), Some(candidate(provider)));
        let snapshot = self
            .inner
            .lock()
            .ok()
            .map(|d| (d.app.clone(), d.group.clone(), d.selection.clone()));
        if let Some((app, Some(group), Some(selection))) = snapshot {
            if selection
                .ranking
                .first()
                .is_some_and(|r| r.provider_id == provider.id)
            {
                return; // first choice was already reserved atomically
            }
            if let Err(error) = crate::services::routing_groups::scheduler::record_fallback(
                &self.db,
                &app,
                &group,
                &provider.id,
            ) {
                log::warn!("Could not record fallback dispatch: {error}");
            }
        }
    }
    pub fn attempt(
        &self,
        provider: &Provider,
        model: Option<&str>,
        result: &str,
        status: Option<u16>,
        elapsed: u64,
    ) {
        if let Ok(mut d) = self.inner.lock() {
            if d.attempts.len() < 100 {
                d.attempts.push(Attempt {
                    retry_at: self.retry_at.lock().ok().and_then(|mut v| v.take()),
                    provider: candidate(provider),
                    outbound_model: model.map(bounded),
                    result: result.into(),
                    status,
                    elapsed_ms: elapsed,
                });
            }
        }
        self.publish(None, None);
    }
    pub async fn finish(&self, error: Option<&ProxyError>) {
        if let Ok(mut d) = self.inner.lock() {
            d.result = error.map(|e| error_kind(e).0).unwrap_or("accepted").into();
            d.elapsed_ms = self.start.elapsed().as_millis() as u64;
        }
        self.publish(Some(if error.is_some() { "failed" } else { "streaming" }), None);
        self.persist().await;
    }
    async fn persist(&self) {
        let snapshot = self.inner.lock().ok().map(|d| d.clone());
        let db = self.db.clone();
        if let Some(snapshot) = snapshot {
            let _ = tokio::task::spawn_blocking(move || {
                if let Err(e) = db.save_route_decision(&snapshot) {
                    log::warn!("Unable to persist routing metadata: {e}");
                }
            })
            .await;
        }
    }
    fn body_finished(&self, state: &str, model: Option<String>) {
        if let Ok(mut d) = self.inner.lock() {
            d.body_state = state.into();
            d.elapsed_ms = self.start.elapsed().as_millis() as u64;
            d.response_model = model.map(|m| bounded(&m));
        }
        self.publish(Some(match state { "received" => "completed", "read_error" | "upstream_error" => "failed", _ => "interrupted" }), None);
        let this = self.clone();
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                this.persist().await;
            });
        }
    }
    pub fn observe_response(&self, response: ProxyResponse) -> ProxyResponse {
        let status = response.status();
        let headers = response.headers().clone();
        let sse = response.is_sse();
        let parse = headers.get("content-encoding").is_none();
        let mut guard = BodyGuard {
            recorder: self.clone(),
            done: false,
            model: None,
            upstream_failed: false,
        };
        let stream = async_stream::stream! {
            let stream=response.bytes_stream(); futures::pin_mut!(stream);
            let mut buffer=Vec::new(); let mut overflow=false; let mut failed=false;
            while let Some(chunk)=stream.next().await {
                if let Ok(bytes)=&chunk {
                    if parse {
                        if sse {
                            for byte in bytes.iter().copied() {
                                if byte==b'\n' {
                                    if !overflow { if let Some(data)=buffer.strip_prefix(b"data:") { guard.observe(data); } }
                                    buffer.clear();overflow=false;
                                } else if buffer.len()<65536 && !overflow { buffer.push(byte); } else { buffer.clear();overflow=true; }
                            }
                        } else if !overflow && buffer.len()+bytes.len()<=262144 { buffer.extend_from_slice(bytes); }
                        else { buffer.clear();overflow=true; }
                    }
                } else { failed=true; }
                yield chunk;
            }
            if parse && !overflow { guard.observe(if sse {buffer.strip_prefix(b"data:").unwrap_or(&buffer)} else {&buffer}); }
            guard.done=true;
            guard.recorder.body_finished(if failed {"read_error"} else if guard.upstream_failed {"upstream_error"} else {"received"},guard.model.take());
        };
        ProxyResponse::streamed(status, headers, stream)
    }
}
struct BodyGuard {
    recorder: Recorder,
    done: bool,
    model: Option<String>,
    upstream_failed: bool,
}
impl BodyGuard {
    fn observe(&mut self, bytes: &[u8]) {
        let Ok(value) = serde_json::from_slice::<Value>(bytes) else { return };
        if self.model.is_none() { self.model = reported_model_value(&value); }
        // Only protocol envelope fields are inspected. Do not inspect assistant content.
        self.upstream_failed |= matches!(value.get("type").and_then(Value::as_str), Some("error" | "response.failed"))
            || value.get("status").and_then(Value::as_str) == Some("failed")
            || value.pointer("/response/status").and_then(Value::as_str) == Some("failed")
            || value.get("error").is_some_and(|e| e.is_object() || e.as_str().is_some_and(|s| !s.is_empty()));
    }
}
impl Drop for BodyGuard {
    fn drop(&mut self) {
        if !self.done {
            self.recorder
                .body_finished(if self.upstream_failed { "upstream_error" } else { "interrupted" }, self.model.take());
        }
    }
}
fn reported_model_value(value: &Value) -> Option<String> {
    value
        .get("model")
        .or_else(|| value.pointer("/message/model"))
        .or_else(|| value.pointer("/response/model"))
        .or_else(|| value.get("modelVersion"))
        .and_then(Value::as_str)
        .map(bounded)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn routing_legacy_decision_without_strategy_or_selection_remains_readable() {
        let raw = serde_json::json!({
            "id":"old", "app":"claude", "createdAt":1, "requestModel":"group",
            "mode":"group_order", "group":{"id":"g", "name":"Daily",
                "members":[{"providerId":"a","model":"m"}]},
            "candidates":[], "attempts":[], "result":"accepted", "elapsedMs":1,
            "responseModel":null, "bodyState":"received"
        });
        let decision: Decision = serde_json::from_value(raw).unwrap();
        assert!(decision.selection.is_none());
        assert_eq!(decision.group.unwrap().strategy, crate::services::routing_groups::Strategy::Order);
    }
    #[test]
    fn route_trace_metadata_is_bounded_and_filters_by_client() {
        let db = Database::memory().unwrap();
        for n in 0..505 {
            let d = Decision {
                id: format!("id-{n}"),
                app: if n % 2 == 0 { "claude" } else { "codex" }.into(),
                created_at: n,
                request_model: "chosen".into(),
                mode: "route".into(),
                group: None,
                selection: None,
                candidates: vec![],
                attempts: vec![],
                result: "accepted".into(),
                elapsed_ms: 1,
                response_model: None,
                body_state: "received".into(),
            };
            db.save_route_decision(&d).unwrap();
        }
        let conn = db.conn.lock().unwrap();
        assert_eq!(
            conn.query_row("SELECT count(*) FROM route_decisions", [], |r| r
                .get::<_, u64>(0))
                .unwrap(),
            500
        );
        drop(conn);
        let rows = db.route_decisions(Some("codex")).unwrap();
        assert_eq!(rows.len(), 200);
        assert!(rows.iter().all(|d| d.app == "codex"));
        assert!(rows.windows(2).all(|w| w[0].created_at > w[1].created_at));
        let error = ProxyError::UpstreamError {
            status: 429,
            body: Some("SECRET_TOKEN prompt text".into()),
        };
        assert_eq!(error_kind(&error), ("upstream_error", Some(429)));
    }
    #[tokio::test]
    async fn route_trace_observer_preserves_split_sse_bytes_and_captures_model() {
        let db = Arc::new(Database::memory().unwrap());
        let recorder = Recorder::new(db.clone(), "claude", "selected", "route", &[]);
        recorder.finish(None).await;
        let chunks = [
            "data: {\"type\":\"message_start\",\"message\":{\"model\":\"rep",
            "orted\"}}\r\n\n",
            "data: [DONE]\n\n",
        ];
        let mut headers = http::HeaderMap::new();
        headers.insert(
            "content-type",
            http::HeaderValue::from_static("text/event-stream"),
        );
        let response = ProxyResponse::streamed(
            http::StatusCode::OK,
            headers,
            futures::stream::iter(chunks.map(|s| Ok(bytes::Bytes::from(s)))),
        );
        let mut stream = recorder.observe_response(response).bytes_stream();
        let mut out = Vec::new();
        while let Some(chunk) = stream.next().await {
            out.extend_from_slice(&chunk.unwrap());
        }
        assert_eq!(out.as_slice(), chunks.concat().as_bytes());
        for _ in 0..50 {
            if db.route_decisions(None).unwrap()[0].body_state == "received" {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        let d = db.route_decisions(None).unwrap().remove(0);
        assert_eq!(d.response_model.as_deref(), Some("reported"));
        assert_eq!(d.body_state, "received");
        let json = serde_json::to_string(&d).unwrap();
        assert!(!json.contains("message_start"));
    }
    #[tokio::test]
    async fn route_trace_dropped_body_is_interrupted() {
        let db = Arc::new(Database::memory().unwrap());
        let recorder = Recorder::new(db.clone(), "codex", "m", "route", &[]);
        recorder.finish(None).await;
        let response = ProxyResponse::buffered(
            http::StatusCode::OK,
            http::HeaderMap::new(),
            bytes::Bytes::from_static(b"private reply"),
        );
        drop(recorder.observe_response(response));
        for _ in 0..50 {
            if db.route_decisions(None).unwrap()[0].body_state == "interrupted" {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert_eq!(
            db.route_decisions(None).unwrap()[0].body_state,
            "interrupted"
        );
    }
}
