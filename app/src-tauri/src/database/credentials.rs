//! Prepare Keychain items outside the live connection lock, then atomically CAS
//! the raw rows. Staging imports use their private connection before publication.
use super::{lock_conn, Database};
use crate::error::AppError;
use rusqlite::Connection;
pub(crate) struct Row {
    table: &'static str,
    column: &'static str,
    id: i64,
    pub(crate) old: String,
    text: bool,
    setting_key: Option<String>,
}
pub(super) fn sensitive_setting(key: &str) -> bool {
    key == "global_proxy_url"
        || (key.starts_with("common_config_")
            && !key.ends_with("_cleared")
            && key != "common_config_legacy_migrated_v1")
}
fn snapshot(conn: &Connection) -> Result<Vec<Row>, AppError> {
    let mut rows = Vec::new();
    for (table, column, text) in [
        ("providers", "settings_config", false),
        ("providers", "meta", false),
        ("mcp_servers", "server_config", false),
        ("profiles", "payload", true),
        ("proxy_live_backup", "original_config", true),
    ] {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT rowid,{column} FROM {table} WHERE {column} IS NOT NULL"
            ))
            .map_err(db_error)?;
        for row in stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .map_err(db_error)?
        {
            let (id, old) = row.map_err(db_error)?;
            rows.push(Row {
                table,
                column,
                id,
                old,
                text,
                setting_key: None,
            });
        }
    }
    let mut stmt = conn
        .prepare("SELECT rowid,key,value FROM settings WHERE value IS NOT NULL AND (key IN ('global_proxy_url','universal_providers','si_assist_network') OR substr(key,1,14)='common_config_')")
        .map_err(db_error)?;
    for row in stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(db_error)?
    {
        let (id, key, old) = row.map_err(db_error)?;
        if sensitive_setting(&key)
            || ["universal_providers", "si_assist_network"].contains(&key.as_str())
        {
            rows.push(Row {
                table: "settings",
                column: "value",
                id,
                old,
                text: sensitive_setting(&key),
                setting_key: Some(key),
            });
        }
    }
    Ok(rows)
}
fn db_error(error: rusqlite::Error) -> AppError {
    AppError::Database(error.to_string())
}
fn commit(conn: &mut Connection, updates: Vec<(Row, String)>) -> Result<(), AppError> {
    if updates.is_empty() {
        return Ok(());
    }
    let tx = conn.transaction().map_err(db_error)?;
    for (row, sealed) in updates {
        let changed = tx
            .execute(
                &format!(
                    "UPDATE {} SET {}=?1 WHERE rowid=?2 AND {}=?3",
                    row.table, row.column, row.column
                ),
                rusqlite::params![sealed, row.id, row.old],
            )
            .map_err(db_error)?;
        if changed != 1 {
            return Err(AppError::Database(
                "Credential migration conflicted with another write; no rows were committed".into(),
            ));
        }
    }
    tx.commit().map_err(db_error)
}
pub(super) fn portable(conn: &mut Connection, include_secrets: bool) -> Result<(), AppError> {
    let rows = snapshot(conn)?;
    let mut updates = Vec::new();
    for row in rows {
        let mut value = crate::portable_credentials::document(&row.old, row.text, include_secrets)?;
        if !include_secrets && row.setting_key.as_deref() == Some("si_assist_network") {
            value = crate::portable_credentials::disable_incomplete_network(&value)?;
        }
        updates.push((row, value));
    }
    commit(conn, updates)?;
    if !include_secrets {
        let endpoints = {
            let mut stmt = conn
                .prepare("SELECT id,url FROM provider_endpoints")
                .map_err(db_error)?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(db_error)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(db_error)?
        };
        for (id, url) in endpoints {
            if crate::portable_credentials::safe_url(&url) == crate::portable_credentials::MISSING {
                conn.execute("DELETE FROM provider_endpoints WHERE id=?1", [id])
                    .map_err(db_error)?;
            }
        }
        conn.execute(
            "UPDATE providers SET is_current=0 WHERE settings_config LIKE ?1 OR meta LIKE ?1",
            [format!("%{}%", crate::portable_credentials::MISSING)],
        )
        .map_err(db_error)?;
    }
    Ok(())
}
impl Database {
    // Keep old references intact; startup and restore never authorize Keychain.
    pub(crate) fn protect_legacy_credentials(&self) -> Result<(), AppError> {
        Ok(())
    }
    pub(super) fn protect_staging_credentials(conn: &mut Connection) -> Result<(), AppError> {
        for row in snapshot(conn)? {
            if !row.text {
                let _: serde_json::Value = serde_json::from_str(&row.old)
                    .map_err(|_| AppError::Config("Invalid imported document".into()))?;
            }
        }
        Ok(())
    }
    pub(crate) fn pending_credential_rows(&self) -> Result<Vec<Row>, AppError> {
        let conn = lock_conn!(self.conn);
        Ok(snapshot(&conn)?
            .into_iter()
            .filter(|row| crate::credential_vault::pending(&row.old).unwrap_or(false))
            .collect())
    }
    pub(crate) fn commit_credential_row(&self, row: Row, plain: String) -> Result<(), AppError> {
        let mut conn = lock_conn!(self.conn);
        commit(&mut conn, vec![(row, plain)])
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_and_restore_keep_legacy_references_without_authorizing() {
        let db = Database::memory().unwrap();
        db.conn.lock().unwrap().execute("INSERT INTO providers(id,app_type,name,settings_config,meta) VALUES('missing','claude','missing',?1,'{}')",[r#"{"env":{"$siCredential":"missing-startup-fixture"}}"#]).unwrap();
        db.protect_legacy_credentials().unwrap();
        Database::protect_staging_credentials(&mut db.conn.lock().unwrap()).unwrap();
        assert!(db.get_provider_by_id("missing", "claude").is_err());
        assert_eq!(db.pending_credential_rows().unwrap().len(), 1);
    }
    #[test]
    fn migration_commits_whole_documents_and_preserves_concurrent_edits() {
        let db = Database::memory().unwrap();
        db.conn.lock().unwrap().execute("INSERT INTO providers(id,app_type,name,settings_config,meta) VALUES('old','claude','old',?1,'{}')",[r#"{"env":{"$siCredential":"old"}}"#]).unwrap();
        let row = db.pending_credential_rows().unwrap().pop().unwrap();
        let plain = crate::credential_vault::migrate(&row.old, &mut |_| {
            Ok(br#"{"API_KEY":"fixture"}"#.to_vec())
        })
        .unwrap();
        db.commit_credential_row(row, plain).unwrap();
        assert!(db.pending_credential_rows().unwrap().is_empty());
        assert_eq!(
            db.get_provider_by_id("old", "claude")
                .unwrap()
                .unwrap()
                .settings_config["env"]["API_KEY"],
            "fixture"
        );
        db.conn
            .lock()
            .unwrap()
            .execute(
                "UPDATE providers SET settings_config=?1",
                [r#"{"env":{"$siCredential":"old"}}"#],
            )
            .unwrap();
        let row = db.pending_credential_rows().unwrap().pop().unwrap();
        db.conn
            .lock()
            .unwrap()
            .execute("UPDATE providers SET settings_config='{}'", [])
            .unwrap();
        assert!(db.commit_credential_row(row, "{}".into()).is_err());
        assert!(db.pending_credential_rows().unwrap().is_empty());
    }
}
