use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex},
    thread,
    time::{Duration, Instant},
};

use reqwest::{
    blocking::Client,
    header::{HeaderMap, HeaderName, HeaderValue},
};
use serde::Deserialize;
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
    last_error: Option<String>,
}

struct RemoteStreamDownloadJob {
    state: Mutex<RemoteStreamDownloadState>,
    signal: Condvar,
}

fn normalize_string(value: &str) -> String {
    value.trim().to_string()
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

fn build_remote_stream_cache_path(
    cache_root: &Path,
    stream_url: &str,
    source_locator: Option<&str>,
    connector_id: Option<&str>,
    mime_type: Option<&str>,
    headers: Option<&HashMap<String, String>>,
) -> PathBuf {
    let key = build_remote_stream_cache_key(stream_url, source_locator, connector_id, headers);
    let extension = infer_remote_stream_cache_extension(stream_url, mime_type);
    cache_root.join(format!("{key}.{extension}"))
}

fn build_http_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
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

fn wait_for_remote_stream_probe_ready(
    job: &Arc<RemoteStreamDownloadJob>,
    cache_path: &Path,
) -> Result<(), String> {
    if can_probe_remote_stream_cache(cache_path) {
        return Ok(());
    }

    let started_at = Instant::now();
    let deadline = started_at + Duration::from_millis(REMOTE_STREAM_PROBE_HARD_WAIT_MS);

    loop {
        let now = Instant::now();
        if now >= deadline {
            let bytes_written = fs::metadata(cache_path)
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
        if can_probe_remote_stream_cache(cache_path) {
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
    cache_path: PathBuf,
    stream_url: String,
    headers: HeaderMap,
) -> Arc<RemoteStreamDownloadJob> {
    let job = Arc::new(RemoteStreamDownloadJob {
        state: Mutex::new(RemoteStreamDownloadState::default()),
        signal: Condvar::new(),
    });
    let job_for_thread = job.clone();

    thread::spawn(move || {
        let result = (|| -> Result<u64, String> {
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

            let mut file = fs::File::create(&cache_path)
                .map_err(|error| format!("Failed to create remote stream cache file: {error}"))?;
            let mut bytes_written = 0u64;
            let mut buf = [0u8; 64 * 1024];
            loop {
                let read = response
                    .read(&mut buf)
                    .map_err(|error| format!("Failed to read remote stream bytes: {error}"))?;
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
            Ok(bytes_written)
        })();

        if let Ok(mut state) = job_for_thread.state.lock() {
            match result {
                Ok(bytes_written) => {
                    state.bytes_written = bytes_written;
                    state.completed = true;
                    state.last_error = None;
                }
                Err(error) => {
                    state.completed = true;
                    state.last_error = Some(error);
                }
            }
            job_for_thread.signal.notify_all();
        }
    });

    job
}

fn materialize_remote_stream_to_cache(
    app_handle: &AppHandle,
    stream_url: &str,
    source_locator: Option<&str>,
    connector_id: Option<&str>,
    mime_type: Option<&str>,
    headers: Option<&HashMap<String, String>>,
) -> Result<PathBuf, String> {
    let cache_root = build_remote_stream_cache_root(app_handle)?;
    let cache_path = build_remote_stream_cache_path(
        &cache_root,
        stream_url,
        source_locator,
        connector_id,
        mime_type,
        headers,
    );

    if can_probe_remote_stream_cache(&cache_path) {
        crate::audio::diagnostics::record_event("transport.source.remote.cache_hit", 1, 1);
        return Ok(cache_path);
    }

    let _ = fs::remove_file(&cache_path);
    let request_headers = build_request_headers(headers)?;
    let started_at = Instant::now();
    let job =
        spawn_remote_stream_download(cache_path.clone(), stream_url.to_string(), request_headers);
    let result = wait_for_remote_stream_probe_ready(&job, &cache_path);
    crate::audio::diagnostics::record_event(
        "transport.source.remote.materialize",
        started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
        result.is_ok() as u64,
    );
    result.map(|_| cache_path)
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
                expires_at_ms: _,
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
                )
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
