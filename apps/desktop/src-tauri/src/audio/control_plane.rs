use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::{fmt, mem};

use crossbeam_queue::ArrayQueue;
use once_cell::sync::Lazy;
use rtrb::{Consumer as RtrbConsumer, PopError, Producer as RtrbProducer, PushError, RingBuffer};

use crate::audio::diagnostics;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ControlCommandQueueMode {
    LockFree,
    SpscRtrb,
    LegacyMpsc,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ControlCommandPriority {
    Critical,
    Normal,
    Coalescable,
}

pub(crate) trait ControlCommand: Send + 'static {
    fn priority(&self) -> ControlCommandPriority {
        ControlCommandPriority::Normal
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct ControlPlaneStatsSnapshot {
    pub mode_name: &'static str,
    pub queue_capacity: u64,
    pub overwrite_events: u64,
    pub drop_newest_events: u64,
    pub coalesced_overflow_events: u64,
    pub critical_overflow_events: u64,
    pub mode_lock_free: bool,
}

#[derive(Debug)]
pub(crate) enum CommandTryRecvError {
    Empty,
    Disconnected,
}

pub(crate) enum CommandSendError<T> {
    Disconnected(T),
}

impl<T> fmt::Debug for CommandSendError<T> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Disconnected(_) => formatter
                .debug_struct("CommandSendError")
                .field("kind", &"Disconnected")
                .field("payload_size", &mem::size_of::<T>())
                .finish(),
        }
    }
}

impl<T> CommandSendError<T> {
    #[allow(dead_code)]
    pub(crate) fn into_inner(self) -> T {
        match self {
            Self::Disconnected(value) => value,
        }
    }
}

struct LockFreeCommandChannel<T> {
    queue: ArrayQueue<T>,
    sender_count: AtomicUsize,
    receiver_alive: AtomicBool,
}

impl<T> LockFreeCommandChannel<T> {
    fn new(capacity: usize) -> Self {
        Self {
            queue: ArrayQueue::new(capacity.max(8)),
            sender_count: AtomicUsize::new(1),
            receiver_alive: AtomicBool::new(true),
        }
    }
}

struct SpscRtrbCommandChannel<T> {
    capacity: usize,
    producer: Mutex<Option<RtrbProducer<T>>>,
    consumer: UnsafeCell<Option<RtrbConsumer<T>>>,
    coalesced_overflow: ArrayQueue<T>,
    critical_overflow: ArrayQueue<T>,
    sender_count: AtomicUsize,
    receiver_alive: AtomicBool,
}

unsafe impl<T: Send> Send for SpscRtrbCommandChannel<T> {}
unsafe impl<T: Send> Sync for SpscRtrbCommandChannel<T> {}

impl<T> SpscRtrbCommandChannel<T> {
    fn new(capacity: usize) -> Self {
        let capacity = capacity.max(8);
        let (producer, consumer) = RingBuffer::new(capacity);
        Self {
            capacity,
            producer: Mutex::new(Some(producer)),
            consumer: UnsafeCell::new(Some(consumer)),
            coalesced_overflow: ArrayQueue::new(1),
            critical_overflow: ArrayQueue::new(8),
            sender_count: AtomicUsize::new(1),
            receiver_alive: AtomicBool::new(true),
        }
    }

    fn push_critical_overflow(&self, value: T) {
        let mut pending = value;
        loop {
            match self.critical_overflow.push(pending) {
                Ok(()) => return,
                Err(returned) => {
                    let _ = self.critical_overflow.pop();
                    pending = returned;
                }
            }
        }
    }

    fn push_coalesced_overflow(&self, value: T) {
        match self.coalesced_overflow.push(value) {
            Ok(()) => {}
            Err(returned) => {
                let _ = self.coalesced_overflow.pop();
                let _ = self.coalesced_overflow.push(returned);
            }
        }
    }
}

enum CommandTxInner<T> {
    LockFree(Arc<LockFreeCommandChannel<T>>),
    SpscRtrb(Arc<SpscRtrbCommandChannel<T>>),
    Legacy(mpsc::Sender<T>),
}

enum CommandRxInner<T> {
    LockFree(Arc<LockFreeCommandChannel<T>>),
    SpscRtrb(Arc<SpscRtrbCommandChannel<T>>),
    Legacy(mpsc::Receiver<T>),
}

pub(crate) struct CommandTx<T> {
    inner: CommandTxInner<T>,
}

pub(crate) struct CommandRx<T> {
    inner: CommandRxInner<T>,
}

