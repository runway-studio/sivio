//! Configuration-change backups reuse the existing consistent SQLite snapshot and retention path.
use serde_json::{json, Value};
use std::sync::{Arc, OnceLock, RwLock};
use tauri::Emitter;
use tokio::sync::mpsc::{self, Sender};
static SIGNAL: OnceLock<Sender<()>> = OnceLock::new();
static STATUS: RwLock<Option<Value>> = RwLock::new(None);
pub(crate) fn status() -> Option<Value> {
    STATUS.read().unwrap_or_else(|e| e.into_inner()).clone()
}
pub(crate) fn notify_db_changed(table: &str) {
    if crate::services::webdav_auto_sync::is_auto_sync_suppressed()
        || !crate::services::sync_protocol::should_trigger_auto_sync_for_table(table)
    {
        return;
    }
    if let Some(tx) = SIGNAL.get() {
        let _ = tx.try_send(());
    }
}
pub(crate) fn start(db: Arc<crate::database::Database>, app: tauri::AppHandle) {
    let (tx, mut rx) = mpsc::channel(1);
    if SIGNAL.set(tx).is_err() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let mut previous: Option<std::time::Instant> = None;
        while rx.recv().await.is_some() {
            // Debounce a burst, bounded even while configuration changes continue.
            let started = std::time::Instant::now();
            while let Some(wait) = crate::services::webdav_auto_sync::auto_sync_wait_duration(
                started,
                std::time::Instant::now(),
            ) {
                if !matches!(tokio::time::timeout(wait, rx.recv()).await, Ok(Some(()))) {
                    break;
                }
            }
            if !crate::desktop_preferences::current(&app).auto_backup_on_change {
                continue;
            }
            if let Some(previous) = previous {
                tokio::time::sleep(
                    std::time::Duration::from_secs(60).saturating_sub(previous.elapsed()),
                )
                .await;
                while rx.try_recv().is_ok() {}
                if !crate::desktop_preferences::current(&app).auto_backup_on_change {
                    continue;
                }
            }
            let database = db.clone();
            let result =
                tauri::async_runtime::spawn_blocking(move || database.backup_database_file()).await;
            previous = Some(std::time::Instant::now());
            let status = match result {
                Ok(Ok(Some(path))) => {
                    json!({"at":chrono::Utc::now().timestamp(),"file":path.file_name().map(|n|n.to_string_lossy().into_owned()),"error":null})
                }
                Ok(Ok(None)) => continue,
                _ => {
                    json!({"at":chrono::Utc::now().timestamp(),"error":"Local configuration backup failed; check available disk space and backup permissions"})
                }
            };
            *STATUS.write().unwrap_or_else(|e| e.into_inner()) = Some(status.clone());
            let _ = app.emit("desktop-backup-result", status);
        }
    });
}
