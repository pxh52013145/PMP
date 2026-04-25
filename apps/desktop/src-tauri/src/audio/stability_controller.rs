use crate::audio::diagnostics;
use crate::audio::realtime_scheduler::RealtimePressureProfile;
use crate::audio::stability;

const REASON_BUFFER_GUARDED: u32 = 1 << 0;
const REASON_BUFFER_CRITICAL: u32 = 1 << 1;
const REASON_UNDERRUN_RECOVERY: u32 = 1 << 2;
const REASON_SHARED_STRESS: u32 = 1 << 3;
const REASON_OUTPUT_WAIT_TIMEOUT: u32 = 1 << 4;
const REASON_OUTPUT_RENDER_UNDERRUN: u32 = 1 << 5;
const REASON_OUTPUT_CALLBACK_OVERRUN: u32 = 1 << 6;
const REASON_SHARED_RENDER_UNDERRUN: u32 = 1 << 7;
const REASON_SHARED_RENDER_LOW_WATERMARK: u32 = 1 << 8;
const REASON_SHARED_RENDER_JITTER: u32 = 1 << 9;
const REASON_TRANSFER_LOW_WATERMARK: u32 = 1 << 10;
const REASON_CONTROL_QUEUE_OVERFLOW: u32 = 1 << 11;
const REASON_MEMORY_PRESSURE: u32 = 1 << 12;
const REASON_MEMORY_LOCK_FAILURE: u32 = 1 << 13;
const REASON_MEMORY_LOCK_SKIPPED: u32 = 1 << 14;
const REASON_MEMORY_POOL_GROWTH: u32 = 1 << 15;

const GUARDED_BUFFER_SECONDS: f64 = 0.35;
const CRITICAL_BUFFER_SECONDS: f64 = 0.16;

const REASON_ORDER: &[(u32, &str)] = &[
    (REASON_BUFFER_CRITICAL, "buffer-critical"),
    (REASON_BUFFER_GUARDED, "buffer-guarded"),
    (REASON_UNDERRUN_RECOVERY, "underrun-recovery"),
    (REASON_SHARED_STRESS, "shared-stress"),
    (REASON_OUTPUT_WAIT_TIMEOUT, "output-wait-timeout"),
    (REASON_OUTPUT_RENDER_UNDERRUN, "output-render-underrun"),
    (REASON_OUTPUT_CALLBACK_OVERRUN, "output-callback-overrun"),
    (REASON_SHARED_RENDER_UNDERRUN, "shared-render-underrun"),
    (
        REASON_SHARED_RENDER_LOW_WATERMARK,
        "shared-render-low-watermark",
    ),
    (REASON_SHARED_RENDER_JITTER, "shared-render-jitter"),
    (REASON_TRANSFER_LOW_WATERMARK, "transfer-low-watermark"),
    (REASON_CONTROL_QUEUE_OVERFLOW, "control-queue-overflow"),
    (REASON_MEMORY_PRESSURE, "memory-pressure"),
    (REASON_MEMORY_LOCK_FAILURE, "memory-lock-failure"),
    (REASON_MEMORY_LOCK_SKIPPED, "memory-lock-skipped"),
    (REASON_MEMORY_POOL_GROWTH, "memory-pool-growth"),
];

