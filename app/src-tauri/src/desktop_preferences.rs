//! Device interaction preferences and transactional global-shortcut registration.
//! Only this module can register shortcuts; the renderer has no plugin capability.
use crate::{database::Database, error::AppError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, str::FromStr, sync::RwLock, time::Instant};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
const KEY: &str = "si_assist_desktop";
pub const ACTIONS: &[&str] = &[
    "open_or_close_dashboard",
    "clash_mode_rule",
    "clash_mode_global",
    "clash_mode_direct",
    "toggle_system_proxy",
    "toggle_tun_mode",
    "entry_lightweight_mode",
    "reactivate_profiles",
    "quit",
    "hide",
];
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Preferences {
    pub start_page: String,
    pub auto_lightweight_minutes: u16,
    pub global_shortcuts_enabled: bool,
    pub hotkeys: BTreeMap<String, String>,
    pub tray_click_action: String,
    pub tray_icon: String,
    pub traffic_graph: bool,
    pub memory_usage: bool,
    pub group_icons: bool,
    pub pause_traffic_on_blur: bool,
    pub proxy_columns: u8,
    pub group_tools_position: String,
    pub menu_icon: String,
    pub menu_order: Vec<String>,
    pub hover_group_navigation: bool,
    pub hover_group_delay: u16,
    pub env_type: String,
    pub auto_check_update: bool,
    pub home_cards: Vec<String>,
    pub log_max_size_mib: u8,
    pub log_archive_count: u8,
    pub log_clean_days: u16,
    pub auto_backup_on_change: bool,
    pub tray_speed: bool,
    pub tray_groups_mode: String,
    pub tray_inline_modes: bool,
    pub tray_normal_image: Option<String>,
    pub tray_normal_image_enabled: bool,
    pub tray_proxy_image: Option<String>,
    pub tray_proxy_image_enabled: bool,
    pub tray_tun_image: Option<String>,
    pub tray_tun_image_enabled: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            start_page: "remember".into(),
            auto_lightweight_minutes: 0,
            global_shortcuts_enabled: false,
            hotkeys: Default::default(),
            tray_click_action: "menu".into(),
            tray_icon: "template".into(),
            traffic_graph: true,
            memory_usage: true,
            group_icons: true,
            pause_traffic_on_blur: true,
            proxy_columns: 3,
            group_tools_position: "right".into(),
            menu_icon: "monochrome".into(),
            menu_order: Vec::new(),
            hover_group_navigation: true,
            hover_group_delay: 500,
            env_type: "bash".into(),
            auto_check_update: true,
            log_max_size_mib: 10,
            log_archive_count: 4,
            log_clean_days: 7,
            auto_backup_on_change: false,
            tray_speed: false,
            tray_groups_mode: "default".into(),
            tray_inline_modes: false,
            tray_normal_image: None,
            tray_normal_image_enabled: false,
            tray_proxy_image: None,
            tray_proxy_image_enabled: false,
            tray_tun_image: None,
            tray_tun_image_enabled: false,
            home_cards: vec![
                "usage".into(),
                "router".into(),
                "network".into(),
                "providers".into(),
            ],
        }
    }
}
/// Only non-secret desktop JSON is read before logging starts. This read-only
/// bootstrap never invokes the vault, migrates schema or opens other App data.
pub fn bootstrap() -> Preferences {
    (|| -> Option<Preferences> {
        let path = crate::config::get_app_config_dir().join("cc-switch.db");
        let connection =
            rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .ok()?;
        let raw: String = connection
            .query_row("SELECT value FROM settings WHERE key=?1", [KEY], |row| {
                row.get(0)
            })
            .ok()?;
        decode(Some(&raw)).ok()
    })()
    .unwrap_or_default()
}
type Bindings = BTreeMap<u32, (String, Shortcut)>;
fn bindings(preferences: &Preferences) -> Result<Bindings, AppError> {
    if ![
        "remember",
        "overview",
        "network",
        "providers",
        "usage",
        "auth",
        "mcp",
        "skills",
        "prompts",
        "sessions",
        "apps",
    ]
    .contains(&preferences.start_page.as_str())
        || preferences.auto_lightweight_minutes > 1440
        || !["menu", "window"].contains(&preferences.tray_click_action.as_str())
        || !["template", "color"].contains(&preferences.tray_icon.as_str())
    {
        return Err(AppError::Config("Invalid desktop preference".into()));
    }
    let unique_known = |values: &[String], allowed: &[&str]| {
        values.len() <= allowed.len()
            && values.iter().all(|v| allowed.contains(&v.as_str()))
            && values
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                == values.len()
    };
    if !(1..=20).contains(&preferences.log_max_size_mib)
        || !(1..=8).contains(&preferences.log_archive_count)
        || u16::from(preferences.log_max_size_mib) * (u16::from(preferences.log_archive_count) + 1)
            > 80
        || ![0, 1, 7, 30, 90].contains(&preferences.log_clean_days)
        || !(1..=6).contains(&preferences.proxy_columns)
        || preferences.hover_group_delay > 5000
        || !["left", "right"].contains(&preferences.group_tools_position.as_str())
        || !["monochrome", "colorful", "disable"].contains(&preferences.menu_icon.as_str())
        || !["bash", "fish", "cmd", "powershell", "nushell"]
            .contains(&preferences.env_type.as_str())
        || !unique_known(
            &preferences.menu_order,
            &[
                "overview", "network", "mcp", "skills", "prompts", "sessions", "auth", "usage",
            ],
        )
        || !unique_known(
            &preferences.home_cards,
            &["usage", "router", "network", "providers"],
        )
    {
        return Err(AppError::Config(
            "Invalid workspace presentation preferences".into(),
        ));
    }
    if !["default", "inline", "disable"].contains(&preferences.tray_groups_mode.as_str()) {
        return Err(AppError::Config("Invalid tray proxy-group mode".into()));
    }
    for image in [
        &preferences.tray_normal_image,
        &preferences.tray_proxy_image,
        &preferences.tray_tun_image,
    ]
    .into_iter()
    .flatten()
    {
        if !image.starts_with(crate::services::provider::icon::CUSTOM_ICON_PREFIX) {
            return Err(AppError::Config(
                "Tray images must be normalized PNG data".into(),
            ));
        }
        crate::services::provider::icon::validate_icon(Some(image))?;
    }
    let mut result = BTreeMap::new();
    for (action, key) in &preferences.hotkeys {
        if !ACTIONS.contains(&action.as_str()) || key.len() > 100 {
            return Err(AppError::Config(
                "Unknown shortcut action or invalid accelerator".into(),
            ));
        }
        if key.trim().is_empty() {
            continue;
        }
        let shortcut = Shortcut::from_str(key)
            .map_err(|_| AppError::Config(format!("Invalid shortcut for {action}")))?;
        if !shortcut
            .mods
            .intersects(Modifiers::CONTROL | Modifiers::SUPER | Modifiers::ALT)
        {
            return Err(AppError::Config(
                "Global shortcuts need Command, Control or Option".into(),
            ));
        }
        if result
            .insert(shortcut.id(), (action.clone(), shortcut))
            .is_some()
        {
            return Err(AppError::Config(
                "The same global shortcut is assigned to multiple actions".into(),
            ));
        }
    }
    if !preferences.global_shortcuts_enabled {
        result.clear();
    }
    Ok(result)
}
pub struct DesktopState {
    preferences: RwLock<Preferences>,
    bindings: RwLock<Bindings>,
    serial: tokio::sync::Mutex<()>,
    registration_error: RwLock<Option<String>>,
    blurred_at: std::sync::Mutex<Option<Instant>>,
}
pub fn current(app: &tauri::AppHandle) -> Preferences {
    app.try_state::<DesktopState>()
        .map(|s| {
            s.preferences
                .read()
                .unwrap_or_else(|e| e.into_inner())
                .clone()
        })
        .unwrap_or_default()
}
pub fn focus_changed(app: &tauri::AppHandle, focused: bool) {
    if let Some(state) = app.try_state::<DesktopState>() {
        let mut blurred = state.blurred_at.lock().unwrap_or_else(|e| e.into_inner());
        if focused {
            *blurred = None;
        } else if blurred.is_none() {
            *blurred = Some(Instant::now());
        }
    }
}
pub fn automatic_allowed(app: &tauri::AppHandle) -> bool {
    let Some(state) = app.try_state::<DesktopState>() else {
        return false;
    };
    let minutes = state
        .preferences
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .auto_lightweight_minutes;
    minutes > 0
        && state
            .blurred_at
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some_and(|time| time.elapsed().as_secs() >= u64::from(minutes) * 60)
}
fn decode(raw: Option<&str>) -> Result<Preferences, AppError> {
    let preferences: Preferences = raw
        .map(serde_json::from_str)
        .transpose()
        .map_err(|_| {
            AppError::Config("Desktop preferences are invalid; reset them in Settings".into())
        })?
        .unwrap_or_default();
    bindings(&preferences)?;
    Ok(preferences)
}
fn revision(raw: Option<&str>) -> Option<String> {
    raw.map(|s| crate::services::sync_protocol::sha256_hex(s.as_bytes()))
}
pub fn read(app: &tauri::AppHandle, db: &Database) -> Result<Value, AppError> {
    let raw = db.get_setting(KEY)?;
    let preferences = decode(raw.as_deref())?;
    let error = app.try_state::<DesktopState>().and_then(|s| {
        s.registration_error
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    });
    Ok(
        json!({"preferences":preferences,"revision":revision(raw.as_deref()),"registrationError":error,"localBackup":crate::services::local_backup::status(),"startupScript":crate::desktop_startup_script::snapshot()}),
    )
}
trait Registrar {
    fn register(&self, key: Shortcut) -> Result<(), String>;
    fn unregister(&self, key: Shortcut) -> Result<(), String>;
}
struct NativeRegistrar<'a>(&'a tauri::AppHandle);
impl Registrar for NativeRegistrar<'_> {
    fn register(&self, key: Shortcut) -> Result<(), String> {
        self.0
            .global_shortcut()
            .register(key)
            .map_err(|e| e.to_string())
    }
    fn unregister(&self, key: Shortcut) -> Result<(), String> {
        self.0
            .global_shortcut()
            .unregister(key)
            .map_err(|e| e.to_string())
    }
}
/// Keep old callbacks active until native registration and durable CAS both succeed.
fn transition(
    registry: &impl Registrar,
    old: &Bindings,
    new: &Bindings,
    commit: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let mut added = Vec::new();
    let mut removed = Vec::new();
    let result = (|| {
        for (id, (_, key)) in new {
            if !old.contains_key(id) {
                registry
                    .register(*key)
                    .map_err(|e| format!("Shortcut conflict or registration denied: {e}"))?;
                added.push(*key);
            }
        }
        for (id, (_, key)) in old {
            if !new.contains_key(id) {
                registry.unregister(*key)?;
                removed.push(*key);
            }
        }
        commit()
    })();
    if let Err(error) = result {
        let mut recovery = Vec::new();
        for key in removed {
            if let Err(e) = registry.register(key) {
                recovery.push(e);
            }
        }
        for key in added {
            if let Err(e) = registry.unregister(key) {
                recovery.push(e);
            }
        }
        return Err(if recovery.is_empty() {
            error
        } else {
            format!(
                "{error}; restoring previous shortcuts also failed: {}",
                recovery.join("; ")
            )
        });
    }
    Ok(())
}
pub async fn save(
    app: &tauri::AppHandle,
    value: Value,
    expected: Option<String>,
) -> Result<Value, AppError> {
    let preferences: Preferences = serde_json::from_value(value)
        .map_err(|_| AppError::Config("Invalid desktop preferences".into()))?;
    let desired = bindings(&preferences)?;
    let state = app.state::<DesktopState>();
    let _serial = state.serial.lock().await;
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let db = &app.state::<crate::store::AppState>().db;
        let raw = db.get_setting(KEY)?;
        if revision(raw.as_deref()) != expected {
            return Err(AppError::Config(
                "Desktop preferences changed; reload before saving".into(),
            ));
        }
        let encoded =
            serde_json::to_string(&preferences).map_err(|e| AppError::Config(e.to_string()))?;
        let state = app.state::<DesktopState>();
        #[cfg(target_os = "macos")]
        crate::macos_shortcuts::check(&app, desired.values().cloned().collect())
            .map_err(AppError::Config)?;
        let old = state
            .bindings
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        if let Err(error) = transition(&NativeRegistrar(&app), &old, &desired, || {
            db.compare_and_set_setting(KEY, raw.as_deref(), &encoded)
                .map_err(|e| e.to_string())
        }) {
            *state
                .registration_error
                .write()
                .unwrap_or_else(|e| e.into_inner()) = Some(error.clone());
            return Err(AppError::Config(error));
        }
        *state.bindings.write().unwrap_or_else(|e| e.into_inner()) = desired;
        *state.preferences.write().unwrap_or_else(|e| e.into_inner()) = preferences;
        *state
            .registration_error
            .write()
            .unwrap_or_else(|e| e.into_inner()) = None;
        if let Some(tray) = app.tray_by_id(crate::tray::TRAY_ID) {
            let _ = tray.set_show_menu_on_left_click(current(&app).tray_click_action == "menu");
        }
        crate::tray::refresh_tray_menu(&app);
        let _ = app.emit("desktop-preferences-changed", ());
        read(&app, db)
    })
    .await
    .map_err(|e| AppError::Config(e.to_string()))?
}
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            let action = app.try_state::<DesktopState>().and_then(|s| {
                s.bindings
                    .read()
                    .unwrap_or_else(|e| e.into_inner())
                    .get(&shortcut.id())
                    .map(|(action, _)| action.clone())
            });
            if let Some(action) = action {
                dispatch(app, &action);
            }
        })
        .build()
}
fn dispatch(app: &tauri::AppHandle, action: &str) {
    match action {
        "open_or_close_dashboard" => {
            if let Some(window) = app.get_webview_window("main") {
                if window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false) {
                    let _ = window.hide();
                } else {
                    crate::tray::show_main_window(app);
                }
            } else {
                crate::tray::show_main_window(app);
            }
        }
        "hide" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        "entry_lightweight_mode" => {
            let _ = crate::lightweight::request_lightweight_mode(app);
        }
        "quit" => crate::desktop_lifecycle::request_quit(app),
        _ => {
            let app = app.clone();
            let action = action.to_owned();
            tauri::async_runtime::spawn(async move {
                let result = crate::network::shortcut(&app, &action).await;
                let error = result.err().map(|_| {
                    "Network shortcut failed; open the network workspace for details".to_owned()
                });
                notify_result(&app, &action, error);
            });
        }
    }
}
pub(crate) fn notify_result(app: &tauri::AppHandle, action: &str, error: Option<String>) {
    if let Some(message) = &error {
        let no_renderer = app.get_webview_window("main").is_none();
        crate::tray::show_main_window(app);
        if no_renderer {
            app.dialog()
                .message(message)
                .title("Sivio")
                .show(|_| {});
        }
    }
    let _ = app.emit(
        "desktop-action-result",
        json!({"action":action,"error":error}),
    );
}

