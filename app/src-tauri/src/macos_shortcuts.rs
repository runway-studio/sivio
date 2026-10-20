//! Carbon can accept an accelerator already used by a system symbolic shortcut.
//! Inspect the real system list on the main thread before changing registrations.
use core_foundation::{
    array::{CFArray, CFArrayRef},
    base::{CFType, TCFType},
    boolean::CFBoolean,
    dictionary::CFDictionary,
    number::CFNumber,
    string::CFString,
};
use tauri_plugin_global_shortcut::{Modifiers, Shortcut};
#[path = "macos_keycode.rs"]
mod keycode;
#[link(name = "Carbon", kind = "framework")]
extern "C" {
    fn CopySymbolicHotKeys(out: *mut CFArrayRef) -> i32;
}
#[derive(Clone, Copy)]
struct SystemShortcut {
    code: u32,
    modifiers: u32,
    enabled: bool,
}
/// SDK CarbonEvents.h declares this API not thread safe: call only on AppKit's
/// main thread and turn CF values into plain Rust values before crossing threads.
fn read_system() -> Result<Vec<SystemShortcut>, String> {
    let mut raw = std::ptr::null();
    let status = unsafe { CopySymbolicHotKeys(&mut raw) };
    if status != 0 || raw.is_null() {
        return Err("Cannot inspect macOS system shortcuts; no shortcuts were changed".into());
    }
    let array: CFArray<CFDictionary<CFString, CFType>> =
        unsafe { CFArray::wrap_under_create_rule(raw) };
    let mut result = Vec::new();
    for item in array.iter() {
        let number = |name: &str| {
            item.find(CFString::new(name))
                .and_then(|v| v.downcast::<CFNumber>())
                .and_then(|v| v.to_i64())
                .and_then(|v| u32::try_from(v).ok())
        };
        let enabled = item
            .find(CFString::new("kHISymbolicHotKeyEnabled"))
            .and_then(|v| v.downcast::<CFBoolean>())
            .map(bool::from)
            .unwrap_or(false);
        if let (Some(code), Some(modifiers)) = (
            number("kHISymbolicHotKeyCode"),
            number("kHISymbolicHotKeyModifiers"),
        ) {
            result.push(SystemShortcut {
                code,
                modifiers,
                enabled,
            });
        }
    }
    Ok(result)
}
fn carbon_modifiers(key: &Shortcut) -> u32 {
    let mut result = 0;
    if key.mods.contains(Modifiers::SHIFT) {
        result |= 512;
    }
    if key.mods.intersects(Modifiers::SUPER | Modifiers::META) {
        result |= 256;
    }
    if key.mods.contains(Modifiers::ALT) {
        result |= 2048;
    }
    if key.mods.contains(Modifiers::CONTROL) {
        result |= 4096;
    }
    result
}
fn validate(keys: &[(String, Shortcut)], system: &[SystemShortcut]) -> Result<(), String> {
    const STANDARD_MODIFIERS: u32 = 512 | 256 | 2048 | 4096;
    for (action, key) in keys {
        let Some(code) = keycode::key_to_scancode(key.key) else {
            continue;
        };
        if system.iter().any(|item| {
            item.enabled
                && item.code == code
                && item.modifiers & STANDARD_MODIFIERS == carbon_modifiers(key)
        }) {
            return Err(format!("Shortcut for {action} is already enabled in macOS Keyboard Shortcuts; choose another combination"));
        }
    }
    Ok(())
}
/// Called from a worker, never from the main thread that must perform the read.
pub fn check(app: &tauri::AppHandle, keys: Vec<(String, Shortcut)>) -> Result<(), String> {
    if keys.is_empty() {
        return Ok(());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let result = read_system().and_then(|system| validate(&keys, &system));
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;
    #[test]
    fn enabled_system_combinations_are_refused_but_disabled_or_different_modifiers_are_allowed() {
        let keys = vec![("show".into(), Shortcut::from_str("Command+Space").unwrap())];
        let mut system = [SystemShortcut {
            code: 0x31,
            modifiers: 256,
            enabled: true,
        }];
        assert!(validate(&keys, &system)
            .unwrap_err()
            .contains("macOS Keyboard Shortcuts"));
        system[0].enabled = false;
        assert!(validate(&keys, &system).is_ok());
        system[0].enabled = true;
        system[0].modifiers = 256 | 512;
        assert!(validate(&keys, &system).is_ok());
    }
}
