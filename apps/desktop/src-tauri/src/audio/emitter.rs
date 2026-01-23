use once_cell::sync::OnceCell;
use rustfft::FftPlanner;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::audio::engine::{PlaybackState, ENGINE};
use crate::audio::events::{
    NativeAudioErrorPayload, NativeAudioSpectrumPayload, NativeAudioStatePayload,
    NATIVE_AUDIO_ERROR_EVENT, NATIVE_AUDIO_SPECTRUM_EVENT, NATIVE_AUDIO_STATE_EVENT,
};

static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();
static EMITTER_STARTED: OnceCell<()> = OnceCell::new();
static LAST_EMITTED_ERROR_SEQ: AtomicU64 = AtomicU64::new(0);
static EMITTER_STOP: AtomicBool = AtomicBool::new(false);

pub(crate) fn ensure_started(app_handle: &AppHandle) {
    let _ = APP_HANDLE.set(app_handle.clone());
    let _ = crate::audio::resample_cache::init_from_app(app_handle);
    if EMITTER_STARTED.set(()).is_err() {
        return;
    }

    std::thread::spawn(|| {
        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(1024);
        let mut spectrum = crate::audio::spectrum::SpectrumComputer::new();

        loop {
            if EMITTER_STOP.load(Ordering::Acquire) {
                break;
            }
            std::thread::sleep(Duration::from_millis(250));
            if EMITTER_STOP.load(Ordering::Acquire) {
                break;
            }
            let Some(app_handle) = APP_HANDLE.get().cloned() else {
                continue;
            };

            let Some((state_payload, spectrum_snapshot)) = (|| {
                let mut engine = ENGINE.try_lock().ok()?;
                let was_playing = matches!(engine.playback_state(), PlaybackState::Playing);
                let ticked = engine.tick();
                if !ticked {
                    return None;
                }
                let is_stopped = matches!(engine.playback_state(), PlaybackState::Stopped);
                let ended = was_playing && is_stopped;
                Some((
                    engine.build_state_payload(ended),
                    engine.snapshot_for_spectrum(),
                ))
            })() else {
                continue;
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
            if let Some(error_payload) = maybe_error {
                let _ = emit_error(&app_handle, error_payload);
            }
            if let Some(snapshot) = spectrum_snapshot {
                if let Some(bins) = spectrum.compute_bins(&fft, &snapshot) {
                    let _ = emit_spectrum(&app_handle, NativeAudioSpectrumPayload { bins });
                }
            }
        }
    });
}

pub(crate) fn shutdown() {
    EMITTER_STOP.store(true, Ordering::SeqCst);
}

pub(crate) fn emit_state(app_handle: &AppHandle, payload: NativeAudioStatePayload) -> Result<(), String> {
    app_handle
        .emit_all(NATIVE_AUDIO_STATE_EVENT, payload)
        .map_err(|e| format!("Failed to emit state: {e}"))
}

pub(crate) fn emit_spectrum(
    app_handle: &AppHandle,
    payload: NativeAudioSpectrumPayload<'_>,
) -> Result<(), String> {
    app_handle
        .emit_all(NATIVE_AUDIO_SPECTRUM_EVENT, payload)
        .map_err(|e| format!("Failed to emit spectrum: {e}"))
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

pub(crate) fn emit_error(app_handle: &AppHandle, payload: NativeAudioErrorPayload) -> Result<(), String> {
    if !mark_error_emitted(payload.seq) {
        return Ok(());
    }
    app_handle
        .emit_all(NATIVE_AUDIO_ERROR_EVENT, payload)
        .map_err(|e| format!("Failed to emit error: {e}"))
}
