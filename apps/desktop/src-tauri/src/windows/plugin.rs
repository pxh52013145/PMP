use std::collections::HashSet;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use once_cell::sync::Lazy;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Position, Size, WindowBuilder, WindowUrl,
};

use super::{focus_main_window_if_needed, EVENT_PLUGIN_WINDOW_HIDDEN, EVENT_PLUGIN_WINDOW_SHOWN};

pub struct PluginWindowGeometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

static OPEN_PLUGIN_WINDOW_LABELS: Lazy<Mutex<HashSet<String>>> =
    Lazy::new(|| Mutex::new(HashSet::new()));

static FORCE_CLOSE_WINDOWS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

fn is_safe_id(value: &str) -> bool {
    if value.is_empty() || value.len() > 48 {
        return false;
    }
    value
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn normalize_source_kind(source_kind: Option<&str>) -> Result<&str, String> {
    match source_kind.unwrap_or("extv2") {
        "pmpm" => Ok("pmpm"),
        "extv2" => Ok("extv2"),
        other => Err(format!("Invalid sourceKind: {}", other)),
    }
}

pub fn plugin_window_label(
    source_kind: Option<&str>,
    plugin_id: &str,
    window_id: &str,
) -> Result<String, String> {
    let source_kind = normalize_source_kind(source_kind)?;
    if !is_safe_id(plugin_id) {
        return Err(format!("Invalid pluginId: {}", plugin_id));
    }
    if !is_safe_id(window_id) {
        return Err(format!("Invalid windowId: {}", window_id));
    }
    Ok(format!(
        "plugin-{}-{}-{}",
        source_kind, plugin_id, window_id
    ))
}

fn payload(source_kind: &str, plugin_id: &str, window_id: &str) -> String {
    format!("{}/{}/{}", source_kind, plugin_id, window_id)
}

fn apply_geometry(window: &tauri::Window, geometry: &PluginWindowGeometry) {
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
    let mut set = match OPEN_PLUGIN_WINDOW_LABELS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    set.insert(label.to_string());
}

fn unregister_open_label(label: &str) {
    let mut set = match OPEN_PLUGIN_WINDOW_LABELS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    set.remove(label);
}

pub fn open_plugin_window(
    app: &AppHandle,
    source_kind: Option<String>,
    plugin_id: String,
    window_id: String,
    geometry: PluginWindowGeometry,
    exit_flag: Arc<AtomicBool>,
    title: Option<String>,
) -> Result<(), String> {
    let normalized_source_kind = normalize_source_kind(source_kind.as_deref())?;
    let window_label = plugin_window_label(
        Some(normalized_source_kind),
        plugin_id.as_str(),
        window_id.as_str(),
    )?;

    if let Some(existing_window) = app.get_window(window_label.as_str()) {
        apply_geometry(&existing_window, &geometry);
        let _ = existing_window.show();
        let _ = existing_window.unminimize();
        if !existing_window.is_focused().ok().unwrap_or(false) {
            existing_window.set_focus().map_err(|e| e.to_string())?;
        }
        let _ = app.emit_all(
            EVENT_PLUGIN_WINDOW_SHOWN,
            payload(
                normalized_source_kind,
                plugin_id.as_str(),
                window_id.as_str(),
            ),
        );
        return Ok(());
    }

    let url = format!(
        "/#/plugin-window/{}/{}/{}",
        normalized_source_kind,
        plugin_id.as_str(),
        window_id.as_str()
    );

    let title_text = title.unwrap_or_else(|| format!("Plugin: {}", plugin_id));

    // `WindowBuilder::new` requires a unique label across the app.
    let window = WindowBuilder::new(app, window_label.clone(), WindowUrl::App(url.into()))
        .title(title_text)
        .inner_size(geometry.width, geometry.height)
        .position(geometry.x, geometry.y)
        .resizable(true)
        .decorations(true)
        .transparent(false)
        .always_on_top(false)
        .build()
        .map_err(|e| e.to_string())?;

    register_open_label(window_label.as_str());
    let _ = app.emit_all(
        EVENT_PLUGIN_WINDOW_SHOWN,
        payload(
            normalized_source_kind,
            plugin_id.as_str(),
            window_id.as_str(),
        ),
    );

    let app_handle = app.clone();
    let source_kind_for_events = normalized_source_kind.to_string();
    let plugin_id_for_events = plugin_id.clone();
    let window_id_for_events = window_id.clone();
    let label_for_events = window_label.clone();

    window.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            if exit_flag.load(Ordering::SeqCst) || take_force_close(label_for_events.as_str()) {
                unregister_open_label(label_for_events.as_str());
                return;
            }

            // Standard policy: plugin windows are "hidden" instead of destroyed.
            api.prevent_close();
            let _ = app_handle.emit_all(
                EVENT_PLUGIN_WINDOW_HIDDEN,
                payload(
                    source_kind_for_events.as_str(),
                    plugin_id_for_events.as_str(),
                    window_id_for_events.as_str(),
                ),
            );
            let Some(win) = app_handle.get_window(label_for_events.as_str()) else {
                return;
            };
            let _ = win.hide();

            // Avoid unnecessary focus steals: forcing focus can cause visible flicker on some
            // Windows setups when closing WebView-owned child windows.
            focus_main_window_if_needed(&app_handle);
        }
        tauri::WindowEvent::Destroyed => {
            unregister_open_label(label_for_events.as_str());
        }
        _ => {}
    });

    Ok(())
}

pub fn close_plugin_window(
    app: &AppHandle,
    source_kind: Option<String>,
    plugin_id: String,
    window_id: String,
) -> Result<(), String> {
    let normalized_source_kind = normalize_source_kind(source_kind.as_deref())?;
    let window_label = plugin_window_label(
        Some(normalized_source_kind),
        plugin_id.as_str(),
        window_id.as_str(),
    )?;
    if let Some(window) = app.get_window(window_label.as_str()) {
        let _ = app.emit_all(
            EVENT_PLUGIN_WINDOW_HIDDEN,
            payload(
                normalized_source_kind,
                plugin_id.as_str(),
                window_id.as_str(),
            ),
        );
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn close_all_plugin_windows(app: &AppHandle) {
    let labels = {
        let set = match OPEN_PLUGIN_WINDOW_LABELS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        set.iter().cloned().collect::<Vec<_>>()
    };

    for label in labels {
        request_force_close(app, label.as_str());
    }
}

/// Best-effort memory reclamation: destroy hidden plugin windows to release WebView resources.
///
/// Safety: only destroys windows that are currently not visible.
pub fn governance_destroy_hidden_plugin_windows(app: &AppHandle) -> usize {
    let labels = {
        let set = match OPEN_PLUGIN_WINDOW_LABELS.lock() {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugin_window_label_defaults_to_extv2_source_kind() {
        assert_eq!(
            plugin_window_label(None, "demo-plugin", "main-window").unwrap(),
            "plugin-extv2-demo-plugin-main-window"
        );
    }

    #[test]
    fn plugin_window_label_supports_pmpm_source_kind() {
        assert_eq!(
            plugin_window_label(Some("pmpm"), "demo-plugin", "main-window").unwrap(),
            "plugin-pmpm-demo-plugin-main-window"
        );
    }

    #[test]
    fn plugin_window_label_rejects_unknown_source_kind() {
        assert_eq!(
            plugin_window_label(Some("unknown"), "demo-plugin", "main-window").unwrap_err(),
            "Invalid sourceKind: unknown"
        );
    }
}
