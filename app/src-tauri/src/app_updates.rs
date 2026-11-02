//! One Sivio update channel, explicitly configured and authenticated. No
//! upstream endpoint, key, insecure transport or unbounded artifact download.
use futures::StreamExt;
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::time::Instant;
use tauri::Emitter;
use tauri::Manager;
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
            "Configure a Sivio update endpoint, not an upstream application's release feed".into(),
        );
    }
    public_key(key)?;
    Ok(())
}
use crate::update_signature::public_key;
pub(crate) use crate::update_signature::verify;
#[derive(Clone)]
pub struct Checked {
    pub update: tauri_plugin_updater::Update,
    pub key: String,
    pub revision: String,
}
pub async fn check(app: &tauri::AppHandle) -> Result<Option<Checked>, String> {
    let channel = crate::update_channel::current()?;
    if !channel.configured {
        return Err("UPDATE_CHANNEL_DISABLED: 更新通道未启用".into());
    }
    let mut builder = app
        .updater_builder()
        .endpoints(vec![
            url::Url::parse(&channel.endpoint).map_err(|_| "Invalid update endpoint")?
        ])
        .map_err(|e| e.to_string())?
        .pubkey(&channel.public_key)
        .timeout(Duration::from_secs(30))
        .configure_client(|client| client.https_only(true));
    if let Some(proxy) = crate::proxy::http_client::get_current_proxy_url() {
        builder = builder.proxy(url::Url::parse(&proxy).map_err(|_| "Invalid update proxy")?);
    }
    let update = builder
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| {
            format!("UPDATE_CHECK_FAILED: 检查失败（首次尚未发布、网络或权限问题）：{e}")
        })?;
    if crate::update_channel::current()?.revision != channel.revision {
        return Err("UPDATE_STALE: 更新源已改变，请重新检查".into());
    }
    if let Some(update) = &update {
        if update.download_url.scheme() != "https" {
            return Err("Update artifact must use HTTPS".into());
        }
    }
    Ok(update.map(|update| Checked {
        update,
        key: channel.public_key,
        revision: channel.revision,
    }))
}
async fn download(
    app: &tauri::AppHandle,
    checked: &Checked,
    candidate_id: &str,
) -> Result<Vec<u8>, String> {
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
            json!({"candidateId":candidate_id,"stage":"downloading","downloaded":bytes.len(),"total":total}),
        );
    }
    progress(app, candidate_id, "verifying");
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
    use base64::Engine;
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

static OPERATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static CANDIDATE: Lazy<Mutex<Option<Candidate>>> = Lazy::new(|| Mutex::new(None));
struct Candidate {
    id: String,
    checked: Checked,
    created: Instant,
    cancelled: Arc<tokio::sync::Notify>,
    ready: Option<tempfile::NamedTempFile>,
}
fn lock_candidate() -> std::sync::MutexGuard<'static, Option<Candidate>> {
    CANDIDATE.lock().unwrap_or_else(|e| e.into_inner())
}
fn valid_candidate<'a>(
    candidate: &'a Option<Candidate>,
    id: &str,
    revision: &str,
) -> Result<&'a Candidate, String> {
    let item = candidate.as_ref().ok_or("UPDATE_STALE: 请重新检查更新")?;
    validate_identity(
        &item.id,
        &item.checked.revision,
        item.created.elapsed(),
        id,
        revision,
    )?;
    Ok(item)
}
fn progress(app: &tauri::AppHandle, id: &str, stage: &str) {
    let _ = app.emit(
        "update-download-progress",
        json!({"candidateId":id,"stage":stage,"downloaded":0,"total":null}),
    );
}
pub async fn information(app: &tauri::AppHandle) -> Result<Value, String> {
    let _operation = OPERATION
        .try_lock()
        .map_err(|_| "UPDATE_BUSY: 更新正在进行")?;
    let checked = check(app).await?;
    let mut registry = lock_candidate();
    if let Some(previous) = registry.take() {
        previous.cancelled.notify_one();
    }
    let Some(checked) = checked else {
        return Ok(Value::Null);
    };
    let id = uuid::Uuid::new_v4().to_string();
    let info = json!({"candidateId":id,"currentVersion":checked.update.current_version,
        "availableVersion":checked.update.version,"notes":checked.update.body,
        "pubDate":checked.update.date.map(|date|date.to_string())});
    *registry = Some(Candidate {
        id,
        checked,
        created: Instant::now(),
        cancelled: Arc::new(tokio::sync::Notify::new()),
        ready: None,
    });
    Ok(info)
}
pub async fn save_channel(
    app: &tauri::AppHandle,
    endpoint: String,
    key: String,
    mode: Option<String>,
) -> Result<(), String> {
    let mut registry = lock_candidate();
    if crate::update_install::installing() {
        return Err("UPDATE_BUSY: 安装正在进行".into());
    }
    crate::settings::set_update_channel(endpoint, key, mode).map_err(|e| e.to_string())?;
    crate::update_channel::changed();
    if let Some(previous) = registry.take() {
        previous.cancelled.notify_one();
    }
    let _ = app.emit("update-channel-changed", ());
    Ok(())
}
pub fn cancel(id: &str) -> Result<(), String> {
    let mut registry = lock_candidate();
    if crate::update_install::installing() {
        return Err("UPDATE_BUSY: 安装期间不可取消".into());
    }
    if registry.as_ref().is_some_and(|c| c.id == id) {
        if let Some(candidate) = registry.take() {
            candidate.cancelled.notify_one();
        }
    }
    Ok(())
}
pub async fn download_candidate(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let _operation = OPERATION
        .try_lock()
        .map_err(|_| "UPDATE_BUSY: 更新正在进行")?;
    let (checked, cancelled) = {
        let registry = lock_candidate();
        let item = valid_candidate(&registry, id, &crate::update_channel::current()?.revision)?;
        (item.checked.clone(), item.cancelled.clone())
    };
    let result = tokio::select! {
        _ = cancelled.notified() => Err("UPDATE_CANCELLED: 下载已取消".into()),
        result = download(app, &checked, id) => result,
    };
    let bytes = match result {
        Ok(bytes) => bytes,
        Err(error) => {
            progress(app, id, "error");
            return Err(error);
        }
    };
    let mut file = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())?;
    let mut registry = lock_candidate();
    valid_candidate(&registry, id, &crate::update_channel::current()?.revision)?;
    registry.as_mut().unwrap().ready = Some(file);
    progress(app, id, "ready");
    Ok(())
}

