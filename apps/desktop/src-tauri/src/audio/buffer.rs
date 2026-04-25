use std::cell::UnsafeCell;
use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone)]
pub(crate) struct AudioRingBuffer {
    inner: Arc<AudioRingBufferInner>,
}

struct AudioRingBufferInner {
    capacity: usize,
    data_ptr: *mut f32,
    _data: UnsafeCell<Box<[f32]>>,
    lock_bytes: usize,
    page_locked: AtomicBool,
    read_pos: AtomicU64,
    write_pos: AtomicU64,
    clear_epoch: AtomicU64,
    finished: AtomicBool,
    wait_lock: Mutex<()>,
    available: Condvar,
}

unsafe impl Send for AudioRingBufferInner {}
unsafe impl Sync for AudioRingBufferInner {}

impl Drop for AudioRingBufferInner {
    fn drop(&mut self) {
        #[cfg(target_os = "windows")]
        {
            if self.page_locked.load(Ordering::Acquire) && self.lock_bytes > 0 {
                unsafe {
                    let _ = windows::Win32::System::Memory::VirtualUnlock(
                        self.data_ptr as *const c_void,
                        self.lock_bytes,
                    );
                }
            }
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct PopChunkResult {
    pub popped: usize,
    pub finished: bool,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct PushInterleavedResult {
    pub pushed_frames: usize,
    pub cleared: bool,
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
                lock_bytes: capacity.saturating_mul(std::mem::size_of::<f32>()),
                page_locked: AtomicBool::new(false),
                read_pos: AtomicU64::new(0),
                write_pos: AtomicU64::new(0),
                clear_epoch: AtomicU64::new(1),
                finished: AtomicBool::new(false),
                wait_lock: Mutex::new(()),
                available: Condvar::new(),
            }),
        }
    }

    pub fn recommended_capacity_samples(sample_rate: Option<u32>, channels: u16) -> usize {
        const DEFAULT_SAMPLE_RATE: u32 = 44_100;
        const TARGET_SECONDS: u64 = 6;
        const MIN_SAMPLES: u64 = 32_768;
        const MAX_SAMPLES: u64 = 8_000_000;

        let sample_rate = sample_rate.unwrap_or(DEFAULT_SAMPLE_RATE).max(1) as u64;
        let channels = channels.max(1) as u64;
        sample_rate
            .saturating_mul(TARGET_SECONDS)
            .saturating_mul(channels)
            .clamp(MIN_SAMPLES, MAX_SAMPLES) as usize
    }

    pub fn try_lock_memory_pages(&self) -> bool {
        #[cfg(target_os = "windows")]
        {
            if self
                .inner
                .page_locked
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
            {
                return true;
            }

            if self.inner.lock_bytes == 0 {
                self.inner.page_locked.store(false, Ordering::Release);
                return false;
            }

            let locked = unsafe {
                windows::Win32::System::Memory::VirtualLock(
                    self.inner.data_ptr as *const c_void,
                    self.inner.lock_bytes,
                )
                .is_ok()
            };

            if !locked {
                self.inner.page_locked.store(false, Ordering::Release);
            }

            return locked;
        }

        #[cfg(not(target_os = "windows"))]
        {
            false
        }
    }

    pub fn clear(&self) {
        let write = self.inner.write_pos.load(Ordering::Acquire);
        self.inner.read_pos.store(write, Ordering::Release);
        self.inner.finished.store(false, Ordering::Release);
        self.inner.clear_epoch.fetch_add(1, Ordering::AcqRel);
    }

