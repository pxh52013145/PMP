use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;

use once_cell::sync::Lazy;
use tauri::AppHandle;

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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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
#[derive(Debug)]
enum OverlayCommand {
    SetVisible(bool),
    SetClickThrough(bool),
    SetFontSize(u32),
    SetOpacityPercent(u8),
    SetPositionPreset(OverlayPositionPreset),
    SetPositionOffset(i32, i32),
    SetText(Option<OverlayText>),
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
    track_lines: HashMap<String, Vec<DesktopLyricLine>>,
    track_cache_order: Vec<String>,
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
            click_through: true,
            font_size: DEFAULT_OVERLAY_FONT_SIZE,
            opacity_percent: DEFAULT_OVERLAY_OPACITY_PERCENT,
            position_preset: OverlayPositionPreset::BottomCenter,
            position_offset_x: 0,
            position_offset_y: 0,
            track_lines: HashMap::new(),
            track_cache_order: Vec::new(),
            latest_track_key: None,
            latest_track_fallback_text: None,
            latest_current_ms: 0,
            latest_playback_state: "idle".to_string(),
            debug_override_text: None,
            last_rendered_text: None,
        }
    }
}

static OVERLAY_TX: Lazy<Mutex<Option<Sender<OverlayCommand>>>> = Lazy::new(|| Mutex::new(None));
static DESKTOP_LYRICS_STATE: Lazy<Mutex<DesktopLyricsState>> =
    Lazy::new(|| Mutex::new(DesktopLyricsState::default()));
const MAX_TRACK_CACHE_ENTRIES: usize = 32;
const MIN_OVERLAY_FONT_SIZE: u32 = 16;
const MAX_OVERLAY_FONT_SIZE: u32 = 56;
const DEFAULT_OVERLAY_FONT_SIZE: u32 = 26;
const MIN_OVERLAY_OPACITY_PERCENT: u8 = 35;
const MAX_OVERLAY_OPACITY_PERCENT: u8 = 100;
const DEFAULT_OVERLAY_OPACITY_PERCENT: u8 = 92;
const MAX_OVERLAY_POSITION_OFFSET: i32 = 960;

mod backend;

pub fn init() {
    // Lazy runtime: overlay thread is started on first explicit desktop-lyrics command.
}

pub fn shutdown() {
    send_overlay_command(OverlayCommand::Shutdown);
}

pub fn set_visible(visible: bool) -> Result<(), String> {
    let mut state = DESKTOP_LYRICS_STATE
        .lock()
        .map_err(|_| "Desktop lyrics state lock poisoned".to_string())?;

    if visible {
        ensure_overlay_runtime_bootstrapped(&state);
    }

    state.visible = visible;
    send_overlay_command(OverlayCommand::SetVisible(visible));
    refresh_overlay_locked(&mut state);
    Ok(())
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
            primary: normalized_primary,
            secondary: normalized_secondary,
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
        send_overlay_command(OverlayCommand::SetVisible(target_visible));
    }

    state.debug_override_text = debug_text;
    refresh_overlay_locked(&mut state);
    Ok(())
}

pub fn set_click_through(enabled: bool) -> Result<(), String> {
    let mut state = DESKTOP_LYRICS_STATE
        .lock()
        .map_err(|_| "Desktop lyrics state lock poisoned".to_string())?;
    state.click_through = enabled;
    send_overlay_command(OverlayCommand::SetClickThrough(enabled));
    Ok(())
}

pub fn set_font_size(font_size: u32) -> Result<(), String> {
    let normalized_font_size = font_size.clamp(MIN_OVERLAY_FONT_SIZE, MAX_OVERLAY_FONT_SIZE);
    let mut state = DESKTOP_LYRICS_STATE
        .lock()
        .map_err(|_| "Desktop lyrics state lock poisoned".to_string())?;
    state.font_size = normalized_font_size;
    send_overlay_command(OverlayCommand::SetFontSize(normalized_font_size));
    Ok(())
}

