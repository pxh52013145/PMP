use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};


use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Position,
    Size, WindowBuilder, WindowUrl,
};

use super::MAIN_WINDOW_LABEL;

pub const ORNAMENTS_OVERLAY_WINDOW_LABEL: &str = "ornaments-overlay";

// NOTE: keep in sync with `OVERLAY_MARGIN_PX` in `apps/desktop/src/OrnamentsOverlayApp.tsx`.
const OVERLAY_MARGIN_CSS_PX: f64 = 240.0;

static OVERLAY_DESIRED_VISIBLE: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, Debug, serde::Deserialize)]
pub struct OverlayRectInput {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[cfg(target_os = "windows")]
mod windows_hit_test {
    use once_cell::sync::Lazy;
    use std::{
        collections::HashMap,
        mem,
        sync::{
            atomic::{AtomicBool, AtomicI32, AtomicU32, Ordering},
            Mutex,
        },
    };
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallWindowProcW, DefWindowProcW, GetWindowLongPtrW, SetWindowLongPtrW, GWLP_WNDPROC,
        HTCLIENT, HTTRANSPARENT, MA_NOACTIVATE, WM_MOUSEACTIVATE,
        WM_NCHITTEST, WNDPROC,
    };

    static OVERLAY_EDITING: AtomicBool = AtomicBool::new(false);
    static OVERLAY_MARGIN_PX_X1000: AtomicU32 = AtomicU32::new(0);
    static OVERLAY_SCREEN_X: AtomicI32 = AtomicI32::new(0);
    static OVERLAY_SCREEN_Y: AtomicI32 = AtomicI32::new(0);
    static OVERLAY_SCALE_X1000: AtomicU32 = AtomicU32::new(1000);

    static MAIN_SCREEN_LEFT: AtomicI32 = AtomicI32::new(0);
    static MAIN_SCREEN_TOP: AtomicI32 = AtomicI32::new(0);
    static MAIN_SCREEN_RIGHT: AtomicI32 = AtomicI32::new(0);
    static MAIN_SCREEN_BOTTOM: AtomicI32 = AtomicI32::new(0);

    #[derive(Clone, Copy, Debug)]
    pub struct HitRect {
        pub x: f64,
        pub y: f64,
        pub width: f64,
        pub height: f64,
    }

    static INTERACTIVE_RECTS: Lazy<Mutex<Vec<HitRect>>> = Lazy::new(|| Mutex::new(Vec::new()));

    #[derive(Clone, Copy, Debug)]
    pub struct ScreenRect {
        pub left: i32,
        pub top: i32,
        pub right: i32,
        pub bottom: i32,
    }

    static PASS_THROUGH_RECTS: Lazy<Mutex<Vec<ScreenRect>>> = Lazy::new(|| Mutex::new(Vec::new()));

    #[derive(Default)]
    struct WndProcRegistry {
        original: HashMap<isize, isize>,
    }

    static WNDPROCS: Lazy<Mutex<WndProcRegistry>> =
        Lazy::new(|| Mutex::new(WndProcRegistry::default()));

    unsafe extern "system" fn wnd_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == WM_MOUSEACTIVATE {
            // Never activate the overlay on click: this avoids raising it above editor windows
            // and prevents it from interfering with other applications.
            return MA_NOACTIVATE as LRESULT;
        }

