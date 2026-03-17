use super::*;

pub(super) fn rebuild_sink_on_new_device_impl(
    engine: &mut NativeAudioEngine,
) -> Result<(), String> {
    engine.cancel_crossfade();
    let Some(track_path) = engine.current_track.clone() else {
        return Ok(());
    };

    let was_error = matches!(engine.playback_state, PlaybackState::Error);
    let resume_playing = matches!(engine.desired_playback_state, PlaybackState::Playing);

    if resume_playing {
        engine.update_position_from_clock();
    }
    let target = engine.current_position.max(0.0);

    let maybe_rodio_source = if engine.streaming.is_none() && engine.decoded_samples.is_none() {
        Some(
            open_rodio_source_at(&track_path, target)
                .map_err(|err| format!("[{}] {}", err.code, err.message))?,
        )
    } else {
        None
    };

    // Attempt to create the new sink first so we can bail out without disrupting playback.
    let (sink, output_info) = engine.output_backend.create_sink()?;

    // Commit point: stop current playback before mutating shared state (DSP runtime / streaming buffer).
    engine.sync_clock();
    if let Some(old_sink) = engine.sink.take() {
        engine.stop_and_release_sink(old_sink, RuntimeReleaseMode::Deferred);
    }

    engine.apply_output_stream_info(output_info);

    engine.spectrum_pre_tap.clear();
    engine.spectrum_post_tap.clear();
    engine.dsp_runtime.request_reset();

    let (source, channels, sample_rate) = if let Some(streaming) = &engine.streaming {
        let seek_dispatched = streaming
            .command_tx
            .send(DecoderCommand::Seek(target))
            .is_ok();
        if seek_dispatched {
            streaming.buffer.clear();
            streaming.render_queue.clear();
            (
                Box::new(StreamingSamplesSource::new(
                    streaming.render_queue.clone(),
                    engine.decoded_channels.max(1),
                    engine.decoded_sample_rate.max(1),
                    engine.duration,
                )) as crate::audio::output::BoxedSource,
                engine.decoded_channels,
                engine.decoded_sample_rate,
            )
        } else {
            info_log(
                    "[NativeAudio] Streaming decoder is unavailable while rebuilding sink; reloading stream pipeline.",
                );
            engine.reload_track_for_seek_recovery(track_path.clone())?;
            if target > 0.0 {
                engine.seek(target)?;
            }
            if resume_playing {
                engine.play()?;
            }
            return Ok(());
        }
    } else if let Some(samples) = engine.decoded_samples.clone() {
        let channels = engine.decoded_channels.max(1);
        let sample_rate = engine.decoded_sample_rate.max(1);
        let start_sample = ((target * sample_rate as f64) as usize) * channels as usize;
        (
            Box::new(SharedSamplesSource::new(
                samples,
                channels,
                sample_rate,
                start_sample,
            )) as crate::audio::output::BoxedSource,
            channels,
            sample_rate,
        )
    } else {
        let (source, meta) =
            maybe_rodio_source.expect("rodio source prepared when no streaming/decoded samples");
        (source, meta.channels, meta.sample_rate)
    };

    engine.mixer = Some(engine.append_source_with_pipeline(
        &sink,
        source,
        channels.max(1),
        sample_rate.max(1),
    ));

    sink.pause();
    sink.set_volume(engine.effective_volume());

    if resume_playing {
        if let Some(streaming) = &engine.streaming {
            let channels = engine.decoded_channels.max(1) as usize;
            let remaining_duration = if engine.duration.is_finite() && engine.duration > 0.0 {
                (engine.duration - target).max(0.0)
            } else {
                engine.duration
            };
            let (target_samples, timeout) = engine.streaming_prebuffer_interactive_wait(
                engine.decoded_sample_rate,
                channels,
                streaming.render_queue.capacity_samples(),
                remaining_duration,
                StreamingPrebufferKind::StartOrSeek,
                engine.streaming_prebuffer_start_or_seek_seconds,
            );
            if streaming.render_queue.len_samples() < target_samples {
                streaming
                    .render_queue
                    .wait_for_samples(target_samples, timeout);
            }
        }

        engine.play_sink_with_shared_guard(&sink);
        engine.base_position = target;
        engine.playback_started_at = Some(Instant::now());
        engine.set_state(PlaybackState::Playing);
    } else {
        engine.base_position = target;
        engine.playback_started_at = None;
    }

    engine.current_position = target;
    engine.sink = Some(sink);

    if was_error {
        engine.clear_error();
        engine.playback_state = engine.desired_playback_state;
    }

    Ok(())
}
