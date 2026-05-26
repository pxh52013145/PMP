use std::collections::HashSet;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};

use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Position,
    Size, WindowBuilder, WindowUrl,
};

use super::{
    EVENT_EDITOR_EXIT, EVENT_EDITOR_WINDOW_HIDDEN, EVENT_EDITOR_WINDOW_SHOWN, MAIN_WINDOW_LABEL,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EditorWindowType {
    Control,
    Statistics,
    Library,
    Style,
    StylePixel,
    StyleCoverColor,
    StyleBackgroundEffect,
    StyleBorderEffect,
    Creator,
    Background,
    CustomBackground,
    Theme,
    Debug,
}

impl EditorWindowType {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "control" => Some(Self::Control),
            "statistics" => Some(Self::Statistics),
            "library" => Some(Self::Library),
            "style" => Some(Self::Style),
            "style-pixel" => Some(Self::StylePixel),
            "style-cover-color" => Some(Self::StyleCoverColor),
            "style-background-effect" => Some(Self::StyleBackgroundEffect),
            "style-border-effect" => Some(Self::StyleBorderEffect),
            "help" => Some(Self::Debug),
            "creator" => Some(Self::Creator),
            "background" => Some(Self::Background),
            "custom-background" => Some(Self::CustomBackground),
            "theme" => Some(Self::Theme),
            "debug" => Some(Self::Debug),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Control => "control",
            Self::Statistics => "statistics",
            Self::Library => "library",
            Self::Style => "style",
            Self::StylePixel => "style-pixel",
            Self::StyleCoverColor => "style-cover-color",
            Self::StyleBackgroundEffect => "style-background-effect",
            Self::StyleBorderEffect => "style-border-effect",
            Self::Creator => "creator",
            Self::Background => "background",
            Self::CustomBackground => "custom-background",
            Self::Theme => "theme",
            Self::Debug => "debug",
        }
    }
}

pub const ALL_EDITOR_WINDOWS: &[EditorWindowType] = &[
    EditorWindowType::Control,
    EditorWindowType::Statistics,
    EditorWindowType::Library,
    EditorWindowType::Style,
    EditorWindowType::StylePixel,
    EditorWindowType::StyleCoverColor,
    EditorWindowType::StyleBackgroundEffect,
    EditorWindowType::StyleBorderEffect,
    EditorWindowType::Creator,
    EditorWindowType::Background,
    EditorWindowType::CustomBackground,
    EditorWindowType::Theme,
    EditorWindowType::Debug,
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorWindowDebugInfo {
    pub window_type: String,
    pub exists: bool,
    pub visible: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorWindowsDebugState {
    pub windows: Vec<EditorWindowDebugInfo>,
}

pub const CONTROL_CLOSE_CHILD_WINDOWS: &[EditorWindowType] = &[
    EditorWindowType::Statistics,
    EditorWindowType::Library,
    EditorWindowType::Style,
    EditorWindowType::StylePixel,
    EditorWindowType::StyleCoverColor,
    EditorWindowType::StyleBackgroundEffect,
    EditorWindowType::StyleBorderEffect,
    EditorWindowType::Creator,
    EditorWindowType::Background,
    EditorWindowType::CustomBackground,
    EditorWindowType::Theme,
    EditorWindowType::Debug,
];

pub fn label(window_type: EditorWindowType) -> &'static str {
    match window_type {
        EditorWindowType::Control => "editor-control",
        EditorWindowType::Statistics => "editor-statistics",
        EditorWindowType::Library => "editor-library",
        EditorWindowType::Style => "editor-style",
        EditorWindowType::StylePixel => "editor-style-pixel",
        EditorWindowType::StyleCoverColor => "editor-style-cover-color",
        EditorWindowType::StyleBackgroundEffect => "editor-style-background-effect",
        EditorWindowType::StyleBorderEffect => "editor-style-border-effect",
        EditorWindowType::Creator => "editor-creator",
        EditorWindowType::Background => "editor-background",
        EditorWindowType::CustomBackground => "editor-custom-background",
        EditorWindowType::Theme => "editor-theme",
        EditorWindowType::Debug => "editor-debug",
    }
}

pub fn title(window_type: EditorWindowType) -> &'static str {
    match window_type {
        // Use ASCII-only titles to avoid encoding issues in source control / toolchains.
        EditorWindowType::Control => "Editor",
        EditorWindowType::Statistics => "Statistics",
        EditorWindowType::Library => "Library",
        EditorWindowType::Style => "Style",
        EditorWindowType::StylePixel => "Style - PIXEL",
        EditorWindowType::StyleCoverColor => "Style - Cover color",
        EditorWindowType::StyleBackgroundEffect => "Style - Background effect",
        EditorWindowType::StyleBorderEffect => "Style - Border effect",
        EditorWindowType::Creator => "Magnet Editor",
        EditorWindowType::Background => "Background",
        EditorWindowType::CustomBackground => "Custom background",
        EditorWindowType::Theme => "Theme",
        EditorWindowType::Debug => "Debug",
    }
}

