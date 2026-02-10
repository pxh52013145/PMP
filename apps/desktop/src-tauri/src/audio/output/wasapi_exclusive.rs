use std::collections::VecDeque;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use rodio::Source;

use super::{AudioOutputBackend, AudioOutputError, AudioSink, BoxedSource, OutputDeviceInfo, OutputStreamInfo};
use crate::audio::buffer::AudioRingBuffer;
use crate::audio::policy::NativeAudioTransportMode;

pub const WASAPI_EXCLUSIVE_BACKEND_ID: &str = "wasapi-exclusive";

const AUDIO_OUTPUT_WASAPI_EXCLUSIVE_DEVICE_NOT_FOUND: &str =
    "AUDIO_OUTPUT_WASAPI_EXCLUSIVE_DEVICE_NOT_FOUND";
const AUDIO_OUTPUT_WASAPI_EXCLUSIVE_NO_DEVICE_SELECTED: &str =
    "AUDIO_OUTPUT_WASAPI_EXCLUSIVE_NO_DEVICE_SELECTED";
const AUDIO_OUTPUT_WASAPI_EXCLUSIVE_OPEN_FAILED: &str = "AUDIO_OUTPUT_WASAPI_EXCLUSIVE_OPEN_FAILED";
const AUDIO_OUTPUT_WASAPI_EXCLUSIVE_RENDER_FAILED: &str =
    "AUDIO_OUTPUT_WASAPI_EXCLUSIVE_RENDER_FAILED";
const AUDIO_OUTPUT_WASAPI_EXCLUSIVE_UNSUPPORTED_FORMAT: &str =
    "AUDIO_OUTPUT_WASAPI_EXCLUSIVE_UNSUPPORTED_FORMAT";

static CALLBACK_WAIT_TIMEOUT_COUNT: AtomicU64 = AtomicU64::new(0);
static CALLBACK_RENDER_COUNT: AtomicU64 = AtomicU64::new(0);
static CALLBACK_RENDER_TOTAL_US: AtomicU64 = AtomicU64::new(0);
static CALLBACK_RENDER_MAX_US: AtomicU64 = AtomicU64::new(0);
static CALLBACK_RENDER_QUEUE_UNDERRUN_EVENTS: AtomicU64 = AtomicU64::new(0);
static CALLBACK_RENDER_QUEUE_UNDERRUN_FRAMES: AtomicU64 = AtomicU64::new(0);

pub(crate) fn output_callback_metrics() -> (u32, u64, u64, u64) {
    let render_count = CALLBACK_RENDER_COUNT.load(Ordering::Relaxed);
    let total_us = CALLBACK_RENDER_TOTAL_US.load(Ordering::Relaxed);
    let max_us = CALLBACK_RENDER_MAX_US.load(Ordering::Relaxed);

    let p99_like_us: u64 = if render_count == 0 {
        0
    } else {
        let avg = total_us / render_count;
        avg.max(max_us)
    };

    (
        p99_like_us.min(u32::MAX as u64) as u32,
        CALLBACK_WAIT_TIMEOUT_COUNT.load(Ordering::Relaxed),
        CALLBACK_RENDER_QUEUE_UNDERRUN_EVENTS.load(Ordering::Relaxed),
        CALLBACK_RENDER_QUEUE_UNDERRUN_FRAMES.load(Ordering::Relaxed),
    )
}

fn reset_output_callback_metrics() {
    CALLBACK_WAIT_TIMEOUT_COUNT.store(0, Ordering::Relaxed);
    CALLBACK_RENDER_COUNT.store(0, Ordering::Relaxed);
    CALLBACK_RENDER_TOTAL_US.store(0, Ordering::Relaxed);
    CALLBACK_RENDER_MAX_US.store(0, Ordering::Relaxed);
    CALLBACK_RENDER_QUEUE_UNDERRUN_EVENTS.store(0, Ordering::Relaxed);
    CALLBACK_RENDER_QUEUE_UNDERRUN_FRAMES.store(0, Ordering::Relaxed);
}

fn record_callback_render_cost(duration_us: u32) {
    let duration_us_u64 = duration_us as u64;
    CALLBACK_RENDER_COUNT.fetch_add(1, Ordering::Relaxed);
    CALLBACK_RENDER_TOTAL_US.fetch_add(duration_us_u64, Ordering::Relaxed);

    let mut observed = CALLBACK_RENDER_MAX_US.load(Ordering::Relaxed);
    while duration_us_u64 > observed {
        match CALLBACK_RENDER_MAX_US.compare_exchange(
            observed,
            duration_us_u64,
            Ordering::Relaxed,
            Ordering::Relaxed,
        ) {
            Ok(_) => break,
            Err(next) => observed = next,
        }
    }
}

impl Default for BackendState {
    fn default() -> Self {
        Self {
            device_id: None,
            device_name: None,
            output_sample_rate: None,
            stream_open: false,
            error: None,
            transport_mode: NativeAudioTransportMode::Robust,
        }
    }
}

struct BackendState {
    device_id: Option<String>,
    device_name: Option<String>,
    output_sample_rate: Option<u32>,
    stream_open: bool,
    error: Option<AudioOutputError>,
    transport_mode: NativeAudioTransportMode,
}

pub struct WasapiExclusiveBackend {
    state: Arc<Mutex<BackendState>>,
}

impl WasapiExclusiveBackend {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(BackendState::default())),
        }
    }

    fn resolve_device_by_id(&self, device_id: &str) -> Result<(), String> {
        let device_id = device_id.trim();
        if device_id.is_empty() {
            return self.resolve_default_device();
        }

        let devices = enumerate_render_devices()?;
        let matched = devices
            .into_iter()
            .find(|device| device.id == device_id)
            .ok_or_else(|| format!("Output device not found: {device_id}"))?;

        let mut state = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?;
        state.device_id = Some(matched.id);
        state.device_name = Some(matched.name);
        Ok(())
    }

    fn resolve_default_device(&self) -> Result<(), String> {
        let info = resolve_default_render_device()?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?;
        state.device_id = Some(info.id);
        state.device_name = Some(info.name);
        Ok(())
    }

    fn resolve_named_device(&self, device_name: &str) -> Result<(), String> {
        let device_name = device_name.trim();
        if device_name.is_empty() {
            return self.resolve_default_device();
        }

        let devices = enumerate_render_devices()?;
        let matched = devices
            .into_iter()
            .find(|device| device.name == device_name)
            .ok_or_else(|| format!("Output device not found: {device_name}"))?;

        let mut state = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?;
        state.device_id = Some(matched.id);
        state.device_name = Some(matched.name);
        Ok(())
    }

    fn ensure_device_selected(&self) -> Result<(), String> {
        let has_device = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?
            .device_id
            .is_some();
        if has_device {
            return Ok(());
        }
        self.resolve_default_device()
    }
}

