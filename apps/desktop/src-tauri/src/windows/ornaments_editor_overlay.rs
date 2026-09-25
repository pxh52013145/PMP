use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Mutex,
};

use once_cell::sync::Lazy;

use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Position, Size, WindowBuilder, WindowUrl,
};

use super::MAIN_WINDOW_LABEL;

mod lifecycle;
use lifecycle::OverlayKind;

const ORNAMENTS_EDITOR_OVERLAY_LABEL: &str = "ornaments-editor-overlay";
const ORNAMENTS_RENDER_OVERLAY_ABOVE_LABEL: &str = "ornaments-render-overlay-above";
const ORNAMENTS_RENDER_OVERLAY_BEHIND_LABEL: &str = "ornaments-render-overlay-behind";
const EDIT_MARGIN: f64 = 240.0;

static ORNAMENTS_EDITOR_OVERLAY_OPEN: AtomicBool = AtomicBool::new(false);
static ORNAMENTS_NATIVE_DRAG_ACTIVE: AtomicBool = AtomicBool::new(false);
static ORNAMENTS_VISIBILITY_SYNC_TOKEN: AtomicU64 = AtomicU64::new(0);
static ORNAMENTS_PRESENT_MUTEX: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
fn kind_for_label(label: &str) -> Option<OverlayKind> {
    match label {
        ORNAMENTS_EDITOR_OVERLAY_LABEL => Some(OverlayKind::Editor),
        ORNAMENTS_RENDER_OVERLAY_ABOVE_LABEL => Some(OverlayKind::RenderAbove),
        ORNAMENTS_RENDER_OVERLAY_BEHIND_LABEL => Some(OverlayKind::RenderBehind),
        _ => None,
    }
}

fn main_outer_geometry(app: &AppHandle) -> Result<(f64, f64, f64, f64), String> {
    let main = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "Main window not found".to_string())?;
    let position = main.outer_position().map_err(|error| error.to_string())?;
    let size = main.outer_size().map_err(|error| error.to_string())?;
    let scale = main.scale_factor().map_err(|error| error.to_string())?;

    Ok((
        position.x as f64 / scale,
        position.y as f64 / scale,
        size.width as f64 / scale,
        size.height as f64 / scale,
    ))
}

fn overlay_geometry(app: &AppHandle) -> Result<(f64, f64, f64, f64), String> {
    let (x, y, width, height) = main_outer_geometry(app)?;
    Ok((
        x - EDIT_MARGIN,
        y - EDIT_MARGIN,
        width + EDIT_MARGIN * 2.0,
        height + EDIT_MARGIN * 2.0,
    ))
}

#[cfg(target_os = "windows")]
fn main_overlay_physical_geometry(app: &AppHandle) -> Result<(i32, i32, i32, i32), String> {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect;

    let main = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "Main window not found".to_string())?;
    let hwnd = main.hwnd().map_err(|error| error.to_string())?;
    let scale = main.scale_factor().map_err(|error| error.to_string())?;
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };

    if unsafe { GetWindowRect(hwnd.0 as _, &mut rect) } == 0 {
        return Err("Unable to read main window rectangle".to_string());
    }

    let margin = (EDIT_MARGIN * scale).round() as i32;
    let width = rect.right.saturating_sub(rect.left);
    let height = rect.bottom.saturating_sub(rect.top);
    Ok((
        rect.left.saturating_sub(margin),
        rect.top.saturating_sub(margin),
        width.saturating_add(margin.saturating_mul(2)).max(1),
        height.saturating_add(margin.saturating_mul(2)).max(1),
    ))
}

#[cfg(target_os = "windows")]
fn apply_physical_geometry(
    window: &tauri::Window,
    geometry: (i32, i32, i32, i32),
) -> Result<(), String> {
    use std::ptr::null_mut;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER,
    };

    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let (x, y, width, height) = geometry;
    let ok = unsafe {
        SetWindowPos(
            hwnd.0 as _,
            null_mut(),
            x,
            y,
            width,
            height,
            SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOZORDER,
        )
    };
    if ok == 0 {
        return Err("Unable to apply ornaments overlay geometry".to_string());
    }
    Ok(())
}

fn apply_overlay_geometry(app: &AppHandle, window: &tauri::Window) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(geometry) = main_overlay_physical_geometry(app) {
            if apply_physical_geometry(window, geometry).is_ok() {
                return Ok(());
            }
        }
    }

    apply_geometry(window, overlay_geometry(app)?)
}