impl<T> Clone for CommandTx<T> {
    fn clone(&self) -> Self {
        match &self.inner {
            CommandTxInner::LockFree(shared) => {
                shared.sender_count.fetch_add(1, Ordering::AcqRel);
                Self {
                    inner: CommandTxInner::LockFree(shared.clone()),
                }
            }
            CommandTxInner::SpscRtrb(shared) => {
                shared.sender_count.fetch_add(1, Ordering::AcqRel);
                Self {
                    inner: CommandTxInner::SpscRtrb(shared.clone()),
                }
            }
            CommandTxInner::Legacy(sender) => Self {
                inner: CommandTxInner::Legacy(sender.clone()),
            },
        }
    }
}

impl<T> Drop for CommandTx<T> {
    fn drop(&mut self) {
        if let CommandTxInner::LockFree(shared) = &self.inner {
            shared.sender_count.fetch_sub(1, Ordering::AcqRel);
        }
        if let CommandTxInner::SpscRtrb(shared) = &self.inner {
            if shared.sender_count.fetch_sub(1, Ordering::AcqRel) == 1 {
                let mut guard = shared
                    .producer
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                let _ = guard.take();
            }
        }
    }
}

impl<T> Drop for CommandRx<T> {
    fn drop(&mut self) {
        if let CommandRxInner::LockFree(shared) = &self.inner {
            shared.receiver_alive.store(false, Ordering::Release);
        }
        if let CommandRxInner::SpscRtrb(shared) = &self.inner {
            shared.receiver_alive.store(false, Ordering::Release);
            unsafe {
                let slot = &mut *shared.consumer.get();
                let _ = slot.take();
            }
        }
    }
}

impl<T> CommandTx<T>
where
    T: ControlCommand,
{
    pub(crate) fn send(&self, value: T) -> Result<(), CommandSendError<T>> {
        match &self.inner {
            CommandTxInner::LockFree(shared) => {
                if !shared.receiver_alive.load(Ordering::Acquire) {
                    return Err(CommandSendError::Disconnected(value));
                }

                let mut pending = value;
                loop {
                    match shared.queue.push(pending) {
                        Ok(()) => return Ok(()),
                        Err(returned) => {
                            if !shared.receiver_alive.load(Ordering::Acquire) {
                                return Err(CommandSendError::Disconnected(returned));
                            }
                            let _ = shared.queue.pop();
                            CONTROL_QUEUE_OVERWRITE_EVENTS.fetch_add(1, Ordering::Relaxed);
                            diagnostics::record_event_throttled(
                                "control_plane.queue_overwrite",
                                shared.queue.len() as u64,
                                shared.queue.capacity() as u64,
                                &CONTROL_QUEUE_OVERWRITE_TIMELINE_GATE_MS,
                                250,
                            );
                            pending = returned;
                        }
                    }
                }
            }
            CommandTxInner::SpscRtrb(shared) => {
                if !shared.receiver_alive.load(Ordering::Acquire) {
                    return Err(CommandSendError::Disconnected(value));
                }

                let priority = value.priority();

                let mut guard = shared
                    .producer
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                let Some(producer) = guard.as_mut() else {
                    return Err(CommandSendError::Disconnected(value));
                };

                match producer.push(value) {
                    Ok(()) => Ok(()),
                    Err(PushError::Full(returned)) => {
                        CONTROL_QUEUE_OVERWRITE_EVENTS.fetch_add(1, Ordering::Relaxed);

                        if !shared.receiver_alive.load(Ordering::Acquire) {
                            return Err(CommandSendError::Disconnected(returned));
                        }

                        match priority {
                            ControlCommandPriority::Critical => {
                                shared.push_critical_overflow(returned);
                                CONTROL_QUEUE_CRITICAL_OVERFLOW_EVENTS
                                    .fetch_add(1, Ordering::Relaxed);
                                let queue_len_hint =
                                    shared.capacity.saturating_sub(producer.slots()) as u64;
                                diagnostics::record_event_throttled(
                                    "control_plane.queue_overflow_critical",
                                    queue_len_hint,
                                    shared.capacity as u64,
                                    &CONTROL_QUEUE_OVERWRITE_TIMELINE_GATE_MS,
                                    250,
                                );
                            }
                            ControlCommandPriority::Coalescable => {
                                shared.push_coalesced_overflow(returned);
                                CONTROL_QUEUE_COALESCED_OVERFLOW_EVENTS
                                    .fetch_add(1, Ordering::Relaxed);
                                let queue_len_hint =
                                    shared.capacity.saturating_sub(producer.slots()) as u64;
                                diagnostics::record_event_throttled(
                                    "control_plane.queue_overflow_coalesced",
                                    queue_len_hint,
                                    shared.capacity as u64,
                                    &CONTROL_QUEUE_OVERWRITE_TIMELINE_GATE_MS,
                                    250,
                                );
                            }
                            ControlCommandPriority::Normal => {
                                CONTROL_QUEUE_DROP_NEWEST_EVENTS.fetch_add(1, Ordering::Relaxed);
                                let queue_len_hint =
                                    shared.capacity.saturating_sub(producer.slots()) as u64;
                                diagnostics::record_event_throttled(
                                    "control_plane.queue_drop_newest",
                                    queue_len_hint,
                                    shared.capacity as u64,
                                    &CONTROL_QUEUE_OVERWRITE_TIMELINE_GATE_MS,
                                    250,
                                );
                            }
                        }

                        Ok(())
                    }
                }
            }
            CommandTxInner::Legacy(sender) => sender
                .send(value)
                .map_err(|err| CommandSendError::Disconnected(err.0)),
        }
    }
}

