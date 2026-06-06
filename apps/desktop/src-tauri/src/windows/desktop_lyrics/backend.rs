use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::Duration;

use serde::Serialize;

use super::{
    DesktopLyricsOverlaySnapshot, DesktopLyricsOverlaySnapshotText, OverlayCommand, OverlayHotspot,
    OverlayPositionPreset, OverlayText,
};

#[cfg(target_os = "windows")]
use tauri::{
    LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Position, Size, Window,
    WindowBuilder, WindowUrl,
};

#[cfg(target_os = "windows")]
const DEFAULT_OVERLAY_WIDTH: i32 = 960;
#[cfg(target_os = "windows")]
const DEFAULT_OVERLAY_HEIGHT: i32 = 188;
#[cfg(target_os = "windows")]
const UNLOCK_DOT_SIZE: i32 = 24;
#[cfg(target_os = "windows")]
const UNLOCK_DOT_MARGIN: i32 = 8;
#[cfg(target_os = "windows")]
const HOVER_POLL_INTERVAL_MS: u64 = 40;

#[cfg(target_os = "windows")]
#[derive(Debug, Clone)]
struct OverlayRuntimeState {
    visible: bool,
    click_through: bool,
    interaction_active: bool,
    hover_hotspot: Option<OverlayHotspot>,
    font_size: u32,
    opacity_percent: u8,
    position_preset: OverlayPositionPreset,
    position_offset_x: i32,
    position_offset_y: i32,
    region_width: i32,
    region_height: i32,
    lyric_offset_ms: i32,
    has_explicit_position: bool,
    has_explicit_region: bool,
    text: Option<OverlayText>,
}

#[cfg(target_os = "windows")]
impl Default for OverlayRuntimeState {
    fn default() -> Self {
        Self {
            visible: false,
            click_through: false,
            interaction_active: false,
            hover_hotspot: None,
            font_size: 26,
            opacity_percent: 92,
            position_preset: OverlayPositionPreset::BottomCenter,
            position_offset_x: 0,
            position_offset_y: 0,
            region_width: 0,
            region_height: 0,
            lyric_offset_ms: 0,
            has_explicit_position: false,
            has_explicit_region: false,
            text: None,
        }
    }
}

