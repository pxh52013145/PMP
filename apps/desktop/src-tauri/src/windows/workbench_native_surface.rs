use serde::Deserialize;
use tauri::{AppHandle, Manager};

use super::MAIN_WINDOW_LABEL;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkbenchNativeSurfaceRegion {
    Bottom,
    Right,
}

impl WorkbenchNativeSurfaceRegion {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "bottom" => Some(Self::Bottom),
            "right" => Some(Self::Right),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct WorkbenchNativeSurfaceConfig {
    pub surface_id: String,
    pub region: WorkbenchNativeSurfaceRegion,
    pub title: Option<String>,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchNativeTimeRange {
    pub start_ms: f64,
    pub end_ms: f64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchNativeTimelineMarker {
    pub id: String,
    pub label: String,
    pub time_ms: f64,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchNativeTimelineContent {
    pub protocol_version: u32,
    pub title: String,
    #[serde(default)]
    pub track_label: Option<String>,
    pub duration_ms: f64,
    pub playhead_ms: f64,
    #[serde(default)]
    pub clip_range: Option<WorkbenchNativeTimeRange>,
    #[serde(default)]
    pub loop_range: Option<WorkbenchNativeTimeRange>,
    #[serde(default)]
    pub markers: Vec<WorkbenchNativeTimelineMarker>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchNativeOutlinerItem {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub depth: u32,
    pub visible: bool,
    pub selected: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchNativeOutlinerContent {
    pub protocol_version: u32,
    pub title: String,
    #[serde(default)]
    pub items: Vec<WorkbenchNativeOutlinerItem>,
    #[serde(default)]
    pub selected_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WorkbenchNativeSurfaceContent {
    Timeline(WorkbenchNativeTimelineContent),
    Outliner(WorkbenchNativeOutlinerContent),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NativeMainBounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub scale_factor: f64,
    pub owner_hwnd: isize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NativeSurfaceRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

fn is_safe_surface_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn logical_to_physical(value: f64, scale_factor: f64, fallback: i32) -> i32 {
    if !value.is_finite() || value <= 0.0 {
        return fallback.max(1);
    }
    (value * scale_factor.max(0.1)).round().max(1.0) as i32
}

pub fn clamp_timeline_ratio(time_ms: f64, duration_ms: f64) -> f64 {
    if !time_ms.is_finite() || !duration_ms.is_finite() || duration_ms <= 0.0 {
        return 0.0;
    }
    (time_ms / duration_ms).clamp(0.0, 1.0)
}

pub fn effective_timeline_duration_ms(
    duration_ms: f64,
    playhead_ms: f64,
    clip_range: Option<&WorkbenchNativeTimeRange>,
    loop_range: Option<&WorkbenchNativeTimeRange>,
) -> f64 {
    let mut duration = if duration_ms.is_finite() && duration_ms > 0.0 {
        duration_ms
    } else {
        1.0
    };
    if playhead_ms.is_finite() && playhead_ms > duration {
        duration = playhead_ms;
    }
    if let Some(range) = clip_range {
        if range.end_ms.is_finite() && range.end_ms > duration {
            duration = range.end_ms;
        }
    }
    if let Some(range) = loop_range {
        if range.end_ms.is_finite() && range.end_ms > duration {
            duration = range.end_ms;
        }
    }
    duration.max(1.0)
}

pub fn compute_surface_rect(
    main: NativeMainBounds,
    region: WorkbenchNativeSurfaceRegion,
    logical_width: f64,
    logical_height: f64,
) -> NativeSurfaceRect {
    match region {
        WorkbenchNativeSurfaceRegion::Bottom => {
            let height = logical_to_physical(logical_height, main.scale_factor, 208);
            NativeSurfaceRect {
                x: main.x,
                y: main.y.saturating_add(main.height),
                width: main.width.max(1),
                height,
            }
        }
        WorkbenchNativeSurfaceRegion::Right => {
            let width = logical_to_physical(logical_width, main.scale_factor, 300);
            NativeSurfaceRect {
                x: main.x.saturating_add(main.width),
                y: main.y,
                width,
                height: main.height.max(1),
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn resolve_main_bounds(app: &AppHandle) -> Result<NativeMainBounds, String> {
    let main = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "Main window not found".to_string())?;
    let position = main.outer_position().map_err(|error| error.to_string())?;
    let size = main.outer_size().map_err(|error| error.to_string())?;
    let scale_factor = main.scale_factor().map_err(|error| error.to_string())?;
    let owner_hwnd = main.hwnd().map(|hwnd| hwnd.0 as isize).unwrap_or_default();

    Ok(NativeMainBounds {
        x: position.x,
        y: position.y,
        width: size.width as i32,
        height: size.height as i32,
        scale_factor,
        owner_hwnd,
    })
}

#[cfg(not(target_os = "windows"))]
fn resolve_main_bounds(_app: &AppHandle) -> Result<NativeMainBounds, String> {
    Err("Workbench native surfaces are only implemented on Windows for this spike".to_string())
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{
        clamp_timeline_ratio, compute_surface_rect, effective_timeline_duration_ms,
        NativeMainBounds, WorkbenchNativeOutlinerContent, WorkbenchNativeSurfaceConfig,
        WorkbenchNativeSurfaceContent, WorkbenchNativeSurfaceRegion, WorkbenchNativeTimeRange,
        WorkbenchNativeTimelineContent,
    };
    use once_cell::sync::OnceCell;
    use std::{
        collections::HashMap,
        ptr::{null, null_mut},
        sync::{
            mpsc::{self, Receiver, Sender},
            Mutex,
        },
        thread,
        time::Duration,
    };
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
        Graphics::Gdi::{
            BeginPaint, CreatePen, CreateSolidBrush, DeleteObject, DrawTextW, EndPaint, FillRect,
            FrameRect, InvalidateRect, LineTo, MoveToEx, SelectObject, SetBkMode, SetTextColor,
            DT_END_ELLIPSIS, DT_LEFT, DT_RIGHT, DT_SINGLELINE, DT_VCENTER, HBRUSH, HDC,
            PAINTSTRUCT, PS_SOLID, TRANSPARENT,
        },
        UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetClientRect,
            PeekMessageW, RegisterClassW, SetWindowPos, ShowWindow, TranslateMessage, CS_HREDRAW,
            CS_VREDRAW, MSG, PM_REMOVE, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_SHOWWINDOW,
            SW_SHOWNOACTIVATE, WM_CLOSE, WM_DESTROY, WM_ERASEBKGND, WM_PAINT, WNDCLASSW,
            WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP,
        },
    };

    const CLASS_NAME: &str = "PmpWorkbenchNativeDockSurface";

    #[derive(Debug, Clone)]
    struct SurfaceSpec {
        surface_id: String,
        region: WorkbenchNativeSurfaceRegion,
        title: String,
        width: f64,
        height: f64,
    }

    #[derive(Debug, Clone)]
    struct SurfacePaintState {
        region: WorkbenchNativeSurfaceRegion,
        title: String,
        content: Option<WorkbenchNativeSurfaceContent>,
    }

    #[derive(Debug)]
    enum HostCommand {
        Upsert {
            spec: SurfaceSpec,
            main_bounds: NativeMainBounds,
        },
        SyncGeometry {
            main_bounds: NativeMainBounds,
        },
        Close {
            surface_id: String,
        },
        UpdateContent {
            surface_id: String,
            content: WorkbenchNativeSurfaceContent,
        },
        CloseAll,
    }

    struct NativeSurfaceHost {
        sender: Sender<HostCommand>,
    }

    struct SurfaceWindow {
        hwnd: HWND,
        spec: SurfaceSpec,
        content: Option<WorkbenchNativeSurfaceContent>,
    }

    struct HostState {
        main_bounds: Option<NativeMainBounds>,
        surfaces: HashMap<String, SurfaceWindow>,
    }

    static HOST: OnceCell<NativeSurfaceHost> = OnceCell::new();
    static PAINT_STATE: OnceCell<Mutex<HashMap<isize, SurfacePaintState>>> = OnceCell::new();

    pub fn open_surface(
        config: WorkbenchNativeSurfaceConfig,
        main_bounds: NativeMainBounds,
    ) -> Result<(), String> {
        let title = config
            .title
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| config.surface_id.clone());
        let spec = SurfaceSpec {
            surface_id: config.surface_id,
            region: config.region,
            title,
            width: config.width,
            height: config.height,
        };

        host()?.send(HostCommand::Upsert { spec, main_bounds })
    }

    pub fn sync_geometry(main_bounds: NativeMainBounds) -> Result<(), String> {
        host()?.send(HostCommand::SyncGeometry { main_bounds })
    }

    pub fn close_surface(surface_id: String) -> Result<(), String> {
        host()?.send(HostCommand::Close { surface_id })
    }

    pub fn update_surface_content(
        surface_id: String,
        content: WorkbenchNativeSurfaceContent,
    ) -> Result<(), String> {
        host()?.send(HostCommand::UpdateContent {
            surface_id,
            content,
        })
    }

    pub fn close_all_surfaces() -> Result<(), String> {
        host()?.send(HostCommand::CloseAll)
    }

    fn host() -> Result<&'static NativeSurfaceHost, String> {
        Ok(HOST.get_or_init(|| {
            let (sender, receiver) = mpsc::channel();
            thread::spawn(move || run_host(receiver));
            NativeSurfaceHost { sender }
        }))
    }

    impl NativeSurfaceHost {
        fn send(&self, command: HostCommand) -> Result<(), String> {
            self.sender
                .send(command)
                .map_err(|error| format!("Workbench native surface host unavailable: {}", error))
        }
    }

    fn run_host(receiver: Receiver<HostCommand>) {
        unsafe {
            register_window_class();
        }
        let mut state = HostState {
            main_bounds: None,
            surfaces: HashMap::new(),
        };

        loop {
            process_pending_window_messages();

            match receiver.recv_timeout(Duration::from_millis(16)) {
                Ok(command) => state.handle(command),
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    state.close_all();
                    break;
                }
            }

            while let Ok(command) = receiver.try_recv() {
                state.handle(command);
            }
        }
    }

    impl HostState {
        fn handle(&mut self, command: HostCommand) {
            match command {
                HostCommand::Upsert { spec, main_bounds } => {
                    self.main_bounds = Some(main_bounds);
                    self.upsert(spec, main_bounds);
                }
                HostCommand::SyncGeometry { main_bounds } => {
                    self.main_bounds = Some(main_bounds);
                    self.sync_geometry();
                }
                HostCommand::Close { surface_id } => {
                    self.close(surface_id.as_str());
                }
                HostCommand::UpdateContent {
                    surface_id,
                    content,
                } => {
                    self.update_content(surface_id.as_str(), content);
                }
                HostCommand::CloseAll => {
                    self.close_all();
                }
            }
        }

        fn upsert(&mut self, spec: SurfaceSpec, main_bounds: NativeMainBounds) {
            if let Some(existing) = self.surfaces.get_mut(spec.surface_id.as_str()) {
                existing.spec = spec;
                apply_surface_geometry(existing.hwnd, &existing.spec, main_bounds);
                sync_paint_state(existing.hwnd, &existing.spec, existing.content.as_ref());
                return;
            }

            let hwnd = unsafe { create_surface_window(&spec, main_bounds.owner_hwnd) };
            if hwnd.is_null() {
                return;
            }

            let surface = SurfaceWindow {
                hwnd,
                content: None,
                spec,
            };
            apply_surface_geometry(surface.hwnd, &surface.spec, main_bounds);
            sync_paint_state(surface.hwnd, &surface.spec, surface.content.as_ref());
            self.surfaces
                .insert(surface.spec.surface_id.clone(), surface);
        }

        fn sync_geometry(&self) {
            let Some(main_bounds) = self.main_bounds else {
                return;
            };
            for surface in self.surfaces.values() {
                apply_surface_geometry(surface.hwnd, &surface.spec, main_bounds);
            }
        }

        fn update_content(&mut self, surface_id: &str, content: WorkbenchNativeSurfaceContent) {
            let Some(surface) = self.surfaces.get_mut(surface_id) else {
                return;
            };
            surface.content = Some(content);
            sync_paint_state(surface.hwnd, &surface.spec, surface.content.as_ref());
            unsafe {
                let _ = InvalidateRect(surface.hwnd, null(), 1);
            }
        }

        fn close(&mut self, surface_id: &str) {
            let Some(surface) = self.surfaces.remove(surface_id) else {
                return;
            };
            clear_paint_state(surface.hwnd);
            unsafe {
                DestroyWindow(surface.hwnd);
            }
        }

        fn close_all(&mut self) {
            let surfaces: Vec<SurfaceWindow> =
                self.surfaces.drain().map(|(_, surface)| surface).collect();
            for surface in surfaces {
                clear_paint_state(surface.hwnd);
                unsafe {
                    DestroyWindow(surface.hwnd);
                }
            }
        }
    }

    fn hwnd_key(hwnd: HWND) -> isize {
        hwnd as isize
    }

    fn paint_state_store() -> &'static Mutex<HashMap<isize, SurfacePaintState>> {
        PAINT_STATE.get_or_init(|| Mutex::new(HashMap::new()))
    }

    fn sync_paint_state(
        hwnd: HWND,
        spec: &SurfaceSpec,
        content: Option<&WorkbenchNativeSurfaceContent>,
    ) {
        if let Ok(mut state) = paint_state_store().lock() {
            state.insert(
                hwnd_key(hwnd),
                SurfacePaintState {
                    region: spec.region,
                    title: spec.title.clone(),
                    content: content.cloned(),
                },
            );
        }
    }

    fn read_paint_state(hwnd: HWND) -> Option<SurfacePaintState> {
        paint_state_store()
            .lock()
            .ok()
            .and_then(|state| state.get(&hwnd_key(hwnd)).cloned())
    }

    fn clear_paint_state(hwnd: HWND) {
        if let Ok(mut state) = paint_state_store().lock() {
            state.remove(&hwnd_key(hwnd));
        }
    }

    unsafe fn create_surface_window(spec: &SurfaceSpec, owner_hwnd: isize) -> HWND {
        let title = to_wide(spec.title.as_str());
        let class_name = to_wide(CLASS_NAME);

        CreateWindowExW(
            WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            class_name.as_ptr(),
            title.as_ptr(),
            WS_POPUP,
            0,
            0,
            1,
            1,
            owner_hwnd as HWND,
            null_mut(),
            null_mut(),
            null_mut(),
        )
    }

    fn apply_surface_geometry(hwnd: HWND, spec: &SurfaceSpec, main_bounds: NativeMainBounds) {
        let rect = compute_surface_rect(main_bounds, spec.region, spec.width, spec.height);
        unsafe {
            SetWindowPos(
                hwnd,
                null_mut(),
                rect.x,
                rect.y,
                rect.width,
                rect.height,
                SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_SHOWWINDOW,
            );
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
    }

    unsafe fn register_window_class() {
        let class_name = to_wide(CLASS_NAME);
        let window_class = WNDCLASSW {
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(wnd_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: null_mut(),
            hIcon: null_mut(),
            hCursor: null_mut(),
            hbrBackground: null_mut(),
            lpszMenuName: null(),
            lpszClassName: class_name.as_ptr(),
        };
        let _ = RegisterClassW(&window_class);
    }

    unsafe extern "system" fn wnd_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_ERASEBKGND => 1,
            WM_CLOSE => {
                let _ = DestroyWindow(hwnd);
                0
            }
            WM_DESTROY => {
                clear_paint_state(hwnd);
                0
            }
            WM_PAINT => {
                paint_surface(hwnd);
                0
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    unsafe fn paint_surface(hwnd: HWND) {
        let mut ps = PAINTSTRUCT::default();
        let hdc = BeginPaint(hwnd, &mut ps);
        let mut rect = RECT::default();
        let _ = GetClientRect(hwnd, &mut rect);

        let state = read_paint_state(hwnd);
        let background = CreateSolidBrush(rgb(18, 20, 24));
        let border = CreateSolidBrush(rgb(64, 72, 88));
        let _ = FillRect(hdc, &rect, background);
        match state {
            Some(surface_state) => match surface_state.content.as_ref() {
                Some(WorkbenchNativeSurfaceContent::Timeline(content)) => {
                    draw_timeline_surface(hdc, &rect, &surface_state, content);
                }
                Some(WorkbenchNativeSurfaceContent::Outliner(content)) => {
                    draw_outliner_surface(hdc, &rect, &surface_state, content);
                }
                None => draw_empty_surface(hdc, &rect, &surface_state),
            },
            None => draw_empty_surface(
                hdc,
                &rect,
                &SurfacePaintState {
                    region: WorkbenchNativeSurfaceRegion::Bottom,
                    title: String::from("Workbench"),
                    content: None,
                },
            ),
        }
        let _ = FrameRect(hdc, &rect, border);
        let _ = DeleteObject(background as _);
        let _ = DeleteObject(border as _);
        let _ = EndPaint(hwnd, &ps);
    }

    unsafe fn draw_empty_surface(hdc: HDC, rect: &RECT, state: &SurfacePaintState) {
        draw_header(hdc, rect, state.title.as_str(), None);
        let accent = match state.region {
            WorkbenchNativeSurfaceRegion::Bottom => rgb(59, 130, 246),
            WorkbenchNativeSurfaceRegion::Right => rgb(20, 184, 166),
        };
        fill_rect_color(
            hdc,
            &RECT {
                left: rect.left,
                top: rect.top,
                right: rect.left + 3,
                bottom: rect.bottom,
            },
            accent,
        );
    }

    unsafe fn draw_timeline_surface(
        hdc: HDC,
        rect: &RECT,
        state: &SurfacePaintState,
        content: &WorkbenchNativeTimelineContent,
    ) {
        let title = if content.title.trim().is_empty() {
            state.title.as_str()
        } else {
            content.title.as_str()
        };
        draw_header(hdc, rect, title, content.track_label.as_deref());

        let width = rect_width(rect).max(1);
        let height = rect_height(rect).max(1);
        let duration_ms = effective_timeline_duration_ms(
            content.duration_ms,
            content.playhead_ms,
            content.clip_range.as_ref(),
            content.loop_range.as_ref(),
        );
        let header_bottom = rect.top + 34;
        let track_left = rect.left + 20;
        let track_right = rect.right - 20;
        let track_width = (track_right - track_left).max(1);
        let track_y = (header_bottom + ((height - 34) / 2)).max(header_bottom + 36);
        let track_height = 8;

        fill_rect_color(
            hdc,
            &RECT {
                left: track_left,
                top: track_y,
                right: track_right,
                bottom: track_y + track_height,
            },
            rgb(43, 49, 60),
        );

        if let Some(range) = content.clip_range.as_ref() {
            draw_time_range(
                hdc,
                range,
                duration_ms,
                track_left,
                track_width,
                track_y - 2,
                12,
                rgb(59, 130, 246),
            );
        }
        if let Some(range) = content.loop_range.as_ref() {
            draw_time_range(
                hdc,
                range,
                duration_ms,
                track_left,
                track_width,
                track_y - 16,
                4,
                rgb(20, 184, 166),
            );
        }

        for marker in content.markers.iter().take(24) {
            let x = time_to_x(marker.time_ms, duration_ms, track_left, track_width);
            draw_line(
                hdc,
                x,
                header_bottom + 10,
                x,
                rect.bottom - 24,
                rgb(148, 163, 184),
                1,
            );
            draw_text_line(
                hdc,
                marker.label.as_str(),
                &RECT {
                    left: x + 4,
                    top: header_bottom + 8,
                    right: (x + 86).min(rect.right - 10),
                    bottom: header_bottom + 28,
                },
                rgb(148, 163, 184),
                DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS,
            );
        }

        for tick in 0..=4 {
            let x = track_left + ((track_width as f64) * (tick as f64 / 4.0)).round() as i32;
            draw_line(hdc, x, track_y + 14, x, track_y + 22, rgb(71, 85, 105), 1);
        }

        let playhead_x = time_to_x(content.playhead_ms, duration_ms, track_left, track_width);
        draw_line(
            hdc,
            playhead_x,
            header_bottom + 8,
            playhead_x,
            rect.bottom - 24,
            rgb(245, 158, 11),
            2,
        );
        fill_rect_color(
            hdc,
            &RECT {
                left: playhead_x - 4,
                top: track_y - 8,
                right: playhead_x + 4,
                bottom: track_y,
            },
            rgb(245, 158, 11),
        );

        draw_text_line(
            hdc,
            format_time_ms(0.0).as_str(),
            &RECT {
                left: track_left,
                top: rect.bottom - 22,
                right: track_left + 90,
                bottom: rect.bottom - 4,
            },
            rgb(148, 163, 184),
            DT_LEFT | DT_SINGLELINE | DT_VCENTER,
        );
        draw_text_line(
            hdc,
            format_time_ms(duration_ms).as_str(),
            &RECT {
                left: track_right - 100,
                top: rect.bottom - 22,
                right: track_right,
                bottom: rect.bottom - 4,
            },
            rgb(148, 163, 184),
            DT_RIGHT | DT_SINGLELINE | DT_VCENTER,
        );
        draw_text_line(
            hdc,
            format_time_ms(content.playhead_ms).as_str(),
            &RECT {
                left: (playhead_x - 48).clamp(rect.left + 8, rect.right - 104),
                top: header_bottom + 8,
                right: (playhead_x + 52).clamp(rect.left + 108, rect.right - 8),
                bottom: header_bottom + 30,
            },
            rgb(255, 237, 213),
            DT_LEFT | DT_SINGLELINE | DT_VCENTER,
        );

        let grid_top = (track_y + 34).min(rect.bottom - 30);
        let row_height = 18;
        for row in 0..2 {
            let y = grid_top + row * row_height;
            if y >= rect.bottom - 28 {
                break;
            }
            fill_rect_color(
                hdc,
                &RECT {
                    left: rect.left + 16,
                    top: y,
                    right: rect.left + width - 16,
                    bottom: y + 1,
                },
                rgb(31, 37, 46),
            );
        }
    }

    unsafe fn draw_outliner_surface(
        hdc: HDC,
        rect: &RECT,
        state: &SurfacePaintState,
        content: &WorkbenchNativeOutlinerContent,
    ) {
        let title = if content.title.trim().is_empty() {
            state.title.as_str()
        } else {
            content.title.as_str()
        };
        let count_label = format!("{} items", content.items.len());
        draw_header(hdc, rect, title, Some(count_label.as_str()));

        let selected_ids: std::collections::HashSet<&str> =
            content.selected_ids.iter().map(String::as_str).collect();
        let row_height = 28;
        let top = rect.top + 38;
        let max_rows = ((rect_height(rect) - 42) / row_height).max(0) as usize;
        for (index, item) in content.items.iter().take(max_rows).enumerate() {
            let row_top = top + index as i32 * row_height;
            let row_rect = RECT {
                left: rect.left + 8,
                top: row_top,
                right: rect.right - 8,
                bottom: row_top + row_height - 2,
            };
            let selected = item.selected || selected_ids.contains(item.id.as_str());
            if selected {
                fill_rect_color(hdc, &row_rect, rgb(30, 64, 99));
            } else if index % 2 == 1 {
                fill_rect_color(hdc, &row_rect, rgb(22, 25, 31));
            }

            let depth = (item.depth.min(5) as i32) * 14;
            let dot = RECT {
                left: row_rect.left + 10 + depth,
                top: row_rect.top + 9,
                right: row_rect.left + 18 + depth,
                bottom: row_rect.top + 17,
            };
            fill_rect_color(
                hdc,
                &dot,
                if item.visible {
                    rgb(34, 197, 94)
                } else {
                    rgb(71, 85, 105)
                },
            );

            draw_text_line(
                hdc,
                item.label.as_str(),
                &RECT {
                    left: row_rect.left + 30 + depth,
                    top: row_rect.top,
                    right: row_rect.right - 72,
                    bottom: row_rect.bottom,
                },
                if item.visible {
                    rgb(226, 232, 240)
                } else {
                    rgb(100, 116, 139)
                },
                DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS,
            );
            draw_text_line(
                hdc,
                item.kind.as_str(),
                &RECT {
                    left: row_rect.right - 72,
                    top: row_rect.top,
                    right: row_rect.right - 10,
                    bottom: row_rect.bottom,
                },
                rgb(148, 163, 184),
                DT_RIGHT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS,
            );
        }
    }

    unsafe fn draw_header(hdc: HDC, rect: &RECT, title: &str, detail: Option<&str>) {
        let header_rect = RECT {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.top + 34,
        };
        fill_rect_color(hdc, &header_rect, rgb(24, 28, 35));
        draw_text_line(
            hdc,
            title,
            &RECT {
                left: rect.left + 12,
                top: rect.top,
                right: rect.right - 86,
                bottom: rect.top + 34,
            },
            rgb(241, 245, 249),
            DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS,
        );
        if let Some(detail) = detail.filter(|value| !value.trim().is_empty()) {
            draw_text_line(
                hdc,
                detail,
                &RECT {
                    left: rect.right - 168,
                    top: rect.top,
                    right: rect.right - 12,
                    bottom: rect.top + 34,
                },
                rgb(148, 163, 184),
                DT_RIGHT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS,
            );
        }
    }

    unsafe fn draw_time_range(
        hdc: HDC,
        range: &WorkbenchNativeTimeRange,
        duration_ms: f64,
        track_left: i32,
        track_width: i32,
        top: i32,
        height: i32,
        color: u32,
    ) {
        let start_x = time_to_x(range.start_ms, duration_ms, track_left, track_width);
        let end_x = time_to_x(range.end_ms, duration_ms, track_left, track_width).max(start_x + 1);
        fill_rect_color(
            hdc,
            &RECT {
                left: start_x,
                top,
                right: end_x,
                bottom: top + height,
            },
            color,
        );
    }

    unsafe fn draw_text_line(hdc: HDC, text: &str, rect: &RECT, color: u32, format: u32) {
        if text.is_empty() || rect.right <= rect.left || rect.bottom <= rect.top {
            return;
        }
        let _ = SetBkMode(hdc, TRANSPARENT as i32);
        let _ = SetTextColor(hdc, color);
        let mut text_rect = *rect;
        let wide = to_wide(text);
        let _ = DrawTextW(hdc, wide.as_ptr(), -1, &mut text_rect, format);
    }

    unsafe fn draw_line(hdc: HDC, x1: i32, y1: i32, x2: i32, y2: i32, color: u32, width: i32) {
        let pen = CreatePen(PS_SOLID, width.max(1), color);
        if pen.is_null() {
            return;
        }
        let previous = SelectObject(hdc, pen as _);
        let _ = MoveToEx(hdc, x1, y1, null_mut());
        let _ = LineTo(hdc, x2, y2);
        if !previous.is_null() {
            let _ = SelectObject(hdc, previous);
        }
        let _ = DeleteObject(pen as _);
    }

    unsafe fn fill_rect_color(hdc: HDC, rect: &RECT, color: u32) {
        if rect.right <= rect.left || rect.bottom <= rect.top {
            return;
        }
        let brush: HBRUSH = CreateSolidBrush(color);
        let _ = FillRect(hdc, rect, brush);
        let _ = DeleteObject(brush as _);
    }

    fn time_to_x(time_ms: f64, duration_ms: f64, track_left: i32, track_width: i32) -> i32 {
        let ratio = clamp_timeline_ratio(time_ms, duration_ms);
        track_left + ((track_width.max(1) as f64) * ratio).round() as i32
    }

    fn rect_width(rect: &RECT) -> i32 {
        rect.right.saturating_sub(rect.left)
    }

    fn rect_height(rect: &RECT) -> i32 {
        rect.bottom.saturating_sub(rect.top)
    }

    fn format_time_ms(value: f64) -> String {
        let safe_ms = if value.is_finite() && value > 0.0 {
            value
        } else {
            0.0
        };
        let total_seconds = (safe_ms / 1_000.0).floor() as u64;
        let minutes = total_seconds / 60;
        let seconds = total_seconds % 60;
        let centiseconds = ((safe_ms % 1_000.0) / 10.0).floor() as u64;
        format!("{minutes:02}:{seconds:02}.{centiseconds:02}")
    }

    fn process_pending_window_messages() {
        unsafe {
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg, null_mut(), 0, 0, PM_REMOVE) != 0 {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }

    fn to_wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    const fn rgb(red: u8, green: u8, blue: u8) -> u32 {
        red as u32 | ((green as u32) << 8) | ((blue as u32) << 16)
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::{NativeMainBounds, WorkbenchNativeSurfaceConfig, WorkbenchNativeSurfaceContent};

    pub fn open_surface(
        _config: WorkbenchNativeSurfaceConfig,
        _main_bounds: NativeMainBounds,
    ) -> Result<(), String> {
        Err("Workbench native surfaces are only implemented on Windows for this spike".to_string())
    }

    pub fn sync_geometry(_main_bounds: NativeMainBounds) -> Result<(), String> {
        Err("Workbench native surfaces are only implemented on Windows for this spike".to_string())
    }

    pub fn close_surface(_surface_id: String) -> Result<(), String> {
        Ok(())
    }

    pub fn update_surface_content(
        _surface_id: String,
        _content: WorkbenchNativeSurfaceContent,
    ) -> Result<(), String> {
        Ok(())
    }

    pub fn close_all_surfaces() -> Result<(), String> {
        Ok(())
    }
}

pub fn open_surface(app: &AppHandle, config: WorkbenchNativeSurfaceConfig) -> Result<(), String> {
    if !is_safe_surface_id(config.surface_id.as_str()) {
        return Err(format!(
            "Invalid workbench native surface id: {}",
            config.surface_id
        ));
    }

    let main_bounds = resolve_main_bounds(app)?;
    platform::open_surface(config, main_bounds)?;
    crate::backend_telemetry::info(
        app,
        "windowing",
        "window.workbench-native-surface.opened",
        crate::backend_telemetry::BackendTelemetryOptions::new()
            .component("workbench_native_surface")
            .field("surfaceCount", serde_json::json!(1)),
    );
    Ok(())
}

pub fn sync_geometry(app: &AppHandle) -> Result<(), String> {
    let main_bounds = resolve_main_bounds(app)?;
    platform::sync_geometry(main_bounds)
}

pub fn update_surface_content(
    surface_id: String,
    content: serde_json::Value,
) -> Result<(), String> {
    if !is_safe_surface_id(surface_id.as_str()) {
        return Ok(());
    }

    let parsed = serde_json::from_value::<WorkbenchNativeSurfaceContent>(content)
        .map_err(|error| format!("Invalid workbench native surface content: {}", error))?;
    platform::update_surface_content(surface_id, parsed)
}

pub fn close_surface(surface_id: String) -> Result<(), String> {
    if !is_safe_surface_id(surface_id.as_str()) {
        return Ok(());
    }
    platform::close_surface(surface_id)
}

pub fn close_all_surfaces() -> Result<(), String> {
    platform::close_all_surfaces()
}

#[cfg(test)]
mod tests {
    use super::{
        clamp_timeline_ratio, compute_surface_rect, effective_timeline_duration_ms,
        NativeMainBounds, WorkbenchNativeSurfaceContent, WorkbenchNativeSurfaceRegion,
        WorkbenchNativeTimeRange,
    };

    fn main_bounds() -> NativeMainBounds {
        NativeMainBounds {
            x: 100,
            y: 200,
            width: 900,
            height: 600,
            scale_factor: 1.5,
            owner_hwnd: 1,
        }
    }

    #[test]
    fn bottom_surface_uses_main_width_and_sits_below_main_window() {
        let rect = compute_surface_rect(
            main_bounds(),
            WorkbenchNativeSurfaceRegion::Bottom,
            300.0,
            200.0,
        );

        assert_eq!(
            rect,
            super::NativeSurfaceRect {
                x: 100,
                y: 800,
                width: 900,
                height: 300,
            }
        );
    }

    #[test]
    fn right_surface_uses_main_height_and_sits_right_of_main_window() {
        let rect = compute_surface_rect(
            main_bounds(),
            WorkbenchNativeSurfaceRegion::Right,
            320.0,
            200.0,
        );

        assert_eq!(
            rect,
            super::NativeSurfaceRect {
                x: 1000,
                y: 200,
                width: 480,
                height: 600,
            }
        );
    }

    #[test]
    fn content_protocol_deserializes_timeline_payload() {
        let content: WorkbenchNativeSurfaceContent = serde_json::from_value(serde_json::json!({
            "kind": "timeline",
            "protocolVersion": 1,
            "title": "Timeline",
            "trackLabel": "Track",
            "durationMs": 120000.0,
            "playheadMs": 42000.0,
            "clipRange": { "startMs": 1000.0, "endMs": 60000.0 },
            "loopRange": null,
            "markers": [{ "id": "m1", "label": "A", "timeMs": 5000.0 }]
        }))
        .expect("timeline content should deserialize");

        match content {
            WorkbenchNativeSurfaceContent::Timeline(timeline) => {
                assert_eq!(timeline.protocol_version, 1);
                assert_eq!(timeline.title, "Timeline");
                assert_eq!(timeline.markers.len(), 1);
                assert_eq!(
                    timeline.clip_range,
                    Some(WorkbenchNativeTimeRange {
                        start_ms: 1000.0,
                        end_ms: 60000.0,
                    })
                );
            }
            _ => panic!("expected timeline content"),
        }
    }

    #[test]
    fn timeline_ratios_are_clamped_to_visible_track() {
        assert_eq!(clamp_timeline_ratio(-10.0, 100.0), 0.0);
        assert_eq!(clamp_timeline_ratio(150.0, 100.0), 1.0);
        assert_eq!(
            effective_timeline_duration_ms(
                100.0,
                120.0,
                Some(&WorkbenchNativeTimeRange {
                    start_ms: 0.0,
                    end_ms: 160.0,
                }),
                None,
            ),
            160.0
        );
    }
}
