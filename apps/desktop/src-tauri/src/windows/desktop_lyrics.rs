use std::collections::HashMap;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::audio::events::NativeAudioStatePayload;
use crate::lyrics::service::LyricResolveRequest;
use crate::music_library_db::{self, LibraryTrackQueryInput, LibraryTrackRecord};

#[derive(Debug, Clone)]
struct DesktopLyricLine {
    start_ms: u64,
    end_ms: Option<u64>,
    text: String,
    translation: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct OverlayText {
    primary: String,
    secondary: Option<String>,
    lines: Vec<String>,
    active_index: Option<usize>,
    active_progress_percent: u8,
    active_progress_remaining_ms: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum OverlayPositionPreset {
    BottomCenter,
    BottomLeft,
    BottomRight,
    TopCenter,
}

impl OverlayPositionPreset {
    fn parse(value: &str) -> Option<Self> {
        let normalized = value.trim().to_ascii_lowercase();
        match normalized.as_str() {
            "bottom-center" => Some(Self::BottomCenter),
            "bottom-left" => Some(Self::BottomLeft),
            "bottom-right" => Some(Self::BottomRight),
            "top-center" => Some(Self::TopCenter),
            _ => None,
        }
    }
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
#[derive(Debug, Clone)]
enum OverlayCommand {
    SetVisible(bool),
    SetClickThrough(bool),
    SetFontSize(u32),
    SetOpacityPercent(u8),
    SetPositionPreset(OverlayPositionPreset),
    SetPositionOffset(i32, i32),
    SetRegionSize(i32, i32),
    SetLayout(i32, i32, i32, i32),
    SetLyricOffsetMs(i32),
    SetText(Option<OverlayText>),
    SetActiveProgress {
        active_index: Option<usize>,
        active_progress_percent: u8,
        active_progress_remaining_ms: u32,
    },
    Shutdown,
}

#[derive(Debug)]
struct DesktopLyricsState {
    visible: bool,
    click_through: bool,
    font_size: u32,
    opacity_percent: u8,
    position_preset: OverlayPositionPreset,
    position_offset_x: i32,
    position_offset_y: i32,
    region_width: i32,
    region_height: i32,
    lyric_offset_ms: i32,
    track_lines: HashMap<String, Vec<DesktopLyricLine>>,
    track_cache_order: Vec<String>,
    pending_track_resolves: HashSet<String>,
    latest_track_key: Option<String>,
    latest_track_fallback_text: Option<String>,
    latest_current_ms: u64,
    latest_playback_state: String,
    debug_override_text: Option<OverlayText>,
    last_rendered_text: Option<OverlayText>,
}

impl Default for DesktopLyricsState {
    fn default() -> Self {
        Self {
            visible: false,
            click_through: false,
            font_size: DEFAULT_OVERLAY_FONT_SIZE,
            opacity_percent: DEFAULT_OVERLAY_OPACITY_PERCENT,
            position_preset: OverlayPositionPreset::BottomCenter,
            position_offset_x: 0,
            position_offset_y: 0,
            region_width: DEFAULT_OVERLAY_REGION_WIDTH,
            region_height: DEFAULT_OVERLAY_REGION_HEIGHT,
            lyric_offset_ms: DEFAULT_LYRIC_OFFSET_MS,
            track_lines: HashMap::new(),
            track_cache_order: Vec::new(),
            pending_track_resolves: HashSet::new(),
            latest_track_key: None,
            latest_track_fallback_text: None,
            latest_current_ms: 0,
            latest_playback_state: "idle".to_string(),
            debug_override_text: None,
            last_rendered_text: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DesktopLyricsPersistedStateV1 {
    visible: bool,
    click_through: bool,
    font_size: u32,
    opacity_percent: u8,
    position_preset: OverlayPositionPreset,
    position_offset_x: i32,
    position_offset_y: i32,
    region_width: i32,
    region_height: i32,
    lyric_offset_ms: i32,
}

impl DesktopLyricsPersistedStateV1 {
    fn from_state(state: &DesktopLyricsState) -> Self {
        Self {
            visible: state.visible,
            click_through: state.click_through,
            font_size: state.font_size,
            opacity_percent: state.opacity_percent,
            position_preset: state.position_preset,
            position_offset_x: state.position_offset_x,
            position_offset_y: state.position_offset_y,
            region_width: state.region_width,
            region_height: state.region_height,
            lyric_offset_ms: state.lyric_offset_ms,
        }
    }

    fn apply_to_state(&self, state: &mut DesktopLyricsState) {
        state.visible = self.visible;
        state.click_through = self.click_through;
        state.font_size = self
            .font_size
            .clamp(MIN_OVERLAY_FONT_SIZE, MAX_OVERLAY_FONT_SIZE);
        state.opacity_percent = normalize_overlay_opacity_percent(self.opacity_percent);
        state.position_preset = self.position_preset;
        state.position_offset_x = normalize_overlay_position_offset(self.position_offset_x);
        state.position_offset_y = normalize_overlay_position_offset(self.position_offset_y);
        state.region_width = normalize_overlay_region_width(self.region_width);
        state.region_height = normalize_overlay_region_height(self.region_height);
        state.lyric_offset_ms = normalize_lyric_offset_ms(self.lyric_offset_ms);
        state.debug_override_text = None;
        state.last_rendered_text = None;
    }
}

static OVERLAY_TX: Lazy<Mutex<Option<Sender<OverlayCommand>>>> = Lazy::new(|| Mutex::new(None));
static DESKTOP_LYRICS_STATE: Lazy<Mutex<DesktopLyricsState>> =
    Lazy::new(|| Mutex::new(DesktopLyricsState::default()));
static RESOLVE_RESULT_CHANNEL: Lazy<(
    Sender<ResolvedTrackLines>,
    Mutex<mpsc::Receiver<ResolvedTrackLines>>,
)> = Lazy::new(|| {
    let (tx, rx) = mpsc::channel();
    (tx, Mutex::new(rx))
});
static DESKTOP_LYRICS_APP_HANDLE: Lazy<Mutex<Option<AppHandle>>> = Lazy::new(|| Mutex::new(None));
const MAX_TRACK_CACHE_ENTRIES: usize = 32;
const MIN_OVERLAY_FONT_SIZE: u32 = 16;
const MAX_OVERLAY_FONT_SIZE: u32 = 56;
const DEFAULT_OVERLAY_FONT_SIZE: u32 = 26;
const MIN_OVERLAY_OPACITY_PERCENT: u8 = 0;
const MAX_OVERLAY_OPACITY_PERCENT: u8 = 100;
const DEFAULT_OVERLAY_OPACITY_PERCENT: u8 = 92;
const MAX_OVERLAY_POSITION_OFFSET: i32 = 16384;
const MIN_OVERLAY_REGION_WIDTH: i32 = 320;
const MAX_OVERLAY_REGION_WIDTH: i32 = 8192;
const MIN_OVERLAY_REGION_HEIGHT: i32 = 72;
const MAX_OVERLAY_REGION_HEIGHT: i32 = 2160;
const DEFAULT_OVERLAY_REGION_WIDTH: i32 = 0;
const DEFAULT_OVERLAY_REGION_HEIGHT: i32 = 0;
const MIN_LYRIC_OFFSET_MS: i32 = -5000;
const MAX_LYRIC_OFFSET_MS: i32 = 5000;
const DEFAULT_LYRIC_OFFSET_MS: i32 = 0;
const DESKTOP_LYRICS_STATE_DIR_NAME: &str = "desktop-lyrics";
const DESKTOP_LYRICS_STATE_FILE_NAME: &str = "desktop-lyrics-state-v1.json";

#[derive(Debug)]
struct ResolvedTrackLines {
    track_key: String,
    lines: Vec<DesktopLyricLine>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DesktopLyricsLayoutChangedPayload {
    offset_x: i32,
    offset_y: i32,
    region_width: i32,
    region_height: i32,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DesktopLyricsControlsChangedPayload {
    visible: bool,
    click_through: bool,
    font_size: u32,
    opacity_percent: u8,
    lyric_offset_ms: i32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLyricsOverlaySnapshotText {
    pub primary: String,
    pub secondary: Option<String>,
    pub lines: Vec<String>,
    pub active_index: Option<usize>,
    pub active_progress_percent: u8,
    pub active_progress_remaining_ms: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLyricsOverlaySnapshot {
    pub visible: bool,
    pub click_through: bool,
    pub font_size: u32,
    pub opacity_percent: u8,
    pub region_width: i32,
    pub region_height: i32,
    pub lyric_offset_ms: i32,
    pub text: Option<DesktopLyricsOverlaySnapshotText>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLyricsLayoutSnapshot {
    pub offset_x: i32,
    pub offset_y: i32,
    pub region_width: i32,
    pub region_height: i32,
}

pub(super) const DESKTOP_LYRICS_OVERLAY_WINDOW_LABEL: &str = "desktop-lyrics-overlay";
pub(super) const DESKTOP_LYRICS_UNLOCK_WINDOW_LABEL: &str = "desktop-lyrics-unlock";
pub(super) const DESKTOP_LYRICS_OVERLAY_SYNC_EVENT: &str = "desktop-lyrics-overlay-sync";
pub(super) const DESKTOP_LYRICS_OVERLAY_PROGRESS_EVENT: &str = "desktop-lyrics-overlay-progress";

mod backend;

pub fn init(app: &AppHandle) {
    register_app_handle(app);

    let restored_visible = {
        let Ok(mut state) = DESKTOP_LYRICS_STATE.lock() else {
            return;
        };

        match load_persisted_state(app) {
            Ok(Some(persisted_state)) => {
                persisted_state.apply_to_state(&mut state);
            }
            Ok(None) => {}
            Err(error) => {
                crate::backend_telemetry::warn(
                    app,
                    "desktop-lyrics",
                    "desktop-lyrics.state.load.failed",
                    crate::backend_telemetry::BackendTelemetryOptions::new()
                        .component("desktop_lyrics")
                        .message(error),
                );
            }
        }

        state.visible
    };

    if !restored_visible {
        return;
    }

    let Ok(mut state) = DESKTOP_LYRICS_STATE.lock() else {
        return;
    };
    ensure_overlay_runtime_bootstrapped(&state);
    refresh_overlay_locked(&mut state);
}

pub fn register_app_handle(app: &AppHandle) {
    if let Ok(mut guard) = DESKTOP_LYRICS_APP_HANDLE.lock() {
        *guard = Some(app.clone());
    }
}

pub(super) fn current_app_handle() -> Option<AppHandle> {
    DESKTOP_LYRICS_APP_HANDLE
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().cloned())
}

fn persisted_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Desktop lyrics app data dir is unavailable".to_string())?;

    Ok(root
        .join(DESKTOP_LYRICS_STATE_DIR_NAME)
        .join(DESKTOP_LYRICS_STATE_FILE_NAME))
}

fn load_persisted_state(app: &AppHandle) -> Result<Option<DesktopLyricsPersistedStateV1>, String> {
    let path = persisted_state_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("read desktop lyrics state failed: {error}"))?;
    let state = serde_json::from_str::<DesktopLyricsPersistedStateV1>(&content)
        .map_err(|error| format!("parse desktop lyrics state failed: {error}"))?;

    Ok(Some(state))
}

fn persist_state(state: &DesktopLyricsState) {
    let Some(app) = current_app_handle() else {
        return;
    };

    if let Err(error) = persist_state_to_disk(&app, state) {
        crate::backend_telemetry::warn(
            &app,
            "desktop-lyrics",
            "desktop-lyrics.state.persist.failed",
            crate::backend_telemetry::BackendTelemetryOptions::new()
                .component("desktop_lyrics")
                .message(error),
        );
    }
}

fn persist_state_to_disk(app: &AppHandle, state: &DesktopLyricsState) -> Result<(), String> {
    let path = persisted_state_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create desktop lyrics state dir failed: {error}"))?;
    }

    let payload = serde_json::to_vec_pretty(&DesktopLyricsPersistedStateV1::from_state(state))
        .map_err(|error| format!("serialize desktop lyrics state failed: {error}"))?;
    fs::write(&path, payload).map_err(|error| format!("write desktop lyrics state failed: {error}"))
}

pub fn shutdown() {
    stop_overlay_runtime();
}

pub fn get_overlay_snapshot() -> Result<DesktopLyricsOverlaySnapshot, String> {
    let state = DESKTOP_LYRICS_STATE
        .lock()
        .map_err(|_| "Desktop lyrics state lock poisoned".to_string())?;

    Ok(DesktopLyricsOverlaySnapshot {
        visible: state.visible,
        click_through: state.click_through,
        font_size: state.font_size,
        opacity_percent: state.opacity_percent,
        region_width: state.region_width,
        region_height: state.region_height,
        lyric_offset_ms: state.lyric_offset_ms,
        text: state
            .debug_override_text
            .as_ref()
            .or(state.last_rendered_text.as_ref())
            .map(snapshot_text_from_overlay_text),
    })
}

fn snapshot_text_from_overlay_text(value: &OverlayText) -> DesktopLyricsOverlaySnapshotText {
    DesktopLyricsOverlaySnapshotText {
        primary: value.primary.clone(),
        secondary: value.secondary.clone(),
        lines: value.lines.clone(),
        active_index: value.active_index,
        active_progress_percent: value.active_progress_percent,
        active_progress_remaining_ms: value.active_progress_remaining_ms,
    }
}

pub fn set_visible(visible: bool) -> Result<(), String> {
    let mut state = DESKTOP_LYRICS_STATE
        .lock()
        .map_err(|_| "Desktop lyrics state lock poisoned".to_string())?;

    apply_visible_locked(&mut state, visible);
    Ok(())
}

pub fn toggle_visible() -> Result<bool, String> {
    let mut state = DESKTOP_LYRICS_STATE
        .lock()
        .map_err(|_| "Desktop lyrics state lock poisoned".to_string())?;

    let next_visible = !state.visible;
    apply_visible_locked(&mut state, next_visible);
    Ok(next_visible)
}

fn apply_visible_locked(state: &mut DesktopLyricsState, visible: bool) {
    let changed = state.visible != visible;

    if !visible {
        state.visible = false;
        state.last_rendered_text = None;
        if changed {
            persist_state(state);
        }
        emit_controls_changed_from_state(state);
        stop_overlay_runtime();
        return;
    }

    state.visible = true;
    if changed {
        persist_state(state);
    }
    emit_controls_changed_from_state(state);
    ensure_overlay_runtime_bootstrapped(state);
    send_overlay_command_with_recover(OverlayCommand::SetVisible(true), Some(state));
    refresh_overlay_locked(state);
}

fn emit_controls_changed_from_state(state: &DesktopLyricsState) {
    emit_controls_changed_event(DesktopLyricsControlsChangedPayload {
        visible: state.visible,
        click_through: state.click_through,
        font_size: state.font_size,
        opacity_percent: state.opacity_percent,
        lyric_offset_ms: state.lyric_offset_ms,
    });
}

pub fn debug_set_text(
    primary: Option<String>,
    secondary: Option<String>,
    visible: Option<bool>,
) -> Result<(), String> {
    let normalized_primary = primary
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_default();
    let normalized_secondary = secondary
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let debug_text = if normalized_primary.is_empty() && normalized_secondary.is_none() {
        None
    } else {
        Some(OverlayText {
            primary: normalized_primary.clone(),
            secondary: normalized_secondary,
            lines: vec![normalized_primary],
            active_index: Some(0),
            active_progress_percent: 0,
            active_progress_remaining_ms: 0,
        })
    };

    let mut state = DESKTOP_LYRICS_STATE
        .lock()
        .map_err(|_| "Desktop lyrics state lock poisoned".to_string())?;

    let target_visible = visible.unwrap_or_else(|| {
        if debug_text.is_some() {
            true
        } else {
            state.visible
        }
    });

    if target_visible || state.visible || debug_text.is_some() {
        ensure_overlay_runtime_bootstrapped(&state);
    }

    if state.visible != target_visible {
        state.visible = target_visible;
        send_overlay_command_with_recover(OverlayCommand::SetVisible(target_visible), Some(&state));
    }

    state.debug_override_text = debug_text;
    refresh_overlay_locked(&mut state);
    Ok(())
}

pub fn set_click_through(enabled: bool) -> Result<(), String> {
    let mut state = DESKTOP_LYRICS_STATE
        .lock()
        .map_err(|_| "Desktop lyrics state lock poisoned".to_string())?;
    let changed = state.click_through != enabled;
    state.click_through = enabled;
    if changed {
        persist_state(&state);
    }
    emit_controls_changed_from_state(&state);
    send_overlay_command_with_recover(OverlayCommand::SetClickThrough(enabled), Some(&state));
    Ok(())
}

pub fn set_font_size(font_size: u32) -> Result<(), String> {
    let normalized_font_size = font_size.clamp(MIN_OVERLAY_FONT_SIZE, MAX_OVERLAY_FONT_SIZE);
    let mut state = DESKTOP_LYRICS_STATE
        .lock()
        .map_err(|_| "Desktop lyrics state lock poisoned".to_string())?;
    let changed = state.font_size != normalized_font_size;
    state.font_size = normalized_font_size;
    if changed {
        persist_state(&state);
    }
    emit_controls_changed_from_state(&state);
    send_overlay_command_with_recover(
        OverlayCommand::SetFontSize(normalized_font_size),
        Some(&state),
    );
    Ok(())
}

pub fn set_opacity_percent(opacity_percent: u8) -> Result<(), String> {
    let normalized = normalize_overlay_opacity_percent(opacity_percent);
    let mut state = DESKTOP_LYRICS_STATE
        .lock()
        .map_err(|_| "Desktop lyrics state lock poisoned".to_string())?;
    let changed = state.opacity_percent != normalized;
    state.opacity_percent = normalized;
    if changed {
        persist_state(&state);
    }
    emit_controls_changed_from_state(&state);
    send_overlay_command_with_recover(OverlayCommand::SetOpacityPercent(normalized), Some(&state));
    Ok(())
}

pub fn set_position_preset(preset: String) -> Result<(), String> {
    let normalized_preset = OverlayPositionPreset::parse(preset.as_str())
        .ok_or_else(|| format!("Unsupported desktop lyrics position preset: {preset}"))?;
    let mut state = DESKTOP_LYRICS_STATE
        .lock()
        .map_err(|_| "Desktop lyrics state lock poisoned".to_string())?;
    let changed = state.position_preset != normalized_preset;
    state.position_preset = normalized_preset;
    if changed {
        persist_state(&state);
    }
    send_overlay_command_with_recover(
        OverlayCommand::SetPositionPreset(normalized_preset),
        Some(&state),
    );
    Ok(())
}

pub fn set_position_offset(offset_x: i32, offset_y: i32) -> Result<(), String> {
    let normalized_x = normalize_overlay_position_offset(offset_x);
    let normalized_y = normalize_overlay_position_offset(offset_y);

    let mut state = DESKTOP_LYRICS_STATE
        .lock()
        .map_err(|_| "Desktop lyrics state lock poisoned".to_string())?;
    let changed =
        state.position_offset_x != normalized_x || state.position_offset_y != normalized_y;
    state.position_offset_x = normalized_x;
    state.position_offset_y = normalized_y;
    if changed {
        persist_state(&state);
    }
    send_overlay_command_with_recover(
        OverlayCommand::SetPositionOffset(normalized_x, normalized_y),
        Some(&state),
    );
    Ok(())
}

pub fn set_region_size(width: i32, height: i32) -> Result<(), String> {
    let normalized_width = normalize_overlay_region_width(width);
    let normalized_height = normalize_overlay_region_height(height);

    let mut state = DESKTOP_LYRICS_STATE
        .lock()
        .map_err(|_| "Desktop lyrics state lock poisoned".to_string())?;
    let changed =
        state.region_width != normalized_width || state.region_height != normalized_height;
    state.region_width = normalized_width;
    state.region_height = normalized_height;
    if changed {
        persist_state(&state);
    }
    send_overlay_command_with_recover(
        OverlayCommand::SetRegionSize(normalized_width, normalized_height),
        Some(&state),
    );
    Ok(())
}

pub fn set_layout(offset_x: i32, offset_y: i32, width: i32, height: i32) -> Result<(), String> {
    let normalized_x = normalize_overlay_position_offset(offset_x);
    let normalized_y = normalize_overlay_position_offset(offset_y);
    let normalized_width = normalize_explicit_overlay_region_width(width);
    let normalized_height = normalize_explicit_overlay_region_height(height);

    let mut state = DESKTOP_LYRICS_STATE
        .lock()
        .map_err(|_| "Desktop lyrics state lock poisoned".to_string())?;
    let changed = state.position_offset_x != normalized_x
        || state.position_offset_y != normalized_y
        || state.region_width != normalized_width
        || state.region_height != normalized_height;
    state.position_offset_x = normalized_x;
    state.position_offset_y = normalized_y;
    state.region_width = normalized_width;
    state.region_height = normalized_height;
    if changed {
        persist_state(&state);
    }
    send_overlay_command_with_recover(
        OverlayCommand::SetLayout(
            normalized_x,
            normalized_y,
            normalized_width,
            normalized_height,
        ),
        Some(&state),
    );
    Ok(())
}

pub fn preview_layout(
    app: &AppHandle,
    offset_x: i32,
    offset_y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    register_app_handle(app);
    let normalized_x = normalize_overlay_position_offset(offset_x);
    let normalized_y = normalize_overlay_position_offset(offset_y);
    let normalized_width = normalize_explicit_overlay_region_width(width);
    let normalized_height = normalize_explicit_overlay_region_height(height);

    #[cfg(target_os = "windows")]
    {
        backend::preview_layout(
            app,
            normalized_x,
            normalized_y,
            normalized_width,
            normalized_height,
        )
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (
            normalized_x,
            normalized_y,
            normalized_width,
            normalized_height,
        );
        Ok(())
    }
}

fn commit_layout_snapshot(
    snapshot: DesktopLyricsLayoutSnapshot,
) -> Result<DesktopLyricsLayoutSnapshot, String> {
    set_layout(
        snapshot.offset_x,
        snapshot.offset_y,
        snapshot.region_width,
        snapshot.region_height,
    )?;

    Ok(snapshot)
}

pub fn commit_current_layout(app: &AppHandle) -> Result<DesktopLyricsLayoutSnapshot, String> {
    register_app_handle(app);

    let snapshot = {
        #[cfg(target_os = "windows")]
        {
            let (offset_x, offset_y, region_width, region_height) =
                backend::read_current_layout(app)?
                    .ok_or_else(|| "Desktop lyrics overlay layout unavailable".to_string())?;

            DesktopLyricsLayoutSnapshot {
                offset_x: normalize_overlay_position_offset(offset_x),
                offset_y: normalize_overlay_position_offset(offset_y),
                region_width: normalize_explicit_overlay_region_width(region_width),
                region_height: normalize_explicit_overlay_region_height(region_height),
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            let state = DESKTOP_LYRICS_STATE
                .lock()
                .map_err(|_| "Desktop lyrics state lock poisoned".to_string())?;

            DesktopLyricsLayoutSnapshot {
                offset_x: state.position_offset_x,
                offset_y: state.position_offset_y,
                region_width: state.region_width,
                region_height: state.region_height,
            }
        }
    };

    commit_layout_snapshot(snapshot)
}

pub fn set_lyric_offset_ms(offset_ms: i32) -> Result<(), String> {
    let normalized = normalize_lyric_offset_ms(offset_ms);

    let mut state = DESKTOP_LYRICS_STATE
        .lock()
        .map_err(|_| "Desktop lyrics state lock poisoned".to_string())?;
    let changed = state.lyric_offset_ms != normalized;
    state.lyric_offset_ms = normalized;
    if changed {
        persist_state(&state);
    }
    send_overlay_command_with_recover(OverlayCommand::SetLyricOffsetMs(normalized), Some(&state));
    emit_controls_changed_from_state(&state);
    refresh_overlay_locked(&mut state);
    Ok(())
}

pub fn sync_from_native_audio_state(app: &AppHandle, payload: &NativeAudioStatePayload) {
    register_app_handle(app);
    drain_resolved_track_lines();

    let normalized_track_key = payload.track_path.as_deref().and_then(normalize_track_path);
    let track_path = payload
        .track_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let playback_state = payload.playback_state.trim().to_ascii_lowercase();
    let should_clear_track_context =
        matches!(playback_state.as_str(), "idle" | "stopped" | "error");

    let incoming_fallback_text = track_path
        .as_deref()
        .and_then(track_fallback_text_from_path);

    let resolve_request = {
        let Ok(mut state) = DESKTOP_LYRICS_STATE.lock() else {
            return;
        };

        state.latest_playback_state = playback_state;
        state.latest_current_ms = if payload.current_time.is_finite() {
            (payload.current_time.max(0.0) * 1000.0).round() as u64
        } else {
            0
        };

        if should_clear_track_context {
            state.latest_track_key = None;
            state.latest_track_fallback_text = None;
        } else if let Some(track_key) = normalized_track_key.as_ref() {
            state.latest_track_key = Some(track_key.clone());
            state.latest_track_fallback_text = incoming_fallback_text.clone();
        }

        let should_resolve = normalized_track_key.as_ref().is_some_and(|track_key| {
            !state.track_lines.contains_key(track_key)
                && !state.pending_track_resolves.contains(track_key)
        });

        let next_resolve_request = if should_resolve {
            match (normalized_track_key.as_ref(), track_path.as_ref()) {
                (Some(track_key), Some(track_path)) => {
                    state.pending_track_resolves.insert(track_key.clone());
                    Some((track_key.clone(), track_path.clone()))
                }
                _ => None,
            }
        } else {
            None
        };

        sync_overlay_runtime_if_needed(&state);
        refresh_overlay_locked(&mut state);
        next_resolve_request
    };

    let Some((track_key, track_path)) = resolve_request else {
        return;
    };

    spawn_track_lines_resolve(app.clone(), track_key, track_path);
}

fn spawn_track_lines_resolve(app: AppHandle, track_key: String, track_path: String) {
    let result_tx = RESOLVE_RESULT_CHANNEL.0.clone();
    std::thread::spawn(move || {
        let resolved_lines = resolve_track_lines_for_path(&app, track_path.as_str())
            .unwrap_or_else(|error| {
                crate::backend_telemetry::warn(
                    &app,
                    "desktop-lyrics",
                    "desktop-lyrics.track-lines.resolve.failed",
                    crate::backend_telemetry::BackendTelemetryOptions::new()
                        .component("desktop_lyrics")
                        .message(error)
                        .field("trackPath", serde_json::json!(track_path)),
                );
                Vec::new()
            });

        let _ = result_tx.send(ResolvedTrackLines {
            track_key,
            lines: resolved_lines,
        });
    });
}

fn drain_resolved_track_lines() {
    let mut drained = Vec::new();

    if let Ok(receiver) = RESOLVE_RESULT_CHANNEL.1.lock() {
        loop {
            match receiver.try_recv() {
                Ok(result) => drained.push(result),
                Err(mpsc::TryRecvError::Empty) | Err(mpsc::TryRecvError::Disconnected) => break,
            }
        }
    }

    if drained.is_empty() {
        return;
    }

    let Ok(mut state) = DESKTOP_LYRICS_STATE.lock() else {
        return;
    };

    for result in drained {
        state
            .pending_track_resolves
            .remove(result.track_key.as_str());
        cache_track_lines(&mut state, result.track_key, result.lines);
    }

    sync_overlay_runtime_if_needed(&state);
    refresh_overlay_locked(&mut state);
}

pub(super) fn apply_sidecar_layout_changed(
    offset_x: i32,
    offset_y: i32,
    region_width: i32,
    region_height: i32,
) {
    let payload = {
        let Ok(mut state) = DESKTOP_LYRICS_STATE.lock() else {
            return;
        };

        let normalized_payload = DesktopLyricsLayoutChangedPayload {
            offset_x: normalize_overlay_position_offset(offset_x),
            offset_y: normalize_overlay_position_offset(offset_y),
            region_width: normalize_overlay_region_width(region_width),
            region_height: normalize_overlay_region_height(region_height),
        };

        if state.position_offset_x == normalized_payload.offset_x
            && state.position_offset_y == normalized_payload.offset_y
            && state.region_width == normalized_payload.region_width
            && state.region_height == normalized_payload.region_height
        {
            return;
        }

        state.position_offset_x = normalized_payload.offset_x;
        state.position_offset_y = normalized_payload.offset_y;
        state.region_width = normalized_payload.region_width;
        state.region_height = normalized_payload.region_height;

        normalized_payload
    };

    emit_layout_changed_event(payload);
}

pub(super) fn apply_sidecar_controls_changed(
    visible: bool,
    click_through: bool,
    font_size: u32,
    opacity_percent: u8,
) {
    let payload = {
        let Ok(mut state) = DESKTOP_LYRICS_STATE.lock() else {
            return;
        };

        let normalized_payload = DesktopLyricsControlsChangedPayload {
            visible,
            click_through,
            font_size: font_size.clamp(MIN_OVERLAY_FONT_SIZE, MAX_OVERLAY_FONT_SIZE),
            opacity_percent: normalize_overlay_opacity_percent(opacity_percent),
            lyric_offset_ms: state.lyric_offset_ms,
        };

        if state.visible == normalized_payload.visible
            && state.click_through == normalized_payload.click_through
            && state.font_size == normalized_payload.font_size
            && state.opacity_percent == normalized_payload.opacity_percent
            && state.lyric_offset_ms == normalized_payload.lyric_offset_ms
        {
            return;
        }

        state.visible = normalized_payload.visible;
        state.click_through = normalized_payload.click_through;
        state.font_size = normalized_payload.font_size;
        state.opacity_percent = normalized_payload.opacity_percent;

        if !normalized_payload.visible {
            state.last_rendered_text = None;
        }

        normalized_payload
    };

    emit_controls_changed_event(payload);
}

fn emit_layout_changed_event(payload: DesktopLyricsLayoutChangedPayload) {
    let app_handle = DESKTOP_LYRICS_APP_HANDLE
        .lock()
        .ok()
        .and_then(|guard| guard.clone());

    let Some(app_handle) = app_handle else {
        return;
    };

    let _ = app_handle.emit_all(super::EVENT_DESKTOP_LYRICS_LAYOUT_CHANGED, payload);
}

fn emit_controls_changed_event(payload: DesktopLyricsControlsChangedPayload) {
    let app_handle = DESKTOP_LYRICS_APP_HANDLE
        .lock()
        .ok()
        .and_then(|guard| guard.clone());

    let Some(app_handle) = app_handle else {
        return;
    };

    let _ = app_handle.emit_all(super::EVENT_DESKTOP_LYRICS_CONTROLS_CHANGED, payload);
}

fn send_overlay_command(command: OverlayCommand) -> bool {
    let tx = OVERLAY_TX
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().cloned());
    let Some(tx) = tx else {
        return false;
    };

    if tx.send(command).is_err() {
        if let Ok(mut guard) = OVERLAY_TX.lock() {
            *guard = None;
        }
        return false;
    }

    true
}

fn stop_overlay_runtime() {
    let tx = OVERLAY_TX.lock().ok().and_then(|mut guard| guard.take());
    let Some(tx) = tx else {
        return;
    };

    let _ = tx.send(OverlayCommand::Shutdown);
}

fn send_overlay_command_with_recover(command: OverlayCommand, state: Option<&DesktopLyricsState>) {
    if send_overlay_command(command.clone()) {
        return;
    }

    if matches!(command, OverlayCommand::Shutdown) {
        return;
    }

    ensure_overlay_runtime_started();

    if let Some(state) = state {
        bootstrap_overlay_runtime_state(state);
    }

    let _ = send_overlay_command(command);
}

fn bootstrap_overlay_runtime_state(state: &DesktopLyricsState) {
    let _ = send_overlay_command(OverlayCommand::SetClickThrough(state.click_through));
    let _ = send_overlay_command(OverlayCommand::SetFontSize(state.font_size));
    let _ = send_overlay_command(OverlayCommand::SetOpacityPercent(state.opacity_percent));
    let _ = send_overlay_command(OverlayCommand::SetLyricOffsetMs(state.lyric_offset_ms));
    let _ = send_overlay_command(OverlayCommand::SetPositionPreset(state.position_preset));
    if state.region_width > 0 && state.region_height > 0 {
        let _ = send_overlay_command(OverlayCommand::SetLayout(
            state.position_offset_x,
            state.position_offset_y,
            state.region_width,
            state.region_height,
        ));
    } else {
        let _ = send_overlay_command(OverlayCommand::SetPositionOffset(
            state.position_offset_x,
            state.position_offset_y,
        ));
        let _ = send_overlay_command(OverlayCommand::SetRegionSize(
            state.region_width,
            state.region_height,
        ));
    }
    let _ = send_overlay_command(OverlayCommand::SetVisible(state.visible));

    match state
        .debug_override_text
        .clone()
        .or_else(|| state.last_rendered_text.clone())
    {
        Some(text) => {
            let _ = send_overlay_command(OverlayCommand::SetText(Some(text)));
        }
        None => {
            let _ = send_overlay_command(OverlayCommand::SetText(None));
        }
    }
}

fn ensure_overlay_runtime_started() {
    let mut should_spawn = false;

    if let Ok(mut guard) = OVERLAY_TX.lock() {
        if guard.is_none() {
            let (tx, rx) = mpsc::channel::<OverlayCommand>();
            *guard = Some(tx);
            should_spawn = true;

            std::thread::spawn(move || {
                backend::run(rx);
            });
        }
    }

    if !should_spawn {
        return;
    }
}

fn overlay_runtime_started() -> bool {
    OVERLAY_TX
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false)
}

fn ensure_overlay_runtime_bootstrapped(state: &DesktopLyricsState) {
    if overlay_runtime_started() {
        return;
    }

    ensure_overlay_runtime_started();
    bootstrap_overlay_runtime_state(state);
}

fn sync_overlay_runtime_if_needed(state: &DesktopLyricsState) {
    if state.visible {
        ensure_overlay_runtime_bootstrapped(state);
    }
}

fn normalize_track_path(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    Some(trimmed.replace('\\', "/").to_ascii_lowercase())
}

fn track_fallback_text_from_path(track_path: &str) -> Option<String> {
    let trimmed = track_path.trim();
    if trimmed.is_empty() {
        return None;
    }

    let fallback = Path::new(trimmed)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(trimmed);

    Some(fallback.to_string())
}

fn normalize_overlay_opacity_percent(value: u8) -> u8 {
    value.clamp(MIN_OVERLAY_OPACITY_PERCENT, MAX_OVERLAY_OPACITY_PERCENT)
}

fn normalize_overlay_position_offset(value: i32) -> i32 {
    value.clamp(-MAX_OVERLAY_POSITION_OFFSET, MAX_OVERLAY_POSITION_OFFSET)
}

fn normalize_overlay_region_width(value: i32) -> i32 {
    if value <= 0 {
        return DEFAULT_OVERLAY_REGION_WIDTH;
    }
    value.clamp(MIN_OVERLAY_REGION_WIDTH, MAX_OVERLAY_REGION_WIDTH)
}

fn normalize_overlay_region_height(value: i32) -> i32 {
    if value <= 0 {
        return DEFAULT_OVERLAY_REGION_HEIGHT;
    }
    value.clamp(MIN_OVERLAY_REGION_HEIGHT, MAX_OVERLAY_REGION_HEIGHT)
}

fn normalize_explicit_overlay_region_width(value: i32) -> i32 {
    value.clamp(MIN_OVERLAY_REGION_WIDTH, MAX_OVERLAY_REGION_WIDTH)
}

fn normalize_explicit_overlay_region_height(value: i32) -> i32 {
    value.clamp(MIN_OVERLAY_REGION_HEIGHT, MAX_OVERLAY_REGION_HEIGHT)
}

fn normalize_lyric_offset_ms(value: i32) -> i32 {
    value.clamp(MIN_LYRIC_OFFSET_MS, MAX_LYRIC_OFFSET_MS)
}

fn apply_lyric_offset_ms(current_ms: u64, lyric_offset_ms: i32) -> u64 {
    if lyric_offset_ms >= 0 {
        return current_ms.saturating_add(lyric_offset_ms as u64);
    }

    current_ms.saturating_sub((-lyric_offset_ms) as u64)
}

fn normalize_lines(lines: Vec<DesktopLyricLine>) -> Vec<DesktopLyricLine> {
    let mut normalized = lines
        .into_iter()
        .filter_map(|line| {
            let text = line.text.trim().to_string();
            if text.is_empty() {
                return None;
            }

            let mut end_ms = line.end_ms;
            if let Some(end) = end_ms {
                if end <= line.start_ms {
                    end_ms = None;
                }
            }

            Some(DesktopLyricLine {
                start_ms: line.start_ms,
                end_ms,
                text,
                translation: line
                    .translation
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
            })
        })
        .collect::<Vec<_>>();

    normalized.sort_by_key(|line| line.start_ms);
    normalized
}

fn cache_track_lines(
    state: &mut DesktopLyricsState,
    track_key: String,
    lines: Vec<DesktopLyricLine>,
) {
    if let Some(existing_index) = state
        .track_cache_order
        .iter()
        .position(|value| value == &track_key)
    {
        state.track_cache_order.remove(existing_index);
    }
    state.track_cache_order.push(track_key.clone());
    state.track_lines.insert(track_key, lines);

    while state.track_cache_order.len() > MAX_TRACK_CACHE_ENTRIES {
        let oldest_track_key = state.track_cache_order.remove(0);
        state.track_lines.remove(&oldest_track_key);
    }
}

fn resolve_track_lines_for_path(
    app: &AppHandle,
    track_path: &str,
) -> Result<Vec<DesktopLyricLine>, String> {
    let track_record = query_track_record_by_path(app, track_path)?;
    let request = build_lyric_resolve_request(track_path, track_record.as_ref());
    let result = crate::lyrics::service::resolve_for_track(app, request)?;

    let lines = result
        .selected
        .map(|document| {
            document
                .lines
                .into_iter()
                .map(|line| DesktopLyricLine {
                    start_ms: line.start_ms,
                    end_ms: line.end_ms,
                    text: line.text,
                    translation: line.translation,
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(normalize_lines(lines))
}

fn query_track_record_by_path(
    app: &AppHandle,
    track_path: &str,
) -> Result<Option<LibraryTrackRecord>, String> {
    let query = LibraryTrackQueryInput {
        limit: Some(1),
        offset: Some(0),
        include_missing: Some(true),
        visible_only: Some(false),
        projection: Some("full".to_string()),
        include_grouped_rows: None,
        collapsed_group_keys: None,
        row_window_start: None,
        row_window_end: None,
        search_query: None,
        artist: None,
        album: None,
        track_id: None,
        source_id: None,
        quick_fingerprint: None,
        file_path: Some(track_path.to_string()),
        base_query: None,
        filters: None,
        group_by: None,
        sort: None,
    };

    let tracks = music_library_db::query_tracks(app, Some(query))?;
    Ok(tracks.into_iter().next())
}

fn build_lyric_resolve_request(
    track_path: &str,
    track_record: Option<&LibraryTrackRecord>,
) -> LyricResolveRequest {
    let cache_key = track_record
        .map(|record| record.id.clone())
        .or_else(|| normalize_track_path(track_path));

    LyricResolveRequest {
        entry_id: None,
        track_id: track_record.map(|record| record.id.clone()),
        track_file_path: Some(track_path.to_string()),
        quick_fingerprint: track_record.and_then(|record| record.quick_fingerprint.clone()),
        title: track_record.and_then(|record| record.title.clone()),
        artist: track_record.and_then(|record| record.artist.clone()),
        duration_seconds: track_record.and_then(|record| record.duration_seconds),
        embedded_lyrics: None,
        lyric_locator: None,
        cache_key,
        language: None,
        force_web_lookup: Some(false),
    }
}

fn refresh_overlay_locked(state: &mut DesktopLyricsState) {
    if !state.visible {
        state.last_rendered_text = None;
        return;
    }

    if let Some(debug_text) = state.debug_override_text.as_ref() {
        if state
            .last_rendered_text
            .as_ref()
            .is_some_and(|previous| previous == debug_text)
        {
            return;
        }

        state.last_rendered_text = Some(debug_text.clone());
        send_overlay_command_with_recover(
            OverlayCommand::SetText(Some(debug_text.clone())),
            Some(state),
        );
        return;
    }

    if matches!(
        state.latest_playback_state.as_str(),
        "idle" | "stopped" | "error"
    ) {
        clear_rendered_text_locked(state);
        return;
    }

    let Some(track_key) = state.latest_track_key.as_deref() else {
        render_track_fallback_text_locked(state);
        return;
    };

    let Some(lines) = state.track_lines.get(track_key) else {
        render_track_fallback_text_locked(state);
        return;
    };

    let adjusted_current_ms = apply_lyric_offset_ms(state.latest_current_ms, state.lyric_offset_ms);

    let Some(active_index) = resolve_active_line_index(lines, adjusted_current_ms) else {
        render_track_fallback_text_locked(state);
        return;
    };

    let Some(active_line) = lines.get(active_index) else {
        render_track_fallback_text_locked(state);
        return;
    };

    let primary = active_line.text.trim();
    let secondary = active_line
        .translation
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string);

    if primary.is_empty() && secondary.is_none() {
        render_track_fallback_text_locked(state);
        return;
    }

    let next_rendered_text = OverlayText {
        primary: primary.to_string(),
        secondary,
        lines: overlay_line_texts(lines),
        active_index: Some(active_index),
        active_progress_percent: active_line_progress_percent(
            lines,
            active_index,
            adjusted_current_ms,
        ),
        active_progress_remaining_ms: active_line_progress_remaining_ms(
            lines,
            active_index,
            adjusted_current_ms,
        ),
    };

    if state
        .last_rendered_text
        .as_ref()
        .is_some_and(|previous| previous == &next_rendered_text)
    {
        return;
    }

    if let Some(previous) = state
        .last_rendered_text
        .as_ref()
        .filter(|previous| overlay_text_matches_except_progress(previous, &next_rendered_text))
    {
        if previous.active_progress_percent == next_rendered_text.active_progress_percent {
            return;
        }

        state.last_rendered_text = Some(next_rendered_text.clone());
        send_overlay_command_with_recover(
            OverlayCommand::SetActiveProgress {
                active_index: next_rendered_text.active_index,
                active_progress_percent: next_rendered_text.active_progress_percent,
                active_progress_remaining_ms: next_rendered_text.active_progress_remaining_ms,
            },
            Some(state),
        );
        return;
    }

    state.last_rendered_text = Some(next_rendered_text.clone());
    send_overlay_command_with_recover(
        OverlayCommand::SetText(Some(next_rendered_text)),
        Some(state),
    );
}

fn overlay_text_matches_except_progress(left: &OverlayText, right: &OverlayText) -> bool {
    left.primary == right.primary
        && left.secondary == right.secondary
        && left.lines == right.lines
        && left.active_index == right.active_index
}

fn render_track_fallback_text_locked(state: &mut DesktopLyricsState) {
    let Some(primary) = state
        .latest_track_fallback_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return;
    };

    let fallback_text = OverlayText {
        primary: primary.to_string(),
        secondary: None,
        lines: vec![primary.to_string()],
        active_index: Some(0),
        active_progress_percent: 0,
        active_progress_remaining_ms: 0,
    };

    if state
        .last_rendered_text
        .as_ref()
        .is_some_and(|previous| previous == &fallback_text)
    {
        return;
    }

    state.last_rendered_text = Some(fallback_text.clone());
    send_overlay_command_with_recover(OverlayCommand::SetText(Some(fallback_text)), Some(state));
}

fn overlay_line_texts(lines: &[DesktopLyricLine]) -> Vec<String> {
    lines
        .iter()
        .map(|line| line.text.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
}

fn active_line_end_ms(lines: &[DesktopLyricLine], index: usize) -> Option<u64> {
    let line = lines.get(index)?;
    Some(
        line.end_ms
            .or_else(|| lines.get(index + 1).map(|next| next.start_ms))
            .unwrap_or_else(|| line.start_ms.saturating_add(4000)),
    )
}

fn active_line_progress_percent(lines: &[DesktopLyricLine], index: usize, current_ms: u64) -> u8 {
    let Some(line) = lines.get(index) else {
        return 0;
    };
    let Some(end_ms) = active_line_end_ms(lines, index) else {
        return 0;
    };

    if current_ms <= line.start_ms {
        return 0;
    }
    if end_ms <= line.start_ms || current_ms >= end_ms {
        return 100;
    }

    let elapsed = current_ms.saturating_sub(line.start_ms);
    let duration = end_ms.saturating_sub(line.start_ms).max(1);
    ((elapsed.saturating_mul(100)) / duration).min(100) as u8
}

fn active_line_progress_remaining_ms(
    lines: &[DesktopLyricLine],
    index: usize,
    current_ms: u64,
) -> u32 {
    let Some(end_ms) = active_line_end_ms(lines, index) else {
        return 0;
    };

    end_ms.saturating_sub(current_ms).min(u32::MAX as u64) as u32
}

fn clear_rendered_text_locked(state: &mut DesktopLyricsState) {
    if state.last_rendered_text.take().is_some() {
        send_overlay_command_with_recover(OverlayCommand::SetText(None), Some(state));
    }
}

fn resolve_active_line_index(lines: &[DesktopLyricLine], current_ms: u64) -> Option<usize> {
    if lines.is_empty() {
        return None;
    }

    for index in 0..lines.len() {
        let line = &lines[index];
        let next_start = lines.get(index + 1).map(|item| item.start_ms);
        let end_ms = line
            .end_ms
            .or(next_start)
            .unwrap_or_else(|| line.start_ms.saturating_add(4000));

        if current_ms >= line.start_ms && current_ms < end_ms {
            return Some(index);
        }

        if current_ms < line.start_ms {
            return Some(index.saturating_sub(1));
        }
    }

    Some(lines.len() - 1)
}

#[cfg(test)]
mod tests {
    use super::{
        apply_lyric_offset_ms, normalize_lyric_offset_ms, normalize_overlay_opacity_percent,
        normalize_overlay_position_offset, normalize_overlay_region_height,
        normalize_overlay_region_width, refresh_overlay_locked, resolve_active_line_index,
        track_fallback_text_from_path, DesktopLyricLine, DesktopLyricsState, OverlayText,
    };

    fn line(start_ms: u64, end_ms: Option<u64>, text: &str) -> DesktopLyricLine {
        DesktopLyricLine {
            start_ms,
            end_ms,
            text: text.to_string(),
            translation: None,
        }
    }

    fn overlay_text(primary: &str, secondary: Option<&str>) -> OverlayText {
        OverlayText {
            primary: primary.to_string(),
            secondary: secondary.map(str::to_string),
            lines: vec![primary.to_string()],
            active_index: Some(0),
            active_progress_percent: 0,
            active_progress_remaining_ms: 0,
        }
    }

    #[test]
    fn resolve_active_line_respects_explicit_end() {
        let lines = vec![line(0, Some(1000), "a"), line(1000, Some(2000), "b")];
        assert_eq!(resolve_active_line_index(&lines, 100), Some(0));
        assert_eq!(resolve_active_line_index(&lines, 1500), Some(1));
    }

    #[test]
    fn resolve_active_line_uses_next_start_when_end_missing() {
        let lines = vec![line(500, None, "a"), line(1500, None, "b")];
        assert_eq!(resolve_active_line_index(&lines, 600), Some(0));
        assert_eq!(resolve_active_line_index(&lines, 1499), Some(0));
        assert_eq!(resolve_active_line_index(&lines, 1500), Some(1));
    }

    #[test]
    fn resolve_active_line_falls_back_to_last_line() {
        let lines = vec![line(0, Some(900), "a"), line(1000, None, "b")];
        assert_eq!(resolve_active_line_index(&lines, 99999), Some(1));
    }

    #[test]
    fn refresh_overlay_keeps_text_while_waiting_track_key() {
        let mut state = DesktopLyricsState::default();
        state.visible = true;
        state.latest_playback_state = "playing".to_string();
        state.last_rendered_text = Some(overlay_text("keep", None));

        refresh_overlay_locked(&mut state);

        assert_eq!(state.last_rendered_text, Some(overlay_text("keep", None)));
    }

    #[test]
    fn refresh_overlay_clears_text_when_stopped() {
        let mut state = DesktopLyricsState::default();
        state.visible = true;
        state.latest_playback_state = "stopped".to_string();
        state.last_rendered_text = Some(overlay_text("clear", None));

        refresh_overlay_locked(&mut state);

        assert_eq!(state.last_rendered_text, None);
    }

    #[test]
    fn refresh_overlay_keeps_text_while_waiting_lyrics_resolve() {
        let mut state = DesktopLyricsState::default();
        state.visible = true;
        state.latest_playback_state = "playing".to_string();
        state.latest_track_key = Some("track-a".to_string());
        state.last_rendered_text = Some(overlay_text("keep", None));

        refresh_overlay_locked(&mut state);

        assert_eq!(state.last_rendered_text, Some(overlay_text("keep", None)));
    }

    #[test]
    fn refresh_overlay_uses_track_fallback_when_lyrics_missing() {
        let mut state = DesktopLyricsState::default();
        state.visible = true;
        state.latest_playback_state = "playing".to_string();
        state.latest_track_key = Some("track-a".to_string());
        state.latest_track_fallback_text = Some("fallback-track".to_string());

        refresh_overlay_locked(&mut state);

        assert_eq!(
            state.last_rendered_text,
            Some(overlay_text("fallback-track", None))
        );
    }

    #[test]
    fn refresh_overlay_includes_full_line_context_and_progress() {
        let mut state = DesktopLyricsState::default();
        state.visible = true;
        state.latest_playback_state = "playing".to_string();
        state.latest_track_key = Some("track-a".to_string());
        state.latest_current_ms = 1_250;
        state.track_lines.insert(
            "track-a".to_string(),
            vec![
                line(0, Some(1_000), "previous"),
                line(1_000, Some(2_000), "current"),
                line(2_000, Some(3_000), "next"),
            ],
        );

        refresh_overlay_locked(&mut state);

        assert_eq!(
            state.last_rendered_text,
            Some(OverlayText {
                primary: "current".to_string(),
                secondary: None,
                lines: vec![
                    "previous".to_string(),
                    "current".to_string(),
                    "next".to_string(),
                ],
                active_index: Some(1),
                active_progress_percent: 25,
                active_progress_remaining_ms: 750,
            })
        );
    }

    #[test]
    fn refresh_overlay_prefers_debug_override_text() {
        let mut state = DesktopLyricsState::default();
        state.visible = true;
        state.latest_playback_state = "stopped".to_string();
        state.debug_override_text = Some(overlay_text("debug-primary", Some("debug-secondary")));

        refresh_overlay_locked(&mut state);

        assert_eq!(
            state.last_rendered_text,
            Some(overlay_text("debug-primary", Some("debug-secondary")))
        );
    }

    #[test]
    fn refresh_overlay_hidden_state_clears_debug_text_render() {
        let mut state = DesktopLyricsState::default();
        state.visible = false;
        state.debug_override_text = Some(overlay_text("debug-primary", None));
        state.last_rendered_text = Some(overlay_text("stale", None));

        refresh_overlay_locked(&mut state);

        assert_eq!(state.last_rendered_text, None);
    }

    #[test]
    fn track_fallback_text_prefers_file_stem() {
        assert_eq!(
            track_fallback_text_from_path("C:/music/artist - title.flac"),
            Some("artist - title".to_string())
        );
        assert_eq!(track_fallback_text_from_path("  "), None);
    }

    #[test]
    fn normalize_overlay_opacity_percent_clamps_range() {
        assert_eq!(normalize_overlay_opacity_percent(0), 0);
        assert_eq!(normalize_overlay_opacity_percent(10), 10);
        assert_eq!(normalize_overlay_opacity_percent(92), 92);
        assert_eq!(normalize_overlay_opacity_percent(120), 100);
    }

    #[test]
    fn normalize_overlay_position_offset_clamps_range() {
        assert_eq!(normalize_overlay_position_offset(-32768), -16384);
        assert_eq!(normalize_overlay_position_offset(-128), -128);
        assert_eq!(normalize_overlay_position_offset(128), 128);
        assert_eq!(normalize_overlay_position_offset(32768), 16384);
    }

    #[test]
    fn normalize_overlay_region_width_supports_auto_and_clamps() {
        assert_eq!(normalize_overlay_region_width(0), 0);
        assert_eq!(normalize_overlay_region_width(-10), 0);
        assert_eq!(normalize_overlay_region_width(1), 320);
        assert_eq!(normalize_overlay_region_width(512), 512);
        assert_eq!(normalize_overlay_region_width(99999), 8192);
    }

    #[test]
    fn normalize_overlay_region_height_supports_auto_and_clamps() {
        assert_eq!(normalize_overlay_region_height(0), 0);
        assert_eq!(normalize_overlay_region_height(-10), 0);
        assert_eq!(normalize_overlay_region_height(1), 72);
        assert_eq!(normalize_overlay_region_height(180), 180);
        assert_eq!(normalize_overlay_region_height(99999), 2160);
    }

    #[test]
    fn normalize_lyric_offset_ms_clamps_range() {
        assert_eq!(normalize_lyric_offset_ms(-99999), -5000);
        assert_eq!(normalize_lyric_offset_ms(-120), -120);
        assert_eq!(normalize_lyric_offset_ms(0), 0);
        assert_eq!(normalize_lyric_offset_ms(180), 180);
        assert_eq!(normalize_lyric_offset_ms(99999), 5000);
    }

    #[test]
    fn apply_lyric_offset_ms_adjusts_playback_time() {
        assert_eq!(apply_lyric_offset_ms(1_000, 250), 1_250);
        assert_eq!(apply_lyric_offset_ms(1_000, -250), 750);
        assert_eq!(apply_lyric_offset_ms(100, -500), 0);
    }
}
