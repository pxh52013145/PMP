use std::collections::VecDeque;
use std::sync::{Arc, Condvar, Mutex};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};

use super::{AudioOutputBackend, AudioSink, BoxedSource, OutputStreamInfo};

pub const NULL_BACKEND_ID: &str = "null";

pub struct NullBackend {
    info: OutputStreamInfo,
}

impl NullBackend {
    pub fn new(sample_rate: u32) -> Self {
        Self {
            info: OutputStreamInfo {
                device_id: Some("null".to_string()),
                device_name: Some("null".to_string()),
                output_sample_rate: Some(sample_rate.max(1)),
            },
        }
    }
}

impl Default for NullBackend {
    fn default() -> Self {
        Self::new(48_000)
    }
}

impl AudioOutputBackend for NullBackend {
    fn id(&self) -> &'static str {
        NULL_BACKEND_ID
    }

    fn list_devices(&self) -> Result<Vec<String>, String> {
        Ok(Vec::new())
    }

    fn default_device_name(&self) -> Option<String> {
        self.info.device_name.clone()
    }

    fn current_info(&self) -> OutputStreamInfo {
        self.info.clone()
    }

    fn is_stream_open(&self) -> bool {
        true
    }

    fn select_device(&self, _device_name: Option<String>) -> Result<OutputStreamInfo, String> {
        Ok(self.info.clone())
    }

    fn create_sink(&self) -> Result<(Arc<dyn AudioSink>, OutputStreamInfo), String> {
        Ok((Arc::new(NullSink::new()), self.info.clone()))
    }
}

struct NullSinkState {
    paused: bool,
    stopped: bool,
    shutdown: bool,
    queue: VecDeque<BoxedSource>,
}

struct NullSinkInner {
    state: Mutex<NullSinkState>,
    signal: Condvar,
    volume_bits: AtomicU32,
    active: AtomicBool,
    in_flight: AtomicUsize,
}

pub struct NullSink {
    inner: Arc<NullSinkInner>,
}

impl NullSink {
    pub fn new() -> Self {
        let inner = Arc::new(NullSinkInner {
            state: Mutex::new(NullSinkState {
                paused: true,
                stopped: false,
                shutdown: false,
                queue: VecDeque::new(),
            }),
            signal: Condvar::new(),
            volume_bits: AtomicU32::new(1.0f32.to_bits()),
            active: AtomicBool::new(true),
            in_flight: AtomicUsize::new(0),
        });

        let inner_thread = inner.clone();
        std::thread::spawn(move || drain_loop(inner_thread));

        Self { inner }
    }
}

impl Drop for NullSink {
    fn drop(&mut self) {
        self.inner.active.store(false, Ordering::Release);
        if let Ok(mut guard) = self.inner.state.lock() {
            guard.shutdown = true;
        }
        self.inner.signal.notify_all();
    }
}

fn drain_loop(inner: Arc<NullSinkInner>) {
    struct InFlightGuard<'a>(&'a AtomicUsize);

    impl Drop for InFlightGuard<'_> {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::AcqRel);
        }
    }

    loop {
        if !inner.active.load(Ordering::Acquire) {
            return;
        }

        let mut guard = match inner.state.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        while (guard.paused || guard.queue.is_empty() || guard.stopped) && !guard.shutdown {
            let (next, _) = inner
                .signal
                .wait_timeout(guard, std::time::Duration::from_millis(50))
                .unwrap_or_else(|e| e.into_inner());
            guard = next;
        }

        if guard.shutdown {
            return;
        }

        let mut source = match guard.queue.pop_front() {
            Some(source) => source,
            None => continue,
        };
        inner.in_flight.fetch_add(1, Ordering::AcqRel);
        let _in_flight = InFlightGuard(&inner.in_flight);
        drop(guard);

        let mut samples_consumed = 0usize;
        loop {
            if !inner.active.load(Ordering::Acquire) {
                return;
            }
            if source.next().is_none() {
                break;
            }
            samples_consumed += 1;
            if samples_consumed % 4096 == 0 {
                if let Ok(guard) = inner.state.lock() {
                    if guard.shutdown || guard.stopped || guard.paused {
                        break;
                    }
                }
            }
        }
    }
}

