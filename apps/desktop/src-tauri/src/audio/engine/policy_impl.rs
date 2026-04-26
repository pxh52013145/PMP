use super::*;
use crate::audio::stability_controller::AudioStabilityContext;

impl NativeAudioEngine {
    pub(super) fn update_shared_timeline_stress_window(&mut self) {
        if !is_shared_output_backend(self.output_backend.id()) {
            self.shared_timeline_stress_until = None;
            return;
        }

        let timeline = crate::audio::diagnostics::snapshot_recent_default();
        let now = Instant::now();
        let now_ms = crate::audio::diagnostics::current_timestamp_ms();
        let recent_threshold_ms = now_ms.saturating_sub(
            SHARED_TIMELINE_STRESS_WINDOW
                .as_millis()
                .min(u64::MAX as u128) as u64,
        );
        if self.shared_timeline_stress_ignore_before_ms > 0
            && now_ms >= self.shared_timeline_stress_ignore_before_ms
        {
            self.shared_timeline_stress_ignore_before_ms = 0;
        }
        let timeline_floor_ms =
            recent_threshold_ms.max(self.shared_timeline_stress_ignore_before_ms);

        let mut low_watermark_hits = 0usize;
        let mut has_underrun = false;

        for event in timeline.events.iter().rev() {
            if event.timestamp_ms < timeline_floor_ms {
                continue;
            }

            match event.kind {
                "shared.transfer.render_low_watermark"
                | "shared.transfer.decode_low_watermark"
                | "shared.render_ahead.low_watermark" => {
                    low_watermark_hits += 1;
                }
                "shared.output.render_underrun" | "shared.render_ahead.underrun" => {
                    has_underrun = true;
                }
                _ => {}
            }
        }

        if has_underrun || low_watermark_hits >= SHARED_TIMELINE_LOW_WATERMARK_TRIGGER {
            let target_until = now + SHARED_TIMELINE_STRESS_EXTENSION;
            self.shared_timeline_stress_until = Some(
                self.shared_timeline_stress_until
                    .map(|current| current.max(target_until))
                    .unwrap_or(target_until),
            );
            return;
        }

        if self
            .shared_timeline_stress_until
            .is_some_and(|until| until <= now)
        {
            self.shared_timeline_stress_until = None;
        }
    }

    pub(super) fn reset_recovery_tracking(&mut self) {
        self.buffering_started_at = None;
        self.buffering_last_progress_at = None;
        self.buffering_last_samples = 0;
        self.buffering_resume_samples = 0;
        self.underrun_recovery_until = None;
        self.shared_timeline_stress_until = None;
        self.last_observed_underrun_events = crate::audio::input::streaming_underrun_stats().0;
        self.shared_timeline_stress_ignore_before_ms =
            crate::audio::diagnostics::current_timestamp_ms()
                .saturating_add(SHARED_TIMELINE_STRESS_RESET_GRACE_MS);
    }

    pub(super) fn update_stability_pressure_state(
        &mut self,
        buffered_ahead_seconds: f64,
        underrun_recovery_active: bool,
        shared_timeline_stress_active: bool,
    ) {
        let output_metrics = crate::audio::output::output_callback_metrics();
        let shared_render_metrics = crate::audio::output::shared_render_ahead_metrics();
        let transfer_stats = crate::audio::input::streaming_transfer_stats();
        let control_plane_stats = crate::audio::control_plane::control_plane_stats_snapshot();
        let memory_pool_stats = crate::audio::memory_pool::stats_snapshot();
        let realtime_memory_stats = crate::audio::realtime_memory_guard::snapshot();

        let decision = self.stability_controller.evaluate(AudioStabilityContext {
            buffered_ahead_seconds,
            underrun_recovery_active,
            shared_timeline_stress_active,
            output_wait_timeout_count: output_metrics.wait_timeout_count,
            output_render_underrun_events: output_metrics.render_underrun_events,
            output_callback_interval_overrun_count: output_metrics.interval_overrun_count,
            shared_render_underrun_events: shared_render_metrics.render_underrun_events,
            shared_render_low_hit_count: shared_render_metrics.render_low_hit_count,
            shared_render_jitter_anomaly_count: shared_render_metrics.jitter_anomaly_count,
            transfer_render_low_hit_count: transfer_stats.render_low_hit_count,
            transfer_decode_low_hit_count: transfer_stats.decode_low_hit_count,
            control_queue_overwrite_events: control_plane_stats.overwrite_events,
            control_queue_drop_newest_events: control_plane_stats.drop_newest_events,
            control_queue_coalesced_overflow_events: control_plane_stats.coalesced_overflow_events,
            control_queue_critical_overflow_events: control_plane_stats.critical_overflow_events,
            memory_pressure_events: SCHEDULER.memory_pressure_events(),
            memory_lock_failure_count: realtime_memory_stats.lock_failure_count,
            memory_lock_skipped_count: realtime_memory_stats.lock_skipped_count,
            memory_pool_growth_events: memory_pool_stats.f32_growth_events,
        });
        crate::audio::stability::set_runtime_action_profile(decision.minimum_profile);

        if let Some(hint) = decision.transient_hint {
            SCHEDULER.record_pressure_hint(hint.minimum_profile, hint.hold_ms);
        }
    }

