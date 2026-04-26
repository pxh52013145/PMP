use std::{
    collections::HashMap,
    fs,
    io::{ErrorKind, Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use once_cell::sync::Lazy;
use reqwest::{
    blocking::Client,
    header::{HeaderMap, HeaderName, HeaderValue},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use symphonia::core::{
    formats::FormatOptions,
    io::{MediaSourceStream, MediaSourceStreamOptions},
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

static REMOTE_STREAM_IN_FLIGHT: Lazy<Mutex<HashMap<PathBuf, Arc<RemoteStreamDownloadJob>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
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
}

#[derive(Debug, Clone)]
struct RemoteStreamCacheEntry {
    key: String,
    cache_path: PathBuf,
    part_marker_path: PathBuf,
    complete_marker_path: PathBuf,
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
) -> Arc<RemoteStreamDownloadJob> {
    let job = Arc::new(RemoteStreamDownloadJob {
        state: Mutex::new(RemoteStreamDownloadState::default()),
        signal: Condvar::new(),
    });
    let job_for_thread = job.clone();
    let job_for_registry = job.clone();

    thread::spawn(move || {
        let result = (|| -> Result<u64, String> {
            mark_remote_stream_part_started(&entry)?;
            let client = build_http_client()?;
            let mut request = client.get(&stream_url);
            if !headers.is_empty() {
                request = request.headers(headers);
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

            let mut file = fs::File::create(&entry.cache_path)
                .map_err(|error| format!("Failed to create remote stream cache file: {error}"))?;
            let mut bytes_written = 0u64;
            let mut buf = [0u8; 64 * 1024];
            let read_stall_timeout = remote_stream_read_stall_timeout();
            loop {
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

fn materialize_remote_stream_to_cache(
    app_handle: &AppHandle,
    stream_url: &str,
    source_locator: Option<&str>,
    connector_id: Option<&str>,
    mime_type: Option<&str>,
    headers: Option<&HashMap<String, String>>,
    expires_at_ms: Option<u64>,
) -> Result<PathBuf, String> {
    let cache_root = build_remote_stream_cache_root(app_handle)?;
    let entry = build_remote_stream_cache_entry(
        &cache_root,
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
    let job =
        get_or_spawn_remote_stream_download(&entry, stream_url, request_headers, expires_at_ms)?;
    let result = wait_for_remote_stream_probe_ready(&job, &entry, expires_at_ms);
    crate::audio::diagnostics::record_event(
        "transport.source.remote.materialize",
        started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
        result.is_ok() as u64,
    );
    result.map(|_| entry.cache_path)
}

impl NativeAudioSourcePayload {
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
                range_requests: _,
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
                )
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

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