impl AudioSink for NullSink {
    fn append(&self, source: BoxedSource) {
        if let Ok(mut guard) = self.inner.state.lock() {
            guard.queue.push_back(source);
            guard.stopped = false;
        }
        self.inner.signal.notify_all();
    }

    fn play(&self) {
        if let Ok(mut guard) = self.inner.state.lock() {
            guard.paused = false;
            guard.stopped = false;
        }
        self.inner.signal.notify_all();
    }

    fn pause(&self) {
        if let Ok(mut guard) = self.inner.state.lock() {
            guard.paused = true;
        }
        self.inner.signal.notify_all();
    }

    fn stop(&self) {
        if let Ok(mut guard) = self.inner.state.lock() {
            guard.stopped = true;
            guard.queue.clear();
        }
        self.inner.signal.notify_all();
    }

    fn empty(&self) -> bool {
        let Ok(guard) = self.inner.state.lock() else {
            return true;
        };
        guard.queue.is_empty() && self.inner.in_flight.load(Ordering::Acquire) == 0
    }

    fn set_volume(&self, value: f32) {
        self.inner
            .volume_bits
            .store(value.to_bits(), Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::buffer::SamplesBuffer;
    use rodio::Source;

    struct BlockingSource {
        started: Arc<AtomicBool>,
        gate: Arc<(Mutex<bool>, Condvar)>,
        channels: u16,
        sample_rate: u32,
    }

    impl Iterator for BlockingSource {
        type Item = f32;

        fn next(&mut self) -> Option<Self::Item> {
            self.started.store(true, Ordering::Release);
            let (lock, signal) = &*self.gate;
            let mut guard = lock.lock().unwrap();
            while !*guard {
                guard = signal.wait(guard).unwrap();
            }
            None
        }
    }

    impl Source for BlockingSource {
        fn current_frame_len(&self) -> Option<usize> {
            None
        }

        fn channels(&self) -> u16 {
            self.channels
        }

        fn sample_rate(&self) -> u32 {
            self.sample_rate
        }

        fn total_duration(&self) -> Option<std::time::Duration> {
            None
        }
    }

    #[test]
    fn null_sink_empty_is_false_while_source_is_in_flight() {
        let sink = NullSink::new();
        let started = Arc::new(AtomicBool::new(false));
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        sink.append(Box::new(BlockingSource {
            started: started.clone(),
            gate: gate.clone(),
            channels: 2,
            sample_rate: 48_000,
        }));
        sink.play();

        let start = std::time::Instant::now();
        while !started.load(Ordering::Acquire) && start.elapsed() < std::time::Duration::from_secs(1)
        {
            std::thread::sleep(std::time::Duration::from_millis(1));
        }

        assert!(started.load(Ordering::Acquire));
        assert!(!sink.empty());

        {
            let (lock, signal) = &*gate;
            let mut guard = lock.lock().unwrap();
            *guard = true;
            signal.notify_all();
        }

        let start = std::time::Instant::now();
        while !sink.empty() && start.elapsed() < std::time::Duration::from_secs(1) {
            std::thread::sleep(std::time::Duration::from_millis(1));
        }

        assert!(sink.empty());
    }

    #[test]
    fn null_backend_creates_sink_and_reports_info() {
        let backend = NullBackend::new(48_000);
        assert_eq!(backend.id(), NULL_BACKEND_ID);
        assert!(backend.is_stream_open());

        let (sink, info) = backend.create_sink().expect("create sink");
        assert_eq!(info.output_sample_rate, Some(48_000));
        assert_eq!(info.device_name.as_deref(), Some("null"));

        sink.play();
        sink.stop();
    }

    #[test]
    fn null_sink_drains_samples_until_empty() {
        let sink = NullSink::new();
        sink.append(Box::new(SamplesBuffer::new(2, 48_000, vec![0.1f32; 8192])));
        sink.play();

        let start = std::time::Instant::now();
        while !sink.empty() && start.elapsed() < std::time::Duration::from_secs(2) {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }

        assert!(sink.empty());
    }
}
