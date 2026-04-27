use std::{
    collections::HashMap,
    fs,
    io::{ErrorKind, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Condvar, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use once_cell::sync::Lazy;
use reqwest::{
    blocking::Client,
    header::{HeaderMap, HeaderName, HeaderValue},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use symphonia::core::{
    formats::FormatOptions,
    io::{MediaSource, MediaSourceStream, MediaSourceStreamOptions},
    meta::MetadataOptions,
    probe::Hint,
};
use tauri::AppHandle;
use url::Url;

const REMOTE_STREAM_CACHE_DIR: &str = "native-audio/remote-stream-cache";
const REMOTE_STREAM_PROBE_HARD_WAIT_MS: u64 = 12_000;
const REMOTE_STREAM_PROBE_RETRY_WAIT_MS: u64 = 120;
const REMOTE_STREAM_COMPLETE_MARKER_VERSION: u8 = 1;
const REMOTE_STREAM_EXPIRY_SAFETY_MS: u64 = 60_000;
const REMOTE_STREAM_CONNECT_TIMEOUT_MS: u64 = 10_000;
const REMOTE_STREAM_READ_STALL_TIMEOUT_MS: u64 = 30_000;
const REMOTE_STREAM_GROWING_CACHE_WAIT_MS: u64 = 250;
const REMOTE_STREAM_REBUFFER_DIAGNOSTIC_THROTTLE_MS: u64 = 2_000;
const REMOTE_STREAM_CANCEL_REASON_MATERIALIZE_ABORTED: u64 = 1;
pub(crate) const REMOTE_STREAM_CANCEL_REASON_TRANSPORT_REPLACED: u64 = 2;
pub(crate) const REMOTE_STREAM_CANCEL_REASON_TRANSPORT_STOPPED: u64 = 3;

static REMOTE_STREAM_IN_FLIGHT: Lazy<Mutex<HashMap<PathBuf, Arc<RemoteStreamDownloadJob>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static REMOTE_STREAM_INPUT_LOCATORS: Lazy<Mutex<HashMap<PathBuf, RemoteStreamInputLocator>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static REMOTE_STREAM_REBUFFER_WAIT_THROTTLE: AtomicU64 = AtomicU64::new(0);
static REMOTE_STREAM_REBUFFER_TIMEOUT_THROTTLE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum NativeAudioSourcePayload {
    LocalFile {
        path: String,
        source_locator: Option<String>,
        connector_id: Option<String>,
    },
    CacheFile {
        path: String,
        source_locator: Option<String>,
        connector_id: Option<String>,
    },
    RemoteStream {
        stream_url: String,
        source_locator: Option<String>,
        connector_id: Option<String>,
        mime_type: Option<String>,
        headers: Option<HashMap<String, String>>,
        expires_at_ms: Option<u64>,
        seekable: Option<bool>,
        range_requests: Option<bool>,
    },
}

#[derive(Default)]
struct RemoteStreamDownloadState {
    bytes_written: u64,
    completed: bool,
    finalized: bool,
    last_error: Option<String>,
}

struct RemoteStreamDownloadJob {
    state: Mutex<RemoteStreamDownloadState>,
    signal: Condvar,
    cancel_requested: AtomicBool,
    cancel_reason: AtomicU64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub(crate) struct RemoteStreamInputLocator {
    pub cache_root: PathBuf,
    pub stream_url: String,
    pub source_locator: Option<String>,
    pub connector_id: Option<String>,
    pub mime_type: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub expires_at_ms: Option<u64>,
    pub seekable: Option<bool>,
    pub range_requests: Option<bool>,
}

#[derive(Debug, Clone)]
struct RemoteStreamCacheEntry {
    key: String,
    cache_path: PathBuf,
    part_marker_path: PathBuf,
    complete_marker_path: PathBuf,
}

struct RemoteStreamCacheBacking {
    cache_path: PathBuf,
    job: Option<Arc<RemoteStreamDownloadJob>>,
    seekable: bool,
    complete_len: Option<u64>,
}

struct RemoteGrowingCacheMediaSource {
    cache_path: PathBuf,
    job: Option<Arc<RemoteStreamDownloadJob>>,
    position: u64,
    seekable: bool,
    complete_len: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct RemoteStreamCompleteMarker {
    version: u8,
    cache_key: String,
    bytes: u64,
    expires_at_ms: Option<u64>,
    completed_at_ms: u64,
}

fn normalize_string(value: &str) -> String {
    value.trim().to_string()
}

fn normalize_optional_string(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(normalize_string)
        .filter(|value| !value.is_empty())
}

fn parse_env_u64(key: &str, default_value: u64, min: u64, max: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(default_value)
        .clamp(min, max)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

fn remote_stream_read_stall_timeout() -> Duration {
    Duration::from_millis(parse_env_u64(
        "PMP_AUDIO_REMOTE_STREAM_READ_STALL_TIMEOUT_MS",
        REMOTE_STREAM_READ_STALL_TIMEOUT_MS,
        5_000,
        300_000,
    ))
}

fn is_remote_stream_read_timeout(error: &std::io::Error) -> bool {
    if error.kind() == ErrorKind::TimedOut {
        return true;
    }
    error
        .get_ref()
        .and_then(|inner| inner.downcast_ref::<reqwest::Error>())
        .map(|error| error.is_timeout())
        .unwrap_or(false)
}

fn build_remote_stream_cache_root(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let root = app_handle
        .path_resolver()
        .app_cache_dir()
        .or_else(|| app_handle.path_resolver().app_data_dir())
        .ok_or_else(|| {
            "Failed to resolve native audio remote stream cache directory".to_string()
        })?;
    let cache_root = root.join(REMOTE_STREAM_CACHE_DIR);
    fs::create_dir_all(&cache_root)
        .map_err(|error| format!("Failed to create remote stream cache directory: {error}"))?;
    Ok(cache_root)
}

fn infer_remote_stream_cache_extension(stream_url: &str, mime_type: Option<&str>) -> String {
    if let Some(mime) = mime_type {
        let lowered = mime.trim().to_ascii_lowercase();
        if lowered.contains("audio/mpeg") {
            return "mp3".to_string();
        }
        if lowered.contains("audio/flac") {
            return "flac".to_string();
        }
        if lowered.contains("audio/ogg") || lowered.contains("application/ogg") {
            return "ogg".to_string();
        }
        if lowered.contains("audio/wav") || lowered.contains("audio/x-wav") {
            return "wav".to_string();
        }
        if lowered.contains("audio/aac")
            || lowered.contains("audio/mp4")
            || lowered.contains("audio/x-m4a")
            || lowered.contains("video/mp4")
        {
            return "m4a".to_string();
        }
    }

    if let Ok(parsed) = Url::parse(stream_url) {
        if let Some(segment) = parsed
            .path_segments()
            .into_iter()
            .flat_map(|segments| segments)
            .last()
        {
            if let Some(extension) = Path::new(segment).extension().and_then(|ext| ext.to_str()) {
                let lowered = extension.trim().to_ascii_lowercase();
                if lowered == "m4s" {
                    return "m4a".to_string();
                }
                if matches!(
                    lowered.as_str(),
                    "m4a" | "mp3" | "aac" | "ogg" | "flac" | "wav" | "opus" | "webm"
                ) {
                    return lowered;
                }
            }
        }
    }

    "bin".to_string()
}

fn build_remote_stream_cache_key(
    stream_url: &str,
    source_locator: Option<&str>,
    connector_id: Option<&str>,
    headers: Option<&HashMap<String, String>>,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(stream_url.as_bytes());
    if let Some(locator) = source_locator {
        hasher.update(b"|locator:");
        hasher.update(locator.as_bytes());
    }
    if let Some(connector) = connector_id {
        hasher.update(b"|connector:");
        hasher.update(connector.as_bytes());
    }
    if let Some(entries) = headers {
        let mut items = entries.iter().collect::<Vec<_>>();
        items.sort_by(|a, b| a.0.cmp(b.0));
        for (key, value) in items {
            hasher.update(b"|header:");
            hasher.update(key.as_bytes());
            hasher.update(b"=");
            hasher.update(value.as_bytes());
        }
    }
    format!("{:x}", hasher.finalize())
}

fn append_cache_file_suffix(path: &Path, suffix: &str) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("remote-stream-cache");
    path.with_file_name(format!("{file_name}{suffix}"))
}

fn build_remote_stream_cache_entry(
    cache_root: &Path,
    stream_url: &str,
    source_locator: Option<&str>,
    connector_id: Option<&str>,
    mime_type: Option<&str>,
    headers: Option<&HashMap<String, String>>,
) -> RemoteStreamCacheEntry {
    let key = build_remote_stream_cache_key(stream_url, source_locator, connector_id, headers);
    let extension = infer_remote_stream_cache_extension(stream_url, mime_type);
    let cache_path = cache_root.join(format!("{key}.{extension}"));
    RemoteStreamCacheEntry {
        key,
        part_marker_path: append_cache_file_suffix(&cache_path, ".part"),
        complete_marker_path: append_cache_file_suffix(&cache_path, ".complete"),
        cache_path,
    }
}

fn remote_stream_locator_identity_path(locator: &RemoteStreamInputLocator) -> PathBuf {
    let identity = locator
        .source_locator
        .as_deref()
        .map(normalize_string)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| normalize_string(&locator.stream_url));
    PathBuf::from(identity)
}

#[cfg(test)]
fn encode_remote_stream_locator_path(locator: &RemoteStreamInputLocator) -> PathBuf {
    let payload = serde_json::to_vec(locator).unwrap_or_default();
    let encoded = URL_SAFE_NO_PAD.encode(payload);
    PathBuf::from(format!("pmp-remote-stream://{encoded}"))
}

fn decode_remote_stream_locator_path(path: &Path) -> Option<RemoteStreamInputLocator> {
    let value = path.to_string_lossy();
    let encoded = value.strip_prefix("pmp-remote-stream://")?;
    let bytes = URL_SAFE_NO_PAD.decode(encoded.as_bytes()).ok()?;
    serde_json::from_slice::<RemoteStreamInputLocator>(&bytes).ok()
}

pub(crate) fn register_remote_stream_input_locator(locator: RemoteStreamInputLocator) -> PathBuf {
    let identity_path = remote_stream_locator_identity_path(&locator);
    if let Ok(mut locators) = REMOTE_STREAM_INPUT_LOCATORS.lock() {
        locators.insert(identity_path.clone(), locator);
    }
    identity_path
}

pub(crate) fn lookup_remote_stream_input_locator(path: &Path) -> Option<RemoteStreamInputLocator> {
    if let Some(locator) = decode_remote_stream_locator_path(path) {
        return Some(locator);
    }
    REMOTE_STREAM_INPUT_LOCATORS
        .lock()
        .ok()
        .and_then(|locators| locators.get(path).cloned())
}

fn build_http_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_millis(REMOTE_STREAM_CONNECT_TIMEOUT_MS))
        // reqwest 0.11 blocking applies this timeout to connect/read/write
        // operations, which gives the materializer a read-stall watchdog.
        .timeout(remote_stream_read_stall_timeout())
        .build()
        .map_err(|error| format!("Failed to create remote stream HTTP client: {error}"))
}

fn build_request_headers(entries: Option<&HashMap<String, String>>) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    let Some(entries) = entries else {
        return Ok(headers);
    };

    for (key, value) in entries {
        let name = HeaderName::from_bytes(key.trim().as_bytes())
            .map_err(|error| format!("Invalid remote stream header name '{key}': {error}"))?;
        let header_value = HeaderValue::from_str(value.trim())
            .map_err(|error| format!("Invalid remote stream header value for '{key}': {error}"))?;
        headers.insert(name, header_value);
    }

    Ok(headers)
}

fn header_map_contains(headers: &HeaderMap, name: &'static str) -> bool {
    headers.contains_key(HeaderName::from_static(name))
}

fn apply_remote_stream_range_header(headers: &mut HeaderMap, range_requests: Option<bool>) {
    if range_requests != Some(true) || header_map_contains(headers, "range") {
        return;
    }
    headers.insert(
        HeaderName::from_static("range"),
        HeaderValue::from_static("bytes=0-"),
    );
    crate::audio::diagnostics::record_event("transport.source.remote.range_request", 0, 0);
}

fn can_probe_remote_stream_cache(path: &Path) -> bool {
    let file = match fs::File::open(path) {
        Ok(value) => value,
        Err(_) => return false,
    };
    let mss = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(ext);
    }

    let probed = match symphonia::default::get_probe().format(
        &hint,
        mss,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    ) {
        Ok(value) => value,
        Err(_) => return false,
    };

    probed.format.tracks().iter().any(|track| {
        track.codec_params.sample_rate.is_some() || track.codec_params.channels.is_some()
    })
}