impl<T> CommandRx<T> {
    pub(crate) fn try_recv(&self) -> Result<T, CommandTryRecvError> {
        match &self.inner {
            CommandRxInner::LockFree(shared) => {
                if let Some(value) = shared.queue.pop() {
                    return Ok(value);
                }

                if shared.sender_count.load(Ordering::Acquire) == 0 {
                    Err(CommandTryRecvError::Disconnected)
                } else {
                    Err(CommandTryRecvError::Empty)
                }
            }
            CommandRxInner::SpscRtrb(shared) => unsafe {
                if let Some(value) = shared.critical_overflow.pop() {
                    return Ok(value);
                }

                let slot = &mut *shared.consumer.get();
                let Some(consumer) = slot.as_mut() else {
                    return Err(CommandTryRecvError::Disconnected);
                };

                match consumer.pop() {
                    Ok(value) => Ok(value),
                    Err(PopError::Empty) => {
                        if let Some(value) = shared.coalesced_overflow.pop() {
                            return Ok(value);
                        }

                        if shared.sender_count.load(Ordering::Acquire) == 0
                            || consumer.is_abandoned()
                        {
                            Err(CommandTryRecvError::Disconnected)
                        } else {
                            Err(CommandTryRecvError::Empty)
                        }
                    }
                }
            },
            CommandRxInner::Legacy(receiver) => match receiver.try_recv() {
                Ok(value) => Ok(value),
                Err(mpsc::TryRecvError::Empty) => Err(CommandTryRecvError::Empty),
                Err(mpsc::TryRecvError::Disconnected) => Err(CommandTryRecvError::Disconnected),
            },
        }
    }
}

fn parse_mode_from_env() -> ControlCommandQueueMode {
    match std::env::var("PMP_AUDIO_CONTROL_QUEUE_MODE") {
        Ok(value) => match value.trim().to_ascii_lowercase().as_str() {
            "legacy" | "legacy-mpsc" | "mpsc" => ControlCommandQueueMode::LegacyMpsc,
            "array-queue" | "arrayqueue" | "lock-free" | "lockfree" => {
                ControlCommandQueueMode::LockFree
            }
            "rtrb" | "spsc-rtrb" | "spsc" => ControlCommandQueueMode::SpscRtrb,
            _ => ControlCommandQueueMode::SpscRtrb,
        },
        Err(_) => ControlCommandQueueMode::SpscRtrb,
    }
}

fn parse_queue_capacity_from_env() -> usize {
    match std::env::var("PMP_AUDIO_CONTROL_QUEUE_CAPACITY") {
        Ok(value) => value
            .trim()
            .parse::<usize>()
            .ok()
            .unwrap_or(256)
            .clamp(8, 8_192),
        Err(_) => 256,
    }
}

static CONTROL_COMMAND_QUEUE_MODE: Lazy<ControlCommandQueueMode> = Lazy::new(parse_mode_from_env);
static CONTROL_QUEUE_CAPACITY: Lazy<usize> = Lazy::new(parse_queue_capacity_from_env);
static CONTROL_QUEUE_OVERWRITE_EVENTS: AtomicU64 = AtomicU64::new(0);
static CONTROL_QUEUE_DROP_NEWEST_EVENTS: AtomicU64 = AtomicU64::new(0);
static CONTROL_QUEUE_COALESCED_OVERFLOW_EVENTS: AtomicU64 = AtomicU64::new(0);
static CONTROL_QUEUE_CRITICAL_OVERFLOW_EVENTS: AtomicU64 = AtomicU64::new(0);
static CONTROL_QUEUE_OVERWRITE_TIMELINE_GATE_MS: AtomicU64 = AtomicU64::new(0);

