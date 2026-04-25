use std::mem;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::audio::diagnostics;
use crate::audio::realtime_scheduler::{RealtimePressureProfile, SCHEDULER};

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct MemoryPoolStatsSnapshot {
    pub f32_growth_events: u64,
    pub f32_growth_bytes: u64,
    pub f32_prewarm_hits: u64,
}

static F32_GROWTH_EVENTS: AtomicU64 = AtomicU64::new(0);
static F32_GROWTH_BYTES: AtomicU64 = AtomicU64::new(0);
static F32_PREWARM_HITS: AtomicU64 = AtomicU64::new(0);
static F32_GROWTH_TIMELINE_GATE_MS: AtomicU64 = AtomicU64::new(0);

pub(crate) fn reserve_f32_capacity(
    buffer: &mut Vec<f32>,
    required_capacity: usize,
    growth_event_kind: &'static str,
) {
    if buffer.capacity() >= required_capacity {
        F32_PREWARM_HITS.fetch_add(1, Ordering::Relaxed);
        return;
    }

    let previous_capacity = buffer.capacity();
    buffer.reserve(required_capacity.saturating_sub(buffer.len()));
    let grown_samples = buffer.capacity().saturating_sub(previous_capacity);
    if grown_samples == 0 {
        return;
    }

    F32_GROWTH_EVENTS.fetch_add(1, Ordering::Relaxed);
    F32_GROWTH_BYTES.fetch_add(
        (grown_samples.saturating_mul(mem::size_of::<f32>())) as u64,
        Ordering::Relaxed,
    );
    SCHEDULER.record_memory_pressure_signal(RealtimePressureProfile::Guarded);
    diagnostics::record_event_throttled(
        growth_event_kind,
        required_capacity as u64,
        previous_capacity as u64,
        &F32_GROWTH_TIMELINE_GATE_MS,
        200,
    );
}

pub(crate) fn stats_snapshot() -> MemoryPoolStatsSnapshot {
    MemoryPoolStatsSnapshot {
        f32_growth_events: F32_GROWTH_EVENTS.load(Ordering::Relaxed),
        f32_growth_bytes: F32_GROWTH_BYTES.load(Ordering::Relaxed),
        f32_prewarm_hits: F32_PREWARM_HITS.load(Ordering::Relaxed),
    }
}

#[cfg(test)]
pub(crate) fn reset_stats_for_tests() {
    F32_GROWTH_EVENTS.store(0, Ordering::Relaxed);
    F32_GROWTH_BYTES.store(0, Ordering::Relaxed);
    F32_PREWARM_HITS.store(0, Ordering::Relaxed);
    F32_GROWTH_TIMELINE_GATE_MS.store(0, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserve_tracks_growth_and_prewarm_hits() {
        reset_stats_for_tests();

        let mut buffer = Vec::<f32>::with_capacity(16);
        reserve_f32_capacity(&mut buffer, 8, "memory_pool.test_growth");
        let after_prewarm = stats_snapshot();
        assert_eq!(after_prewarm.f32_growth_events, 0);
        assert!(after_prewarm.f32_prewarm_hits >= 1);

        reserve_f32_capacity(&mut buffer, 128, "memory_pool.test_growth");
        let after_growth = stats_snapshot();
        assert_eq!(after_growth.f32_growth_events, 1);
        let min_growth_bytes = (128usize.saturating_sub(16) * mem::size_of::<f32>()) as u64;
        assert!(after_growth.f32_growth_bytes >= min_growth_bytes);
    }

    #[test]
    fn reserve_ensures_required_capacity_when_len_is_zero() {
        reset_stats_for_tests();

        let mut buffer = Vec::<f32>::with_capacity(10);
        buffer.clear();
        reserve_f32_capacity(&mut buffer, 12, "memory_pool.test_capacity_floor");
        assert!(buffer.capacity() >= 12);
    }
}
