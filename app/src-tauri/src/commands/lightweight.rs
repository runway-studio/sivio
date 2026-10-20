#[tauri::command]
pub fn enter_lightweight_mode(
    app: tauri::AppHandle,
    automatic: Option<bool>,
) -> Result<(), String> {
    if automatic == Some(true) && !crate::desktop_preferences::automatic_allowed(&app) {
        return Ok(());
    }
    crate::lightweight::enter_lightweight_mode(&app)
}

#[tauri::command]
pub fn exit_lightweight_mode(app: tauri::AppHandle) -> Result<(), String> {
    crate::lightweight::exit_lightweight_mode(&app)
}

#[tauri::command]
pub fn is_lightweight_mode() -> bool {
    crate::lightweight::is_lightweight_mode()
}
