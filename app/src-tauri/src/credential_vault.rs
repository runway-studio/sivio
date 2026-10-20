//! Local configuration serialization. Keychain is accessed only by the explicit
//! legacy migration, never by a normal read, save, import or startup.
use crate::error::AppError;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
pub(crate) const SERVICE: &str = "local.siassist.desktop.credentials";
pub(crate) const MIGRATION_REQUIRED: &str = "旧凭据尚未迁移，请使用窗口中的「迁移旧凭据」；未修改原配置。Legacy credential migration required.";

pub(crate) fn has_references(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.contains_key("$siCredential") || map.values().any(has_references),
        Value::Array(values) => values.iter().any(has_references),
        _ => false,
    }
}
pub(crate) fn pending(raw: &str) -> Result<bool, AppError> {
    let value: Value = serde_json::from_str(raw)
        .map_err(|_| AppError::Config("Invalid credential document".into()))?;
    Ok(has_references(&value))
}
pub fn to_string<T: Serialize>(value: &T) -> Result<String, AppError> {
    let value = serde_json::to_value(value).map_err(|e| AppError::Config(e.to_string()))?;
    if has_references(&value) {
        return Err(AppError::Config(MIGRATION_REQUIRED.into()));
    }
    serde_json::to_string(&value).map_err(|e| AppError::Config(e.to_string()))
}
pub fn from_str<T: DeserializeOwned>(raw: &str) -> Result<T, AppError> {
    let value: Value = serde_json::from_str(raw)
        .map_err(|_| AppError::Config("Invalid persisted credential document".into()))?;
    if has_references(&value) {
        return Err(AppError::Config(MIGRATION_REQUIRED.into()));
    }
    serde_json::from_value(value)
        .map_err(|_| AppError::Config("Invalid persisted credential structure".into()))
}
pub fn from_sql<T: DeserializeOwned>(value: &str) -> Result<T, rusqlite::Error> {
    from_str(value).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })
}
/// Keep the envelope so arbitrary TOML/YAML/text remains lossless and exportable.
pub fn protect_text(value: &str) -> Result<String, AppError> {
    if let Ok(document) = serde_json::from_str::<Value>(value) {
        if document.get("$siProtectedText").and_then(Value::as_u64) == Some(1) {
            let _: String = unprotect_text(value)?;
            return to_string(&document);
        }
    }
    to_string(&json!({"$siProtectedText":1,"config":value}))
}
pub fn unprotect_text(value: &str) -> Result<String, AppError> {
    let document = serde_json::from_str::<Value>(value).ok();
    if document
        .as_ref()
        .and_then(|v| v.get("$siProtectedText"))
        .and_then(Value::as_u64)
        != Some(1)
    {
        return Ok(value.into());
    }
    let opened: Value = from_str(value)?;
    opened
        .get("config")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| AppError::Config("Invalid protected text document".into()))
}
/// The caller supplies the only permitted legacy reader. No ambient flag can
/// accidentally allow background tasks to trigger a Keychain authorization.
pub(crate) fn migrate(
    raw: &str,
    read: &mut impl FnMut(&str) -> Result<Vec<u8>, AppError>,
) -> Result<String, AppError> {
    fn resolve(
        value: Value,
        read: &mut impl FnMut(&str) -> Result<Vec<u8>, AppError>,
        depth: usize,
    ) -> Result<Value, AppError> {
        if depth > 64 {
            return Err(AppError::Config(
                "Legacy credential nesting exceeds limit".into(),
            ));
        }
        match value {
            Value::Object(mut map) => {
                if map.contains_key("$siCredential") {
                    let id = map
                        .get("$siCredential")
                        .and_then(Value::as_str)
                        .filter(|id| !id.is_empty() && id.len() <= 256)
                        .filter(|_| map.len() == 1)
                        .ok_or_else(|| {
                            AppError::Config("Invalid legacy credential reference".into())
                        })?;
                    let bytes = zeroize::Zeroizing::new(read(id)?);
                    if bytes.len() > 16 * 1024 * 1024 {
                        return Err(AppError::Config("Legacy credential exceeds limit".into()));
                    }
                    let decoded = serde_json::from_slice(&bytes)
                        .map_err(|_| AppError::Config("Invalid legacy credential value".into()))?;
                    return resolve(decoded, read, depth + 1);
                }
                for value in map.values_mut() {
                    *value = resolve(value.take(), read, depth + 1)?;
                }
                Ok(Value::Object(map))
            }
            Value::Array(values) => values
                .into_iter()
                .map(|v| resolve(v, read, depth + 1))
                .collect::<Result<Vec<_>, _>>()
                .map(Value::Array),
            value => Ok(value),
        }
    }
    let value = serde_json::from_str(raw)
        .map_err(|_| AppError::Config("Invalid legacy document".into()))?;
    to_string(&resolve(value, read, 0)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_secrets_and_unknown_fields_round_trip_without_keychain() {
        let value =
            json!({"env":{"API_KEY":"fixture"},"url":"https://example.invalid/token","future":7});
        let raw = to_string(&value).unwrap();
        assert!(raw.contains("fixture"));
        assert!(!raw.contains("$siCredential"));
        assert_eq!(from_str::<Value>(&raw).unwrap(), value);
    }
    #[test]
    fn normal_reads_and_writes_never_resolve_legacy_references() {
        let value = json!({"password":{"$siCredential":"old"}});
        assert!(from_str::<Value>(&value.to_string()).is_err());
        assert!(to_string(&value).is_err());
        let mut calls = 0;
        let raw = migrate(&value.to_string(), &mut |_| {
            calls += 1;
            Ok(b"\"fixture\"".to_vec())
        })
        .unwrap();
        assert_eq!(calls, 1);
        assert_eq!(from_str::<Value>(&raw).unwrap()["password"], "fixture");
    }
    #[test]
    fn denied_and_recursive_references_do_not_produce_partial_documents() {
        assert!(
            migrate(r#"{"password":{"$siCredential":"old"}}"#, &mut |_| Err(
                AppError::Config("denied".into())
            ))
            .is_err()
        );
        assert!(migrate(r#"{"$siCredential":"loop"}"#, &mut |_| Ok(
            br#"{"$siCredential":"loop"}"#.to_vec()
        ))
        .is_err());
    }
    #[test]
    fn text_envelopes_preserve_exact_content_and_old_references_require_migration() {
        let text = "# comment\npassword: fixture\n";
        assert_eq!(unprotect_text(&protect_text(text).unwrap()).unwrap(), text);
        assert!(
            unprotect_text(r#"{"$siProtectedText":1,"config":{"$siCredential":"old"}}"#).is_err()
        );
    }
    #[test]
    #[ignore = "requires an explicitly supplied disposable Keychain; never uses login Keychain"]
    fn isolated_keychain_migration_then_local_reads() {
        use security_framework::os::macos::keychain::SecKeychain;
        let path =
            std::env::var("SIVIO_TEST_KEYCHAIN").expect("provide disposable fixture Keychain");
        assert!(path.starts_with("/private/tmp/sivio-local-credentials-"));
        let _interaction = SecKeychain::disable_user_interaction().unwrap();
        let mut keychain = SecKeychain::open(&path).unwrap();
        keychain
            .add_generic_password(
                "local.sivio.migration.fixture",
                "fixture",
                br#"{"API_KEY":"synthetic-fixture"}"#,
            )
            .unwrap();
        let old = r#"{"env":{"$siCredential":"fixture"}}"#;
        assert!(from_str::<Value>(old).is_err());
        let local = migrate(old, &mut |id| {
            keychain
                .find_generic_password("local.sivio.migration.fixture", id)
                .map(|(value, _)| value.to_vec())
                .map_err(|_| AppError::Config("Fixture read failed".into()))
        })
        .unwrap();
        let temp = tempfile::tempdir().unwrap();
        let config = temp.path().join("settings.json");
        crate::config::atomic_write_private(&config, local.as_bytes()).unwrap();
        assert!(std::process::Command::new("/usr/bin/security")
            .args(["lock-keychain", &path])
            .status()
            .unwrap()
            .success());
        assert!(keychain
            .find_generic_password("local.sivio.migration.fixture", "fixture")
            .is_err());
        // Fresh reads from disk with the source Keychain locked still succeed.
        for _ in 0..3 {
            let reopened: Value = from_str(&std::fs::read_to_string(&config).unwrap()).unwrap();
            assert_eq!(reopened["env"]["API_KEY"], "synthetic-fixture");
        }
    }
}
