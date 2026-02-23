use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};
use std::{fmt, mem};

use crossbeam_queue::ArrayQueue;
use once_cell::sync::Lazy;

use crate::audio::diagnostics;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ControlCommandQueueMode {
    LockFree,
    LegacyMpsc,
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct ControlPlaneStatsSnapshot {
    pub queue_capacity: u64,
    pub overwrite_events: u64,
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

enum CommandTxInner<T> {
    LockFree(Arc<LockFreeCommandChannel<T>>),
    Legacy(mpsc::Sender<T>),
}

enum CommandRxInner<T> {
    LockFree(Arc<LockFreeCommandChannel<T>>),
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
    }
}

impl<T> Drop for CommandRx<T> {
    fn drop(&mut self) {
        if let CommandRxInner::LockFree(shared) = &self.inner {
            shared.receiver_alive.store(false, Ordering::Release);
        }
    }
}

impl<T> CommandTx<T> {
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
            CommandTxInner::Legacy(sender) => {
                sender.send(value).map_err(|err| CommandSendError::Disconnected(err.0))
            }
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
            _ => ControlCommandQueueMode::LockFree,
        },
        Err(_) => ControlCommandQueueMode::LockFree,
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
static CONTROL_QUEUE_OVERWRITE_TIMELINE_GATE_MS: AtomicU64 = AtomicU64::new(0);

pub(crate) fn control_command_queue_mode() -> ControlCommandQueueMode {
    *CONTROL_COMMAND_QUEUE_MODE
}

pub(crate) fn control_plane_stats_snapshot() -> ControlPlaneStatsSnapshot {
    ControlPlaneStatsSnapshot {
        queue_capacity: *CONTROL_QUEUE_CAPACITY as u64,
        overwrite_events: CONTROL_QUEUE_OVERWRITE_EVENTS.load(Ordering::Relaxed),
        mode_lock_free: matches!(
            control_command_queue_mode(),
            ControlCommandQueueMode::LockFree
        ),
    }
}

pub(crate) fn command_channel<T>() -> (CommandTx<T>, CommandRx<T>)
where
    T: Send + 'static,
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
        assert!(matches!(rx.try_recv(), Err(CommandTryRecvError::Disconnected)));
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
}
