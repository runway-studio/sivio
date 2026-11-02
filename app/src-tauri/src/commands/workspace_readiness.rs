use crate::{
    app_config::AppType,
    services::{client_diagnostic, workspace_readiness},
    store::AppState,
};
use std::str::FromStr;
#[tauri::command]
pub async fn get_workspace_readiness(
    state: tauri::State<'_, AppState>,
    app_type: String,
) -> Result<workspace_readiness::Snapshot, String> {
    let app = AppType::from_str(&app_type).map_err(|_| "unsupported_client")?;
    client_diagnostic::snapshot(state.inner(), &app).await
}
#[tauri::command]
pub async fn start_client_diagnostic(
    state: tauri::State<'_, AppState>,
    app_type: String,
    expected: client_diagnostic::Identity,
    provider_id: String,
    model: String,
    active_probe: bool,
) -> Result<client_diagnostic::Run, String> {
    let app = AppType::from_str(&app_type).map_err(|_| "unsupported_client")?;
    client_diagnostic::start(
        state.inner().clone(),
        app,
        expected,
        provider_id,
        model,
        active_probe,
    )
    .await
}
#[tauri::command]
pub fn cancel_client_diagnostic(run_id: String) -> bool {
    client_diagnostic::cancel(&run_id)
}

#[tauri::command]
pub fn onboarding_desktop_installed() -> bool {
    std::path::Path::new("/Applications/Claude.app").is_dir()
        || crate::config::get_home_dir()
            .join("Applications/Claude.app")
            .is_dir()
}
#[tauri::command]
pub fn open_onboarding_desktop() -> Result<(), String> {
    if !onboarding_desktop_installed() {
        return Err("client_not_installed".into());
    }
    std::process::Command::new("/usr/bin/open")
        .args(["-a", "Claude"])
        .spawn()
        .map_err(|_| "client_launch_failed".to_string())?;
    Ok(())
}