const PRIMARY_REASON_PRIORITY: &[u32] = &[
    REASON_OUTPUT_RENDER_UNDERRUN,
    REASON_SHARED_RENDER_UNDERRUN,
    REASON_OUTPUT_CALLBACK_OVERRUN,
    REASON_OUTPUT_WAIT_TIMEOUT,
    REASON_CONTROL_QUEUE_OVERFLOW,
    REASON_MEMORY_LOCK_FAILURE,
    REASON_MEMORY_PRESSURE,
    REASON_SHARED_RENDER_JITTER,
    REASON_BUFFER_CRITICAL,
    REASON_UNDERRUN_RECOVERY,
    REASON_SHARED_STRESS,
    REASON_TRANSFER_LOW_WATERMARK,
    REASON_SHARED_RENDER_LOW_WATERMARK,
    REASON_MEMORY_LOCK_SKIPPED,
    REASON_MEMORY_POOL_GROWTH,
    REASON_BUFFER_GUARDED,
];

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct AudioStabilityContext {
    pub buffered_ahead_seconds: f64,
    pub underrun_recovery_active: bool,
    pub shared_timeline_stress_active: bool,
    pub output_wait_timeout_count: u64,
    pub output_render_underrun_events: u64,
    pub output_callback_interval_overrun_count: u64,
    pub shared_render_underrun_events: u64,
    pub shared_render_low_hit_count: u64,
    pub shared_render_jitter_anomaly_count: u64,
    pub transfer_render_low_hit_count: u64,
    pub transfer_decode_low_hit_count: u64,
    pub control_queue_overwrite_events: u64,
    pub control_queue_drop_newest_events: u64,
    pub control_queue_coalesced_overflow_events: u64,
    pub control_queue_critical_overflow_events: u64,
    pub memory_pressure_events: u64,
    pub memory_lock_failure_count: u64,
    pub memory_lock_skipped_count: u64,
    pub memory_pool_growth_events: u64,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct AudioStabilityTransientHint {
    pub minimum_profile: RealtimePressureProfile,
    pub hold_ms: u64,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) struct AudioStabilityDecision {
    pub minimum_profile: RealtimePressureProfile,
    pub primary_reason: Option<&'static str>,
    pub reason_codes: Vec<&'static str>,
    pub transient_hint: Option<AudioStabilityTransientHint>,
}

#[derive(Clone, Debug)]
pub(crate) struct AudioStabilityController {
    last_output_wait_timeout_count: u64,
    last_output_render_underrun_events: u64,
    last_output_callback_interval_overrun_count: u64,
    last_shared_render_underrun_events: u64,
    last_shared_render_low_hit_count: u64,
    last_shared_render_jitter_anomaly_count: u64,
    last_transfer_render_low_hit_count: u64,
    last_transfer_decode_low_hit_count: u64,
    last_control_queue_overwrite_events: u64,
    last_control_queue_drop_newest_events: u64,
    last_control_queue_coalesced_overflow_events: u64,
    last_control_queue_critical_overflow_events: u64,
    last_memory_pressure_events: u64,
    last_memory_lock_failure_count: u64,
    last_memory_lock_skipped_count: u64,
    last_memory_pool_growth_events: u64,
    held_reason_mask: u32,
    held_profile: RealtimePressureProfile,
    held_until_ms: u64,
    last_reason_mask: u32,
    last_profile: RealtimePressureProfile,
    last_primary_reason: Option<&'static str>,
}

impl Default for AudioStabilityController {
    fn default() -> Self {
        Self {
            last_output_wait_timeout_count: 0,
            last_output_render_underrun_events: 0,
            last_output_callback_interval_overrun_count: 0,
            last_shared_render_underrun_events: 0,
            last_shared_render_low_hit_count: 0,
            last_shared_render_jitter_anomaly_count: 0,
            last_transfer_render_low_hit_count: 0,
            last_transfer_decode_low_hit_count: 0,
            last_control_queue_overwrite_events: 0,
            last_control_queue_drop_newest_events: 0,
            last_control_queue_coalesced_overflow_events: 0,
            last_control_queue_critical_overflow_events: 0,
            last_memory_pressure_events: 0,
            last_memory_lock_failure_count: 0,
            last_memory_lock_skipped_count: 0,
            last_memory_pool_growth_events: 0,
            held_reason_mask: 0,
            held_profile: RealtimePressureProfile::Normal,
            held_until_ms: 0,
            last_reason_mask: 0,
            last_profile: RealtimePressureProfile::Normal,
            last_primary_reason: None,
        }
    }
}

impl AudioStabilityController {
    pub(crate) fn evaluate(&mut self, context: AudioStabilityContext) -> AudioStabilityDecision {
        let now_ms = diagnostics::current_timestamp_ms();
        if self.held_until_ms <= now_ms {
            self.held_reason_mask = 0;
            self.held_profile = RealtimePressureProfile::Normal;
            self.held_until_ms = 0;
        }

        let guarded_hold_ms = stability::guarded_pressure_hold_ms();
        let critical_hold_ms = stability::critical_pressure_hold_ms();
        let memory_hold_ms = stability::memory_pressure_hold_ms();

        let mut live_reason_mask = 0u32;
        let mut live_profile = RealtimePressureProfile::Normal;

        let buffered_ahead_seconds = if context.buffered_ahead_seconds.is_finite() {
            context.buffered_ahead_seconds.max(0.0)
        } else {
            0.0
        };

        if buffered_ahead_seconds <= CRITICAL_BUFFER_SECONDS {
            live_reason_mask |= REASON_BUFFER_CRITICAL;
            live_profile = live_profile.max(RealtimePressureProfile::Critical);
        } else if buffered_ahead_seconds <= GUARDED_BUFFER_SECONDS {
            live_reason_mask |= REASON_BUFFER_GUARDED;
            live_profile = live_profile.max(RealtimePressureProfile::Guarded);
        }

        if context.underrun_recovery_active {
            live_reason_mask |= REASON_UNDERRUN_RECOVERY;
            live_profile = live_profile.max(RealtimePressureProfile::Guarded);
        }

        if context.shared_timeline_stress_active {
            live_reason_mask |= REASON_SHARED_STRESS;
            live_profile = live_profile.max(RealtimePressureProfile::Guarded);
        }

        let mut transient_reason_mask = 0u32;
        let mut transient_profile = RealtimePressureProfile::Normal;
        let mut transient_hold_ms = 0u64;

        let mut trigger_reason =
            |reason_mask: u32, profile: RealtimePressureProfile, hold_ms: u64| {
                transient_reason_mask |= reason_mask;
                transient_profile = transient_profile.max(profile);
                transient_hold_ms = transient_hold_ms.max(hold_ms);
            };

        if take_counter_delta(
            &mut self.last_output_render_underrun_events,
            context.output_render_underrun_events,
        ) > 0
        {
            trigger_reason(
                REASON_OUTPUT_RENDER_UNDERRUN,
                RealtimePressureProfile::Critical,
                critical_hold_ms,
            );
        }

        if take_counter_delta(
            &mut self.last_shared_render_underrun_events,
            context.shared_render_underrun_events,
        ) > 0
        {
            trigger_reason(
                REASON_SHARED_RENDER_UNDERRUN,
                RealtimePressureProfile::Critical,
                critical_hold_ms,
            );
        }

        if take_counter_delta(
            &mut self.last_output_wait_timeout_count,
            context.output_wait_timeout_count,
        ) > 0
        {
            trigger_reason(
                REASON_OUTPUT_WAIT_TIMEOUT,
                RealtimePressureProfile::Critical,
                critical_hold_ms,
            );
        }

        if take_counter_delta(
            &mut self.last_output_callback_interval_overrun_count,
            context.output_callback_interval_overrun_count,
        ) > 0
        {
            trigger_reason(
                REASON_OUTPUT_CALLBACK_OVERRUN,
                RealtimePressureProfile::Critical,
                critical_hold_ms,
            );
        }

        if take_counter_delta(
            &mut self.last_control_queue_critical_overflow_events,
            context.control_queue_critical_overflow_events,
        ) > 0
        {
            trigger_reason(
                REASON_CONTROL_QUEUE_OVERFLOW,
                RealtimePressureProfile::Critical,
                critical_hold_ms,
            );
        }

        let shared_low_delta = take_counter_delta(
            &mut self.last_shared_render_low_hit_count,
            context.shared_render_low_hit_count,
        );
        if shared_low_delta > 0 {
            trigger_reason(
                REASON_SHARED_RENDER_LOW_WATERMARK,
                RealtimePressureProfile::Guarded,
                guarded_hold_ms,
            );
        }

        let shared_jitter_delta = take_counter_delta(
            &mut self.last_shared_render_jitter_anomaly_count,
            context.shared_render_jitter_anomaly_count,
        );
        if shared_jitter_delta > 0 {
            let profile = if shared_jitter_delta >= 2 {
                RealtimePressureProfile::Critical
            } else {
                RealtimePressureProfile::Guarded
            };
            trigger_reason(
                REASON_SHARED_RENDER_JITTER,
                profile,
                if matches!(profile, RealtimePressureProfile::Critical) {
                    critical_hold_ms
                } else {
                    guarded_hold_ms
                },
            );
        }

        let transfer_render_delta = take_counter_delta(
            &mut self.last_transfer_render_low_hit_count,
            context.transfer_render_low_hit_count,
        );
        let transfer_decode_delta = take_counter_delta(
            &mut self.last_transfer_decode_low_hit_count,
            context.transfer_decode_low_hit_count,
        );
        if transfer_render_delta > 0 || transfer_decode_delta > 0 {
            trigger_reason(
                REASON_TRANSFER_LOW_WATERMARK,
                RealtimePressureProfile::Guarded,
                guarded_hold_ms,
            );
        }

        let control_overflow_delta = take_counter_delta(
            &mut self.last_control_queue_overwrite_events,
            context.control_queue_overwrite_events,
        ) + take_counter_delta(
            &mut self.last_control_queue_drop_newest_events,
            context.control_queue_drop_newest_events,
        ) + take_counter_delta(
            &mut self.last_control_queue_coalesced_overflow_events,
            context.control_queue_coalesced_overflow_events,
        );
        if control_overflow_delta > 0 {
            trigger_reason(
                REASON_CONTROL_QUEUE_OVERFLOW,
                RealtimePressureProfile::Guarded,
                guarded_hold_ms,
            );
        }

        if take_counter_delta(
            &mut self.last_memory_pressure_events,
            context.memory_pressure_events,
        ) > 0
        {
            trigger_reason(
                REASON_MEMORY_PRESSURE,
                RealtimePressureProfile::Guarded,
                memory_hold_ms,
            );
        }

        if take_counter_delta(
            &mut self.last_memory_lock_failure_count,
            context.memory_lock_failure_count,
        ) > 0
        {
            trigger_reason(
                REASON_MEMORY_LOCK_FAILURE,
                RealtimePressureProfile::Guarded,
                memory_hold_ms,
            );
        }

        if take_counter_delta(
            &mut self.last_memory_lock_skipped_count,
            context.memory_lock_skipped_count,
        ) > 0
        {
            trigger_reason(
                REASON_MEMORY_LOCK_SKIPPED,
                RealtimePressureProfile::Guarded,
                memory_hold_ms,
            );
        }

        if take_counter_delta(
            &mut self.last_memory_pool_growth_events,
            context.memory_pool_growth_events,
        ) > 0
        {
            trigger_reason(
                REASON_MEMORY_POOL_GROWTH,
                RealtimePressureProfile::Guarded,
                guarded_hold_ms,
            );
        }

        let transient_hint = if transient_reason_mask != 0 {
            self.held_reason_mask |= transient_reason_mask;
            self.held_profile = self.held_profile.max(transient_profile);
            self.held_until_ms = self
                .held_until_ms
                .max(now_ms.saturating_add(transient_hold_ms));
            Some(AudioStabilityTransientHint {
                minimum_profile: transient_profile,
                hold_ms: transient_hold_ms,
            })
        } else {
            None
        };

        let held_reason_mask = if self.held_until_ms > now_ms {
            self.held_reason_mask
        } else {
            0
        };
        let held_profile = if self.held_until_ms > now_ms {
            self.held_profile
        } else {
            RealtimePressureProfile::Normal
        };

        let decision_reason_mask = live_reason_mask | held_reason_mask;
        let decision_profile = live_profile.max(held_profile);
        let primary_reason = primary_reason_for_mask(decision_reason_mask);
        let reason_codes = reason_codes_for_mask(decision_reason_mask);

        self.last_reason_mask = decision_reason_mask;
        self.last_profile = decision_profile;
        self.last_primary_reason = primary_reason;

        AudioStabilityDecision {
            minimum_profile: decision_profile,
            primary_reason,
            reason_codes,
            transient_hint,
        }
    }

    pub(crate) fn current_action_profile(&self) -> RealtimePressureProfile {
        self.last_profile
    }

    pub(crate) fn current_primary_reason(&self) -> Option<&'static str> {
        self.last_primary_reason
    }

    pub(crate) fn current_reason_codes(&self) -> Vec<&'static str> {
        reason_codes_for_mask(self.last_reason_mask)
    }
}

