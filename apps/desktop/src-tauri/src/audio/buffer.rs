use std::cell::UnsafeCell;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

#[derive(Clone)]
pub(crate) struct AudioRingBuffer {
    inner: Arc<AudioRingBufferInner>,
}

struct AudioRingBufferInner {
    capacity: usize,
    data_ptr: *mut f32,
    _data: UnsafeCell<Box<[f32]>>,
    read_pos: AtomicU64,
    write_pos: AtomicU64,
    finished: AtomicBool,
    wait_lock: Mutex<()>,
    available: Condvar,
    space: Condvar,
}

unsafe impl Send for AudioRingBufferInner {}
unsafe impl Sync for AudioRingBufferInner {}

#[derive(Clone, Copy, Debug)]
pub(crate) struct PopChunkResult {
    pub popped: usize,
    pub finished: bool,
}

impl AudioRingBuffer {
    pub fn new(capacity: usize) -> Self {
        let capacity = capacity.max(1);
        let mut data = vec![0.0f32; capacity].into_boxed_slice();
        let data_ptr = data.as_mut_ptr();

        Self {
            inner: Arc::new(AudioRingBufferInner {
                capacity,
                data_ptr,
                _data: UnsafeCell::new(data),
                read_pos: AtomicU64::new(0),
                write_pos: AtomicU64::new(0),
                finished: AtomicBool::new(false),
                wait_lock: Mutex::new(()),
                available: Condvar::new(),
                space: Condvar::new(),
            }),
        }
    }

    pub fn recommended_capacity_samples(sample_rate: Option<u32>, channels: u16) -> usize {
        const DEFAULT_SAMPLE_RATE: u32 = 44_100;
        const TARGET_SECONDS: u64 = 10;
        const MIN_SAMPLES: u64 = 32_768;
        const MAX_SAMPLES: u64 = 8_000_000;

        let sample_rate = sample_rate.unwrap_or(DEFAULT_SAMPLE_RATE).max(1) as u64;
        let channels = channels.max(1) as u64;
        sample_rate
            .saturating_mul(TARGET_SECONDS)
            .saturating_mul(channels)
            .clamp(MIN_SAMPLES, MAX_SAMPLES) as usize
    }

    pub fn clear(&self) {
        let write = self.inner.write_pos.load(Ordering::Acquire);
        self.inner.read_pos.store(write, Ordering::Release);
        self.inner.finished.store(false, Ordering::Release);
        self.inner.space.notify_all();
    }

    pub fn mark_finished(&self) {
        self.inner.finished.store(true, Ordering::Release);
        self.inner.available.notify_all();
    }

    pub fn len_samples(&self) -> usize {
        let read = self.inner.read_pos.load(Ordering::Acquire);
        let write = self.inner.write_pos.load(Ordering::Acquire);
        (write.saturating_sub(read) as usize).min(self.inner.capacity)
    }

    pub fn capacity_samples(&self) -> usize {
        self.inner.capacity
    }

    pub fn wait_for_samples(&self, min_samples: usize, timeout: Duration) {
        if min_samples == 0 {
            return;
        }

        let mut guard = self
            .inner
            .wait_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        while self.len_samples() < min_samples && !self.inner.finished.load(Ordering::Acquire) {
            let (next, wait_result) = match self.inner.available.wait_timeout(guard, timeout) {
                Ok(value) => value,
                Err(poisoned) => poisoned.into_inner(),
            };
            guard = next;
            if wait_result.timed_out() {
                break;
            }
        }
    }

