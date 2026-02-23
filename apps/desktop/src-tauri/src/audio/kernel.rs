use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};

use super::{
    engine::{
        self, CrossfadeOperation, LoadOperation, NativeAudioEngine, PlaybackState,
        PreparedCrossfade, PreparedLoad, StreamingPrebufferKind, ENGINE,
    },
    events::NativeAudioStatePayload,
    input::{AudioInputDecodeMode, AudioInputKind, StreamingPlayback},
    mixer::{coerce_source_format, PlaybackMixerSource},
    pipeline::boxed_with_dsp,
    policy::{NativeAudioEnginePolicyPatch, NativeAudioEnginePolicyPayload},
};

fn transport_start_decode_mode(mode: AudioInputDecodeMode) -> AudioInputDecodeMode {
    match mode {
        AudioInputDecodeMode::FullTrack => AudioInputDecodeMode::StreamingFullTrack,
        other => other,
    }
}

pub(crate) struct TransportExecution {
    pub(crate) result: Result<(), String>,
    pub(crate) state_payload: NativeAudioStatePayload,
}

pub(crate) enum CrossfadeExecution {
    Applied(TransportExecution),
    FallbackLoad { was_playing: bool },
}

fn with_engine_mut<T>(f: impl FnOnce(&mut NativeAudioEngine) -> T) -> Result<T, String> {
    let mut engine = ENGINE
        .lock()
        .map_err(|_| "Audio engine is locked".to_string())?;
    Ok(f(&mut engine))
}

fn wait_for_streaming_prebuffer(wait: Option<engine::StreamingPrebufferWaitRequest>) {
    if let Some(wait) = wait {
        if wait.render_queue.len_samples() < wait.target_samples {
            wait.render_queue
                .wait_for_samples(wait.target_samples, wait.timeout);
        }
    }
}

fn prepare_load_for_operation(
    op: &LoadOperation,
    track_path: &Path,
) -> Result<PreparedLoad, String> {
    let (sink, output_info) = op.output_backend.create_sink()?;
    sink.pause();

    let open_src_policy =
        engine::effective_src_policy_for_backend_open(op.output_backend.id(), op.src_policy);
    let opened = op
        .input_registry
        .open_prefer(
            track_path,
            engine::resolve_requested_output_sample_rate_for_backend(
                op.output_backend.id(),
                output_info.output_sample_rate,
                op.src_policy,
            ),
            op.preferred_input_id.as_deref(),
            op.decode_mode,
            open_src_policy,
        )
        .map_err(|err| format!("[{}] {}", err.code, err.message))?;

    let crate::audio::input::AudioInputOpenResult {
        input_id,
        meta,
        kind,
        source,
    } = opened;

    eprintln!("[NativeAudio] Input: {input_id}");

    let mut streaming: Option<StreamingPlayback> = None;
    let mut decoded_samples: Option<Arc<Vec<f32>>> = None;

    match kind {
        AudioInputKind::Streaming(playback) => {
            streaming = Some(playback);
        }
        AudioInputKind::Decoded { samples } => {
            decoded_samples = Some(samples);
        }
        AudioInputKind::Rodio => {}
    }

    let (controller, mixer_source) =
        PlaybackMixerSource::new(source, meta.channels, meta.sample_rate);
    sink.append(boxed_with_dsp(
        mixer_source,
        op.dsp_runtime.clone(),
        op.spectrum_pre_tap.clone(),
        op.spectrum_post_tap.clone(),
    ));
    sink.pause();
    sink.set_volume(op.effective_volume);

    Ok(PreparedLoad {
        track_path: track_path.to_path_buf(),
        sink,
        output_info,
        mixer: controller,
        input_id,
        meta,
        streaming,
        decoded_samples,
    })
}