pub async fn install(app: &tauri::AppHandle, id: &str) -> Result<bool, String> {
    let _operation = OPERATION
        .try_lock()
        .map_err(|_| "UPDATE_BUSY: 更新正在进行")?;
    let (checked, bytes, _freeze) = {
        let registry = lock_candidate();
        let item = valid_candidate(&registry, id, &crate::update_channel::current()?.revision)?;
        let path = item
            .ready
            .as_ref()
            .ok_or("UPDATE_NOT_READY: 请先下载并验证更新")?
            .path();
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        (
            item.checked.clone(),
            bytes,
            crate::update_install::InstallGuard::acquire()?,
        )
    };
    verify(&bytes, &checked.update.signature, &checked.key)?;
    #[cfg(target_os = "macos")]
    package::validate(&bytes, &checked.update.version, std::env::consts::ARCH)?;
    let bundle = crate::update_install::current_bundle()?;
    let stage = crate::update_install::prepare(&bundle, &bytes)?;
    progress(app, id, "installing");
    let result: Result<std::path::PathBuf, String> =
        tokio::time::timeout(Duration::from_secs(30), async {
            let state = app.try_state::<crate::store::AppState>();
            let _clients = if let Some(state) = state.as_ref() {
                Some(crate::mode::controller::prepare_update(state.inner()).await?)
            } else {
                None
            };
            let network = app.try_state::<crate::network::NetworkState>();
            let _network = if let Some(network) = network.as_ref() {
                Some(
                    crate::network::prepare_update(network.inner())
                        .await
                        .map_err(|e| e.to_string())?,
                )
            } else {
                None
            };
            crate::save_window_state_before_exit(app);
            crate::update_install::replace(&bundle, stage)
        })
        .await
        .unwrap_or_else(|_| {
            Err("UPDATE_PREPARE_TIMEOUT: 网络或客户端仍有操作未完成，未安装更新".into())
        });
    match result {
        Ok(backup) => {
            log::info!(
                "Update installed; previous bundle retained at {}",
                backup.display()
            );
            progress(app, id, "restarting");
            crate::restart_process(app);
        }
        Err(error) => {
            drop(_freeze);
            if let Some(network) = app.try_state::<crate::network::NetworkState>() {
                crate::network::resume_after_update_failure(app, network.inner()).await;
            }
            if let Some(state) = app.try_state::<crate::store::AppState>() {
                crate::mode::controller::startup(state.inner()).await;
            }
            progress(app, id, "error");
            Err(format!(
                "{error}。已尝试恢复原网络状态；如未恢复，请在网络页重试。"
            ))
        }
    }
}

fn validate_identity(
    actual_id: &str,
    actual_revision: &str,
    age: Duration,
    id: &str,
    revision: &str,
) -> Result<(), String> {
    if actual_id != id || actual_revision != revision || age > Duration::from_secs(1800) {
        Err("UPDATE_STALE: 更新已过期，请重新检查".into())
    } else {
        Ok(())
    }
}
#[cfg(test)]
mod candidate_tests {
    use super::*;
    #[test]
    fn candidate_cannot_cross_channel_or_expiry_boundaries() {
        assert!(validate_identity("one", "r1", Duration::ZERO, "one", "r1").is_ok());
        assert!(validate_identity("one", "r1", Duration::ZERO, "two", "r1").is_err());
        assert!(validate_identity("one", "r1", Duration::ZERO, "one", "r2").is_err());
        assert!(validate_identity("one", "r1", Duration::from_secs(1801), "one", "r1").is_err());
    }
}
