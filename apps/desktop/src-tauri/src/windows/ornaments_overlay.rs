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

#[cfg(target_os = "windows")]
mod windows_hit_test {
    use once_cell::sync::Lazy;
    use std::{
        collections::HashMap,
        mem,
        sync::{
            atomic::{AtomicBool, Ordering},
            Mutex,
        },
    };
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallWindowProcW, DefWindowProcW, GetWindowLongPtrW, SetWindowLongPtrW,
        GWLP_WNDPROC, HTCLIENT, HTTRANSPARENT, WM_NCHITTEST, WNDPROC,
    };

    static OVERLAY_EDITING: AtomicBool = AtomicBool::new(false);

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
        if msg == WM_NCHITTEST {
            if OVERLAY_EDITING.load(Ordering::SeqCst) {
                return HTCLIENT as LRESULT;
            }
            // Always click-through while not editing.
            // We intentionally do NOT support "drag ornament to move window" because it can easily
            // end up blocking clicks on the main UI if coordinates/state get out of sync.
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

            let original = GetWindowLongPtrW(hwnd, GWLP_WNDPROC);
            registry.original.insert(hwnd as isize, original);
            drop(registry);

            let _ = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, wnd_proc as isize);
        }
    }

    pub fn set_editing(editing: bool) {
        OVERLAY_EDITING.store(editing, Ordering::SeqCst);
    }

}

pub fn set_ornaments_overlay_editing(editing: bool) {
    #[cfg(target_os = "windows")]
    windows_hit_test::set_editing(editing);
    let _ = editing;
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
