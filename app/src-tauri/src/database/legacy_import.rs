//! Explicit adapters for the pinned CC Switch SQL/SQLite format. Never open the
//! original SQLite file: callers supply a stable private copy (including WAL).
use super::{Database, SCHEMA_VERSION};
use crate::error::AppError;
use rusqlite::{types::Value, Connection};
use serde_json::json;
use std::path::Path;

fn err(message: impl Into<String>) -> AppError {
    AppError::Config(message.into())
}
impl Database {
    pub(crate) fn legacy_network_snapshot(&self, value: &str) -> Result<String, AppError> {
        let target = self.snapshot_to_memory()?;
        target.execute("INSERT INTO settings(key,value) VALUES('si_assist_network',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[value]).map_err(|e|err(e.to_string()))?;
        Self::dump_sql(&target, &[])
    }
    pub(crate) fn legacy_cc_sql(
        bytes: &[u8],
        sqlite_copy: Option<&Path>,
    ) -> Result<String, AppError> {
        if let Some(path) = sqlite_copy {
            let conn =
                Connection::open(path).map_err(|_| err("Invalid copied CC Switch database"))?;
            let extra: i64 = conn
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type NOT IN ('table','index')",
                    [],
                    |r| r.get(0),
                )
                .map_err(|_| err("Invalid SQLite schema"))?;
            if extra != 0 {
                return Err(err(
                    "Database views and triggers are not supported for migration",
                ));
            }
            let version: i32 = conn
                .query_row("PRAGMA user_version", [], |r| r.get(0))
                .map_err(|_| err("Invalid database version"))?;
            if version > SCHEMA_VERSION {
                return Err(err(
                    "Source database schema is newer than Sivio supports",
                ));
            }
            Self::validate_imported_schema(&conn)?;
            return Self::dump_sql(&conn, &[]);
        }
        let text = std::str::from_utf8(bytes)
            .map_err(|_| err("CC Switch SQL must be UTF-8"))?
            .trim_start_matches('\u{feff}')
            .trim_start();
        if !text.starts_with("-- CC Switch SQLite 导出") {
            return Err(err("Select an original CC Switch SQL export or database"));
        }
        Ok(text.replacen("-- CC Switch SQLite 导出", "-- Sivio SQLite 导出", 1))
    }