fn take_counter_delta(last_seen: &mut u64, current: u64) -> u64 {
    let delta = if current >= *last_seen {
        current.saturating_sub(*last_seen)
    } else {
        current
    };
    *last_seen = current;
    delta
}

fn reason_codes_for_mask(reason_mask: u32) -> Vec<&'static str> {
    let mut codes = Vec::new();
    for (mask, code) in REASON_ORDER {
        if reason_mask & *mask != 0 {
            codes.push(*code);
        }
    }
    codes
}

fn primary_reason_for_mask(reason_mask: u32) -> Option<&'static str> {
    for candidate in PRIMARY_REASON_PRIORITY {
        if reason_mask & *candidate != 0 {
            return REASON_ORDER
                .iter()
                .find_map(|(mask, code)| (*mask == *candidate).then_some(*code));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn controller_holds_transient_callback_pressure() {
        let mut controller = AudioStabilityController::default();

        let decision = controller.evaluate(AudioStabilityContext {
            output_wait_timeout_count: 1,
            ..AudioStabilityContext::default()
        });
        assert!(matches!(
            decision.minimum_profile,
            RealtimePressureProfile::Critical
        ));
        assert_eq!(decision.primary_reason, Some("output-wait-timeout"));
        assert!(decision.reason_codes.contains(&"output-wait-timeout"));
        assert!(decision.transient_hint.is_some());

        let follow_up = controller.evaluate(AudioStabilityContext::default());
        assert!(matches!(
            follow_up.minimum_profile,
            RealtimePressureProfile::Critical
        ));
        assert_eq!(follow_up.primary_reason, Some("output-wait-timeout"));
    }

    #[test]
    fn controller_marks_live_buffer_pressure_without_transient_hint() {
        let mut controller = AudioStabilityController::default();

        let decision = controller.evaluate(AudioStabilityContext {
            buffered_ahead_seconds: 0.10,
            ..AudioStabilityContext::default()
        });
        assert!(matches!(
            decision.minimum_profile,
            RealtimePressureProfile::Critical
        ));
        assert_eq!(decision.primary_reason, Some("buffer-critical"));
        assert!(decision.transient_hint.is_none());
    }

    #[test]
    fn controller_prefers_explicit_fault_reason_over_buffer_reason() {
        let mut controller = AudioStabilityController::default();

        let decision = controller.evaluate(AudioStabilityContext {
            buffered_ahead_seconds: 0.12,
            output_render_underrun_events: 1,
            ..AudioStabilityContext::default()
        });
        assert_eq!(decision.primary_reason, Some("output-render-underrun"));
    }
}
