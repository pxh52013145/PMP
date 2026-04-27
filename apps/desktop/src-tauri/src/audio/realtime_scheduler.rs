use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub(crate) enum RealtimePressureProfile {
    Normal = 0,
    Guarded = 1,
    Critical = 2,
}

impl RealtimePressureProfile {
    fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::Guarded,
            2 => Self::Critical,
            _ => Self::Normal,
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Guarded => "guarded",
            Self::Critical => "critical",
        }
    }

    pub(crate) fn max(self, other: Self) -> Self {
        if self as u8 >= other as u8 {
            self
        } else {
            other
        }
    }
}

pub(crate) struct RealtimeScheduler {
    profile: AtomicU8,
    memory_pressure_events: AtomicU64,
}

impl RealtimeScheduler {
    const GUARDED_ENTER_SECONDS: f64 = 0.35;
    const GUARDED_EXIT_SECONDS: f64 = 0.50;
    const CRITICAL_ENTER_SECONDS: f64 = 0.16;
    const CRITICAL_EXIT_SECONDS: f64 = 0.24;

    pub(crate) fn new() -> Self {
        Self {
            profile: AtomicU8::new(RealtimePressureProfile::Normal as u8),
            memory_pressure_events: AtomicU64::new(0),
        }
    }

    pub(crate) fn profile(&self) -> RealtimePressureProfile {
        RealtimePressureProfile::from_u8(self.profile.load(Ordering::Acquire))
    }

    pub(crate) fn update(
        &self,
        buffered_ahead_seconds: f64,
        underrun_recovery_active: bool,
    ) -> RealtimePressureProfile {
        let buffered_ahead_seconds = if buffered_ahead_seconds.is_finite() {
            buffered_ahead_seconds.max(0.0)
        } else {
            0.0
        };

        let current = self.profile();

        let next = match current {
            RealtimePressureProfile::Normal => {
                if buffered_ahead_seconds <= Self::CRITICAL_ENTER_SECONDS {
                    RealtimePressureProfile::Critical
                } else if underrun_recovery_active
                    || buffered_ahead_seconds <= Self::GUARDED_ENTER_SECONDS
                {
                    RealtimePressureProfile::Guarded
                } else {
                    RealtimePressureProfile::Normal
                }
            }
            RealtimePressureProfile::Guarded => {
                if buffered_ahead_seconds <= Self::CRITICAL_ENTER_SECONDS {
                    RealtimePressureProfile::Critical
                } else if !underrun_recovery_active
                    && buffered_ahead_seconds >= Self::GUARDED_EXIT_SECONDS
                {
                    RealtimePressureProfile::Normal
                } else {
                    RealtimePressureProfile::Guarded
                }
            }
            RealtimePressureProfile::Critical => {
                if buffered_ahead_seconds >= Self::CRITICAL_EXIT_SECONDS {
                    if !underrun_recovery_active
                        && buffered_ahead_seconds >= Self::GUARDED_EXIT_SECONDS
                    {
                        RealtimePressureProfile::Normal
                    } else {
                        RealtimePressureProfile::Guarded
                    }
                } else {
                    RealtimePressureProfile::Critical
                }
            }
        };

        self.profile.store(next as u8, Ordering::Release);
        next
    }

    pub(crate) fn record_memory_pressure_signal(&self, _minimum_profile: RealtimePressureProfile) {
        self.memory_pressure_events.fetch_add(1, Ordering::Relaxed);
    }

    #[allow(dead_code)]
    pub(crate) fn record_pressure_hint(
        &self,
        _minimum_profile: RealtimePressureProfile,
        _hold_ms: u64,
    ) {
    }

    pub(crate) fn memory_pressure_events(&self) -> u64 {
        self.memory_pressure_events.load(Ordering::Relaxed)
    }
}

pub(crate) static SCHEDULER: Lazy<RealtimeScheduler> = Lazy::new(RealtimeScheduler::new);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scheduler_uses_hysteresis_for_profile_recovery() {
        let scheduler = RealtimeScheduler::new();

        assert_eq!(
            scheduler.update(0.10, false),
            RealtimePressureProfile::Critical
        );
        assert_eq!(
            scheduler.update(0.20, false),
            RealtimePressureProfile::Critical
        );
        assert_eq!(
            scheduler.update(0.26, false),
            RealtimePressureProfile::Guarded
        );
        assert_eq!(
            scheduler.update(0.40, false),
            RealtimePressureProfile::Guarded
        );
        assert_eq!(
            scheduler.update(0.55, false),
            RealtimePressureProfile::Normal
        );
    }

    #[test]
    fn scheduler_keeps_guarded_during_recovery_hint() {
        let scheduler = RealtimeScheduler::new();

        assert_eq!(
            scheduler.update(0.60, true),
            RealtimePressureProfile::Guarded
        );
        assert_eq!(
            scheduler.update(0.70, true),
            RealtimePressureProfile::Guarded
        );
        assert_eq!(
            scheduler.update(0.70, false),
            RealtimePressureProfile::Normal
        );
    }

    #[test]
    fn memory_pressure_signal_is_observable_but_does_not_override_buffer_hysteresis() {
        let scheduler = RealtimeScheduler::new();

        scheduler.record_memory_pressure_signal(RealtimePressureProfile::Critical);

        assert_eq!(scheduler.memory_pressure_events(), 1);
        assert_eq!(scheduler.profile(), RealtimePressureProfile::Normal);
        assert_eq!(
            scheduler.update(2.0, false),
            RealtimePressureProfile::Normal
        );
    }
}
