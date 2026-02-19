use once_cell::sync::OnceCell;
use rustfft::FftPlanner;
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
const IDLE_STATE_HEARTBEAT_TICKS: u64 = 5;

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

    std::thread::spawn(|| {
        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(1024);
        let mut spectrum_dual = crate::audio::spectrum::DualSpectrumComputer::new();
        let mut tick_counter: u64 = 0;
        let mut sleep_ms: u64 = 400;
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

            let spectrum_enabled = SPECTRUM_ENABLED.load(Ordering::Acquire);
            tick_counter = tick_counter.wrapping_add(1);

            let Some((state_payload, dual_spectrum_snapshot, active_playback)) = (|| {
                let mut engine = ENGINE.try_lock().ok()?;
                let was_playing = engine.is_playing_or_rebuffering();
                let ticked = engine.tick();
                if !ticked {
                    return None;
                }
                let active_playback = engine.is_playing_or_rebuffering();
                let include_extended_tick = active_playback && tick_counter % 40 == 0;
                let is_stopped = matches!(engine.playback_state(), PlaybackState::Stopped);
                let ended = was_playing && is_stopped;
                Some((
                    if include_extended_tick || ended {
                        engine.build_state_payload(ended)
                    } else {
                        engine.build_tick_state_payload(ended)
                    },
                    if spectrum_enabled {
                        engine.snapshot_for_dual_spectrum()
                    } else {
                        None
                    },
                    active_playback,
                ))
            })() else {
                continue;
            };

            sleep_ms = if spectrum_enabled {
                250
            } else if active_playback {
                400
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
            let should_emit_state = if active_playback || spectrum_enabled {
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
            if let Some(snapshot) = dual_spectrum_snapshot {
                if let Some(frame) = spectrum_dual.compute_pre_frame(&fft, snapshot.pre.as_ref()) {
                    let _ = emit_spectrum_frame(&app_handle, frame);
                }
                if let Some(frame) = spectrum_dual.compute_post_frame(&fft, snapshot.post.as_ref())
                {
                    let _ = emit_spectrum_frame(&app_handle, frame);
                }
            }
        }
    });
}

pub(crate) fn shutdown() {
    EMITTER_STOP.store(true, Ordering::SeqCst);
}

pub(crate) fn set_spectrum_enabled(enabled: bool) {
    SPECTRUM_ENABLED.store(enabled, Ordering::Release);
}

pub(crate) fn emit_state(
    app_handle: &AppHandle,
    payload: NativeAudioStatePayload,
) -> Result<(), String> {
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
