use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Position, Size, WindowBuilder, WindowUrl};

use super::{EVENT_EDITOR_EXIT, EVENT_EDITOR_WINDOW_HIDDEN, EVENT_EDITOR_WINDOW_SHOWN};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditorWindowType {
    Control,
    Statistics,
    Library,
    Style,
    Help,
    Creator,
    Background,
    CustomBackground,
    Debug,
}

impl EditorWindowType {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "control" => Some(Self::Control),
            "statistics" => Some(Self::Statistics),
            "library" => Some(Self::Library),
            "style" => Some(Self::Style),
            "help" => Some(Self::Help),
            "creator" => Some(Self::Creator),
            "background" => Some(Self::Background),
            "custom-background" => Some(Self::CustomBackground),
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
            Self::Help => "help",
            Self::Creator => "creator",
            Self::Background => "background",
            Self::CustomBackground => "custom-background",
            Self::Debug => "debug",
        }
    }
}

pub const ALL_EDITOR_WINDOWS: &[EditorWindowType] = &[
    EditorWindowType::Control,
    EditorWindowType::Statistics,
    EditorWindowType::Library,
    EditorWindowType::Style,
    EditorWindowType::Help,
    EditorWindowType::Creator,
    EditorWindowType::Background,
    EditorWindowType::CustomBackground,
    EditorWindowType::Debug,
];

pub const CONTROL_CLOSE_HIDE_WINDOWS: &[EditorWindowType] = &[
    EditorWindowType::Statistics,
    EditorWindowType::Library,
    EditorWindowType::Style,
    EditorWindowType::Help,
    EditorWindowType::Creator,
    EditorWindowType::Background,
    EditorWindowType::CustomBackground,
];

pub fn label(window_type: EditorWindowType) -> &'static str {
    match window_type {
        EditorWindowType::Control => "editor-control",
        EditorWindowType::Statistics => "editor-statistics",
        EditorWindowType::Library => "editor-library",
        EditorWindowType::Style => "editor-style",
        EditorWindowType::Help => "editor-help",
        EditorWindowType::Creator => "editor-creator",
        EditorWindowType::Background => "editor-background",
        EditorWindowType::CustomBackground => "editor-custom-background",
        EditorWindowType::Debug => "editor-debug",
    }
}

pub fn title(window_type: EditorWindowType) -> &'static str {
    match window_type {
        EditorWindowType::Control => "编辑器控制",
        EditorWindowType::Statistics => "统计信息",
        EditorWindowType::Library => "Magnet 库",
        EditorWindowType::Style => "风格设置",
        EditorWindowType::Help => "使用说明",
        EditorWindowType::Creator => "创建/导入 Magnet",
        EditorWindowType::Background => "背景管理",
        EditorWindowType::CustomBackground => "自定义背景",
        EditorWindowType::Debug => "主题系统调试",
    }
}

pub struct EditorWindowGeometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

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

fn apply_geometry(window: &tauri::Window, geometry: &EditorWindowGeometry) {
    // Best-effort: avoid failing to reopen a window just because geometry is invalid.
    if geometry.width.is_finite() && geometry.height.is_finite() && geometry.width > 0.0 && geometry.height > 0.0 {
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

pub fn open_editor_window(
    app: &AppHandle,
    window_type: EditorWindowType,
    geometry: EditorWindowGeometry,
    exit_flag: Arc<AtomicBool>,
    blur_enabled: bool,
) -> Result<(), String> {
    let window_label = label(window_type);

    if let Some(existing_window) = app.get_window(window_label) {
        // When the window already exists (possibly hidden/off-screen), always re-apply geometry so the
        // caller can bring it back to a visible location.
        apply_geometry(&existing_window, &geometry);
        apply_windows_blur_behind(&existing_window, blur_enabled);
        let _ = existing_window.show();
        let _ = existing_window.unminimize();
        existing_window.set_focus().map_err(|e| e.to_string())?;
        let _ = app.emit_all(EVENT_EDITOR_WINDOW_SHOWN, window_type.as_str());
        return Ok(());
    }

    let url = format!("/#/editor/{}", window_type.as_str());

    let window = WindowBuilder::new(app, window_label, WindowUrl::App(url.into()))
        .title(title(window_type))
        .inner_size(geometry.width, geometry.height)
        .position(geometry.x, geometry.y)
        .resizable(false)
        .maximizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .build()
        .map_err(|e| e.to_string())?;

    // Prefer system backdrop effects over CSS `backdrop-filter` to avoid scroll/paint jank in WebView2.
    //
    // IMPORTANT: DWMWA_SYSTEMBACKDROP_TYPE (Mica/Tabbed) paints the whole window background and breaks
    // per-pixel transparency (our "floating" editor windows). Instead, use DWM blur-behind with a region
    // so corners/padding remain truly transparent, while the panel area gets a system blur.
    apply_windows_blur_behind(&window, blur_enabled);

    let _ = app.emit_all(EVENT_EDITOR_WINDOW_SHOWN, window_type.as_str());

    let window_for_hide = window.clone();
    let app_handle = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            if exit_flag.load(Ordering::SeqCst) {
                return;
            }

            api.prevent_close();
            let _ = window_for_hide.hide();
            let _ = app_handle.emit_all(EVENT_EDITOR_WINDOW_HIDDEN, window_type.as_str());

            if window_type == EditorWindowType::Control {
                let _ = app_handle.emit_all(EVENT_EDITOR_EXIT, ());
                for wtype in CONTROL_CLOSE_HIDE_WINDOWS {
                    if let Some(w) = app_handle.get_window(label(*wtype)) {
                        let _ = w.hide();
                        let _ = app_handle.emit_all(EVENT_EDITOR_WINDOW_HIDDEN, wtype.as_str());
                    }
                }
            }
        }
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

pub fn hide_editor_window(app: &AppHandle, window_type: EditorWindowType) -> Result<(), String> {
    if let Some(window) = app.get_window(label(window_type)) {
        window.hide().map_err(|e| e.to_string())?;
        let _ = app.emit_all(EVENT_EDITOR_WINDOW_HIDDEN, window_type.as_str());
    }

    Ok(())
}

pub fn hide_all_editor_windows(app: &AppHandle) -> Result<(), String> {
    for window_type in ALL_EDITOR_WINDOWS {
        if let Some(window) = app.get_window(label(*window_type)) {
            let _ = window.hide();
            let _ = app.emit_all(EVENT_EDITOR_WINDOW_HIDDEN, window_type.as_str());
        }
    }

    Ok(())
}

pub fn close_all_editor_windows(app: &AppHandle) {
    for window_type in ALL_EDITOR_WINDOWS {
        if let Some(window) = app.get_window(label(*window_type)) {
            let _ = window.close();
        }
    }
}
