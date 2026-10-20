//! Network configuration shares the AI database transaction/backup boundary.
//! Plain local configuration; runtime/lease/helper state is never stored here.
use super::{digest, Catalog, LIMIT};
use anyhow::{ensure, Context, Result};
use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, sync::Arc};
pub(crate) const KEY: &str = "si_assist_network";
static DATABASE: OnceCell<Arc<crate::database::Database>> = OnceCell::new();
#[derive(Serialize, Deserialize)]
pub(super) struct Repository {
    pub(super) schema: u32,
    pub(super) catalog: Catalog,
    #[serde(default)]
    pub(super) payloads: BTreeMap<String, Value>,
    #[serde(default)]
    pub(super) custom_proxy: Option<String>,
    #[serde(default)]
    pub(super) legacy: Option<Value>,
}
pub fn connect(db: Arc<crate::database::Database>) -> Result<()> {
    if let Some(connected) = DATABASE.get() {
        ensure!(
            Arc::ptr_eq(connected, &db),
            "network repository already connected to another database"
        );
    } else {
        DATABASE
            .set(db)
            .map_err(|_| anyhow::anyhow!("network repository already connected"))?;
    }
    if read()?.is_none() {
        let catalog = super::read_legacy_catalog()?;
        save(&catalog)?;
    }
    Ok(())
}
pub fn connected() -> bool {
    DATABASE.get().is_some()
}
fn read() -> Result<Option<(Repository, String)>> {
    let Some(db) = DATABASE.get() else {
        return Ok(None);
    };
    let Some(raw) = db.get_setting(KEY)? else {
        return Ok(None);
    };
    ensure!(raw.len() <= LIMIT, "network repository exceeds limit");
    let document: Value = crate::credential_vault::from_str(&raw)?;
    let record: Repository = serde_json::from_value(
        document
            .get("config")
            .context("invalid network repository")?
            .clone(),
    )?;
    ensure!(
        record.schema == 1 && record.catalog.schema <= 1,
        "network schema is newer than supported"
    );
    Ok(Some((record, raw)))
}
pub fn catalog() -> Result<Option<Catalog>> {
    Ok(read()?.map(|(record, raw)| {
        let mut catalog = record.catalog;
        catalog.storage_revision = Some(digest(raw.as_bytes()));
        catalog
    }))
}
pub fn payload(key: &str) -> Result<Option<Value>> {
    Ok(read()?.and_then(|(record, _)| record.payloads.get(key).cloned()))
}
pub fn custom(catalog: &Catalog) -> Result<Option<String>> {
    if let Some((record, _)) = read()? {
        if record.catalog.custom_proxy_ref == catalog.custom_proxy_ref {
            return Ok(record.custom_proxy);
        }
    }
    catalog
        .custom_proxy_ref
        .as_ref()
        .map(|key| {
            staged(key)?
                .and_then(|v| v.as_str().map(str::to_owned))
                .context(crate::credential_vault::MIGRATION_REQUIRED)
        })
        .transpose()
}

