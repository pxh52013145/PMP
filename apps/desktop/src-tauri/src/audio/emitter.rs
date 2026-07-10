use once_cell::sync::{Lazy, OnceCell};
use rustfft::FftPlanner;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::audio::engine::{PlaybackState, ENGINE};
use crate::audio::events::{
    NativeAudioErrorPayload, NativeAudioSpectrumFramePayload, NativeAudioStatePayload,
    NATIVE_AUDIO_ERROR_EVENT, NATIVE_AUDIO_SPECTRUM_EVENT, NATIVE_AUDIO_STATE_EVENT,
};

static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();
static EMITTER_STARTED: OnceCell<()> = OnceCell::new();
static LAST_EMITTED_ERROR_SEQ: AtomicU64 = AtomicU64::new(0);
static EMITTER_STOP: AtomicBool = AtomicBool::new(false);
static SPECTRUM_ENABLED: AtomicBool = AtomicBool::new(false);
static SPECTRUM_CLIENTS: Lazy<std::sync::Mutex<HashSet<String>>> =
    Lazy::new(|| std::sync::Mutex::new(HashSet::new()));
const IDLE_STATE_HEARTBEAT_TICKS: u64 = 5;
const COLD_IDLE_SLEEP_MS: u64 = 4_000;
const PLAYBACK_ACTIVE_SLEEP_MS: u64 = 250;
const SPECTRUM_IDLE_SLEEP_MS: u64 = 50;
const SPECTRUM_JSON_FALLBACK_DIVISOR: u64 = 8;

#[derive(Clone, Debug, PartialEq, Eq)]
struct StateEmitSignature {
    playback_state: String,
    track_path: Option<String>,
    current_time_ms: i64,
    duration_ms: i64,
    buffered_time_ms: i64,
    buffered_ahead_ms: i64,
    decode_buffered_ahead_ms: i64,
    output_buffered_ahead_ms: i64,
    ended: bool,
    error_seq: Option<u64>,
}

impl StateEmitSignature {
    fn from_payload(payload: &NativeAudioStatePayload) -> Self {
        Self {
            playback_state: payload.playback_state.clone(),
            track_path: payload.track_path.clone(),
            current_time_ms: quantize_millis(payload.current_time),
            duration_ms: quantize_millis(payload.duration),
            buffered_time_ms: quantize_millis(payload.buffered_time),
            buffered_ahead_ms: quantize_millis(payload.buffered_ahead),
            decode_buffered_ahead_ms: quantize_millis(payload.decode_buffered_ahead),
            output_buffered_ahead_ms: quantize_millis(payload.output_buffered_ahead),
            ended: payload.ended,
            error_seq: payload.error_seq,
        }
    }
}

fn quantize_millis(value: f64) -> i64 {
    if !value.is_finite() {
        return 0;
    }
    let millis = (value * 1000.0).round();
    millis.clamp(i64::MIN as f64, i64::MAX as f64) as i64
}

pub(crate) fn ensure_started(app_handle: &AppHandle) {
    let _ = APP_HANDLE.set(app_handle.clone());
    if EMITTER_STARTED.set(()).is_err() {
        return;
    }

    std::thread::spawn(emit_state_loop);
    std::thread::spawn(emit_spectrum_loop);
}

fn emit_state_loop() {
    let mut tick_counter: u64 = 0;
    let mut sleep_ms: u64 = PLAYBACK_ACTIVE_SLEEP_MS;
    let mut last_state_signature: Option<StateEmitSignature> = None;
    let mut idle_ticks_since_emit: u64 = 0;

    loop {
        if EMITTER_STOP.load(Ordering::Acquire) {
            break;
        }
        std::thread::sleep(Duration::from_millis(sleep_ms));
        if EMITTER_STOP.load(Ordering::Acquire) {
            break;
        }
        let Some(app_handle) = APP_HANDLE.get().cloned() else {
            continue;
        };

        tick_counter = tick_counter.wrapping_add(1);
        let Some((state_payload, active_playback, cold_idle)) = (|| {
            let mut engine = ENGINE.try_lock().ok()?;
            let cold_idle = engine.is_cold_idle_runtime();
            let was_playing = engine.is_playing_or_rebuffering();
            if !engine.tick() {
                return None;
            }
            let active_playback = engine.is_playing_or_rebuffering();
            let include_extended_tick = active_playback && tick_counter % 40 == 0;
            let is_stopped = matches!(engine.playback_state(), PlaybackState::Stopped);
            let ended = was_playing && is_stopped;
            Some((
                if include_extended_tick || ended {
                    engine.build_extended_tick_state_payload(ended)
                } else {
                    engine.build_tick_state_payload(ended)
                },
                active_playback,
                cold_idle,
            ))
        })() else {
            continue;
        };

        sleep_ms = if active_playback {
            PLAYBACK_ACTIVE_SLEEP_MS
        } else if cold_idle {
            COLD_IDLE_SLEEP_MS
        } else {
            1200
        };

        let maybe_error = match (
            state_payload.error_seq,
            state_payload.error_code.clone(),
            state_payload.error_message.clone(),
        ) {
            (Some(seq), Some(code), Some(message)) => {
                Some(NativeAudioErrorPayload { seq, code, message })
            }
            _ => None,
        };

        let next_signature = StateEmitSignature::from_payload(&state_payload);
        let should_emit_state = if active_playback {
            idle_ticks_since_emit = 0;
            true
        } else {
            idle_ticks_since_emit = idle_ticks_since_emit.saturating_add(1);
            let changed = last_state_signature
                .as_ref()
                .map(|prev| prev != &next_signature)
                .unwrap_or(true);
            changed || idle_ticks_since_emit >= IDLE_STATE_HEARTBEAT_TICKS
        };

        if should_emit_state {
            idle_ticks_since_emit = 0;
            last_state_signature = Some(next_signature);

            #[cfg(target_os = "windows")]
            {
                crate::windows::taskbar_thumbbar::sync_from_native_audio_state(
                    &state_payload.playback_state,
                );
                crate::windows::smtc::sync_from_native_audio_state(
                    &state_payload.playback_state,
                    state_payload.track_path.as_deref(),
                    state_payload.current_time,
                    state_payload.duration,
                );
            }

            let _ = emit_state(&app_handle, state_payload);
        }

        if let Some(error_payload) = maybe_error {
            let _ = emit_error(&app_handle, error_payload);
        }
    }
}

