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
    const GUARDED_BUFFER_AHEAD_SECONDS: f64 = 0.35;
    const CRITICAL_BUFFER_AHEAD_SECONDS: f64 = 0.16;

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

        let next = if buffered_ahead_seconds <= Self::CRITICAL_BUFFER_AHEAD_SECONDS {
            RealtimePressureProfile::Critical
        } else if underrun_recovery_active
            || buffered_ahead_seconds <= Self::GUARDED_BUFFER_AHEAD_SECONDS
        {
            RealtimePressureProfile::Guarded
        } else {
            RealtimePressureProfile::Normal
        };

        self.profile.store(next as u8, Ordering::Release);
        next
    }
}

pub(crate) static SCHEDULER: Lazy<RealtimeScheduler> = Lazy::new(RealtimeScheduler::new);