fn apply_geometry_fallback(
    window: &tauri::Window,
    geometry: (f64, f64, f64, f64),
) -> Result<(), String> {
    let (x, y, width, height) = geometry;
    window
        .set_position(Position::Logical(LogicalPosition { x, y }))
        .map_err(|error| error.to_string())?;
    window
        .set_size(Size::Logical(LogicalSize { width, height }))
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn apply_geometry(window: &tauri::Window, geometry: (f64, f64, f64, f64)) -> Result<(), String> {
    use std::ptr::null_mut;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER,
    };

    let (x, y, width, height) = geometry;

    if let (Ok(hwnd), Ok(scale)) = (window.hwnd(), window.scale_factor()) {
        let physical_x = (x * scale).round() as i32;
        let physical_y = (y * scale).round() as i32;
        let physical_width = (width.max(1.0) * scale).round() as i32;
        let physical_height = (height.max(1.0) * scale).round() as i32;

        unsafe {
            let ok = SetWindowPos(
                hwnd.0 as _,
                null_mut(),
                physical_x,
                physical_y,
                physical_width,
                physical_height,
                SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOZORDER,
            );
            if ok != 0 {
                return Ok(());
            }
        }
    }

    apply_geometry_fallback(window, geometry)
}

#[cfg(not(target_os = "windows"))]
fn apply_geometry(window: &tauri::Window, geometry: (f64, f64, f64, f64)) -> Result<(), String> {
    apply_geometry_fallback(window, geometry)
}

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
        let _ = SetWindowLongPtrW(window_hwnd.0 as _, GWLP_HWNDPARENT, owner_hwnd.0 as _);
    }
}

#[cfg(not(target_os = "windows"))]
fn apply_windows_owner(_window: &tauri::Window, _owner: &tauri::Window) {}

#[cfg(target_os = "windows")]
fn apply_windows_no_activate(window: &tauri::Window) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
    };

    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    unsafe {
        let style = GetWindowLongPtrW(hwnd.0 as _, GWL_EXSTYLE);
        let _ = SetWindowLongPtrW(hwnd.0 as _, GWL_EXSTYLE, style | WS_EX_NOACTIVATE as isize);
    }
}

#[cfg(not(target_os = "windows"))]
fn apply_windows_no_activate(_window: &tauri::Window) {}