fn emit_spectrum_loop() {
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(1024);
    let mut spectrum_dual = crate::audio::spectrum::DualSpectrumComputer::new();
    let mut pre_window = Vec::with_capacity(1024);
    let mut post_window = Vec::with_capacity(1024);
    let mut json_fallback_tick: u64 = 0;

    loop {
        if EMITTER_STOP.load(Ordering::Acquire) {
            break;
        }
        if !SPECTRUM_ENABLED.load(Ordering::Acquire) {
            std::thread::sleep(Duration::from_millis(SPECTRUM_IDLE_SLEEP_MS));
            continue;
        }

        let binary_subscribers = crate::audio::spectrum_stream::has_subscribers();
        json_fallback_tick = json_fallback_tick.wrapping_add(1);
        let emit_json_fallback =
            !binary_subscribers && json_fallback_tick % SPECTRUM_JSON_FALLBACK_DIVISOR == 0;
        if !binary_subscribers && !emit_json_fallback {
            std::thread::sleep(Duration::from_nanos(1_000_000_000 / 60));
            continue;
        }

        let Some(snapshot) = (|| {
            let mut engine = ENGINE.try_lock().ok()?;
            engine.snapshot_for_dual_spectrum_into(&mut pre_window, &mut post_window)
        })() else {
            std::thread::sleep(Duration::from_nanos(1_000_000_000 / 60));
            continue;
        };
        let app_handle = APP_HANDLE.get().cloned();

        if let Some(metadata) = snapshot.pre {
            if let Some(frame) = spectrum_dual.compute_pre_frame(&fft, metadata, &pre_window) {
                let delivered_binary = crate::audio::spectrum_stream::publish_frame(&frame);
                if !delivered_binary && emit_json_fallback {
                    if let Some(app_handle) = app_handle.as_ref() {
                        let _ = emit_spectrum_frame(app_handle, frame);
                    }
                }
            }
        }
        if let Some(metadata) = snapshot.post {
            if let Some(frame) = spectrum_dual.compute_post_frame(&fft, metadata, &post_window) {
                let delivered_binary = crate::audio::spectrum_stream::publish_frame(&frame);
                if !delivered_binary && emit_json_fallback {
                    if let Some(app_handle) = app_handle.as_ref() {
                        let _ = emit_spectrum_frame(app_handle, frame);
                    }
                }
            }
        }

        std::thread::sleep(Duration::from_nanos(1_000_000_000 / 60));
    }
}

pub(crate) fn shutdown() {
    EMITTER_STOP.store(true, Ordering::SeqCst);
}

pub(crate) fn set_spectrum_enabled(client_id: &str, enabled: bool) -> bool {
    let effective_enabled = match SPECTRUM_CLIENTS.lock() {
        Ok(mut clients) => {
            if enabled {
                clients.insert(client_id.to_string());
            } else {
                clients.remove(client_id);
            }
            !clients.is_empty()
        }
        Err(_) => enabled,
    };
    SPECTRUM_ENABLED.store(effective_enabled, Ordering::Release);
    effective_enabled
}

pub(crate) fn emit_state(
    app_handle: &AppHandle,
    payload: NativeAudioStatePayload,
) -> Result<(), String> {
    crate::windows::desktop_lyrics::sync_from_native_audio_state(app_handle, &payload);

    app_handle
        .emit_all(NATIVE_AUDIO_STATE_EVENT, payload)
        .map_err(|e| format!("Failed to emit state: {e}"))
}

pub(crate) fn emit_spectrum_frame(
    app_handle: &AppHandle,
    payload: NativeAudioSpectrumFramePayload<'_>,
) -> Result<(), String> {
    app_handle
        .emit_all(NATIVE_AUDIO_SPECTRUM_EVENT, payload)
        .map_err(|e| format!("Failed to emit spectrum frame: {e}"))
}

fn mark_error_emitted(seq: u64) -> bool {
    if seq == 0 {
        return false;
    }
    loop {
        let prev = LAST_EMITTED_ERROR_SEQ.load(Ordering::Acquire);
        if seq <= prev {
            return false;
        }
        if LAST_EMITTED_ERROR_SEQ
            .compare_exchange(prev, seq, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            return true;
        }
    }
}

pub(crate) fn emit_error(
    app_handle: &AppHandle,
    payload: NativeAudioErrorPayload,
) -> Result<(), String> {
    if !mark_error_emitted(payload.seq) {
        return Ok(());
    }
    app_handle
        .emit_all(NATIVE_AUDIO_ERROR_EVENT, payload)
        .map_err(|e| format!("Failed to emit error: {e}"))
}