pub(crate) fn control_command_queue_mode() -> ControlCommandQueueMode {
    *CONTROL_COMMAND_QUEUE_MODE
}

pub(crate) fn control_plane_stats_snapshot() -> ControlPlaneStatsSnapshot {
    ControlPlaneStatsSnapshot {
        mode_name: match control_command_queue_mode() {
            ControlCommandQueueMode::LockFree => "lock-free",
            ControlCommandQueueMode::SpscRtrb => "spsc-rtrb",
            ControlCommandQueueMode::LegacyMpsc => "legacy-mpsc",
        },
        queue_capacity: *CONTROL_QUEUE_CAPACITY as u64,
        overwrite_events: CONTROL_QUEUE_OVERWRITE_EVENTS.load(Ordering::Relaxed),
        drop_newest_events: CONTROL_QUEUE_DROP_NEWEST_EVENTS.load(Ordering::Relaxed),
        coalesced_overflow_events: CONTROL_QUEUE_COALESCED_OVERFLOW_EVENTS.load(Ordering::Relaxed),
        critical_overflow_events: CONTROL_QUEUE_CRITICAL_OVERFLOW_EVENTS.load(Ordering::Relaxed),
        mode_lock_free: matches!(
            control_command_queue_mode(),
            ControlCommandQueueMode::LockFree | ControlCommandQueueMode::SpscRtrb
        ),
    }
}

