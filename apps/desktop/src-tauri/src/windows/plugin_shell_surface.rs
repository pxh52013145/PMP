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
    focus_main_window_if_needed, EVENT_PLUGIN_SHELL_SURFACE_HIDDEN,
    EVENT_PLUGIN_SHELL_SURFACE_SHOWN,
};

pub struct PluginShellSurfaceGeometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub struct PluginShellSurfaceConfig {
    pub source_kind: Option<String>,
    pub plugin_id: String,
    pub surface_id: String,
    pub surface_type: String,
    pub geometry: PluginShellSurfaceGeometry,
    pub title: Option<String>,
    pub always_on_top: bool,
    pub focusable: bool,
    pub pointer_policy: String,
}

static OPEN_PLUGIN_SHELL_SURFACE_LABELS: Lazy<Mutex<HashSet<String>>> =
    Lazy::new(|| Mutex::new(HashSet::new()));

static FORCE_CLOSE_PLUGIN_SHELL_SURFACES: Lazy<Mutex<HashSet<String>>> =
    Lazy::new(|| Mutex::new(HashSet::new()));

fn is_safe_id(value: &str) -> bool {
    if value.is_empty() || value.len() > 48 {
        return false;
    }
    value
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn normalize_source_kind(source_kind: Option<&str>) -> Result<&str, String> {
    match source_kind.unwrap_or("pmpm") {
        "pmpm" => Ok("pmpm"),
        "extv2" => Ok("extv2"),
        other => Err(format!("Invalid sourceKind: {}", other)),
    }
}

fn normalize_surface_type(surface_type: &str) -> Result<&str, String> {
    match surface_type {
        "overlay" => Ok("overlay"),
        "desktop-widget" => Ok("desktop-widget"),
        other => Err(format!("Invalid surfaceType: {}", other)),
    }
}

fn normalize_pointer_policy(pointer_policy: &str) -> Result<&str, String> {
    match pointer_policy {
        "capture-input" => Ok("capture-input"),
        "passthrough" => Ok("passthrough"),
        other => Err(format!("Invalid pointerPolicy: {}", other)),
    }
}

pub fn plugin_shell_surface_label(
    source_kind: Option<&str>,
    surface_type: &str,
    plugin_id: &str,
    surface_id: &str,
) -> Result<String, String> {
    let source_kind = normalize_source_kind(source_kind)?;
    let surface_type = normalize_surface_type(surface_type)?;
    if !is_safe_id(plugin_id) {
        return Err(format!("Invalid pluginId: {}", plugin_id));
    }
    if !is_safe_id(surface_id) {
        return Err(format!("Invalid surfaceId: {}", surface_id));
    }

    Ok(format!(
        "plugin-shell-surface-{}-{}-{}-{}",
        source_kind, surface_type, plugin_id, surface_id
    ))
}

fn payload(source_kind: &str, surface_type: &str, plugin_id: &str, surface_id: &str) -> String {
    format!(
        "{}/{}/{}/{}",
        source_kind, surface_type, plugin_id, surface_id
    )
}

fn apply_geometry(window: &tauri::Window, geometry: &PluginShellSurfaceGeometry) {
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

fn apply_window_behavior(
    window: &tauri::Window,
    always_on_top: bool,
    pointer_policy: &str,
) -> Result<(), String> {
    window
        .set_always_on_top(always_on_top)
        .map_err(|error| error.to_string())?;
    window
        .set_ignore_cursor_events(pointer_policy == "passthrough")
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn register_open_label(label: &str) {
    let mut set = match OPEN_PLUGIN_SHELL_SURFACE_LABELS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    set.insert(label.to_string());
}

fn unregister_open_label(label: &str) {
    let mut set = match OPEN_PLUGIN_SHELL_SURFACE_LABELS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    set.remove(label);
}

fn request_force_close(app: &AppHandle, label: &str) {
    let Some(window) = app.get_window(label) else {
        return;
    };

    {
        let mut set = match FORCE_CLOSE_PLUGIN_SHELL_SURFACES.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        set.insert(label.to_string());
    }

    if window.close().is_err() {
        let mut set = match FORCE_CLOSE_PLUGIN_SHELL_SURFACES.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        set.remove(label);
    }
}

fn take_force_close(label: &str) -> bool {
    let mut set = match FORCE_CLOSE_PLUGIN_SHELL_SURFACES.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    set.remove(label)
}

pub fn open_plugin_shell_surface(
    app: &AppHandle,
    config: PluginShellSurfaceConfig,
    exit_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let normalized_source_kind = normalize_source_kind(config.source_kind.as_deref())?;
    let normalized_surface_type = normalize_surface_type(config.surface_type.as_str())?;
    let normalized_pointer_policy = normalize_pointer_policy(config.pointer_policy.as_str())?;

    if !config.geometry.width.is_finite()
        || !config.geometry.height.is_finite()
        || config.geometry.width <= 0.0
        || config.geometry.height <= 0.0
    {
        return Err("Invalid shell surface geometry".to_string());
    }

    let label = plugin_shell_surface_label(
        Some(normalized_source_kind),
        normalized_surface_type,
        config.plugin_id.as_str(),
        config.surface_id.as_str(),
    )?;

    if let Some(existing_window) = app.get_window(label.as_str()) {
        apply_geometry(&existing_window, &config.geometry);
        apply_window_behavior(
            &existing_window,
            config.always_on_top,
            normalized_pointer_policy,
        )?;
        let _ = existing_window.show();
        let _ = existing_window.unminimize();
        if config.focusable && !existing_window.is_focused().ok().unwrap_or(false) {
            existing_window.set_focus().map_err(|error| error.to_string())?;
        }
        let _ = app.emit_all(
            EVENT_PLUGIN_SHELL_SURFACE_SHOWN,
            payload(
                normalized_source_kind,
                normalized_surface_type,
                config.plugin_id.as_str(),
                config.surface_id.as_str(),
            ),
        );
        return Ok(());
    }

    let url = format!(
        "/#/plugin-shell-surface/{}/{}/{}/{}",
        normalized_source_kind,
        normalized_surface_type,
        config.plugin_id.as_str(),
        config.surface_id.as_str()
    );
    let title_text = config.title.unwrap_or_else(|| {
        format!(
            "Plugin {} {}",
            config.plugin_id,
            normalized_surface_type
        )
    });

    let window = WindowBuilder::new(app, label.clone(), WindowUrl::App(url.into()))
        .title(title_text)
        .inner_size(config.geometry.width, config.geometry.height)
        .position(config.geometry.x, config.geometry.y)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(config.always_on_top)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())?;

    apply_window_behavior(&window, config.always_on_top, normalized_pointer_policy)?;
    register_open_label(label.as_str());

    let _ = window.show();
    let _ = window.unminimize();
    if config.focusable {
        let _ = window.set_focus();
    }

    let _ = app.emit_all(
        EVENT_PLUGIN_SHELL_SURFACE_SHOWN,
        payload(
            normalized_source_kind,
            normalized_surface_type,
            config.plugin_id.as_str(),
            config.surface_id.as_str(),
        ),
    );

    let app_handle = app.clone();
    let source_kind_for_events = normalized_source_kind.to_string();
    let surface_type_for_events = normalized_surface_type.to_string();
    let plugin_id_for_events = config.plugin_id.clone();
    let surface_id_for_events = config.surface_id.clone();
    let label_for_events = label.clone();

    window.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            if exit_flag.load(Ordering::SeqCst)
                || take_force_close(label_for_events.as_str())
            {
                unregister_open_label(label_for_events.as_str());
                return;
            }

            api.prevent_close();
            let _ = app_handle.emit_all(
                EVENT_PLUGIN_SHELL_SURFACE_HIDDEN,
                payload(
                    source_kind_for_events.as_str(),
                    surface_type_for_events.as_str(),
                    plugin_id_for_events.as_str(),
                    surface_id_for_events.as_str(),
                ),
            );

            let Some(window) = app_handle.get_window(label_for_events.as_str()) else {
                return;
            };
            let _ = window.hide();
            focus_main_window_if_needed(&app_handle);
        }
        tauri::WindowEvent::Destroyed => {
            unregister_open_label(label_for_events.as_str());
        }
        _ => {}
    });

    Ok(())
}

