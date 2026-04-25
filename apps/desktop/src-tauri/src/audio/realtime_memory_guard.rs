use std::sync::atomic::{AtomicU64, Ordering};

use crate::audio::buffer::AudioRingBuffer;
use crate::audio::diagnostics;
use crate::audio::realtime_scheduler::{RealtimePressureProfile, SCHEDULER};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub(crate) enum AudioRealtimeMemoryRole {
    DecodeReservoir = 0,
    StreamingRenderQueue = 1,
    SharedRenderQueue = 2,
    WasapiExclusiveRenderQueue = 3,
    WasapiSharedRawRenderQueue = 4,
}

impl AudioRealtimeMemoryRole {
    fn bit(self) -> u64 {
        1u64 << (self as u8)
    }

    fn code(self) -> u64 {
        self as u64
    }

    fn env_key(self) -> &'static str {
        match self {
            Self::DecodeReservoir => "PMP_AUDIO_LOCK_BUDGET_DECODE_RESERVOIR_BYTES",
            Self::StreamingRenderQueue => "PMP_AUDIO_LOCK_BUDGET_STREAMING_RENDER_QUEUE_BYTES",
            Self::SharedRenderQueue => "PMP_AUDIO_LOCK_BUDGET_SHARED_RENDER_QUEUE_BYTES",
            Self::WasapiExclusiveRenderQueue => "PMP_AUDIO_LOCK_BUDGET_WASAPI_EXCLUSIVE_BYTES",
            Self::WasapiSharedRawRenderQueue => "PMP_AUDIO_LOCK_BUDGET_WASAPI_SHARED_RAW_BYTES",
        }
    }

    fn default_budget_bytes(self) -> u64 {
        const MIB: u64 = 1024 * 1024;
        match self {
            Self::DecodeReservoir => 48 * MIB,
            Self::StreamingRenderQueue => 16 * MIB,
            Self::SharedRenderQueue => 24 * MIB,
            Self::WasapiExclusiveRenderQueue => 8 * MIB,
            Self::WasapiSharedRawRenderQueue => 16 * MIB,
        }
    }

    fn lock_budget_bytes(self) -> u64 {
        std::env::var(self.env_key())
            .ok()
            .and_then(|raw| raw.trim().parse::<u64>().ok())
            .filter(|value| *value > 0)
            .unwrap_or_else(|| self.default_budget_bytes())
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct AudioRealtimeMemoryGuardSnapshot {
    pub lock_attempted_bytes: u64,
    pub lock_succeeded_bytes: u64,
    pub lock_failed_bytes: u64,
    pub lock_skipped_bytes: u64,
    pub lock_failure_count: u64,
    pub lock_skipped_count: u64,
    pub locked_role_mask: u64,
    pub failed_role_mask: u64,
    pub skipped_role_mask: u64,
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct AudioRealtimeMemoryGuardResult {
    pub attempted_bytes: u64,
    pub succeeded_bytes: u64,
    pub failed_bytes: u64,
    pub skipped_bytes: u64,
    pub locked: bool,
}

static LOCK_ATTEMPTED_BYTES: AtomicU64 = AtomicU64::new(0);
static LOCK_SUCCEEDED_BYTES: AtomicU64 = AtomicU64::new(0);
static LOCK_FAILED_BYTES: AtomicU64 = AtomicU64::new(0);
static LOCK_SKIPPED_BYTES: AtomicU64 = AtomicU64::new(0);
static LOCK_FAILURE_COUNT: AtomicU64 = AtomicU64::new(0);
static LOCK_SKIPPED_COUNT: AtomicU64 = AtomicU64::new(0);
static LOCKED_ROLE_MASK: AtomicU64 = AtomicU64::new(0);
static FAILED_ROLE_MASK: AtomicU64 = AtomicU64::new(0);
static SKIPPED_ROLE_MASK: AtomicU64 = AtomicU64::new(0);
static LOCK_FAILURE_TIMELINE_GATE_MS: AtomicU64 = AtomicU64::new(0);
static LOCK_SKIPPED_TIMELINE_GATE_MS: AtomicU64 = AtomicU64::new(0);

pub(crate) fn new_guarded_ring_buffer(
    capacity_samples: usize,
    role: AudioRealtimeMemoryRole,
) -> AudioRingBuffer {
    let buffer = AudioRingBuffer::new(capacity_samples);
    let _ = guard_ring_buffer(role, &buffer);
    buffer
}

pub(crate) fn guard_ring_buffer(
    role: AudioRealtimeMemoryRole,
    buffer: &AudioRingBuffer,
) -> AudioRealtimeMemoryGuardResult {
    buffer.pre_touch_pages();
    let requested_bytes = buffer.lock_bytes().min(u64::MAX as usize) as u64;
    if requested_bytes == 0 {
        return AudioRealtimeMemoryGuardResult::default();
    }

    let budget_bytes = role.lock_budget_bytes();
    if requested_bytes > budget_bytes {
        LOCK_SKIPPED_COUNT.fetch_add(1, Ordering::Relaxed);
        LOCK_SKIPPED_BYTES.fetch_add(requested_bytes, Ordering::Relaxed);
        SKIPPED_ROLE_MASK.fetch_or(role.bit(), Ordering::Relaxed);
        SCHEDULER.record_memory_pressure_signal(RealtimePressureProfile::Guarded);
        diagnostics::record_event_throttled(
            "audio.memory.lock_skipped_budget",
            role.code(),
            requested_bytes,
            &LOCK_SKIPPED_TIMELINE_GATE_MS,
            500,
        );
        return AudioRealtimeMemoryGuardResult {
            skipped_bytes: requested_bytes,
            ..AudioRealtimeMemoryGuardResult::default()
        };
    }

    LOCK_ATTEMPTED_BYTES.fetch_add(requested_bytes, Ordering::Relaxed);

    #[cfg(not(target_os = "windows"))]
    {
        LOCK_SKIPPED_COUNT.fetch_add(1, Ordering::Relaxed);
        LOCK_SKIPPED_BYTES.fetch_add(requested_bytes, Ordering::Relaxed);
        SKIPPED_ROLE_MASK.fetch_or(role.bit(), Ordering::Relaxed);
        return AudioRealtimeMemoryGuardResult {
            attempted_bytes: requested_bytes,
            skipped_bytes: requested_bytes,
            ..AudioRealtimeMemoryGuardResult::default()
        };
    }

    #[cfg(target_os = "windows")]
    {
        if buffer.try_lock_memory_pages() {
            LOCK_SUCCEEDED_BYTES.fetch_add(requested_bytes, Ordering::Relaxed);
            LOCKED_ROLE_MASK.fetch_or(role.bit(), Ordering::Relaxed);
            return AudioRealtimeMemoryGuardResult {
                attempted_bytes: requested_bytes,
                succeeded_bytes: requested_bytes,
                locked: true,
                ..AudioRealtimeMemoryGuardResult::default()
            };
        }

        LOCK_FAILURE_COUNT.fetch_add(1, Ordering::Relaxed);
        LOCK_FAILED_BYTES.fetch_add(requested_bytes, Ordering::Relaxed);
        FAILED_ROLE_MASK.fetch_or(role.bit(), Ordering::Relaxed);
        SCHEDULER.record_memory_pressure_signal(RealtimePressureProfile::Guarded);
        diagnostics::record_event_throttled(
            "audio.memory.lock_failed",
            role.code(),
            requested_bytes,
            &LOCK_FAILURE_TIMELINE_GATE_MS,
            500,
        );
        AudioRealtimeMemoryGuardResult {
            attempted_bytes: requested_bytes,
            failed_bytes: requested_bytes,
            ..AudioRealtimeMemoryGuardResult::default()
        }
    }
}

pub(crate) fn snapshot() -> AudioRealtimeMemoryGuardSnapshot {
    AudioRealtimeMemoryGuardSnapshot {
        lock_attempted_bytes: LOCK_ATTEMPTED_BYTES.load(Ordering::Relaxed),
        lock_succeeded_bytes: LOCK_SUCCEEDED_BYTES.load(Ordering::Relaxed),
        lock_failed_bytes: LOCK_FAILED_BYTES.load(Ordering::Relaxed),
        lock_skipped_bytes: LOCK_SKIPPED_BYTES.load(Ordering::Relaxed),
        lock_failure_count: LOCK_FAILURE_COUNT.load(Ordering::Relaxed),
        lock_skipped_count: LOCK_SKIPPED_COUNT.load(Ordering::Relaxed),
        locked_role_mask: LOCKED_ROLE_MASK.load(Ordering::Relaxed),
        failed_role_mask: FAILED_ROLE_MASK.load(Ordering::Relaxed),
        skipped_role_mask: SKIPPED_ROLE_MASK.load(Ordering::Relaxed),
    }
}

#[cfg(test)]
pub(crate) fn reset_for_tests() {
    LOCK_ATTEMPTED_BYTES.store(0, Ordering::Relaxed);
    LOCK_SUCCEEDED_BYTES.store(0, Ordering::Relaxed);
    LOCK_FAILED_BYTES.store(0, Ordering::Relaxed);
    LOCK_SKIPPED_BYTES.store(0, Ordering::Relaxed);
    LOCK_FAILURE_COUNT.store(0, Ordering::Relaxed);
    LOCK_SKIPPED_COUNT.store(0, Ordering::Relaxed);
    LOCKED_ROLE_MASK.store(0, Ordering::Relaxed);
    FAILED_ROLE_MASK.store(0, Ordering::Relaxed);
    SKIPPED_ROLE_MASK.store(0, Ordering::Relaxed);
    LOCK_FAILURE_TIMELINE_GATE_MS.store(0, Ordering::Relaxed);
    LOCK_SKIPPED_TIMELINE_GATE_MS.store(0, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn over_budget_ring_is_recorded_as_skipped() {
        reset_for_tests();
        std::env::set_var("PMP_AUDIO_LOCK_BUDGET_DECODE_RESERVOIR_BYTES", "1");
        let buffer = new_guarded_ring_buffer(16, AudioRealtimeMemoryRole::DecodeReservoir);
        std::env::remove_var("PMP_AUDIO_LOCK_BUDGET_DECODE_RESERVOIR_BYTES");

        let snapshot = snapshot();
        assert_eq!(buffer.capacity_samples(), 16);
        assert_eq!(snapshot.lock_attempted_bytes, 0);
        assert!(snapshot.lock_skipped_bytes >= 16 * std::mem::size_of::<f32>() as u64);
        assert_eq!(
            snapshot.skipped_role_mask & AudioRealtimeMemoryRole::DecodeReservoir.bit(),
            AudioRealtimeMemoryRole::DecodeReservoir.bit()
        );
    }
}