fn prepare_crossfade_for_operation(
    op: &CrossfadeOperation,
    track_path: &Path,
    duration_ms: u64,
) -> Result<PreparedCrossfade, String> {
    let open_src_policy =
        engine::effective_src_policy_for_backend_open(&op.output_backend_id, op.src_policy);
    let opened = op
        .input_registry
        .open_prefer(
            track_path,
            engine::resolve_requested_output_sample_rate_for_backend(
                &op.output_backend_id,
                Some(op.target_sample_rate),
                op.src_policy,
            ),
            op.preferred_input_id.as_deref(),
            op.decode_mode,
            open_src_policy,
        )
        .map_err(|err| format!("[{}] {}", err.code, err.message))?;

    let crate::audio::input::AudioInputOpenResult {
        input_id,
        meta,
        kind,
        source,
    } = opened;

    eprintln!("[NativeAudio] Input: {input_id}");

    let mut streaming: Option<StreamingPlayback> = None;
    let mut decoded_samples: Option<Arc<Vec<f32>>> = None;
    match kind {
        AudioInputKind::Streaming(playback) => {
            streaming = Some(playback);
        }
        AudioInputKind::Decoded { samples } => {
            decoded_samples = Some(samples);
        }
        AudioInputKind::Rodio => {}
    }

    if let Some(streaming) = &streaming {
        let channels = meta.channels.max(1) as usize;
        let (target_samples, timeout) = engine::streaming_prebuffer_interactive_wait_with_policy(
            &op.output_backend_id,
            op.target_sample_rate,
            channels,
            streaming.render_queue.capacity_samples(),
            meta.duration,
            StreamingPrebufferKind::Crossfade,
            op.streaming_prebuffer_crossfade_seconds,
            op.interactive_wait_policy,
        );
        wait_for_streaming_prebuffer(Some(engine::StreamingPrebufferWaitRequest {
            render_queue: streaming.render_queue.clone(),
            target_samples,
            timeout,
        }));
    }

    let next_source = coerce_source_format(source, op.target_channels, op.target_sample_rate);
    let decoded_samples = if decoded_samples.is_some()
        && (meta.channels != op.target_channels || meta.sample_rate != op.target_sample_rate)
    {
        None
    } else {
        decoded_samples
    };

    let duration_frames =
        ((op.target_sample_rate as u64).saturating_mul(duration_ms.clamp(1, 30_000))) / 1000;

    Ok(PreparedCrossfade {
        track_path: track_path.to_path_buf(),
        input_id,
        meta,
        streaming,
        decoded_samples,
        next_source,
        old_shutdown_tx: op.old_shutdown_tx.clone(),
        target_channels: op.target_channels,
        target_sample_rate: op.target_sample_rate,
        duration_frames: duration_frames.max(1),
    })
}

pub(crate) fn execute_load(track_path: PathBuf) -> Result<TransportExecution, String> {
    let started_at = Instant::now();
    let mut op = with_engine_mut(|engine| engine.begin_load_operation())?;
    op.decode_mode = transport_start_decode_mode(op.decode_mode);
    let prepared = prepare_load_for_operation(&op, &track_path);
    crate::audio::diagnostics::record_event(
        "transport.load.prepare",
        started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
        prepared.is_ok() as u64,
    );

    let execution = match prepared {
        Ok(prepared) => with_engine_mut(|engine| {
            let result = engine
                .commit_load_operation(op.token, prepared)
                .map(|_| ())
                .map_err(|err| {
                    engine.abandon_operation(op.token);
                    engine.set_error("NATIVE_AUDIO_LOAD_FAILED", err.clone());
                    err
                });
            TransportExecution {
                result,
                state_payload: engine.build_transport_state_payload(false),
            }
        })?,
        Err(err) => with_engine_mut(|engine| {
            engine.abandon_operation(op.token);
            engine.set_error("NATIVE_AUDIO_LOAD_FAILED", err.clone());
            TransportExecution {
                result: Err(err),
                state_payload: engine.build_transport_state_payload(false),
            }
        })?,
    };

    crate::audio::diagnostics::record_event(
        "transport.load.total",
        started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
        execution.result.is_ok() as u64,
    );

    Ok(execution)
}