pub fn dismiss_plugin_shell_surface(
    app: &AppHandle,
    source_kind: Option<String>,
    plugin_id: String,
    surface_id: String,
    surface_type: String,
) -> Result<(), String> {
    let normalized_source_kind = normalize_source_kind(source_kind.as_deref())?;
    let normalized_surface_type = normalize_surface_type(surface_type.as_str())?;
    let label = plugin_shell_surface_label(
        Some(normalized_source_kind),
        normalized_surface_type,
        plugin_id.as_str(),
        surface_id.as_str(),
    )?;

    if let Some(window) = app.get_window(label.as_str()) {
        let _ = app.emit_all(
            EVENT_PLUGIN_SHELL_SURFACE_HIDDEN,
            payload(
                normalized_source_kind,
                normalized_surface_type,
                plugin_id.as_str(),
                surface_id.as_str(),
            ),
        );
        window.hide().map_err(|error| error.to_string())?;
    }

    Ok(())
}

pub fn destroy_plugin_shell_surface(
    app: &AppHandle,
    source_kind: Option<String>,
    plugin_id: String,
    surface_id: String,
    surface_type: String,
) -> Result<(), String> {
    let normalized_source_kind = normalize_source_kind(source_kind.as_deref())?;
    let normalized_surface_type = normalize_surface_type(surface_type.as_str())?;
    let label = plugin_shell_surface_label(
        Some(normalized_source_kind),
        normalized_surface_type,
        plugin_id.as_str(),
        surface_id.as_str(),
    )?;

    if app.get_window(label.as_str()).is_some() {
        let _ = app.emit_all(
            EVENT_PLUGIN_SHELL_SURFACE_HIDDEN,
            payload(
                normalized_source_kind,
                normalized_surface_type,
                plugin_id.as_str(),
                surface_id.as_str(),
            ),
        );
        request_force_close(app, label.as_str());
    }

    Ok(())
}