#[cfg(target_os = "windows")]
impl OverlayRuntimeState {
    fn to_snapshot(&self) -> DesktopLyricsOverlaySnapshot {
        DesktopLyricsOverlaySnapshot {
            visible: self.visible,
            click_through: self.click_through,
            font_size: self.font_size,
            opacity_percent: self.opacity_percent,
            region_width: self.region_width,
            region_height: self.region_height,
            lyric_offset_ms: self.lyric_offset_ms,
            text: self
                .text
                .as_ref()
                .map(|text| DesktopLyricsOverlaySnapshotText {
                    primary: text.primary.clone(),
                    secondary: text.secondary.clone(),
                    lines: text.lines.clone(),
                    active_index: text.active_index,
                    active_line_key: text.active_line_key,
                    active_progress_percent: text.active_progress_percent,
                    active_progress_remaining_ms: text.active_progress_remaining_ms,
                }),
        }
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, Default)]
struct CommandEffects {
    shutdown: bool,
    visible_changed: bool,
    cursor_events_changed: bool,
    controls_changed: bool,
    layout_changed: bool,
    text_changed: bool,
    progress_changed: bool,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlayProgressPayload {
    active_index: Option<usize>,
    active_line_key: Option<usize>,
    active_progress_percent: u8,
    active_progress_remaining_ms: u32,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlayInteractionPayload {
    active: bool,
}

#[cfg(target_os = "windows")]
fn apply_command(state: &mut OverlayRuntimeState, command: OverlayCommand) -> CommandEffects {
    let mut effects = CommandEffects::default();

    match command {
        OverlayCommand::SetVisible(visible) => {
            if state.visible != visible {
                state.visible = visible;
                effects.visible_changed = true;
            }
            if !visible && state.interaction_active {
                state.interaction_active = false;
                effects.cursor_events_changed = true;
            }
            effects.controls_changed = true;
            effects.layout_changed = visible;
            effects.text_changed = true;
        }
        OverlayCommand::SetClickThrough(enabled) => {
            if state.click_through != enabled {
                state.click_through = enabled;
                if enabled {
                    state.interaction_active = false;
                }
                effects.cursor_events_changed = true;
                effects.controls_changed = true;
            }
        }
        OverlayCommand::SetInteractionActive(active) => {
            if state.interaction_active != active {
                state.interaction_active = active;
                effects.cursor_events_changed = true;
            }
        }
        OverlayCommand::SetHoverHotspot(hotspot) => {
            if state.hover_hotspot != hotspot {
                state.hover_hotspot = hotspot;
            }
        }
        OverlayCommand::SetFontSize(font_size) => {
            if state.font_size != font_size {
                state.font_size = font_size;
                effects.controls_changed = true;
                effects.text_changed = true;
            }
        }
        OverlayCommand::SetOpacityPercent(opacity_percent) => {
            if state.opacity_percent != opacity_percent {
                state.opacity_percent = opacity_percent;
                effects.controls_changed = true;
                effects.text_changed = true;
            }
        }
        OverlayCommand::SetPositionPreset(preset) => {
            if state.position_preset != preset {
                state.position_preset = preset;
            }
        }
        OverlayCommand::SetPositionOffset(offset_x, offset_y) => {
            let next_has_explicit = offset_x != 0 || offset_y != 0;
            if state.position_offset_x != offset_x
                || state.position_offset_y != offset_y
                || state.has_explicit_position != next_has_explicit
            {
                state.position_offset_x = offset_x;
                state.position_offset_y = offset_y;
                state.has_explicit_position = next_has_explicit;
                effects.layout_changed = true;
            }
        }
        OverlayCommand::SetRegionSize(width, height) => {
            let next_has_explicit = width > 0 && height > 0;
            if state.region_width != width
                || state.region_height != height
                || state.has_explicit_region != next_has_explicit
            {
                state.region_width = width;
                state.region_height = height;
                state.has_explicit_region = next_has_explicit;
                effects.layout_changed = true;
            }
        }
        OverlayCommand::SetLayout(offset_x, offset_y, width, height) => {
            if state.position_offset_x != offset_x
                || state.position_offset_y != offset_y
                || !state.has_explicit_position
                || state.region_width != width
                || state.region_height != height
                || !state.has_explicit_region
            {
                state.position_offset_x = offset_x;
                state.position_offset_y = offset_y;
                state.has_explicit_position = true;
                state.region_width = width;
                state.region_height = height;
                state.has_explicit_region = width > 0 && height > 0;
                effects.layout_changed = true;
            }
        }
        OverlayCommand::SetLyricOffsetMs(offset_ms) => {
            if state.lyric_offset_ms != offset_ms {
                state.lyric_offset_ms = offset_ms;
                effects.controls_changed = true;
            }
        }
        OverlayCommand::SetText(text) => {
            if state.text != text {
                state.text = text;
                effects.text_changed = true;
            }
        }
        OverlayCommand::SetActiveProgress {
            active_index,
            active_line_key,
            active_progress_percent,
            active_progress_remaining_ms,
        } => {
            if let Some(text) = state.text.as_mut() {
                if text.active_index == active_index
                    && text.active_line_key == active_line_key
                    && (text.active_progress_percent != active_progress_percent
                        || text.active_progress_remaining_ms != active_progress_remaining_ms)
                {
                    text.active_progress_percent = active_progress_percent;
                    text.active_progress_remaining_ms = active_progress_remaining_ms;
                    effects.progress_changed = true;
                }
            }
        }
        OverlayCommand::Shutdown => {
            effects.shutdown = true;
            effects.visible_changed = state.visible;
            state.visible = false;
        }
    }

    effects
}

#[cfg(target_os = "windows")]
fn ensure_overlay_window(app: &tauri::AppHandle) -> Result<(Window, bool), String> {
    if let Some(existing) = app.get_window(super::DESKTOP_LYRICS_OVERLAY_WINDOW_LABEL) {
        return Ok((existing, false));
    }

    let window = WindowBuilder::new(
        app,
        super::DESKTOP_LYRICS_OVERLAY_WINDOW_LABEL,
        WindowUrl::App("/#/desktop-lyrics-overlay".into()),
    )
    .title("Desktop Lyrics")
    .inner_size(DEFAULT_OVERLAY_WIDTH as f64, DEFAULT_OVERLAY_HEIGHT as f64)
    .center()
    .transparent(true)
    .decorations(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(false)
    .build()
    .map_err(|error| format!("Create desktop lyrics overlay window failed: {error}"))?;

    bind_overlay_window_events(&window);
    Ok((window, true))
}

#[cfg(target_os = "windows")]
fn ensure_unlock_window(app: &tauri::AppHandle) -> Result<Window, String> {
    if let Some(existing) = app.get_window(super::DESKTOP_LYRICS_UNLOCK_WINDOW_LABEL) {
        return Ok(existing);
    }

    WindowBuilder::new(
        app,
        super::DESKTOP_LYRICS_UNLOCK_WINDOW_LABEL,
        WindowUrl::App("/#/desktop-lyrics-overlay/unlock".into()),
    )
    .title("Desktop Lyrics Unlock")
    .inner_size(UNLOCK_DOT_SIZE as f64, UNLOCK_DOT_SIZE as f64)
    .transparent(true)
    .decorations(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(false)
    .build()
    .map_err(|error| format!("Create desktop lyrics unlock window failed: {error}"))
}

#[cfg(target_os = "windows")]
fn bind_overlay_window_events(window: &Window) {
    let window_for_events = window.clone();

    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
            emit_layout_from_window(&window_for_events);
        }
        tauri::WindowEvent::Destroyed => {
            let _ = crate::windows::desktop_lyrics::set_visible(false);
        }
        _ => {}
    });
}

#[cfg(target_os = "windows")]
fn emit_layout_from_window(window: &Window) {
    let Some((offset_x, offset_y, region_width, region_height)) = read_layout_from_window(window)
    else {
        return;
    };

    crate::windows::desktop_lyrics::apply_sidecar_layout_changed(
        offset_x,
        offset_y,
        region_width,
        region_height,
    );
}

#[cfg(target_os = "windows")]
fn read_layout_from_window(window: &Window) -> Option<(i32, i32, i32, i32)> {
    let scale = window.scale_factor().ok().filter(|value| *value > 0.0)?;

    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;

    let logical_position = to_logical_position(position, scale);
    let logical_size = to_logical_size(size, scale);

    Some((
        logical_position.0,
        logical_position.1,
        logical_size.0.max(1),
        logical_size.1.max(1),
    ))
}

#[cfg(target_os = "windows")]
fn to_logical_position(position: PhysicalPosition<i32>, scale: f64) -> (i32, i32) {
    let logical: LogicalPosition<f64> = position.to_logical(scale);
    (logical.x.round() as i32, logical.y.round() as i32)
}

#[cfg(target_os = "windows")]
fn to_logical_size(size: PhysicalSize<u32>, scale: f64) -> (i32, i32) {
    let logical: LogicalSize<f64> = size.to_logical(scale);
    (logical.width.round() as i32, logical.height.round() as i32)
}

#[cfg(target_os = "windows")]
fn apply_window_geometry(window: &Window, x: i32, y: i32, width: i32, height: i32) {
    use std::ptr::null_mut;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER,
    };