    /// Merge into a private copy of Sivio, leaving activation and local
    /// runtime/settings untouched. All inserted executable integrations are off.
    pub(crate) fn merge_legacy_cc(
        &self,
        sql: &str,
        replace: bool,
    ) -> Result<(String, serde_json::Value), AppError> {
        let (_file, source) = Self::stage_import_sql(sql, false)?;
        let target = self.snapshot_to_memory()?;
        Self::create_tables_on_conn(&target)?;
        Self::apply_schema_migrations_on_conn(&target)?;
        let mut counts = serde_json::Map::new();
        for table in [
            "providers",
            "provider_endpoints",
            "mcp_servers",
            "prompts",
            "skills",
            "skill_repos",
            "profiles",
            "model_pricing",
            "settings",
        ] {
            let columns: Vec<(String, i64)> = source
                .prepare(&format!("PRAGMA table_info(\"{table}\")"))
                .map_err(|e| err(e.to_string()))?
                .query_map([], |r| Ok((r.get(1)?, r.get(5)?)))
                .map_err(|e| err(e.to_string()))?
                .collect::<Result<_, _>>()
                .map_err(|e| err(e.to_string()))?;
            let names = columns
                .iter()
                .map(|(n, _)| format!("\"{n}\""))
                .collect::<Vec<_>>()
                .join(",");
            let mut keys: Vec<_> = columns
                .iter()
                .enumerate()
                .filter(|(_, (_, pk))| *pk > 0)
                .collect();
            keys.sort_by_key(|(_, (_, pk))| *pk);
            let predicates = if table == "provider_endpoints" {
                vec!["provider_id", "app_type", "url"]
            } else {
                keys.iter().map(|(_, (n, _))| n.as_str()).collect()
            };
            let mut select = source
                .prepare(&format!("SELECT {names} FROM \"{table}\" ORDER BY {names}"))
                .map_err(|e| err(e.to_string()))?;
            let rows = select
                .query_map([], |r| {
                    (0..columns.len())
                        .map(|i| r.get::<_, Value>(i))
                        .collect::<Result<Vec<_>, _>>()
                })
                .map_err(|e| err(e.to_string()))?;
            let (mut added, mut conflicts, mut skipped) = (0, 0, 0);
            for row in rows {
                let mut row = row.map_err(|e| err(e.to_string()))?;
                if table == "settings" {
                    let Value::Text(key) = &row[0] else {
                        return Err(err("Invalid settings key"));
                    };
                    if !(key.starts_with("universal_provider_")
                        || key.starts_with("common_config_")
                        || [
                            "custom_provider_icons",
                            "rectifier_config",
                            "optimizer_config",
                            "copilot_optimizer_config",
                        ]
                        .contains(&key.as_str()))
                    {
                        continue;
                    }
                }
                for (i, (column, _)) in columns.iter().enumerate() {
                    if column.starts_with("enabled")
                        || ["is_current", "in_failover_queue"].contains(&column.as_str())
                    {
                        row[i] = Value::Integer(0);
                    }
                }
                let key_values = predicates
                    .iter()
                    .map(|key| {
                        row[columns
                            .iter()
                            .position(|(n, _)| n == key)
                            .expect("fixed schema key")]
                        .clone()
                    })
                    .collect::<Vec<_>>();
                let where_sql = predicates
                    .iter()
                    .map(|n| format!("\"{n}\" IS ?"))
                    .collect::<Vec<_>>()
                    .join(" AND ");
                let exists: bool = target
                    .query_row(
                        &format!("SELECT EXISTS(SELECT 1 FROM \"{table}\" WHERE {where_sql})"),
                        rusqlite::params_from_iter(&key_values),
                        |r| r.get(0),
                    )
                    .map_err(|e| err(e.to_string()))?;
                if exists {
                    conflicts += 1;
                    if !replace {
                        skipped += 1;
                        continue;
                    }
                }
                if table == "provider_endpoints" {
                    row[columns.iter().position(|(n, _)| n == "id").unwrap()] = Value::Null;
                }
                // UPDATE preserves FK-linked endpoints; REPLACE would delete them.
                if exists {
                    let nonkeys = columns
                        .iter()
                        .enumerate()
                        .filter(|(_, (n, _))| {
                            !predicates.contains(&n.as_str())
                                && !(table == "provider_endpoints" && n == "id")
                        })
                        .collect::<Vec<_>>();
                    let assigns = nonkeys
                        .iter()
                        .map(|(_, (n, _))| format!("\"{n}\"=?"))
                        .collect::<Vec<_>>()
                        .join(",");
                    let values = nonkeys
                        .iter()
                        .map(|(i, _)| row[*i].clone())
                        .chain(key_values)
                        .collect::<Vec<_>>();
                    target
                        .execute(
                            &format!("UPDATE \"{table}\" SET {assigns} WHERE {where_sql}"),
                            rusqlite::params_from_iter(values),
                        )
                        .map_err(|e| err(e.to_string()))?;
                } else {
                    let marks = vec!["?"; columns.len()].join(",");
                    target
                        .execute(
                            &format!("INSERT INTO \"{table}\" ({names}) VALUES ({marks})"),
                            rusqlite::params_from_iter(row),
                        )
                        .map_err(|e| err(e.to_string()))?;
                    added += 1;
                }
            }
            counts.insert(
                table.into(),
                json!({"added":added,"conflicts":conflicts,"kept":skipped}),
            );
        }
        Ok((Self::dump_sql(&target, &[])?, counts.into()))
    }
}
