use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLyricsSidecarText {
    pub primary: String,
    pub secondary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DesktopLyricsSidecarCommand {
    SetVisible {
        visible: bool,
    },
    SetClickThrough {
        enabled: bool,
    },
    SetFontSize {
        font_size: u32,
    },
    SetOpacityPercent {
        opacity_percent: u8,
    },
    SetPositionPreset {
        preset: String,
    },
    SetPositionOffset {
        offset_x: i32,
        offset_y: i32,
    },
    SetRegionSize {
        width: i32,
        height: i32,
    },
    SetText {
        text: Option<DesktopLyricsSidecarText>,
    },
    Shutdown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DesktopLyricsSidecarEvent {
    Ready,
    Ack {
        command: String,
    },
    LayoutChanged {
        offset_x: i32,
        offset_y: i32,
        region_width: i32,
        region_height: i32,
    },
    Error {
        message: String,
    },
}

static SIDECAR_EVENT_STDOUT_LOCK: Mutex<()> = Mutex::new(());

fn emit_sidecar_event(event: &DesktopLyricsSidecarEvent) {
    let _guard = SIDECAR_EVENT_STDOUT_LOCK.lock();
    let mut stdout = std::io::stdout();
    if serde_json::to_writer(&mut stdout, event).is_ok() {
        let _ = stdout.write_all(b"\n");
        let _ = stdout.flush();
    }
}

fn safe_stderr_log(message: impl AsRef<str>) {
    let mut stderr = std::io::stderr();
    let _ = writeln!(stderr, "{}", message.as_ref());
}

fn should_run_sidecar_from_cli() -> bool {
    std::env::args().any(|arg| arg == "--desktop-lyrics-sidecar")
}

pub fn maybe_run_from_cli() -> Option<i32> {
    if !should_run_sidecar_from_cli() {
        return None;
    }

    #[cfg(target_os = "windows")]
    {
        match run_windows_sidecar_loop() {
            Ok(()) => Some(0),
            Err(error) => {
                safe_stderr_log(format!("[desktop-lyrics-sidecar] fatal: {error}"));
                Some(1)
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Some(run_noop_sidecar_loop())
    }
}

#[allow(dead_code)]
fn run_noop_sidecar_loop() -> i32 {
    emit_sidecar_event(&DesktopLyricsSidecarEvent::Ready);

    let stdin = std::io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    let mut line = String::new();

    loop {
        line.clear();
        let read_count = match reader.read_line(&mut line) {
            Ok(count) => count,
            Err(_) => return 1,
        };

        if read_count == 0 {
            return 0;
        }

        let payload = line.trim();
        if payload.is_empty() {
            continue;
        }

        let Ok(command) = serde_json::from_str::<DesktopLyricsSidecarCommand>(payload) else {
            emit_sidecar_event(&DesktopLyricsSidecarEvent::Error {
                message: "invalid command payload".to_string(),
            });
            continue;
        };

        emit_sidecar_event(&DesktopLyricsSidecarEvent::Ack {
            command: sidecar_command_name(&command).to_string(),
        });

        if matches!(command, DesktopLyricsSidecarCommand::Shutdown) {
            return 0;
        }
    }
}

fn sidecar_command_name(command: &DesktopLyricsSidecarCommand) -> &'static str {
    match command {
        DesktopLyricsSidecarCommand::SetVisible { .. } => "setVisible",
        DesktopLyricsSidecarCommand::SetClickThrough { .. } => "setClickThrough",
        DesktopLyricsSidecarCommand::SetFontSize { .. } => "setFontSize",
        DesktopLyricsSidecarCommand::SetOpacityPercent { .. } => "setOpacityPercent",
        DesktopLyricsSidecarCommand::SetPositionPreset { .. } => "setPositionPreset",
        DesktopLyricsSidecarCommand::SetPositionOffset { .. } => "setPositionOffset",
        DesktopLyricsSidecarCommand::SetRegionSize { .. } => "setRegionSize",
        DesktopLyricsSidecarCommand::SetText { .. } => "setText",
        DesktopLyricsSidecarCommand::Shutdown => "shutdown",
    }
}

#[cfg(target_os = "windows")]
fn run_windows_sidecar_loop() -> Result<(), String> {
    use eframe::egui;
    use eframe::egui::{Color32, RichText};
    use std::ptr;
    use std::sync::mpsc::{self, Receiver, TryRecvError};
    use std::time::Duration;
    use windows_sys::Win32::Foundation::{HWND, POINT};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowW, GetCursorPos, GetSystemMetrics, GetWindowLongPtrW, SetLayeredWindowAttributes,
        SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_TOPMOST, LWA_ALPHA,
        SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_HIDE, SW_SHOWNOACTIVATE,
        WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT,
    };

    const WINDOW_TITLE: &str = "PMP Desktop Lyrics Overlay";
    const MIN_FONT_SIZE: u32 = 16;
    const DEFAULT_FONT_SIZE: u32 = 26;
    const MIN_OPACITY_PERCENT: u8 = 35;
    const MAX_OPACITY_PERCENT: u8 = 100;
    const DEFAULT_OPACITY_PERCENT: u8 = 92;
    const MAX_POSITION_OFFSET: i32 = 16384;
    const DEFAULT_REGION_WIDTH: i32 = 0;
    const DEFAULT_REGION_HEIGHT: i32 = 0;
    const MIN_REGION_WIDTH: i32 = 320;
    const MAX_REGION_WIDTH: i32 = 8192;
    const MIN_REGION_HEIGHT: i32 = 72;
    const MAX_REGION_HEIGHT: i32 = 2160;

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum PositionPreset {
        BottomCenter,
        BottomLeft,
        BottomRight,
        TopCenter,
    }

    impl PositionPreset {
        fn parse(value: &str) -> Option<Self> {
            match value.trim().to_ascii_lowercase().as_str() {
                "bottom-center" => Some(Self::BottomCenter),
                "bottom-left" => Some(Self::BottomLeft),
                "bottom-right" => Some(Self::BottomRight),
                "top-center" => Some(Self::TopCenter),
                _ => None,
            }
        }
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum ResizeMode {
        North,
        South,
        West,
        East,
        NorthWest,
        NorthEast,
        SouthWest,
        SouthEast,
    }

    impl ResizeMode {
        fn has_left(self) -> bool {
            matches!(self, Self::West | Self::NorthWest | Self::SouthWest)
        }

        fn has_right(self) -> bool {
            matches!(self, Self::East | Self::NorthEast | Self::SouthEast)
        }

        fn has_top(self) -> bool {
            matches!(self, Self::North | Self::NorthWest | Self::NorthEast)
        }

        fn has_bottom(self) -> bool {
            matches!(self, Self::South | Self::SouthWest | Self::SouthEast)
        }

        fn cursor_icon(self) -> egui::CursorIcon {
            match self {
                Self::North | Self::South => egui::CursorIcon::ResizeVertical,
                Self::West | Self::East => egui::CursorIcon::ResizeHorizontal,
                Self::NorthWest | Self::SouthEast => egui::CursorIcon::ResizeNwSe,
                Self::NorthEast | Self::SouthWest => egui::CursorIcon::ResizeNeSw,
            }
        }
    }

    #[derive(Debug, Clone)]
    struct OverlayRuntimeState {
        hwnd: Option<HWND>,
        visible: bool,
        click_through: bool,
        font_size: u32,
        opacity_percent: u8,
        position_preset: PositionPreset,
        position_offset_x: i32,
        position_offset_y: i32,
        region_width: i32,
        region_height: i32,
        absolute_x: Option<i32>,
        absolute_y: Option<i32>,
        primary_text: String,
        secondary_text: String,
        shutdown_requested: bool,
    }

    impl Default for OverlayRuntimeState {
        fn default() -> Self {
            Self {
                hwnd: None,
                visible: false,
                click_through: true,
                font_size: DEFAULT_FONT_SIZE,
                opacity_percent: DEFAULT_OPACITY_PERCENT,
                position_preset: PositionPreset::BottomCenter,
                position_offset_x: 0,
                position_offset_y: 0,
                region_width: DEFAULT_REGION_WIDTH,
                region_height: DEFAULT_REGION_HEIGHT,
                absolute_x: None,
                absolute_y: None,
                primary_text: String::new(),
                secondary_text: String::new(),
                shutdown_requested: false,
            }
        }
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    struct AppliedNativeWindowState {
        click_through: bool,
        opacity_percent: u8,
        visible: bool,
        bounds: (i32, i32, i32, i32),
    }

    fn normalize_opacity(value: u8) -> u8 {
        value.clamp(MIN_OPACITY_PERCENT, MAX_OPACITY_PERCENT)
    }

    fn normalize_offset(value: i32) -> i32 {
        value.clamp(-MAX_POSITION_OFFSET, MAX_POSITION_OFFSET)
    }

    fn normalize_region_width(value: i32) -> i32 {
        value.clamp(MIN_REGION_WIDTH, MAX_REGION_WIDTH)
    }

    fn normalize_region_height(value: i32) -> i32 {
        value.clamp(MIN_REGION_HEIGHT, MAX_REGION_HEIGHT)
    }

    fn virtual_desktop_metrics() -> (i32, i32, i32, i32) {
        unsafe {
            let desktop_x = GetSystemMetrics(SM_XVIRTUALSCREEN);
            let desktop_y = GetSystemMetrics(SM_YVIRTUALSCREEN);
            let desktop_w = GetSystemMetrics(SM_CXVIRTUALSCREEN).max(1280);
            let desktop_h = GetSystemMetrics(SM_CYVIRTUALSCREEN).max(720);
            (desktop_x, desktop_y, desktop_w, desktop_h)
        }
    }

    fn dynamic_region_limits() -> (i32, i32, i32, i32) {
        let (_, _, desktop_w, desktop_h) = virtual_desktop_metrics();
        let max_width = (desktop_w - 24).max(MIN_REGION_WIDTH).min(MAX_REGION_WIDTH);
        let max_height = (desktop_h - 24)
            .max(MIN_REGION_HEIGHT)
            .min(MAX_REGION_HEIGHT);
        (MIN_REGION_WIDTH, max_width, MIN_REGION_HEIGHT, max_height)
    }

    fn resolve_overlay_size(region_width: i32, region_height: i32) -> (i32, i32) {
        let (_, _, desktop_w, _) = virtual_desktop_metrics();
        let (min_width, max_width, min_height, max_height) = dynamic_region_limits();
        let requested_width = if region_width <= 0 {
            ((desktop_w as f64) * 0.66).round() as i32
        } else {
            normalize_region_width(region_width)
        };
        let requested_height = if region_height <= 0 {
            132
        } else {
            normalize_region_height(region_height)
        };

        let width = requested_width.clamp(min_width, max_width);
        let height = requested_height.clamp(min_height, max_height);
        (width, height)
    }

    fn clamp_to_virtual_desktop(x: i32, y: i32, width: i32, height: i32) -> (i32, i32) {
        let (desktop_x, desktop_y, desktop_w, desktop_h) = virtual_desktop_metrics();
        let min_x = desktop_x;
        let min_y = desktop_y;
        let max_x = desktop_x.saturating_add((desktop_w - width).max(0));
        let max_y = desktop_y.saturating_add((desktop_h - height).max(0));
        (x.clamp(min_x, max_x), y.clamp(min_y, max_y))
    }

    fn overlay_anchor_position(preset: PositionPreset, width: i32, height: i32) -> (i32, i32) {
        let (desktop_x, desktop_y, desktop_w, desktop_h) = virtual_desktop_metrics();
        let margin_x = 48;
        let margin_bottom = 120;
        let margin_top = 84;

        let base_x = match preset {
            PositionPreset::BottomLeft => desktop_x.saturating_add(margin_x),
            PositionPreset::BottomRight => {
                desktop_x.saturating_add((desktop_w - width - margin_x).max(0))
            }
            PositionPreset::BottomCenter | PositionPreset::TopCenter => {
                desktop_x.saturating_add(((desktop_w - width) / 2).max(0))
            }
        };

        let base_y = match preset {
            PositionPreset::TopCenter => desktop_y.saturating_add(margin_top),
            _ => desktop_y.saturating_add((desktop_h - height - margin_bottom).max(0)),
        };

        clamp_to_virtual_desktop(base_x, base_y, width, height)
    }

    fn offset_from_absolute_position(
        absolute_x: i32,
        absolute_y: i32,
        preset: PositionPreset,
        width: i32,
        height: i32,
    ) -> (i32, i32) {
        let (anchor_x, anchor_y) = overlay_anchor_position(preset, width, height);
        (
            normalize_offset(absolute_x.saturating_sub(anchor_x)),
            normalize_offset(absolute_y.saturating_sub(anchor_y)),
        )
    }

    fn to_wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn resolve_overlay_hwnd(window_title: &[u16]) -> Option<HWND> {
        unsafe {
            let hwnd = FindWindowW(ptr::null(), window_title.as_ptr());
            if hwnd.is_null() {
                None
            } else {
                Some(hwnd)
            }
        }
    }

    fn current_cursor_screen_position() -> Option<(i32, i32)> {
        unsafe {
            let mut point = POINT { x: 0, y: 0 };
            if GetCursorPos(&mut point as *mut POINT) == 0 {
                return None;
            }
            Some((point.x, point.y))
        }
    }

    fn overlay_window_bounds(
        preset: PositionPreset,
        offset_x: i32,
        offset_y: i32,
        region_width: i32,
        region_height: i32,
    ) -> (i32, i32, i32, i32) {
        let (width, height) = resolve_overlay_size(region_width, region_height);
        let (anchor_x, anchor_y) = overlay_anchor_position(preset, width, height);
        let (x, y) = clamp_to_virtual_desktop(
            anchor_x.saturating_add(normalize_offset(offset_x)),
            anchor_y.saturating_add(normalize_offset(offset_y)),
            width,
            height,
        );
        (x, y, width, height)
    }

    fn apply_native_window_style(hwnd: HWND, click_through: bool, opacity_percent: u8) {
        let alpha = ((normalize_opacity(opacity_percent) as u16 * 255) / 100) as u8;

        unsafe {
            let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let mut next = current
                | WS_EX_TOPMOST as isize
                | WS_EX_LAYERED as isize
                | WS_EX_TOOLWINDOW as isize
                | WS_EX_NOACTIVATE as isize;

            if click_through {
                next |= WS_EX_TRANSPARENT as isize;
            } else {
                next &= !(WS_EX_TRANSPARENT as isize);
            }

            let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
            let _ = SetLayeredWindowAttributes(hwnd, 0, alpha, LWA_ALPHA);
            let _ = SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }

    fn apply_native_window_bounds(hwnd: HWND, x: i32, y: i32, width: i32, height: i32) {
        unsafe {
            let _ = SetWindowPos(hwnd, HWND_TOPMOST, x, y, width, height, SWP_NOACTIVATE);
        }
    }

    fn apply_native_window_visibility(hwnd: HWND, visible: bool) {
        unsafe {
            let _ = ShowWindow(hwnd, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
        }
    }

    struct DesktopLyricsEguiApp {
        command_rx: Receiver<DesktopLyricsSidecarCommand>,
        state: OverlayRuntimeState,
        window_title: Vec<u16>,
        ready_emitted: bool,
        last_drag_cursor_position: Option<(i32, i32)>,
        last_resize_cursor_position: Option<(i32, i32)>,
        drag_active: bool,
        resize_active: bool,
        layout_dirty: bool,
        native_state_dirty: bool,
        last_applied_native_state: Option<AppliedNativeWindowState>,
    }

    impl DesktopLyricsEguiApp {
        fn new(command_rx: Receiver<DesktopLyricsSidecarCommand>, window_title: Vec<u16>) -> Self {
            Self {
                command_rx,
                state: OverlayRuntimeState::default(),
                window_title,
                ready_emitted: false,
                last_drag_cursor_position: None,
                last_resize_cursor_position: None,
                drag_active: false,
                resize_active: false,
                layout_dirty: false,
                native_state_dirty: true,
                last_applied_native_state: None,
            }
        }

        fn ensure_hwnd(&mut self) {
            if self.state.hwnd.is_some() {
                return;
            }

            self.state.hwnd = resolve_overlay_hwnd(self.window_title.as_slice());
            if self.state.hwnd.is_some() {
                self.last_applied_native_state = None;
                self.native_state_dirty = true;

                if !self.ready_emitted {
                    emit_sidecar_event(&DesktopLyricsSidecarEvent::Ready);
                    self.ready_emitted = true;
                }
            }
        }

        fn apply_state_to_native_window(&mut self) {
            self.ensure_hwnd();

            let Some(hwnd) = self.state.hwnd else {
                return;
            };

            if !self.native_state_dirty && self.last_applied_native_state.is_some() {
                return;
            }

            let bounds = self.current_window_bounds();
            let next_applied = AppliedNativeWindowState {
                click_through: self.state.click_through,
                opacity_percent: self.state.opacity_percent,
                visible: self.state.visible,
                bounds,
            };

            let previous = self.last_applied_native_state;
            let style_changed = previous
                .map(|prior| {
                    prior.click_through != next_applied.click_through
                        || prior.opacity_percent != next_applied.opacity_percent
                })
                .unwrap_or(true);
            let bounds_changed = previous
                .map(|prior| prior.bounds != next_applied.bounds)
                .unwrap_or(true);
            let visibility_changed = previous
                .map(|prior| prior.visible != next_applied.visible)
                .unwrap_or(true);

            if style_changed {
                apply_native_window_style(
                    hwnd,
                    next_applied.click_through,
                    next_applied.opacity_percent,
                );
            }

            if bounds_changed {
                apply_native_window_bounds(
                    hwnd,
                    next_applied.bounds.0,
                    next_applied.bounds.1,
                    next_applied.bounds.2,
                    next_applied.bounds.3,
                );
            }

            if visibility_changed {
                apply_native_window_visibility(hwnd, next_applied.visible);
            }

            self.last_applied_native_state = Some(next_applied);
            self.native_state_dirty = false;
        }

        fn current_window_bounds(&self) -> (i32, i32, i32, i32) {
            let (width, height) =
                resolve_overlay_size(self.state.region_width, self.state.region_height);

            if let (Some(absolute_x), Some(absolute_y)) =
                (self.state.absolute_x, self.state.absolute_y)
            {
                let (x, y) = clamp_to_virtual_desktop(absolute_x, absolute_y, width, height);
                return (x, y, width, height);
            }

            overlay_window_bounds(
                self.state.position_preset,
                self.state.position_offset_x,
                self.state.position_offset_y,
                self.state.region_width,
                self.state.region_height,
            )
        }

        fn sync_offsets_from_absolute_position(&mut self, absolute_x: i32, absolute_y: i32) {
            let (width, height) =
                resolve_overlay_size(self.state.region_width, self.state.region_height);
            let (offset_x, offset_y) = offset_from_absolute_position(
                absolute_x,
                absolute_y,
                self.state.position_preset,
                width,
                height,
            );
            self.state.position_offset_x = offset_x;
            self.state.position_offset_y = offset_y;
        }

        fn apply_drag_delta(&mut self, delta_x: i32, delta_y: i32) -> bool {
            if delta_x == 0 && delta_y == 0 {
                return false;
            }

            let (current_x, current_y, current_width, current_height) =
                self.current_window_bounds();
            let (next_x, next_y) = clamp_to_virtual_desktop(
                current_x.saturating_add(delta_x),
                current_y.saturating_add(delta_y),
                current_width,
                current_height,
            );

            if next_x == current_x && next_y == current_y {
                return false;
            }

            self.state.absolute_x = Some(next_x);
            self.state.absolute_y = Some(next_y);
            self.sync_offsets_from_absolute_position(next_x, next_y);
            true
        }

        fn apply_resize_delta(&mut self, mode: ResizeMode, delta_x: i32, delta_y: i32) -> bool {
            if delta_x == 0 && delta_y == 0 {
                return false;
            }

            let (current_x, current_y, current_width, current_height) =
                self.current_window_bounds();

            let mut left = current_x;
            let mut top = current_y;
            let mut right = current_x.saturating_add(current_width);
            let mut bottom = current_y.saturating_add(current_height);

            if mode.has_left() {
                left = left.saturating_add(delta_x);
            }
            if mode.has_right() {
                right = right.saturating_add(delta_x);
            }
            if mode.has_top() {
                top = top.saturating_add(delta_y);
            }
            if mode.has_bottom() {
                bottom = bottom.saturating_add(delta_y);
            }

            let (min_width, max_width, min_height, max_height) = dynamic_region_limits();

            let mut next_width = right.saturating_sub(left).clamp(min_width, max_width);
            let mut next_height = bottom.saturating_sub(top).clamp(min_height, max_height);

            if mode.has_left() && !mode.has_right() {
                left = right.saturating_sub(next_width);
            } else {
                right = left.saturating_add(next_width);
            }

            if mode.has_top() && !mode.has_bottom() {
                top = bottom.saturating_sub(next_height);
            } else {
                bottom = top.saturating_add(next_height);
            }

            next_width = right.saturating_sub(left).clamp(min_width, max_width);
            next_height = bottom.saturating_sub(top).clamp(min_height, max_height);

            let (next_x, next_y) = clamp_to_virtual_desktop(left, top, next_width, next_height);

            if next_width == current_width
                && next_height == current_height
                && next_x == current_x
                && next_y == current_y
            {
                return false;
            }

            self.state.region_width = next_width;
            self.state.region_height = next_height;
            self.state.absolute_x = Some(next_x);
            self.state.absolute_y = Some(next_y);
            self.sync_offsets_from_absolute_position(next_x, next_y);
            true
        }

        fn emit_layout_changed_event(&self) {
            emit_sidecar_event(&DesktopLyricsSidecarEvent::LayoutChanged {
                offset_x: self.state.position_offset_x,
                offset_y: self.state.position_offset_y,
                region_width: self.state.region_width,
                region_height: self.state.region_height,
            });
        }

        fn handle_command(&mut self, command: DesktopLyricsSidecarCommand) {
            let command_name = sidecar_command_name(&command).to_string();

            match command {
                DesktopLyricsSidecarCommand::SetVisible { visible } => {
                    self.state.visible = visible;
                    self.native_state_dirty = true;
                }
                DesktopLyricsSidecarCommand::SetClickThrough { enabled } => {
                    self.state.click_through = enabled;
                    self.native_state_dirty = true;
                }
                DesktopLyricsSidecarCommand::SetFontSize { font_size } => {
                    self.state.font_size = font_size.max(MIN_FONT_SIZE);
                }
                DesktopLyricsSidecarCommand::SetOpacityPercent { opacity_percent } => {
                    self.state.opacity_percent = normalize_opacity(opacity_percent);
                    self.native_state_dirty = true;
                }
                DesktopLyricsSidecarCommand::SetPositionPreset { preset } => {
                    self.state.position_preset = PositionPreset::parse(preset.as_str())
                        .unwrap_or(PositionPreset::BottomCenter);
                    self.state.absolute_x = None;
                    self.state.absolute_y = None;
                    self.native_state_dirty = true;
                }
                DesktopLyricsSidecarCommand::SetPositionOffset { offset_x, offset_y } => {
                    self.state.position_offset_x = normalize_offset(offset_x);
                    self.state.position_offset_y = normalize_offset(offset_y);
                    self.state.absolute_x = None;
                    self.state.absolute_y = None;
                    self.native_state_dirty = true;
                }
                DesktopLyricsSidecarCommand::SetRegionSize { width, height } => {
                    self.state.region_width = if width <= 0 {
                        DEFAULT_REGION_WIDTH
                    } else {
                        normalize_region_width(width)
                    };
                    self.state.region_height = if height <= 0 {
                        DEFAULT_REGION_HEIGHT
                    } else {
                        normalize_region_height(height)
                    };
                    self.state.absolute_x = None;
                    self.state.absolute_y = None;
                    self.native_state_dirty = true;
                }
                DesktopLyricsSidecarCommand::SetText { text } => match text {
                    Some(DesktopLyricsSidecarText { primary, secondary }) => {
                        self.state.primary_text = primary;
                        self.state.secondary_text = secondary.unwrap_or_default();
                    }
                    None => {
                        self.state.primary_text.clear();
                        self.state.secondary_text.clear();
                    }
                },
                DesktopLyricsSidecarCommand::Shutdown => {
                    self.state.shutdown_requested = true;
                }
            }

            emit_sidecar_event(&DesktopLyricsSidecarEvent::Ack {
                command: command_name,
            });
        }

        fn drain_commands(&mut self) {
            loop {
                match self.command_rx.try_recv() {
                    Ok(command) => {
                        self.handle_command(command);
                    }
                    Err(TryRecvError::Empty) | Err(TryRecvError::Disconnected) => break,
                }
            }
        }
    }

    impl eframe::App for DesktopLyricsEguiApp {
        fn clear_color(&self, _visuals: &egui::Visuals) -> [f32; 4] {
            [0.0, 0.0, 0.0, 0.0]
        }

        fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
            self.drain_commands();

            if self.state.shutdown_requested {
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                return;
            }

            self.apply_state_to_native_window();

            let mut layout_changed = false;
            let mut drag_gesture_active = false;
            let mut resize_gesture_active = false;
            let mut force_emit_layout_event = false;

            egui::CentralPanel::default()
                .frame(egui::Frame::none().fill(Color32::TRANSPARENT))
                .show(ctx, |ui| {
                    let panel_rect = ui.max_rect();

                    if !self.state.click_through {
                        let resize_edge = 8.0;
                        let corner_size = 16.0;

                        let top_left_rect = egui::Rect::from_min_size(
                            panel_rect.left_top(),
                            egui::vec2(corner_size, corner_size),
                        );
                        let top_right_rect = egui::Rect::from_min_size(
                            egui::pos2(panel_rect.right() - corner_size, panel_rect.top()),
                            egui::vec2(corner_size, corner_size),
                        );
                        let bottom_left_rect = egui::Rect::from_min_size(
                            egui::pos2(panel_rect.left(), panel_rect.bottom() - corner_size),
                            egui::vec2(corner_size, corner_size),
                        );
                        let bottom_right_rect = egui::Rect::from_min_size(
                            panel_rect.right_bottom() - egui::vec2(corner_size, corner_size),
                            egui::vec2(corner_size, corner_size),
                        );

                        let top_rect = egui::Rect::from_min_max(
                            egui::pos2(top_left_rect.right(), panel_rect.top()),
                            egui::pos2(top_right_rect.left(), panel_rect.top() + resize_edge),
                        );
                        let bottom_rect = egui::Rect::from_min_max(
                            egui::pos2(bottom_left_rect.right(), panel_rect.bottom() - resize_edge),
                            egui::pos2(bottom_right_rect.left(), panel_rect.bottom()),
                        );
                        let left_rect = egui::Rect::from_min_max(
                            egui::pos2(panel_rect.left(), top_left_rect.bottom()),
                            egui::pos2(panel_rect.left() + resize_edge, bottom_left_rect.top()),
                        );
                        let right_rect = egui::Rect::from_min_max(
                            egui::pos2(panel_rect.right() - resize_edge, top_right_rect.bottom()),
                            egui::pos2(panel_rect.right(), bottom_right_rect.top()),
                        );

                        let resize_nw = ui.interact(
                            top_left_rect,
                            ui.id().with("resize-nw"),
                            egui::Sense::drag(),
                        );
                        let resize_ne = ui.interact(
                            top_right_rect,
                            ui.id().with("resize-ne"),
                            egui::Sense::drag(),
                        );
                        let resize_sw = ui.interact(
                            bottom_left_rect,
                            ui.id().with("resize-sw"),
                            egui::Sense::drag(),
                        );
                        let resize_se = ui.interact(
                            bottom_right_rect,
                            ui.id().with("resize-se"),
                            egui::Sense::drag(),
                        );
                        let resize_n =
                            ui.interact(top_rect, ui.id().with("resize-n"), egui::Sense::drag());
                        let resize_s =
                            ui.interact(bottom_rect, ui.id().with("resize-s"), egui::Sense::drag());
                        let resize_w =
                            ui.interact(left_rect, ui.id().with("resize-w"), egui::Sense::drag());
                        let resize_e =
                            ui.interact(right_rect, ui.id().with("resize-e"), egui::Sense::drag());

                        let dragged_resize_mode = if resize_nw.dragged() {
                            Some(ResizeMode::NorthWest)
                        } else if resize_ne.dragged() {
                            Some(ResizeMode::NorthEast)
                        } else if resize_sw.dragged() {
                            Some(ResizeMode::SouthWest)
                        } else if resize_se.dragged() {
                            Some(ResizeMode::SouthEast)
                        } else if resize_n.dragged() {
                            Some(ResizeMode::North)
                        } else if resize_s.dragged() {
                            Some(ResizeMode::South)
                        } else if resize_w.dragged() {
                            Some(ResizeMode::West)
                        } else if resize_e.dragged() {
                            Some(ResizeMode::East)
                        } else {
                            None
                        };

                        let hovered_resize_mode = if resize_nw.hovered() {
                            Some(ResizeMode::NorthWest)
                        } else if resize_ne.hovered() {
                            Some(ResizeMode::NorthEast)
                        } else if resize_sw.hovered() {
                            Some(ResizeMode::SouthWest)
                        } else if resize_se.hovered() {
                            Some(ResizeMode::SouthEast)
                        } else if resize_n.hovered() {
                            Some(ResizeMode::North)
                        } else if resize_s.hovered() {
                            Some(ResizeMode::South)
                        } else if resize_w.hovered() {
                            Some(ResizeMode::West)
                        } else if resize_e.hovered() {
                            Some(ResizeMode::East)
                        } else {
                            None
                        };

                        if let Some(mode) = dragged_resize_mode.or(hovered_resize_mode) {
                            ui.output_mut(|output| {
                                output.cursor_icon = mode.cursor_icon();
                            });
                        }

                        if let Some(mode) = dragged_resize_mode {
                            resize_gesture_active = true;
                            if let Some((cursor_x, cursor_y)) = current_cursor_screen_position() {
                                if let Some((last_x, last_y)) = self.last_resize_cursor_position {
                                    layout_changed |= self.apply_resize_delta(
                                        mode,
                                        cursor_x.saturating_sub(last_x),
                                        cursor_y.saturating_sub(last_y),
                                    );
                                }
                                self.last_resize_cursor_position = Some((cursor_x, cursor_y));
                            }
                            self.last_drag_cursor_position = None;
                        } else {
                            self.last_resize_cursor_position = None;
                        }

                        let drag_margin = resize_edge + 2.0;
                        let drag_rect = if panel_rect.width() > drag_margin * 2.0
                            && panel_rect.height() > drag_margin * 2.0
                        {
                            egui::Rect::from_min_max(
                                panel_rect.min + egui::vec2(drag_margin, drag_margin),
                                panel_rect.max - egui::vec2(drag_margin, drag_margin),
                            )
                        } else {
                            panel_rect
                        };
                        let drag_response =
                            ui.interact(drag_rect, ui.id().with("drag-area"), egui::Sense::drag());

                        if (drag_response.hovered() || drag_response.dragged())
                            && dragged_resize_mode.is_none()
                        {
                            ui.output_mut(|output| {
                                output.cursor_icon = egui::CursorIcon::Grab;
                            });
                        }

                        if drag_response.double_clicked() {
                            self.state.position_offset_x = 0;
                            self.state.position_offset_y = 0;
                            self.state.region_width = DEFAULT_REGION_WIDTH;
                            self.state.region_height = DEFAULT_REGION_HEIGHT;
                            self.state.absolute_x = None;
                            self.state.absolute_y = None;
                            layout_changed = true;
                            force_emit_layout_event = true;
                        }

                        if drag_response.dragged() && dragged_resize_mode.is_none() {
                            drag_gesture_active = true;
                            if let Some((cursor_x, cursor_y)) = current_cursor_screen_position() {
                                if let Some((last_x, last_y)) = self.last_drag_cursor_position {
                                    layout_changed |= self.apply_drag_delta(
                                        cursor_x.saturating_sub(last_x),
                                        cursor_y.saturating_sub(last_y),
                                    );
                                }
                                self.last_drag_cursor_position = Some((cursor_x, cursor_y));
                            }
                        } else {
                            self.last_drag_cursor_position = None;
                        }
                    } else {
                        self.last_drag_cursor_position = None;
                        self.last_resize_cursor_position = None;
                        drag_gesture_active = false;
                        resize_gesture_active = false;
                    }

                    let width_scale = (panel_rect.width() / 960.0).clamp(0.6, 3.0);
                    let height_scale = (panel_rect.height() / 132.0).clamp(0.6, 3.0);
                    let region_scale = (width_scale * 0.35 + height_scale * 0.65).clamp(0.6, 3.0);
                    let primary_size =
                        (self.state.font_size as f32 * region_scale).clamp(14.0, 120.0);
                    let secondary_size = (primary_size * 0.72).clamp(12.0, 96.0);

                    ui.add_space(12.0);
                    ui.vertical_centered(|ui| {
                        if !self.state.primary_text.trim().is_empty() {
                            ui.label(
                                RichText::new(self.state.primary_text.as_str())
                                    .size(primary_size)
                                    .strong()
                                    .color(Color32::WHITE),
                            );
                        }

                        if !self.state.secondary_text.trim().is_empty() {
                            ui.add_space(4.0);
                            ui.label(
                                RichText::new(self.state.secondary_text.as_str())
                                    .size(secondary_size)
                                    .color(Color32::from_gray(208)),
                            );
                        }
                    });
                });

            if layout_changed {
                self.native_state_dirty = true;
                self.apply_state_to_native_window();
                self.layout_dirty = true;
            }

            let interaction_ended = (self.drag_active || self.resize_active)
                && !drag_gesture_active
                && !resize_gesture_active;

            if (interaction_ended || force_emit_layout_event) && self.layout_dirty {
                self.emit_layout_changed_event();
                self.layout_dirty = false;
            }

            self.drag_active = drag_gesture_active;
            self.resize_active = resize_gesture_active;

            if self.state.visible {
                ctx.request_repaint_after(Duration::from_millis(16));
            } else {
                ctx.request_repaint_after(Duration::from_millis(120));
            }
        }
    }

    let (tx, rx) = mpsc::channel::<DesktopLyricsSidecarCommand>();
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        let mut reader = BufReader::new(stdin.lock());
        let mut line = String::new();

        loop {
            line.clear();
            let read_count = match reader.read_line(&mut line) {
                Ok(count) => count,
                Err(error) => {
                    safe_stderr_log(format!(
                        "[desktop-lyrics-sidecar] stdin read error: {error}"
                    ));
                    emit_sidecar_event(&DesktopLyricsSidecarEvent::Error {
                        message: format!("stdin read error: {error}"),
                    });
                    let _ = tx.send(DesktopLyricsSidecarCommand::Shutdown);
                    break;
                }
            };

            if read_count == 0 {
                let _ = tx.send(DesktopLyricsSidecarCommand::Shutdown);
                break;
            }

            let payload = line.trim();
            if payload.is_empty() {
                continue;
            }

            match serde_json::from_str::<DesktopLyricsSidecarCommand>(payload) {
                Ok(command) => {
                    let is_shutdown = matches!(command, DesktopLyricsSidecarCommand::Shutdown);
                    if tx.send(command).is_err() || is_shutdown {
                        break;
                    }
                }
                Err(error) => {
                    safe_stderr_log(format!(
                        "[desktop-lyrics-sidecar] invalid command payload: {error}"
                    ));
                    emit_sidecar_event(&DesktopLyricsSidecarEvent::Error {
                        message: "invalid command payload".to_string(),
                    });
                }
            }
        }
    });

    let window_title = to_wide(WINDOW_TITLE);

    let mut native_options = eframe::NativeOptions::default();
    native_options.viewport = egui::ViewportBuilder::default()
        .with_title(WINDOW_TITLE)
        .with_inner_size([960.0, 132.0])
        .with_transparent(true)
        .with_decorations(false)
        .with_resizable(false)
        .with_always_on_top()
        .with_visible(false)
        .with_active(false);

    eframe::run_native(
        WINDOW_TITLE,
        native_options,
        Box::new(move |_cc| Box::new(DesktopLyricsEguiApp::new(rx, window_title))),
    )
    .map_err(|error| format!("Desktop lyrics egui sidecar event loop failed: {error}"))
}