    let width = width.max(1);
    let height = height.max(1);

    if let (Ok(hwnd), Ok(scale)) = (window.hwnd(), window.scale_factor()) {
        let physical_x = (x as f64 * scale).round() as i32;
        let physical_y = (y as f64 * scale).round() as i32;
        let physical_width = (width as f64 * scale).round().max(1.0) as i32;
        let physical_height = (height as f64 * scale).round().max(1.0) as i32;

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
                return;
            }
        }
    }

    let _ = window.set_position(Position::Logical(LogicalPosition::new(x as f64, y as f64)));
    let _ = window.set_size(Size::Logical(LogicalSize::new(width as f64, height as f64)));
}

#[cfg(target_os = "windows")]
fn apply_window_layout(window: &Window, state: &OverlayRuntimeState) {
    if state.has_explicit_position && state.has_explicit_region {
        apply_window_geometry(
            window,
            state.position_offset_x,
            state.position_offset_y,
            state.region_width,
            state.region_height,
        );
        return;
    }

    if state.has_explicit_position {
        let x = state.position_offset_x as f64;
        let y = state.position_offset_y as f64;
        let _ = window.set_position(Position::Logical(LogicalPosition::new(x, y)));
    }

    if state.has_explicit_region {
        let width = state.region_width.max(1) as f64;
        let height = state.region_height.max(1) as f64;
        let _ = window.set_size(Size::Logical(LogicalSize::new(width, height)));
    }
}

#[cfg(target_os = "windows")]
fn apply_unlock_window_layout(unlock_window: &Window, overlay_window: &Window) {
    let Some((overlay_x, overlay_y, overlay_width, _overlay_height)) =
        read_layout_from_window(overlay_window)
    else {
        return;
    };

    let x = overlay_x + overlay_width.saturating_sub(UNLOCK_DOT_SIZE + UNLOCK_DOT_MARGIN);
    let y = overlay_y + UNLOCK_DOT_MARGIN;
    apply_window_geometry(unlock_window, x, y, UNLOCK_DOT_SIZE, UNLOCK_DOT_SIZE);
}

