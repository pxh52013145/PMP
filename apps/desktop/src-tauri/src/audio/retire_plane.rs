use std::panic::{self, AssertUnwindSafe};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;

use crate::audio::diagnostics;

type RetireTask = Box<dyn FnOnce() + Send + 'static>;

enum RetireCommand {
    Run {
        task_name: &'static str,
        task: RetireTask,
    },
    Shutdown,
}

struct RetireRuntime {
    tx: mpsc::Sender<RetireCommand>,
    handle: JoinHandle<()>,
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct RetirePlaneStatsSnapshot {
    pub pending_tasks: u64,
    pub enqueued_total: u64,
    pub executed_total: u64,
    pub inline_fallback_total: u64,
    pub panic_total: u64,
}

static RETIRE_RUNTIME: Lazy<Mutex<Option<RetireRuntime>>> = Lazy::new(|| Mutex::new(None));
static RETIRE_PENDING_TASKS: AtomicU64 = AtomicU64::new(0);
static RETIRE_ENQUEUED_TOTAL: AtomicU64 = AtomicU64::new(0);
static RETIRE_EXECUTED_TOTAL: AtomicU64 = AtomicU64::new(0);
static RETIRE_INLINE_FALLBACK_TOTAL: AtomicU64 = AtomicU64::new(0);
static RETIRE_PANIC_TOTAL: AtomicU64 = AtomicU64::new(0);
static RETIRE_TIMING_TIMELINE_GATE_MS: AtomicU64 = AtomicU64::new(0);
static RETIRE_PANIC_TIMELINE_GATE_MS: AtomicU64 = AtomicU64::new(0);
static RETIRE_BACKPRESSURE_TIMELINE_GATE_MS: AtomicU64 = AtomicU64::new(0);

fn decrement_pending() {
    let _ = RETIRE_PENDING_TASKS.fetch_update(Ordering::AcqRel, Ordering::Acquire, |value| {
        Some(value.saturating_sub(1))
    });
}

fn run_task(task_name: &'static str, task: RetireTask) {
    let started = Instant::now();
    let result = panic::catch_unwind(AssertUnwindSafe(task));
    let elapsed_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;

    RETIRE_EXECUTED_TOTAL.fetch_add(1, Ordering::Relaxed);
    decrement_pending();
    diagnostics::record_event_throttled(
        "retire_plane.task_ms",
        elapsed_ms,
        RETIRE_PENDING_TASKS.load(Ordering::Relaxed),
        &RETIRE_TIMING_TIMELINE_GATE_MS,
        250,
    );

    if result.is_err() {
        RETIRE_PANIC_TOTAL.fetch_add(1, Ordering::Relaxed);
        diagnostics::record_event_throttled(
            "retire_plane.task_panic",
            1,
            task_name.len() as u64,
            &RETIRE_PANIC_TIMELINE_GATE_MS,
            250,
        );
    }
}

fn spawn_runtime() -> RetireRuntime {
    let (tx, rx) = mpsc::channel::<RetireCommand>();
    let handle = thread::Builder::new()
        .name("pmpm-retire-plane".to_string())
        .spawn(move || {
            while let Ok(command) = rx.recv() {
                match command {
                    RetireCommand::Run { task_name, task } => run_task(task_name, task),
                    RetireCommand::Shutdown => {
                        while let Ok(pending) = rx.try_recv() {
                            if let RetireCommand::Run { task_name, task } = pending {
                                run_task(task_name, task);
                            }
                        }
                        break;
                    }
                }
            }
        })
        .unwrap_or_else(|err| panic!("Failed to spawn retire-plane worker: {err}"));

    RetireRuntime { tx, handle }
}

fn ensure_runtime_sender() -> mpsc::Sender<RetireCommand> {
    let mut guard = RETIRE_RUNTIME
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(runtime) = guard.as_ref() {
        return runtime.tx.clone();
    }

    let runtime = spawn_runtime();
    let tx = runtime.tx.clone();
    *guard = Some(runtime);
    tx
}

pub(crate) fn retire_drop<T>(task_name: &'static str, value: T)
where
    T: Send + 'static,
{
    retire(task_name, move || drop(value));
}

pub(crate) fn retire(task_name: &'static str, task: impl FnOnce() + Send + 'static) {
    RETIRE_ENQUEUED_TOTAL.fetch_add(1, Ordering::Relaxed);
    RETIRE_PENDING_TASKS.fetch_add(1, Ordering::AcqRel);

    let command = RetireCommand::Run {
        task_name,
        task: Box::new(task),
    };
    match ensure_runtime_sender().send(command) {
        Ok(()) => {}
        Err(send_err) => {
            RETIRE_INLINE_FALLBACK_TOTAL.fetch_add(1, Ordering::Relaxed);
            if let RetireCommand::Run { task_name, task } = send_err.0 {
                run_task(task_name, task);
            } else {
                decrement_pending();
            }
        }
    }
}

pub(crate) fn stats_snapshot() -> RetirePlaneStatsSnapshot {
    RetirePlaneStatsSnapshot {
        pending_tasks: RETIRE_PENDING_TASKS.load(Ordering::Relaxed),
        enqueued_total: RETIRE_ENQUEUED_TOTAL.load(Ordering::Relaxed),
        executed_total: RETIRE_EXECUTED_TOTAL.load(Ordering::Relaxed),
        inline_fallback_total: RETIRE_INLINE_FALLBACK_TOTAL.load(Ordering::Relaxed),
        panic_total: RETIRE_PANIC_TOTAL.load(Ordering::Relaxed),
    }
}

pub(crate) fn pending_tasks() -> u64 {
    RETIRE_PENDING_TASKS.load(Ordering::Relaxed)
}

pub(crate) fn wait_for_pending_tasks_at_most(max_pending: u64, timeout: Duration) -> bool {
    let started = Instant::now();
    let initial_pending = pending_tasks();
    if initial_pending <= max_pending {
        return true;
    }

    let mut spin_loops = 0u32;
    while started.elapsed() < timeout {
        let pending = pending_tasks();
        if pending <= max_pending {
            let waited_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
            diagnostics::record_event_throttled(
                "retire_plane.backpressure_wait_ms",
                waited_ms,
                initial_pending,
                &RETIRE_BACKPRESSURE_TIMELINE_GATE_MS,
                200,
            );
            return true;
        }

        if spin_loops < 8 {
            spin_loops += 1;
            std::hint::spin_loop();
            continue;
        }

        thread::sleep(Duration::from_millis(1));
    }

    diagnostics::record_event_throttled(
        "retire_plane.backpressure_timeout",
        pending_tasks(),
        initial_pending,
        &RETIRE_BACKPRESSURE_TIMELINE_GATE_MS,
        200,
    );
    false
}

pub(crate) fn shutdown() {
    let runtime = {
        let mut guard = RETIRE_RUNTIME
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.take()
    };

    if let Some(runtime) = runtime {
        let _ = runtime.tx.send(RetireCommand::Shutdown);
        let _ = runtime.handle.join();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use super::*;

    #[test]
    fn retire_plane_executes_enqueued_task() {
        let marker = Arc::new(AtomicUsize::new(0));
        let marker_clone = marker.clone();
        retire("retire_plane.test_executes", move || {
            marker_clone.store(1, Ordering::Release);
        });

        let deadline = Instant::now() + Duration::from_millis(200);
        while Instant::now() < deadline {
            if marker.load(Ordering::Acquire) == 1 {
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }

        assert_eq!(marker.load(Ordering::Acquire), 1);
    }
}
