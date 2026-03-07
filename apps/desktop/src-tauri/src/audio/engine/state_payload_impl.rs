use super::*;

impl NativeAudioEngine {
    pub(crate) fn build_state_payload(&self, ended: bool) -> NativeAudioStatePayload {
        self.build_state_payload_with_options(ended, true, true, true)
    }

    pub(crate) fn build_extended_tick_state_payload(&self, ended: bool) -> NativeAudioStatePayload {
        self.build_state_payload_with_options(ended, true, false, true)
    }

    pub(crate) fn build_transport_state_payload(&self, ended: bool) -> NativeAudioStatePayload {
        self.build_state_payload_with_options(ended, true, false, false)
    }

    pub(crate) fn build_tick_state_payload(&self, ended: bool) -> NativeAudioStatePayload {
        let mut payload = self.build_state_payload_with_options(ended, false, false, false);
        // High-frequency tick payload is intentionally compact to reduce WebView bridge allocation
        // pressure. Full diagnostics/metrics are still available via command-triggered state
        // payloads and periodic extended ticks in the emitter.
        payload.sample_rate = None;
        payload.source_sample_rate = None;
        payload.bit_depth = None;
        payload.device = None;
        payload.track_path = None;
        payload.queue = None;
        payload.current_index = None;
        payload.scheduler_profile = None;
        payload.transport_mode = None;
        payload.hq_src_phase_mode = None;
        payload.src_mode = None;
        payload.src_backend = None;
        payload.src_target_sample_rate = None;
        payload.output_quantization_mode = None;
        payload.hq_src_stopband_db = None;
        payload.hq_src_active = None;
        payload.hq_src_ratio = None;
        payload.transport_exact_int32_container = None;
        payload.output_callback_metrics_valid = None;
        payload.output_callback_p99_us = None;
        payload.output_wait_timeout_count = None;
        payload.output_render_underrun_events = None;
        payload.output_render_underrun_frames = None;
        payload.output_callback_interval_jitter_p99_us = None;
        payload.output_callback_interval_overrun_count = None;
        payload.output_callback_expected_interval_us = None;
        payload.transfer_low_watermark_samples = None;
        payload.transfer_render_low_hit_count = None;
        payload.transfer_decode_low_hit_count = None;
        payload.transfer_adaptation_level = None;
        payload.transfer_oscillation_streak = None;
        payload.render_queue_page_locked = None;
        payload.shared_render_ahead_enabled = None;
        payload.shared_render_underrun_events = None;
        payload.shared_render_underrun_frames = None;
        payload.shared_render_low_hit_count = None;
        payload.shared_render_low_watermark_samples = None;
        payload.memory_pool_f32_growth_events = None;
        payload.memory_pool_f32_growth_bytes = None;
        payload.memory_pool_f32_prewarm_hits = None;
        payload.control_queue_lock_free = None;
        payload.control_queue_mode = None;
        payload.control_queue_capacity = None;
        payload.control_queue_overwrite_events = None;
        payload.control_queue_drop_newest_events = None;
        payload.control_queue_coalesced_overflow_events = None;
        payload.control_queue_critical_overflow_events = None;
        payload.retire_pending_tasks = None;
        payload.retire_enqueued_total = None;
        payload.retire_executed_total = None;
        payload.retire_inline_fallback_total = None;
        payload.retire_panic_total = None;
        payload.diagnostic_timeline_dropped_events = None;
        payload.diagnostic_timeline = None;
        payload
    }

    pub(crate) fn build_components_payload(&self) -> NativeAudioComponentsStatePayload {
        let current_output_info = self.output_backend.current_info();
        let default_output_info = self.output_backend.default_device_info();
        let output_sample_rate = self
            .output_sample_rate
            .or(current_output_info.output_sample_rate);
        NativeAudioComponentsStatePayload {
            output_backend_id: self.output_backend.id().to_string(),
            output_device_id: self
                .device_id
                .clone()
                .or_else(|| current_output_info.device_id.clone())
                .or_else(|| current_output_info.device_name.clone())
                .or_else(|| default_output_info.device_id.clone())
                .or_else(|| default_output_info.device_name.clone()),
            output_device: self
                .device_name
                .clone()
                .or_else(|| current_output_info.device_name.clone())
                .or_else(|| default_output_info.device_name.clone()),
            output_sample_rate,
            preferred_input_id: self.preferred_input_id.clone(),
            active_input_id: self.active_input_id.clone(),
        }
    }
}