#[derive(Debug, Clone, Copy)]
pub struct EditorWindowGeometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

const STYLE_BAR_HEIGHT_CSS_PX: f64 = 96.0;
const STYLE_BAR_GAP_CSS_PX: f64 = 8.0;

fn compute_style_bar_geometry(app: &AppHandle) -> Option<EditorWindowGeometry> {
    let main = app.get_window(MAIN_WINDOW_LABEL)?;
    let scale_factor = main.scale_factor().unwrap_or(1.0);

    let position: PhysicalPosition<i32> = main.outer_position().ok()?;
    let size: PhysicalSize<u32> = main.outer_size().ok()?;

    let logical_pos = position.to_logical(scale_factor);
    let logical_size = size.to_logical(scale_factor);

    Some(EditorWindowGeometry {
        x: logical_pos.x,
        y: logical_pos.y + logical_size.height + STYLE_BAR_GAP_CSS_PX,
        width: logical_size.width,
        height: STYLE_BAR_HEIGHT_CSS_PX,
    })
}

static EDITOR_WINDOWS_REVISION: AtomicU64 = AtomicU64::new(0);

static FORCE_CLOSE_WINDOWS: Lazy<Mutex<HashSet<EditorWindowType>>> =
    Lazy::new(|| Mutex::new(HashSet::new()));

#[cfg(target_os = "windows")]
fn apply_windows_blur_behind(window: &tauri::Window, enabled: bool) {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::Graphics::Dwm::{
        DwmEnableBlurBehindWindow, DWM_BB_BLURREGION, DWM_BB_ENABLE, DWM_BLURBEHIND,
    };
    use windows_sys::Win32::Graphics::Gdi::{CreatePolygonRgn, DeleteObject, WINDING};

    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    unsafe {
        if !enabled {
            let bb = DWM_BLURBEHIND {
                dwFlags: DWM_BB_ENABLE,
                fEnable: 0,
                hRgnBlur: std::ptr::null_mut(),
                fTransitionOnMaximized: 0,
            };
            let _ = DwmEnableBlurBehindWindow(hwnd.0 as _, &bb);
            return;
        }
    }

    let Ok(size) = window.inner_size() else {
        return;
    };
    let scale_factor = window.scale_factor().unwrap_or(1.0);

    const ROOT_PADDING_CSS_PX: f64 = 20.0;
    const CURVE_CSS_PX: f64 = 16.0; // matches default 1em-ish cut corner

    let root_padding = (ROOT_PADDING_CSS_PX * scale_factor).round() as i32;
    let curve_px = (CURVE_CSS_PX * scale_factor).round() as i32;

    let w = size.width as i32;
    let h = size.height as i32;

    if w <= root_padding + 1 || h <= root_padding + 1 {
        return;
    }

    let left = root_padding;
    let top = root_padding;
    let right = (w - root_padding).max(left + 1);
    let bottom = (h - root_padding).max(top + 1);

    let curve = curve_px
        .min((right - left).max(1))
        .min((bottom - top).max(1));

    let points: [POINT; 6] = [
        POINT {
            x: left,
            y: top + curve,
        },
        POINT {
            x: left + curve,
            y: top,
        },
        POINT { x: right, y: top },
        POINT {
            x: right,
            y: bottom - curve,
        },
        POINT {
            x: right - curve,
            y: bottom,
        },
        POINT { x: left, y: bottom },
    ];

    unsafe {
        let region = CreatePolygonRgn(points.as_ptr(), points.len() as i32, WINDING);
        if region.is_null() {
            return;
        }

        let bb = DWM_BLURBEHIND {
            dwFlags: DWM_BB_ENABLE | DWM_BB_BLURREGION,
            fEnable: 1,
            hRgnBlur: region,
            fTransitionOnMaximized: 0,
        };
        let _ = DwmEnableBlurBehindWindow(hwnd.0 as _, &bb);
        let _ = DeleteObject(region as _);
    }
}

#[cfg(not(target_os = "windows"))]
fn apply_windows_blur_behind(_window: &tauri::Window, _enabled: bool) {}

#[cfg(target_os = "windows")]
fn apply_windows_owner(window: &tauri::Window, owner: &tauri::Window) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowLongPtrW, GWLP_HWNDPARENT};

    let Ok(window_hwnd) = window.hwnd() else {
        return;
    };
    let Ok(owner_hwnd) = owner.hwnd() else {
        return;
    };

    unsafe {
        // Setting GWLP_HWNDPARENT makes this an owned window:
        // - stays above the owner
        // - follows owner in z-order (covered together)
        // - hides/minimizes with the owner
        let _ = SetWindowLongPtrW(window_hwnd.0 as _, GWLP_HWNDPARENT, owner_hwnd.0 as _);
    }
}

