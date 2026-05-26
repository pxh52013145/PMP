use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::MAIN_WINDOW_LABEL;

const EVENT_WORKBENCH_NATIVE_SURFACE_INPUT: &str = "workbench-native-surface-event";

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

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
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

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WorkbenchNativeSurfaceInputEvent {
    #[serde(rename = "timeline.seek", rename_all = "camelCase")]
    TimelineSeek {
        surface_id: String,
        playhead_ms: f64,
    },
    #[serde(rename = "timeline.clip.set", rename_all = "camelCase")]
    TimelineClipSet {
        surface_id: String,
        range: WorkbenchNativeTimeRange,
        is_final: bool,
    },
    #[serde(rename = "timeline.loop.set", rename_all = "camelCase")]
    TimelineLoopSet {
        surface_id: String,
        range: WorkbenchNativeTimeRange,
        is_final: bool,
    },
    #[serde(rename = "outliner.select", rename_all = "camelCase")]
    OutlinerSelect { surface_id: String, item_id: String },
    #[serde(rename = "outliner.visibility.toggle", rename_all = "camelCase")]
    OutlinerVisibilityToggle { surface_id: String, item_id: String },
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

pub fn choose_timeline_tick_step_ms(duration_ms: f64, track_width: i32) -> f64 {
    const STEPS_MS: [f64; 14] = [
        1_000.0,
        2_000.0,
        5_000.0,
        10_000.0,
        15_000.0,
        30_000.0,
        60_000.0,
        120_000.0,
        300_000.0,
        600_000.0,
        900_000.0,
        1_800_000.0,
        3_600_000.0,
        7_200_000.0,
    ];

    let safe_duration = if duration_ms.is_finite() && duration_ms > 0.0 {
        duration_ms
    } else {
        1.0
    };
    let target_ticks = ((track_width.max(1) as f64) / 110.0).clamp(2.0, 8.0);
    let raw_step = safe_duration / target_ticks;
    STEPS_MS
        .iter()
        .copied()
        .find(|step| *step >= raw_step)
        .unwrap_or(*STEPS_MS.last().unwrap_or(&7_200_000.0))
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

pub fn clamp_surface_rect_to_bounds(
    rect: NativeSurfaceRect,
    bounds: NativeSurfaceRect,
) -> NativeSurfaceRect {
    let max_width = bounds.width.max(1);
    let max_height = bounds.height.max(1);
    let width = rect.width.clamp(1, max_width);
    let height = rect.height.clamp(1, max_height);
    let min_x = bounds.x;
    let min_y = bounds.y;
    let max_x = bounds.x.saturating_add(max_width).saturating_sub(width);
    let max_y = bounds.y.saturating_add(max_height).saturating_sub(height);

    NativeSurfaceRect {
        x: rect.x.clamp(min_x, max_x),
        y: rect.y.clamp(min_y, max_y),
        width,
        height,
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
        choose_timeline_tick_step_ms, clamp_surface_rect_to_bounds, clamp_timeline_ratio,
        compute_surface_rect, effective_timeline_duration_ms, NativeMainBounds, NativeSurfaceRect,
        WorkbenchNativeOutlinerContent, WorkbenchNativeSurfaceConfig,
        WorkbenchNativeSurfaceContent, WorkbenchNativeSurfaceInputEvent,
        WorkbenchNativeSurfaceRegion, WorkbenchNativeTimeRange, WorkbenchNativeTimelineContent,
        EVENT_WORKBENCH_NATIVE_SURFACE_INPUT, MAIN_WINDOW_LABEL,
    };
    use once_cell::sync::OnceCell;
    use std::{
        collections::HashMap,
        mem::size_of,
        ptr::{null, null_mut},
        sync::{
            mpsc::{self, Receiver, Sender},
            Mutex,
        },
        thread,
        time::Duration,
    };
    use tauri::{AppHandle, Manager};
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
        Graphics::Gdi::{
            BeginPaint, CreatePen, CreateSolidBrush, DeleteObject, DrawTextW, EndPaint, FillRect,
            GetMonitorInfoW, InvalidateRect, LineTo, MonitorFromWindow, MoveToEx, SelectObject,
            SetBkMode, SetTextColor, DT_END_ELLIPSIS, DT_LEFT, DT_SINGLELINE, DT_VCENTER, HBRUSH,
            HDC, MONITORINFO, MONITOR_DEFAULTTONEAREST, PAINTSTRUCT, PS_SOLID, TRANSPARENT,
        },
        UI::Input::KeyboardAndMouse::{ReleaseCapture, SetCapture},
        UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetClientRect,
            PeekMessageW, RegisterClassW, SendMessageW, SetWindowPos, ShowWindow, TranslateMessage,
            CS_HREDRAW, CS_VREDRAW, HTCAPTION, MSG, PM_REMOVE, SWP_NOACTIVATE, SWP_NOOWNERZORDER,
            SWP_SHOWWINDOW, SW_SHOWNOACTIVATE, WM_CLOSE, WM_DESTROY, WM_ERASEBKGND, WM_LBUTTONDOWN,
            WM_LBUTTONUP, WM_MOUSEMOVE, WM_NCLBUTTONDOWN, WM_PAINT, WNDCLASSW, WS_EX_NOACTIVATE,
            WS_EX_TOOLWINDOW, WS_POPUP,
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
        surface_id: String,
        region: WorkbenchNativeSurfaceRegion,
        content: Option<WorkbenchNativeSurfaceContent>,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum TimelineDragKind {
        Clip,
        Loop,
    }

    #[derive(Debug, Clone, Copy)]
    struct TimelineDragState {
        kind: TimelineDragKind,
        start_ms: f64,
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
    static DRAG_STATE: OnceCell<Mutex<HashMap<isize, TimelineDragState>>> = OnceCell::new();
    static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();

    pub fn open_surface(
        app: &AppHandle,
        config: WorkbenchNativeSurfaceConfig,
        main_bounds: NativeMainBounds,
    ) -> Result<(), String> {
        let _ = APP_HANDLE.set(app.clone());
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

    fn drag_state_store() -> &'static Mutex<HashMap<isize, TimelineDragState>> {
        DRAG_STATE.get_or_init(|| Mutex::new(HashMap::new()))
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
                    surface_id: spec.surface_id.clone(),
                    region: spec.region,
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
        if let Ok(mut state) = drag_state_store().lock() {
            state.remove(&hwnd_key(hwnd));
        }
    }

    fn emit_surface_event(event: WorkbenchNativeSurfaceInputEvent) {
        let Some(app) = APP_HANDLE.get() else {
            return;
        };
        let _ = app.emit_to(
            MAIN_WINDOW_LABEL,
            EVENT_WORKBENCH_NATIVE_SURFACE_INPUT,
            event,
        );
    }

    unsafe fn handle_surface_pointer_down(hwnd: HWND, lparam: LPARAM) {
        let Some(state) = read_paint_state(hwnd) else {
            return;
        };
        let mut rect = RECT::default();
        let _ = GetClientRect(hwnd, &mut rect);
        let x = lparam_x(lparam);
        let y = lparam_y(lparam);

        if is_surface_header_point(&rect, x, y) {
            begin_surface_drag(hwnd);
            return;
        }

        let Some(content) = state.content.as_ref() else {
            return;
        };
        let surface_id = state.surface_id.clone();

        match content {
            WorkbenchNativeSurfaceContent::Timeline(content) => {
                if let Some((kind, start_ms)) = timeline_drag_from_point(&rect, content, x, y) {
                    if let Ok(mut state) = drag_state_store().lock() {
                        state.insert(hwnd_key(hwnd), TimelineDragState { kind, start_ms });
                    }
                    let _ = SetCapture(hwnd);
                    emit_timeline_range_event(surface_id, kind, start_ms, start_ms, false);
                    return;
                }

                let Some(playhead_ms) = timeline_seek_from_point(&rect, content, x, y) else {
                    return;
                };
                emit_surface_event(WorkbenchNativeSurfaceInputEvent::TimelineSeek {
                    surface_id,
                    playhead_ms,
                });
            }
            WorkbenchNativeSurfaceContent::Outliner(content) => {
                if let Some(item_id) = outliner_visibility_item_from_point(&rect, content, x, y) {
                    emit_surface_event(
                        WorkbenchNativeSurfaceInputEvent::OutlinerVisibilityToggle {
                            surface_id,
                            item_id,
                        },
                    );
                    return;
                }

                let Some(item_id) = outliner_item_from_point(&rect, content, x, y) else {
                    return;
                };
                emit_surface_event(WorkbenchNativeSurfaceInputEvent::OutlinerSelect {
                    surface_id,
                    item_id,
                });
            }
        }
    }

    unsafe fn begin_surface_drag(hwnd: HWND) {
        let _ = ReleaseCapture();
        let _ = SendMessageW(hwnd, WM_NCLBUTTONDOWN, HTCAPTION as WPARAM, 0);
    }

    fn is_surface_header_point(rect: &RECT, x: i32, y: i32) -> bool {
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.top + 22
    }

    unsafe fn handle_surface_pointer_move(hwnd: HWND, lparam: LPARAM) {
        let drag = drag_state_store()
            .lock()
            .ok()
            .and_then(|state| state.get(&hwnd_key(hwnd)).copied());
        let Some(drag) = drag else {
            return;
        };
        emit_timeline_drag_update(hwnd, lparam, drag, false);
    }

    unsafe fn handle_surface_pointer_up(hwnd: HWND, lparam: LPARAM) {
        let drag = drag_state_store()
            .lock()
            .ok()
            .and_then(|mut state| state.remove(&hwnd_key(hwnd)));
        let Some(drag) = drag else {
            return;
        };
        let _ = ReleaseCapture();
        emit_timeline_drag_update(hwnd, lparam, drag, true);
    }

    unsafe fn emit_timeline_drag_update(
        hwnd: HWND,
        lparam: LPARAM,
        drag: TimelineDragState,
        is_final: bool,
    ) {
        let Some(state) = read_paint_state(hwnd) else {
            return;
        };
        let Some(WorkbenchNativeSurfaceContent::Timeline(content)) = state.content.as_ref() else {
            return;
        };
        let mut rect = RECT::default();
        let _ = GetClientRect(hwnd, &mut rect);
        let x = lparam_x(lparam);
        let end_ms = timeline_time_from_x(&rect, content, x);
        emit_timeline_range_event(state.surface_id, drag.kind, drag.start_ms, end_ms, is_final);
    }

    fn emit_timeline_range_event(
        surface_id: String,
        kind: TimelineDragKind,
        start_ms: f64,
        end_ms: f64,
        is_final: bool,
    ) {
        let range = WorkbenchNativeTimeRange {
            start_ms: start_ms.min(end_ms),
            end_ms: start_ms.max(end_ms),
        };
        match kind {
            TimelineDragKind::Clip => {
                emit_surface_event(WorkbenchNativeSurfaceInputEvent::TimelineClipSet {
                    surface_id,
                    range,
                    is_final,
                });
            }
            TimelineDragKind::Loop => {
                emit_surface_event(WorkbenchNativeSurfaceInputEvent::TimelineLoopSet {
                    surface_id,
                    range,
                    is_final,
                });
            }
        }
    }

    fn timeline_seek_from_point(
        rect: &RECT,
        content: &WorkbenchNativeTimelineContent,
        x: i32,
        y: i32,
    ) -> Option<f64> {
        let (_, track_left, track_right, _, interactive_top, interactive_bottom) =
            timeline_metrics(rect);
        if x < track_left || x > track_right || y < interactive_top || y > interactive_bottom {
            return None;
        }
        Some(timeline_time_from_x(rect, content, x))
    }

    fn timeline_drag_from_point(
        rect: &RECT,
        content: &WorkbenchNativeTimelineContent,
        x: i32,
        y: i32,
    ) -> Option<(TimelineDragKind, f64)> {
        let (_, track_left, track_right, _, _, _) = timeline_metrics(rect);
        if x < track_left || x > track_right {
            return None;
        }
        let (clip_lane, loop_lane) = timeline_lane_rects(rect);
        let kind = if y >= clip_lane.top && y <= clip_lane.bottom {
            TimelineDragKind::Clip
        } else if y >= loop_lane.top && y <= loop_lane.bottom {
            TimelineDragKind::Loop
        } else {
            return None;
        };
        Some((kind, timeline_time_from_x(rect, content, x)))
    }

    fn timeline_time_from_x(rect: &RECT, content: &WorkbenchNativeTimelineContent, x: i32) -> f64 {
        let (_, track_left, _, track_width, _, _) = timeline_metrics(rect);
        let duration_ms = effective_timeline_duration_ms(
            content.duration_ms,
            content.playhead_ms,
            content.clip_range.as_ref(),
            content.loop_range.as_ref(),
        );
        let ratio = ((x - track_left) as f64 / track_width.max(1) as f64).clamp(0.0, 1.0);
        duration_ms * ratio
    }

    fn outliner_item_from_point(
        rect: &RECT,
        content: &WorkbenchNativeOutlinerContent,
        x: i32,
        y: i32,
    ) -> Option<String> {
        let row_height = 26;
        let top = rect.top + 24;
        if x < rect.left + 8 || x > rect.right - 8 || y < top {
            return None;
        }
        let index = ((y - top) / row_height) as usize;
        content.items.get(index).map(|item| item.id.clone())
    }

    fn outliner_visibility_item_from_point(
        rect: &RECT,
        content: &WorkbenchNativeOutlinerContent,
        x: i32,
        y: i32,
    ) -> Option<String> {
        let index = outliner_row_index_from_point(rect, content, x, y)?;
        let row_top = rect.top + 24 + index as i32 * 26;
        let visibility = RECT {
            left: rect.right - 36,
            top: row_top + 6,
            right: rect.right - 20,
            bottom: row_top + 20,
        };
        if x < visibility.left
            || x > visibility.right
            || y < visibility.top
            || y > visibility.bottom
        {
            return None;
        }
        content.items.get(index).map(|item| item.id.clone())
    }

    fn outliner_row_index_from_point(
        rect: &RECT,
        content: &WorkbenchNativeOutlinerContent,
        x: i32,
        y: i32,
    ) -> Option<usize> {
        let row_height = 26;
        let top = rect.top + 24;
        if x < rect.left + 8 || x > rect.right - 8 || y < top {
            return None;
        }
        let index = ((y - top) / row_height) as usize;
        if index >= content.items.len() {
            return None;
        }
        Some(index)
    }

    fn timeline_metrics(rect: &RECT) -> (i32, i32, i32, i32, i32, i32) {
        let header_bottom = rect.top + 18;
        let track_left = rect.left + 18;
        let track_right = rect.right - 18;
        let track_width = (track_right - track_left).max(1);
        let min_track_y = header_bottom + 34;
        let max_track_y = (rect.bottom - 18).max(min_track_y);
        let track_y = (rect.bottom - 30).clamp(min_track_y, max_track_y);
        let interactive_top = header_bottom;
        let interactive_bottom = rect.bottom - 8;
        (
            track_y,
            track_left,
            track_right,
            track_width,
            interactive_top,
            interactive_bottom,
        )
    }

    fn timeline_lane_rects(rect: &RECT) -> (RECT, RECT) {
        let (_, track_left, track_right, _, _, _) = timeline_metrics(rect);
        let ruler_top = rect.top + 24;
        let ruler_bottom = ruler_top + 26;
        let clip_lane = RECT {
            left: track_left,
            top: ruler_bottom + 8,
            right: track_right,
            bottom: ruler_bottom + 20,
        };
        let loop_lane = RECT {
            left: track_left,
            top: clip_lane.bottom + 5,
            right: track_right,
            bottom: clip_lane.bottom + 17,
        };
        (clip_lane, loop_lane)
    }

    fn lparam_x(lparam: LPARAM) -> i32 {
        (lparam as u32 & 0xffff) as i16 as i32
    }

    fn lparam_y(lparam: LPARAM) -> i32 {
        ((lparam as u32 >> 16) & 0xffff) as i16 as i32
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
        let rect = resolve_visible_surface_rect(main_bounds, spec);
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

    fn resolve_visible_surface_rect(
        main_bounds: NativeMainBounds,
        spec: &SurfaceSpec,
    ) -> NativeSurfaceRect {
        let rect = compute_surface_rect(main_bounds, spec.region, spec.width, spec.height);
        monitor_work_rect(main_bounds.owner_hwnd)
            .map(|bounds| clamp_surface_rect_to_bounds(rect, bounds))
            .unwrap_or(rect)
    }

    fn monitor_work_rect(owner_hwnd: isize) -> Option<NativeSurfaceRect> {
        unsafe {
            let monitor = MonitorFromWindow(owner_hwnd as HWND, MONITOR_DEFAULTTONEAREST);
            if monitor.is_null() {
                return None;
            }

            let mut info = MONITORINFO {
                cbSize: size_of::<MONITORINFO>() as u32,
                rcMonitor: RECT::default(),
                rcWork: RECT::default(),
                dwFlags: 0,
            };
            if GetMonitorInfoW(monitor, &mut info) == 0 {
                return None;
            }

            let work = info.rcWork;
            Some(NativeSurfaceRect {
                x: work.left,
                y: work.top,
                width: (work.right - work.left).max(1),
                height: (work.bottom - work.top).max(1),
            })
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
            WM_LBUTTONDOWN => {
                handle_surface_pointer_down(hwnd, lparam);
                0
            }
            WM_MOUSEMOVE => {
                handle_surface_pointer_move(hwnd, lparam);
                0
            }
            WM_LBUTTONUP => {
                handle_surface_pointer_up(hwnd, lparam);
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
        let background = CreateSolidBrush(rgb(2, 8, 10));
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
                    surface_id: String::from("unknown"),
                    region: WorkbenchNativeSurfaceRegion::Bottom,
                    content: None,
                },
            ),
        }
        draw_panel_chrome(hdc, &rect);
        let _ = DeleteObject(background as _);
        let _ = EndPaint(hwnd, &ps);
    }

    unsafe fn draw_empty_surface(hdc: HDC, rect: &RECT, state: &SurfacePaintState) {
        draw_header(hdc, rect);
        let accent = match state.region {
            WorkbenchNativeSurfaceRegion::Bottom => rgb(210, 210, 210),
            WorkbenchNativeSurfaceRegion::Right => rgb(210, 210, 210),
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
        let _ = state;
        draw_header(hdc, rect);

        let duration_ms = effective_timeline_duration_ms(
            content.duration_ms,
            content.playhead_ms,
            content.clip_range.as_ref(),
            content.loop_range.as_ref(),
        );
        let (track_y, track_left, track_right, track_width, _, _) = timeline_metrics(rect);
        let track_height = 4;
        let ruler_top = rect.top + 24;
        let ruler_bottom = ruler_top + 26;
        let (clip_lane, loop_lane) = timeline_lane_rects(rect);

        draw_timeline_ruler(hdc, rect, duration_ms, track_left, track_right, track_width);

        fill_rect_color(hdc, &clip_lane, rgb(14, 14, 14));
        fill_rect_color(hdc, &loop_lane, rgb(12, 12, 12));
        draw_lane_edge(hdc, &clip_lane, rgb(68, 68, 68));
        draw_lane_edge(hdc, &loop_lane, rgb(52, 52, 52));

        fill_rect_color(
            hdc,
            &RECT {
                left: track_left,
                top: track_y,
                right: track_right,
                bottom: track_y + track_height,
            },
            rgb(42, 42, 42),
        );

        if let Some(range) = content.clip_range.as_ref() {
            draw_time_range(
                hdc,
                range,
                duration_ms,
                track_left,
                track_width,
                clip_lane.top + 3,
                rect_height(&clip_lane) - 6,
                rgb(225, 225, 225),
            );
        }
        if let Some(range) = content.loop_range.as_ref() {
            draw_time_range(
                hdc,
                range,
                duration_ms,
                track_left,
                track_width,
                loop_lane.top + 3,
                rect_height(&loop_lane) - 6,
                rgb(126, 126, 126),
            );
        }

        for marker in content.markers.iter().take(24) {
            let x = time_to_x(marker.time_ms, duration_ms, track_left, track_width);
            draw_glow_line(
                hdc,
                x,
                ruler_top + 2,
                x,
                rect.bottom - 12,
                rgb(210, 210, 210),
            );
            fill_rect_color(
                hdc,
                &RECT {
                    left: x - 2,
                    top: ruler_bottom - 2,
                    right: x + 3,
                    bottom: ruler_bottom + 3,
                },
                rgb(235, 235, 235),
            );
        }

        let playhead_x = time_to_x(content.playhead_ms, duration_ms, track_left, track_width);
        draw_glow_line(
            hdc,
            playhead_x,
            rect.top + 18,
            playhead_x,
            rect.bottom - 10,
            rgb(255, 114, 82),
        );
        fill_rect_color(
            hdc,
            &RECT {
                left: playhead_x - 3,
                top: track_y - 7,
                right: playhead_x + 4,
                bottom: track_y,
            },
            rgb(255, 114, 82),
        );
    }

    unsafe fn draw_timeline_ruler(
        hdc: HDC,
        rect: &RECT,
        duration_ms: f64,
        track_left: i32,
        track_right: i32,
        track_width: i32,
    ) {
        let ruler_top = rect.top + 24;
        let ruler_bottom = ruler_top + 26;
        let ruler_rect = RECT {
            left: track_left,
            top: ruler_top,
            right: track_right,
            bottom: ruler_bottom,
        };
        fill_rect_color(hdc, &ruler_rect, rgb(10, 10, 10));
        draw_lane_edge(hdc, &ruler_rect, rgb(54, 54, 54));

        let major_step = choose_timeline_tick_step_ms(duration_ms, track_width).max(1.0);
        let minor_step = (major_step / 4.0).max(1.0);
        let mut minor = 0.0;
        while minor <= duration_ms + 0.5 {
            let x = time_to_x(minor, duration_ms, track_left, track_width);
            let major_ratio = minor / major_step;
            let is_major = (major_ratio - major_ratio.round()).abs() < 0.001;
            if !is_major {
                draw_line(
                    hdc,
                    x,
                    ruler_bottom - 7,
                    x,
                    ruler_bottom - 2,
                    rgb(42, 42, 42),
                    1,
                );
            }
            minor += minor_step;
        }

        let mut tick = 0.0;
        while tick <= duration_ms + 0.5 {
            let x = time_to_x(tick, duration_ms, track_left, track_width);
            draw_line(
                hdc,
                x,
                ruler_top + 3,
                x,
                ruler_bottom - 2,
                rgb(96, 96, 96),
                1,
            );
            tick += major_step;
        }
    }

    unsafe fn draw_lane_edge(hdc: HDC, rect: &RECT, color: u32) {
        draw_line(hdc, rect.left, rect.top, rect.right, rect.top, color, 1);
        draw_line(
            hdc,
            rect.left,
            rect.bottom - 1,
            rect.right,
            rect.bottom - 1,
            color,
            1,
        );
    }

    unsafe fn draw_outliner_surface(
        hdc: HDC,
        rect: &RECT,
        state: &SurfacePaintState,
        content: &WorkbenchNativeOutlinerContent,
    ) {
        let _ = state;
        draw_header(hdc, rect);

        let selected_ids: std::collections::HashSet<&str> =
            content.selected_ids.iter().map(String::as_str).collect();
        let row_height = 26;
        let top = rect.top + 24;
        let max_rows = ((rect_height(rect) - 28) / row_height).max(0) as usize;
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
                fill_rect_color(hdc, &row_rect, rgb(24, 24, 24));
                draw_rect_outline(hdc, &row_rect, rgb(220, 220, 220), 1);
            } else if index % 2 == 1 {
                fill_rect_color(hdc, &row_rect, rgb(12, 12, 12));
            }

            let depth = (item.depth.min(5) as i32) * 14;
            for guide in 0..item.depth.min(5) {
                let x = row_rect.left + 14 + guide as i32 * 14;
                draw_line(
                    hdc,
                    x,
                    row_rect.top + 4,
                    x,
                    row_rect.bottom - 4,
                    rgb(44, 44, 44),
                    1,
                );
            }
            if item.kind == "scene" || item.kind == "group" {
                let branch_x = row_rect.left + 12 + depth;
                draw_line(
                    hdc,
                    branch_x,
                    row_rect.top + 10,
                    branch_x + 6,
                    row_rect.top + 14,
                    rgb(130, 130, 130),
                    1,
                );
                draw_line(
                    hdc,
                    branch_x,
                    row_rect.top + 18,
                    branch_x + 6,
                    row_rect.top + 14,
                    rgb(130, 130, 130),
                    1,
                );
            }

            let icon = RECT {
                left: row_rect.left + 24 + depth,
                top: row_rect.top + 7,
                right: row_rect.left + 38 + depth,
                bottom: row_rect.top + 21,
            };
            draw_outliner_kind_icon(hdc, &icon, item.kind.as_str(), item.visible);

            let visibility = RECT {
                left: row_rect.right - 28,
                top: row_rect.top + 6,
                right: row_rect.right - 12,
                bottom: row_rect.top + 20,
            };
            draw_visibility_indicator(hdc, &visibility, item.visible);

            if selected {
                fill_rect_color(
                    hdc,
                    &RECT {
                        left: row_rect.left,
                        top: row_rect.top,
                        right: row_rect.left + 3,
                        bottom: row_rect.bottom,
                    },
                    rgb(235, 235, 235),
                );
            }

            draw_text_line(
                hdc,
                item.label.as_str(),
                &RECT {
                    left: row_rect.left + 46 + depth,
                    top: row_rect.top,
                    right: row_rect.right - 42,
                    bottom: row_rect.bottom,
                },
                if item.visible {
                    rgb(214, 214, 214)
                } else {
                    rgb(88, 88, 88)
                },
                DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS,
            );
        }
    }

    unsafe fn draw_outliner_kind_icon(hdc: HDC, rect: &RECT, kind: &str, visible: bool) {
        let color = if visible {
            outliner_kind_color(kind)
        } else {
            rgb(72, 72, 72)
        };
        draw_rect_outline(hdc, rect, color, 1);
        fill_rect_color(
            hdc,
            &RECT {
                left: rect.left + 4,
                top: rect.top + 4,
                right: rect.right - 4,
                bottom: rect.bottom - 4,
            },
            if visible { color } else { rgb(72, 72, 72) },
        );
    }

    unsafe fn draw_visibility_indicator(hdc: HDC, rect: &RECT, visible: bool) {
        let color = if visible {
            rgb(176, 255, 218)
        } else {
            rgb(80, 80, 80)
        };
        if visible {
            draw_rect_outline(
                hdc,
                &RECT {
                    left: rect.left - 2,
                    top: rect.top - 2,
                    right: rect.right + 2,
                    bottom: rect.bottom + 2,
                },
                rgb(28, 64, 48),
                1,
            );
        }
        draw_line(
            hdc,
            rect.left + 2,
            rect.top + rect_height(rect) / 2,
            rect.left + rect_width(rect) / 2,
            rect.top + 3,
            color,
            1,
        );
        draw_line(
            hdc,
            rect.left + rect_width(rect) / 2,
            rect.top + 3,
            rect.right - 2,
            rect.top + rect_height(rect) / 2,
            color,
            1,
        );
        draw_line(
            hdc,
            rect.right - 2,
            rect.top + rect_height(rect) / 2,
            rect.left + rect_width(rect) / 2,
            rect.bottom - 3,
            color,
            1,
        );
        draw_line(
            hdc,
            rect.left + rect_width(rect) / 2,
            rect.bottom - 3,
            rect.left + 2,
            rect.top + rect_height(rect) / 2,
            color,
            1,
        );
        if !visible {
            draw_line(
                hdc,
                rect.left + 2,
                rect.bottom - 2,
                rect.right - 2,
                rect.top + 2,
                color,
                1,
            );
        }
    }

    fn outliner_kind_color(kind: &str) -> u32 {
        match kind {
            "scene" => rgb(218, 218, 218),
            "component" => rgb(154, 154, 154),
            "resource" => rgb(186, 186, 186),
            "clip" => rgb(210, 210, 210),
            "track" => rgb(170, 170, 170),
            "group" => rgb(128, 128, 128),
            _ => rgb(112, 112, 112),
        }
    }

    unsafe fn draw_header(hdc: HDC, rect: &RECT) {
        let header_rect = RECT {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.top + 22,
        };
        fill_rect_color(hdc, &header_rect, rgb(8, 8, 8));
        draw_line(
            hdc,
            header_rect.left,
            header_rect.bottom - 1,
            header_rect.right,
            header_rect.bottom - 1,
            rgb(44, 44, 44),
            1,
        );
        draw_line(
            hdc,
            header_rect.left + 1,
            header_rect.top + 1,
            header_rect.left + 28,
            header_rect.top + 1,
            rgb(126, 126, 126),
            1,
        );
        let grip_center = (rect.left + rect.right) / 2;
        for offset in [-7, 0, 7] {
            fill_rect_color(
                hdc,
                &RECT {
                    left: grip_center + offset - 1,
                    top: rect.top + 9,
                    right: grip_center + offset + 2,
                    bottom: rect.top + 12,
                },
                rgb(176, 176, 176),
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
        let range_rect = RECT {
            left: start_x,
            top,
            right: end_x,
            bottom: top + height,
        };
        fill_rect_color(hdc, &range_rect, rgb(18, 18, 18));
        draw_rect_outline(hdc, &range_rect, color, 1);
        fill_rect_color(
            hdc,
            &RECT {
                left: start_x,
                top,
                right: (start_x + 4).min(end_x),
                bottom: top + height,
            },
            color,
        );
        fill_rect_color(
            hdc,
            &RECT {
                left: (end_x - 4).max(start_x),
                top,
                right: end_x,
                bottom: top + height,
            },
            color,
        );
    }

    unsafe fn draw_panel_chrome(hdc: HDC, rect: &RECT) {
        draw_rect_outline(hdc, rect, rgb(58, 58, 58), 1);
        let corner = 18;
        draw_line(
            hdc,
            rect.left + 1,
            rect.top + 1,
            rect.left + corner,
            rect.top + 1,
            rgb(198, 198, 198),
            1,
        );
        draw_line(
            hdc,
            rect.left + 1,
            rect.top + 1,
            rect.left + 1,
            rect.top + corner,
            rgb(198, 198, 198),
            1,
        );
        draw_line(
            hdc,
            rect.right - corner,
            rect.top + 1,
            rect.right - 1,
            rect.top + 1,
            rgb(198, 198, 198),
            1,
        );
        draw_line(
            hdc,
            rect.right - 1,
            rect.top + 1,
            rect.right - 1,
            rect.top + corner,
            rgb(198, 198, 198),
            1,
        );
        draw_line(
            hdc,
            rect.left + 1,
            rect.bottom - 1,
            rect.left + corner,
            rect.bottom - 1,
            rgb(198, 198, 198),
            1,
        );
        draw_line(
            hdc,
            rect.left + 1,
            rect.bottom - corner,
            rect.left + 1,
            rect.bottom - 1,
            rgb(198, 198, 198),
            1,
        );
        draw_line(
            hdc,
            rect.right - corner,
            rect.bottom - 1,
            rect.right - 1,
            rect.bottom - 1,
            rgb(198, 198, 198),
            1,
        );
        draw_line(
            hdc,
            rect.right - 1,
            rect.bottom - corner,
            rect.right - 1,
            rect.bottom - 1,
            rgb(198, 198, 198),
            1,
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

    unsafe fn draw_glow_line(hdc: HDC, x1: i32, y1: i32, x2: i32, y2: i32, color: u32) {
        draw_line(hdc, x1 - 1, y1, x2 - 1, y2, rgb(36, 36, 36), 1);
        draw_line(hdc, x1 + 1, y1, x2 + 1, y2, rgb(36, 36, 36), 1);
        draw_line(hdc, x1, y1, x2, y2, color, 1);
    }

    unsafe fn draw_rect_outline(hdc: HDC, rect: &RECT, color: u32, width: i32) {
        draw_line(hdc, rect.left, rect.top, rect.right, rect.top, color, width);
        draw_line(
            hdc,
            rect.right - 1,
            rect.top,
            rect.right - 1,
            rect.bottom,
            color,
            width,
        );
        draw_line(
            hdc,
            rect.left,
            rect.bottom - 1,
            rect.right,
            rect.bottom - 1,
            color,
            width,
        );
        draw_line(
            hdc,
            rect.left,
            rect.top,
            rect.left,
            rect.bottom,
            color,
            width,
        );
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
    use tauri::AppHandle;

    pub fn open_surface(
        _app: &AppHandle,
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
    platform::open_surface(app, config, main_bounds)?;
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
        choose_timeline_tick_step_ms, clamp_surface_rect_to_bounds, clamp_timeline_ratio,
        compute_surface_rect, effective_timeline_duration_ms, NativeMainBounds,
        WorkbenchNativeSurfaceContent, WorkbenchNativeSurfaceInputEvent,
        WorkbenchNativeSurfaceRegion, WorkbenchNativeTimeRange,
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
    fn surface_rect_is_clamped_into_visible_bounds_when_window_is_maximized() {
        let rect = clamp_surface_rect_to_bounds(
            super::NativeSurfaceRect {
                x: 1920,
                y: 0,
                width: 320,
                height: 1080,
            },
            super::NativeSurfaceRect {
                x: 0,
                y: 0,
                width: 1920,
                height: 1040,
            },
        );

        assert_eq!(
            rect,
            super::NativeSurfaceRect {
                x: 1600,
                y: 0,
                width: 320,
                height: 1040,
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
    fn input_event_serializes_with_camel_case_payload() {
        let event = WorkbenchNativeSurfaceInputEvent::TimelineSeek {
            surface_id: String::from("visualizer-timeline"),
            playhead_ms: 12_345.0,
        };
        let json = serde_json::to_value(event).expect("timeline input should serialize");
        assert_eq!(
            json,
            serde_json::json!({
                "kind": "timeline.seek",
                "surfaceId": "visualizer-timeline",
                "playheadMs": 12345.0
            })
        );
    }

    #[test]
    fn range_input_events_serialize_with_camel_case_payload() {
        let clip_event = WorkbenchNativeSurfaceInputEvent::TimelineClipSet {
            surface_id: String::from("visualizer-timeline"),
            range: WorkbenchNativeTimeRange {
                start_ms: 1_000.0,
                end_ms: 12_000.0,
            },
            is_final: true,
        };
        let loop_event = WorkbenchNativeSurfaceInputEvent::TimelineLoopSet {
            surface_id: String::from("visualizer-timeline"),
            range: WorkbenchNativeTimeRange {
                start_ms: 2_000.0,
                end_ms: 8_000.0,
            },
            is_final: false,
        };

        assert_eq!(
            serde_json::to_value(clip_event).expect("clip input should serialize"),
            serde_json::json!({
                "kind": "timeline.clip.set",
                "surfaceId": "visualizer-timeline",
                "range": { "startMs": 1000.0, "endMs": 12000.0 },
                "isFinal": true
            })
        );
        assert_eq!(
            serde_json::to_value(loop_event).expect("loop input should serialize"),
            serde_json::json!({
                "kind": "timeline.loop.set",
                "surfaceId": "visualizer-timeline",
                "range": { "startMs": 2000.0, "endMs": 8000.0 },
                "isFinal": false
            })
        );
    }

    #[test]
    fn outliner_visibility_toggle_serializes_with_camel_case_payload() {
        let event = WorkbenchNativeSurfaceInputEvent::OutlinerVisibilityToggle {
            surface_id: String::from("visualizer-outliner"),
            item_id: String::from("freq"),
        };

        assert_eq!(
            serde_json::to_value(event).expect("outliner visibility input should serialize"),
            serde_json::json!({
                "kind": "outliner.visibility.toggle",
                "surfaceId": "visualizer-outliner",
                "itemId": "freq"
            })
        );
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

    #[test]
    fn timeline_tick_step_scales_with_width_and_duration() {
        assert_eq!(choose_timeline_tick_step_ms(60_000.0, 900), 10_000.0);
        assert_eq!(choose_timeline_tick_step_ms(180_000.0, 300), 120_000.0);
        assert_eq!(choose_timeline_tick_step_ms(3_600_000.0, 900), 600_000.0);
    }
}
