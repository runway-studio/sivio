use super::media::{self, UnlockItem};
use anyhow::{ensure, Result};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
pub(super) struct MediaJob {
    id: String,
    results: Arc<Mutex<Vec<UnlockItem>>>,
    done: Arc<AtomicBool>,
    cancelled: bool,
    task: Option<tokio::task::JoinHandle<()>>,
}
impl MediaJob {
    pub fn start(port: u16, only: Option<String>) -> Result<Self> {
        let items = media::default_unlock_items();
        if let Some(name) = &only {
            ensure!(
                items.iter().any(|item| &item.name == name),
                "unknown media check"
            );
        }
        let results = Arc::new(Mutex::new(
            items
                .into_iter()
                .filter(|item| only.as_ref().is_none_or(|name| &item.name == name))
                .collect::<Vec<_>>(),
        ));
        let client = reqwest::Client::builder()
            .no_proxy()
            .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{port}"))?)
            .timeout(std::time::Duration::from_secs(15))
            .connect_timeout(std::time::Duration::from_secs(5))
            .user_agent("Mozilla/5.0 Sivio/0.1")
            .build()?;
        let done = Arc::new(AtomicBool::new(false));
        let finished = done.clone();
        let output = results.clone();
        let task = tokio::spawn(async move {
            let save = |item: &UnlockItem| {
                let mut rows = output.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(row) = rows.iter_mut().find(|row| row.name == item.name) {
                    *row = item.clone();
                }
            };
            if let Some(name) = only {
                if let Ok(item) = media::check_media_unlock_item(&client, &name).await {
                    save(&item);
                }
            } else {
                media::check_media_unlock(&client, save).await;
            }
            for item in output.lock().unwrap_or_else(|e| e.into_inner()).iter_mut() {
                if item.status == "Pending" {
                    item.status = "Failed (probe did not complete)".into();
                }
            }
            finished.store(true, Ordering::Release);
        });
        Ok(Self {
            id: uuid::Uuid::new_v4().to_string(),
            results,
            done,
            cancelled: false,
            task: Some(task),
        })
    }
    pub fn cancel(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
        if !self.done.load(Ordering::Acquire) {
            self.cancelled = true;
            for item in self
                .results
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .iter_mut()
            {
                if item.status == "Pending" {
                    item.status = "Cancelled".into();
                }
            }
        }
        self.done.store(true, Ordering::Release);
    }
    pub fn snapshot(&self) -> serde_json::Value {
        serde_json::json!({"id":self.id,"finished":self.done.load(Ordering::Acquire),"cancelled":self.cancelled,"items":self.results.lock().unwrap_or_else(|e|e.into_inner()).clone()})
    }
}
impl Drop for MediaJob {
    fn drop(&mut self) {
        self.cancel();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn probes_finish_against_explicit_rejecting_proxy_and_cancel_aborts_pending_tasks() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let router = axum::Router::new().fallback(|| async { axum::http::StatusCode::FORBIDDEN });
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let mut job = MediaJob::start(port, None).unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !job.done.load(Ordering::Acquire) {
            assert!(std::time::Instant::now() < deadline);
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        let snapshot = job.snapshot();
        let items = snapshot["items"].as_array().unwrap();
        assert_eq!(items.len(), 12);
        assert!(items
            .iter()
            .all(|i| i["status"] != "Pending" && i["status"] != "Yes"));
        job = MediaJob::start(port, None).unwrap();
        job.cancel();
        assert!(job.snapshot()["cancelled"].as_bool().unwrap());
        assert!(job.snapshot()["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|i| i["status"] == "Cancelled"));
        assert!(MediaJob::start(port, Some("unknown-service".into())).is_err());
        server.abort();
    }
}