pub(crate) fn execute_load_and_play(
    track_path: PathBuf,
    replay_gain_db: Option<f32>,
) -> Result<TransportExecution, String> {
    let started_at = Instant::now();
    let mut op = with_engine_mut(|engine| engine.begin_load_operation())?;
    op.decode_mode = transport_start_decode_mode(op.decode_mode);
    let prepared = prepare_load_for_operation(&op, &track_path);
    crate::audio::diagnostics::record_event(
        "transport.load_and_play.prepare",
        started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
        prepared.is_ok() as u64,
    );

    let (result, committed, prebuffer_wait) = match prepared {
        Ok(prepared) => {
            with_engine_mut(
                |engine| match engine.commit_load_operation(op.token, prepared) {
                    Ok(committed) => {
                        if committed {
                            engine.set_replay_gain(replay_gain_db);
                        }
                        let prebuffer_wait = if committed {
                            engine.extract_play_prebuffer_wait_request()
                        } else {
                            None
                        };
                        (Ok(()), committed, prebuffer_wait)
                    }
                    Err(err) => {
                        engine.abandon_operation(op.token);
                        engine.set_error("NATIVE_AUDIO_LOAD_FAILED", err.clone());
                        (Err(err), false, None)
                    }
                },
            )?
        }
        Err(err) => with_engine_mut(|engine| {
            engine.abandon_operation(op.token);
            engine.set_error("NATIVE_AUDIO_LOAD_FAILED", err.clone());
            (Err(err), false, None)
        })?,
    };

    if committed {
        wait_for_streaming_prebuffer(prebuffer_wait);
    }

    let execution = with_engine_mut(move |engine| {
        if committed {
            if let Err(err) = engine.play_without_prebuffer_wait() {
                engine.set_error("NATIVE_AUDIO_PLAY_FAILED", err);
            }
        }

        TransportExecution {
            result,
            state_payload: engine.build_transport_state_payload(false),
        }
    })?;

    crate::audio::diagnostics::record_event(
        "transport.load_and_play.total",
        started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
        execution.result.is_ok() as u64,
    );

    Ok(execution)
}

pub(crate) fn execute_play() -> Result<TransportExecution, String> {
    let prebuffer_wait = with_engine_mut(|engine| engine.extract_play_prebuffer_wait_request())?;
    wait_for_streaming_prebuffer(prebuffer_wait);

    let execution = with_engine_mut(|engine| {
        let result = engine.play_without_prebuffer_wait().map_err(|err| {
            engine.set_error("NATIVE_AUDIO_PLAY_FAILED", err.clone());
            err
        });
        TransportExecution {
            result,
            state_payload: engine.build_transport_state_payload(false),
        }
    })?;

    Ok(execution)
}

pub(crate) fn execute_pause() -> Result<TransportExecution, String> {
    let execution = with_engine_mut(|engine| {
        let result = engine.pause().map_err(|err| {
            engine.set_error("NATIVE_AUDIO_PAUSE_FAILED", err.clone());
            err
        });
        TransportExecution {
            result,
            state_payload: engine.build_transport_state_payload(false),
        }
    })?;

    Ok(execution)
}

pub(crate) fn execute_stop() -> Result<TransportExecution, String> {
    let execution = with_engine_mut(|engine| {
        engine.stop();
        TransportExecution {
            result: Ok(()),
            state_payload: engine.build_transport_state_payload(false),
        }
    })?;

    Ok(execution)
}