    pub(crate) fn pop_chunk_into(
        &self,
        out: &mut Vec<f32>,
        max_samples: usize,
        wait_timeout: Duration,
    ) -> PopChunkResult {
        out.clear();

        if max_samples == 0 {
            return PopChunkResult {
                popped: 0,
                finished: self.is_finished_and_empty(),
            };
        }

        if !wait_timeout.is_zero()
            && self.len_samples() == 0
            && !self.inner.finished.load(Ordering::Acquire)
        {
            let guard = self
                .inner
                .wait_lock
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let _ = self.inner.available.wait_timeout(guard, wait_timeout);
        }

        let read = self.inner.read_pos.load(Ordering::Acquire);
        let write = self.inner.write_pos.load(Ordering::Acquire);
        let available = write.saturating_sub(read) as usize;
        if available == 0 {
            return PopChunkResult {
                popped: 0,
                finished: self.inner.finished.load(Ordering::Acquire),
            };
        }

        let count = available.min(max_samples).min(self.inner.capacity);
        if out.capacity() < count {
            out.reserve(count.saturating_sub(out.len()));
        }

        unsafe {
            out.set_len(count);
            let dst = out.as_mut_ptr();
            let start = (read as usize) % self.inner.capacity;
            let first = (self.inner.capacity - start).min(count);
            ptr::copy_nonoverlapping(self.inner.data_ptr.add(start), dst, first);
            if first < count {
                ptr::copy_nonoverlapping(self.inner.data_ptr, dst.add(first), count - first);
            }
        }

        let new_read = read.saturating_add(count as u64);
        self.inner.read_pos.store(new_read, Ordering::Release);
        self.inner.space.notify_all();

        let finished = self.inner.finished.load(Ordering::Acquire)
            && self.inner.write_pos.load(Ordering::Acquire) == new_read;

        PopChunkResult {
            popped: count,
            finished,
        }
    }

    pub fn is_finished_and_empty(&self) -> bool {
        self.inner.finished.load(Ordering::Acquire) && self.len_samples() == 0
    }

    pub fn is_finished(&self) -> bool {
        self.inner.finished.load(Ordering::Acquire)
    }

    pub fn push_interleaved(&self, samples: &[f32], channels: usize) -> usize {
        if channels == 0 {
            return 0;
        }
        let total_frames = samples.len() / channels;
        if total_frames == 0 {
            return 0;
        }

        let mut waited = false;

        loop {
            let read = self.inner.read_pos.load(Ordering::Acquire);
            let write = self.inner.write_pos.load(Ordering::Acquire);
            let used = write.saturating_sub(read) as usize;
            let free_samples = self.inner.capacity.saturating_sub(used);
            let free_frames = free_samples / channels;
            if free_frames == 0 {
                if waited {
                    return 0;
                }
                waited = true;
                let guard = self
                    .inner
                    .wait_lock
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                let _ = self
                    .inner
                    .space
                    .wait_timeout(guard, Duration::from_millis(10));
                continue;
            }

            let frames_to_push = free_frames.min(total_frames);
            let samples_to_push = frames_to_push * channels;
            if samples_to_push == 0 {
                return 0;
            }

            unsafe {
                let start = (write as usize) % self.inner.capacity;
                let first = (self.inner.capacity - start).min(samples_to_push);
                ptr::copy_nonoverlapping(samples.as_ptr(), self.inner.data_ptr.add(start), first);
                if first < samples_to_push {
                    ptr::copy_nonoverlapping(
                        samples.as_ptr().add(first),
                        self.inner.data_ptr,
                        samples_to_push - first,
                    );
                }
            }

            self.inner.write_pos.store(
                write.saturating_add(samples_to_push as u64),
                Ordering::Release,
            );
            self.inner.available.notify_all();
            return frames_to_push;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffer_pop_chunk_into_preserves_order_and_reports_finished() {
        let buffer = AudioRingBuffer::new(64);
        let channels = 1usize;
        let input = (0..10usize).map(|i| i as f32).collect::<Vec<_>>();

        let pushed = buffer.push_interleaved(&input, channels);
        assert_eq!(pushed, 10);

        let mut out = Vec::with_capacity(16);
        let result = buffer.pop_chunk_into(&mut out, 4, Duration::from_millis(0));
        assert_eq!(result.popped, 4);
        assert!(!result.finished);
        assert_eq!(out, vec![0.0, 1.0, 2.0, 3.0]);

        buffer.mark_finished();

        out.clear();
        let result = buffer.pop_chunk_into(&mut out, 32, Duration::from_millis(0));
        assert_eq!(result.popped, 6);
        assert!(result.finished);
        assert_eq!(out, vec![4.0, 5.0, 6.0, 7.0, 8.0, 9.0]);

        out.clear();
        let result = buffer.pop_chunk_into(&mut out, 32, Duration::from_millis(0));
        assert_eq!(result.popped, 0);
        assert!(result.finished);
        assert!(out.is_empty());
    }
}
