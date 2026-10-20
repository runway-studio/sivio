//! One Sivio update channel, explicitly configured and authenticated. No
//! upstream endpoint, key, insecure transport or unbounded artifact download.
use base64::Engine;
use futures::StreamExt;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::Emitter;
use tauri_plugin_updater::UpdaterExt;
const MAX: u64 = 512 * 1024 * 1024;
#[cfg(target_os = "macos")]
#[path = "update_package.rs"]
mod package;
pub fn validate(endpoint: &str, key: &str) -> Result<(), String> {
    if endpoint.is_empty() && key.is_empty() {
        return Ok(());
    }
    if endpoint.len() > 4096 || key.len() > 4096 {
        return Err("Update configuration exceeds size limit".into());
    }
    let url = url::Url::parse(endpoint).map_err(|_| "Update endpoint must be a valid HTTPS URL")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Update endpoint must use HTTPS without credentials, query or fragment".into());
    }
    if endpoint.contains("ccswitch.io")
        || endpoint.contains("farion1231/cc-switch")
        || endpoint.contains("clash-verge-rev/clash-verge-rev")
    {
        return Err(
            "Configure a Sivio update endpoint, not an upstream application's release feed"
                .into(),
        );
    }
    public_key(key)?;
    Ok(())
}
fn decoded(raw: &str) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw.trim())
        .map_err(|_| "Invalid base64 update signature material")?;
    String::from_utf8(bytes).map_err(|_| "Invalid UTF-8 update signature material".into())
}
fn public_key(key: &str) -> Result<minisign_verify::PublicKey, String> {
    minisign_verify::PublicKey::decode(&decoded(key)?)
        .map_err(|_| "Invalid Tauri/minisign update public key".into())
}
pub(crate) fn verify(bytes: &[u8], signature: &str, key: &str) -> Result<(), String> {
    let signature = minisign_verify::Signature::decode(&decoded(signature)?)
        .map_err(|_| "Invalid update artifact signature")?;
    public_key(key)?
        .verify(bytes, &signature, true)
        .map_err(|_| {
            "Update signature verification failed; the installed app was not changed".into()
        })
}
pub struct Checked {
    pub update: tauri_plugin_updater::Update,
    pub key: String,
}
pub async fn check(app: &tauri::AppHandle) -> Result<Option<Checked>, String> {
    crate::settings::validate_settings_storage().map_err(|e| e.to_string())?;
    let settings = crate::settings::get_settings();
    if settings.update_endpoint.is_empty() || settings.update_public_key.is_empty() {
        return Err("UPDATE_CHANNEL_NOT_CONFIGURED: Sivio 尚未配置自有更新源与公钥".into());
    }
    validate(&settings.update_endpoint, &settings.update_public_key)?;
    let updater =
        app.updater_builder()
            .endpoints(vec![url::Url::parse(&settings.update_endpoint)
                .map_err(|_| "Invalid update endpoint")?])
            .map_err(|_| "Invalid update endpoint")?
            .pubkey(&settings.update_public_key)
            .timeout(Duration::from_secs(30))
            .configure_client(|client| client.https_only(true))
            .build()
            .map_err(|e| format!("Update initialization failed: {e}"))?;
    let update = updater.check().await.map_err(|_| {
        "Sivio update check failed; verify connectivity and the configured feed"
    })?;
    if let Some(update) = &update {
        if update.download_url.scheme() != "https" {
            return Err("Update artifact must use HTTPS".into());
        }
    }
    Ok(update.map(|update| Checked {
        update,
        key: settings.update_public_key,
    }))
}
pub async fn information(app: &tauri::AppHandle) -> Result<Value, String> {
    Ok(match check(app).await? {
        None => Value::Null,
        Some(checked) => {
            json!({"currentVersion":checked.update.current_version,"availableVersion":checked.update.version,"notes":checked.update.body,"pubDate":checked.update.date.map(|date|date.to_string())})
        }
    })
}
pub async fn download(app: &tauri::AppHandle, checked: &Checked) -> Result<Vec<u8>, String> {
    let mut builder = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::limited(3))
        .timeout(Duration::from_secs(300));
    if let Some(proxy) = crate::proxy::http_client::get_current_proxy_url() {
        builder = builder
            .proxy(reqwest::Proxy::all(proxy).map_err(|_| "Invalid configured update proxy")?);
    }
    let response = builder
        .build()
        .map_err(|_| "Cannot initialize update download")?
        .get(checked.update.download_url.clone())
        .send()
        .await
        .map_err(|_| "Update download failed")?
        .error_for_status()
        .map_err(|_| "Update download returned an unsuccessful HTTP status")?;
    let total = response.content_length();
    if total.is_some_and(|size| size > MAX) {
        return Err("Update artifact exceeds 512 MiB".into());
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "Update transfer was interrupted")?;
        if bytes.len() as u64 + chunk.len() as u64 > MAX {
            return Err("Update artifact exceeds 512 MiB".into());
        }
        bytes.extend_from_slice(&chunk);
        let _ = app.emit(
            "update-download-progress",
            json!({"downloaded":bytes.len(),"total":total}),
        );
    }
    verify(&bytes, &checked.update.signature, &checked.key)?;
    #[cfg(target_os = "macos")]
    {
        let version = checked.update.version.clone();
        return tauri::async_runtime::spawn_blocking(move || {
            package::validate(&bytes, &version, std::env::consts::ARCH)?;
            Ok(bytes)
        })
        .await
        .map_err(|_| "Update package validation task failed".to_owned())?;
    }
    #[cfg(not(target_os = "macos"))]
    Ok(bytes)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn valid_signature_and_tampered_artifact_follow_the_same_verifier_as_download() {
        // Public reference vector from minisign-verify 0.2.5; no private key.
        let key=base64::engine::general_purpose::STANDARD.encode("untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3");
        let signature=base64::engine::general_purpose::STANDARD.encode("untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1556193335\tfile:test\ny/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==");
        assert!(validate("https://updates.example.invalid/{{target}}/{{arch}}", &key).is_ok());
        assert!(verify(b"test", &signature, &key).is_ok());
        assert!(verify(b"tampered", &signature, &key).is_err());
    }
    #[test]
    fn unconfigured_is_valid_storage_but_upstream_insecure_and_invalid_keys_are_not() {
        assert!(validate("", "").is_ok());
        for endpoint in [
            "http://updates.example.invalid",
            "https://user:password@updates.example.invalid",
            "https://updates.example.invalid?token=x",
            "https://ccswitch.io/update",
        ] {
            assert!(validate(endpoint, "fixture").is_err());
        }
        assert!(validate(
            "https://updates.example.invalid/{{target}}/{{arch}}",
            "fixture"
        )
        .is_err());
        assert!(verify(b"fixture app", "broken signature", "broken key").is_err());
    }
}