    pub fn clear_epoch(&self) -> u64 {
        self.inner.clear_epoch.load(Ordering::Acquire)
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

    pub fn lock_bytes(&self) -> usize {
        self.inner.lock_bytes
    }

    pub(crate) fn pre_touch_pages(&self) {
        let capacity = self.inner.capacity;
        if capacity == 0 {
            return;
        }

        let stride = (4096 / std::mem::size_of::<f32>()).max(1);
        let mut index = 0usize;
        while index < capacity {
            unsafe {
                let _ = ptr::read_volatile(self.inner.data_ptr.add(index));
            }
            index = index.saturating_add(stride);
        }

        unsafe {
            let _ = ptr::read_volatile(self.inner.data_ptr.add(capacity - 1));
        }
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
        self.pop_chunk_into_internal(out, max_samples, wait_timeout, false, false)
    }

    pub(crate) fn pop_chunk_append_into(
        &self,
        out: &mut Vec<f32>,
        max_samples: usize,
        wait_timeout: Duration,
    ) -> PopChunkResult {
        self.pop_chunk_into_internal(out, max_samples, wait_timeout, true, false)
    }

    pub(crate) fn pop_chunk_into_realtime(
        &self,
        out: &mut Vec<f32>,
        max_samples: usize,
        wait_timeout: Duration,
    ) -> PopChunkResult {
        self.pop_chunk_into_internal(out, max_samples, wait_timeout, false, true)
    }

    pub(crate) fn pop_chunk_append_into_realtime(
        &self,
        out: &mut Vec<f32>,
        max_samples: usize,
        wait_timeout: Duration,
    ) -> PopChunkResult {
        self.pop_chunk_into_internal(out, max_samples, wait_timeout, true, true)
    }

    fn pop_chunk_into_internal(
        &self,
        out: &mut Vec<f32>,
        max_samples: usize,
        wait_timeout: Duration,
        append: bool,
        realtime_wait: bool,
    ) -> PopChunkResult {
        if !append {
            out.clear();
        }
        let base_len = out.len();

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
            if realtime_wait {
                let deadline = Instant::now() + wait_timeout;
                while self.len_samples() == 0 && !self.inner.finished.load(Ordering::Acquire) {
                    if Instant::now() >= deadline {
                        break;
                    }
                    std::hint::spin_loop();
                }
            } else {
                let guard = self
                    .inner
                    .wait_lock
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                let _ = self.inner.available.wait_timeout(guard, wait_timeout);
            }
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
        if out.capacity() < base_len.saturating_add(count) {
            crate::audio::memory_pool::reserve_f32_capacity(
                out,
                base_len.saturating_add(count),
                "memory_pool.buffer.pop_chunk_growth",
            );
        }

        unsafe {
            out.set_len(base_len.saturating_add(count));
            let dst = out.as_mut_ptr().add(base_len);
            let start = (read as usize) % self.inner.capacity;
            let first = (self.inner.capacity - start).min(count);
            ptr::copy_nonoverlapping(self.inner.data_ptr.add(start), dst, first);
            if first < count {
                ptr::copy_nonoverlapping(self.inner.data_ptr, dst.add(first), count - first);
            }
        }

        let new_read = read.saturating_add(count as u64);
        self.inner.read_pos.store(new_read, Ordering::Release);

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
        self.push_interleaved_guarded(samples, channels, self.clear_epoch())
            .pushed_frames
    }

    pub fn push_interleaved_guarded(
        &self,
        samples: &[f32],
        channels: usize,
        expected_clear_epoch: u64,
    ) -> PushInterleavedResult {
        if self.clear_epoch() != expected_clear_epoch {
            return PushInterleavedResult {
                pushed_frames: 0,
                cleared: true,
            };
        }

        if channels == 0 {
            return PushInterleavedResult {
                pushed_frames: 0,
                cleared: false,
            };
        }
        let total_frames = samples.len() / channels;
        if total_frames == 0 {
            return PushInterleavedResult {
                pushed_frames: 0,
                cleared: false,
            };
        }

        let read = self.inner.read_pos.load(Ordering::Acquire);
        let write = self.inner.write_pos.load(Ordering::Acquire);
        let used = write.saturating_sub(read) as usize;
        let free_samples = self.inner.capacity.saturating_sub(used);
        let free_frames = free_samples / channels;
        if free_frames == 0 {
            return PushInterleavedResult {
                pushed_frames: 0,
                cleared: false,
            };
        }

        let frames_to_push = free_frames.min(total_frames);
        let samples_to_push = frames_to_push * channels;
        if samples_to_push == 0 {
            return PushInterleavedResult {
                pushed_frames: 0,
                cleared: false,
            };
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

        if self.clear_epoch() != expected_clear_epoch {
            return PushInterleavedResult {
                pushed_frames: 0,
                cleared: true,
            };
        }

        self.inner.write_pos.store(
            write.saturating_add(samples_to_push as u64),
            Ordering::Release,
        );
        self.inner.available.notify_one();
        PushInterleavedResult {
            pushed_frames: frames_to_push,
            cleared: false,
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

    #[test]
    fn clear_increments_epoch_and_resets_finished_flag() {
        let buffer = AudioRingBuffer::new(32);
        let epoch_before = buffer.clear_epoch();
        buffer.mark_finished();
        assert!(buffer.is_finished());

        buffer.clear();

        assert!(buffer.clear_epoch() > epoch_before);
        assert!(!buffer.is_finished());
    }

    #[test]
    fn guarded_push_rejects_stale_epoch_without_publishing_samples() {
        let buffer = AudioRingBuffer::new(32);
        let stale_epoch = buffer.clear_epoch();
        buffer.clear();

        let result = buffer.push_interleaved_guarded(&[0.1, 0.2, 0.3, 0.4], 2, stale_epoch);

        assert!(result.cleared);
        assert_eq!(result.pushed_frames, 0);
        assert_eq!(buffer.len_samples(), 0);
    }

    #[test]
    fn pop_chunk_append_into_preserves_existing_samples_and_appends() {
        let buffer = AudioRingBuffer::new(32);
        let input = vec![1.0f32, 2.0, 3.0, 4.0, 5.0, 6.0];
        let pushed = buffer.push_interleaved(&input, 1);
        assert_eq!(pushed, 6);

        let mut out = vec![9.0f32, 8.0];
        let first = buffer.pop_chunk_append_into(&mut out, 3, Duration::ZERO);
        assert_eq!(first.popped, 3);
        assert_eq!(out, vec![9.0, 8.0, 1.0, 2.0, 3.0]);

        let second = buffer.pop_chunk_append_into(&mut out, 3, Duration::ZERO);
        assert_eq!(second.popped, 3);
        assert_eq!(out, vec![9.0, 8.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
    }
}