pub(super) fn build_state_payload_with_options_impl(
    engine: &NativeAudioEngine,
    ended: bool,
    include_track_path: bool,
    include_queue: bool,
    include_diagnostics: bool,
) -> NativeAudioStatePayload {
    let (underrun_events, underrun_frames) = crate::audio::input::streaming_underrun_stats();
    let (
        transfer_low_watermark_samples,
        transfer_render_low_hit_count,
        transfer_decode_low_hit_count,
        render_queue_page_locked,
        transfer_adaptation_level,
        transfer_oscillation_streak,
    ) = crate::audio::input::streaming_transfer_stats();

    #[cfg(target_os = "windows")]
    let output_metrics = crate::audio::output::output_callback_metrics();
    #[cfg(not(target_os = "windows"))]
    let output_metrics = crate::audio::output::OutputCallbackMetricsSnapshot::default();

    let output_route_info = {
        let current_output_info = engine.output_backend.current_info();
        let default_output_info = engine.output_backend.default_device_info();
        OutputStreamInfo {
            device_id: engine
                .device_id
                .clone()
                .or_else(|| current_output_info.device_id.clone())
                .or_else(|| current_output_info.device_name.clone())
                .or_else(|| default_output_info.device_id.clone())
                .or_else(|| default_output_info.device_name.clone()),
            device_name: engine
                .device_name
                .clone()
                .or_else(|| current_output_info.device_name.clone())
                .or_else(|| default_output_info.device_name.clone()),
            output_sample_rate: engine
                .output_sample_rate
                .or(current_output_info.output_sample_rate),
        }
    };
    let output_callback_metrics_valid = engine.output_backend.id() == "wasapi-exclusive"
        || engine.output_backend.id() == "wasapi-shared-raw";
    let shared_render_backend = is_shared_output_backend(engine.output_backend.id());
    let shared_render_metrics = crate::audio::output::shared_render_ahead_metrics();
    let memory_pool_stats = crate::audio::memory_pool::stats_snapshot();
    let control_plane_stats = crate::audio::control_plane::control_plane_stats_snapshot();
    let retire_plane_stats = crate::audio::retire_plane::stats_snapshot();
    let diagnostics_timeline = if include_diagnostics {
        Some(crate::audio::diagnostics::snapshot_recent_default())
    } else {
        None
    };
    let transfer_metrics_valid = matches!(
        engine.active_input_id.as_deref(),
        Some(SYMPHONIA_INPUT_ID) | Some(SACD_INPUT_ID)
    );

    let (buffered_time, buffered_ahead, decode_buffered_ahead, output_buffered_ahead) =
        if let Some(streaming) = &engine.streaming {
            let channels = engine.decoded_channels.max(1) as f64;
            let sample_rate = engine.decoded_sample_rate.max(1) as f64;
            let decode_seconds = (streaming.buffer.len_samples() as f64 / channels) / sample_rate;
            let output_seconds =
                (streaming.render_queue.len_samples() as f64 / channels) / sample_rate;
            let buffered_seconds = decode_seconds + output_seconds;
            let buffered_time = if engine.duration > 0.0 {
                (engine.current_position + buffered_seconds).min(engine.duration)
            } else {
                engine.current_position + buffered_seconds
            };
            (
                buffered_time,
                buffered_seconds,
                decode_seconds,
                output_seconds,
            )
        } else if engine.decoded_samples.is_some() && engine.duration > 0.0 {
            let ahead = (engine.duration - engine.current_position).max(0.0);
            (engine.duration, ahead, ahead, ahead)
        } else {
            (engine.current_position, 0.0, 0.0, 0.0)
        };

    NativeAudioStatePayload {
        playback_state: engine.playback_state.as_str().to_string(),
        volume: engine.volume,
        gain_db: engine.gain_db,
        replay_gain_db: engine.replay_gain_db,
        dynamic_gain_enabled: engine.dsp_runtime.dynamic_gain_enabled(),
        dynamic_gain_db: engine.dsp_runtime.dynamic_gain_db(),
        muted: engine.muted,
        track_path: if include_track_path {
            engine
                .current_track
                .as_ref()
                .and_then(|path| path.to_str().map(|s| s.to_string()))
        } else {
            None
        },
        current_time: engine.current_position,
        duration: engine.duration,
        buffered_time,
        buffered_ahead,
        decode_buffered_ahead,
        output_buffered_ahead,
        sample_rate: if engine.decoded_sample_rate > 0 {
            Some(engine.decoded_sample_rate)
        } else {
            None
        },
        source_sample_rate: if engine.source_sample_rate > 0 {
            Some(engine.source_sample_rate)
        } else {
            None
        },
        bit_depth: engine.decoded_bit_depth,
        device: output_route_info.device_name.clone(),
        queue: if include_queue && engine.queue_initialized {
            Some(
                engine
                    .queue
                    .iter()
                    .filter_map(|path| path.to_str().map(|s| s.to_string()))
                    .collect(),
            )
        } else {
            None
        },
        current_index: if engine.queue_initialized {
            Some(engine.current_index)
        } else {
            None
        },
        ended,
        underrun_events,
        underrun_frames,
        scheduler_profile: Some(match SCHEDULER.profile() {
            RealtimePressureProfile::Normal => "normal".to_string(),
            RealtimePressureProfile::Guarded => "guarded".to_string(),
            RealtimePressureProfile::Critical => "critical".to_string(),
        }),
        hq_src_active: Some(
            matches!(engine.src_mode, NativeAudioSrcMode::SourceNative)
                || engine.hq_src_enabled
                    && engine.source_sample_rate > 0
                    && engine.decoded_sample_rate > 0
                    && engine.source_sample_rate != engine.decoded_sample_rate,
        ),
        hq_src_ratio: if engine.source_sample_rate > 0 && engine.decoded_sample_rate > 0 {
            Some(engine.decoded_sample_rate as f64 / engine.source_sample_rate as f64)
        } else {
            None
        },
        transport_mode: Some(engine.transport_mode.as_str().to_string()),
        hq_src_phase_mode: Some(engine.hq_src_phase_mode.as_str().to_string()),
        src_mode: Some(engine.src_mode.as_str().to_string()),
        src_backend: Some(engine.src_backend.as_str().to_string()),
        src_target_sample_rate: engine.src_target_sample_rate,
        output_quantization_mode: Some(engine.output_quantization_mode.as_str().to_string()),
        hq_src_stopband_db: Some(140),
        transport_exact_int32_container: Some(true),
        output_callback_metrics_valid: Some(output_callback_metrics_valid),
        output_callback_p99_us: if output_callback_metrics_valid {
            Some(output_metrics.render_p99_us)
        } else {
            None
        },
        output_wait_timeout_count: if output_callback_metrics_valid {
            Some(output_metrics.wait_timeout_count)
        } else {
            None
        },
        output_render_underrun_events: if output_callback_metrics_valid {
            Some(output_metrics.render_underrun_events)
        } else {
            None
        },
        output_render_underrun_frames: if output_callback_metrics_valid {
            Some(output_metrics.render_underrun_frames)
        } else {
            None
        },
        output_callback_interval_jitter_p99_us: if output_callback_metrics_valid {
            Some(output_metrics.interval_jitter_p99_us)
        } else {
            None
        },
        output_callback_interval_overrun_count: if output_callback_metrics_valid {
            Some(output_metrics.interval_overrun_count)
        } else {
            None
        },
        output_callback_expected_interval_us: if output_callback_metrics_valid {
            Some(output_metrics.expected_interval_us)
        } else {
            None
        },
        transfer_low_watermark_samples: if transfer_metrics_valid {
            Some(transfer_low_watermark_samples)
        } else {
            None
        },
        transfer_render_low_hit_count: if transfer_metrics_valid {
            Some(transfer_render_low_hit_count)
        } else {
            None
        },
        transfer_decode_low_hit_count: if transfer_metrics_valid {
            Some(transfer_decode_low_hit_count)
        } else {
            None
        },
        transfer_adaptation_level: if transfer_metrics_valid {
            Some(transfer_adaptation_level)
        } else {
            None
        },
        transfer_oscillation_streak: if transfer_metrics_valid {
            Some(transfer_oscillation_streak)
        } else {
            None
        },
        render_queue_page_locked: if transfer_metrics_valid {
            Some(render_queue_page_locked)
        } else {
            None
        },
        shared_render_ahead_enabled: Some(shared_render_backend),
        shared_render_underrun_events: if shared_render_backend {
            Some(shared_render_metrics.render_underrun_events)
        } else {
            None
        },
        shared_render_underrun_frames: if shared_render_backend {
            Some(shared_render_metrics.render_underrun_frames)
        } else {
            None
        },
        shared_render_low_hit_count: if shared_render_backend {
            Some(shared_render_metrics.render_low_hit_count)
        } else {
            None
        },
        shared_render_low_watermark_samples: if shared_render_backend {
            Some(shared_render_metrics.render_low_watermark_samples)
        } else {
            None
        },
        memory_pool_f32_growth_events: Some(memory_pool_stats.f32_growth_events),
        memory_pool_f32_growth_bytes: Some(memory_pool_stats.f32_growth_bytes),
        memory_pool_f32_prewarm_hits: Some(memory_pool_stats.f32_prewarm_hits),
        control_queue_lock_free: Some(control_plane_stats.mode_lock_free),
        control_queue_mode: Some(control_plane_stats.mode_name.to_string()),
        control_queue_capacity: Some(control_plane_stats.queue_capacity),
        control_queue_overwrite_events: Some(control_plane_stats.overwrite_events),
        control_queue_drop_newest_events: Some(control_plane_stats.drop_newest_events),
        control_queue_coalesced_overflow_events: Some(
            control_plane_stats.coalesced_overflow_events,
        ),
        control_queue_critical_overflow_events: Some(control_plane_stats.critical_overflow_events),
        retire_pending_tasks: Some(retire_plane_stats.pending_tasks),
        retire_enqueued_total: Some(retire_plane_stats.enqueued_total),
        retire_executed_total: Some(retire_plane_stats.executed_total),
        retire_inline_fallback_total: Some(retire_plane_stats.inline_fallback_total),
        retire_panic_total: Some(retire_plane_stats.panic_total),
        diagnostic_timeline_dropped_events: diagnostics_timeline
            .as_ref()
            .map(|timeline| timeline.dropped_events),
        diagnostic_timeline: diagnostics_timeline.map(|timeline| timeline.events),
        error_seq: engine
            .last_error_code
            .as_ref()
            .map(|_| engine.last_error_seq)
            .filter(|seq| *seq > 0),
        error_code: engine.last_error_code.clone(),
        error_message: engine.last_error_message.clone(),
    }
}