pub fn save(catalog: &Catalog) -> Result<()> {
    let db = DATABASE.get().context("network repository unavailable")?;
    let previous = read()?;
    let raw = previous.as_ref().map(|(_, raw)| raw.as_str());
    ensure!(
        catalog.storage_revision.as_deref() == raw.map(|raw| digest(raw.as_bytes())).as_deref(),
        "network configuration changed externally; reload before saving"
    );
    let mut payloads = BTreeMap::new();
    for profile in &catalog.profiles {
        let key = format!("profile:{}:{}", profile.id, profile.revision);
        let payload = previous
            .as_ref()
            .and_then(|(record, _)| record.payloads.get(&key).cloned());
        let payload = match payload {
            Some(payload) => payload,
            None => super::legacy_secret_get(&key)?,
        };
        payloads.insert(key, payload);
    }
    // Retain one previous revision until the next commit so failed activation
    // can roll back even when a portable restore has no legacy Keychain item.
    if let Some((previous, _)) = &previous {
        for old in &previous.catalog.profiles {
            if catalog
                .profiles
                .iter()
                .any(|current| current.id == old.id && current.revision != old.revision)
            {
                let key = format!("profile:{}:{}", old.id, old.revision);
                if let Some(payload) = previous.payloads.get(&key) {
                    payloads.insert(key, payload.clone());
                }
            }
        }
    }
    let custom_proxy = if let Some(key) = &catalog.custom_proxy_ref {
        if previous
            .as_ref()
            .is_some_and(|(record, _)| record.catalog.custom_proxy_ref == catalog.custom_proxy_ref)
        {
            previous.as_ref().and_then(|(r, _)| r.custom_proxy.clone())
        } else {
            Some(
                staged(key)?
                    .and_then(|v| v.as_str().map(str::to_owned))
                    .context(crate::credential_vault::MIGRATION_REQUIRED)?,
            )
        }
    } else {
        None
    };
    let record = Repository {
        schema: 1,
        catalog: catalog.clone(),
        payloads,
        custom_proxy,
        legacy: previous
            .as_ref()
            .and_then(|(record, _)| record.legacy.clone()),
    };
    let document = json!({"config":record});
    ensure!(
        serde_json::to_vec(&document)?.len() <= LIMIT,
        "combined network configuration exceeds 16 MiB"
    );
    let sealed = crate::credential_vault::to_string(&document)?;
    db.compare_and_set_setting(KEY, raw, &sealed)?;
    for key in record
        .payloads
        .keys()
        .chain(record.catalog.custom_proxy_ref.iter())
    {
        discard(key)?;
    }
    Ok(())
}
// Pending values only bridge the existing edit/validate/CAS sequence. Successful
// commits persist them in the same SQLite document, never a second disk vault.
static PENDING: std::sync::LazyLock<std::sync::Mutex<BTreeMap<String, Value>>> =
    std::sync::LazyLock::new(Default::default);
pub(super) fn stage(key: &str, value: Value) -> Result<()> {
    let mut pending = PENDING
        .lock()
        .map_err(|_| anyhow::anyhow!("Network staging unavailable"))?;
    let size = serde_json::to_vec(&value)?.len();
    ensure!(
        size <= LIMIT
            && pending
                .iter()
                .filter(|(k, _)| k.as_str() != key)
                .map(|(_, v)| v.to_string().len())
                .sum::<usize>()
                + size
                <= LIMIT,
        "Network staging exceeds limit"
    );
    pending.insert(key.into(), value);
    Ok(())
}
pub(super) fn staged(key: &str) -> Result<Option<Value>> {
    Ok(PENDING
        .lock()
        .map_err(|_| anyhow::anyhow!("Network staging unavailable"))?
        .get(key)
        .cloned())
}
pub(super) fn discard(key: &str) -> Result<()> {
    PENDING
        .lock()
        .map_err(|_| anyhow::anyhow!("Network staging unavailable"))?
        .remove(key);
    Ok(())
}