pub fn set_opacity_percent(opacity_percent: u8) -> Result<(), String> {
    let normalized = normalize_overlay_opacity_percent(opacity_percent);
    let mut state = DESKTOP_LYRICS_STATE
        .lock()
        .map_err(|_| "Desktop lyrics state lock poisoned".to_string())?;
    state.opacity_percent = normalized;
    send_overlay_command(OverlayCommand::SetOpacityPercent(normalized));
    Ok(())
}

pub fn set_position_preset(preset: String) -> Result<(), String> {
    let normalized_preset = OverlayPositionPreset::parse(preset.as_str())
        .ok_or_else(|| format!("Unsupported desktop lyrics position preset: {preset}"))?;
    let mut state = DESKTOP_LYRICS_STATE
        .lock()
        .map_err(|_| "Desktop lyrics state lock poisoned".to_string())?;
    state.position_preset = normalized_preset;
    send_overlay_command(OverlayCommand::SetPositionPreset(normalized_preset));
    Ok(())
}

pub fn set_position_offset(offset_x: i32, offset_y: i32) -> Result<(), String> {
    let normalized_x = normalize_overlay_position_offset(offset_x);
    let normalized_y = normalize_overlay_position_offset(offset_y);

    let mut state = DESKTOP_LYRICS_STATE
        .lock()
        .map_err(|_| "Desktop lyrics state lock poisoned".to_string())?;
    state.position_offset_x = normalized_x;
    state.position_offset_y = normalized_y;
    send_overlay_command(OverlayCommand::SetPositionOffset(
        normalized_x,
        normalized_y,
    ));
    Ok(())
}

pub fn sync_from_native_audio_state(app: &AppHandle, payload: &NativeAudioStatePayload) {
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

    let should_resolve_track = {
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

        let should_resolve = normalized_track_key
            .as_ref()
            .is_some_and(|track_key| !state.track_lines.contains_key(track_key));

        sync_overlay_runtime_if_needed(&state);
        refresh_overlay_locked(&mut state);
        should_resolve
    };

    if !should_resolve_track {
        return;
    }

    let Some(track_key) = normalized_track_key else {
        return;
    };
    let Some(track_path) = track_path else {
        return;
    };

    let resolved_lines =
        resolve_track_lines_for_path(app, track_path.as_str()).unwrap_or_else(|error| {
            eprintln!(
                "[desktop-lyrics] failed to resolve lyrics for track \"{}\": {}",
                track_path, error
            );
            Vec::new()
        });

    let Ok(mut state) = DESKTOP_LYRICS_STATE.lock() else {
        return;
    };

    cache_track_lines(&mut state, track_key, resolved_lines);
    sync_overlay_runtime_if_needed(&state);
    refresh_overlay_locked(&mut state);
}

fn send_overlay_command(command: OverlayCommand) {
    let tx = OVERLAY_TX
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().cloned());
    let Some(tx) = tx else {
        return;
    };

    if tx.send(command).is_err() {
        if let Ok(mut guard) = OVERLAY_TX.lock() {
            *guard = None;
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
    send_overlay_command(OverlayCommand::SetClickThrough(state.click_through));
    send_overlay_command(OverlayCommand::SetFontSize(state.font_size));
    send_overlay_command(OverlayCommand::SetOpacityPercent(state.opacity_percent));
    send_overlay_command(OverlayCommand::SetPositionPreset(state.position_preset));
    send_overlay_command(OverlayCommand::SetPositionOffset(
        state.position_offset_x,
        state.position_offset_y,
    ));
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
        search_query: None,
        artist: None,
        album: None,
        track_id: None,
        source_id: None,
        quick_fingerprint: None,
        file_path: Some(track_path.to_string()),
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
        clear_rendered_text_locked(state);
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
        send_overlay_command(OverlayCommand::SetText(Some(debug_text.clone())));
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

    let Some(active_index) = resolve_active_line_index(lines, state.latest_current_ms) else {
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
    };

    if state
        .last_rendered_text
        .as_ref()
        .is_some_and(|previous| previous == &next_rendered_text)
    {
        return;
    }

    state.last_rendered_text = Some(next_rendered_text.clone());
    send_overlay_command(OverlayCommand::SetText(Some(next_rendered_text)));
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
    };

    if state
        .last_rendered_text
        .as_ref()
        .is_some_and(|previous| previous == &fallback_text)
    {
        return;
    }

    state.last_rendered_text = Some(fallback_text.clone());
    send_overlay_command(OverlayCommand::SetText(Some(fallback_text)));
}