fn remote_stream_cache_expired(expires_at_ms: Option<u64>) -> bool {
    let Some(expires_at_ms) = expires_at_ms else {
        return false;
    };
    expires_at_ms <= now_millis().saturating_add(REMOTE_STREAM_EXPIRY_SAFETY_MS)
}

fn read_remote_stream_complete_marker(
    entry: &RemoteStreamCacheEntry,
) -> Option<RemoteStreamCompleteMarker> {
    let bytes = fs::read(&entry.complete_marker_path).ok()?;
    serde_json::from_slice::<RemoteStreamCompleteMarker>(&bytes).ok()
}

fn effective_remote_stream_expiry(
    marker_expires_at_ms: Option<u64>,
    request_expires_at_ms: Option<u64>,
) -> Option<u64> {
    match (marker_expires_at_ms, request_expires_at_ms) {
        (Some(marker), Some(request)) => Some(marker.min(request)),
        (Some(marker), None) => Some(marker),
        (None, Some(request)) => Some(request),
        (None, None) => None,
    }
}

fn remote_stream_complete_cache_is_valid(
    entry: &RemoteStreamCacheEntry,
    request_expires_at_ms: Option<u64>,
) -> bool {
    let metadata = match fs::metadata(&entry.cache_path) {
        Ok(value) => value,
        Err(_) => return false,
    };
    if !metadata.is_file() || metadata.len() == 0 {
        return false;
    }

    let Some(marker) = read_remote_stream_complete_marker(entry) else {
        return false;
    };
    if marker.version != REMOTE_STREAM_COMPLETE_MARKER_VERSION {
        return false;
    }
    if marker.cache_key != entry.key {
        return false;
    }
    if marker.bytes != metadata.len() {
        return false;
    }
    if remote_stream_cache_expired(effective_remote_stream_expiry(
        marker.expires_at_ms,
        request_expires_at_ms,
    )) {
        return false;
    }

    can_probe_remote_stream_cache(&entry.cache_path)
}