pub(crate) fn execute_seek_command(
    exec_seq: u64,
    exec_time: f64,
    latest_requested_seek_seq: Option<u64>,
) -> Result<TransportExecution, String> {
    let execution = with_engine_mut(|engine| {
        if exec_seq == 0 || !exec_time.is_finite() {
            return TransportExecution {
                result: Ok(()),
                state_payload: engine.build_transport_state_payload(false),
            };
        }

        if !engine.should_accept_seek_command(Some(exec_seq), latest_requested_seek_seq) {
            return TransportExecution {
                result: Ok(()),
                state_payload: engine.build_transport_state_payload(false),
            };
        }

        let result = engine.seek(exec_time).map_err(|err| {
            engine.set_error("NATIVE_AUDIO_SEEK_FAILED", err.clone());
            err
        });

        TransportExecution {
            result,
            state_payload: engine.build_transport_state_payload(false),
        }
    })?;

    Ok(execution)
}

pub(crate) fn execute_crossfade(
    track_path: PathBuf,
    duration_ms: u64,
) -> Result<CrossfadeExecution, String> {
    let started_at = Instant::now();
    let (was_playing, op) = with_engine_mut(|engine| {
        let was_playing = matches!(engine.playback_state(), PlaybackState::Playing);
        let op = engine.begin_crossfade_operation(duration_ms);
        (was_playing, op)
    })?;

    let Some(mut op) = op else {
        crate::audio::diagnostics::record_event(
            "transport.crossfade.fallback",
            started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
            0,
        );
        return Ok(CrossfadeExecution::FallbackLoad { was_playing });
    };

    op.decode_mode = transport_start_decode_mode(op.decode_mode);

    let prepared = prepare_crossfade_for_operation(&op, &track_path, duration_ms);
    crate::audio::diagnostics::record_event(
        "transport.crossfade.prepare",
        started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
        prepared.is_ok() as u64,
    );
    let execution = match prepared {
        Ok(prepared) => with_engine_mut(|engine| {
            let result = engine
                .commit_crossfade_operation(op.token, prepared)
                .map(|_| ())
                .map_err(|err| {
                    engine.abandon_operation(op.token);
                    engine.set_error("NATIVE_AUDIO_CROSSFADE_FAILED", err.clone());
                    err
                });

            TransportExecution {
                result,
                state_payload: engine.build_transport_state_payload(false),
            }
        })?,
        Err(err) => with_engine_mut(|engine| {
            engine.abandon_operation(op.token);
            engine.set_error("NATIVE_AUDIO_CROSSFADE_FAILED", err.clone());
            TransportExecution {
                result: Err(err),
                state_payload: engine.build_transport_state_payload(false),
            }
        })?,
    };

    crate::audio::diagnostics::record_event(
        "transport.crossfade.total",
        started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
        execution.result.is_ok() as u64,
    );

    Ok(CrossfadeExecution::Applied(execution))
}

pub(crate) fn execute_crossfade_or_load(
    track_path: PathBuf,
    duration_ms: u64,
) -> Result<Vec<TransportExecution>, String> {
    match execute_crossfade(track_path.clone(), duration_ms)? {
        CrossfadeExecution::Applied(execution) => Ok(vec![execution]),
        CrossfadeExecution::FallbackLoad { was_playing } => {
            if was_playing {
                Ok(vec![execute_load_and_play(track_path, None)?])
            } else {
                Ok(vec![execute_load(track_path)?])
            }
        }
    }
}

