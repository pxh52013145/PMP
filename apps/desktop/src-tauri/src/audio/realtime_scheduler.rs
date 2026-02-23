use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicU8, Ordering};

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
}

pub(crate) struct RealtimeScheduler {
    profile: AtomicU8,
}

impl RealtimeScheduler {
    const GUARDED_ENTER_SECONDS: f64 = 0.35;
    const GUARDED_EXIT_SECONDS: f64 = 0.50;
    const CRITICAL_ENTER_SECONDS: f64 = 0.16;
    const CRITICAL_EXIT_SECONDS: f64 = 0.24;

    pub(crate) fn new() -> Self {
        Self {
            profile: AtomicU8::new(RealtimePressureProfile::Normal as u8),
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
}
