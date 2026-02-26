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
    SetText {
        text: Option<DesktopLyricsSidecarText>,
    },
    Shutdown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DesktopLyricsSidecarEvent {
    Ready,
    Ack { command: String },
    Error { message: String },
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
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowW, GetSystemMetrics, GetWindowLongPtrW, SetLayeredWindowAttributes,
        SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_TOPMOST, LWA_ALPHA,
        SM_CXSCREEN, SM_CYSCREEN, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        SW_HIDE, SW_SHOWNOACTIVATE, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        WS_EX_TOPMOST, WS_EX_TRANSPARENT,
    };

    const WINDOW_TITLE: &str = "PMP Desktop Lyrics Overlay";
    const MIN_FONT_SIZE: u32 = 16;
    const DEFAULT_FONT_SIZE: u32 = 26;
    const MIN_OPACITY_PERCENT: u8 = 35;
    const MAX_OPACITY_PERCENT: u8 = 100;
    const DEFAULT_OPACITY_PERCENT: u8 = 92;
    const MAX_POSITION_OFFSET: i32 = 960;

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
                primary_text: String::new(),
                secondary_text: String::new(),
                shutdown_requested: false,
            }
        }
    }

    fn normalize_opacity(value: u8) -> u8 {
        value.clamp(MIN_OPACITY_PERCENT, MAX_OPACITY_PERCENT)
    }

    fn normalize_offset(value: i32) -> i32 {
        value.clamp(-MAX_POSITION_OFFSET, MAX_POSITION_OFFSET)
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

    fn overlay_window_bounds(
        preset: PositionPreset,
        offset_x: i32,
        offset_y: i32,
    ) -> (i32, i32, i32, i32) {
        unsafe {
            let screen_w = GetSystemMetrics(SM_CXSCREEN).max(1280);
            let screen_h = GetSystemMetrics(SM_CYSCREEN).max(720);
            let width = ((screen_w as f64) * 0.66).round() as i32;
            let height = 132;
            let margin_x = 48;
            let margin_bottom = 120;
            let margin_top = 84;

            let base_x = match preset {
                PositionPreset::BottomLeft => margin_x,
                PositionPreset::BottomRight => (screen_w - width - margin_x).max(0),
                PositionPreset::BottomCenter | PositionPreset::TopCenter => {
                    ((screen_w - width) / 2).max(0)
                }
            };

            let base_y = match preset {
                PositionPreset::TopCenter => margin_top,
                _ => (screen_h - height - margin_bottom).max(0),
            };

            let safe_width = width.max(640);
            let max_x = (screen_w - safe_width).max(0);
            let max_y = (screen_h - height).max(0);

            let x = base_x
                .saturating_add(normalize_offset(offset_x))
                .clamp(0, max_x);
            let y = base_y
                .saturating_add(normalize_offset(offset_y))
                .clamp(0, max_y);

            (x, y, safe_width, height)
        }
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

    fn apply_native_window_bounds(
        hwnd: HWND,
        preset: PositionPreset,
        offset_x: i32,
        offset_y: i32,
    ) {
        let (x, y, width, height) = overlay_window_bounds(preset, offset_x, offset_y);
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
    }

    impl DesktopLyricsEguiApp {
        fn new(command_rx: Receiver<DesktopLyricsSidecarCommand>, window_title: Vec<u16>) -> Self {
            Self {
                command_rx,
                state: OverlayRuntimeState::default(),
                window_title,
                ready_emitted: false,
            }
        }

        fn ensure_hwnd(&mut self) {
            if self.state.hwnd.is_some() {
                return;
            }

            self.state.hwnd = resolve_overlay_hwnd(self.window_title.as_slice());
            if let Some(hwnd) = self.state.hwnd {
                apply_native_window_style(
                    hwnd,
                    self.state.click_through,
                    self.state.opacity_percent,
                );
                apply_native_window_bounds(
                    hwnd,
                    self.state.position_preset,
                    self.state.position_offset_x,
                    self.state.position_offset_y,
                );
                apply_native_window_visibility(hwnd, self.state.visible);

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

            apply_native_window_style(hwnd, self.state.click_through, self.state.opacity_percent);
            apply_native_window_bounds(
                hwnd,
                self.state.position_preset,
                self.state.position_offset_x,
                self.state.position_offset_y,
            );
            apply_native_window_visibility(hwnd, self.state.visible);
        }

        fn handle_command(&mut self, command: DesktopLyricsSidecarCommand) {
            let command_name = sidecar_command_name(&command).to_string();

            match command {
                DesktopLyricsSidecarCommand::SetVisible { visible } => {
                    self.state.visible = visible;
                }
                DesktopLyricsSidecarCommand::SetClickThrough { enabled } => {
                    self.state.click_through = enabled;
                }
                DesktopLyricsSidecarCommand::SetFontSize { font_size } => {
                    self.state.font_size = font_size.max(MIN_FONT_SIZE);
                }
                DesktopLyricsSidecarCommand::SetOpacityPercent { opacity_percent } => {
                    self.state.opacity_percent = normalize_opacity(opacity_percent);
                }
                DesktopLyricsSidecarCommand::SetPositionPreset { preset } => {
                    self.state.position_preset = PositionPreset::parse(preset.as_str())
                        .unwrap_or(PositionPreset::BottomCenter);
                }
                DesktopLyricsSidecarCommand::SetPositionOffset { offset_x, offset_y } => {
                    self.state.position_offset_x = normalize_offset(offset_x);
                    self.state.position_offset_y = normalize_offset(offset_y);
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

            egui::CentralPanel::default()
                .frame(egui::Frame::none().fill(Color32::TRANSPARENT))
                .show(ctx, |ui| {
                    ui.add_space(12.0);
                    ui.vertical_centered(|ui| {
                        if !self.state.primary_text.trim().is_empty() {
                            ui.label(
                                RichText::new(self.state.primary_text.as_str())
                                    .size(self.state.font_size as f32)
                                    .strong()
                                    .color(Color32::WHITE),
                            );
                        }

                        if !self.state.secondary_text.trim().is_empty() {
                            ui.add_space(4.0);
                            let secondary_size =
                                (self.state.font_size.saturating_sub(8)).max(12) as f32;
                            ui.label(
                                RichText::new(self.state.secondary_text.as_str())
                                    .size(secondary_size)
                                    .color(Color32::from_gray(208)),
                            );
                        }
                    });
                });

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