fn write_remote_stream_complete_marker(
    entry: &RemoteStreamCacheEntry,
    bytes_written: u64,
    expires_at_ms: Option<u64>,
) -> Result<(), String> {
    let marker = RemoteStreamCompleteMarker {
        version: REMOTE_STREAM_COMPLETE_MARKER_VERSION,
        cache_key: entry.key.clone(),
        bytes: bytes_written,
        expires_at_ms,
        completed_at_ms: now_millis(),
    };
    let payload = serde_json::to_vec(&marker)
        .map_err(|error| format!("Failed to serialize remote stream cache marker: {error}"))?;
    let temp_marker_path = append_cache_file_suffix(&entry.complete_marker_path, ".tmp");
    fs::write(&temp_marker_path, payload)
        .map_err(|error| format!("Failed to write remote stream cache marker: {error}"))?;
    let _ = fs::remove_file(&entry.complete_marker_path);
    fs::rename(&temp_marker_path, &entry.complete_marker_path)
        .map_err(|error| format!("Failed to finalize remote stream cache marker: {error}"))?;
    Ok(())
}

fn clear_stale_remote_stream_cache(entry: &RemoteStreamCacheEntry) {
    let _ = fs::remove_file(&entry.complete_marker_path);
    let _ = fs::remove_file(&entry.part_marker_path);
    let _ = fs::remove_file(&entry.cache_path);
}

fn remote_stream_in_flight_key(entry: &RemoteStreamCacheEntry) -> PathBuf {
    entry.cache_path.clone()
}

fn remote_stream_download_cancel_message(reason: u64) -> String {
    let reason_label = match reason {
        REMOTE_STREAM_CANCEL_REASON_MATERIALIZE_ABORTED => "materialize-aborted",
        REMOTE_STREAM_CANCEL_REASON_TRANSPORT_REPLACED => "transport-replaced",
        REMOTE_STREAM_CANCEL_REASON_TRANSPORT_STOPPED => "transport-stopped",
        _ => "unknown",
    };
    format!("Remote stream download cancelled ({reason_label})")
}

fn request_remote_stream_download_cancel(job: &Arc<RemoteStreamDownloadJob>, reason: u64) -> bool {
    if job
        .cancel_requested
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return false;
    }

    job.cancel_reason.store(reason, Ordering::Release);
    let bytes_written = if let Ok(mut state) = job.state.lock() {
        if !state.completed {
            state.last_error = Some(remote_stream_download_cancel_message(reason));
        }
        state.bytes_written
    } else {
        0
    };
    crate::audio::diagnostics::record_event(
        "transport.source.remote.cancel",
        bytes_written,
        reason,
    );
    job.signal.notify_all();
    true
}

fn remote_stream_download_cancel_requested(job: &RemoteStreamDownloadJob) -> Option<u64> {
    job.cancel_requested
        .load(Ordering::Acquire)
        .then(|| job.cancel_reason.load(Ordering::Acquire))
}

fn remote_stream_download_cancel_error(job: &RemoteStreamDownloadJob) -> Option<String> {
    remote_stream_download_cancel_requested(job).map(remote_stream_download_cancel_message)
}

fn cancel_remote_stream_downloads_matching(keep_key: Option<&Path>, reason: u64) -> usize {
    let jobs = match REMOTE_STREAM_IN_FLIGHT.lock() {
        Ok(in_flight) => in_flight
            .iter()
            .filter_map(|(key, job)| {
                let should_keep = keep_key
                    .map(|keep_key| keep_key == key.as_path())
                    .unwrap_or(false);
                (!should_keep).then(|| job.clone())
            })
            .collect::<Vec<_>>(),
        Err(_) => Vec::new(),
    };

    let cancelled = jobs
        .iter()
        .filter(|job| request_remote_stream_download_cancel(job, reason))
        .count();
    if cancelled > 0 {
        crate::audio::diagnostics::record_event(
            "transport.source.remote.cancel_batch",
            cancelled as u64,
            reason,
        );
    }
    cancelled
}

pub(crate) fn cancel_remote_stream_downloads(reason: u64) -> usize {
    cancel_remote_stream_downloads_matching(None, reason)
}

fn mark_remote_stream_part_started(entry: &RemoteStreamCacheEntry) -> Result<(), String> {
    let payload = format!("cache_key={}\nstarted_at_ms={}\n", entry.key, now_millis());
    fs::write(&entry.part_marker_path, payload)
        .map_err(|error| format!("Failed to write remote stream partial marker: {error}"))
}

fn finalize_remote_stream_cache(
    entry: &RemoteStreamCacheEntry,
    bytes_written: u64,
    expires_at_ms: Option<u64>,
) -> Result<(), String> {
    let metadata = fs::metadata(&entry.cache_path)
        .map_err(|error| format!("Failed to inspect remote stream cache file: {error}"))?;
    if bytes_written == 0 || metadata.len() != bytes_written {
        return Err(format!(
            "Remote stream cache completeness mismatch (written={bytes_written}, file={})",
            metadata.len()
        ));
    }
    write_remote_stream_complete_marker(entry, bytes_written, expires_at_ms)?;
    let _ = fs::remove_file(&entry.part_marker_path);
    Ok(())
}