impl Default for WasapiExclusiveBackend {
    fn default() -> Self {
        Self::new()
    }
}

static DEFAULT_BACKEND: Lazy<Arc<WasapiExclusiveBackend>> =
    Lazy::new(|| Arc::new(WasapiExclusiveBackend::new()));

pub fn wasapi_exclusive_backend() -> Arc<dyn AudioOutputBackend> {
    DEFAULT_BACKEND.clone()
}

impl AudioOutputBackend for WasapiExclusiveBackend {
    fn id(&self) -> &'static str {
        WASAPI_EXCLUSIVE_BACKEND_ID
    }

    fn list_devices(&self) -> Result<Vec<String>, String> {
        let mut names = enumerate_render_devices()?
            .into_iter()
            .map(|device| device.name)
            .collect::<Vec<_>>();
        names.sort();
        names.dedup();
        Ok(names)
    }

    fn list_devices_v2(&self) -> Result<Vec<OutputDeviceInfo>, String> {
        let default_id = resolve_default_render_device().ok().map(|device| device.id);
        enumerate_render_devices().map(|devices| {
            devices
                .into_iter()
                .map(|device| OutputDeviceInfo {
                    id: device.id.clone(),
                    name: device.name.clone(),
                    is_default: default_id
                        .as_deref()
                        .is_some_and(|default_id| default_id == device.id.as_str()),
                })
                .collect()
        })
    }

    fn default_device_name(&self) -> Option<String> {
        resolve_default_render_device().ok().map(|device| device.name)
    }

    fn current_info(&self) -> OutputStreamInfo {
        let guard = self.state.lock();
        let Ok(guard) = guard else {
            return OutputStreamInfo::default();
        };
        OutputStreamInfo {
            device_id: guard.device_id.clone(),
            device_name: guard.device_name.clone(),
            output_sample_rate: guard.output_sample_rate,
        }
    }

    fn is_stream_open(&self) -> bool {
        let guard = self.state.lock();
        let Ok(guard) = guard else {
            return false;
        };
        guard.stream_open
    }

    fn select_device(&self, device_name: Option<String>) -> Result<OutputStreamInfo, String> {
        if let Some(name) = device_name.as_deref() {
            self.resolve_named_device(name)?;
        } else {
            self.resolve_default_device()?;
        }

        let mut state = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?;
        state.stream_open = false;
        state.output_sample_rate = None;
        state.error = None;

        Ok(OutputStreamInfo {
            device_id: state.device_id.clone(),
            device_name: state.device_name.clone(),
            output_sample_rate: None,
        })
    }

    fn select_device_by_id(&self, device_id: Option<String>) -> Result<OutputStreamInfo, String> {
        if let Some(device_id) = device_id.as_deref() {
            self.resolve_device_by_id(device_id)?;
        } else {
            self.resolve_default_device()?;
        }

        let mut state = self
            .state
            .lock()
            .map_err(|_| "Audio stream state is locked".to_string())?;
        state.stream_open = false;
        state.output_sample_rate = None;
        state.error = None;

        Ok(OutputStreamInfo {
            device_id: state.device_id.clone(),
            device_name: state.device_name.clone(),
            output_sample_rate: None,
        })
    }

    fn create_sink(&self) -> Result<(Arc<dyn AudioSink>, OutputStreamInfo), String> {
        self.ensure_device_selected()?;
        let sink = WasapiExclusiveSink::new(self.state.clone());
        let info = self.current_info();
        Ok((Arc::new(sink), info))
    }

    fn take_error(&self) -> Option<AudioOutputError> {
        let mut guard = self.state.lock().ok()?;
        guard.error.take()
    }

    fn set_transport_mode(&self, mode: NativeAudioTransportMode) {
        if let Ok(mut guard) = self.state.lock() {
            guard.transport_mode = mode;
        }
    }
}

struct DeviceInfo {
    id: String,
    name: String,
}

#[cfg(target_os = "windows")]
fn enumerate_render_devices() -> Result<Vec<DeviceInfo>, String> {
    use windows::Win32::Media::Audio::{
        eRender, DEVICE_STATE_ACTIVE, IMMDevice, IMMDeviceCollection, IMMDeviceEnumerator,
        MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("Failed to create MMDeviceEnumerator: {e}"))?;

        let collection: IMMDeviceCollection = enumerator
            .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
            .map_err(|e| format!("Failed to enumerate audio endpoints: {e}"))?;

        let count = collection
            .GetCount()
            .map_err(|e| format!("Failed to get endpoints count: {e}"))?;

        let mut devices = Vec::with_capacity(count as usize);
        for index in 0..count {
            let device: IMMDevice = collection
                .Item(index)
                .map_err(|e| format!("Failed to get endpoint {index}: {e}"))?;
            devices.push(get_device_info(&device)?);
        }

        devices.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
        Ok(devices)
    }
}

#[cfg(not(target_os = "windows"))]
fn enumerate_render_devices() -> Result<Vec<DeviceInfo>, String> {
    Ok(Vec::new())
}

#[cfg(target_os = "windows")]
fn resolve_default_render_device() -> Result<DeviceInfo, String> {
    use windows::Win32::Media::Audio::{eConsole, eRender, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("Failed to create MMDeviceEnumerator: {e}"))?;

        let device: IMMDevice = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("Failed to get default audio endpoint: {e}"))?;

        get_device_info(&device)
    }
}

#[cfg(not(target_os = "windows"))]
fn resolve_default_render_device() -> Result<DeviceInfo, String> {
    Err("WASAPI is only available on Windows".to_string())
}

#[cfg(target_os = "windows")]
fn get_device_info(device: &windows::Win32::Media::Audio::IMMDevice) -> Result<DeviceInfo, String> {
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::System::Com::{CoTaskMemFree, STGM_READ};
    use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;

    unsafe {
        let id_ptr = device
            .GetId()
            .map_err(|e| format!("Failed to get device id: {e}"))?;
        let id = pwstr_to_string(id_ptr);
        CoTaskMemFree(Some(id_ptr.0 as *const c_void));

        let store: IPropertyStore = device
            .OpenPropertyStore(STGM_READ)
            .map_err(|e| format!("Failed to open property store: {e}"))?;
        let value = store
            .GetValue(&PKEY_Device_FriendlyName)
            .map_err(|e| format!("Failed to read device friendly name: {e}"))?;
        let name_ptr = PropVariantToStringAlloc(&value)
            .map_err(|e| format!("Failed to format device friendly name: {e}"))?;
        let name = pwstr_to_string(name_ptr);
        CoTaskMemFree(Some(name_ptr.0 as *const c_void));

        Ok(DeviceInfo { id, name })
    }
}