        if msg == WM_NCHITTEST {
            if !OVERLAY_EDITING.load(Ordering::SeqCst) {
                // Always click-through while not editing.
                return HTTRANSPARENT as LRESULT;
            }

            let pt_screen = POINT {
                x: (lparam & 0xFFFF) as i16 as i32,
                y: ((lparam >> 16) & 0xFFFF) as i16 as i32,
            };

            // Editing: allow interaction only in the "skin edit region" (outside the main rect),
            // and on interactive ornament rects (even when they overlap the main rect).
            // Interactive ornament rects (stored in CSS px, mapped to screen coords here).
            let overlay_x = OVERLAY_SCREEN_X.load(Ordering::SeqCst);
            let overlay_y = OVERLAY_SCREEN_Y.load(Ordering::SeqCst);
            let scale = OVERLAY_SCALE_X1000.load(Ordering::SeqCst) as f64 / 1000.0;
            if let Ok(guard) = INTERACTIVE_RECTS.lock() {
                for r in guard.iter() {
                    let rx = overlay_x as f64 + r.x * scale;
                    let ry = overlay_y as f64 + r.y * scale;
                    let rw = r.width * scale;
                    let rh = r.height * scale;
                    if pt_screen.x as f64 >= rx
                        && pt_screen.x as f64 <= rx + rw
                        && pt_screen.y as f64 >= ry
                        && pt_screen.y as f64 <= ry + rh
                    {
                        return HTCLIENT as LRESULT;
                    }
                }
            }

            // If the pointer is over an editor window, let that window receive the click.
            if let Ok(guard) = PASS_THROUGH_RECTS.lock() {
                for r in guard.iter() {
                    if pt_screen.x >= r.left
                        && pt_screen.x <= r.right
                        && pt_screen.y >= r.top
                        && pt_screen.y <= r.bottom
                    {
                        return HTTRANSPARENT as LRESULT;
                    }
                }
            }

            // Click-through inside main rect so the main UI remains usable.
            let main_left = MAIN_SCREEN_LEFT.load(Ordering::SeqCst);
            let main_top = MAIN_SCREEN_TOP.load(Ordering::SeqCst);
            let main_right = MAIN_SCREEN_RIGHT.load(Ordering::SeqCst);
            let main_bottom = MAIN_SCREEN_BOTTOM.load(Ordering::SeqCst);
            let in_main =
                pt_screen.x >= main_left && pt_screen.x <= main_right && pt_screen.y >= main_top && pt_screen.y <= main_bottom;
            if in_main {
                return HTTRANSPARENT as LRESULT;
            }

            // Outside main: capture events for the edit region (drag to move window, etc.).
            return HTCLIENT as LRESULT;
        }

        let original = {
            let registry = WNDPROCS.lock().ok();
            registry
                .and_then(|r| r.original.get(&(hwnd as isize)).copied())
                .unwrap_or(0)
        };
        if original == 0 {
            return unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) };
        }
        unsafe {
            CallWindowProcW(
                mem::transmute::<isize, WNDPROC>(original),
                hwnd,
                msg,
                wparam,
                lparam,
            )
        }
    }

    pub fn install(hwnd: HWND) {
        unsafe {
            let mut registry = match WNDPROCS.lock() {
                Ok(r) => r,
                Err(_) => return,
            };

            if registry.original.contains_key(&(hwnd as isize)) {
                return;
            }

            let original = GetWindowLongPtrW(hwnd, GWLP_WNDPROC);
            registry.original.insert(hwnd as isize, original);
            drop(registry);

            let _ = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, wnd_proc as isize);
        }
    }

    pub fn set_editing(editing: bool) {
        OVERLAY_EDITING.store(editing, Ordering::SeqCst);
    }

    pub fn set_interactive_rects(rects: Vec<HitRect>) {
        if let Ok(mut guard) = INTERACTIVE_RECTS.lock() {
            *guard = rects;
        }
    }

    pub fn set_pass_through_rects(rects: Vec<ScreenRect>) {
        if let Ok(mut guard) = PASS_THROUGH_RECTS.lock() {
            *guard = rects;
        }
    }

    pub fn set_margin_px(margin_px: f64) {
        let v = (margin_px.max(0.0) * 1000.0).round() as u32;
        OVERLAY_MARGIN_PX_X1000.store(v, Ordering::SeqCst);
    }

    pub fn set_overlay_geometry(screen_x: i32, screen_y: i32, scale_factor: f64) {
        OVERLAY_SCREEN_X.store(screen_x, Ordering::SeqCst);
        OVERLAY_SCREEN_Y.store(screen_y, Ordering::SeqCst);
        let v = (scale_factor.max(0.5).min(5.0) * 1000.0).round() as u32;
        OVERLAY_SCALE_X1000.store(v.max(1), Ordering::SeqCst);
    }

    pub fn set_main_rect(left: i32, top: i32, right: i32, bottom: i32) {
        MAIN_SCREEN_LEFT.store(left, Ordering::SeqCst);
        MAIN_SCREEN_TOP.store(top, Ordering::SeqCst);
        MAIN_SCREEN_RIGHT.store(right, Ordering::SeqCst);
        MAIN_SCREEN_BOTTOM.store(bottom, Ordering::SeqCst);
    }

}

pub fn set_ornaments_overlay_editing(editing: bool) {
    #[cfg(target_os = "windows")]
    windows_hit_test::set_editing(editing);
    let _ = editing;
}

pub fn set_ornaments_overlay_interactive_rects(rects: Vec<OverlayRectInput>) {
    #[cfg(target_os = "windows")]
    windows_hit_test::set_interactive_rects(
        rects
            .into_iter()
            .map(|r| windows_hit_test::HitRect {
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
            })
            .collect(),
    );
    #[cfg(not(target_os = "windows"))]
    let _ = rects;
}

