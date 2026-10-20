//! Portable snapshots contain usable structure and explicit missing-credential
//! markers, never references to a different device's Keychain.
use crate::error::AppError;
use serde_json::{json, Value};
#[path = "../../../native/credential_marker.rs"]
mod credential_marker;
pub use credential_marker::MISSING;
fn error() -> AppError {
    AppError::Config("Credential document cannot be prepared for portable export".into())
}
fn sensitive(key: &str) -> bool {
    let key = key.to_ascii_lowercase().replace(['-', '_'], "");
    if [
        "maxtokens",
        "maxinputtokens",
        "maxoutputtokens",
        "maxcompletiontokens",
        "inputtokens",
        "outputtokens",
        "totaltokens",
        "tokencount",
        "tokenlimit",
    ]
    .contains(&key.as_str())
    {
        return false;
    }
    [
        "apikey",
        "password",
        "token",
        "secret",
        "authorization",
        "authentication",
        "credential",
        "privatekey",
        "clientkey",
        "cookie",
    ]
    .iter()
    .any(|part| key.contains(part))
        || key == "key"
        || key == "accountid"
        || key == "uuid"
        || key == "psk"
        || key == "presharedkey"
        || key == "auth"
}
pub(crate) fn safe_url(raw: &str) -> String {
    let Ok(mut url) = url::Url::parse(raw) else {
        return MISSING.into();
    };
    if !["http", "https", "socks5", "socks5h"].contains(&url.scheme()) {
        return MISSING.into();
    }
    let had_credentials = !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some();
    if had_credentials
        || ![
            "",
            "/",
            "/v1",
            "/v1/",
            "/v1/messages",
            "/v1/responses",
            "/v1/chat/completions",
        ]
        .contains(&url.path())
    {
        return MISSING.into();
    }
    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.set_query(None);
    url.set_fragment(None);
    url.to_string()
}

