//! User-initiated legacy migration. Status reads never access Keychain.
use crate::{credential_vault as vault, database::Database, error::AppError};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use zeroize::Zeroizing;
static RUNNING: AtomicBool = AtomicBool::new(false);
static CANCELLED: AtomicBool = AtomicBool::new(false);
static LAST: Mutex<(Option<String>, Option<String>)> = Mutex::new((None, None));

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MigrationStatus {
    pending: usize,
    running: bool,
    error: Option<String>,
    backup_path: Option<String>,
}
fn files() -> Vec<(&'static str, PathBuf)> {
    let root = crate::config::get_home_dir().join("Library/Application Support/SI Assist");
    vec![
        (
            "settings.json",
            crate::settings::AppSettings::settings_path().unwrap(),
        ),
        ("config.json", crate::config::get_app_config_path()),
        ("network-catalog.json", root.join("network/catalog.json")),
    ]
}
fn pending_files() -> Result<Vec<(&'static str, PathBuf, String)>, AppError> {
    let mut pending = Vec::new();
    for (name, path) in files() {
        crate::private_storage::reject_link(&path)?;
        let raw = match std::fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(AppError::io(&path, e)),
        };
        if vault::pending(&raw)? {
            pending.push((name, path, raw));
        }
    }
    Ok(pending)
}
fn status(db: &Database) -> Result<MigrationStatus, AppError> {
    let last = LAST
        .lock()
        .map_err(|_| AppError::Config("Migration state unavailable".into()))?;
    Ok(MigrationStatus {
        pending: db.pending_credential_rows()?.len()
            + pending_files()?.len()
            + usize::from(crate::network::repository::legacy_pending(db).map_err(|_| {
                AppError::Config("Cannot inspect legacy network configuration".into())
            })?),
        running: RUNNING.load(Ordering::Acquire),
        error: last.0.clone(),
        backup_path: last.1.clone(),
    })
}
/// Keep automatic startup writes/services paused until recovery is possible in
/// the window. Inspect references only; never request Keychain access here.
pub(crate) fn needs_startup_recovery(db: &Database) -> bool {
    match status(db) {
        Ok(status) => status.pending > 0,
        Err(error) => {
            log::warn!("Credential inspection unavailable; automatic startup paused: {error}");
            true
        }
    }
}
#[tauri::command]
pub(crate) async fn credential_migration_status(
    state: tauri::State<'_, crate::store::AppState>,
) -> Result<MigrationStatus, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || status(&db).map_err(|e| e.to_string()))
        .await
        .map_err(|_| "Migration inspection failed".to_string())?
}
#[tauri::command]
pub(crate) fn cancel_credential_migration() {
    CANCELLED.store(true, Ordering::Release);
}
fn check_cancelled() -> Result<(), AppError> {
    if CANCELLED.load(Ordering::Acquire) {
        Err(AppError::Config(
            "迁移已暂停。已完成的数据已保存；其余数据保持原样。Migration paused.".into(),
        ))
    } else {
        Ok(())
    }
}
struct Reader {
    values: HashMap<(String, String), Zeroizing<Vec<u8>>>,
    bytes: usize,
}
impl Reader {
    fn read(&mut self, service: &str, id: &str) -> Result<Vec<u8>, AppError> {
        check_cancelled()?;
        let key = (service.to_owned(), id.to_owned());
        if let Some(value) = self.values.get(&key) {
            return Ok(value.to_vec());
        }
        let value = security_framework::passwords::get_generic_password(service,id).map_err(|_| AppError::Config("旧凭据未获授权或不可用，迁移已停止。可重试迁移或从原应用导入配置；原数据未删除。Legacy credential access failed.".into()))?;
        check_cancelled()?;
        if value.len() > 16 * 1024 * 1024 {
            return Err(AppError::Config("Legacy credential exceeds limit".into()));
        }
        if self.bytes + value.len() > 32 * 1024 * 1024 {
            self.values.clear();
            self.bytes = 0;
        }
        self.bytes += value.len();
        self.values.insert(key, Zeroizing::new(value.clone()));
        Ok(value)
    }
}
fn migrate_rows(
    db: &Database,
    rows: Vec<crate::database::credentials::Row>,
    read: &mut impl FnMut(&str) -> Result<Vec<u8>, AppError>,
    checkpoint: &mut impl FnMut() -> Result<(), AppError>,
) -> Result<(), AppError> {
    for row in rows {
        check_cancelled()?;
        let plain = vault::migrate(&row.old, read)?;
        check_cancelled()?;
        db.commit_credential_row(row, plain)?;
        checkpoint()?;
    }
    Ok(())
}
fn run(db: &Database) -> Result<(), AppError> {
    let _suppress = crate::services::webdav_auto_sync::AutoSyncSuppressionGuard::new();
    let rows = db.pending_credential_rows()?;
    let documents = pending_files()?;
    let network_pending = crate::network::repository::legacy_pending(db)
        .map_err(|_| AppError::Config("Cannot inspect legacy network configuration".into()))?;
    if rows.is_empty() && documents.is_empty() && !network_pending {
        return Ok(());
    }
    // Every run gets a complete original snapshot before reading any OS secret.
    // Completed documents themselves are durable progress, so resuming only
    // examines the references still present, even after an unclean shutdown.
    let backup = crate::config::get_app_config_dir()
        .join("credential-migration")
        .join(uuid::Uuid::new_v4().to_string());
    crate::private_storage::directory(backup.parent().unwrap())?;
    crate::private_storage::directory(&backup)?;
    crate::config::atomic_write_private(
        &backup.join("database.sql"),
        db.export_sql_string()?.as_bytes(),
    )?;
    for (name, path) in files() {
        if path.exists() {
            crate::private_storage::reject_link(&path)?;
            crate::config::atomic_write_private(
                &backup.join(name),
                &std::fs::read(&path).map_err(|e| AppError::io(&path, e))?,
            )?;
        }
    }
    crate::config::atomic_write_private(
        &backup.join("progress.json"),
        b"{\"status\":\"started\",\"completedDocuments\":0}",
    )?;
    LAST.lock().unwrap().1 = Some(backup.display().to_string());
    let mut reader = Reader {
        values: HashMap::new(),
        bytes: 0,
    };
    let mut completed = 0;
    let mut checkpoint = || -> Result<(), AppError> {
        completed += 1;
        crate::config::atomic_write_private(
            &backup.join("progress.json"),
            serde_json::json!({"status":"in-progress","completedDocuments":completed})
                .to_string()
                .as_bytes(),
        )
    };
    migrate_rows(
        db,
        rows,
        &mut |id| reader.read(vault::SERVICE, id),
        &mut checkpoint,
    )?;
    for (_, path, raw) in documents {
        check_cancelled()?;
        let plain = vault::migrate(&raw, &mut |id| reader.read(vault::SERVICE, id))?;
        check_cancelled()?;
        crate::config::compare_and_write_private(&path, &raw, plain.as_bytes())?;
        checkpoint()?;
    }
    check_cancelled()?;
    crate::network::repository::migrate_legacy(db, &mut |id| reader.read(crate::network::KEYCHAIN_SERVICE,id).map_err(anyhow::Error::from))
        .map_err(|_| AppError::Config("旧网络配置尚未完成迁移。已完成的数据已保存，请重试或导入原配置。Legacy network migration incomplete.".into()))?;
    crate::config::atomic_write_private(
        &backup.join("progress.json"),
        b"{\"status\":\"complete\"}",
    )?;
    // Reload prevents an old in-memory default from overwriting migrated settings.
    crate::settings::reload_settings()?;
    Ok(())
}
#[tauri::command]
pub(crate) async fn migrate_legacy_credentials(
    state: tauri::State<'_, crate::store::AppState>,
    network: tauri::State<'_, crate::network::NetworkState>,
) -> Result<MigrationStatus, String> {
    let _network = crate::network::begin_restore(&network, state.inner())
        .await
        .map_err(|e| e.to_string())?;
    let _sync = crate::services::sync_protocol::sync_mutex().lock().await;
    if RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("A credential migration is already running".into());
    }
    CANCELLED.store(false, Ordering::Release);
    LAST.lock().unwrap().0 = None;
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        struct RunningGuard;
        impl Drop for RunningGuard {
            fn drop(&mut self) {
                RUNNING.store(false, Ordering::Release);
            }
        }
        let guard = RunningGuard;
        if let Err(error) = run(&db) {
            LAST.lock().unwrap().0 = Some(error.to_string());
        }
        drop(guard);
        status(&db).map_err(|e| e.to_string())
    })
    .await
    .map_err(|_| "Credential migration interrupted; completed documents remain saved".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credential_migration_resumes_after_denial_or_checkpoint_failure() {
        let db = Database::memory().unwrap();
        for id in ["a", "b"] {
            db.conn.lock().unwrap().execute("INSERT INTO providers(id,app_type,name,settings_config,meta) VALUES(?1,'claude',?1,?2,'{}')", rusqlite::params![id,serde_json::json!({"password":{"$siCredential":id}}).to_string()]).unwrap();
        }
        let mut reads = Vec::new();
        let result = migrate_rows(
            &db,
            db.pending_credential_rows().unwrap(),
            &mut |id| {
                reads.push(id.to_owned());
                if reads.len() == 2 {
                    Err(AppError::Config("denied".into()))
                } else {
                    Ok(b"\"synthetic\"".to_vec())
                }
            },
            &mut || Ok(()),
        );
        assert!(result.is_err());
        assert_eq!(db.pending_credential_rows().unwrap().len(), 1);
        let already = reads[0].clone();
        let result = migrate_rows(
            &db,
            db.pending_credential_rows().unwrap(),
            &mut |id| {
                assert_ne!(id, already);
                Ok(b"\"synthetic\"".to_vec())
            },
            &mut || Err(AppError::Config("disk full checkpoint fixture".into())),
        );
        assert!(result.is_err());
        assert!(db.pending_credential_rows().unwrap().is_empty());
        migrate_rows(
            &db,
            db.pending_credential_rows().unwrap(),
            &mut |_| panic!("completed rows must not read Keychain"),
            &mut || Ok(()),
        )
        .unwrap();
    }
}