#[cfg(target_os = "windows")]
fn sync_windows_pass_through_rects(app: &AppHandle) {
    let mut rects: Vec<windows_hit_test::ScreenRect> = Vec::new();
    for (label, window) in app.windows() {
        if label == ORNAMENTS_OVERLAY_WINDOW_LABEL || label == MAIN_WINDOW_LABEL {
            continue;
        }
        if !label.starts_with("editor-") {
            continue;
        }
        if !window.is_visible().unwrap_or(false) {
            continue;
        }

        let Ok(pos) = window.outer_position() else {
            continue;
        };
        let Ok(size) = window.outer_size() else {
            continue;
        };

        rects.push(windows_hit_test::ScreenRect {
            left: pos.x,
            top: pos.y,
            right: pos.x + size.width as i32,
            bottom: pos.y + size.height as i32,
        });
    }

    windows_hit_test::set_pass_through_rects(rects);
}

#[cfg(not(target_os = "windows"))]
fn sync_windows_pass_through_rects(_app: &AppHandle) {}

fn resolve_main_bounds(app: &AppHandle) -> Option<(LogicalPosition<f64>, LogicalSize<f64>, f64)> {
    let main = app.get_window(MAIN_WINDOW_LABEL)?;
    let scale_factor = main.scale_factor().unwrap_or(1.0);

    let position: PhysicalPosition<i32> = main.outer_position().ok()?;
    let size: PhysicalSize<u32> = main.outer_size().ok()?;

    let logical_pos = position.to_logical(scale_factor);
    let logical_size = size.to_logical(scale_factor);
    Some((logical_pos, logical_size, scale_factor))
}

fn apply_overlay_geometry(window: &tauri::Window, pos: LogicalPosition<f64>, size: LogicalSize<f64>) {
    if size.width.is_finite() && size.height.is_finite() && size.width > 0.0 && size.height > 0.0
    {
        let _ = window.set_size(Size::Logical(size));
    }

    if pos.x.is_finite() && pos.y.is_finite() {
        let _ = window.set_position(Position::Logical(pos));
    }
}

fn compute_overlay_geometry(
    main_pos: LogicalPosition<f64>,
    main_size: LogicalSize<f64>,
) -> (LogicalPosition<f64>, LogicalSize<f64>) {
    let margin = OVERLAY_MARGIN_CSS_PX;
    (
        LogicalPosition {
            x: main_pos.x - margin,
            y: main_pos.y - margin,
        },
        LogicalSize {
            width: main_size.width + margin * 2.0,
            height: main_size.height + margin * 2.0,
        },
    )
}

#[cfg(target_os = "windows")]
fn apply_windows_owner(overlay: &tauri::Window, owner: &tauri::Window) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowLongPtrW, GWLP_HWNDPARENT};

    let Ok(overlay_hwnd) = overlay.hwnd() else {
        return;
    };

    let Ok(owner_hwnd) = owner.hwnd() else {
        return;
    };

    unsafe {
        // Setting GWLP_HWNDPARENT makes the overlay an owned window:
        // - stays above the owner
        // - follows owner in z-order (covered together)
        // - hides/minimizes with the owner
        let _ = SetWindowLongPtrW(overlay_hwnd.0 as _, GWLP_HWNDPARENT, owner_hwnd.0 as _);
    }
}

#[cfg(target_os = "windows")]
fn sync_windows_hit_test_geometry(app: &AppHandle, overlay: &tauri::Window) {
    let Some(main) = app.get_window(MAIN_WINDOW_LABEL) else {
        return;
    };

    let Ok(main_pos) = main.outer_position() else {
        return;
    };
    let Ok(main_size) = main.outer_size() else {
        return;
    };
    let Ok(overlay_pos) = overlay.outer_position() else {
        return;
    };

    // Overlay is positioned at (main_pos - margin); use that to derive the effective pixel margin.
    let margin_x = (main_pos.x - overlay_pos.x) as f64;
    let margin_y = (main_pos.y - overlay_pos.y) as f64;
    let margin_px = ((margin_x.abs() + margin_y.abs()) / 2.0).max(0.0);
    windows_hit_test::set_margin_px(margin_px);

    windows_hit_test::set_overlay_geometry(overlay_pos.x, overlay_pos.y, overlay.scale_factor().unwrap_or(1.0));
    windows_hit_test::set_main_rect(
        main_pos.x,
        main_pos.y,
        main_pos.x + main_size.width as i32,
        main_pos.y + main_size.height as i32,
    );
    sync_windows_pass_through_rects(app);
}

#[cfg(not(target_os = "windows"))]
fn sync_windows_hit_test_geometry(_app: &AppHandle, _overlay: &tauri::Window) {}