fn clear_rendered_text_locked(state: &mut DesktopLyricsState) {
    if state.last_rendered_text.take().is_some() {
        send_overlay_command(OverlayCommand::SetText(None));
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
        normalize_overlay_opacity_percent, normalize_overlay_position_offset,
        refresh_overlay_locked, resolve_active_line_index, track_fallback_text_from_path,
        DesktopLyricLine, DesktopLyricsState, OverlayText,
    };

    fn line(start_ms: u64, end_ms: Option<u64>, text: &str) -> DesktopLyricLine {
        DesktopLyricLine {
            start_ms,
            end_ms,
            text: text.to_string(),
            translation: None,
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
        state.last_rendered_text = Some(OverlayText {
            primary: "keep".to_string(),
            secondary: None,
        });

        refresh_overlay_locked(&mut state);

        assert_eq!(
            state.last_rendered_text,
            Some(OverlayText {
                primary: "keep".to_string(),
                secondary: None,
            })
        );
    }

    #[test]
    fn refresh_overlay_clears_text_when_stopped() {
        let mut state = DesktopLyricsState::default();
        state.visible = true;
        state.latest_playback_state = "stopped".to_string();
        state.last_rendered_text = Some(OverlayText {
            primary: "clear".to_string(),
            secondary: None,
        });

        refresh_overlay_locked(&mut state);

        assert_eq!(state.last_rendered_text, None);
    }

    #[test]
    fn refresh_overlay_keeps_text_while_waiting_lyrics_resolve() {
        let mut state = DesktopLyricsState::default();
        state.visible = true;
        state.latest_playback_state = "playing".to_string();
        state.latest_track_key = Some("track-a".to_string());
        state.last_rendered_text = Some(OverlayText {
            primary: "keep".to_string(),
            secondary: None,
        });

        refresh_overlay_locked(&mut state);

        assert_eq!(
            state.last_rendered_text,
            Some(OverlayText {
                primary: "keep".to_string(),
                secondary: None,
            })
        );
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
            Some(OverlayText {
                primary: "fallback-track".to_string(),
                secondary: None,
            })
        );
    }

    #[test]
    fn refresh_overlay_prefers_debug_override_text() {
        let mut state = DesktopLyricsState::default();
        state.visible = true;
        state.latest_playback_state = "stopped".to_string();
        state.debug_override_text = Some(OverlayText {
            primary: "debug-primary".to_string(),
            secondary: Some("debug-secondary".to_string()),
        });

        refresh_overlay_locked(&mut state);

        assert_eq!(
            state.last_rendered_text,
            Some(OverlayText {
                primary: "debug-primary".to_string(),
                secondary: Some("debug-secondary".to_string()),
            })
        );
    }

    #[test]
    fn refresh_overlay_hidden_state_clears_debug_text_render() {
        let mut state = DesktopLyricsState::default();
        state.visible = false;
        state.debug_override_text = Some(OverlayText {
            primary: "debug-primary".to_string(),
            secondary: None,
        });
        state.last_rendered_text = Some(OverlayText {
            primary: "stale".to_string(),
            secondary: None,
        });

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
        assert_eq!(normalize_overlay_opacity_percent(0), 35);
        assert_eq!(normalize_overlay_opacity_percent(35), 35);
        assert_eq!(normalize_overlay_opacity_percent(92), 92);
        assert_eq!(normalize_overlay_opacity_percent(120), 100);
    }

    #[test]
    fn normalize_overlay_position_offset_clamps_range() {
        assert_eq!(normalize_overlay_position_offset(-4096), -960);
        assert_eq!(normalize_overlay_position_offset(-128), -128);
        assert_eq!(normalize_overlay_position_offset(128), 128);
        assert_eq!(normalize_overlay_position_offset(4096), 960);
    }
}