fn remote_stream_cache_len(path: &Path) -> u64 {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

fn wait_for_remote_stream_cache_growth(
    job: &Arc<RemoteStreamDownloadJob>,
    position: u64,
) -> std::io::Result<bool> {
    let started_at = Instant::now();
    let state_guard = job
        .state
        .lock()
        .map_err(|_| std::io::Error::new(ErrorKind::Other, "Remote stream state is poisoned"))?;
    if state_guard.bytes_written > position {
        return Ok(true);
    }
    if let Some(error) = state_guard.last_error.clone() {
        return Err(std::io::Error::new(ErrorKind::Other, error));
    }
    if state_guard.completed {
        return Ok(false);
    }

    let (state_guard, wait_result) = job
        .signal
        .wait_timeout(
            state_guard,
            Duration::from_millis(REMOTE_STREAM_GROWING_CACHE_WAIT_MS),
        )
        .map_err(|_| std::io::Error::new(ErrorKind::Other, "Remote stream wait failed"))?;
    let waited_ms = started_at.elapsed().as_millis().min(u64::MAX as u128) as u64;
    crate::audio::diagnostics::record_event_throttled(
        "transport.source.remote.rebuffer_wait",
        waited_ms,
        position,
        &REMOTE_STREAM_REBUFFER_WAIT_THROTTLE,
        REMOTE_STREAM_REBUFFER_DIAGNOSTIC_THROTTLE_MS,
    );

    if let Some(error) = state_guard.last_error.clone() {
        return Err(std::io::Error::new(ErrorKind::Other, error));
    }
    if state_guard.bytes_written > position {
        return Ok(true);
    }
    if state_guard.completed {
        return Ok(false);
    }
    if wait_result.timed_out() {
        crate::audio::diagnostics::record_event_throttled(
            "transport.source.remote.rebuffer_timeout",
            waited_ms,
            position,
            &REMOTE_STREAM_REBUFFER_TIMEOUT_THROTTLE,
            REMOTE_STREAM_REBUFFER_DIAGNOSTIC_THROTTLE_MS,
        );
    }
    Ok(true)
}

impl RemoteGrowingCacheMediaSource {
    fn new(backing: RemoteStreamCacheBacking) -> Self {
        Self {
            cache_path: backing.cache_path,
            job: backing.job,
            position: 0,
            seekable: backing.seekable,
            complete_len: backing.complete_len,
        }
    }

    fn read_from_cache_at_position(&self, buf: &mut [u8]) -> std::io::Result<usize> {
        let mut file = fs::File::open(&self.cache_path)?;
        file.seek(SeekFrom::Start(self.position))?;
        file.read(buf)
    }
}

impl Read for RemoteGrowingCacheMediaSource {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }

        loop {
            match self.read_from_cache_at_position(buf) {
                Ok(read) if read > 0 => {
                    self.position = self.position.saturating_add(read as u64);
                    return Ok(read);
                }
                Ok(_) => {}
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }

            let Some(job) = &self.job else {
                return Ok(0);
            };
            if !wait_for_remote_stream_cache_growth(job, self.position)? {
                return Ok(0);
            }
        }
    }
}

impl Seek for RemoteGrowingCacheMediaSource {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        if !self.seekable {
            return Err(std::io::Error::new(
                ErrorKind::Unsupported,
                "Remote stream is not seekable",
            ));
        }

        let target = match pos {
            SeekFrom::Start(position) => position,
            SeekFrom::Current(delta) => {
                if delta < 0 {
                    self.position.saturating_sub(delta.unsigned_abs())
                } else {
                    self.position.saturating_add(delta as u64)
                }
            }
            SeekFrom::End(delta) => {
                let len = self.byte_len().ok_or_else(|| {
                    std::io::Error::new(
                        ErrorKind::Unsupported,
                        "Remote stream length is not known yet",
                    )
                })?;
                if delta < 0 {
                    len.saturating_sub(delta.unsigned_abs())
                } else {
                    len.saturating_add(delta as u64)
                }
            }
        };

        self.position = target;
        crate::audio::diagnostics::record_event("transport.source.remote.seek", target, 0);
        Ok(self.position)
    }
}

impl MediaSource for RemoteGrowingCacheMediaSource {
    fn is_seekable(&self) -> bool {
        self.seekable
    }

    fn byte_len(&self) -> Option<u64> {
        self.complete_len.or_else(|| {
            self.job.as_ref().and_then(|job| {
                job.state.lock().ok().and_then(|state| {
                    state
                        .finalized
                        .then_some(state.bytes_written)
                        .filter(|bytes| *bytes > 0)
                })
            })
        })
    }
}

fn wait_for_remote_stream_probe_ready(
    job: &Arc<RemoteStreamDownloadJob>,
    entry: &RemoteStreamCacheEntry,
    expires_at_ms: Option<u64>,
) -> Result<(), String> {
    if remote_stream_complete_cache_is_valid(entry, expires_at_ms)
        || can_probe_remote_stream_cache(&entry.cache_path)
    {
        return Ok(());
    }

    let started_at = Instant::now();
    let deadline = started_at + Duration::from_millis(REMOTE_STREAM_PROBE_HARD_WAIT_MS);

    loop {
        if let Some(cancel_error) = remote_stream_download_cancel_error(job) {
            return Err(cancel_error);
        }

        let now = Instant::now();
        if now >= deadline {
            let bytes_written = fs::metadata(&entry.cache_path)
                .ok()
                .map(|meta| meta.len())
                .unwrap_or(0);
            return Err(format!(
                "Remote stream cache is not ready for decoding within timeout (bytes={bytes_written})"
            ));
        }

        let remaining = deadline.saturating_duration_since(now);
        let wait_window = Duration::from_millis(REMOTE_STREAM_PROBE_RETRY_WAIT_MS).min(remaining);
        let state_guard = job
            .state
            .lock()
            .map_err(|_| "Remote stream download state is poisoned".to_string())?;
        let (state_guard, _) = job
            .signal
            .wait_timeout(state_guard, wait_window)
            .map_err(|_| "Remote stream probe wait failed".to_string())?;

        if let Some(error) = state_guard.last_error.clone() {
            return Err(error);
        }
        if remote_stream_complete_cache_is_valid(entry, expires_at_ms)
            || can_probe_remote_stream_cache(&entry.cache_path)
        {
            crate::audio::diagnostics::record_event(
                "transport.source.remote.probe_wait",
                started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
                state_guard.bytes_written,
            );
            return Ok(());
        }
        if state_guard.completed {
            return Err(format!(
                "Remote stream cache download completed but remains undecodable (bytes={})",
                state_guard.bytes_written
            ));
        }
    }
}