pub fn ensure_ornaments_overlay_window(app: &AppHandle, exit_flag: Arc<AtomicBool>) -> Result<(), String> {
    if let Some(existing) = app.get_window(ORNAMENTS_OVERLAY_WINDOW_LABEL) {
        #[cfg(target_os = "windows")]
        if let Some(main) = app.get_window(MAIN_WINDOW_LABEL) {
            apply_windows_owner(&existing, &main);
        }

        #[cfg(target_os = "windows")]
        if let Ok(hwnd) = existing.hwnd() {
            windows_hit_test::install(hwnd.0 as _);
        }

        #[cfg(target_os = "windows")]
        sync_windows_hit_test_geometry(app, &existing);

        sync_ornaments_overlay_window(app);
        // Keep startup clean: the overlay should only become visible once the frontend decides it
        // should be shown (editing mode or enabled ornaments).
        let _ = existing.set_ignore_cursor_events(true);
        return Ok(());
    }

    let (main_pos, main_size, _scale_factor) = resolve_main_bounds(app)
        .ok_or_else(|| "Unable to resolve main window bounds for ornaments overlay".to_string())?;
    let (pos, size) = compute_overlay_geometry(main_pos, main_size);

    let url = "/#/ornaments-overlay".to_string();
    let window = WindowBuilder::new(
        app,
        ORNAMENTS_OVERLAY_WINDOW_LABEL,
        WindowUrl::App(url.into()),
    )
    .title("Ornaments Overlay")
    .inner_size(size.width, size.height)
    .position(pos.x, pos.y)
    .resizable(false)
    .maximizable(false)
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    .focused(false)
    // Start hidden to avoid showing an oversized "loading" UI while the webview boots.
    // The overlay app will call `ornaments_overlay_set_visible` when it's ready and needed.
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    if let Some(main) = app.get_window(MAIN_WINDOW_LABEL) {
        apply_windows_owner(&window, &main);
    }

    #[cfg(target_os = "windows")]
    if let Ok(hwnd) = window.hwnd() {
        windows_hit_test::install(hwnd.0 as _);
    }

    #[cfg(target_os = "windows")]
    sync_windows_hit_test_geometry(app, &window);

    // Default: click-through. The overlay app toggles this when entering edit mode.
    let _ = window.set_ignore_cursor_events(true);

    let app_handle = app.clone();
    let window_for_events = window.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            if exit_flag.load(Ordering::SeqCst) {
                return;
            }

            api.prevent_close();
            // The overlay is controlled by the frontend; default to hiding on close attempts.
            let _ = window_for_events.hide();
            let _ = window_for_events.set_ignore_cursor_events(true);

            // Best-effort: keep main window focused.
            if let Some(main) = app_handle.get_window(MAIN_WINDOW_LABEL) {
                let _ = main.set_focus();
            }
        }
        _ => {}
    });

    Ok(())
}

pub fn sync_ornaments_overlay_window(app: &AppHandle) {
    let Some(overlay) = app.get_window(ORNAMENTS_OVERLAY_WINDOW_LABEL) else {
        return;
    };

    let Some((main_pos, main_size, _scale_factor)) = resolve_main_bounds(app) else {
        return;
    };

    let (pos, size) = compute_overlay_geometry(main_pos, main_size);
    apply_overlay_geometry(&overlay, pos, size);

    #[cfg(target_os = "windows")]
    sync_windows_hit_test_geometry(app, &overlay);
}

pub fn show_ornaments_overlay_window(app: &AppHandle) {
    if let Some(overlay) = app.get_window(ORNAMENTS_OVERLAY_WINDOW_LABEL) {
        sync_ornaments_overlay_window(app);
        let _ = overlay.show();
    }
}

pub fn hide_ornaments_overlay_window(app: &AppHandle) {
    if let Some(overlay) = app.get_window(ORNAMENTS_OVERLAY_WINDOW_LABEL) {
        let _ = overlay.hide();
    }
}

pub fn set_ornaments_overlay_desired_visible(app: &AppHandle, visible: bool) {
    OVERLAY_DESIRED_VISIBLE.store(visible, Ordering::SeqCst);
    if visible {
        show_ornaments_overlay_window(app);
    } else {
        hide_ornaments_overlay_window(app);
    }
}

pub fn apply_ornaments_overlay_desired_visibility(app: &AppHandle) {
    let visible = OVERLAY_DESIRED_VISIBLE.load(Ordering::SeqCst);
    if visible {
        show_ornaments_overlay_window(app);
    } else {
        hide_ornaments_overlay_window(app);
    }
}