pub fn close_all_plugin_shell_surfaces(app: &AppHandle) {
    let labels = {
        let set = match OPEN_PLUGIN_SHELL_SURFACE_LABELS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        set.iter().cloned().collect::<Vec<_>>()
    };

    for label in labels {
        request_force_close(app, label.as_str());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugin_shell_surface_label_defaults_to_pmpm_source_kind() {
        assert_eq!(
            plugin_shell_surface_label(None, "overlay", "demo-plugin", "shell-main").unwrap(),
            "plugin-shell-surface-pmpm-overlay-demo-plugin-shell-main"
        );
    }

    #[test]
    fn plugin_shell_surface_label_supports_extv2_and_widget_types() {
        assert_eq!(
            plugin_shell_surface_label(
                Some("extv2"),
                "desktop-widget",
                "demo-plugin",
                "widget-main"
            )
            .unwrap(),
            "plugin-shell-surface-extv2-desktop-widget-demo-plugin-widget-main"
        );
    }

    #[test]
    fn plugin_shell_surface_label_rejects_invalid_kinds() {
        assert_eq!(
            plugin_shell_surface_label(
                Some("unknown"),
                "overlay",
                "demo-plugin",
                "shell-main"
            )
            .unwrap_err(),
            "Invalid sourceKind: unknown"
        );
        assert_eq!(
            plugin_shell_surface_label(
                Some("pmpm"),
                "floating-panel",
                "demo-plugin",
                "shell-main"
            )
            .unwrap_err(),
            "Invalid surfaceType: floating-panel"
        );
    }
}
