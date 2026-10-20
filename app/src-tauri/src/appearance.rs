//! Public appearance preferences share the configuration snapshot, while a
//! native recovery action remains available even when custom CSS hides the UI.
use crate::{database::Database, error::AppError};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};
const KEY: &str = "si_assist_appearance";
static RESET: AtomicBool = AtomicBool::new(false);
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Appearance {
    pub font_family: String,
    pub font_size: u8,
    pub editor_font_family: String,
    pub editor_font_size: u8,
    pub accent: String,
    pub css: String,
    pub notice_position: String,
}
impl Default for Appearance {
    fn default() -> Self {
        Self {
            font_family: String::new(),
            font_size: 0,
            editor_font_family: String::new(),
            editor_font_size: 0,
            accent: String::new(),
            css: String::new(),
            notice_position: "bottom-center".into(),
        }
    }
}
impl Appearance {
    pub fn validate(&self) -> Result<(), AppError> {
        let error = || {
            AppError::Config("Invalid appearance settings: use local CSS without imports, resources or escapes; choose valid font sizes, color and notification position".into())
        };
        for font in [&self.font_family, &self.editor_font_family] {
            if font.len() > 160
                || !font
                    .chars()
                    .all(|c| c.is_alphanumeric() || " -_,.".contains(c))
            {
                return Err(error());
            }
        }
        if self.font_size != 0 && !(11..=24).contains(&self.font_size)
            || self.editor_font_size != 0 && !(10..=32).contains(&self.editor_font_size)
        {
            return Err(error());
        }
        if !self.accent.is_empty()
            && !(self.accent.len() == 7
                && self.accent.starts_with('#')
                && self.accent[1..].bytes().all(|c| c.is_ascii_hexdigit()))
        {
            return Err(error());
        }
        if ![
            "top-left",
            "top-center",
            "top-right",
            "bottom-left",
            "bottom-center",
            "bottom-right",
        ]
        .contains(&self.notice_position.as_str())
        {
            return Err(error());
        }
        if self.css.len() > 32 * 1024
            || self.css.contains('\\')
            || self
                .css
                .chars()
                .any(|c| c.is_control() && !"\r\n\t".contains(c))
            || regex::Regex::new(r"(?i)(?:url|image-set)\s*\(|@import|(?:https?|file|asset|data):")
                .unwrap()
                .is_match(&self.css)
        {
            return Err(error());
        }
        Ok(())
    }
}
pub fn read(db: &Database) -> Result<serde_json::Value, AppError> {
    let raw = db.get_setting(KEY)?;
    let preferences: Appearance = raw
        .as_ref()
        .map(|raw| serde_json::from_str(raw))
        .transpose()
        .map_err(|_| {
            AppError::Config(
                "Appearance preferences are invalid; use the native Reset appearance action".into(),
            )
        })?
        .unwrap_or_default();
    preferences.validate()?;
    Ok(
        serde_json::json!({"preferences":preferences,"revision":raw.as_ref().map(|raw|crate::services::sync_protocol::sha256_hex(raw.as_bytes()))}),
    )
}
pub fn save(
    db: &Database,
    value: serde_json::Value,
    expected: Option<&str>,
) -> Result<serde_json::Value, AppError> {
    let preferences: Appearance = serde_json::from_value(value)
        .map_err(|_| AppError::Config("Invalid appearance preferences".into()))?;
    preferences.validate()?;
    let current = db.get_setting(KEY)?;
    if current
        .as_ref()
        .map(|raw| crate::services::sync_protocol::sha256_hex(raw.as_bytes()))
        .as_deref()
        != expected
    {
        return Err(AppError::Config(
            "Appearance changed externally; reload before saving".into(),
        ));
    }
    let raw = serde_json::to_string(&preferences).map_err(|e| AppError::Config(e.to_string()))?;
    db.compare_and_set_setting(KEY, current.as_deref(), &raw)?;
    read(db)
}
pub fn restore_defaults(db: &Database) -> Result<serde_json::Value, AppError> {
    if db.get_setting(KEY)?.as_deref() != Some("{}") {
        db.set_setting(KEY, "{}")?;
    }
    read(db)
}
#[tauri::command]
pub fn take_appearance_reset() -> bool {
    RESET.swap(false, Ordering::AcqRel)
}
pub fn reset(app: &tauri::AppHandle) {
    RESET.store(true, Ordering::Release);
    if let Some(state) = app.try_state::<crate::store::AppState>() {
        if let Err(error) = restore_defaults(&state.db) {
            log::warn!("Appearance reset persistence failed: {error}");
        }
    }
    crate::tray::show_main_window(app);
    if let Some(window) = app.get_webview_window("main") {
        // Fixed recovery code, independent of React listeners or custom CSS.
        let _=window.eval("try { localStorage.removeItem('si-assist-appearance'); localStorage.setItem('si-assist-appearance-safe-mode','1'); } catch (_) {} document.getElementById('si-assist-appearance')?.remove();");
    }
    let _ = app.emit("appearance-reset", ());
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_styles_are_allowed_but_resources_escapes_and_stale_writes_are_rejected() {
        let db = Database::memory().unwrap();
        let mut preferences = Appearance::default();
        preferences.css = "body { border-radius: 12px; }".into();
        save(&db, serde_json::to_value(&preferences).unwrap(), None).unwrap();
        assert!(save(&db, serde_json::to_value(&preferences).unwrap(), None).is_err());
        for css in [
            "@import 'style.css';",
            "body{background:url(secret)}",
            "body{background:image-set('secret.png' 1x)}",
            r"body{background:u\72l(secret)}",
        ] {
            preferences.css = css.into();
            assert!(preferences.validate().is_err());
        }
    }
}