pub(crate) fn command_channel<T>() -> (CommandTx<T>, CommandRx<T>)
where
    T: ControlCommand,
{
    match control_command_queue_mode() {
        ControlCommandQueueMode::LockFree => {
            let shared = Arc::new(LockFreeCommandChannel::new(*CONTROL_QUEUE_CAPACITY));
            (
                CommandTx {
                    inner: CommandTxInner::LockFree(shared.clone()),
                },
                CommandRx {
                    inner: CommandRxInner::LockFree(shared),
                },
            )
        }
        ControlCommandQueueMode::SpscRtrb => {
            let shared = Arc::new(SpscRtrbCommandChannel::new(*CONTROL_QUEUE_CAPACITY));
            (
                CommandTx {
                    inner: CommandTxInner::SpscRtrb(shared.clone()),
                },
                CommandRx {
                    inner: CommandRxInner::SpscRtrb(shared),
                },
            )
        }
        ControlCommandQueueMode::LegacyMpsc => {
            let (tx, rx) = mpsc::channel();
            (
                CommandTx {
                    inner: CommandTxInner::Legacy(tx),
                },
                CommandRx {
                    inner: CommandRxInner::Legacy(rx),
                },
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    impl ControlCommand for u32 {}

    #[derive(Debug, PartialEq)]
    enum PriorityCommand {
        Critical(u32),
        Normal(u32),
        Coalescable(u32),
    }

    impl ControlCommand for PriorityCommand {
        fn priority(&self) -> ControlCommandPriority {
            match self {
                Self::Critical(_) => ControlCommandPriority::Critical,
                Self::Normal(_) => ControlCommandPriority::Normal,
                Self::Coalescable(_) => ControlCommandPriority::Coalescable,
            }
        }
    }

    #[test]
    fn lock_free_channel_disconnects_when_all_senders_drop() {
        let shared = Arc::new(LockFreeCommandChannel::<u32>::new(16));
        let tx = CommandTx {
            inner: CommandTxInner::LockFree(shared.clone()),
        };
        let rx = CommandRx {
            inner: CommandRxInner::LockFree(shared),
        };

        let tx2 = tx.clone();
        drop(tx);
        assert!(matches!(rx.try_recv(), Err(CommandTryRecvError::Empty)));

        drop(tx2);
        assert!(matches!(
            rx.try_recv(),
            Err(CommandTryRecvError::Disconnected)
        ));
    }

    #[test]
    fn lock_free_channel_preserves_fifo_order() {
        let shared = Arc::new(LockFreeCommandChannel::<u32>::new(16));
        let tx = CommandTx {
            inner: CommandTxInner::LockFree(shared.clone()),
        };
        let rx = CommandRx {
            inner: CommandRxInner::LockFree(shared),
        };

        tx.send(1u32).unwrap();
        tx.send(2u32).unwrap();
        tx.send(3u32).unwrap();

        assert_eq!(rx.try_recv().ok(), Some(1));
        assert_eq!(rx.try_recv().ok(), Some(2));
        assert_eq!(rx.try_recv().ok(), Some(3));
    }

    #[test]
    fn lock_free_channel_overwrites_oldest_when_full() {
        let shared = Arc::new(LockFreeCommandChannel::<u32>::new(8));
        let tx = CommandTx {
            inner: CommandTxInner::LockFree(shared.clone()),
        };
        let rx = CommandRx {
            inner: CommandRxInner::LockFree(shared),
        };

        for value in 1..=9 {
            tx.send(value).unwrap();
        }

        assert_eq!(rx.try_recv().ok(), Some(2));
        assert_eq!(rx.try_recv().ok(), Some(3));
    }

    #[test]
    fn spsc_rtrb_channel_disconnects_when_all_senders_drop() {
        let shared = Arc::new(SpscRtrbCommandChannel::<u32>::new(16));
        let tx = CommandTx {
            inner: CommandTxInner::SpscRtrb(shared.clone()),
        };
        let rx = CommandRx {
            inner: CommandRxInner::SpscRtrb(shared),
        };

        let tx2 = tx.clone();
        drop(tx);
        assert!(matches!(rx.try_recv(), Err(CommandTryRecvError::Empty)));

        drop(tx2);
        assert!(matches!(
            rx.try_recv(),
            Err(CommandTryRecvError::Disconnected)
        ));
    }

    #[test]
    fn spsc_rtrb_channel_drops_newest_normal_when_full() {
        let shared = Arc::new(SpscRtrbCommandChannel::<u32>::new(8));
        let tx = CommandTx {
            inner: CommandTxInner::SpscRtrb(shared.clone()),
        };
        let rx = CommandRx {
            inner: CommandRxInner::SpscRtrb(shared),
        };

        for value in 1..=9 {
            tx.send(value).unwrap();
        }

        let mut drained = Vec::new();
        while let Ok(value) = rx.try_recv() {
            drained.push(value);
        }

        assert_eq!(drained, vec![1, 2, 3, 4, 5, 6, 7, 8]);
    }

    #[test]
    fn spsc_rtrb_channel_prioritizes_critical_over_main_queue() {
        let shared = Arc::new(SpscRtrbCommandChannel::<PriorityCommand>::new(8));
        let tx = CommandTx {
            inner: CommandTxInner::SpscRtrb(shared.clone()),
        };
        let rx = CommandRx {
            inner: CommandRxInner::SpscRtrb(shared),
        };

        for value in 0..8 {
            tx.send(PriorityCommand::Normal(value)).unwrap();
        }

        tx.send(PriorityCommand::Critical(900)).unwrap();
        tx.send(PriorityCommand::Critical(901)).unwrap();

        assert_eq!(rx.try_recv().ok(), Some(PriorityCommand::Critical(900)));
        assert_eq!(rx.try_recv().ok(), Some(PriorityCommand::Critical(901)));
        assert_eq!(rx.try_recv().ok(), Some(PriorityCommand::Normal(0)));
    }

    #[test]
    fn spsc_rtrb_channel_coalesces_latest_when_overflowing() {
        let shared = Arc::new(SpscRtrbCommandChannel::<PriorityCommand>::new(8));
        let tx = CommandTx {
            inner: CommandTxInner::SpscRtrb(shared.clone()),
        };
        let rx = CommandRx {
            inner: CommandRxInner::SpscRtrb(shared),
        };

        for value in 0..8 {
            tx.send(PriorityCommand::Normal(value)).unwrap();
        }

        tx.send(PriorityCommand::Coalescable(10)).unwrap();
        tx.send(PriorityCommand::Coalescable(11)).unwrap();
        tx.send(PriorityCommand::Coalescable(12)).unwrap();

        let mut drained = Vec::new();
        while let Ok(value) = rx.try_recv() {
            drained.push(value);
        }

        assert_eq!(
            drained,
            vec![
                PriorityCommand::Normal(0),
                PriorityCommand::Normal(1),
                PriorityCommand::Normal(2),
                PriorityCommand::Normal(3),
                PriorityCommand::Normal(4),
                PriorityCommand::Normal(5),
                PriorityCommand::Normal(6),
                PriorityCommand::Normal(7),
                PriorityCommand::Coalescable(12),
            ]
        );
    }
}
