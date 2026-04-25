use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

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

    fn max(self, other: Self) -> Self {
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
    pressure_hold_profile: AtomicU8,
    pressure_hold_until_ms: AtomicU64,
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
            pressure_hold_profile: AtomicU8::new(RealtimePressureProfile::Normal as u8),
            pressure_hold_until_ms: AtomicU64::new(0),
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

        let computed = match current {
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

        let next = computed.max(self.active_pressure_hold_profile());
        self.profile.store(next as u8, Ordering::Release);
        next
    }

    pub(crate) fn record_memory_pressure_signal(&self, minimum_profile: RealtimePressureProfile) {
        self.memory_pressure_events.fetch_add(1, Ordering::Relaxed);
        self.extend_pressure_hold(minimum_profile);
        let minimum = minimum_profile as u8;
        let mut current = self.profile.load(Ordering::Acquire);
        while current < minimum {
            match self.profile.compare_exchange(
                current,
                minimum,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => break,
                Err(next) => current = next,
            }
        }
    }

    fn extend_pressure_hold(&self, minimum_profile: RealtimePressureProfile) {
        let minimum = minimum_profile as u8;
        let mut current_hold = self.pressure_hold_profile.load(Ordering::Acquire);
        while current_hold < minimum {
            match self.pressure_hold_profile.compare_exchange(
                current_hold,
                minimum,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => break,
                Err(next) => current_hold = next,
            }
        }

        let until_ms =
            current_time_ms().saturating_add(crate::audio::stability::memory_pressure_hold_ms());
        let mut current_until = self.pressure_hold_until_ms.load(Ordering::Acquire);
        while current_until < until_ms {
            match self.pressure_hold_until_ms.compare_exchange(
                current_until,
                until_ms,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => break,
                Err(next) => current_until = next,
            }
        }
    }

    fn active_pressure_hold_profile(&self) -> RealtimePressureProfile {
        let until_ms = self.pressure_hold_until_ms.load(Ordering::Acquire);
        if until_ms == 0 {
            return RealtimePressureProfile::Normal;
        }

        let now_ms = current_time_ms();
        if until_ms > now_ms {
            return RealtimePressureProfile::from_u8(
                self.pressure_hold_profile.load(Ordering::Acquire),
            );
        }

        self.pressure_hold_profile
            .store(RealtimePressureProfile::Normal as u8, Ordering::Release);
        self.pressure_hold_until_ms.store(0, Ordering::Release);
        RealtimePressureProfile::Normal
    }

    pub(crate) fn memory_pressure_events(&self) -> u64 {
        self.memory_pressure_events.load(Ordering::Relaxed)
    }

    #[cfg(test)]
    fn clear_pressure_hold_for_tests(&self) {
        self.pressure_hold_profile
            .store(RealtimePressureProfile::Normal as u8, Ordering::Release);
        self.pressure_hold_until_ms.store(0, Ordering::Release);
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
    fn memory_pressure_signal_promotes_profile() {
        let scheduler = RealtimeScheduler::new();

        assert_eq!(scheduler.profile(), RealtimePressureProfile::Normal);
        scheduler.record_memory_pressure_signal(RealtimePressureProfile::Guarded);

        assert_eq!(scheduler.profile(), RealtimePressureProfile::Guarded);
        assert_eq!(scheduler.memory_pressure_events(), 1);
    }

    #[test]
    fn memory_pressure_hold_prevents_immediate_recovery() {
        let scheduler = RealtimeScheduler::new();

        scheduler.record_memory_pressure_signal(RealtimePressureProfile::Guarded);

        assert_eq!(
            scheduler.update(2.0, false),
            RealtimePressureProfile::Guarded
        );

        scheduler.clear_pressure_hold_for_tests();
        assert_eq!(
            scheduler.update(2.0, false),
            RealtimePressureProfile::Normal
        );
    }

    #[test]
    fn critical_memory_pressure_hold_is_not_demoted_by_full_buffer() {
        let scheduler = RealtimeScheduler::new();

        scheduler.record_memory_pressure_signal(RealtimePressureProfile::Critical);

        assert_eq!(
            scheduler.update(2.0, false),
            RealtimePressureProfile::Critical
        );
    }
}