fn spawn_remote_stream_download(
    entry: RemoteStreamCacheEntry,
    stream_url: String,
    headers: HeaderMap,
    expires_at_ms: Option<u64>,
    range_requests: Option<bool>,
) -> Arc<RemoteStreamDownloadJob> {
    let job = Arc::new(RemoteStreamDownloadJob {
        state: Mutex::new(RemoteStreamDownloadState::default()),
        signal: Condvar::new(),
        cancel_requested: AtomicBool::new(false),
        cancel_reason: AtomicU64::new(0),
    });
    let job_for_thread = job.clone();
    let job_for_registry = job.clone();

    thread::spawn(move || {
        let result = (|| -> Result<u64, String> {
            if let Some(cancel_error) = remote_stream_download_cancel_error(&job_for_thread) {
                return Err(cancel_error);
            }
            mark_remote_stream_part_started(&entry)?;
            let client = build_http_client()?;
            let mut request = client.get(&stream_url);
            let mut headers = headers;
            apply_remote_stream_range_header(&mut headers, range_requests);
            if !headers.is_empty() {
                request = request.headers(headers);
            }
            if let Some(cancel_error) = remote_stream_download_cancel_error(&job_for_thread) {
                return Err(cancel_error);
            }
            let mut response = request
                .send()
                .map_err(|error| format!("Failed to start remote stream download: {error}"))?;
            let status = response.status();
            if !status.is_success() {
                return Err(format!(
                    "Remote stream returned non-success status: {status}"
                ));
            }
            if status.as_u16() == 206 {
                crate::audio::diagnostics::record_event(
                    "transport.source.remote.range_response",
                    206,
                    0,
                );
            }

            let mut file = fs::File::create(&entry.cache_path)
                .map_err(|error| format!("Failed to create remote stream cache file: {error}"))?;
            let mut bytes_written = 0u64;
            let mut buf = [0u8; 64 * 1024];
            let read_stall_timeout = remote_stream_read_stall_timeout();
            loop {
                if let Some(cancel_error) = remote_stream_download_cancel_error(&job_for_thread) {
                    return Err(cancel_error);
                }
                let read = match response.read(&mut buf) {
                    Ok(read) => read,
                    Err(error) if is_remote_stream_read_timeout(&error) => {
                        crate::audio::diagnostics::record_event(
                            "transport.source.remote.read_stall",
                            bytes_written,
                            read_stall_timeout.as_millis().min(u64::MAX as u128) as u64,
                        );
                        return Err(format!(
                            "Remote stream read stalled after {} ms (bytes={bytes_written})",
                            read_stall_timeout.as_millis()
                        ));
                    }
                    Err(error) => {
                        return Err(format!("Failed to read remote stream bytes: {error}"));
                    }
                };
                if read == 0 {
                    break;
                }
                if let Some(cancel_error) = remote_stream_download_cancel_error(&job_for_thread) {
                    return Err(cancel_error);
                }
                file.write_all(&buf[..read]).map_err(|error| {
                    format!("Failed to write remote stream cache bytes: {error}")
                })?;
                bytes_written = bytes_written.saturating_add(read as u64);
                if bytes_written % (512 * 1024) < read as u64 {
                    let _ = file.flush();
                }
                if let Ok(mut state) = job_for_thread.state.lock() {
                    state.bytes_written = bytes_written;
                    job_for_thread.signal.notify_all();
                }
            }
            let _ = file.flush();
            drop(file);
            finalize_remote_stream_cache(&entry, bytes_written, expires_at_ms)?;
            Ok(bytes_written)
        })();

        if let Ok(mut state) = job_for_thread.state.lock() {
            match result {
                Ok(bytes_written) => {
                    state.bytes_written = bytes_written;
                    state.completed = true;
                    state.finalized = true;
                    state.last_error = None;
                }
                Err(error) => {
                    state.completed = true;
                    state.last_error = Some(error);
                }
            }
            job_for_thread.signal.notify_all();
        }

        if let Ok(mut in_flight) = REMOTE_STREAM_IN_FLIGHT.lock() {
            let in_flight_key = remote_stream_in_flight_key(&entry);
            if in_flight
                .get(&in_flight_key)
                .map(|existing| Arc::ptr_eq(existing, &job_for_registry))
                .unwrap_or(false)
            {
                in_flight.remove(&in_flight_key);
            }
        }
    });

    job
}

fn get_or_spawn_remote_stream_download(
    entry: &RemoteStreamCacheEntry,
    stream_url: &str,
    headers: HeaderMap,
    expires_at_ms: Option<u64>,
    range_requests: Option<bool>,
) -> Result<Arc<RemoteStreamDownloadJob>, String> {
    let mut in_flight = REMOTE_STREAM_IN_FLIGHT
        .lock()
        .map_err(|_| "Remote stream in-flight registry is poisoned".to_string())?;
    let in_flight_key = remote_stream_in_flight_key(entry);
    if let Some(job) = in_flight.get(&in_flight_key) {
        crate::audio::diagnostics::record_event("transport.source.remote.inflight_join", 1, 1);
        return Ok(job.clone());
    }

    clear_stale_remote_stream_cache(entry);
    let job = spawn_remote_stream_download(
        entry.clone(),
        stream_url.to_string(),
        headers,
        expires_at_ms,
        range_requests,
    );
    in_flight.insert(in_flight_key.clone(), job.clone());
    drop(in_flight);

    let already_completed = job
        .state
        .lock()
        .map(|state| state.completed)
        .unwrap_or(true);
    if already_completed {
        if let Ok(mut in_flight) = REMOTE_STREAM_IN_FLIGHT.lock() {
            if in_flight
                .get(&in_flight_key)
                .map(|existing| Arc::ptr_eq(existing, &job))
                .unwrap_or(false)
            {
                in_flight.remove(&in_flight_key);
            }
        }
    }
    Ok(job)
}

fn materialize_remote_stream_to_cache_root(
    cache_root: &Path,
    stream_url: &str,
    source_locator: Option<&str>,
    connector_id: Option<&str>,
    mime_type: Option<&str>,
    headers: Option<&HashMap<String, String>>,
    expires_at_ms: Option<u64>,
    range_requests: Option<bool>,
) -> Result<PathBuf, String> {
    let entry = build_remote_stream_cache_entry(
        cache_root,
        stream_url,
        source_locator,
        connector_id,
        mime_type,
        headers,
    );

    if remote_stream_complete_cache_is_valid(&entry, expires_at_ms) {
        crate::audio::diagnostics::record_event("transport.source.remote.cache_hit", 1, 1);
        return Ok(entry.cache_path);
    }

    let request_headers = build_request_headers(headers)?;
    let started_at = Instant::now();
    let in_flight_key = remote_stream_in_flight_key(&entry);
    cancel_remote_stream_downloads_matching(
        Some(in_flight_key.as_path()),
        REMOTE_STREAM_CANCEL_REASON_TRANSPORT_REPLACED,
    );
    let job = get_or_spawn_remote_stream_download(
        &entry,
        stream_url,
        request_headers,
        expires_at_ms,
        range_requests,
    )?;
    let result = wait_for_remote_stream_probe_ready(&job, &entry, expires_at_ms);
    crate::audio::diagnostics::record_event(
        "transport.source.remote.materialize",
        started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
        result.is_ok() as u64,
    );
    if result.is_err() {
        request_remote_stream_download_cancel(
            &job,
            REMOTE_STREAM_CANCEL_REASON_MATERIALIZE_ABORTED,
        );
    }
    result.map(|_| entry.cache_path)
}