#[cfg(target_os = "windows")]
fn pwstr_to_string(value: windows::core::PWSTR) -> String {
    if value.0.is_null() {
        return String::new();
    }
    unsafe {
        let mut len = 0usize;
        while *value.0.add(len) != 0 {
            len += 1;
        }
        let slice = std::slice::from_raw_parts(value.0, len);
        String::from_utf16_lossy(slice)
    }
}

#[derive(Clone, Copy, Debug)]
enum WasapiSampleFormat {
    Float32,
    Pcm16,
    Pcm24Packed,
    Pcm24In32,
    Pcm32,
}

#[inline]
fn quantize_pcm24(sample: f32, volume: f32) -> i32 {
    let scaled = sample * 8_388_607.0f32 * volume;
    scaled.round().clamp(-8_388_608.0, 8_388_607.0) as i32
}

#[inline]
fn quantize_pcm24_transport_exact(sample: f32, volume: f32) -> i32 {
    quantize_pcm24(sample, volume)
}

#[inline]
fn pack_pcm24_in32(sample: i32) -> i32 {
    sample << 8
}

#[inline]
fn pack_pcm24_packed_bytes(sample: i32) -> [u8; 3] {
    let bytes = sample.to_le_bytes();
    [bytes[0], bytes[1], bytes[2]]
}

#[cfg(test)]
mod tests {
    use super::{
        pack_pcm24_in32, pack_pcm24_packed_bytes, quantize_pcm24, quantize_pcm24_transport_exact,
    };

    #[test]
    fn pcm24_quantize_clamps_and_rounds() {
        assert_eq!(quantize_pcm24(1.0, 1.0), 8_388_607);
        assert_eq!(quantize_pcm24(-1.0, 1.0), -8_388_607);
        assert_eq!(quantize_pcm24(2.0, 1.0), 8_388_607);
        assert_eq!(quantize_pcm24(-2.0, 1.0), -8_388_608);
        assert_eq!(quantize_pcm24(0.5, 1.0), 4_194_304);
    }

    #[test]
    fn pcm24_packed_bytes_match_expected_layout() {
        assert_eq!(pack_pcm24_packed_bytes(8_388_607), [0xff, 0xff, 0x7f]);
        assert_eq!(pack_pcm24_packed_bytes(-8_388_608), [0x00, 0x00, 0x80]);
        assert_eq!(pack_pcm24_packed_bytes(-8_388_607), [0x01, 0x00, 0x80]);
    }

    #[test]
    fn pcm24_in32_is_left_justified() {
        assert_eq!(pack_pcm24_in32(8_388_607), 0x7f_ff_ff_00);
        assert_eq!(pack_pcm24_in32(-8_388_608), i32::MIN);
        assert_eq!(pack_pcm24_in32(-8_388_607), 0x80_00_01_00u32 as i32);
    }

    #[test]
    fn transport_exact_pcm24_quantize_matches_legacy_rounding() {
        let vectors = [0.0f32, 0.125, -0.125, 0.5, -0.5, 0.9999, -1.0, 1.2, -1.2];
        for sample in vectors {
            assert_eq!(
                quantize_pcm24_transport_exact(sample, 1.0),
                quantize_pcm24(sample, 1.0)
            );
        }
    }
}

#[cfg(target_os = "windows")]
struct WasapiStream {
    audio_client: windows::Win32::Media::Audio::IAudioClient,
    render_client: windows::Win32::Media::Audio::IAudioRenderClient,
    event_handle: windows::Win32::Foundation::HANDLE,
    buffer_frame_count: u32,
    channels: u16,
    sample_rate: u32,
    sample_format: WasapiSampleFormat,
    transport_mode: NativeAudioTransportMode,
    started: bool,
}

