use std::collections::HashSet;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use once_cell::sync::Lazy;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Position, Size, WindowBuilder, WindowUrl,
};

use super::{
    focus_main_window_if_needed, EVENT_VST_MANAGER_WINDOW_HIDDEN, EVENT_VST_MANAGER_WINDOW_SHOWN,
};

pub const VST_MANAGER_WINDOW_LABEL: &str = "vst-manager";

pub struct VstManagerWindowGeometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

static OPEN_VST_MANAGER_WINDOW_LABELS: Lazy<Mutex<HashSet<String>>> =
    Lazy::new(|| Mutex::new(HashSet::new()));

static FORCE_CLOSE_WINDOWS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

fn apply_geometry(window: &tauri::Window, geometry: &VstManagerWindowGeometry) {
    if geometry.width.is_finite()
        && geometry.height.is_finite()
        && geometry.width > 0.0
        && geometry.height > 0.0
    {
        let _ = window.set_size(Size::Logical(LogicalSize {
            width: geometry.width,
            height: geometry.height,
        }));
    }

    if geometry.x.is_finite() && geometry.y.is_finite() {
        let _ = window.set_position(Position::Logical(LogicalPosition {
            x: geometry.x,
            y: geometry.y,
        }));
    }
}

fn request_force_close(app: &AppHandle, label: &str) {
    let Some(window) = app.get_window(label) else {
        return;
    };

    {
        let mut set = match FORCE_CLOSE_WINDOWS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        set.insert(label.to_string());
    }

    if window.close().is_err() {
        let mut set = match FORCE_CLOSE_WINDOWS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        set.remove(label);
    }
}

fn take_force_close(label: &str) -> bool {
    let mut set = match FORCE_CLOSE_WINDOWS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    set.remove(label)
}

fn register_open_label(label: &str) {
    let mut set = match OPEN_VST_MANAGER_WINDOW_LABELS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    set.insert(label.to_string());
}

fn unregister_open_label(label: &str) {
    let mut set = match OPEN_VST_MANAGER_WINDOW_LABELS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    set.remove(label);
}

pub fn open_vst_manager_window(
    app: &AppHandle,
    geometry: VstManagerWindowGeometry,
    exit_flag: Arc<AtomicBool>,
    title: Option<String>,
) -> Result<(), String> {
    let label = VST_MANAGER_WINDOW_LABEL;

    if let Some(existing_window) = app.get_window(label) {
        apply_geometry(&existing_window, &geometry);
        let _ = existing_window.show();
        let _ = existing_window.unminimize();
        if !existing_window.is_focused().ok().unwrap_or(false) {
            existing_window.set_focus().map_err(|e| e.to_string())?;
        }
        let _ = app.emit_all(EVENT_VST_MANAGER_WINDOW_SHOWN, ());
        return Ok(());
    }

    let url = "/#/vst-manager";
    let title_text = title.unwrap_or_else(|| "VST3 Plugin Manager".to_string());

    let window = WindowBuilder::new(app, label, WindowUrl::App(url.into()))
        .title(title_text)
        .inner_size(geometry.width, geometry.height)
        .position(geometry.x, geometry.y)
        .resizable(true)
        .decorations(true)
        .transparent(false)
        .always_on_top(false)
        .build()
        .map_err(|e| e.to_string())?;

    register_open_label(label);
    let _ = app.emit_all(EVENT_VST_MANAGER_WINDOW_SHOWN, ());

    let app_handle = app.clone();
    let label_for_events = label.to_string();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            if exit_flag.load(Ordering::SeqCst) || take_force_close(label_for_events.as_str()) {
                unregister_open_label(label_for_events.as_str());
                return;
            }

            // Standard policy: aux windows are hidden instead of destroyed.
            api.prevent_close();
            let _ = app_handle.emit_all(EVENT_VST_MANAGER_WINDOW_HIDDEN, ());
            let Some(win) = app_handle.get_window(label_for_events.as_str()) else {
                return;
            };
            let _ = win.hide();

            focus_main_window_if_needed(&app_handle);
        }
        tauri::WindowEvent::Destroyed => {
            unregister_open_label(label_for_events.as_str());
        }
        _ => {}
    });

    Ok(())
}

pub fn close_vst_manager_window(app: &AppHandle) -> Result<(), String> {
    let label = VST_MANAGER_WINDOW_LABEL;
    if let Some(window) = app.get_window(label) {
        let _ = app.emit_all(EVENT_VST_MANAGER_WINDOW_HIDDEN, ());
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn close_all_vst_manager_windows(app: &AppHandle) {
    let labels = {
        let set = match OPEN_VST_MANAGER_WINDOW_LABELS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        set.iter().cloned().collect::<Vec<_>>()
    };

    for label in labels {
        request_force_close(app, label.as_str());
    }
}

/// Best-effort memory reclamation: destroy hidden vst-manager windows to release WebView resources.
///
/// Safety: only destroys windows that are currently not visible.
pub fn governance_destroy_hidden_vst_manager_windows(app: &AppHandle) -> usize {
    let labels = {
        let set = match OPEN_VST_MANAGER_WINDOW_LABELS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        set.iter().cloned().collect::<Vec<_>>()
    };

    let mut destroyed = 0usize;
    for label in labels {
        let Some(window) = app.get_window(label.as_str()) else {
            continue;
        };

        let is_visible = window.is_visible().ok().unwrap_or(false);
        if is_visible {
            continue;
        }

        request_force_close(app, label.as_str());
        destroyed += 1;
    }

    destroyed
}