fn materialize_remote_stream_to_cache(
    app_handle: &AppHandle,
    stream_url: &str,
    source_locator: Option<&str>,
    connector_id: Option<&str>,
    mime_type: Option<&str>,
    headers: Option<&HashMap<String, String>>,
    expires_at_ms: Option<u64>,
    range_requests: Option<bool>,
) -> Result<PathBuf, String> {
    let cache_root = build_remote_stream_cache_root(app_handle)?;
    materialize_remote_stream_to_cache_root(
        &cache_root,
        stream_url,
        source_locator,
        connector_id,
        mime_type,
        headers,
        expires_at_ms,
        range_requests,
    )
}

pub(crate) fn open_remote_stream_media_source(
    locator: &RemoteStreamInputLocator,
) -> Result<(Box<dyn MediaSource>, Option<String>), String> {
    let normalized_url = normalize_string(&locator.stream_url);
    if normalized_url.is_empty() {
        return Err("Remote stream url is empty".to_string());
    }

    let entry = build_remote_stream_cache_entry(
        &locator.cache_root,
        &normalized_url,
        locator.source_locator.as_deref(),
        locator.connector_id.as_deref(),
        locator.mime_type.as_deref(),
        locator.headers.as_ref(),
    );
    let extension = entry
        .cache_path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_string);

    let backing = if remote_stream_complete_cache_is_valid(&entry, locator.expires_at_ms) {
        crate::audio::diagnostics::record_event("transport.source.remote.cache_hit", 1, 2);
        RemoteStreamCacheBacking {
            cache_path: entry.cache_path.clone(),
            job: None,
            seekable: true,
            complete_len: fs::metadata(&entry.cache_path)
                .ok()
                .map(|metadata| metadata.len()),
        }
    } else {
        let request_headers = build_request_headers(locator.headers.as_ref())?;
        let in_flight_key = remote_stream_in_flight_key(&entry);
        cancel_remote_stream_downloads_matching(
            Some(in_flight_key.as_path()),
            REMOTE_STREAM_CANCEL_REASON_TRANSPORT_REPLACED,
        );
        let job = get_or_spawn_remote_stream_download(
            &entry,
            &normalized_url,
            request_headers,
            locator.expires_at_ms,
            locator.range_requests,
        )?;
        crate::audio::diagnostics::record_event(
            "transport.source.remote.growing_cache_open",
            remote_stream_cache_len(&entry.cache_path),
            (locator.range_requests == Some(true)) as u64,
        );
        RemoteStreamCacheBacking {
            cache_path: entry.cache_path.clone(),
            job: Some(job),
            seekable: locator.seekable.unwrap_or(false) || locator.range_requests.unwrap_or(false),
            complete_len: None,
        }
    };

    Ok((
        Box::new(RemoteGrowingCacheMediaSource::new(backing)),
        extension,
    ))
}

impl NativeAudioSourcePayload {
    pub fn is_remote_stream(&self) -> bool {
        matches!(self, Self::RemoteStream { .. })
    }

    pub fn resolve_input_path(&self, app_handle: &AppHandle) -> Result<PathBuf, String> {
        match self {
            Self::LocalFile { path, .. } | Self::CacheFile { path, .. } => {
                let normalized = normalize_string(path);
                if normalized.is_empty() {
                    return Err("Native audio source path is empty".to_string());
                }
                Ok(PathBuf::from(normalized))
            }
            Self::RemoteStream {
                stream_url,
                source_locator,
                connector_id,
                mime_type,
                headers,
                expires_at_ms,
                seekable,
                range_requests,
            } => {
                let normalized_url = normalize_string(stream_url);
                if normalized_url.is_empty() {
                    return Err("Remote stream url is empty".to_string());
                }
                let cache_root = build_remote_stream_cache_root(app_handle)?;
                let locator = RemoteStreamInputLocator {
                    cache_root,
                    stream_url: normalized_url,
                    source_locator: normalize_optional_string(source_locator),
                    connector_id: normalize_optional_string(connector_id),
                    mime_type: normalize_optional_string(mime_type),
                    headers: headers.clone(),
                    expires_at_ms: *expires_at_ms,
                    seekable: *seekable,
                    range_requests: *range_requests,
                };
                let identity_path = register_remote_stream_input_locator(locator);
                crate::audio::diagnostics::record_event(
                    "transport.source.remote.locator_registered",
                    1,
                    0,
                );
                Ok(identity_path)
            }
        }
    }