#[cfg(not(target_os = "windows"))]
fn apply_windows_owner(_window: &tauri::Window, _owner: &tauri::Window) {}

fn apply_geometry(window: &tauri::Window, geometry: &EditorWindowGeometry) {
    // Best-effort: avoid failing to reopen a window just because geometry is invalid.
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

fn apply_always_on_top_preference(window: &tauri::Window, always_on_top: Option<bool>) {
    if let Some(value) = always_on_top {
        let _ = window.set_always_on_top(value);
    }
}

fn request_force_close(app: &AppHandle, window_type: EditorWindowType) {
    let Some(window) = app.get_window(label(window_type)) else {
        return;
    };

    {
        let mut set = match FORCE_CLOSE_WINDOWS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        set.insert(window_type);
    }

    if window.close().is_err() {
        let mut set = match FORCE_CLOSE_WINDOWS.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        set.remove(&window_type);
        return;
    }

    // Keep the JS side in sync even when we force-close (destroy) a window: the normal "CloseRequested"
    // handler is bypassed and therefore would not emit a hidden event.
    let _ = app.emit_all(EVENT_EDITOR_WINDOW_HIDDEN, window_type.as_str());
}

fn take_force_close(window_type: EditorWindowType) -> bool {
    let mut set = match FORCE_CLOSE_WINDOWS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    set.remove(&window_type)
}

fn destroy_window(app: &AppHandle, window_type: EditorWindowType) {
    request_force_close(app, window_type);
}

pub fn set_editor_windows_memory_first_enabled(
    _app: &AppHandle,
    _enabled: bool,
) -> Result<(), String> {
    Ok(())
}

pub fn open_editor_window(
    app: &AppHandle,
    window_type: EditorWindowType,
    geometry: EditorWindowGeometry,
    always_on_top: Option<bool>,
    _memory_first: Option<bool>,
    exit_flag: Arc<AtomicBool>,
    blur_enabled: Arc<AtomicBool>,
) -> Result<(), String> {
    let geometry = if window_type == EditorWindowType::Style {
        compute_style_bar_geometry(app).unwrap_or(geometry)
    } else {
        geometry
    };

    let window_label = label(window_type);
    // Avoid stealing focus from the main window when entering edit mode: on some Windows setups,
    // rapidly switching focus between two transparent WebView2 windows can cause a visible "flash".
    // Users can still click the editor window to focus it when needed.
    let should_focus = window_type != EditorWindowType::Control;

    if let Some(existing_window) = app.get_window(window_label) {
        if let Some(main) = app.get_window(MAIN_WINDOW_LABEL) {
            apply_windows_owner(&existing_window, &main);
        }
        // When the window already exists (possibly hidden/off-screen), always re-apply geometry so the
        // caller can bring it back to a visible location.
        apply_geometry(&existing_window, &geometry);
        let _ = existing_window.show();
        let _ = existing_window.unminimize();
        if should_focus {
            existing_window.set_focus().map_err(|e| e.to_string())?;
        } else if window_type == EditorWindowType::Control {
            // Best-effort: keep the main window focused to avoid transient focus swaps between transparent
            // WebView2 windows, which can trigger a visible "flash" on some Windows setups.
            if let Some(main_window) = app.get_window(MAIN_WINDOW_LABEL) {
                let _ = main_window.set_focus();
            }
        }
        apply_always_on_top_preference(&existing_window, always_on_top);
        EDITOR_WINDOWS_REVISION.fetch_add(1, Ordering::SeqCst);
        apply_windows_blur_behind(&existing_window, blur_enabled.load(Ordering::SeqCst));
        let _ = app.emit_all(EVENT_EDITOR_WINDOW_SHOWN, window_type.as_str());
        return Ok(());
    }

    let url = format!("/#/editor/{}", window_type.as_str());

    let initial_always_on_top = always_on_top.unwrap_or(!cfg!(target_os = "windows"));

    let window = WindowBuilder::new(app, window_label, WindowUrl::App(url.into()))
        .title(title(window_type))
        .inner_size(geometry.width, geometry.height)
        .position(geometry.x, geometry.y)
        .resizable(false)
        .maximizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(initial_always_on_top)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;

    if let Some(main) = app.get_window(MAIN_WINDOW_LABEL) {
        apply_windows_owner(&window, &main);
    }

    // Prefer system backdrop effects over CSS `backdrop-filter` to avoid scroll/paint jank in WebView2.
    //
    // IMPORTANT: DWMWA_SYSTEMBACKDROP_TYPE (Mica/Tabbed) paints the whole window background and breaks
    // per-pixel transparency (our "floating" editor windows). Instead, use DWM blur-behind with a region
    // so corners/padding remain truly transparent, while the panel area gets a system blur.
    let _ = window.show();
    let _ = window.unminimize();
    if should_focus {
        window.set_focus().map_err(|e| e.to_string())?;
    } else if window_type == EditorWindowType::Control {
        if let Some(main_window) = app.get_window(MAIN_WINDOW_LABEL) {
            let _ = main_window.set_focus();
        }
    }

    apply_always_on_top_preference(&window, always_on_top);

    EDITOR_WINDOWS_REVISION.fetch_add(1, Ordering::SeqCst);
    apply_windows_blur_behind(&window, blur_enabled.load(Ordering::SeqCst));

    let _ = app.emit_all(EVENT_EDITOR_WINDOW_SHOWN, window_type.as_str());
    // (Ornaments editor removed)

    let window_for_events = window.clone();
    let app_handle = app.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            if exit_flag.load(Ordering::SeqCst) || take_force_close(window_type) {
                return;
            }

            api.prevent_close();

            if window_type == EditorWindowType::Control {
                let _ = app_handle.emit_all(EVENT_EDITOR_EXIT, ());
                for wtype in CONTROL_CLOSE_CHILD_WINDOWS {
                    destroy_window(&app_handle, *wtype);
                }
            }

            // Destroy this window immediately (webview is freed, JS cleanup runs)
            let _ = window_for_events.hide();
            let _ = app_handle.emit_all(EVENT_EDITOR_WINDOW_HIDDEN, window_type.as_str());
            request_force_close(&app_handle, window_type);
        }
        tauri::WindowEvent::Moved(_) => {}
        _ => {}
    });

    Ok(())
}

