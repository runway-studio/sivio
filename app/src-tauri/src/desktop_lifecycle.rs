//! A renderer with unsaved drafts must acknowledge a user-initiated quit.
//! Fatal startup failures, OS termination and explicit restarts keep their
//! existing cleanup paths and do not wait for a renderer that cannot respond.
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};
static CONFIRMED: AtomicBool = AtomicBool::new(false);
pub fn request_quit(app: &tauri::AppHandle) {
    if app.get_webview_window("main").is_some() {
        crate::tray::show_main_window(app);
        let _ = app.emit("desktop-quit-requested", ());
    } else {
        confirm_quit(app);
    }
}
pub fn confirm_quit(app: &tauri::AppHandle) {
    CONFIRMED.store(true, Ordering::Release);
    app.exit(0);
}
pub fn intercept_quit(app: &tauri::AppHandle, code: Option<i32>) -> bool {
    if CONFIRMED.swap(false, Ordering::AcqRel) {
        return false;
    }
    if code.is_some_and(|value| value != 0) || crate::RESTART_REQUESTED.load(Ordering::SeqCst) {
        return false;
    }
    if app.try_state::<crate::store::AppState>().is_none()
        || crate::init_status::get_init_error().is_some()
    {
        return false;
    }
    app.get_webview_window("main").is_some()
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use objc2::{
        class, msg_send,
        runtime::{AnyClass, AnyObject, Bool, Sel},
        sel,
    };
    use std::sync::OnceLock;
    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
    // AppKit's optional NSApplicationDelegate method is absent from Tao 0.37.
    // Install it on that existing delegate, without replacing its other hooks.
    #[link(name = "objc")]
    extern "C" {
        fn class_addMethod(
            class: *const AnyClass,
            name: Sel,
            imp: unsafe extern "C" fn(),
            types: *const std::ffi::c_char,
        ) -> Bool;
    }
    extern "C" fn should_terminate(_: &AnyObject, _: Sel, _: *mut AnyObject) -> usize {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let Some(app) = APP.get() else {
                return 1;
            }; // NSTerminateNow
            if crate::RESTART_REQUESTED.load(Ordering::SeqCst)
                || app.try_state::<crate::store::AppState>().is_none()
                || crate::init_status::get_init_error().is_some()
            {
                return 1;
            }
            request_quit(app);
            0 // NSTerminateCancel; the confirmed IPC uses app.exit and its cleanup path.
        }))
        .unwrap_or(1)
    }
    pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
        APP.set(app.clone())
            .map_err(|_| "macOS quit guard already installed")?;
        // SAFETY: called once on the AppKit main thread, after Builder::build.
        // The method has NSUInteger return and (id, SEL, id) arguments on 64-bit macOS.
        unsafe {
            let application: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let delegate: *mut AnyObject = msg_send![application, delegate];
            let delegate = delegate
                .as_ref()
                .ok_or("NSApplication delegate unavailable")?;
            let selector = sel!(applicationShouldTerminate:);
            if delegate.class().instance_method(selector).is_some() {
                return Err(
                    "The runtime already provides a termination hook; refusing to replace it"
                        .into(),
                );
            }
            let implementation = std::mem::transmute::<
                extern "C" fn(&AnyObject, Sel, *mut AnyObject) -> usize,
                unsafe extern "C" fn(),
            >(should_terminate);
            if !class_addMethod(delegate.class(), selector, implementation, c"Q@:@".as_ptr())
                .as_bool()
            {
                return Err("Could not install the native macOS quit guard".into());
            }
        }
        Ok(())
    }
}
#[cfg(target_os = "macos")]
pub use macos::install as install_macos_quit_guard;