    pub fn materialize_transport_path(&self, app_handle: &AppHandle) -> Result<PathBuf, String> {
        match self {
            Self::LocalFile { path, .. } | Self::CacheFile { path, .. } => {
                let normalized = normalize_string(path);
                if normalized.is_empty() {
                    return Err("Native audio source path is empty".to_string());
                }
                Ok(PathBuf::from(normalized))
            }
            Self::RemoteStream {
                stream_url,
                source_locator,
                connector_id,
                mime_type,
                headers,
                expires_at_ms,
                seekable: _,
                range_requests,
            } => {
                let normalized_url = normalize_string(stream_url);
                if normalized_url.is_empty() {
                    return Err("Remote stream url is empty".to_string());
                }
                materialize_remote_stream_to_cache(
                    app_handle,
                    &normalized_url,
                    source_locator.as_deref(),
                    connector_id.as_deref(),
                    mime_type.as_deref(),
                    headers.as_ref(),
                    *expires_at_ms,
                    *range_requests,
                )
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Write, thread};

    #[test]
    fn infer_remote_stream_extension_prefers_mime_type() {
        let extension = infer_remote_stream_cache_extension(
            "https://cdn.example.com/audio.bin",
            Some("audio/flac"),
        );
        assert_eq!(extension, "flac");
    }

    #[test]
    fn infer_remote_stream_extension_falls_back_to_url() {
        let extension = infer_remote_stream_cache_extension(
            "https://cdn.example.com/audio/test-track.m4s",
            None,
        );
        assert_eq!(extension, "m4a");
    }

    #[test]
    fn remote_stream_read_stall_timeout_uses_bounded_default() {
        let timeout_ms = parse_env_u64(
            "PMP_AUDIO_TEST_REMOTE_STREAM_READ_STALL_TIMEOUT_MISSING",
            REMOTE_STREAM_READ_STALL_TIMEOUT_MS,
            5_000,
            300_000,
        );
        assert_eq!(timeout_ms, REMOTE_STREAM_READ_STALL_TIMEOUT_MS);
        let runtime_timeout = remote_stream_read_stall_timeout();
        assert!(runtime_timeout >= Duration::from_millis(5_000));
        assert!(runtime_timeout <= Duration::from_millis(300_000));
    }

    #[test]
    fn native_audio_source_payload_accepts_camel_case_remote_fields() {
        let payload = serde_json::json!({
            "kind": "remote-stream",
            "streamUrl": "https://cdn.example.com/audio/test-track.flac",
            "sourceLocator": "netease://song/1",
            "connectorId": "netease",
            "mimeType": "audio/flac",
            "headers": {
                "Authorization": "Bearer token"
            },
            "expiresAtMs": 123456789u64,
            "seekable": true,
            "rangeRequests": true
        });

        let parsed =
            serde_json::from_value::<NativeAudioSourcePayload>(payload).expect("parse payload");
        match parsed {
            NativeAudioSourcePayload::RemoteStream {
                stream_url,
                source_locator,
                connector_id,
                mime_type,
                headers,
                expires_at_ms,
                seekable,
                range_requests,
            } => {
                assert_eq!(stream_url, "https://cdn.example.com/audio/test-track.flac");
                assert_eq!(source_locator.as_deref(), Some("netease://song/1"));
                assert_eq!(connector_id.as_deref(), Some("netease"));
                assert_eq!(mime_type.as_deref(), Some("audio/flac"));
                assert_eq!(
                    headers
                        .as_ref()
                        .and_then(|headers| headers.get("Authorization"))
                        .map(String::as_str),
                    Some("Bearer token")
                );
                assert_eq!(expires_at_ms, Some(123456789));
                assert_eq!(seekable, Some(true));
                assert_eq!(range_requests, Some(true));
            }
            _ => panic!("expected remote-stream payload"),
        }
    }

    fn test_cache_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "pmp-remote-stream-{name}-{}-{}",
            std::process::id(),
            now_millis()
        ));
        fs::create_dir_all(&root).expect("create test cache root");
        root
    }

    fn write_wav_i16_stereo(path: &Path, sample_rate: u32, frames: usize) {
        let channels = 2u16;
        let bits_per_sample = 16u16;
        let block_align = channels * bits_per_sample / 8;
        let byte_rate = sample_rate * block_align as u32;
        let data_bytes = frames * block_align as usize;
        let riff_size = 36 + data_bytes as u32;
        let mut file = fs::File::create(path).expect("create wav");
        file.write_all(b"RIFF").expect("riff");
        file.write_all(&riff_size.to_le_bytes()).expect("riff size");
        file.write_all(b"WAVE").expect("wave");
        file.write_all(b"fmt ").expect("fmt");
        file.write_all(&16u32.to_le_bytes()).expect("fmt size");
        file.write_all(&1u16.to_le_bytes()).expect("pcm");
        file.write_all(&channels.to_le_bytes()).expect("channels");
        file.write_all(&sample_rate.to_le_bytes())
            .expect("sample rate");
        file.write_all(&byte_rate.to_le_bytes()).expect("byte rate");
        file.write_all(&block_align.to_le_bytes())
            .expect("block align");
        file.write_all(&bits_per_sample.to_le_bytes())
            .expect("bits");
        file.write_all(b"data").expect("data");
        file.write_all(&(data_bytes as u32).to_le_bytes())
            .expect("data len");
        for frame in 0..frames {
            let sample = ((frame as i32 % 128) - 64) as i16;
            file.write_all(&sample.to_le_bytes()).expect("left");
            file.write_all(&sample.to_le_bytes()).expect("right");
        }
        file.flush().expect("flush wav");
    }

    #[test]
    fn remote_stream_cache_entry_uses_sidecar_markers() {
        let root = test_cache_root("entry");
        let entry = build_remote_stream_cache_entry(
            &root,
            "https://cdn.example.com/audio/test-track.flac",
            Some("netease://song/1"),
            Some("netease"),
            Some("audio/flac"),
            None,
        );

        assert_eq!(
            entry
                .cache_path
                .extension()
                .and_then(|value| value.to_str()),
            Some("flac")
        );
        assert!(entry
            .part_marker_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap()
            .ends_with(".flac.part"));
        assert!(entry
            .complete_marker_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap()
            .ends_with(".flac.complete"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remote_stream_complete_cache_requires_marker_and_matching_bytes() {
        let root = test_cache_root("complete");
        let entry = build_remote_stream_cache_entry(
            &root,
            "https://cdn.example.com/audio/test-track.wav",
            Some("netease://song/1"),
            Some("netease"),
            Some("audio/wav"),
            None,
        );
        write_wav_i16_stereo(&entry.cache_path, 44_100, 4_410);
        let bytes = fs::metadata(&entry.cache_path).expect("metadata").len();

        assert!(!remote_stream_complete_cache_is_valid(&entry, None));

        write_remote_stream_complete_marker(&entry, bytes.saturating_add(1), None)
            .expect("write mismatched marker");
        assert!(!remote_stream_complete_cache_is_valid(&entry, None));

        write_remote_stream_complete_marker(&entry, bytes, Some(now_millis() + 10 * 60_000))
            .expect("write valid marker");
        assert!(remote_stream_complete_cache_is_valid(&entry, None));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remote_stream_complete_cache_rejects_expired_lease() {
        let root = test_cache_root("expired");
        let entry = build_remote_stream_cache_entry(
            &root,
            "https://cdn.example.com/audio/test-track.wav",
            Some("netease://song/1"),
            Some("netease"),
            Some("audio/wav"),
            None,
        );
        write_wav_i16_stereo(&entry.cache_path, 44_100, 4_410);
        let bytes = fs::metadata(&entry.cache_path).expect("metadata").len();
        write_remote_stream_complete_marker(&entry, bytes, Some(now_millis().saturating_sub(1)))
            .expect("write expired marker");

        assert!(!remote_stream_complete_cache_is_valid(&entry, None));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remote_stream_download_registry_joins_existing_job() {
        let root = test_cache_root("single-flight");
        let entry = build_remote_stream_cache_entry(
            &root,
            "https://cdn.example.com/audio/test-track.wav",
            Some("netease://song/1"),
            Some("netease"),
            Some("audio/wav"),
            None,
        );
        let existing = Arc::new(RemoteStreamDownloadJob {
            state: Mutex::new(RemoteStreamDownloadState::default()),
            signal: Condvar::new(),
            cancel_requested: AtomicBool::new(false),
            cancel_reason: AtomicU64::new(0),
        });

        {
            let mut in_flight = REMOTE_STREAM_IN_FLIGHT.lock().expect("registry");
            in_flight.insert(remote_stream_in_flight_key(&entry), existing.clone());
        }

        let joined = get_or_spawn_remote_stream_download(
            &entry,
            "https://127.0.0.1/never",
            HeaderMap::new(),
            None,
            None,
        )
        .expect("join existing");
        assert!(Arc::ptr_eq(&existing, &joined));

        {
            let mut in_flight = REMOTE_STREAM_IN_FLIGHT.lock().expect("registry");
            in_flight.remove(&remote_stream_in_flight_key(&entry));
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remote_stream_input_locator_registry_preserves_identity_lookup() {
        let root = test_cache_root("locator");
        let locator = RemoteStreamInputLocator {
            cache_root: root.clone(),
            stream_url: "https://cdn.example.com/audio/test-track.flac".to_string(),
            source_locator: Some("netease://song/locator".to_string()),
            connector_id: Some("netease".to_string()),
            mime_type: Some("audio/flac".to_string()),
            headers: None,
            expires_at_ms: Some(now_millis() + 10 * 60_000),
            seekable: Some(true),
            range_requests: Some(true),
        };

        let identity_path = register_remote_stream_input_locator(locator.clone());
        assert_eq!(identity_path, PathBuf::from("netease://song/locator"));

        let looked_up =
            lookup_remote_stream_input_locator(&identity_path).expect("registered locator");
        assert_eq!(looked_up.stream_url, locator.stream_url);
        assert_eq!(looked_up.range_requests, Some(true));

        let encoded_path = encode_remote_stream_locator_path(&locator);
        let decoded = lookup_remote_stream_input_locator(&encoded_path).expect("encoded locator");
        assert_eq!(
            decoded.source_locator.as_deref(),
            Some("netease://song/locator")
        );

        if let Ok(mut locators) = REMOTE_STREAM_INPUT_LOCATORS.lock() {
            locators.remove(&identity_path);
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remote_growing_cache_media_source_reads_newly_available_bytes() {
        let root = test_cache_root("growing-read");
        let cache_path = root.join("growing.bin");
        let job = Arc::new(RemoteStreamDownloadJob {
            state: Mutex::new(RemoteStreamDownloadState::default()),
            signal: Condvar::new(),
            cancel_requested: AtomicBool::new(false),
            cancel_reason: AtomicU64::new(0),
        });
        let mut source = RemoteGrowingCacheMediaSource::new(RemoteStreamCacheBacking {
            cache_path: cache_path.clone(),
            job: Some(job.clone()),
            seekable: true,
            complete_len: None,
        });

        let writer = thread::spawn(move || {
            thread::sleep(Duration::from_millis(20));
            fs::write(&cache_path, b"remote").expect("write growing bytes");
            if let Ok(mut state) = job.state.lock() {
                state.bytes_written = 6;
                job.signal.notify_all();
            }
        });

        let mut buf = [0u8; 6];
        let read = source.read(&mut buf).expect("read growing cache");
        writer.join().expect("writer");

        assert_eq!(read, 6);
        assert_eq!(&buf, b"remote");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remote_growing_cache_media_source_returns_eof_after_completed_cache() {
        let root = test_cache_root("growing-eof");
        let cache_path = root.join("complete.bin");
        fs::write(&cache_path, b"done").expect("write complete bytes");
        let mut source = RemoteGrowingCacheMediaSource::new(RemoteStreamCacheBacking {
            cache_path,
            job: None,
            seekable: true,
            complete_len: Some(4),
        });

        let mut buf = [0u8; 8];
        assert_eq!(source.read(&mut buf).expect("read complete cache"), 4);
        assert_eq!(source.read(&mut buf).expect("read eof"), 0);
        assert_eq!(source.seek(SeekFrom::Start(1)).expect("seek"), 1);
        assert_eq!(source.read(&mut buf[..2]).expect("read after seek"), 2);
        assert_eq!(&buf[..2], b"on");
        assert_eq!(source.byte_len(), Some(4));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remote_stream_download_cancel_marks_job_and_error() {
        let job = Arc::new(RemoteStreamDownloadJob {
            state: Mutex::new(RemoteStreamDownloadState {
                bytes_written: 42,
                ..RemoteStreamDownloadState::default()
            }),
            signal: Condvar::new(),
            cancel_requested: AtomicBool::new(false),
            cancel_reason: AtomicU64::new(0),
        });

        assert!(request_remote_stream_download_cancel(
            &job,
            REMOTE_STREAM_CANCEL_REASON_TRANSPORT_STOPPED
        ));
        assert!(!request_remote_stream_download_cancel(
            &job,
            REMOTE_STREAM_CANCEL_REASON_TRANSPORT_REPLACED
        ));
        assert!(job.cancel_requested.load(Ordering::Acquire));
        assert_eq!(
            job.cancel_reason.load(Ordering::Acquire),
            REMOTE_STREAM_CANCEL_REASON_TRANSPORT_STOPPED
        );
        let state = job.state.lock().expect("state");
        assert!(state
            .last_error
            .as_deref()
            .unwrap_or_default()
            .contains("transport-stopped"));
    }

    #[test]
    fn remote_stream_cancel_batch_keeps_matching_entry() {
        let root = test_cache_root("cancel-batch");
        let kept_entry = build_remote_stream_cache_entry(
            &root,
            "https://cdn.example.com/audio/keep.wav",
            Some("netease://song/keep"),
            Some("netease"),
            Some("audio/wav"),
            None,
        );
        let cancelled_entry = build_remote_stream_cache_entry(
            &root,
            "https://cdn.example.com/audio/cancel.wav",
            Some("netease://song/cancel"),
            Some("netease"),
            Some("audio/wav"),
            None,
        );
        let kept = Arc::new(RemoteStreamDownloadJob {
            state: Mutex::new(RemoteStreamDownloadState::default()),
            signal: Condvar::new(),
            cancel_requested: AtomicBool::new(false),
            cancel_reason: AtomicU64::new(0),
        });
        let cancelled = Arc::new(RemoteStreamDownloadJob {
            state: Mutex::new(RemoteStreamDownloadState::default()),
            signal: Condvar::new(),
            cancel_requested: AtomicBool::new(false),
            cancel_reason: AtomicU64::new(0),
        });
        let kept_key = remote_stream_in_flight_key(&kept_entry);
        let cancelled_key = remote_stream_in_flight_key(&cancelled_entry);

        {
            let mut in_flight = REMOTE_STREAM_IN_FLIGHT.lock().expect("registry");
            in_flight.insert(kept_key.clone(), kept.clone());
            in_flight.insert(cancelled_key.clone(), cancelled.clone());
        }

        let cancelled_count = cancel_remote_stream_downloads_matching(
            Some(kept_key.as_path()),
            REMOTE_STREAM_CANCEL_REASON_TRANSPORT_REPLACED,
        );
        assert_eq!(cancelled_count, 1);
        assert!(!kept.cancel_requested.load(Ordering::Acquire));
        assert!(cancelled.cancel_requested.load(Ordering::Acquire));

        {
            let mut in_flight = REMOTE_STREAM_IN_FLIGHT.lock().expect("registry");
            in_flight.remove(&kept_key);
            in_flight.remove(&cancelled_key);
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn local_file_source_materializes_to_path() {
        let payload = NativeAudioSourcePayload::LocalFile {
            path: "D:/Music/test.flac".to_string(),
            source_locator: None,
            connector_id: None,
        };
        assert_eq!(
            payload.materialize_transport_path_unchecked_for_test(),
            PathBuf::from("D:/Music/test.flac")
        );
    }

    impl NativeAudioSourcePayload {
        fn materialize_transport_path_unchecked_for_test(&self) -> PathBuf {
            match self {
                NativeAudioSourcePayload::LocalFile { path, .. }
                | NativeAudioSourcePayload::CacheFile { path, .. } => PathBuf::from(path),
                NativeAudioSourcePayload::RemoteStream { .. } => {
                    panic!("remote stream test helper only supports file-backed sources")
                }
            }
        }
    }
}
