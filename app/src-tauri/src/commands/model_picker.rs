use crate::{
    proxy::route_trace::Decision,
    services::model_picker::{self, Catalog},
    store::AppState,
};
use std::str::FromStr;
#[tauri::command]
pub async fn get_model_picker_catalog(
    state: tauri::State<'_, AppState>,
    app_type: String,
) -> Result<Catalog, String> {
    let app = crate::app_config::AppType::from_str(&app_type).map_err(|e| e.to_string())?;
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || model_picker::catalog(&state, &app))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn select_client_model(
    handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    app_type: String,
    provider_id: String,
    model: String,
    revision: String,
) -> Result<Catalog, String> {
    let app = crate::app_config::AppType::from_str(&app_type).map_err(|e| e.to_string())?;
    let state = state.inner().clone();
    let result = tokio::task::spawn_blocking(move || {
        model_picker::select(&state, app, &provider_id, &model, &revision)
    })
    .await
    .map_err(|e| e.to_string())?;
    crate::tray::refresh_tray_menu(&handle);
    result
}
#[tauri::command]
pub async fn get_route_decisions(
    state: tauri::State<'_, AppState>,
    app_type: Option<String>,
) -> Result<Vec<Decision>, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        db.route_decisions(app_type.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_routing_groups(
    state: tauri::State<'_, AppState>,
    app_type: String,
) -> Result<crate::services::routing_groups::Snapshot, String> {
    let app = crate::app_config::AppType::from_str(&app_type).map_err(|e| e.to_string())?;
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || crate::services::routing_groups::read(&db, &app))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn update_routing_group(
    state: tauri::State<'_, AppState>,
    app_type: String,
    group: crate::services::routing_groups::Group,
    revision: String,
    delete: bool,
) -> Result<crate::services::routing_groups::Snapshot, String> {
    let app = crate::app_config::AppType::from_str(&app_type).map_err(|e| e.to_string())?;
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        crate::services::routing_groups::update(&state, &app, group, &revision, delete)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_routing_live(state: tauri::State<'_, AppState>) -> crate::proxy::routing_live::Snapshot {
    state.proxy_service.routing_live.snapshot()
}