pub fn setup(app: &tauri::AppHandle, db: &Database) {
    let decoded = db.get_setting(KEY).and_then(|raw| decode(raw.as_deref()));
    let error = decoded.as_ref().err().map(ToString::to_string);
    let preferences = decoded.unwrap_or_default();
    app.manage(DesktopState {
        preferences: RwLock::new(preferences.clone()),
        bindings: RwLock::new(Default::default()),
        serial: Default::default(),
        registration_error: RwLock::new(error),
        blurred_at: std::sync::Mutex::new(
            if app
                .get_webview_window("main")
                .is_some_and(|window| window.is_focused().unwrap_or(false))
            {
                None
            } else {
                Some(Instant::now())
            },
        ),
    });
    crate::services::local_backup::start(
        app.state::<crate::store::AppState>().db.clone(),
        app.clone(),
    );
    crate::desktop_startup_script::start();
    let maintenance_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(3600));
        loop {
            tick.tick().await;
            let days = current(&maintenance_app).log_clean_days;
            let _ = tauri::async_runtime::spawn_blocking(move || {
                crate::log_retention::cleanup(
                    &crate::panic_hook::get_log_dir(),
                    "cc-switch",
                    "cc-switch.log",
                    days,
                    false,
                )
            })
            .await;
        }
    });
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = handle.state::<DesktopState>();
        let _serial = state.serial.lock().await;
        let worker = handle.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let state = worker.state::<DesktopState>();
            let preferences = state
                .preferences
                .read()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            let desired = bindings(&preferences).unwrap_or_default();
            let old = state
                .bindings
                .read()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            let native_check = {
                #[cfg(target_os = "macos")]
                {
                    crate::macos_shortcuts::check(&worker, desired.values().cloned().collect())
                }
                #[cfg(not(target_os = "macos"))]
                {
                    Ok::<(), String>(())
                }
            };
            match native_check
                .and_then(|_| transition(&NativeRegistrar(&worker), &old, &desired, || Ok(())))
            {
                Ok(()) => *state.bindings.write().unwrap_or_else(|e| e.into_inner()) = desired,
                Err(error) => {
                    *state
                        .registration_error
                        .write()
                        .unwrap_or_else(|e| e.into_inner()) = Some(error)
                }
            }
            if let Some(tray) = worker.tray_by_id(crate::tray::TRAY_ID) {
                let _ = tray.set_show_menu_on_left_click(preferences.tray_click_action == "menu");
            }
            crate::tray::refresh_tray_menu(&worker);
            let _ = worker.emit("desktop-preferences-changed", ());
        })
        .await;
    });
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(15));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            if !crate::lightweight::is_lightweight_mode() && automatic_allowed(&handle) {
                let _ = crate::lightweight::request_automatic_lightweight_mode(&handle);
            }
        }
    });
}
#[tauri::command]
pub fn desktop_quit(app: tauri::AppHandle) {
    crate::desktop_lifecycle::confirm_quit(&app);
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, collections::BTreeSet};
    struct Fake {
        keys: RefCell<BTreeSet<u32>>,
        fail: Option<u32>,
    }
    impl Registrar for Fake {
        fn register(&self, key: Shortcut) -> Result<(), String> {
            if self.fail == Some(key.id()) {
                return Err("occupied by another app".into());
            }
            self.keys.borrow_mut().insert(key.id());
            Ok(())
        }
        fn unregister(&self, key: Shortcut) -> Result<(), String> {
            self.keys.borrow_mut().remove(&key.id());
            Ok(())
        }
    }
    fn configured(action: &str, key: &str) -> Preferences {
        let mut p = Preferences::default();
        p.global_shortcuts_enabled = true;
        p.hotkeys.insert(action.into(), key.into());
        p
    }
    #[test]
    fn presentation_defaults_upgrade_old_preferences_and_reject_invalid_ranges() {
        let old = decode(Some(r#"{"startPage":"network","trayIcon":"color"}"#)).unwrap();
        assert_eq!(old.proxy_columns, 3);
        assert!(old.traffic_graph && old.memory_usage && old.auto_check_update);
        let mut invalid = old.clone();
        invalid.menu_order = vec!["network".into(), "network".into()];
        assert!(bindings(&invalid).is_err());
        invalid = old.clone();
        invalid.proxy_columns = 0;
        assert!(bindings(&invalid).is_err());
        invalid = old.clone();
        invalid.hover_group_delay = 5001;
        assert!(bindings(&invalid).is_err());
        invalid = old;
        invalid.home_cards = vec!["unknown".into()];
        assert!(bindings(&invalid).is_err());
    }
    #[test]
    fn invalid_and_duplicate_accelerators_are_rejected_even_while_disabled() {
        let mut p = configured("hide", "Command+Shift+H");
        p.hotkeys.insert("quit".into(), "Super+Shift+KeyH".into());
        assert!(bindings(&p).is_err());
        p.hotkeys = BTreeMap::from([("hide".into(), "KeyH".into())]);
        assert!(bindings(&p).is_err());
        p.global_shortcuts_enabled = false;
        assert!(bindings(&p).is_err());
        p.hotkeys = BTreeMap::from([("hide".into(), "Command+Shift+H".into())]);
        assert!(bindings(&p).unwrap().is_empty());
    }
    #[test]
    fn native_conflicts_and_failed_commit_restore_the_original_registration() {
        let old = bindings(&configured("hide", "Command+Shift+H")).unwrap();
        let new = bindings(&configured("quit", "Command+Shift+J")).unwrap();
        let original = old.keys().copied().collect::<BTreeSet<_>>();
        let registrar = Fake {
            keys: RefCell::new(original.clone()),
            fail: new.keys().next().copied(),
        };
        assert!(transition(&registrar, &old, &new, || panic!(
            "must not persist a conflict"
        ))
        .is_err());
        assert_eq!(*registrar.keys.borrow(), original);
        let registrar = Fake {
            keys: RefCell::new(original.clone()),
            fail: None,
        };
        assert!(transition(&registrar, &old, &new, || Err(
            "external revision changed".into()
        ))
        .is_err());
        assert_eq!(*registrar.keys.borrow(), original);
    }
}
