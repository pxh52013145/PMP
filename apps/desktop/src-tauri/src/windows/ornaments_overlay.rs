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

static OVERLAY_EDITING: AtomicBool = AtomicBool::new(false);

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
        GWL_EXSTYLE, HTCLIENT, HTTRANSPARENT, MA_NOACTIVATE, WM_MOUSEACTIVATE, WM_NCHITTEST,
        SetWindowPos, WNDPROC, HWND_NOTOPMOST, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOSIZE, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
    };

    static EDITING: AtomicBool = AtomicBool::new(false);
    static OVERLAY_SCREEN_X: AtomicI32 = AtomicI32::new(0);
    static OVERLAY_SCREEN_Y: AtomicI32 = AtomicI32::new(0);
    static OVERLAY_SCALE_X1000: AtomicU32 = AtomicU32::new(1000);

    #[derive(Clone, Copy, Debug)]
    pub struct HitRect {
        pub x: f64,
        pub y: f64,
        pub width: f64,
        pub height: f64,
    }

    static INTERACTIVE_RECTS: Lazy<Mutex<Vec<HitRect>>> = Lazy::new(|| Mutex::new(Vec::new()));

    #[derive(Default)]
    struct WndProcRegistry {
        original: HashMap<isize, isize>,
    }

    static WNDPROCS: Lazy<Mutex<WndProcRegistry>> =
        Lazy::new(|| Mutex::new(WndProcRegistry::default()));

    fn apply_overlay_window_styles(hwnd: HWND) {
        unsafe {
            let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            if ex_style == 0 {
                return;
            }

            // Layered (transparent) + never activate + toolwindow; ensure not topmost.
            let next = (ex_style
                | (WS_EX_LAYERED as isize)
                | (WS_EX_NOACTIVATE as isize)
                | (WS_EX_TOOLWINDOW as isize))
                & !(WS_EX_TOPMOST as isize);
            let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);

            // Ensure the change takes effect and clear any topmost z-order state.
            let _ = SetWindowPos(
                hwnd,
                HWND_NOTOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }

    unsafe extern "system" fn wnd_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == WM_MOUSEACTIVATE {
            // Never activate the overlay on click (prevents z-order promotion / focus stealing).
            return MA_NOACTIVATE as LRESULT;
        }

        if msg == WM_NCHITTEST {
            if !EDITING.load(Ordering::SeqCst) {
                // Not editing: fully click-through.
                return HTTRANSPARENT as LRESULT;
            }

            let pt_screen = POINT {
                x: (lparam & 0xFFFF) as i16 as i32,
                y: ((lparam >> 16) & 0xFFFF) as i16 as i32,
            };

            // Editing: only ornaments/handles are interactive; everything else must be click-through.
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

            return HTTRANSPARENT as LRESULT;
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

            apply_overlay_window_styles(hwnd);

            let original = GetWindowLongPtrW(hwnd, GWLP_WNDPROC);
            registry.original.insert(hwnd as isize, original);
            drop(registry);

            let _ = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, wnd_proc as isize);
        }
    }

    pub fn set_editing(editing: bool) {
        EDITING.store(editing, Ordering::SeqCst);
    }

    pub fn set_interactive_rects(rects: Vec<HitRect>) {
        if let Ok(mut guard) = INTERACTIVE_RECTS.lock() {
            *guard = rects;
        }
    }

    pub fn set_overlay_geometry(screen_x: i32, screen_y: i32, scale_factor: f64) {
        OVERLAY_SCREEN_X.store(screen_x, Ordering::SeqCst);
        OVERLAY_SCREEN_Y.store(screen_y, Ordering::SeqCst);
        let v = (scale_factor.max(0.5).min(5.0) * 1000.0).round() as u32;
        OVERLAY_SCALE_X1000.store(v.max(1), Ordering::SeqCst);
    }
}

