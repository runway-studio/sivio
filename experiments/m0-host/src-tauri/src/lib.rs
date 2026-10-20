mod profile;
mod provider;

use serde::Serialize;
use serde_json::{Value, json};
use tauri::Manager;

const INPUT_LIMIT: usize = 16 * 1024 * 1024;

pub fn inspect_provider(raw: &str) -> Result<Value, String> {
    if raw.len() > INPUT_LIMIT { return Err("INPUT_TOO_LARGE".into()); }
    let provider: provider::Provider = serde_json::from_str(raw).map_err(|_| "INVALID_PROVIDER_JSON")?;
    if provider.id.trim().is_empty() || provider.name.trim().is_empty() || !provider.settings_config.is_object() {
        return Err("INVALID_PROVIDER_FIELDS".into());
    }
    Ok(json!({"id":provider.id,"name":provider.name,"settingsKeys":provider.settings_config.as_object().unwrap().keys().collect::<Vec<_>>(),"metadataPreserved":true,"scope":"schema probe; no CLI files changed"}))
}

pub fn inspect_yaml(raw: &str) -> Result<(), String> {
    if raw.len() > INPUT_LIMIT { return Err("INPUT_TOO_LARGE".into()); }
    let yaml: serde_yaml_ng::Value = serde_yaml_ng::from_str(raw).map_err(|_| "YAML_SYNTAX")?;
    if !yaml.is_mapping() { return Err("YAML_MAPPING_REQUIRED".into()); }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
struct ProfileReport { syntax_valid: bool, core_valid: Option<bool>, status: String }

#[tauri::command]
fn provider_probe(raw: String) -> Result<Value, String> { inspect_provider(&raw) }

#[tauri::command]
fn profile_home_probe(raw: String) -> Option<String> { profile::normalize_profile_home_url(&raw) }

#[tauri::command]
async fn profile_probe(app: tauri::AppHandle, raw: String) -> Result<ProfileReport, String> {
    inspect_yaml(&raw)?;
    let core = app.path().resource_dir().map_err(|_| "RESOURCE_DIRECTORY")?.join("bin/mihomo");
    if !core.is_file() {
        return Ok(ProfileReport { syntax_valid:true, core_valid:None, status:"CORE_NOT_BUNDLED".into() });
    }
    let dir = tempfile::tempdir().map_err(|_| "TEMP_DIRECTORY")?;
    let file = dir.path().join("profile.yaml");
    std::fs::write(&file, raw).map_err(|_| "TEMP_WRITE")?;
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).map_err(|_| "TEMP_PERMISSIONS")?;
    }
    let mut command = tokio::process::Command::new(core);
    command.args(["-t", "-d"]).arg(dir.path()).arg("-f").arg(&file).kill_on_drop(true);
    command.stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    let status = tokio::time::timeout(std::time::Duration::from_secs(5), command.status()).await
        .map_err(|_| "CORE_VALIDATION_TIMEOUT")?.map_err(|_| "CORE_SPAWN_FAILED")?;
    Ok(ProfileReport { syntax_valid:true, core_valid:Some(status.success()), status:if status.success(){"CORE_VALID"}else{"CORE_REJECTED"}.into() })
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![provider_probe, profile_probe, profile_home_probe])
        .run(tauri::generate_context!())
        .expect("SI Assist M0 host failed");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn provider_roundtrip_retains_unrecognized_fields_and_opaque_metadata() {
        let raw = r#"{"id":"probe","name":"Fixture","settingsConfig":{"env":{}},"meta":{"future":{"x":1}},"futureRoot":[1,2]}"#;
        let provider: provider::Provider = serde_json::from_str(raw).unwrap();
        let output = serde_json::to_value(provider).unwrap();
        assert_eq!(output["futureRoot"], json!([1,2]));
        assert_eq!(output["meta"]["future"]["x"], 1);
        assert!(inspect_provider(raw).is_ok());
    }
    #[test]
    fn invalid_inputs_do_not_report_success() {
        assert!(inspect_provider(r#"{"id":"x","name":"x","settingsConfig":null}"#).is_err());
        assert!(inspect_yaml("[1, 2]").is_err());
        assert!(inspect_yaml("key: [").is_err());
        assert!(inspect_yaml("mixed-port: 15722\nmode: rule\nrules: [MATCH,DIRECT]").is_ok());
        assert_eq!(profile::normalize_profile_home_url("file:///etc/passwd"), None);
        assert!(profile::normalize_profile_home_url("https://example.com").is_some());
    }
}