#[cfg(target_os = "windows")]
pub(super) fn preview_layout(
    app: &tauri::AppHandle,
    offset_x: i32,
    offset_y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    let window = app
        .get_window(super::DESKTOP_LYRICS_OVERLAY_WINDOW_LABEL)
        .ok_or_else(|| "Desktop lyrics overlay window not found".to_string())?;

    apply_window_geometry(&window, offset_x, offset_y, width, height);
    Ok(())
}

#[cfg(target_os = "windows")]
fn apply_window_controls(window: &Window, state: &OverlayRuntimeState) {
    let _ = window.set_always_on_top(true);
    let _ = window.set_resizable(false);
    let _ = window.set_ignore_cursor_events(should_ignore_cursor_events(state));
}

#[cfg(target_os = "windows")]
fn apply_unlock_window_controls(window: &Window) {
    let _ = window.set_always_on_top(true);
    let _ = window.set_resizable(false);
    let _ = window.set_ignore_cursor_events(false);
}

#[cfg(target_os = "windows")]
fn emit_overlay_sync(window: &Window, state: &OverlayRuntimeState) {
    let _ = window.emit(
        super::DESKTOP_LYRICS_OVERLAY_SYNC_EVENT,
        state.to_snapshot(),
    );
}

#[cfg(target_os = "windows")]
fn emit_overlay_progress(window: &Window, state: &OverlayRuntimeState) {
    let Some(text) = state.text.as_ref() else {
        return;
    };

    let _ = window.emit(
        super::DESKTOP_LYRICS_OVERLAY_PROGRESS_EVENT,
        OverlayProgressPayload {
            active_index: text.active_index,
            active_line_key: text.active_line_key,
            active_progress_percent: text.active_progress_percent,
            active_progress_remaining_ms: text.active_progress_remaining_ms,
        },
    );
}

#[cfg(target_os = "windows")]
fn emit_overlay_interaction(window: &Window, active: bool) {
    let _ = window.emit(
        super::DESKTOP_LYRICS_OVERLAY_INTERACTION_EVENT,
        OverlayInteractionPayload { active },
    );
}

#[cfg(target_os = "windows")]
fn should_ignore_cursor_events(state: &OverlayRuntimeState) -> bool {
    state.click_through || !state.interaction_active
}

#[cfg(target_os = "windows")]
fn read_cursor_position() -> Option<(i32, i32)> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let mut point = POINT { x: 0, y: 0 };
    let ok = unsafe { GetCursorPos(&mut point) };
    if ok == 0 {
        return None;
    }

    Some((point.x, point.y))
}

#[cfg(target_os = "windows")]
fn cursor_inside_hover_hotspot(window: &Window, state: &OverlayRuntimeState) -> bool {
    let Some(hotspot) = state.hover_hotspot else {
        return false;
    };
    let Some((cursor_x, cursor_y)) = read_cursor_position() else {
        return false;
    };
    let Ok(position) = window.outer_position() else {
        return false;
    };
    let Ok(scale) = window.scale_factor() else {
        return false;
    };

    let left = position.x.saturating_add((hotspot.x as f64 * scale).round() as i32);
    let top = position.y.saturating_add((hotspot.y as f64 * scale).round() as i32);
    let width = (hotspot.width as f64 * scale).round().max(1.0) as i32;
    let height = (hotspot.height as f64 * scale).round().max(1.0) as i32;
    let right = left.saturating_add(width);
    let bottom = top.saturating_add(height);

    cursor_x >= left && cursor_x <= right && cursor_y >= top && cursor_y <= bottom
}

#[cfg(target_os = "windows")]
fn update_interaction_from_cursor(window: &Window, state: &mut OverlayRuntimeState) -> bool {
    if state.click_through || !state.visible || state.interaction_active {
        return false;
    }
    if !cursor_inside_hover_hotspot(window, state) {
        return false;
    }

    state.interaction_active = true;
    true
}

#[cfg(target_os = "windows")]
fn should_poll_hover_hotspot(state: &OverlayRuntimeState) -> bool {
    state.visible
        && !state.click_through
        && !state.interaction_active
        && state.hover_hotspot.is_some()
}

#[cfg(target_os = "windows")]
fn destroy_overlay_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_window(super::DESKTOP_LYRICS_OVERLAY_WINDOW_LABEL) else {
        return;
    };

    let _ = window.close();
}