#[cfg(target_os = "windows")]
impl WasapiStream {
    fn stop(&mut self) {
        if self.started {
            let _ = unsafe { self.audio_client.Stop() };
            let _ = unsafe { self.audio_client.Reset() };
            self.started = false;
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for WasapiStream {
    fn drop(&mut self) {
        self.stop();
        unsafe {
            let _ = self.audio_client.Reset();
            let _ = windows::Win32::Foundation::CloseHandle(self.event_handle);
        }
    }
}

struct SinkInner {
    backend_state: Arc<Mutex<BackendState>>,
    device_id: Option<String>,
    queue: Mutex<VecDeque<BoxedSource>>,
    render_queue: AudioRingBuffer,
    producer_thread: Mutex<Option<JoinHandle<()>>>,
    producer_stop_tx: Mutex<Option<mpsc::Sender<()>>>,
    producer_source: Mutex<Option<BoxedSource>>,
    playing: AtomicBool,
    stopped: AtomicBool,
    volume_bits: AtomicU32,
    is_empty: AtomicBool,
    thread: Mutex<Option<JoinHandle<()>>>,
}

pub struct WasapiExclusiveSink {
    inner: Arc<SinkInner>,
}

#[cfg(target_os = "windows")]
struct MmcssRegistration {
    handle: windows::Win32::Foundation::HANDLE,
}

#[cfg(target_os = "windows")]
impl MmcssRegistration {
    fn register() -> Option<Self> {
        use windows::core::w;
        use windows::Win32::System::Threading::{AvSetMmThreadCharacteristicsW, AvSetMmThreadPriority};

        unsafe {
            let mut task_index = 0u32;
            let handle = AvSetMmThreadCharacteristicsW(w!("Pro Audio"), &mut task_index)
                .or_else(|_| AvSetMmThreadCharacteristicsW(w!("Audio"), &mut task_index))
                .ok()?;

            let _ = AvSetMmThreadPriority(handle, windows::Win32::System::Threading::AVRT_PRIORITY_HIGH);
            Some(Self { handle })
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for MmcssRegistration {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::System::Threading::AvRevertMmThreadCharacteristics(self.handle);
        }
    }
}

impl WasapiExclusiveSink {
    fn new(backend_state: Arc<Mutex<BackendState>>) -> Self {
        let device_id = backend_state.lock().ok().and_then(|state| state.device_id.clone());
        reset_output_callback_metrics();
        Self {
            inner: Arc::new(SinkInner {
                backend_state,
                device_id,
                queue: Mutex::new(VecDeque::new()),
                render_queue: AudioRingBuffer::new(48_000 * 2 * 2),
                producer_thread: Mutex::new(None),
                producer_stop_tx: Mutex::new(None),
                producer_source: Mutex::new(None),
                playing: AtomicBool::new(false),
                stopped: AtomicBool::new(false),
                volume_bits: AtomicU32::new(1.0f32.to_bits()),
                is_empty: AtomicBool::new(true),
                thread: Mutex::new(None),
            }),
        }
    }

    fn ensure_thread_started(inner: &Arc<SinkInner>) {
        let mut guard = inner.thread.lock().unwrap();
        if guard.is_some() {
            return;
        }
        let inner_clone = inner.clone();
        *guard = Some(thread::spawn(move || run_sink_thread(inner_clone)));
    }

    fn stop_producer(inner: &Arc<SinkInner>) {
        if let Ok(mut stop_tx_guard) = inner.producer_stop_tx.lock() {
            if let Some(stop_tx) = stop_tx_guard.take() {
                let _ = stop_tx.send(());
            }
        }

        if let Ok(mut join_guard) = inner.producer_thread.lock() {
            if let Some(handle) = join_guard.take() {
                let _ = handle.join();
            }
        }

        inner.render_queue.clear();
    }

    fn start_producer_for_source(inner: &Arc<SinkInner>, source: BoxedSource) {
        Self::stop_producer(inner);

        inner.render_queue.clear();

        if let Ok(mut source_guard) = inner.producer_source.lock() {
            *source_guard = Some(source);
        }

        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        if let Ok(mut stop_tx_guard) = inner.producer_stop_tx.lock() {
            *stop_tx_guard = Some(stop_tx);
        }

        let inner_clone = inner.clone();
        let handle = thread::spawn(move || {
            let _priority_guard = crate::audio::threading::promote_current_thread_for_audio_decode();
            let mut local: Vec<f32> = Vec::with_capacity(8192);

            let mut source = {
                let Ok(mut guard) = inner_clone.producer_source.lock() else {
                    inner_clone.render_queue.mark_finished();
                    return;
                };
                guard.take()
            };

            let Some(mut source) = source.take() else {
                inner_clone.render_queue.mark_finished();
                return;
            };

            let channels = source.channels().max(1) as usize;

            while !inner_clone.stopped.load(Ordering::Acquire) {
                if stop_rx.try_recv().is_ok() {
                    break;
                }

                crate::audio::threading::apply_audio_decode_pressure_profile(
                    crate::audio::realtime_scheduler::SCHEDULER.profile(),
                );

                if inner_clone.render_queue.len_samples() >= inner_clone.render_queue.capacity_samples() * 3 / 4 {
                    thread::sleep(Duration::from_millis(1));
                    continue;
                }

                local.clear();
                for _ in 0..8192 {
                    match source.next() {
                        Some(sample) => local.push(sample),
                        None => break,
                    }
                }

                if local.is_empty() {
                    inner_clone.render_queue.mark_finished();
                    break;
                }

                let mut start = 0usize;
                while start < local.len() {
                    let pushed_frames = inner_clone
                        .render_queue
                        .push_interleaved(&local[start..], channels);
                    if pushed_frames == 0 {
                        thread::sleep(Duration::from_millis(1));
                        if stop_rx.try_recv().is_ok() {
                            return;
                        }
                        continue;
                    }
                    start = start.saturating_add(pushed_frames * channels);
                }
            }
        });

        if let Ok(mut join_guard) = inner.producer_thread.lock() {
            *join_guard = Some(handle);
        }
    }
}

impl Drop for WasapiExclusiveSink {
    fn drop(&mut self) {
        self.inner.stopped.store(true, Ordering::Release);
        Self::stop_producer(&self.inner);
        if let Ok(mut guard) = self.inner.thread.lock() {
            if let Some(handle) = guard.take() {
                let _ = handle.join();
            }
        }

        if let Ok(mut state) = self.inner.backend_state.lock() {
            state.stream_open = false;
            state.output_sample_rate = None;
        }
    }
}

impl AudioSink for WasapiExclusiveSink {
    fn append(&self, source: BoxedSource) {
        if let Ok(mut queue) = self.inner.queue.lock() {
            queue.clear();
            queue.push_back(source);
            self.inner.is_empty.store(false, Ordering::Release);
        }
        Self::ensure_thread_started(&self.inner);
    }

    fn play(&self) {
        self.inner.playing.store(true, Ordering::Release);
        Self::ensure_thread_started(&self.inner);
    }

    fn pause(&self) {
        self.inner.playing.store(false, Ordering::Release);
    }

    fn stop(&self) {
        self.inner.stopped.store(true, Ordering::Release);
        Self::stop_producer(&self.inner);
        if let Ok(mut queue) = self.inner.queue.lock() {
            queue.clear();
        }
        self.inner.is_empty.store(true, Ordering::Release);
    }

    fn empty(&self) -> bool {
        self.inner.is_empty.load(Ordering::Acquire)
    }

    fn set_volume(&self, value: f32) {
        self.inner
            .volume_bits
            .store(value.clamp(0.0, 4.0).to_bits(), Ordering::Release);
    }
}

fn run_sink_thread(inner: Arc<SinkInner>) {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    #[cfg(not(target_os = "windows"))]
    {
        inner.is_empty.store(true, Ordering::Release);
        return;
    }

    #[cfg(target_os = "windows")]
    {
        // Best-effort: ensure the render loop gets scheduled with audio-friendly priority to reduce underruns.
        let _mmcss = MmcssRegistration::register();
        if _mmcss.is_none() {
            unsafe {
                let _ = windows::Win32::System::Threading::SetThreadPriority(
                    windows::Win32::System::Threading::GetCurrentThread(),
                    windows::Win32::System::Threading::THREAD_PRIORITY_HIGHEST,
                );
            }
        }
        crate::audio::threading::apply_audio_output_pressure_profile(
            crate::audio::realtime_scheduler::SCHEDULER.profile(),
        );

        let device_id = match inner.device_id.as_deref() {
            Some(value) => value,
            None => {
                if let Ok(mut state) = inner.backend_state.lock() {
                    state.error = Some(AudioOutputError {
                        code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_NO_DEVICE_SELECTED,
                        message: "No output device selected".to_string(),
                    });
                }
                inner.is_empty.store(true, Ordering::Release);
                return;
            }
        };

        let transport_mode = inner
            .backend_state
            .lock()
            .ok()
            .map(|state| state.transport_mode)
            .unwrap_or(NativeAudioTransportMode::Robust);

        let mut stream: Option<WasapiStream> = None;
        let mut active_channels: u16 = 0;
        let mut active_sample_rate: u32 = 0;
        let mut render_scratch = Vec::<f32>::new();

        while !inner.stopped.load(Ordering::Acquire) {
            let queued = match inner.queue.lock() {
                Ok(mut queue) => queue.pop_front(),
                Err(_) => None,
            };

            if let Some(source) = queued {
                let desired_sample_rate = source.sample_rate().max(1);
                let desired_channels = source.channels().max(1);

                let need_open = match stream.as_ref() {
                    Some(stream) => {
                        stream.sample_rate != desired_sample_rate || stream.channels != desired_channels
                    }
                    None => true,
                };

                if need_open {
                    if let Some(stream) = stream.as_mut() {
                        stream.stop();
                    }

                    match open_wasapi_exclusive_stream(
                        device_id,
                        desired_sample_rate,
                        desired_channels,
                        transport_mode,
                    ) {
                        Ok(new_stream) => {
                            if let Ok(mut state) = inner.backend_state.lock() {
                                state.output_sample_rate = Some(new_stream.sample_rate);
                                state.stream_open = true;
                                state.error = None;
                            }
                            active_channels = new_stream.channels;
                            active_sample_rate = new_stream.sample_rate;
                            stream = Some(new_stream);
                        }
                        Err(err) => {
                            if let Ok(mut state) = inner.backend_state.lock() {
                                state.stream_open = false;
                                state.output_sample_rate = None;
                                state.error = Some(err);
                            }
                            inner.is_empty.store(true, Ordering::Release);
                            return;
                        }
                    }
                }

                WasapiExclusiveSink::start_producer_for_source(&inner, source);
            }

            if stream.is_none() {
                if inner.queue.lock().map(|q| q.is_empty()).unwrap_or(true) {
                    inner.is_empty.store(true, Ordering::Release);
                    thread::sleep(Duration::from_millis(20));
                    continue;
                }
                inner.is_empty.store(false, Ordering::Release);
                continue;
            }

            let Some(stream) = stream.as_mut() else {
                continue;
            };

            let playing = inner.playing.load(Ordering::Acquire);
            if playing && !stream.started {
                if let Err(err) = start_stream_with_prefill(
                    stream,
                    inner.as_ref(),
                    active_channels,
                    active_sample_rate,
                    &mut render_scratch,
                ) {
                    if let Ok(mut state) = inner.backend_state.lock() {
                        state.error = Some(err);
                    }
                    inner.is_empty.store(true, Ordering::Release);
                    return;
                }
            } else if !playing && stream.started {
                stream.stop();
                thread::sleep(Duration::from_millis(10));
                continue;
            }

            if !stream.started {
                thread::sleep(Duration::from_millis(5));
                continue;
            }

            if let Err(err) = render_once(stream, inner.as_ref(), &mut render_scratch) {
                if let Ok(mut state) = inner.backend_state.lock() {
                    state.error = Some(err);
                }
                inner.is_empty.store(true, Ordering::Release);
                return;
            }

            crate::audio::threading::apply_audio_output_pressure_profile(
                crate::audio::realtime_scheduler::SCHEDULER.profile(),
            );

            if inner.render_queue.is_finished_and_empty()
                && inner.queue.lock().map(|queue| queue.is_empty()).unwrap_or(true)
            {
                inner.is_empty.store(true, Ordering::Release);
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn start_stream_with_prefill(
    stream: &mut WasapiStream,
    inner: &SinkInner,
    channels: u16,
    _sample_rate: u32,
    scratch: &mut Vec<f32>,
) -> Result<(), AudioOutputError> {
    inner
        .render_queue
        .wait_for_samples((channels.max(1) as usize) * 64, Duration::from_millis(60));

    let volume = f32::from_bits(inner.volume_bits.load(Ordering::Acquire));
    render_frames(stream, stream.buffer_frame_count, inner, true, volume, scratch)?;
    unsafe {
        stream
            .audio_client
            .Start()
            .map_err(|e| AudioOutputError {
                code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_OPEN_FAILED,
                message: format!("Failed to start audio client: {e}"),
            })?;
    }
    stream.started = true;
    Ok(())
}

#[cfg(target_os = "windows")]
fn render_once(
    stream: &mut WasapiStream,
    inner: &SinkInner,
    scratch: &mut Vec<f32>,
) -> Result<(), AudioOutputError> {
    use windows::Win32::Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows::Win32::Media::Audio::AUDCLNT_BUFFERFLAGS_SILENT;
    use windows::Win32::System::Threading::WaitForSingleObject;

    let wait = unsafe { WaitForSingleObject(stream.event_handle, 50) };
    if wait == WAIT_TIMEOUT {
        CALLBACK_WAIT_TIMEOUT_COUNT.fetch_add(1, Ordering::Relaxed);
        return Ok(());
    }
    if wait != WAIT_OBJECT_0 {
        return Err(AudioOutputError {
            code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_RENDER_FAILED,
            message: format!("WaitForSingleObject returned unexpected value: {wait:?}"),
        });
    }

    let playing = inner.playing.load(Ordering::Acquire);
    let volume = f32::from_bits(inner.volume_bits.load(Ordering::Acquire));
    let frames = stream.buffer_frame_count;

    if !playing || inner.render_queue.is_finished_and_empty() {
        unsafe {
            stream
                .render_client
                .GetBuffer(frames)
                .map_err(|e| AudioOutputError {
                    code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_RENDER_FAILED,
                    message: format!("Failed to acquire render buffer: {e}"),
                })?;
            stream
                .render_client
                .ReleaseBuffer(frames, AUDCLNT_BUFFERFLAGS_SILENT.0 as u32)
                .map_err(|e| AudioOutputError {
                    code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_RENDER_FAILED,
                    message: format!("Failed to release silent buffer: {e}"),
                })?;
        }
        return Ok(());
    }

    let started = Instant::now();
    render_frames(stream, frames, inner, true, volume, scratch)?;
    let elapsed_us = started.elapsed().as_micros().min(u32::MAX as u128) as u32;
    record_callback_render_cost(elapsed_us);
    Ok(())
}

#[cfg(target_os = "windows")]
fn render_frames(
    stream: &mut WasapiStream,
    frames: u32,
    inner: &SinkInner,
    consume: bool,
    volume: f32,
    scratch: &mut Vec<f32>,
) -> Result<(), AudioOutputError> {
    let channels = stream.channels.max(1) as usize;
    let total_samples = frames as usize * channels;
    scratch.clear();
    if scratch.capacity() < total_samples {
        scratch.reserve(total_samples.saturating_sub(scratch.capacity()));
    }

    if consume {
        let popped = inner
            .render_queue
            .pop_chunk_into(scratch, total_samples, Duration::from_millis(0));
        if popped.popped == 0 && popped.finished {
            return Ok(());
        }
        if popped.popped < total_samples {
            let missing_samples = total_samples.saturating_sub(popped.popped);
            let missing_frames = (missing_samples / channels.max(1)).max(1) as u64;
            CALLBACK_RENDER_QUEUE_UNDERRUN_EVENTS.fetch_add(1, Ordering::Relaxed);
            CALLBACK_RENDER_QUEUE_UNDERRUN_FRAMES.fetch_add(missing_frames, Ordering::Relaxed);
            scratch.resize(total_samples, 0.0);
        }
    }

    unsafe {
        let buffer = stream
            .render_client
            .GetBuffer(frames)
            .map_err(|e| AudioOutputError {
                code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_RENDER_FAILED,
                message: format!("Failed to acquire render buffer: {e}"),
            })?;

        match stream.sample_format {
            WasapiSampleFormat::Float32 => {
                let out = buffer as *mut f32;
                for index in 0..total_samples {
                    let sample = if consume {
                        scratch[index] * volume
                    } else {
                        0.0
                    };
                    *out.add(index) = sample;
                }
            }
            WasapiSampleFormat::Pcm16 => {
                let out = buffer as *mut i16;
                let scale = (i16::MAX as f32) * volume;
                for index in 0..total_samples {
                    let sample = if consume {
                        scratch[index] * scale
                    } else {
                        0.0
                    };
                    let quantized =
                        sample.round().clamp(i16::MIN as f32, i16::MAX as f32) as i16;
                    *out.add(index) = quantized;
                }
            }
            WasapiSampleFormat::Pcm32 => {
                let out = buffer as *mut i32;
                let scale = (i32::MAX as f32) * volume;
                for index in 0..total_samples {
                    let sample = if consume {
                        scratch[index] * scale
                    } else {
                        0.0
                    };
                    let quantized =
                        sample.round().clamp(i32::MIN as f32, i32::MAX as f32) as i32;
                    *out.add(index) = quantized;
                }
            }
            WasapiSampleFormat::Pcm24In32 => {
                let out = buffer as *mut i32;
                for index in 0..total_samples {
                    let sample = if consume { scratch[index] } else { 0.0 };
                    let quantized = if matches!(
                        stream.transport_mode,
                        NativeAudioTransportMode::TransportExact
                    ) {
                        quantize_pcm24_transport_exact(sample, volume)
                    } else {
                        quantize_pcm24(sample, volume)
                    };
                    *out.add(index) = pack_pcm24_in32(quantized);
                }
            }
            WasapiSampleFormat::Pcm24Packed => {
                let out = buffer as *mut u8;
                for index in 0..total_samples {
                    let sample = if consume { scratch[index] } else { 0.0 };
                    let quantized = quantize_pcm24(sample, volume);
                    let bytes = pack_pcm24_packed_bytes(quantized);
                    let offset = index * 3;
                    *out.add(offset) = bytes[0];
                    *out.add(offset + 1) = bytes[1];
                    *out.add(offset + 2) = bytes[2];
                }
            }
        }

        stream
            .render_client
            .ReleaseBuffer(frames, 0)
            .map_err(|e| AudioOutputError {
                code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_RENDER_FAILED,
                message: format!("Failed to release render buffer: {e}"),
            })?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn open_wasapi_exclusive_stream(
    device_id: &str,
    sample_rate: u32,
    channels: u16,
    transport_mode: NativeAudioTransportMode,
) -> Result<WasapiStream, AudioOutputError> {
    use windows::core::PCWSTR;
    use windows::Win32::Media::Audio::{
        IAudioClient, IAudioRenderClient, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
        AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED, AUDCLNT_SHAREMODE_EXCLUSIVE,
        AUDCLNT_STREAMFLAGS_EVENTCALLBACK, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
        WAVEFORMATEXTENSIBLE_0, WAVE_FORMAT_PCM,
    };
    use windows::Win32::Media::KernelStreaming::{
        KSAUDIO_SPEAKER_DIRECTOUT, KSDATAFORMAT_SUBTYPE_PCM, SPEAKER_FRONT_CENTER,
        SPEAKER_FRONT_LEFT, SPEAKER_FRONT_RIGHT, WAVE_FORMAT_EXTENSIBLE,
    };
    use windows::Win32::Media::Multimedia::{KSDATAFORMAT_SUBTYPE_IEEE_FLOAT, WAVE_FORMAT_IEEE_FLOAT};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
    use windows::Win32::System::Threading::CreateEventW;

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| AudioOutputError {
                code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_OPEN_FAILED,
                message: format!("Failed to create MMDeviceEnumerator: {e}"),
            })?;

        let device_id_wide: Vec<u16> = device_id.encode_utf16().chain(Some(0)).collect();
        let device: IMMDevice = enumerator
            .GetDevice(PCWSTR(device_id_wide.as_ptr()))
            .map_err(|e| AudioOutputError {
                code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_DEVICE_NOT_FOUND,
                message: format!("Failed to open output device: {e}"),
            })?;

        #[repr(C, align(8))]
        struct AlignedWaveFormatExtensible(WAVEFORMATEXTENSIBLE);

        enum WaveFormatAttempt {
            Ex(WAVEFORMATEX),
            Ext(AlignedWaveFormatExtensible),
        }

        impl WaveFormatAttempt {
            fn as_ptr(&self) -> *const WAVEFORMATEX {
                match self {
                    Self::Ex(format) => format as *const WAVEFORMATEX,
                    Self::Ext(format) => {
                        &format.0 as *const WAVEFORMATEXTENSIBLE as *const WAVEFORMATEX
                    }
                }
            }
        }

        struct FormatAttempt {
            label: &'static str,
            sample_format: WasapiSampleFormat,
            wave_format: WaveFormatAttempt,
        }

        fn build_wave_format_ex(
            w_format_tag: u16,
            sample_rate: u32,
            channels: u16,
            bytes_per_sample: u16,
        ) -> WAVEFORMATEX {
            let block_align = channels.saturating_mul(bytes_per_sample).max(1);
            let bits_per_sample = bytes_per_sample.saturating_mul(8);
            WAVEFORMATEX {
                wFormatTag: w_format_tag,
                nChannels: channels,
                nSamplesPerSec: sample_rate,
                nAvgBytesPerSec: sample_rate.saturating_mul(block_align as u32),
                nBlockAlign: block_align,
                wBitsPerSample: bits_per_sample,
                cbSize: 0,
            }
        }

        fn build_wave_format_extensible(
            sample_rate: u32,
            channels: u16,
            bytes_per_sample: u16,
            valid_bits_per_sample: u16,
            channel_mask: u32,
            sub_format: windows::core::GUID,
        ) -> WaveFormatAttempt {
            let cb_size = (std::mem::size_of::<WAVEFORMATEXTENSIBLE>()
                - std::mem::size_of::<WAVEFORMATEX>()) as u16;
            let block_align = channels.saturating_mul(bytes_per_sample).max(1);
            let bits_per_sample = bytes_per_sample.saturating_mul(8);

            WaveFormatAttempt::Ext(AlignedWaveFormatExtensible(WAVEFORMATEXTENSIBLE {
                Format: WAVEFORMATEX {
                    wFormatTag: WAVE_FORMAT_EXTENSIBLE as u16,
                    nChannels: channels,
                    nSamplesPerSec: sample_rate,
                    nAvgBytesPerSec: sample_rate.saturating_mul(block_align as u32),
                    nBlockAlign: block_align,
                    wBitsPerSample: bits_per_sample,
                    cbSize: cb_size,
                },
                Samples: WAVEFORMATEXTENSIBLE_0 {
                    wValidBitsPerSample: valid_bits_per_sample,
                },
                dwChannelMask: channel_mask,
                SubFormat: sub_format,
            }))
        }

        let speaker_mask = match channels {
            1 => SPEAKER_FRONT_CENTER,
            2 => SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT,
            _ => KSAUDIO_SPEAKER_DIRECTOUT,
        };
        let mask_candidates = if channels <= 2 {
            vec![speaker_mask, KSAUDIO_SPEAKER_DIRECTOUT]
        } else {
            vec![KSAUDIO_SPEAKER_DIRECTOUT]
        };

        let mut candidates = Vec::new();
        for mask in mask_candidates {
            let mask_label = if mask == KSAUDIO_SPEAKER_DIRECTOUT {
                "directout"
            } else {
                "speakers"
            };

            candidates.push(FormatAttempt {
                label: if mask_label == "directout" {
                    "Float32 (extensible, directout)"
                } else {
                    "Float32 (extensible, speakers)"
                },
                sample_format: WasapiSampleFormat::Float32,
                wave_format: build_wave_format_extensible(
                    sample_rate,
                    channels,
                    4,
                    32,
                    mask,
                    KSDATAFORMAT_SUBTYPE_IEEE_FLOAT,
                ),
            });

            candidates.push(FormatAttempt {
                label: if mask_label == "directout" {
                    "PCM32 (extensible, directout)"
                } else {
                    "PCM32 (extensible, speakers)"
                },
                sample_format: WasapiSampleFormat::Pcm32,
                wave_format: build_wave_format_extensible(
                    sample_rate,
                    channels,
                    4,
                    32,
                    mask,
                    KSDATAFORMAT_SUBTYPE_PCM,
                ),
            });

            candidates.push(FormatAttempt {
                label: if mask_label == "directout" {
                    "PCM24 (extensible, 24-in-32, directout)"
                } else {
                    "PCM24 (extensible, 24-in-32, speakers)"
                },
                sample_format: WasapiSampleFormat::Pcm24In32,
                wave_format: build_wave_format_extensible(
                    sample_rate,
                    channels,
                    4,
                    24,
                    mask,
                    KSDATAFORMAT_SUBTYPE_PCM,
                ),
            });

            candidates.push(FormatAttempt {
                label: if mask_label == "directout" {
                    "PCM24 (extensible, packed, directout)"
                } else {
                    "PCM24 (extensible, packed, speakers)"
                },
                sample_format: WasapiSampleFormat::Pcm24Packed,
                wave_format: build_wave_format_extensible(
                    sample_rate,
                    channels,
                    3,
                    24,
                    mask,
                    KSDATAFORMAT_SUBTYPE_PCM,
                ),
            });

            candidates.push(FormatAttempt {
                label: if mask_label == "directout" {
                    "PCM16 (extensible, directout)"
                } else {
                    "PCM16 (extensible, speakers)"
                },
                sample_format: WasapiSampleFormat::Pcm16,
                wave_format: build_wave_format_extensible(
                    sample_rate,
                    channels,
                    2,
                    16,
                    mask,
                    KSDATAFORMAT_SUBTYPE_PCM,
                ),
            });

            if matches!(transport_mode, NativeAudioTransportMode::TransportExact) {
                continue;
            }
        }

        if !matches!(transport_mode, NativeAudioTransportMode::TransportExact) {
            candidates.push(FormatAttempt {
                label: "Float32 (waveex)",
                sample_format: WasapiSampleFormat::Float32,
                wave_format: WaveFormatAttempt::Ex(build_wave_format_ex(
                    WAVE_FORMAT_IEEE_FLOAT as u16,
                    sample_rate,
                    channels,
                    4,
                )),
            });

            candidates.push(FormatAttempt {
                label: "PCM32 (waveex)",
                sample_format: WasapiSampleFormat::Pcm32,
                wave_format: WaveFormatAttempt::Ex(build_wave_format_ex(
                    WAVE_FORMAT_PCM as u16,
                    sample_rate,
                    channels,
                    4,
                )),
            });

            candidates.push(FormatAttempt {
                label: "PCM24 (waveex, packed)",
                sample_format: WasapiSampleFormat::Pcm24Packed,
                wave_format: WaveFormatAttempt::Ex(build_wave_format_ex(
                    WAVE_FORMAT_PCM as u16,
                    sample_rate,
                    channels,
                    3,
                )),
            });

            candidates.push(FormatAttempt {
                label: "PCM16 (waveex)",
                sample_format: WasapiSampleFormat::Pcm16,
                wave_format: WaveFormatAttempt::Ex(build_wave_format_ex(
                    WAVE_FORMAT_PCM as u16,
                    sample_rate,
                    channels,
                    2,
                )),
            });
        }

        if matches!(transport_mode, NativeAudioTransportMode::TransportExact) {
            candidates.sort_by_key(|attempt| match attempt.sample_format {
                WasapiSampleFormat::Pcm24In32 => 0,
                WasapiSampleFormat::Pcm32 => 1,
                WasapiSampleFormat::Pcm24Packed => 2,
                WasapiSampleFormat::Float32 => 3,
                WasapiSampleFormat::Pcm16 => 4,
            });
        }
        let mut last_error: Option<AudioOutputError> = None;

        for attempt in candidates {
            let audio_client: IAudioClient = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| AudioOutputError {
                    code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_OPEN_FAILED,
                    message: format!("Failed to activate audio client: {e}"),
                })?;

            let mut default_period = 0i64;
            let mut min_period = 0i64;
            if let Err(e) =
                audio_client.GetDevicePeriod(Some(&mut default_period), Some(&mut min_period))
            {
                last_error = Some(AudioOutputError {
                    code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_OPEN_FAILED,
                    message: format!("Failed to query device period: {e}"),
                });
                continue;
            }

            // Exclusive mode is more sensitive to underruns; prefer larger buffers for stability.
            // Units: 100ns (20ms = 200_000).
            let base_periodicity = default_period.max(min_period).max(200_000);
            let buffer_candidates = [
                base_periodicity.saturating_mul(4),
                base_periodicity.saturating_mul(8),
                base_periodicity.saturating_mul(2),
                base_periodicity,
            ];

            for buffer_duration in buffer_candidates {
                let event_handle = CreateEventW(None, false, false, PCWSTR::null()).map_err(
                    |e| AudioOutputError {
                        code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_OPEN_FAILED,
                        message: format!("Failed to create audio event handle: {e}"),
                    },
                )?;

                let init = audio_client.Initialize(
                    AUDCLNT_SHAREMODE_EXCLUSIVE,
                    AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                    buffer_duration,
                    buffer_duration,
                    attempt.wave_format.as_ptr(),
                    None,
                );
                if let Err(e) = init {
                    let _ = windows::Win32::Foundation::CloseHandle(event_handle);

                    if e.code() == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED {
                        let aligned_frames = match audio_client.GetBufferSize() {
                            Ok(value) => value,
                            Err(get_err) => {
                                last_error = Some(AudioOutputError {
                                    code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_UNSUPPORTED_FORMAT,
                                    message: format!(
                                        "Failed to query aligned buffer size after AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED (format={}, duration={buffer_duration}): {get_err}",
                                        attempt.label
                                    ),
                                });
                                continue;
                            }
                        };

                        let sample_rate_u64 = sample_rate.max(1) as u64;
                        let aligned_duration = ((10_000_000u64
                            .saturating_mul(aligned_frames as u64)
                            .saturating_add(sample_rate_u64 / 2))
                            / sample_rate_u64)
                            .max(1) as i64;

                        let aligned_audio_client: IAudioClient = device
                            .Activate(CLSCTX_ALL, None)
                            .map_err(|e| AudioOutputError {
                                code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_OPEN_FAILED,
                                message: format!("Failed to activate audio client: {e}"),
                            })?;

                        let aligned_event_handle =
                            CreateEventW(None, false, false, PCWSTR::null()).map_err(|e| {
                                AudioOutputError {
                                    code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_OPEN_FAILED,
                                    message: format!("Failed to create audio event handle: {e}"),
                                }
                            })?;

                        let aligned_init = aligned_audio_client.Initialize(
                            AUDCLNT_SHAREMODE_EXCLUSIVE,
                            AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                            aligned_duration,
                            aligned_duration,
                            attempt.wave_format.as_ptr(),
                            None,
                        );
                        if let Err(aligned_err) = aligned_init {
                            let _ = windows::Win32::Foundation::CloseHandle(aligned_event_handle);
                            last_error = Some(AudioOutputError {
                                code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_UNSUPPORTED_FORMAT,
                                message: format!(
                                    "Failed to init aligned exclusive stream (format={}, duration={aligned_duration}, frames={aligned_frames}): {aligned_err}",
                                    attempt.label
                                ),
                            });
                            continue;
                        }

                        if let Err(e) = aligned_audio_client.SetEventHandle(aligned_event_handle) {
                            let _ = windows::Win32::Foundation::CloseHandle(aligned_event_handle);
                            last_error = Some(AudioOutputError {
                                code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_OPEN_FAILED,
                                message: format!("Failed to set event handle: {e}"),
                            });
                            continue;
                        }

                        let buffer_frame_count =
                            aligned_audio_client.GetBufferSize().map_err(|e| {
                                let _ =
                                    windows::Win32::Foundation::CloseHandle(aligned_event_handle);
                                AudioOutputError {
                                    code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_OPEN_FAILED,
                                    message: format!("Failed to get buffer size: {e}"),
                                }
                            })?;

                let render_client: IAudioRenderClient =
                    aligned_audio_client.GetService().map_err(|e| {
                        let _ =
                            windows::Win32::Foundation::CloseHandle(aligned_event_handle);
                        AudioOutputError {
                            code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_OPEN_FAILED,
                            message: format!("Failed to get render client: {e}"),
                        }
                    })?;

                eprintln!(
                    "[NativeAudio][wasapi-exclusive] Open stream: format={} channels={} sample_rate={} frames={} buffer_duration_100ns={}",
                    attempt.label,
                    channels,
                    sample_rate,
                    buffer_frame_count,
                    aligned_duration
                );
                return Ok(WasapiStream {
                    audio_client: aligned_audio_client,
                    render_client,
                    event_handle: aligned_event_handle,
                    buffer_frame_count,
                    channels,
                    sample_rate,
                    sample_format: attempt.sample_format,
                    transport_mode,
                    started: false,
                });
                    }

                    last_error = Some(AudioOutputError {
                        code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_UNSUPPORTED_FORMAT,
                        message: format!(
                            "Failed to init exclusive stream (format={}, duration={buffer_duration}): {e}",
                            attempt.label
                        ),
                    });
                    continue;
                }

                if let Err(e) = audio_client.SetEventHandle(event_handle) {
                    let _ = windows::Win32::Foundation::CloseHandle(event_handle);
                    last_error = Some(AudioOutputError {
                        code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_OPEN_FAILED,
                        message: format!("Failed to set event handle: {e}"),
                    });
                    continue;
                }

                let buffer_frame_count = audio_client.GetBufferSize().map_err(|e| {
                    let _ = windows::Win32::Foundation::CloseHandle(event_handle);
                    AudioOutputError {
                        code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_OPEN_FAILED,
                        message: format!("Failed to get buffer size: {e}"),
                    }
                })?;

                let render_client: IAudioRenderClient = audio_client.GetService().map_err(|e| {
                    let _ = windows::Win32::Foundation::CloseHandle(event_handle);
                    AudioOutputError {
                        code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_OPEN_FAILED,
                        message: format!("Failed to get render client: {e}"),
                    }
                })?;

                eprintln!(
                    "[NativeAudio][wasapi-exclusive] Open stream: format={} channels={} sample_rate={} frames={} buffer_duration_100ns={}",
                    attempt.label,
                    channels,
                    sample_rate,
                    buffer_frame_count,
                    buffer_duration
                );
                return Ok(WasapiStream {
                    audio_client,
                    render_client,
                    event_handle,
                    buffer_frame_count,
                    channels,
                    sample_rate,
                    sample_format: attempt.sample_format,
                    transport_mode,
                    started: false,
                });
            }
        }

        Err(last_error.unwrap_or(AudioOutputError {
            code: AUDIO_OUTPUT_WASAPI_EXCLUSIVE_UNSUPPORTED_FORMAT,
            message: "No supported exclusive output format found".to_string(),
        }))
    }
}