    pub(super) fn stability_action_profile(&self) -> RealtimePressureProfile {
        self.stability_controller.current_action_profile()
    }

    pub(super) fn stability_primary_reason(&self) -> Option<&'static str> {
        self.stability_controller.current_primary_reason()
    }

    pub(super) fn stability_reason_codes(&self) -> Vec<&'static str> {
        self.stability_controller.current_reason_codes()
    }

    pub(crate) fn engine_policy_payload(&self) -> NativeAudioEnginePolicyPayload {
        NativeAudioEnginePolicyPayload {
            stability_profile: self.stability_profile,
            transport_mode: self.transport_mode,
            hq_src_enabled: self.hq_src_enabled,
            hq_src_phase_mode: self.hq_src_phase_mode,
            src_mode: self.src_mode,
            src_backend: self.src_backend,
            src_target_sample_rate: self.src_target_sample_rate,
            output_quantization_mode: self.output_quantization_mode,
            hq_src_stopband_db: 140,
            transport_exact_int32_container: true,
        }
    }

    pub(crate) fn apply_engine_policy_patch(
        &mut self,
        patch: NativeAudioEnginePolicyPatch,
    ) -> (NativeAudioEnginePolicyPayload, bool) {
        let mut src_changed = false;

        if let Some(profile) = patch.stability_profile {
            self.stability_profile = profile;
            crate::audio::stability::set_stability_profile(profile);
        }
        if let Some(mode) = patch.transport_mode {
            self.transport_mode = mode;
            self.output_backend.set_transport_mode(mode);
        }
        if let Some(output_quantization_mode) = patch.output_quantization_mode {
            self.output_quantization_mode = output_quantization_mode;
            self.output_backend
                .set_output_quantization_mode(output_quantization_mode);
        }
        if let Some(enabled) = patch.hq_src_enabled {
            if self.hq_src_enabled != enabled {
                self.hq_src_enabled = enabled;
                src_changed = true;
            }
        }
        if let Some(phase_mode) = patch.hq_src_phase_mode {
            if self.hq_src_phase_mode != phase_mode {
                self.hq_src_phase_mode = phase_mode;
                src_changed = true;
            }
        }
        if let Some(src_mode) = patch.src_mode {
            if self.src_mode != src_mode {
                self.src_mode = src_mode;
                src_changed = true;
            }
        }
        if let Some(src_backend) = patch.src_backend {
            if self.src_backend != src_backend {
                self.src_backend = src_backend;
                src_changed = true;
            }
        }
        if patch.src_target_sample_rate.is_some() {
            let normalized = patch
                .src_target_sample_rate
                .and_then(Self::sanitize_src_target_sample_rate);
            if self.src_target_sample_rate != normalized {
                self.src_target_sample_rate = normalized;
                src_changed = true;
            }
        }

        (self.engine_policy_payload(), src_changed)
    }

    fn sanitize_src_target_sample_rate(sample_rate: u32) -> Option<u32> {
        Some(sample_rate.clamp(8_000, 768_000))
    }

    pub(super) fn current_src_policy(&self) -> AudioInputSrcPolicy {
        AudioInputSrcPolicy {
            hq_src_enabled: self.hq_src_enabled,
            hq_src_phase_mode: self.hq_src_phase_mode,
            src_mode: self.src_mode,
            src_backend: self.src_backend,
            src_target_sample_rate: self.src_target_sample_rate,
        }
    }

    pub(super) fn effective_src_policy_for_open(&self) -> AudioInputSrcPolicy {
        effective_src_policy_for_backend_open(self.output_backend.id(), self.current_src_policy())
    }
}