#[cfg(target_os = "windows")]
fn place_window_behind_main(window: &tauri::Window, main: &tauri::Window) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };

    let Ok(window_hwnd) = window.hwnd() else {
        return;
    };
    let Ok(main_hwnd) = main.hwnd() else {
        return;
    };

    unsafe {
        let _ = SetWindowPos(
            window_hwnd.0 as _,
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
fn place_window_behind_main(_window: &tauri::Window, _main: &tauri::Window) {}

#[cfg(target_os = "windows")]
fn show_window_in_plane(window: &tauri::Window, main: &tauri::Window, above_main: bool) {
    use std::ptr::null_mut;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        IsIconic, SetWindowPos, ShowWindow, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
        SW_SHOWNOACTIVATE,
    };

    let Ok(window_hwnd) = window.hwnd() else {
        return;
    };
    let insert_after = if above_main {
        null_mut()
    } else {
        main.hwnd().map(|hwnd| hwnd.0 as _).unwrap_or(null_mut())
    };

    let was_minimized = unsafe { IsIconic(window_hwnd.0 as _) != 0 };

    // Place the HWND in its final plane while it is still hidden. A minimized
    // window must not receive SWP_SHOWWINDOW here: Windows can expose one
    // intermediate frame before ShowWindow finishes restoring it.
    unsafe {
        let flags = SWP_NOMOVE
            | SWP_NOSIZE
            | SWP_NOACTIVATE
            | if was_minimized { 0 } else { SWP_SHOWWINDOW };
        let shown = SetWindowPos(
            window_hwnd.0 as _,
            insert_after,
            0,
            0,
            0,
            0,
            flags,
        );
        if shown == 0 || was_minimized {
            ShowWindow(window_hwnd.0 as _, SW_SHOWNOACTIVATE);
            // Restoring a minimized HWND can update its placement, so reapply
            // the plane after the single visible transition.
            let _ = SetWindowPos(
                window_hwnd.0 as _,
                insert_after,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn show_window_in_plane(window: &tauri::Window, _main: &tauri::Window, _above_main: bool) {
    let _ = window.show();
    let _ = window.unminimize();
}

#[cfg(target_os = "windows")]
fn hide_window_for_present(window: &tauri::Window) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};

    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            ShowWindow(hwnd.0 as _, SW_HIDE);
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn hide_window_for_present(window: &tauri::Window) {
    let _ = window.hide();
}

fn hide_presented_window_locked(kind: OverlayKind, window: &tauri::Window) {
    hide_window_for_present(window);
    let _ = lifecycle::set_presented(kind, false);
}

fn present_window_locked(
    app: &AppHandle,
    kind: OverlayKind,
    window: &tauri::Window,
    main: &tauri::Window,
    above_main: bool,
) {
    if lifecycle::is_presented(kind).unwrap_or(false)
        && window.is_visible().unwrap_or(false)
        && !window.is_minimized().unwrap_or(false)
    {
        return;
    }

    // Keep the native window hidden throughout restore, geometry, and z-order
    // reconciliation. The final show is the only operation that exposes it.
    hide_window_for_present(window);
    let _ = apply_overlay_geometry(app, window);
    if above_main {
        apply_windows_owner(window, main);
    } else {
        place_window_behind_main(window, main);
    }
    show_window_in_plane(window, main, above_main);
    let _ = lifecycle::set_presented(kind, true);
}

pub fn open(app: &AppHandle) -> Result<(), String> {
    let geometry = overlay_geometry(app)?;
    let _guard = ORNAMENTS_PRESENT_MUTEX
        .lock()
        .map_err(|_| "Ornaments overlay presentation lock poisoned".to_string())?;
    ORNAMENTS_EDITOR_OVERLAY_OPEN.store(true, Ordering::Release);
    lifecycle::begin(OverlayKind::Editor)?;

    if let Some(window) = app.get_window(ORNAMENTS_EDITOR_OVERLAY_LABEL) {
        hide_presented_window_locked(OverlayKind::Editor, &window);
        apply_overlay_geometry(app, &window)?;
        window
            .set_always_on_top(false)
            .map_err(|error| error.to_string())?;
        window
            .set_ignore_cursor_events(false)
            .map_err(|error| error.to_string())?;
        if let Some(main) = app.get_window(MAIN_WINDOW_LABEL) {
            apply_windows_owner(&window, &main);
        }
        return Ok(());
    }

    let window = WindowBuilder::new(
        app,
        ORNAMENTS_EDITOR_OVERLAY_LABEL,
        WindowUrl::App("/#/ornaments-editor-overlay".into()),
    )
    .title("Ornaments Editor Overlay")
    .position(geometry.0, geometry.1)
    .inner_size(geometry.2, geometry.3)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(false)
    .skip_taskbar(true)
    .focused(false)
    .visible(false)
    .build()
    .map_err(|error| error.to_string())?;

    apply_windows_no_activate(&window);

    window
        .set_ignore_cursor_events(false)
        .map_err(|error| error.to_string())?;
    if let Some(main) = app.get_window(MAIN_WINDOW_LABEL) {
        apply_windows_owner(&window, &main);
    }

    Ok(())
}

fn open_render_window(
    app: &AppHandle,
    label: &str,
    route: &str,
    above_main: bool,
) -> Result<(), String> {
    let geometry = overlay_geometry(app)?;
    let kind =
        kind_for_label(label).ok_or_else(|| format!("Unknown ornaments overlay label: {label}"))?;
    let _guard = ORNAMENTS_PRESENT_MUTEX
        .lock()
        .map_err(|_| "Ornaments overlay presentation lock poisoned".to_string())?;

    if let Some(window) = app.get_window(label) {
        apply_overlay_geometry(app, &window)?;
        window
            .set_always_on_top(false)
            .map_err(|error| error.to_string())?;
        window
            .set_ignore_cursor_events(true)
            .map_err(|error| error.to_string())?;
        // Establish the plane relation while the window is still hidden; readiness
        // from the WebView controls when the window becomes visible.
        if let Some(main) = app.get_window(MAIN_WINDOW_LABEL) {
            if above_main {
                apply_windows_owner(&window, &main);
            } else {
                place_window_behind_main(&window, &main);
            }
        }
        return Ok(());
    }

    lifecycle::begin(kind)?;

    let window = WindowBuilder::new(app, label, WindowUrl::App(route.into()))
        .title("Ornaments Render Overlay")
        .position(geometry.0, geometry.1)
        .inner_size(geometry.2, geometry.3)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(false)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())?;

    window
        .set_ignore_cursor_events(true)
        .map_err(|error| error.to_string())?;
    if let Some(main) = app.get_window(MAIN_WINDOW_LABEL) {
        if above_main {
            apply_windows_owner(&window, &main);
        } else {
            place_window_behind_main(&window, &main);
        }
    }
    Ok(())
}

fn close_render_window(app: &AppHandle, label: &str) -> Result<(), String> {
    let _guard = ORNAMENTS_PRESENT_MUTEX
        .lock()
        .map_err(|_| "Ornaments overlay presentation lock poisoned".to_string())?;
    if let Some(kind) = kind_for_label(label) {
        lifecycle::invalidate(kind)?;
        if let Some(window) = app.get_window(label) {
            hide_presented_window_locked(kind, &window);
        }
    }
    if let Some(window) = app.get_window(label) {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn open_render(app: &AppHandle) -> Result<(), String> {
    open_render_window(
        app,
        ORNAMENTS_RENDER_OVERLAY_BEHIND_LABEL,
        "/#/ornaments-render-overlay/behind",
        false,
    )?;
    open_render_window(
        app,
        ORNAMENTS_RENDER_OVERLAY_ABOVE_LABEL,
        "/#/ornaments-render-overlay/above",
        true,
    )
}

pub fn sync_render_planes(app: &AppHandle, behind: bool, above: bool) -> Result<(), String> {
    if behind {
        open_render_window(
            app,
            ORNAMENTS_RENDER_OVERLAY_BEHIND_LABEL,
            "/#/ornaments-render-overlay/behind",
            false,
        )?;
    } else {
        close_render_window(app, ORNAMENTS_RENDER_OVERLAY_BEHIND_LABEL)?;
    }

    if above {
        open_render_window(
            app,
            ORNAMENTS_RENDER_OVERLAY_ABOVE_LABEL,
            "/#/ornaments-render-overlay/above",
            true,
        )?;
    } else {
        close_render_window(app, ORNAMENTS_RENDER_OVERLAY_ABOVE_LABEL)?;
    }

    Ok(())
}

pub fn sync_geometry(app: &AppHandle) -> Result<(), String> {
    if ORNAMENTS_NATIVE_DRAG_ACTIVE.load(Ordering::Acquire) {
        return Ok(());
    }

    if let Some(window) = app.get_window(ORNAMENTS_RENDER_OVERLAY_BEHIND_LABEL) {
        apply_overlay_geometry(app, &window)?;
        if let Some(main) = app.get_window(MAIN_WINDOW_LABEL) {
            place_window_behind_main(&window, &main);
        }
    }
    if let Some(window) = app.get_window(ORNAMENTS_RENDER_OVERLAY_ABOVE_LABEL) {
        apply_overlay_geometry(app, &window)?;
        if let Some(main) = app.get_window(MAIN_WINDOW_LABEL) {
            apply_windows_owner(&window, &main);
        }
    }
    if let Some(window) = app.get_window(ORNAMENTS_EDITOR_OVERLAY_LABEL) {
        apply_overlay_geometry(app, &window)?;
    }
    Ok(())
}

pub fn sync_z_order(app: &AppHandle) {
    let Some(main) = app.get_window(MAIN_WINDOW_LABEL) else {
        return;
    };

    if let Some(window) = app.get_window(ORNAMENTS_RENDER_OVERLAY_BEHIND_LABEL) {
        place_window_behind_main(&window, &main);
    }
    if let Some(window) = app.get_window(ORNAMENTS_RENDER_OVERLAY_ABOVE_LABEL) {
        apply_windows_owner(&window, &main);
    }
}

pub fn sync_main_visibility(app: &AppHandle, visible: bool) {
    if !visible {
        ORNAMENTS_VISIBILITY_SYNC_TOKEN.fetch_add(1, Ordering::AcqRel);
    }
    // Reconcile geometry before presenting an overlay. Showing a window first and
    // moving it on the next frontend animation frame exposes its previous
    // position for one or more frames, especially after taskbar restore.
    let Some(main) = app.get_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    let Ok(_guard) = ORNAMENTS_PRESENT_MUTEX.lock() else {
        return;
    };
    // Focused(true) is the earliest taskbar restore signal, but do not expose an
    // overlay until the main HWND is actually visible. This keeps a focus event
    // from showing the overlay one native turn before the main window.
    let presentable =
        visible && main.is_visible().unwrap_or(false) && !main.is_minimized().unwrap_or(false);

    if presentable {
        let _ = sync_geometry(app);
        // Re-establish the plane before any hidden overlay is exposed. The
        // presentation call also uses the same target plane for its show step.
        sync_z_order(app);
    }

    if let Some(window) = app.get_window(ORNAMENTS_EDITOR_OVERLAY_LABEL) {
        if presentable
            && ORNAMENTS_EDITOR_OVERLAY_OPEN.load(Ordering::Acquire)
            && lifecycle::is_ready(OverlayKind::Editor).unwrap_or(false)
        {
            if !lifecycle::is_presented(OverlayKind::Editor).unwrap_or(false)
                || !window.is_visible().unwrap_or(false)
                || window.is_minimized().unwrap_or(false)
            {
                present_window_locked(app, OverlayKind::Editor, &window, &main, true);
            }
        } else {
            hide_presented_window_locked(OverlayKind::Editor, &window);
        }
    }

    for label in [
        ORNAMENTS_RENDER_OVERLAY_BEHIND_LABEL,
        ORNAMENTS_RENDER_OVERLAY_ABOVE_LABEL,
    ] {
        let Some(window) = app.get_window(label) else {
            continue;
        };
        if presentable {
            let ready = kind_for_label(label)
                .and_then(|kind| lifecycle::is_ready(kind).ok())
                .unwrap_or(false);
            let Some(kind) = kind_for_label(label) else {
                continue;
            };
            if ready
                && (!lifecycle::is_presented(kind).unwrap_or(false)
                    || !window.is_visible().unwrap_or(false)
                    || window.is_minimized().unwrap_or(false))
            {
                present_window_locked(
                    app,
                    kind,
                    &window,
                    &main,
                    label == ORNAMENTS_RENDER_OVERLAY_ABOVE_LABEL,
                );
            }
        } else {
            if let Some(kind) = kind_for_label(label) {
                hide_presented_window_locked(kind, &window);
            }
        }
    }
}

/// A taskbar restore can deliver `Focused(true)` before Windows has finished
/// clearing the main HWND's minimized state. Recheck that native state for a
/// short bounded interval so the overlay is presented on the same restore
/// rather than waiting for a later hide/show cycle.
pub fn schedule_main_visibility_reconcile(app: &AppHandle) {
    let token = ORNAMENTS_VISIBILITY_SYNC_TOKEN.fetch_add(1, Ordering::AcqRel) + 1;
    let app = app.clone();

    std::thread::spawn(move || {
        for delay_ms in [1_u64, 4, 10, 20, 40, 80] {
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
            if ORNAMENTS_VISIBILITY_SYNC_TOKEN.load(Ordering::Acquire) != token {
                return;
            }

            let Some(main) = app.get_window(MAIN_WINDOW_LABEL) else {
                return;
            };
            let visible = main.is_visible().unwrap_or(false);
            let minimized = main.is_minimized().unwrap_or(false);
            sync_main_visibility(&app, visible && !minimized);

            if visible && !minimized {
                return;
            }
        }
    });
}

pub fn close(app: &AppHandle) -> Result<(), String> {
    let _guard = ORNAMENTS_PRESENT_MUTEX
        .lock()
        .map_err(|_| "Ornaments overlay presentation lock poisoned".to_string())?;
    ORNAMENTS_EDITOR_OVERLAY_OPEN.store(false, Ordering::Release);
    lifecycle::invalidate(OverlayKind::Editor)?;
    if let Some(window) = app.get_window(ORNAMENTS_EDITOR_OVERLAY_LABEL) {
        hide_presented_window_locked(OverlayKind::Editor, &window);
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn overlay_generation(kind: &str) -> Result<u64, String> {
    lifecycle::generation(OverlayKind::parse(kind)?)
}

pub fn mark_ready(app: &AppHandle, kind: &str, generation: u64) -> Result<(), String> {
    let kind = OverlayKind::parse(kind)?;
    let _guard = ORNAMENTS_PRESENT_MUTEX
        .lock()
        .map_err(|_| "Ornaments overlay presentation lock poisoned".to_string())?;
    if !lifecycle::mark_ready(kind, generation)? {
        return Ok(());
    }

    if matches!(kind, OverlayKind::Editor) && !ORNAMENTS_EDITOR_OVERLAY_OPEN.load(Ordering::Acquire)
    {
        return Ok(());
    }

    let (label, above_main) = match kind {
        OverlayKind::Editor => (ORNAMENTS_EDITOR_OVERLAY_LABEL, true),
        OverlayKind::RenderBehind => (ORNAMENTS_RENDER_OVERLAY_BEHIND_LABEL, false),
        OverlayKind::RenderAbove => (ORNAMENTS_RENDER_OVERLAY_ABOVE_LABEL, true),
    };
    let Some(window) = app.get_window(label) else {
        return Ok(());
    };
    let presentable = app
        .get_window(MAIN_WINDOW_LABEL)
        .map(|main| main.is_visible().unwrap_or(false) && !main.is_minimized().unwrap_or(false))
        .unwrap_or(false);
    if !presentable {
        return Ok(());
    }
    let Some(main) = app.get_window(MAIN_WINDOW_LABEL) else {
        return Ok(());
    };
    if lifecycle::is_presented(kind).unwrap_or(false)
        && window.is_visible().unwrap_or(false)
        && !window.is_minimized().unwrap_or(false)
    {
        return Ok(());
    }
    present_window_locked(app, kind, &window, &main, above_main);
    Ok(())
}

#[cfg(target_os = "windows")]
fn start_native_main_window_drag(app: &AppHandle, main: &tauri::Window) -> Result<(), String> {
    use std::{ptr::null_mut, thread, time::Duration};
    use windows_sys::Win32::Foundation::{POINT, RECT};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, ReleaseCapture, VK_LBUTTON,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, GetWindowRect, IsWindow, SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER,
        SWP_NOSIZE, SWP_NOZORDER,
    };

    #[derive(Clone, Copy)]
    struct DragTarget {
        hwnd: isize,
        start_x: i32,
        start_y: i32,
    }

    fn read_drag_target(window: &tauri::Window) -> Option<DragTarget> {
        let hwnd = window.hwnd().ok()?.0 as isize;
        let mut rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        let ok = unsafe { GetWindowRect(hwnd as _, &mut rect) };
        if ok == 0 {
            return None;
        }
        Some(DragTarget {
            hwnd,
            start_x: rect.left,
            start_y: rect.top,
        })
    }

    let mut point = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut point) } == 0 {
        return Err("Unable to read cursor position for ornaments drag".to_string());
    }

    let mut targets = Vec::new();
    if let Some(target) = read_drag_target(main) {
        targets.push(target);
    } else {
        return Err("Unable to read main window geometry for ornaments drag".to_string());
    }

    for label in [
        ORNAMENTS_EDITOR_OVERLAY_LABEL,
        ORNAMENTS_RENDER_OVERLAY_ABOVE_LABEL,
        ORNAMENTS_RENDER_OVERLAY_BEHIND_LABEL,
    ] {
        if let Some(window) = app.get_window(label) {
            if let Some(target) = read_drag_target(&window) {
                targets.push(target);
            }
        }
    }

    unsafe {
        let _ = ReleaseCapture();
    }

    ORNAMENTS_NATIVE_DRAG_ACTIVE.store(true, Ordering::Release);
    let app_handle = app.clone();
    thread::spawn(move || {
        let start_x = point.x;
        let start_y = point.y;
        let mut last_delta_x = 0;
        let mut last_delta_y = 0;

        loop {
            let left_button_down = unsafe { GetAsyncKeyState(VK_LBUTTON as i32) } < 0;
            if !left_button_down {
                break;
            }

            let mut current = POINT { x: 0, y: 0 };
            if unsafe { GetCursorPos(&mut current) } == 0 {
                break;
            }

            let delta_x = current.x.saturating_sub(start_x);
            let delta_y = current.y.saturating_sub(start_y);
            if delta_x != last_delta_x || delta_y != last_delta_y {
                for target in &targets {
                    let hwnd = target.hwnd as _;
                    if unsafe { IsWindow(hwnd) } == 0 {
                        continue;
                    }
                    unsafe {
                        let _ = SetWindowPos(
                            hwnd,
                            null_mut(),
                            target.start_x.saturating_add(delta_x),
                            target.start_y.saturating_add(delta_y),
                            0,
                            0,
                            SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER,
                        );
                    }
                }
                last_delta_x = delta_x;
                last_delta_y = delta_y;
            }

            thread::sleep(Duration::from_millis(8));
        }

        ORNAMENTS_NATIVE_DRAG_ACTIVE.store(false, Ordering::Release);
        let _ = sync_geometry(&app_handle);
    });

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn start_native_main_window_drag(_app: &AppHandle, main: &tauri::Window) -> Result<(), String> {
    main.start_dragging().map_err(|error| error.to_string())
}

pub fn drag_main_window(app: &AppHandle) -> Result<(), String> {
    let main = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "Main window not found".to_string())?;
    start_native_main_window_drag(app, &main)
}