pub fn set_editor_windows_blur_enabled(app: &AppHandle, enabled: bool) -> Result<(), String> {
    for window_type in ALL_EDITOR_WINDOWS {
        if let Some(window) = app.get_window(label(*window_type)) {
            apply_windows_blur_behind(&window, enabled);
        }
    }

    Ok(())
}

pub fn sync_style_bar_window(app: &AppHandle) {
    let Some(window) = app.get_window(label(EditorWindowType::Style)) else {
        return;
    };

    let Some(geometry) = compute_style_bar_geometry(app) else {
        return;
    };

    apply_geometry(&window, &geometry);
}

pub fn close_editor_window(
    app: &AppHandle,
    window_type: EditorWindowType,
    _memory_first: Option<bool>,
) -> Result<(), String> {
    if window_type == EditorWindowType::Control {
        EDITOR_WINDOWS_REVISION.fetch_add(1, Ordering::SeqCst);

        if let Some(main_window) = app.get_window(MAIN_WINDOW_LABEL) {
            let should_show = main_window.is_visible().ok() == Some(false);
            if should_show {
                let _ = main_window.show();
            }

            let should_unminimize = main_window.is_minimized().ok() == Some(true);
            if should_unminimize {
                let _ = main_window.unminimize();
            }

            let _ = main_window.set_focus();
        }

        let _ = app.emit_all(EVENT_EDITOR_EXIT, ());

        // Destroy all editor windows immediately
        for wtype in CONTROL_CLOSE_CHILD_WINDOWS {
            destroy_window(app, *wtype);
        }
        destroy_window(app, window_type);

        return Ok(());
    }

    // Non-control windows: destroy immediately
    destroy_window(app, window_type);

    Ok(())
}

pub fn close_all_editor_windows(app: &AppHandle) {
    for window_type in ALL_EDITOR_WINDOWS {
        request_force_close(app, *window_type);
    }
}

pub fn debug_get_editor_windows_state(app: &AppHandle) -> EditorWindowsDebugState {
    let mut windows: Vec<EditorWindowDebugInfo> = Vec::new();
    for window_type in ALL_EDITOR_WINDOWS {
        let window = app.get_window(label(*window_type));
        let exists = window.is_some();
        let visible = window.and_then(|w| w.is_visible().ok()).unwrap_or(false);

        windows.push(EditorWindowDebugInfo {
            window_type: window_type.as_str().to_string(),
            exists,
            visible,
        });
    }

    EditorWindowsDebugState { windows }
}

/// Best-effort memory reclamation: destroy hidden editor windows to release WebView resources.
///
/// Safety: only destroys windows that are currently not visible.
pub fn governance_destroy_hidden_editor_windows(app: &AppHandle) -> usize {
    let mut destroyed = 0usize;
    for window_type in ALL_EDITOR_WINDOWS {
        let Some(window) = app.get_window(label(*window_type)) else {
            continue;
        };

        let is_visible = window.is_visible().ok().unwrap_or(false);
        if is_visible {
            continue;
        }

        destroy_window(app, *window_type);
        destroyed += 1;
    }

    destroyed
}