pub fn set_ornaments_overlay_editing(editing: bool) {
    OVERLAY_EDITING.store(editing, Ordering::SeqCst);
    #[cfg(target_os = "windows")]
    windows_hit_test::set_editing(editing);
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

fn resolve_main_bounds(app: &AppHandle) -> Option<(LogicalPosition<f64>, LogicalSize<f64>, f64)> {
    let main = app.get_window(MAIN_WINDOW_LABEL)?;
    let scale_factor = main.scale_factor().unwrap_or(1.0);

    let position: PhysicalPosition<i32> = main.outer_position().ok()?;
    let size: PhysicalSize<u32> = main.outer_size().ok()?;

    let logical_pos = position.to_logical(scale_factor);
    let logical_size = size.to_logical(scale_factor);
    Some((logical_pos, logical_size, scale_factor))
}

fn compute_overlay_geometry(
    main_pos: LogicalPosition<f64>,
    main_size: LogicalSize<f64>,
) -> (LogicalPosition<f64>, LogicalSize<f64>) {
    let m = OVERLAY_MARGIN_CSS_PX;
    (
        LogicalPosition {
            x: main_pos.x - m,
            y: main_pos.y - m,
        },
        LogicalSize {
            width: main_size.width + m * 2.0,
            height: main_size.height + m * 2.0,
        },
    )
}

fn apply_geometry(window: &tauri::Window, pos: LogicalPosition<f64>, size: LogicalSize<f64>) {
    if size.width.is_finite() && size.height.is_finite() && size.width > 0.0 && size.height > 0.0
    {
        let _ = window.set_size(Size::Logical(size));
    }

    if pos.x.is_finite() && pos.y.is_finite() {
        let _ = window.set_position(Position::Logical(pos));
    }
}

#[cfg(target_os = "windows")]
fn sync_windows_z_order(app: &AppHandle, overlay: &tauri::Window) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_NOTOPMOST, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOSIZE, WS_EX_TOPMOST,
    };

    let Ok(overlay_hwnd) = overlay.hwnd() else {
        return;
    };

    unsafe {
        let _ = SetWindowPos(
            overlay_hwnd.0 as _,
            HWND_NOTOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }

    let Some(main) = app.get_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    let Ok(main_hwnd) = main.hwnd() else {
        return;
    };

    let main_ex = unsafe { GetWindowLongPtrW(main_hwnd.0 as _, GWL_EXSTYLE) };
    if (main_ex & (WS_EX_TOPMOST as isize)) != 0 {
        // If main is topmost, the overlay (non-topmost) will always stay below it anyway.
        return;
    }

    // Always keep the overlay behind the main window. The overlay is larger than main, so it will
    // still be visible around it, but will never cover the main nor interfere with other windows' z-order.
    unsafe {
        let _ = SetWindowPos(
            overlay_hwnd.0 as _,
            main_hwnd.0 as _,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn sync_windows_z_order(_app: &AppHandle, _overlay: &tauri::Window) {}

#[cfg(target_os = "windows")]
fn sync_windows_geometry(app: &AppHandle, overlay: &tauri::Window) {
    let Ok(pos) = overlay.outer_position() else {
        return;
    };
    windows_hit_test::set_overlay_geometry(pos.x, pos.y, overlay.scale_factor().unwrap_or(1.0));
    let _ = app;
}

#[cfg(not(target_os = "windows"))]
fn sync_windows_geometry(_app: &AppHandle, _overlay: &tauri::Window) {}

#[cfg(target_os = "windows")]
fn show_window_no_activate(app: &AppHandle, overlay: &tauri::Window) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    };

    let Ok(overlay_hwnd) = overlay.hwnd() else {
        return;
    };

    unsafe {
        let _ = SetWindowPos(
            overlay_hwnd.0 as _,
            HWND_TOP,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
    }

    sync_windows_z_order(app, overlay);
}

#[cfg(not(target_os = "windows"))]
fn show_window_no_activate(_app: &AppHandle, overlay: &tauri::Window) {
    let _ = overlay.show();
}

pub fn ensure_ornaments_overlay_window(app: &AppHandle, exit_flag: Arc<AtomicBool>) -> Result<(), String> {
    if let Some(existing) = app.get_window(ORNAMENTS_OVERLAY_WINDOW_LABEL) {
        #[cfg(target_os = "windows")]
        if let Ok(hwnd) = existing.hwnd() {
            windows_hit_test::install(hwnd.0 as _);
        }

        sync_ornaments_overlay_window(app);
        return Ok(());
    }

    let (main_pos, main_size, _scale_factor) = resolve_main_bounds(app)
        .ok_or_else(|| "Unable to resolve main window bounds for ornaments overlay".to_string())?;
    let (pos, size) = compute_overlay_geometry(main_pos, main_size);

    let url = "/#/ornaments-overlay".to_string();
    let window = WindowBuilder::new(app, ORNAMENTS_OVERLAY_WINDOW_LABEL, WindowUrl::App(url.into()))
        .title("Ornaments Overlay")
        .inner_size(size.width, size.height)
        .position(pos.x, pos.y)
        .resizable(false)
        .maximizable(false)
        .decorations(false)
        .transparent(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    if let Ok(hwnd) = window.hwnd() {
        windows_hit_test::install(hwnd.0 as _);
    }

    let app_handle = app.clone();
    let window_for_events = window.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            if exit_flag.load(Ordering::SeqCst) {
                return;
            }
            api.prevent_close();
            let _ = window_for_events.hide();
            set_ornaments_overlay_editing(false);
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
    apply_geometry(&overlay, pos, size);
    sync_windows_geometry(app, &overlay);
    sync_windows_z_order(app, &overlay);
}

pub fn set_overlay_visible(app: &AppHandle, visible: bool) {
    let Some(overlay) = app.get_window(ORNAMENTS_OVERLAY_WINDOW_LABEL) else {
        return;
    };
    sync_ornaments_overlay_window(app);
    if visible {
        show_window_no_activate(app, &overlay);
    } else {
        let _ = overlay.hide();
    }
}