pub(crate) fn apply_engine_policy(
    patch: NativeAudioEnginePolicyPatch,
) -> Result<NativeAudioEnginePolicyPayload, String> {
    struct SrcPolicyRebuildContext {
        op: LoadOperation,
        track_path: PathBuf,
        seek_target: f64,
        resume_playing: bool,
    }

    let (policy_payload, maybe_rebuild) = with_engine_mut(|engine| {
        let (payload, src_changed) = engine.apply_engine_policy_patch(patch);

        if !src_changed {
            return (payload, None);
        }

        let Some(track_path) = engine.current_track() else {
            return (payload, None);
        };

        let resume_playing = matches!(engine.desired_playback_state(), PlaybackState::Playing);
        if resume_playing {
            engine.sync_clock();
        }
        let seek_target = engine.current_position().max(0.0);
        let op = engine.begin_load_operation();

        (
            payload,
            Some(SrcPolicyRebuildContext {
                op,
                track_path,
                seek_target,
                resume_playing,
            }),
        )
    })?;

    if let Some(context) = maybe_rebuild {
        let prepared = prepare_load_for_operation(&context.op, &context.track_path);
        let (should_resume, prebuffer_wait) = with_engine_mut(|engine| match prepared {
            Ok(prepared) => {
                let committed = engine
                    .commit_load_operation(context.op.token, prepared)
                    .map_err(|err| {
                        engine.abandon_operation(context.op.token);
                        engine.set_error("NATIVE_AUDIO_SRC_RECONFIGURE_FAILED", err.clone());
                        err
                    });

                if let Ok(true) = committed {
                    if context.seek_target > 0.0 {
                        if let Err(err) = engine.seek(context.seek_target) {
                            engine.set_error("NATIVE_AUDIO_SRC_RECONFIGURE_FAILED", err);
                        }
                    }
                    if context.resume_playing {
                        return (true, engine.extract_play_prebuffer_wait_request());
                    }
                }

                (false, None)
            }
            Err(err) => {
                engine.abandon_operation(context.op.token);
                engine.set_error("NATIVE_AUDIO_SRC_RECONFIGURE_FAILED", err);
                (false, None)
            }
        })?;

        if should_resume {
            wait_for_streaming_prebuffer(prebuffer_wait);
            with_engine_mut(|engine| {
                if let Err(err) = engine.play_without_prebuffer_wait() {
                    engine.set_error("NATIVE_AUDIO_SRC_RECONFIGURE_FAILED", err);
                }
            })?;
        }
    }

    Ok(policy_payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{Arc, Barrier},
        thread,
        time::{Duration, Instant},
    };

    use crate::audio::buffer::AudioRingBuffer;

    #[test]
    fn crossfade_returns_fallback_when_transport_is_not_playing() {
        {
            let mut engine = ENGINE.lock().expect("engine lock");
            engine.stop();
            engine.set_state(PlaybackState::Idle);
        }

        let execution = execute_crossfade(PathBuf::from("dummy.wav"), 500)
            .expect("crossfade execution should not fail");

        match execution {
            CrossfadeExecution::FallbackLoad { was_playing } => {
                assert!(!was_playing, "fallback should report non-playing state");
            }
            CrossfadeExecution::Applied(_) => {
                panic!("crossfade should fallback when transport is idle");
            }
        }
    }

    #[test]
    fn seek_command_ignores_invalid_sequence_without_error() {
        let execution = execute_seek_command(0, 1.0, Some(1)).expect("seek execution");
        assert!(execution.result.is_ok(), "invalid seek should be ignored");
        assert!(execution.state_payload.error_code.is_none());
    }

    #[test]
    fn prebuffer_wait_does_not_hold_engine_mutex() {
        let render_queue = AudioRingBuffer::new(1024);
        let wait = engine::StreamingPrebufferWaitRequest {
            render_queue,
            target_samples: 512,
            timeout: Duration::from_millis(140),
        };

        let barrier = Arc::new(Barrier::new(2));
        let barrier_worker = barrier.clone();
        let wait_thread = thread::spawn(move || {
            barrier_worker.wait();
            let started_at = Instant::now();
            wait_for_streaming_prebuffer(Some(wait));
            started_at.elapsed()
        });

        barrier.wait();

        let probe_deadline = Instant::now() + Duration::from_millis(120);
        let mut acquired = false;
        while Instant::now() < probe_deadline {
            if let Ok(guard) = ENGINE.try_lock() {
                drop(guard);
                acquired = true;
                break;
            }
            thread::sleep(Duration::from_millis(2));
        }

        let waited = wait_thread.join().expect("wait thread should complete");
        assert!(
            acquired,
            "engine mutex should remain lockable while prebuffer wait is in-flight"
        );
        assert!(
            waited >= Duration::from_millis(120),
            "expected prebuffer wait to block long enough for lock probing, waited={waited:?}"
        );
    }
}