// Explicit migration only. The injected reader enforces cancellation and keeps
// OS credentials entirely out of the ordinary network save/load paths.
pub(crate) fn migrate_legacy(
    db: &crate::database::Database,
    read: &mut impl FnMut(&str) -> Result<Vec<u8>>,
) -> Result<()> {
    let raw = db.get_setting(KEY)?;
    let mut record: Repository = if let Some(raw) = &raw {
        let document: Value = crate::credential_vault::from_str(raw)?;
        serde_json::from_value(
            document
                .get("config")
                .context("Invalid network repository")?
                .clone(),
        )?
    } else {
        Repository {
            schema: 1,
            catalog: super::read_legacy_catalog()?,
            payloads: BTreeMap::new(),
            custom_proxy: None,
            legacy: None,
        }
    };
    let mut changed = raw.is_none();
    for profile in &record.catalog.profiles {
        let key = format!("profile:{}:{}", profile.id, profile.revision);
        if !record.payloads.contains_key(&key) {
            let bytes = zeroize::Zeroizing::new(read(&key)?);
            record.payloads.insert(
                key,
                serde_json::from_slice(&bytes).context("Invalid legacy network profile")?,
            );
            changed = true;
        }
    }
    if let Some(key) = &record.catalog.custom_proxy_ref {
        if record.custom_proxy.is_none() {
            record.custom_proxy = Some(
                String::from_utf8(read(key)?).context("Invalid legacy outbound configuration")?,
            );
            changed = true;
        }
    }
    if changed {
        let value = crate::credential_vault::to_string(&json!({"config":record}))?;
        ensure!(value.len() <= LIMIT, "Network repository exceeds limit");
        db.compare_and_set_setting(KEY, raw.as_deref(), &value)?;
    }
    Ok(())
}
pub(crate) fn legacy_pending(db: &crate::database::Database) -> Result<bool> {
    if let Some(raw) = db.get_setting(KEY)? {
        if crate::credential_vault::pending(&raw)? {
            return Ok(false);
        } // counted as a DB document
        let doc: Value = serde_json::from_str(&raw)?;
        let record: Repository = serde_json::from_value(
            doc.get("config")
                .context("Invalid network repository")?
                .clone(),
        )?;
        Ok(record.catalog.profiles.iter().any(|p| {
            !record
                .payloads
                .contains_key(&format!("profile:{}:{}", p.id, p.revision))
        }) || (record.catalog.custom_proxy_ref.is_some() && record.custom_proxy.is_none()))
    } else {
        Ok(super::root()?.join("catalog.json").exists())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_network_secrets_are_removed_from_default_portable_snapshots() {
        let db = crate::database::Database::memory().unwrap();
        let mut payloads = BTreeMap::new();
        payloads.insert("profile:fixture:1".into(),json!({"yaml":"proxies: [{name: node,password: fixture-network-password}]","url":"https://example.invalid/private-subscription"}));
        let record = Repository {
            schema: 1,
            catalog: Catalog::default(),
            payloads,
            custom_proxy: Some("http://user:fixture-proxy-password@localhost:8888".into()),
            legacy: None,
        };
        let sealed = crate::credential_vault::to_string(&json!({"config":record})).unwrap();
        db.compare_and_set_setting(KEY, None, &sealed).unwrap();
        assert!(db.compare_and_set_setting(KEY, None, &sealed).is_err());
        let raw = db.export_sql_string().unwrap();
        for secret in [
            "fixture-network-password",
            "private-subscription",
            "fixture-proxy-password",
        ] {
            assert!(raw.contains(secret));
        }
        let portable = db.export_portable_sql(false, true).unwrap();
        for secret in [
            "fixture-network-password",
            "private-subscription",
            "fixture-proxy-password",
            "$siCredential",
        ] {
            assert!(!portable.contains(secret));
        }
        assert!(portable.contains("si_assist_network"));
        assert!(portable.contains(crate::portable_credentials::MISSING));
        let full = db.export_portable_sql(true, true).unwrap();
        assert!(full.contains("fixture-network-password"));
    }
}

#[cfg(test)]
mod retry_tests {
    use super::*;
    #[test]
    fn connection_can_retry_after_unreadable_configuration_is_repaired() {
        const CHILD: &str = "SIVIO_NETWORK_RETRY_FIXTURE";
        if std::env::var_os(CHILD).is_none() {
            let home = tempfile::tempdir().unwrap();
            let status = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "network::repository::retry_tests::connection_can_retry_after_unreadable_configuration_is_repaired", "--test-threads=1"])
                .env(CHILD, "1").env("CC_SWITCH_TEST_HOME", home.path()).status().unwrap();
            assert!(status.success());
            return;
        }
        let db = Arc::new(crate::database::Database::memory().unwrap());
        db.set_setting(KEY, r#"{"config":{"$siCredential":"missing-fixture"}}"#)
            .unwrap();
        assert!(connect(db.clone()).is_err());
        let state = super::super::NetworkState::default();
        assert!(!state.ready.load(std::sync::atomic::Ordering::Acquire));
        let record = Repository {
            schema: 1,
            catalog: Catalog::default(),
            payloads: BTreeMap::new(),
            custom_proxy: None,
            legacy: None,
        };
        db.set_setting(KEY, &json!({"config":record}).to_string())
            .unwrap();
        connect(db.clone()).unwrap();
        super::super::reload_preferences().unwrap();
        assert!(state.mark_ready());
        connect(db.clone()).unwrap();
        assert!(
            !state.clone().mark_ready(),
            "retry must not duplicate workers"
        );
        assert!(state.ready.load(std::sync::atomic::Ordering::Acquire));
        assert!(connect(Arc::new(crate::database::Database::memory().unwrap())).is_err());
    }
}
