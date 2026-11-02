use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicU64, Ordering};

static REVISION: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Official {
    pub endpoint: String,
    pub public_key: String,
    pub release_page: String,
    pub signing_mode: String,
}

pub fn official() -> Official {
    serde_json::from_str(include_str!("../release-config.json"))
        .expect("invalid release-config.json")
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub mode: String,
    pub endpoint: String,
    pub public_key: String,
    pub configured: bool,
    pub revision: String,
    pub release_page: String,
    pub signing_mode: String,
}

pub fn resolve(settings: &crate::settings::AppSettings) -> Result<Channel, String> {
    resolve_with(
        settings.update_channel_mode.as_deref(),
        &settings.update_endpoint,
        &settings.update_public_key,
        official(),
    )
}

fn resolve_with(
    mode: Option<&str>,
    endpoint: &str,
    key: &str,
    official: Official,
) -> Result<Channel, String> {
    let mode = mode.unwrap_or(if endpoint.is_empty() && key.is_empty() {
        "official"
    } else {
        "custom"
    });
    let (endpoint, key) = match mode {
        "official" => (official.endpoint, official.public_key),
        "custom" if !endpoint.is_empty() && !key.is_empty() => (endpoint.into(), key.into()),
        "disabled" => (String::new(), String::new()),
        _ => return Err("UPDATE_CHANNEL_INVALID: 更新通道配置不完整".into()),
    };
    crate::app_updates::validate(&endpoint, &key)?;
    let configured = mode != "disabled" && !endpoint.is_empty() && !key.is_empty();
    let revision = format!(
        "{}:{:x}",
        REVISION.load(Ordering::SeqCst),
        Sha256::digest(format!("{mode}\n{endpoint}\n{key}"))
    );
    Ok(Channel {
        mode: mode.into(),
        endpoint,
        public_key: key,
        configured,
        revision,
        release_page: official.release_page,
        signing_mode: official.signing_mode,
    })
}

pub fn current() -> Result<Channel, String> {
    crate::settings::validate_settings_storage().map_err(|e| e.to_string())?;
    resolve(&crate::settings::get_settings())
}

pub fn changed() {
    REVISION.fetch_add(1, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migrations_preserve_explicit_modes_and_reject_partial_settings() {
        let official = official();
        let empty = resolve_with(None, "", "", official.clone()).unwrap();
        assert_eq!(empty.mode, "official");
        assert!(empty.configured);
        let custom = resolve_with(
            None,
            "https://example.org/latest.json",
            &official.public_key,
            official.clone(),
        )
        .unwrap();
        assert_eq!(custom.mode, "custom");
        assert!(
            !resolve_with(Some("disabled"), "", "", official.clone())
                .unwrap()
                .configured
        );
        assert!(resolve_with(None, "https://example.org", "", official).is_err());
        assert_ne!(empty.revision, custom.revision);
    }
}
