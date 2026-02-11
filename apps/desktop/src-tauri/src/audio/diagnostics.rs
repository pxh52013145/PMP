use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use once_cell::sync::Lazy;
use serde::Serialize;

const TIMELINE_CAPACITY: usize = 128;
const RECENT_DEFAULT_LIMIT: usize = 24;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudioDiagnosticEvent {
    pub seq: u64,
    pub timestamp_ms: u64,
    pub kind: &'static str,
    pub value: u64,
    pub aux: u64,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct AudioDiagnosticTimelineSnapshot {
    pub events: Vec<AudioDiagnosticEvent>,
    pub dropped_events: u64,
}

static TIMELINE: Lazy<Mutex<VecDeque<AudioDiagnosticEvent>>> =
    Lazy::new(|| Mutex::new(VecDeque::with_capacity(TIMELINE_CAPACITY)));
static TIMELINE_NEXT_SEQ: AtomicU64 = AtomicU64::new(1);
static TIMELINE_DROPPED: AtomicU64 = AtomicU64::new(0);
static START_EPOCH_MS: Lazy<u64> = Lazy::new(|| {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
});
static START_INSTANT: Lazy<Instant> = Lazy::new(Instant::now);

fn now_ms() -> u64 {
    START_EPOCH_MS.saturating_add(
        START_INSTANT
            .elapsed()
            .as_millis()
            .min(u64::MAX as u128) as u64,
    )
}

pub(crate) fn current_timestamp_ms() -> u64 {
    now_ms()
}

pub(crate) fn record_event(kind: &'static str, value: u64, aux: u64) {
    let seq = TIMELINE_NEXT_SEQ.fetch_add(1, Ordering::Relaxed);
    let event = AudioDiagnosticEvent {
        seq,
        timestamp_ms: now_ms(),
        kind,
        value,
        aux,
    };

    let mut timeline = match TIMELINE.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            TIMELINE_DROPPED.fetch_add(1, Ordering::Relaxed);
            return;
        }
    };

    if timeline.len() >= TIMELINE_CAPACITY {
        timeline.pop_front();
    }
    timeline.push_back(event);
}

pub(crate) fn record_event_throttled(
    kind: &'static str,
    value: u64,
    aux: u64,
    throttle_state: &AtomicU64,
    min_interval_ms: u64,
) {
    let now = now_ms();

    loop {
        let previous = throttle_state.load(Ordering::Relaxed);
        if previous > 0 && now < previous.saturating_add(min_interval_ms) {
            return;
        }

        match throttle_state.compare_exchange(
            previous,
            now,
            Ordering::Relaxed,
            Ordering::Relaxed,
        ) {
            Ok(_) => {
                record_event(kind, value, aux);
                return;
            }
            Err(_) => continue,
        }
    }
}

pub(crate) fn snapshot_recent(limit: usize) -> AudioDiagnosticTimelineSnapshot {
    let limit = limit.clamp(1, TIMELINE_CAPACITY);
    let timeline = match TIMELINE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let start = timeline.len().saturating_sub(limit);
    let events = timeline.iter().skip(start).copied().collect::<Vec<_>>();

    AudioDiagnosticTimelineSnapshot {
        events,
        dropped_events: TIMELINE_DROPPED.load(Ordering::Relaxed),
    }
}

pub(crate) fn snapshot_recent_default() -> AudioDiagnosticTimelineSnapshot {
    snapshot_recent(RECENT_DEFAULT_LIMIT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeline_records_events() {
        let before = snapshot_recent_default();
        record_event("test.timeline", 1, 2);
        let after = snapshot_recent_default();

        assert!(after.events.len() >= before.events.len());
        let last = after.events.last().expect("timeline should contain last event");
        assert_eq!(last.kind, "test.timeline");
        assert_eq!(last.value, 1);
        assert_eq!(last.aux, 2);
    }

    #[test]
    fn throttled_records_at_most_once_per_window() {
        static THROTTLE: AtomicU64 = AtomicU64::new(0);

        let before = snapshot_recent_default();
        let before_count = before
            .events
            .iter()
            .filter(|event| event.kind == "test.throttle")
            .count();
        record_event_throttled("test.throttle", 7, 8, &THROTTLE, 60_000);
        record_event_throttled("test.throttle", 9, 10, &THROTTLE, 60_000);
        let after = snapshot_recent_default();

        let after_count = after
            .events
            .iter()
            .filter(|event| event.kind == "test.throttle")
            .count();
        assert!(after_count <= before_count.saturating_add(1));
    }
}
