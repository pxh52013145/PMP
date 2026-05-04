use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::Duration;

use super::{
    DesktopLyricsOverlaySnapshot, DesktopLyricsOverlaySnapshotText, OverlayCommand,
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
#[derive(Debug, Clone)]
struct OverlayRuntimeState {
    visible: bool,
    click_through: bool,
    font_size: u32,
    opacity_percent: u8,
    position_preset: OverlayPositionPreset,
    position_offset_x: i32,
    position_offset_y: i32,
    region_width: i32,
    region_height: i32,
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
            font_size: 26,
            opacity_percent: 92,
            position_preset: OverlayPositionPreset::BottomCenter,
            position_offset_x: 0,
            position_offset_y: 0,
            region_width: 0,
            region_height: 0,
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
            text: self
                .text
                .as_ref()
                .map(|text| DesktopLyricsOverlaySnapshotText {
                    primary: text.primary.clone(),
                    secondary: text.secondary.clone(),
                }),
        }
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, Default)]
struct CommandEffects {
    shutdown: bool,
    visible_changed: bool,
    controls_changed: bool,
    layout_changed: bool,
    text_changed: bool,
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
            effects.controls_changed = true;
            effects.layout_changed = visible;
            effects.text_changed = true;
        }
        OverlayCommand::SetClickThrough(enabled) => {
            if state.click_through != enabled {
                state.click_through = enabled;
                effects.controls_changed = true;
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
        OverlayCommand::SetText(text) => {
            if state.text != text {
                state.text = text;
                effects.text_changed = true;
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
    .resizable(true)
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
        logical_size.0,
        logical_size.1,
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
fn apply_window_layout(window: &Window, state: &OverlayRuntimeState) {
    if state.has_explicit_region {
        let width = state.region_width.max(1) as f64;
        let height = state.region_height.max(1) as f64;
        let _ = window.set_size(Size::Logical(LogicalSize::new(width, height)));
    }

    if state.has_explicit_position {
        let x = state.position_offset_x as f64;
        let y = state.position_offset_y as f64;
        let _ = window.set_position(Position::Logical(LogicalPosition::new(x, y)));
    }
}

#[cfg(target_os = "windows")]
fn apply_window_controls(window: &Window, state: &OverlayRuntimeState) {
    let _ = window.set_always_on_top(true);
    let _ = window.set_ignore_cursor_events(state.click_through);
}

#[cfg(target_os = "windows")]
fn emit_overlay_sync(window: &Window, state: &OverlayRuntimeState) {
    let _ = window.emit(
        super::DESKTOP_LYRICS_OVERLAY_SYNC_EVENT,
        state.to_snapshot(),
    );
}

#[cfg(target_os = "windows")]
fn destroy_overlay_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_window(super::DESKTOP_LYRICS_OVERLAY_WINDOW_LABEL) else {
        return;
    };

    let _ = window.close();
}

#[cfg(target_os = "windows")]
pub fn run(rx: Receiver<OverlayCommand>) {
    let mut state = OverlayRuntimeState::default();

    loop {
        let command = match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(command) => command,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        };

        let effects = apply_command(&mut state, command);

        if let Some(app) = super::current_app_handle() {
            if effects.shutdown || !state.visible {
                destroy_overlay_window(&app);
            } else {
                match ensure_overlay_window(&app) {
                    Ok((window, created)) => {
                        if created || effects.layout_changed {
                            apply_window_layout(&window, &state);
                        }

                        if created || effects.controls_changed {
                            apply_window_controls(&window, &state);
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

        crate::windows::desktop_lyrics::apply_sidecar_controls_changed(
            state.visible,
            state.click_through,
            state.font_size,
            state.opacity_percent,
        );

        if effects.shutdown {
            break;
        }
    }

    if let Some(app) = super::current_app_handle() {
        destroy_overlay_window(&app);
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