/// Typed fields are removed above; recognizable credentials inside user-authored
/// notes and Skill assets must also block an unencrypted portable snapshot.
pub fn ensure_no_obvious_credentials(bytes: &[u8]) -> Result<(), AppError> {
    static PATTERN: once_cell::sync::Lazy<regex::bytes::Regex> = once_cell::sync::Lazy::new(|| {
        regex::bytes::Regex::new(r"-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{30,}|\bAKIA[A-Z0-9]{16}\b").unwrap()
    });
    if PATTERN.is_match(bytes) {
        return Err(AppError::Config("User-authored content appears to contain credentials. Remove the credential or explicitly choose an encrypted snapshot before exporting or syncing. No snapshot was published.".into()));
    }
    Ok(())
}
fn text_document(raw: &str, include: bool) -> String {
    if include {
        return raw.into();
    }
    if let Ok(value) = serde_json::from_str::<Value>(raw) {
        return serde_json::to_string(&clean(value, "")).unwrap_or_else(|_| MISSING.into());
    }
    if let Ok(value) = toml::from_str::<toml::Value>(raw) {
        if let Ok(value) = serde_json::to_value(value) {
            return toml::to_string_pretty(&clean(value, "")).unwrap_or_else(|_| MISSING.into());
        }
    }
    if let Ok(value) = serde_yaml_ng::from_str::<Value>(raw) {
        if value.is_object() || value.is_array() {
            return serde_yaml_ng::to_string(&clean(value, "")).unwrap_or_else(|_| MISSING.into());
        }
    }
    MISSING.into()
}
pub fn clean(value: Value, key: &str) -> Value {
    let normalized = key.to_ascii_lowercase().replace(['-', '_'], "");
    if normalized == "code"
        || normalized == "script"
        || normalized.ends_with("script") && value.is_string()
    {
        return Value::String(String::new());
    }
    if normalized == "args" {
        return json!([MISSING]);
    }
    if value.is_number() && sensitive(key) {
        return Value::String(MISSING.into());
    }
    if ["headers", "header"].contains(&normalized.as_str()) {
        if value.is_null()
            || value.as_str() == Some("")
            || value.as_array().is_some_and(|values| values.is_empty())
        {
            return value;
        }
        return match value {
            Value::Object(mut headers) => {
                for value in headers.values_mut() {
                    *value = Value::String(MISSING.into());
                }
                Value::Object(headers)
            }
            _ => Value::String(MISSING.into()),
        };
    }
    if normalized == "env" {
        if let Value::Object(mut map) = value {
            for (name, value) in &mut map {
                let upper = name.to_ascii_uppercase();
                if sensitive(name) {
                    *value = Value::String(MISSING.into());
                } else if upper.contains("MODEL")
                    || upper.contains("URL")
                    || matches!(value.as_str(), Some("0" | "1" | "true" | "false"))
                {
                    *value = clean(value.take(), name);
                } else {
                    *value = Value::String(MISSING.into());
                }
            }
            return Value::Object(map);
        }
        return Value::String(MISSING.into());
    }
    match value {
        Value::Object(mut map) => {
            let subscription = map.contains_key("yaml");
            for (name, value) in &mut map {
                if subscription && name == "url" {
                    *value = Value::String(MISSING.into());
                    continue;
                }
                *value = clean(value.take(), name);
            }
            Value::Object(map)
        }
        Value::Array(values) => {
            Value::Array(values.into_iter().map(|value| clean(value, key)).collect())
        }
        Value::String(raw) => {
            if raw.is_empty() {
                return Value::String(raw);
            }
            if sensitive(key) {
                return Value::String(MISSING.into());
            }
            if normalized == "config"
                || normalized == "yaml"
                || normalized == "merge"
                || normalized == "dns"
            {
                return Value::String(text_document(&raw, false));
            }
            if normalized == "env" {
                return Value::String(MISSING.into());
            }
            if normalized.contains("url") || normalized == "endpoint" || normalized == "customproxy"
            {
                return Value::String(safe_url(&raw));
            }
            Value::String(raw)
        }
        other => other,
    }
}
pub(crate) fn disable_incomplete_network(raw: &str) -> Result<String, AppError> {
    let mut value: Value = serde_json::from_str(raw).map_err(|_| error())?;
    let config = &mut value["config"];
    if let Some(id) = config["catalog"]["active"].as_str().map(str::to_owned) {
        let revision = config["catalog"]["profiles"]
            .as_array()
            .and_then(|profiles| {
                profiles
                    .iter()
                    .find(|profile| profile["id"].as_str() == Some(&id))
            })
            .and_then(|profile| profile["revision"].as_str());
        let payload = revision
            .and_then(|revision| config["payloads"].get(format!("profile:{id}:{revision}")));
        let incomplete = payload.is_none_or(|payload| payload.to_string().contains(MISSING));
        if incomplete {
            config["catalog"]["active"] = Value::Null;
        }
    }
    if config["catalog"]["settings"].to_string().contains(MISSING) {
        config["catalog"]["active"] = Value::Null;
    }
    serde_json::to_string(&value).map_err(|_| error())
}
pub fn document(raw: &str, text: bool, include: bool) -> Result<String, AppError> {
    let plain = if text {
        crate::credential_vault::unprotect_text(raw)?
    } else {
        raw.into()
    };
    match crate::credential_vault::from_str::<Value>(&plain) {
        Ok(value) => serde_json::to_string(&if include { value } else { clean(value, "") })
            .map_err(|_| error()),
        Err(_) if text && !(include && plain.contains("$siCredential")) => {
            Ok(text_document(&plain, include))
        }
        Err(error) => Err(error),
    }
}
pub fn needs_credentials(value: &Value) -> bool {
    match value {
        Value::String(s) => s.contains(MISSING),
        Value::Array(a) => a.iter().any(needs_credentials),
        Value::Object(o) => o.values().any(needs_credentials),
        _ => false,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn arbitrary_headers_pac_code_and_numeric_passwords_are_not_portable_credentials() {
        let value = clean(
            json!({"headers":{"X-Custom":"fixture-custom-secret","Accept":"application/json"},"pacScript":"function FindProxyForURL(){return 'fixture-secret';}","password":123456,"maxTokens":4096,"future":{"keep":17}}),
            "",
        );
        assert!(!value.to_string().contains("fixture-"));
        assert_eq!(value["headers"]["X-Custom"], MISSING);
        assert_eq!(value["pacScript"], "");
        assert_eq!(value["password"], MISSING);
        assert_eq!(value["maxTokens"], 4096);
        assert_eq!(value["future"]["keep"], 17);
    }
    #[test]
    fn only_the_current_profile_revision_can_keep_a_portable_network_selection_active() {
        let value = json!({"config":{"catalog":{"active":"fixture","profiles":[{"id":"fixture","revision":"new"}],"settings":{}},"payloads":{"profile:fixture:old":{"yaml":"proxies: []"},"profile:fixture:new":{"yaml":MISSING}}}});
        let restored: Value =
            serde_json::from_str(&disable_incomplete_network(&value.to_string()).unwrap()).unwrap();
        assert!(restored["config"]["catalog"]["active"].is_null());
        let mut complete = value;
        complete["config"]["payloads"]["profile:fixture:new"]["yaml"] = json!("proxies: []");
        let restored: Value =
            serde_json::from_str(&disable_incomplete_network(&complete.to_string()).unwrap())
                .unwrap();
        assert_eq!(restored["config"]["catalog"]["active"], "fixture");
        complete["config"]["catalog"]["settings"]["lanPassword"] = json!(MISSING);
        let restored: Value =
            serde_json::from_str(&disable_incomplete_network(&complete.to_string()).unwrap())
                .unwrap();
        assert!(restored["config"]["catalog"]["active"].is_null());
    }
    #[test]
    fn portable_export_preserves_unknown_structure_but_excludes_managed_secrets() {
        let original = json!({"env":{"ANTHROPIC_API_KEY":"fixture-api-key","ANTHROPIC_BASE_URL":"https://api.example.com/v1","ANTHROPIC_MODEL":"fixture-model"},"config":"model = 'fixture-model'\n[model_providers.custom]\nbase_url = 'https://api.example.com/v1'\nexperimental_bearer_token = 'fixture-toml-token'\n","unknown":{"future":17}});
        let stored = crate::credential_vault::to_string(&original).unwrap();
        let exported = document(&stored, false, false).unwrap();
        assert!(!exported.contains("$siCredential"));
        assert!(!exported.contains("fixture-api-key"));
        assert!(!exported.contains("fixture-toml-token"));
        let value: Value = serde_json::from_str(&exported).unwrap();
        assert_eq!(value["unknown"]["future"], 17);
        assert_eq!(value["env"]["ANTHROPIC_MODEL"], "fixture-model");
        assert!(needs_credentials(&value));
        let full: Value = serde_json::from_str(&document(&stored, false, true).unwrap()).unwrap();
        assert_eq!(full, original);
    }
    #[test]
    fn subscription_urls_and_authenticated_custom_proxies_need_reentry() {
        let exported = clean(
            json!({"yaml":"proxies: [{name: x,password: fixture-secret}]","url":"https://example.invalid/private/subscription"}),
            "",
        );
        assert!(!exported.to_string().contains("fixture-secret"));
        assert!(!exported.to_string().contains("private/subscription"));
        assert_eq!(safe_url("http://user:password@proxy.invalid:8888"), MISSING);
    }

    #[test]
    fn recognizable_secrets_in_user_authored_text_block_plaintext_export() {
        assert!(
            ensure_no_obvious_credentials(b"Example sk-proj-abcdefghijklmnopqrstuvwxyz123456")
                .is_err()
        );
        assert!(ensure_no_obvious_credentials(b"-----BEGIN OPENSSH PRIVATE KEY-----").is_err());
        assert!(ensure_no_obvious_credentials(b"Use your own API key here").is_ok());
    }
}
