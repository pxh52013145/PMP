use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Position, Size, WindowBuilder, WindowUrl,
};

use super::MAIN_WINDOW_LABEL;

const ORNAMENTS_EDITOR_OVERLAY_LABEL: &str = "ornaments-editor-overlay";
const ORNAMENTS_RENDER_OVERLAY_ABOVE_LABEL: &str = "ornaments-render-overlay-above";
const ORNAMENTS_RENDER_OVERLAY_BEHIND_LABEL: &str = "ornaments-render-overlay-behind";
const EDIT_MARGIN: f64 = 240.0;

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

pub fn open(app: &AppHandle) -> Result<(), String> {
    let geometry = overlay_geometry(app)?;

    if let Some(window) = app.get_window(ORNAMENTS_EDITOR_OVERLAY_LABEL) {
        apply_geometry(&window, geometry)?;
        window
            .set_always_on_top(false)
            .map_err(|error| error.to_string())?;
        window
            .set_ignore_cursor_events(false)
            .map_err(|error| error.to_string())?;
        let _ = window.show();
        let _ = window.unminimize();
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

    if let Some(main) = app.get_window(MAIN_WINDOW_LABEL) {
        apply_windows_owner(&window, &main);
    }
    apply_windows_no_activate(&window);

    window
        .set_ignore_cursor_events(false)
        .map_err(|error| error.to_string())?;
    let _ = window.show();
    let _ = window.unminimize();

    Ok(())
}

fn open_render_window(
    app: &AppHandle,
    label: &str,
    route: &str,
    above_main: bool,
) -> Result<(), String> {
    let geometry = overlay_geometry(app)?;

    if let Some(window) = app.get_window(label) {
        apply_geometry(&window, geometry)?;
        window
            .set_always_on_top(false)
            .map_err(|error| error.to_string())?;
        window
            .set_ignore_cursor_events(true)
            .map_err(|error| error.to_string())?;
        let _ = window.show();
        let _ = window.unminimize();
        if let Some(main) = app.get_window(MAIN_WINDOW_LABEL) {
            if above_main {
                apply_windows_owner(&window, &main);
            } else {
                place_window_behind_main(&window, &main);
            }
        }
        return Ok(());
    }

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

    if let Some(main) = app.get_window(MAIN_WINDOW_LABEL) {
        if above_main {
            apply_windows_owner(&window, &main);
        } else {
            place_window_behind_main(&window, &main);
        }
    }

    window
        .set_ignore_cursor_events(true)
        .map_err(|error| error.to_string())?;
    let _ = window.show();
    let _ = window.unminimize();
    Ok(())
}

fn close_render_window(app: &AppHandle, label: &str) -> Result<(), String> {
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
    let geometry = overlay_geometry(app)?;

    if let Some(window) = app.get_window(ORNAMENTS_RENDER_OVERLAY_BEHIND_LABEL) {
        apply_geometry(&window, geometry)?;
        if let Some(main) = app.get_window(MAIN_WINDOW_LABEL) {
            place_window_behind_main(&window, &main);
        }
    }
    if let Some(window) = app.get_window(ORNAMENTS_RENDER_OVERLAY_ABOVE_LABEL) {
        apply_geometry(&window, geometry)?;
        if let Some(main) = app.get_window(MAIN_WINDOW_LABEL) {
            apply_windows_owner(&window, &main);
        }
    }
    if let Some(window) = app.get_window(ORNAMENTS_EDITOR_OVERLAY_LABEL) {
        apply_geometry(&window, geometry)?;
    }
    Ok(())
}

pub fn close(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_window(ORNAMENTS_EDITOR_OVERLAY_LABEL) {
        window.close().map_err(|error| error.to_string())?;
    }
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
