use super::*;

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

    pub(crate) fn engine_policy_payload(&self) -> NativeAudioEnginePolicyPayload {
        NativeAudioEnginePolicyPayload {
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
