use std::collections::HashSet;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use once_cell::sync::Lazy;
use serde_json::json;
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct PluginShellSurfaceTarget {
    source_kind: String,
    surface_type: String,
    label: String,
    payload: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PluginShellSurfaceWindowContract {
    target: PluginShellSurfaceTarget,
    route: String,
    title: String,
    pointer_policy: String,
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
    match source_kind.unwrap_or("extv2") {
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

fn validate_shell_surface_geometry(geometry: &PluginShellSurfaceGeometry) -> Result<(), String> {
    if !geometry.width.is_finite()
        || !geometry.height.is_finite()
        || geometry.width <= 0.0
        || geometry.height <= 0.0
    {
        return Err("Invalid shell surface geometry".to_string());
    }

    Ok(())
}

fn resolve_plugin_shell_surface_target(
    source_kind: Option<&str>,
    surface_type: &str,
    plugin_id: &str,
    surface_id: &str,
) -> Result<PluginShellSurfaceTarget, String> {
    let normalized_source_kind = normalize_source_kind(source_kind)?;
    let normalized_surface_type = normalize_surface_type(surface_type)?;
    let label = plugin_shell_surface_label(
        Some(normalized_source_kind),
        normalized_surface_type,
        plugin_id,
        surface_id,
    )?;
    Ok(PluginShellSurfaceTarget {
        source_kind: normalized_source_kind.to_string(),
        surface_type: normalized_surface_type.to_string(),
        label,
        payload: payload(
            normalized_source_kind,
            normalized_surface_type,
            plugin_id,
            surface_id,
        ),
    })
}

fn resolve_plugin_shell_surface_window_contract(
    config: &PluginShellSurfaceConfig,
) -> Result<PluginShellSurfaceWindowContract, String> {
    validate_shell_surface_geometry(&config.geometry)?;
    let target = resolve_plugin_shell_surface_target(
        config.source_kind.as_deref(),
        config.surface_type.as_str(),
        config.plugin_id.as_str(),
        config.surface_id.as_str(),
    )?;
    let pointer_policy = normalize_pointer_policy(config.pointer_policy.as_str())?;
    let route = format!(
        "/#/plugin-shell-surface/{}/{}/{}/{}",
        target.source_kind, target.surface_type, config.plugin_id, config.surface_id
    );
    let title = config
        .title
        .clone()
        .unwrap_or_else(|| format!("Plugin {} {}", config.plugin_id, target.surface_type));

    Ok(PluginShellSurfaceWindowContract {
        target,
        route,
        title,
        pointer_policy: pointer_policy.to_string(),
    })
}

fn build_shell_surface_telemetry_options(
    config: &PluginShellSurfaceConfig,
) -> crate::backend_telemetry::BackendTelemetryOptions {
    crate::backend_telemetry::BackendTelemetryOptions::new()
        .field("x", json!(config.geometry.x))
        .field("y", json!(config.geometry.y))
        .field("width", json!(config.geometry.width))
        .field("height", json!(config.geometry.height))
        .field("title", json!(config.title.clone()))
        .field("alwaysOnTop", json!(config.always_on_top))
        .field("focusable", json!(config.focusable))
        .field("pointerPolicy", json!(config.pointer_policy.as_str()))
}

fn emit_plugin_shell_surface_telemetry(
    app: &AppHandle,
    event: &str,
    target: &PluginShellSurfaceTarget,
    plugin_id: &str,
    surface_id: &str,
    options: crate::backend_telemetry::BackendTelemetryOptions,
) {
    crate::backend_telemetry::info(
        app,
        "windowing",
        event,
        options
            .component("PluginShellSurfaceWindow")
            .window_id(target.label.clone())
            .field("sourceKind", json!(target.source_kind.as_str()))
            .field("pluginId", json!(plugin_id))
            .field("surfaceId", json!(surface_id))
            .field("surfaceType", json!(target.surface_type.as_str()))
            .field("windowLabel", json!(target.label.as_str()))
            .field("windowPayload", json!(target.payload.as_str())),
    );
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
    let contract = resolve_plugin_shell_surface_window_contract(&config)?;

    if let Some(existing_window) = app.get_window(contract.target.label.as_str()) {
        apply_geometry(&existing_window, &config.geometry);
        apply_window_behavior(
            &existing_window,
            config.always_on_top,
            contract.pointer_policy.as_str(),
        )?;
        let _ = existing_window.show();
        let _ = existing_window.unminimize();
        let mut did_request_focus = false;
        if config.focusable && !existing_window.is_focused().ok().unwrap_or(false) {
            existing_window
                .set_focus()
                .map_err(|error| error.to_string())?;
            did_request_focus = true;
        }
        emit_plugin_shell_surface_telemetry(
            app,
            "window.plugin-shell-surface.native.focused-existing",
            &contract.target,
            config.plugin_id.as_str(),
            config.surface_id.as_str(),
            build_shell_surface_telemetry_options(&config)
                .field("trigger", json!("open-command"))
                .field("didRequestFocus", json!(did_request_focus)),
        );
        let _ = app.emit_all(
            EVENT_PLUGIN_SHELL_SURFACE_SHOWN,
            contract.target.payload.clone(),
        );
        return Ok(());
    }

    let window = WindowBuilder::new(
        app,
        contract.target.label.clone(),
        WindowUrl::App(contract.route.clone().into()),
    )
    .title(contract.title.clone())
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

    apply_window_behavior(
        &window,
        config.always_on_top,
        contract.pointer_policy.as_str(),
    )?;
    register_open_label(contract.target.label.as_str());

    let _ = window.show();
    let _ = window.unminimize();
    if config.focusable {
        let _ = window.set_focus();
    }

    let _ = app.emit_all(
        EVENT_PLUGIN_SHELL_SURFACE_SHOWN,
        contract.target.payload.clone(),
    );
    emit_plugin_shell_surface_telemetry(
        app,
        "window.plugin-shell-surface.native.created",
        &contract.target,
        config.plugin_id.as_str(),
        config.surface_id.as_str(),
        build_shell_surface_telemetry_options(&config)
            .field("trigger", json!("open-command"))
            .field("didRequestFocus", json!(config.focusable)),
    );

    let app_handle = app.clone();
    let payload_for_events = contract.target.payload.clone();
    let label_for_events = contract.target.label.clone();
    let target_for_events = contract.target.clone();
    let plugin_id_for_events = config.plugin_id.clone();
    let surface_id_for_events = config.surface_id.clone();

    window.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            if exit_flag.load(Ordering::SeqCst) || take_force_close(label_for_events.as_str()) {
                unregister_open_label(label_for_events.as_str());
                return;
            }

            api.prevent_close();
            emit_plugin_shell_surface_telemetry(
                &app_handle,
                "window.plugin-shell-surface.native.hidden",
                &target_for_events,
                plugin_id_for_events.as_str(),
                surface_id_for_events.as_str(),
                crate::backend_telemetry::BackendTelemetryOptions::new()
                    .field("trigger", json!("close-requested")),
            );
            let _ = app_handle.emit_all(
                EVENT_PLUGIN_SHELL_SURFACE_HIDDEN,
                payload_for_events.clone(),
            );

            let Some(window) = app_handle.get_window(label_for_events.as_str()) else {
                return;
            };
            let _ = window.hide();
            focus_main_window_if_needed(&app_handle);
        }
        tauri::WindowEvent::Destroyed => {
            unregister_open_label(label_for_events.as_str());
            emit_plugin_shell_surface_telemetry(
                &app_handle,
                "window.plugin-shell-surface.native.destroyed",
                &target_for_events,
                plugin_id_for_events.as_str(),
                surface_id_for_events.as_str(),
                crate::backend_telemetry::BackendTelemetryOptions::new(),
            );
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
    let target = resolve_plugin_shell_surface_target(
        source_kind.as_deref(),
        surface_type.as_str(),
        plugin_id.as_str(),
        surface_id.as_str(),
    )?;

    if let Some(window) = app.get_window(target.label.as_str()) {
        let _ = app.emit_all(EVENT_PLUGIN_SHELL_SURFACE_HIDDEN, target.payload.clone());
        window.hide().map_err(|error| error.to_string())?;
        emit_plugin_shell_surface_telemetry(
            app,
            "window.plugin-shell-surface.native.dismissed",
            &target,
            plugin_id.as_str(),
            surface_id.as_str(),
            crate::backend_telemetry::BackendTelemetryOptions::new()
                .field("trigger", json!("dismiss-command")),
        );
    }

    Ok(())
}

pub fn destroy_plugin_shell_surface(
    app: &AppHandle,
    source_kind: Option<String>,
    plugin_id: String,
    surface_id: String,
    surface_type: String,
    reason: Option<String>,
) -> Result<(), String> {
    let target = resolve_plugin_shell_surface_target(
        source_kind.as_deref(),
        surface_type.as_str(),
        plugin_id.as_str(),
        surface_id.as_str(),
    )?;

    if app.get_window(target.label.as_str()).is_some() {
        emit_plugin_shell_surface_telemetry(
            app,
            "window.plugin-shell-surface.native.destroy.requested",
            &target,
            plugin_id.as_str(),
            surface_id.as_str(),
            crate::backend_telemetry::BackendTelemetryOptions::new()
                .field("trigger", json!("destroy-command"))
                .field("reason", json!(reason.clone())),
        );
        let _ = app.emit_all(EVENT_PLUGIN_SHELL_SURFACE_HIDDEN, target.payload);
        request_force_close(app, target.label.as_str());
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
    #[cfg(target_os = "windows")]
    use crate::{app_runtime::ExitFlag, telemetry::TelemetryCore, telemetry_contract::TelemetryPolicy};
    #[cfg(target_os = "windows")]
    use std::path::PathBuf;
    #[cfg(target_os = "windows")]
    use std::thread;
    #[cfg(target_os = "windows")]
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
    #[cfg(target_os = "windows")]
    use tauri::{Manager, Wry};

    #[test]
    fn plugin_shell_surface_label_defaults_to_extv2_source_kind() {
        assert_eq!(
            plugin_shell_surface_label(None, "overlay", "demo-plugin", "shell-main").unwrap(),
            "plugin-shell-surface-extv2-overlay-demo-plugin-shell-main"
        );
    }

    #[test]
    fn plugin_shell_surface_label_supports_widget_types() {
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
            plugin_shell_surface_label(Some("unknown"), "overlay", "demo-plugin", "shell-main")
                .unwrap_err(),
            "Invalid sourceKind: unknown"
        );
        assert_eq!(
            plugin_shell_surface_label(Some("pmpm"), "overlay", "demo-plugin", "shell-main")
                .unwrap_err(),
            "Invalid sourceKind: pmpm"
        );
        assert_eq!(
            plugin_shell_surface_label(
                Some("extv2"),
                "floating-panel",
                "demo-plugin",
                "shell-main"
            )
                .unwrap_err(),
            "Invalid surfaceType: floating-panel"
        );
    }

    #[test]
    fn resolve_plugin_shell_surface_target_builds_label_and_payload() {
        let target = resolve_plugin_shell_surface_target(
            Some("extv2"),
            "desktop-widget",
            "demo-plugin",
            "widget-main",
        )
        .unwrap();

        assert_eq!(target.source_kind, "extv2");
        assert_eq!(target.surface_type, "desktop-widget");
        assert_eq!(
            target.label,
            "plugin-shell-surface-extv2-desktop-widget-demo-plugin-widget-main"
        );
        assert_eq!(
            target.payload,
            "extv2/desktop-widget/demo-plugin/widget-main"
        );
    }

    #[test]
    fn resolve_plugin_shell_surface_target_rejects_invalid_ids() {
        assert_eq!(
            resolve_plugin_shell_surface_target(
                Some("extv2"),
                "overlay",
                "demo.plugin",
                "shell-main"
            )
            .unwrap_err(),
            "Invalid pluginId: demo.plugin"
        );
        assert_eq!(
            resolve_plugin_shell_surface_target(
                Some("extv2"),
                "overlay",
                "demo-plugin",
                "shell.main"
            )
            .unwrap_err(),
            "Invalid surfaceId: shell.main"
        );
    }

    #[test]
    fn validate_shell_surface_geometry_rejects_non_finite_or_non_positive_sizes() {
        assert_eq!(
            validate_shell_surface_geometry(&PluginShellSurfaceGeometry {
                x: 10.0,
                y: 20.0,
                width: 0.0,
                height: 180.0,
            })
            .unwrap_err(),
            "Invalid shell surface geometry"
        );
        assert_eq!(
            validate_shell_surface_geometry(&PluginShellSurfaceGeometry {
                x: 10.0,
                y: 20.0,
                width: f64::NAN,
                height: 180.0,
            })
            .unwrap_err(),
            "Invalid shell surface geometry"
        );
    }

    #[test]
    fn resolve_plugin_shell_surface_window_contract_builds_route_title_and_pointer_policy() {
        let contract = resolve_plugin_shell_surface_window_contract(&PluginShellSurfaceConfig {
            source_kind: Some("extv2".to_string()),
            plugin_id: "demo-plugin".to_string(),
            surface_id: "widget-main".to_string(),
            surface_type: "desktop-widget".to_string(),
            geometry: PluginShellSurfaceGeometry {
                x: 100.0,
                y: 120.0,
                width: 320.0,
                height: 220.0,
            },
            title: None,
            always_on_top: false,
            focusable: false,
            pointer_policy: "passthrough".to_string(),
        })
        .unwrap();

        assert_eq!(
            contract.route,
            "/#/plugin-shell-surface/extv2/desktop-widget/demo-plugin/widget-main"
        );
        assert_eq!(contract.title, "Plugin demo-plugin desktop-widget");
        assert_eq!(contract.pointer_policy, "passthrough");
        assert_eq!(
            contract.target.payload,
            "extv2/desktop-widget/demo-plugin/widget-main"
        );
    }

    #[test]
    fn resolve_plugin_shell_surface_window_contract_rejects_invalid_pointer_policy() {
        assert_eq!(
            resolve_plugin_shell_surface_window_contract(&PluginShellSurfaceConfig {
                source_kind: None,
                plugin_id: "demo-plugin".to_string(),
                surface_id: "shell-main".to_string(),
                surface_type: "overlay".to_string(),
                geometry: PluginShellSurfaceGeometry {
                    x: 10.0,
                    y: 20.0,
                    width: 320.0,
                    height: 220.0,
                },
                title: Some("Demo".to_string()),
                always_on_top: true,
                focusable: true,
                pointer_policy: "invalid".to_string(),
            })
            .unwrap_err(),
            "Invalid pointerPolicy: invalid"
        );
    }

    #[cfg(target_os = "windows")]
    fn clear_test_state() {
        if let Ok(mut set) = OPEN_PLUGIN_SHELL_SURFACE_LABELS.lock() {
            set.clear();
        }
        if let Ok(mut set) = FORCE_CLOSE_PLUGIN_SHELL_SURFACES.lock() {
            set.clear();
        }
    }

    #[cfg(target_os = "windows")]
    fn create_native_test_app(root_dir: PathBuf) -> tauri::App<Wry> {
        let telemetry_policy = TelemetryPolicy {
            persist_min_level: crate::telemetry_contract::TelemetryLevel::Info,
            ..TelemetryPolicy::default()
        };
        tauri::Builder::default()
            .any_thread()
            .manage(ExitFlag::new())
            .manage(Arc::new(TelemetryCore::new_for_tests(
                root_dir,
                telemetry_policy,
            )))
            .build(tauri::generate_context!())
            .expect("build native tauri app")
    }

    #[cfg(target_os = "windows")]
    fn pump_app(app: &mut tauri::App<Wry>, iterations: usize) {
        for _ in 0..iterations {
            let _ = app.run_iteration();
            thread::sleep(Duration::from_millis(20));
        }
    }

    #[cfg(target_os = "windows")]
    fn wait_for_condition<F>(
        app: &mut tauri::App<Wry>,
        timeout: Duration,
        predicate: F,
    ) -> bool
    where
        F: Fn(&tauri::App<Wry>) -> bool,
    {
        let deadline = Instant::now() + timeout;
        loop {
            pump_app(app, 1);
            if predicate(app) {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
        }
    }

    #[cfg(target_os = "windows")]
    fn window_matches_geometry(
        app: &tauri::App<Wry>,
        label: &str,
        expected_x: i32,
        expected_y: i32,
        expected_width: u32,
        expected_height: u32,
    ) -> bool {
        let Some(window) = app.get_window(label) else {
            return false;
        };
        let Ok(position) = window.outer_position() else {
            return false;
        };
        let Ok(size) = window.outer_size() else {
            return false;
        };

        position.x == expected_x
            && position.y == expected_y
            && size.width == expected_width
            && size.height == expected_height
    }

    #[cfg(target_os = "windows")]
    struct TempTestDir {
        path: PathBuf,
    }

    #[cfg(target_os = "windows")]
    impl TempTestDir {
        fn new(prefix: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("pmp-{prefix}-{}-{unique}", std::process::id()));
            std::fs::create_dir_all(&path).expect("create temp dir");
            Self { path }
        }
    }

    #[cfg(target_os = "windows")]
    impl Drop for TempTestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "native Tauri shell-surface smoke requires a desktop session"]
    fn native_tauri_shell_surface_smoke_covers_focus_dismiss_destroy_and_cleanup_timeline() {
        clear_test_state();
        let temp_dir = TempTestDir::new("plugin-shell-surface-native");
        let mut app = create_native_test_app(temp_dir.path.clone());
        pump_app(&mut app, 4);

        let app_handle = app.handle();
        let exit_flag = app.state::<ExitFlag>().0.clone();
        let telemetry_core = app.state::<Arc<TelemetryCore>>().inner().clone();

        assert!(app
            .get_window(crate::windows::MAIN_WINDOW_LABEL)
            .is_some());

        let overlay_label = plugin_shell_surface_label(
            Some("extv2"),
            "overlay",
            "shell-surface-demo",
            "demo-overlay",
        )
        .unwrap();
        let widget_label = plugin_shell_surface_label(
            Some("extv2"),
            "desktop-widget",
            "shell-surface-demo",
            "demo-widget",
        )
        .unwrap();

        open_plugin_shell_surface(
            &app_handle,
            PluginShellSurfaceConfig {
                source_kind: Some("extv2".to_string()),
                plugin_id: "shell-surface-demo".to_string(),
                surface_id: "demo-overlay".to_string(),
                surface_type: "overlay".to_string(),
                geometry: PluginShellSurfaceGeometry {
                    x: 220.0,
                    y: 160.0,
                    width: 480.0,
                    height: 320.0,
                },
                title: Some("Shell Surface Demo Overlay".to_string()),
                always_on_top: true,
                focusable: true,
                pointer_policy: "capture-input".to_string(),
            },
            exit_flag.clone(),
        )
        .unwrap();

        assert!(wait_for_condition(&mut app, Duration::from_secs(2), |app| {
            app.get_window(overlay_label.as_str())
                .and_then(|window| window.is_visible().ok())
                == Some(true)
        }));
        assert_eq!(app.windows().len(), 2);

        open_plugin_shell_surface(
            &app_handle,
            PluginShellSurfaceConfig {
                source_kind: Some("extv2".to_string()),
                plugin_id: "shell-surface-demo".to_string(),
                surface_id: "demo-overlay".to_string(),
                surface_type: "overlay".to_string(),
                geometry: PluginShellSurfaceGeometry {
                    x: 240.0,
                    y: 180.0,
                    width: 500.0,
                    height: 340.0,
                },
                title: Some("Shell Surface Demo Overlay".to_string()),
                always_on_top: true,
                focusable: true,
                pointer_policy: "capture-input".to_string(),
            },
            exit_flag.clone(),
        )
        .unwrap();

        assert!(wait_for_condition(&mut app, Duration::from_secs(2), |app| {
            window_matches_geometry(app, overlay_label.as_str(), 240, 180, 500, 340)
        }));
        assert_eq!(app.windows().len(), 2);

        open_plugin_shell_surface(
            &app_handle,
            PluginShellSurfaceConfig {
                source_kind: Some("extv2".to_string()),
                plugin_id: "shell-surface-demo".to_string(),
                surface_id: "demo-widget".to_string(),
                surface_type: "desktop-widget".to_string(),
                geometry: PluginShellSurfaceGeometry {
                    x: 860.0,
                    y: 520.0,
                    width: 360.0,
                    height: 240.0,
                },
                title: Some("Shell Surface Demo Widget".to_string()),
                always_on_top: false,
                focusable: true,
                pointer_policy: "capture-input".to_string(),
            },
            exit_flag.clone(),
        )
        .unwrap();

        assert!(wait_for_condition(&mut app, Duration::from_secs(2), |app| {
            app.get_window(widget_label.as_str())
                .and_then(|window| window.is_visible().ok())
                == Some(true)
        }));
        assert_eq!(app.windows().len(), 3);

        open_plugin_shell_surface(
            &app_handle,
            PluginShellSurfaceConfig {
                source_kind: Some("extv2".to_string()),
                plugin_id: "shell-surface-demo".to_string(),
                surface_id: "demo-widget".to_string(),
                surface_type: "desktop-widget".to_string(),
                geometry: PluginShellSurfaceGeometry {
                    x: 880.0,
                    y: 540.0,
                    width: 360.0,
                    height: 240.0,
                },
                title: Some("Shell Surface Demo Widget".to_string()),
                always_on_top: false,
                focusable: true,
                pointer_policy: "capture-input".to_string(),
            },
            exit_flag.clone(),
        )
        .unwrap();

        assert!(wait_for_condition(&mut app, Duration::from_secs(2), |app| {
            window_matches_geometry(app, widget_label.as_str(), 880, 540, 360, 240)
        }));
        assert_eq!(app.windows().len(), 3);

        dismiss_plugin_shell_surface(
            &app_handle,
            Some("extv2".to_string()),
            "shell-surface-demo".to_string(),
            "demo-overlay".to_string(),
            "overlay".to_string(),
        )
        .unwrap();

        assert!(wait_for_condition(&mut app, Duration::from_secs(2), |app| {
            app.get_window(overlay_label.as_str())
                .and_then(|window| window.is_visible().ok())
                == Some(false)
        }));
        assert!(app.get_window(overlay_label.as_str()).is_some());

        destroy_plugin_shell_surface(
            &app_handle,
            Some("extv2".to_string()),
            "shell-surface-demo".to_string(),
            "demo-overlay".to_string(),
            "overlay".to_string(),
            Some("capability-revoke".to_string()),
        )
        .unwrap();

        assert!(wait_for_condition(&mut app, Duration::from_secs(2), |app| {
            app.get_window(overlay_label.as_str()).is_none()
        }));

        destroy_plugin_shell_surface(
            &app_handle,
            Some("extv2".to_string()),
            "shell-surface-demo".to_string(),
            "demo-widget".to_string(),
            "desktop-widget".to_string(),
            Some("capability-revoke".to_string()),
        )
        .unwrap();

        assert!(wait_for_condition(&mut app, Duration::from_secs(2), |app| {
            app.get_window(widget_label.as_str()).is_none()
        }));
        assert_eq!(app.windows().len(), 1);

        let telemetry = telemetry_core.read_current_session();
        let shell_events = telemetry
            .records
            .into_iter()
            .filter(|record| record.event.starts_with("window.plugin-shell-surface.native"))
            .collect::<Vec<_>>();
        let shell_event_names = shell_events
            .iter()
            .map(|record| record.event.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            shell_event_names,
            vec![
                "window.plugin-shell-surface.native.created",
                "window.plugin-shell-surface.native.focused-existing",
                "window.plugin-shell-surface.native.created",
                "window.plugin-shell-surface.native.focused-existing",
                "window.plugin-shell-surface.native.dismissed",
                "window.plugin-shell-surface.native.destroy.requested",
                "window.plugin-shell-surface.native.destroyed",
                "window.plugin-shell-surface.native.destroy.requested",
                "window.plugin-shell-surface.native.destroyed",
            ]
        );

        assert_eq!(
            shell_events[0].fields.as_ref().and_then(|fields| fields.get("surfaceId")),
            Some(&json!("demo-overlay"))
        );
        assert_eq!(
            shell_events[1].fields.as_ref().and_then(|fields| fields.get("surfaceId")),
            Some(&json!("demo-overlay"))
        );
        assert_eq!(
            shell_events[1].fields.as_ref().and_then(|fields| fields.get("trigger")),
            Some(&json!("open-command"))
        );
        assert_eq!(
            shell_events[4].fields.as_ref().and_then(|fields| fields.get("trigger")),
            Some(&json!("dismiss-command"))
        );
        assert_eq!(
            shell_events[5].fields.as_ref().and_then(|fields| fields.get("reason")),
            Some(&json!("capability-revoke"))
        );
        assert_eq!(
            shell_events[7].fields.as_ref().and_then(|fields| fields.get("surfaceId")),
            Some(&json!("demo-widget"))
        );
        assert_eq!(
            shell_events[7].fields.as_ref().and_then(|fields| fields.get("reason")),
            Some(&json!("capability-revoke"))
        );

        exit_flag.store(true, Ordering::SeqCst);
        if let Some(main_window) = app.get_window(crate::windows::MAIN_WINDOW_LABEL) {
            let _ = main_window.close();
        }
        let _ = wait_for_condition(&mut app, Duration::from_secs(2), |app| {
            app.windows().is_empty()
        });
        clear_test_state();
    }
}