#[cfg(target_os = "windows")]
fn destroy_unlock_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_window(super::DESKTOP_LYRICS_UNLOCK_WINDOW_LABEL) else {
        return;
    };

    let _ = window.close();
}

#[cfg(target_os = "windows")]
fn sync_unlock_window(
    app: &tauri::AppHandle,
    overlay_window: &Window,
    state: &OverlayRuntimeState,
) {
    if !state.visible || !state.click_through {
        destroy_unlock_window(app);
        return;
    }

    match ensure_unlock_window(app) {
        Ok(unlock_window) => {
            apply_unlock_window_layout(&unlock_window, overlay_window);
            apply_unlock_window_controls(&unlock_window);
            let _ = unlock_window.show();
            let _ = unlock_window.unminimize();
        }
        Err(error) => {
            crate::backend_telemetry::warn(
                app,
                "desktop-lyrics",
                "desktop-lyrics.unlock.ensure.failed",
                crate::backend_telemetry::BackendTelemetryOptions::new()
                    .component("desktop_lyrics::backend")
                    .message(error),
            );
        }
    }
}

#[cfg(target_os = "windows")]
pub fn run(rx: Receiver<OverlayCommand>) {
    let mut state = OverlayRuntimeState::default();

    loop {
        let mut effects = CommandEffects::default();
        let mut command_received = false;
        let timeout = if should_poll_hover_hotspot(&state) {
            Duration::from_millis(HOVER_POLL_INTERVAL_MS)
        } else {
            Duration::from_millis(250)
        };

        match rx.recv_timeout(timeout) {
            Ok(command) => {
                command_received = true;
                effects = apply_command(&mut state, command);
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        };

        if !command_received && !should_poll_hover_hotspot(&state) {
            continue;
        }

        if let Some(app) = super::current_app_handle() {
            if effects.shutdown || !state.visible {
                destroy_overlay_window(&app);
                destroy_unlock_window(&app);
            } else {
                match ensure_overlay_window(&app) {
                    Ok((window, created)) => {
                        let interaction_changed = if should_poll_hover_hotspot(&state) {
                            update_interaction_from_cursor(&window, &mut state)
                        } else {
                            false
                        };
                        if interaction_changed {
                            effects.cursor_events_changed = true;
                        }

                        if created || effects.layout_changed {
                            apply_window_layout(&window, &state);
                        }

                        if created || effects.controls_changed || effects.cursor_events_changed {
                            apply_window_controls(&window, &state);
                        }

                        if interaction_changed {
                            emit_overlay_interaction(&window, state.interaction_active);
                        }

                        if created
                            || effects.layout_changed
                            || effects.controls_changed
                            || effects.visible_changed
                        {
                            sync_unlock_window(&app, &window, &state);
                        }

                        if created || effects.visible_changed {
                            let _ = window.show();
                            let _ = window.unminimize();
                        }

                        if created
                            || effects.layout_changed
                            || effects.controls_changed
                            || effects.text_changed
                            || effects.visible_changed
                        {
                            emit_overlay_sync(&window, &state);
                        } else if effects.progress_changed {
                            emit_overlay_progress(&window, &state);
                        }
                    }
                    Err(error) => {
                        crate::backend_telemetry::warn(
                            &app,
                            "desktop-lyrics",
                            "desktop-lyrics.overlay.ensure.failed",
                            crate::backend_telemetry::BackendTelemetryOptions::new()
                                .component("desktop_lyrics::backend")
                                .message(error),
                        );
                    }
                }
            }
        }

        if command_received && (effects.visible_changed || effects.controls_changed) {
            crate::windows::desktop_lyrics::apply_sidecar_controls_changed(
                state.visible,
                state.click_through,
                state.font_size,
                state.opacity_percent,
            );
        }

        if effects.shutdown {
            break;
        }
    }

    if let Some(app) = super::current_app_handle() {
        destroy_overlay_window(&app);
        destroy_unlock_window(&app);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn run(rx: Receiver<OverlayCommand>) {
    loop {
        let command = match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(command) => command,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        };

        if matches!(command, OverlayCommand::Shutdown) {
            break;
        }
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::{should_ignore_cursor_events, OverlayRuntimeState};

    #[test]
    fn cursor_events_follow_interaction_state() {
        let mut state = OverlayRuntimeState::default();

        state.click_through = false;
        state.interaction_active = false;
        assert!(should_ignore_cursor_events(&state));

        state.interaction_active = true;
        assert!(!should_ignore_cursor_events(&state));

        state.click_through = true;
        assert!(should_ignore_cursor_events(&state));
    }
}
