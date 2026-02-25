use base64::{
    engine::general_purpose::{STANDARD as BASE64_STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use image::Luma;
use keyring::Entry;
use once_cell::sync::Lazy;
use qrcode::QrCode;
use reqwest::{
    blocking::Client,
    header::{HeaderMap, HeaderValue, CONTENT_TYPE, COOKIE, ORIGIN, REFERER, USER_AGENT},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use symphonia::core::{
    formats::FormatOptions,
    io::{MediaSourceStream, MediaSourceStreamOptions},
    meta::MetadataOptions,
    probe::Hint,
};
use std::{
    collections::hash_map::DefaultHasher,
    collections::{HashMap, HashSet},
    fs,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    hash::{Hash, Hasher},
    sync::{
        Arc, Condvar, Mutex, MutexGuard,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use url::Url;

const BILIBILI_CONNECTOR_ID: &str = "connector.platform.bilibili";
const BILIBILI_CONNECTOR_KIND: &str = "platform";
const BILIBILI_CONNECTOR_DRIVER: &str = "bilibili-web";
const BILIBILI_CONNECTOR_DISPLAY_NAME: &str = "Bilibili";
const BILIBILI_CONNECTOR_STATUS_ACTIVE: &str = "active";

const BILIBILI_QR_GENERATE_ENDPOINT: &str =
    "https://passport.bilibili.com/x/passport-login/web/qrcode/generate";
const BILIBILI_QR_POLL_ENDPOINT: &str =
    "https://passport.bilibili.com/x/passport-login/web/qrcode/poll";
const BILIBILI_NAV_ENDPOINT: &str = "https://api.bilibili.com/x/web-interface/nav";
const BILIBILI_FAVORITE_FOLDERS_ENDPOINT: &str =
    "https://api.bilibili.com/x/v3/fav/folder/created/list-all";
const BILIBILI_FAVORITE_RESOURCES_ENDPOINT: &str = "https://api.bilibili.com/x/v3/fav/resource/list";
const BILIBILI_VIEW_ENDPOINT: &str = "https://api.bilibili.com/x/web-interface/view";
const BILIBILI_PLAYER_V2_ENDPOINT: &str = "https://api.bilibili.com/x/player/v2";
const BILIBILI_PLAYER_PLAYURL_ENDPOINT: &str = "https://api.bilibili.com/x/player/playurl";
const BILIBILI_PLAYER_WBI_PLAYURL_ENDPOINT: &str = "https://api.bilibili.com/x/player/wbi/playurl";
const BILIBILI_FINGER_SPI_ENDPOINT: &str = "https://api.bilibili.com/x/frontend/finger/spi";
const BILIBILI_AUDIO_SONG_INFO_ENDPOINT: &str =
    "https://www.bilibili.com/audio/music-service-c/web/song/info";
const BILIBILI_KEYRING_SERVICE: &str = "pixel-matrix-player.bilibili";
const BILIBILI_KEYRING_TOKEN_REF_PREFIX: &str = "keyring://bilibili-cookie/";
const BILIBILI_LEGACY_COOKIE_TOKEN_REF_PREFIX: &str = "persist://bilibili-cookie/";
const BILIBILI_AUTH_EXPIRED_CODE: i64 = -101;

const AUTH_AVAILABILITY_AVAILABLE: &str = "available";
const AUTH_AVAILABILITY_DEGRADED: &str = "degraded";
const AUTH_AVAILABILITY_UNAVAILABLE: &str = "unavailable";

const QR_SESSION_TTL_MS: i64 = 180_000;
const BILIBILI_PLAYBACK_CACHE_PREBUFFER_BYTES: u64 = 1 * 1024 * 1024;
const BILIBILI_PLAYBACK_CACHE_WAIT_TIMEOUT_MS: u64 = 12_000;
const BILIBILI_PLAYBACK_CACHE_PROBE_SOFT_BYTES: u64 = 2 * 1024 * 1024;
const BILIBILI_PLAYBACK_CACHE_PROBE_SOFT_WAIT_MS: u64 = 4_000;
const BILIBILI_PLAYBACK_CACHE_MAX_BYTES: u64 = 3 * 1024 * 1024 * 1024;
const BILIBILI_PLAYBACK_CACHE_STALE_FILE_TTL_MS: i64 = 12 * 60 * 60 * 1000;
const BILIBILI_PLAYBACK_CACHE_SETTINGS_FILE: &str = "playback-cache-settings.json";
const BILIBILI_WBI_MIXIN_KEY_TTL_MS: i64 = 60 * 60 * 1000;
const BILIBILI_WBI_MIXIN_KEY_INDEX: [usize; 64] = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42,
    19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51,
    30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

const QUALITY_KEY_AUTO: &str = "auto";
const QUALITY_KEY_64K: &str = "64k";
const QUALITY_KEY_132K: &str = "132k";
const QUALITY_KEY_192K: &str = "192k";
const QUALITY_KEY_DOLBY: &str = "dolby";
const QUALITY_KEY_HIRES: &str = "hires";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BilibiliQrCodeSession {
    pub connector_id: String,
    pub session_id: String,
    pub qrcode_key: String,
    pub qr_url: String,
    pub qr_image_data_url: String,
    pub generated_at_ms: i64,
    pub expires_at_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BilibiliQrPollResult {
    pub connector_id: String,
    pub session_id: String,
    pub state: String,
    pub state_code: i64,
    pub state_message: String,
    pub auth_state: String,
    pub account_uid: Option<String>,
    pub expires_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BilibiliAuthStatus {
    pub connector_id: String,
    pub auth_state: String,
    pub account_uid: Option<String>,
    pub updated_at_ms: Option<i64>,
    pub expires_at_ms: Option<i64>,
    pub availability: Option<String>,
    pub availability_message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BilibiliFavoriteFolder {
    pub folder_id: String,
    pub title: String,
    pub media_count: u64,
    pub cover_url: Option<String>,
    pub updated_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BilibiliFavoriteResourceItem {
    pub resource_id: String,
    pub title: String,
    pub owner_name: Option<String>,
    pub duration_seconds: Option<u32>,
    pub cover_url: Option<String>,
    pub source_locator: String,
    pub lyric_locator: Option<String>,
    pub bvid: Option<String>,
    pub cid: Option<String>,
    pub content_kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BilibiliFavoriteResourcePage {
    pub folder_id: String,
    pub page_num: u32,
    pub page_size: u32,
    pub total: u64,
    pub has_more: bool,
    pub items: Vec<BilibiliFavoriteResourceItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BilibiliLyricLocatorRef {
    pub locator: String,
    pub format: String,
    pub lang: Option<String>,
    pub source_kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BilibiliPlaybackPrepared {
    pub source_locator: String,
    pub stream_url: String,
    pub cache_path: String,
    pub mime_type: Option<String>,
    pub duration_seconds: Option<u32>,
    pub content_kind: String,
    pub selected_quality_key: String,
    pub selected_quality_label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BilibiliPlaybackQualityOption {
    pub key: String,
    pub label: String,
    pub available: bool,
}

#[derive(Debug, Clone)]
struct BilibiliPlaybackStreamCandidate {
    quality_key: String,
    quality_label: String,
    stream_url: String,
    score: i64,
}

#[derive(Debug, Clone)]
struct QrSessionState {
    qrcode_key: String,
    expires_at_ms: i64,
}

#[derive(Debug, Clone)]
struct AuthCookieState {
    cookie_header: String,
}

#[derive(Debug, Clone)]
struct WbiSigningState {
    mixin_key: String,
    updated_at_ms: i64,
}

#[derive(Debug, Clone)]
struct AuthContext {
    account: crate::music_library_db::LibraryConnectorAccountRecord,
    cookie_header: String,
}

#[derive(Debug, Clone)]
struct AuthAvailabilityProbe {
    availability: String,
    availability_message: Option<String>,
    account_uid: Option<String>,
    should_mark_expired: bool,
}

#[derive(Debug, Clone)]
struct BilibiliPlaybackCacheDirs {
    object_dir: PathBuf,
    marker_dir: PathBuf,
    cover_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BilibiliPlaybackCacheSettings {
    pub custom_root_path: Option<String>,
    pub effective_root_path: String,
    pub default_root_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BilibiliPlaybackCacheSettingsState {
    #[serde(default)]
    custom_root_path: Option<String>,
}

#[derive(Debug, Clone)]
struct BilibiliPlaybackDownloadState {
    bytes_written: u64,
    completed: bool,
    last_error: Option<String>,
}

#[derive(Debug)]
struct BilibiliPlaybackDownloadJob {
    state: Mutex<BilibiliPlaybackDownloadState>,
    signal: Condvar,
}

#[derive(Debug, Deserialize)]
struct BilibiliApiEnvelope<T> {
    code: i64,
    message: Option<String>,
    data: Option<T>,
}

#[derive(Debug, Deserialize)]
struct BilibiliQrGenerateData {
    url: String,
    qrcode_key: String,
}

#[derive(Debug, Deserialize)]
struct BilibiliQrPollData {
    code: i64,
    message: Option<String>,
    url: Option<String>,
    refresh_token: Option<String>,
}

static QR_SESSIONS: Lazy<Mutex<HashMap<String, QrSessionState>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static AUTH_COOKIE_STATE: Lazy<Mutex<Option<AuthCookieState>>> = Lazy::new(|| Mutex::new(None));
static WBI_SIGNING_STATE: Lazy<Mutex<Option<WbiSigningState>>> = Lazy::new(|| Mutex::new(None));
static PLAYBACK_DOWNLOAD_JOBS: Lazy<Mutex<HashMap<String, Arc<BilibiliPlaybackDownloadJob>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static PLAYBACK_ASSET_SCOPE_DIR: Lazy<Mutex<Option<PathBuf>>> = Lazy::new(|| Mutex::new(None));
static PLAYBACK_CACHE_SETTINGS_STATE: Lazy<Mutex<Option<BilibiliPlaybackCacheSettingsState>>> =
    Lazy::new(|| Mutex::new(None));

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

fn lock_qr_sessions() -> Result<MutexGuard<'static, HashMap<String, QrSessionState>>, String> {
    QR_SESSIONS
        .lock()
        .map_err(|_| "Bilibili QR session store is locked".to_string())
}

fn lock_auth_cookie_state() -> Result<MutexGuard<'static, Option<AuthCookieState>>, String> {
    AUTH_COOKIE_STATE
        .lock()
        .map_err(|_| "Bilibili auth cookie store is locked".to_string())
}

fn lock_wbi_signing_state() -> Result<MutexGuard<'static, Option<WbiSigningState>>, String> {
    WBI_SIGNING_STATE
        .lock()
        .map_err(|_| "Bilibili WBI signing state is locked".to_string())
}

fn cleanup_expired_qr_sessions(now: i64) {
    if let Ok(mut sessions) = lock_qr_sessions() {
        sessions.retain(|_, value| value.expires_at_ms > now);
    }
}

fn lock_playback_download_jobs(
) -> Result<MutexGuard<'static, HashMap<String, Arc<BilibiliPlaybackDownloadJob>>>, String> {
    PLAYBACK_DOWNLOAD_JOBS
        .lock()
        .map_err(|_| "Bilibili playback download jobs store is locked".to_string())
}

fn update_playback_download_job_state(
    job: &Arc<BilibiliPlaybackDownloadJob>,
    bytes_written: u64,
    completed: bool,
    last_error: Option<String>,
) {
    if let Ok(mut state) = job.state.lock() {
        state.bytes_written = bytes_written;
        state.completed = completed;
        state.last_error = last_error;
        job.signal.notify_all();
    }
}

fn lock_playback_cache_settings_state(
) -> Result<MutexGuard<'static, Option<BilibiliPlaybackCacheSettingsState>>, String> {
    PLAYBACK_CACHE_SETTINGS_STATE
        .lock()
        .map_err(|_| "Bilibili playback cache settings state is locked".to_string())
}

fn playback_cache_settings_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Failed to resolve app data directory for Bilibili cache settings".to_string())?;

    let dir = app_data_dir.join("music-platform").join("bilibili");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Failed to create Bilibili settings directory: {error}"))?;
    Ok(dir.join(BILIBILI_PLAYBACK_CACHE_SETTINGS_FILE))
}

fn normalize_optional_path(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_cache_settings_state(
    mut state: BilibiliPlaybackCacheSettingsState,
) -> BilibiliPlaybackCacheSettingsState {
    state.custom_root_path = normalize_optional_path(state.custom_root_path);
    state
}

fn parse_absolute_cache_root(path: &str) -> Result<PathBuf, String> {
    let parsed = PathBuf::from(path);
    if !parsed.is_absolute() {
        return Err("Bilibili playback cache path must be an absolute directory path".to_string());
    }
    Ok(parsed)
}

fn read_playback_cache_settings_from_disk(
    app: &AppHandle,
) -> Result<BilibiliPlaybackCacheSettingsState, String> {
    let path = playback_cache_settings_file_path(app)?;
    let payload = match fs::read(&path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(BilibiliPlaybackCacheSettingsState::default())
        }
        Err(error) => return Err(format!("Failed to read Bilibili playback cache settings: {error}")),
    };

    let parsed = serde_json::from_slice::<BilibiliPlaybackCacheSettingsState>(&payload)
        .map_err(|error| format!("Failed to parse Bilibili playback cache settings: {error}"))?;
    Ok(normalize_cache_settings_state(parsed))
}

fn write_playback_cache_settings_to_disk(
    app: &AppHandle,
    settings: &BilibiliPlaybackCacheSettingsState,
) -> Result<(), String> {
    let path = playback_cache_settings_file_path(app)?;
    let payload = serde_json::to_vec_pretty(settings)
        .map_err(|error| format!("Failed to encode Bilibili playback cache settings: {error}"))?;
    fs::write(&path, payload)
        .map_err(|error| format!("Failed to write Bilibili playback cache settings: {error}"))
}

fn get_playback_cache_settings_state(
    app: &AppHandle,
) -> Result<BilibiliPlaybackCacheSettingsState, String> {
    let mut guard = lock_playback_cache_settings_state()?;
    if let Some(state) = guard.as_ref() {
        return Ok(state.clone());
    }

    let loaded = read_playback_cache_settings_from_disk(app).unwrap_or_default();
    *guard = Some(loaded.clone());
    Ok(loaded)
}

fn persist_playback_cache_settings_state(
    app: &AppHandle,
    settings: BilibiliPlaybackCacheSettingsState,
) -> Result<BilibiliPlaybackCacheSettingsState, String> {
    let normalized = normalize_cache_settings_state(settings);
    if let Some(custom_root_path) = normalized.custom_root_path.as_deref() {
        let custom_root = parse_absolute_cache_root(custom_root_path)?;
        fs::create_dir_all(&custom_root).map_err(|error| {
            format!("Failed to create custom Bilibili playback cache directory: {error}")
        })?;
    }

    {
        let mut guard = lock_playback_cache_settings_state()?;
        *guard = Some(normalized.clone());
    }
    write_playback_cache_settings_to_disk(app, &normalized)?;
    Ok(normalized)
}

fn resolve_default_playback_cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    let resolver = app.path_resolver();
    let root = resolver
        .app_cache_dir()
        .or_else(|| resolver.app_data_dir())
        .ok_or_else(|| "Failed to resolve app cache directory for Bilibili playback cache".to_string())?;
    Ok(root.join("music-platform").join("bilibili").join("playback-cache"))
}

fn resolve_effective_playback_cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    let settings = get_playback_cache_settings_state(app)?;
    if let Some(custom_root_path) = settings.custom_root_path.as_deref() {
        match parse_absolute_cache_root(custom_root_path) {
            Ok(path) => return Ok(path),
            Err(error) => {
                eprintln!(
                    "[music_platform_bilibili] invalid custom cache root '{}': {error}",
                    custom_root_path
                );
            }
        }
    }

    resolve_default_playback_cache_root(app)
}

fn resolve_session_cover_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let root_dir = resolve_effective_playback_cache_root(app)?;
    Ok(root_dir.join("session-covers"))
}

fn cleanup_session_cover_cache_internal(app: &AppHandle) -> Result<(), String> {
    let session_cover_dir = resolve_session_cover_cache_dir(app)?;
    match fs::remove_dir_all(&session_cover_dir) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Failed to remove Bilibili session cover cache directory: {error}"
            ))
        }
    }

    if let Ok(mut guard) = PLAYBACK_ASSET_SCOPE_DIR.lock() {
        if guard
            .as_ref()
            .map(|value| value == &session_cover_dir)
            .unwrap_or(false)
        {
            *guard = None;
        }
    }

    Ok(())
}

fn allow_playback_cover_dir_in_asset_scope(app: &AppHandle, cover_dir: &Path) {
    if let Ok(mut guard) = PLAYBACK_ASSET_SCOPE_DIR.lock() {
        let already_allowed = guard
            .as_ref()
            .map(|value| value == cover_dir)
            .unwrap_or(false);
        if already_allowed {
            return;
        }

        if app
            .asset_protocol_scope()
            .allow_directory(cover_dir, true)
            .is_ok()
        {
            *guard = Some(cover_dir.to_path_buf());
        }
    }
}

fn ensure_playback_cache_dirs_for_root(
    app: &AppHandle,
    root_dir: PathBuf,
) -> Result<BilibiliPlaybackCacheDirs, String> {
    let object_dir = root_dir.join("objects");
    let marker_dir = root_dir.join("markers");
    let cover_dir = root_dir.join("session-covers");

    fs::create_dir_all(&object_dir)
        .map_err(|error| format!("Failed to create Bilibili playback cache object directory: {error}"))?;
    fs::create_dir_all(&marker_dir)
        .map_err(|error| format!("Failed to create Bilibili playback cache marker directory: {error}"))?;
    fs::create_dir_all(&cover_dir)
        .map_err(|error| format!("Failed to create Bilibili playback cache cover directory: {error}"))?;

    allow_playback_cover_dir_in_asset_scope(app, &cover_dir);

    Ok(BilibiliPlaybackCacheDirs {
        object_dir,
        marker_dir,
        cover_dir,
    })
}

fn ensure_playback_cache_dirs(app: &AppHandle) -> Result<BilibiliPlaybackCacheDirs, String> {
    let root_dir = resolve_effective_playback_cache_root(app)?;
    ensure_playback_cache_dirs_for_root(app, root_dir)
}

fn build_playback_cache_key(bvid: &str, cid: &str, quality_key: &str) -> String {
    format!(
        "video-{}-{}-{}",
        sanitize_cache_file_segment(bvid),
        sanitize_cache_file_segment(cid),
        sanitize_cache_file_segment(quality_key)
    )
}

fn build_playback_cache_object_path(
    dirs: &BilibiliPlaybackCacheDirs,
    cache_key: &str,
    extension: &str,
) -> PathBuf {
    dirs.object_dir.join(format!("{cache_key}.{extension}"))
}

fn build_playback_cache_marker_path(dirs: &BilibiliPlaybackCacheDirs, cache_key: &str) -> PathBuf {
    dirs.marker_dir.join(format!("{cache_key}.complete"))
}

fn is_playback_cache_file_ready(cache_path: &Path, marker_path: &Path) -> bool {
    if !cache_path.exists() || !marker_path.exists() {
        return false;
    }
    fs::metadata(cache_path)
        .ok()
        .map(|meta| meta.len() > 0)
        .unwrap_or(false)
}

fn mark_playback_cache_file_complete(marker_path: &Path, bytes_written: u64) {
    let payload = format!("bytes_written={bytes_written}\nupdated_at_ms={}\n", now_ms());
    let _ = fs::write(marker_path, payload);
}

fn remove_file_if_exists(path: &Path) {
    match fs::remove_file(path) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => {}
    }
}

fn cleanup_stale_incomplete_playback_cache(
    dirs: &BilibiliPlaybackCacheDirs,
    now: i64,
) -> Result<(), String> {
    let entries = fs::read_dir(&dirs.object_dir).map_err(|error| {
        format!("Failed to read Bilibili playback cache object directory: {error}")
    })?;

    for entry in entries {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        let marker_path = build_playback_cache_marker_path(dirs, stem);
        if marker_path.exists() {
            continue;
        }

        let modified_at_ms = fs::metadata(&path)
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_millis() as i64)
            .unwrap_or(now);
        if now.saturating_sub(modified_at_ms) < BILIBILI_PLAYBACK_CACHE_STALE_FILE_TTL_MS {
            continue;
        }

        remove_file_if_exists(&path);
    }

    Ok(())
}

fn prune_completed_playback_cache(
    dirs: &BilibiliPlaybackCacheDirs,
    max_bytes: u64,
) -> Result<(), String> {
    let mut entries = Vec::<(PathBuf, PathBuf, u64, i64)>::new();
    let read_dir = fs::read_dir(&dirs.object_dir)
        .map_err(|error| format!("Failed to read Bilibili playback cache objects for prune: {error}"))?;

    for entry in read_dir {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        let marker_path = build_playback_cache_marker_path(dirs, stem);
        if !marker_path.exists() {
            continue;
        }
        let metadata = match fs::metadata(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let size = metadata.len();
        let modified_at_ms = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_millis() as i64)
            .unwrap_or(0);
        entries.push((path, marker_path, size, modified_at_ms));
    }

    let mut total_size: u64 = entries.iter().map(|(_, _, size, _)| *size).sum();
    if total_size <= max_bytes {
        return Ok(());
    }

    entries.sort_by_key(|(_, _, _, modified_at_ms)| *modified_at_ms);
    for (path, marker_path, size, _) in entries {
        if total_size <= max_bytes {
            break;
        }
        remove_file_if_exists(&path);
        remove_file_if_exists(&marker_path);
        total_size = total_size.saturating_sub(size);
    }

    Ok(())
}

fn spawn_or_get_playback_download_job(
    cache_key: &str,
    cache_path: PathBuf,
    marker_path: PathBuf,
    stream_url: String,
    cookie_header: String,
    referer: String,
) -> Result<Arc<BilibiliPlaybackDownloadJob>, String> {
    {
        let mut jobs = lock_playback_download_jobs()?;
        if let Some(existing) = jobs.get(cache_key) {
            return Ok(existing.clone());
        }

        let job = Arc::new(BilibiliPlaybackDownloadJob {
            state: Mutex::new(BilibiliPlaybackDownloadState {
                bytes_written: fs::metadata(&cache_path).ok().map(|meta| meta.len()).unwrap_or(0),
                completed: false,
                last_error: None,
            }),
            signal: Condvar::new(),
        });

        jobs.insert(cache_key.to_string(), job.clone());
    }

    let cache_key_owned = cache_key.to_string();
    let job = {
        let jobs = lock_playback_download_jobs()?;
        jobs.get(&cache_key_owned)
            .cloned()
            .ok_or_else(|| "Failed to access playback download job".to_string())?
    };

    let thread_job = job.clone();
    let thread_name = format!(
        "pmp-bili-cache-{}",
        sanitize_cache_file_segment(&cache_key_owned)
            .chars()
            .take(24)
            .collect::<String>()
    );

    std::thread::Builder::new()
        .name(thread_name)
        .spawn(move || {
            remove_file_if_exists(&marker_path);
            remove_file_if_exists(&cache_path);

            let result = (|| -> Result<u64, String> {
                let client = build_http_client()?;
                let cookie_value = HeaderValue::from_str(&cookie_header)
                    .map_err(|error| format!("Invalid Bilibili cookie for stream download: {error}"))?;
                let referer_value = HeaderValue::from_str(&referer)
                    .map_err(|error| format!("Invalid Bilibili referer for stream download: {error}"))?;

                let mut response = client
                    .get(&stream_url)
                    .header(COOKIE, cookie_value)
                    .header(REFERER, referer_value)
                    .send()
                    .map_err(|error| format!("Failed to download Bilibili playback stream: {error}"))?;

                let status = response.status();
                if !status.is_success() {
                    return Err(format!(
                        "Bilibili playback stream returned non-success status: {status}"
                    ));
                }

                let mut file = fs::File::create(&cache_path)
                    .map_err(|error| format!("Failed to create Bilibili playback cache file: {error}"))?;

                let mut bytes_written: u64 = 0;
                let mut buf = [0u8; 64 * 1024];
                loop {
                    let read = response
                        .read(&mut buf)
                        .map_err(|error| format!("Failed to read Bilibili playback stream bytes: {error}"))?;
                    if read == 0 {
                        break;
                    }

                    file.write_all(&buf[..read]).map_err(|error| {
                        format!("Failed to write Bilibili playback cache file: {error}")
                    })?;
                    bytes_written = bytes_written.saturating_add(read as u64);
                    if bytes_written % (512 * 1024) < read as u64 {
                        let _ = file.flush();
                    }
                    update_playback_download_job_state(&thread_job, bytes_written, false, None);
                }

                file.flush()
                    .map_err(|error| format!("Failed to flush Bilibili playback cache file: {error}"))?;
                Ok(bytes_written)
            })();

            match result {
                Ok(bytes_written) => {
                    mark_playback_cache_file_complete(&marker_path, bytes_written);
                    update_playback_download_job_state(&thread_job, bytes_written, true, None);
                }
                Err(error) => {
                    update_playback_download_job_state(&thread_job, 0, false, Some(error));
                }
            }

            if let Ok(mut jobs) = lock_playback_download_jobs() {
                jobs.remove(&cache_key_owned);
            }
            thread_job.signal.notify_all();
        })
        .map_err(|error| format!("Failed to spawn Bilibili playback download worker: {error}"))?;

    Ok(job)
}

fn wait_for_playback_prebuffer(
    job: &Arc<BilibiliPlaybackDownloadJob>,
    min_bytes: u64,
    timeout: Duration,
) -> Result<BilibiliPlaybackDownloadState, String> {
    let deadline = Instant::now() + timeout;
    let mut guard = job
        .state
        .lock()
        .map_err(|_| "Bilibili playback download state is locked".to_string())?;

    loop {
        if let Some(error) = guard.last_error.clone() {
            return Err(error);
        }
        if guard.completed || guard.bytes_written >= min_bytes {
            return Ok(guard.clone());
        }

        let now = Instant::now();
        if now >= deadline {
            return Ok(guard.clone());
        }

        let wait_for = deadline.saturating_duration_since(now);
        let (next, _) = job
            .signal
            .wait_timeout(guard, wait_for)
            .map_err(|_| "Bilibili playback download wait failed".to_string())?;
        guard = next;
    }
}

fn can_probe_playback_cache(path: &Path) -> bool {
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

    probed
        .format
        .tracks()
        .iter()
        .any(|track| track.codec_params.sample_rate.is_some() || track.codec_params.channels.is_some())
}

fn build_http_client() -> Result<Client, String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        ),
    );
    headers.insert(
        REFERER,
        HeaderValue::from_static("https://www.bilibili.com/"),
    );

    Client::builder()
        .default_headers(headers)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("Failed to build Bilibili HTTP client: {error}"))
}

fn to_non_empty_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn to_i64(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(number)) => {
            number
                .as_i64()
                .or_else(|| number.as_u64().and_then(|v| i64::try_from(v).ok()))
        }
        Some(Value::String(raw)) => raw.trim().parse::<i64>().ok(),
        _ => None,
    }
}

fn to_u64(value: Option<&Value>) -> Option<u64> {
    match value {
        Some(Value::Number(number)) => number.as_u64().or_else(|| number.as_i64().and_then(|v| {
            if v >= 0 {
                Some(v as u64)
            } else {
                None
            }
        })),
        Some(Value::String(raw)) => raw.trim().parse::<u64>().ok(),
        _ => None,
    }
}

fn normalize_url(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.starts_with("//") {
        return format!("https:{trimmed}");
    }
    if let Some(rest) = trimmed.strip_prefix("http://") {
        return format!("https://{rest}");
    }
    trimmed.to_string()
}

fn ensure_connector(app: &AppHandle) -> Result<(), String> {
    crate::music_library_db::ensure_connector(
        app,
        BILIBILI_CONNECTOR_ID,
        BILIBILI_CONNECTOR_KIND,
        BILIBILI_CONNECTOR_DRIVER,
        Some(BILIBILI_CONNECTOR_DISPLAY_NAME),
        Some(BILIBILI_CONNECTOR_STATUS_ACTIVE),
    )
}

fn map_poll_state(state_code: i64, state_message: &str) -> (String, String, bool) {
    match state_code {
        86101 => ("pending_scan".to_string(), "pending".to_string(), false),
        86090 => ("pending_confirm".to_string(), "pending".to_string(), false),
        86038 => ("expired".to_string(), "expired".to_string(), true),
        0 => ("authorized".to_string(), "authorized".to_string(), true),
        _ => {
            let auth_state = if state_message.contains("过期") {
                "expired"
            } else {
                "error"
            };
            ("failed".to_string(), auth_state.to_string(), true)
        }
    }
}

fn extract_query_param(url: &str, key: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    for (name, value) in parsed.query_pairs() {
        if name == key {
            let normalized = value.trim();
            if !normalized.is_empty() {
                return Some(normalized.to_string());
            }
        }
    }
    None
}

fn extract_query_param_case_insensitive(url: &str, key: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    for (name, value) in parsed.query_pairs() {
        if name.eq_ignore_ascii_case(key) {
            let normalized = value.trim();
            if !normalized.is_empty() {
                return Some(normalized.to_string());
            }
        }
    }
    None
}

fn parse_sid_from_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(sid) = extract_query_param_case_insensitive(trimmed, "sid") {
        return Some(sid);
    }
    if let Some(auid) = extract_query_param_case_insensitive(trimmed, "auid") {
        return Some(auid);
    }

    let lower = trimmed.to_ascii_lowercase();
    if let Some(index) = lower.find("/audio/au") {
        let prefix_len = "/audio/au".len();
        let mut digits = String::new();
        for ch in lower[index + prefix_len..].chars() {
            if ch.is_ascii_digit() {
                digits.push(ch);
            } else {
                break;
            }
        }
        if !digits.is_empty() {
            return Some(digits);
        }
    }

    if let Some(index) = lower.find("au") {
        let mut digits = String::new();
        for ch in lower[index + 2..].chars() {
            if ch.is_ascii_digit() {
                digits.push(ch);
            } else {
                break;
            }
        }
        if !digits.is_empty() {
            return Some(digits);
        }
    }

    None
}

fn normalize_bvid_token(value: &str) -> Option<String> {
    let normalized = value.trim();
    if normalized.len() != 12 {
        return None;
    }

    let mut chars = normalized.chars();
    let first = chars.next()?;
    let second = chars.next()?;
    if first.to_ascii_uppercase() != 'B' || second.to_ascii_uppercase() != 'V' {
        return None;
    }

    let suffix: String = chars.collect();
    if suffix.len() != 10 || !suffix.chars().all(|ch| ch.is_ascii_alphanumeric()) {
        return None;
    }

    Some(format!("BV{suffix}"))
}

fn parse_bvid_from_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(parsed) = Url::parse(trimmed) {
        for (name, raw_value) in parsed.query_pairs() {
            if name.eq_ignore_ascii_case("bvid") {
                if let Some(normalized) = normalize_bvid_token(raw_value.as_ref()) {
                    return Some(normalized);
                }
            }
        }

        for segment in parsed
            .path_segments()
            .into_iter()
            .flat_map(|segments| segments)
        {
            if let Some(normalized) = normalize_bvid_token(segment) {
                return Some(normalized);
            }
        }
    }

    for token in trimmed.split(|ch: char| !ch.is_ascii_alphanumeric()) {
        if let Some(normalized) = normalize_bvid_token(token) {
            return Some(normalized);
        }
    }

    None
}

fn parse_cid_from_text(value: &str) -> Option<String> {
    extract_query_param_case_insensitive(value, "cid")
}

fn build_cookie_header_from_auth_callback_url(url: &str) -> Option<String> {
    let sessdata = extract_query_param(url, "SESSDATA")?;
    let mut cookies = vec![format!("SESSDATA={sessdata}")];

    if let Some(user_id) = extract_query_param(url, "DedeUserID") {
        cookies.push(format!("DedeUserID={user_id}"));
    }
    if let Some(user_id_ckmd5) = extract_query_param(url, "DedeUserID__ckMd5") {
        cookies.push(format!("DedeUserID__ckMd5={user_id_ckmd5}"));
    }
    if let Some(csrf_token) = extract_query_param(url, "bili_jct") {
        cookies.push(format!("bili_jct={csrf_token}"));
    }

    Some(cookies.join("; "))
}

fn encode_keyring_account_name(account_id: &str) -> Option<String> {
    let normalized = account_id.trim();
    if normalized.is_empty() {
        return None;
    }
    Some(URL_SAFE_NO_PAD.encode(normalized.as_bytes()))
}

fn build_keyring_token_ref(account_name: &str) -> String {
    format!("{BILIBILI_KEYRING_TOKEN_REF_PREFIX}{account_name}")
}

fn parse_keyring_account_name_from_token_ref(token_ref: &str) -> Option<String> {
    let normalized = token_ref.trim();
    if !normalized.starts_with(BILIBILI_KEYRING_TOKEN_REF_PREFIX) {
        return None;
    }
    let account_name = &normalized[BILIBILI_KEYRING_TOKEN_REF_PREFIX.len()..];
    let account_name = account_name.trim();
    if account_name.is_empty() {
        return None;
    }
    Some(account_name.to_string())
}

fn write_cookie_header_to_keyring(account_id: &str, cookie_header: &str) -> Result<String, String> {
    let normalized_cookie = cookie_header.trim();
    if normalized_cookie.is_empty() {
        return Err("Bilibili cookie header is empty".to_string());
    }
    let account_name = encode_keyring_account_name(account_id)
        .ok_or_else(|| "Bilibili keyring account id is empty".to_string())?;

    let entry = Entry::new(BILIBILI_KEYRING_SERVICE, &account_name)
        .map_err(|error| format!("Failed to create Bilibili keyring entry: {error}"))?;
    entry
        .set_password(normalized_cookie)
        .map_err(|error| format!("Failed to store Bilibili credential in keyring: {error}"))?;

    Ok(build_keyring_token_ref(&account_name))
}

fn read_cookie_header_from_keyring_token_ref(token_ref: &str) -> Option<String> {
    let account_name = parse_keyring_account_name_from_token_ref(token_ref)?;
    let entry = Entry::new(BILIBILI_KEYRING_SERVICE, &account_name).ok()?;
    let cookie = entry.get_password().ok()?;
    let cookie = cookie.trim();
    if cookie.is_empty() {
        return None;
    }
    Some(cookie.to_string())
}

fn delete_cookie_header_from_keyring_token_ref(token_ref: &str) {
    let Some(account_name) = parse_keyring_account_name_from_token_ref(token_ref) else {
        return;
    };

    if let Ok(entry) = Entry::new(BILIBILI_KEYRING_SERVICE, &account_name) {
        let _ = entry.delete_password();
    }
}

fn encode_cookie_header_token_ref_legacy(cookie_header: &str) -> Option<String> {
    let normalized = cookie_header.trim();
    if normalized.is_empty() {
        return None;
    }
    let encoded = URL_SAFE_NO_PAD.encode(normalized.as_bytes());
    Some(format!("{BILIBILI_LEGACY_COOKIE_TOKEN_REF_PREFIX}{encoded}"))
}

fn decode_cookie_header_token_ref_legacy(token_ref: &str) -> Option<String> {
    let normalized = token_ref.trim();
    if !normalized.starts_with(BILIBILI_LEGACY_COOKIE_TOKEN_REF_PREFIX) {
        return None;
    }

    let encoded = &normalized[BILIBILI_LEGACY_COOKIE_TOKEN_REF_PREFIX.len()..];
    if encoded.trim().is_empty() {
        return None;
    }

    let bytes = URL_SAFE_NO_PAD.decode(encoded).ok()?;
    let cookie = String::from_utf8(bytes).ok()?;
    let normalized_cookie = cookie.trim();
    if normalized_cookie.is_empty() {
        return None;
    }
    Some(normalized_cookie.to_string())
}

fn read_cookie_header_from_token_ref(token_ref: &str) -> Option<String> {
    read_cookie_header_from_keyring_token_ref(token_ref)
        .or_else(|| decode_cookie_header_token_ref_legacy(token_ref))
}

fn delete_cookie_header_by_token_ref(token_ref: &str) {
    delete_cookie_header_from_keyring_token_ref(token_ref);
}

fn set_auth_cookie_state(cookie_header: String) {
    if let Ok(mut state) = lock_auth_cookie_state() {
        *state = Some(AuthCookieState { cookie_header });
    }
}

fn clear_auth_cookie_state() {
    if let Ok(mut state) = lock_auth_cookie_state() {
        *state = None;
    }
}

fn get_auth_cookie_header() -> Option<String> {
    lock_auth_cookie_state()
        .ok()
        .and_then(|state| state.as_ref().map(|cookie| cookie.cookie_header.clone()))
}

fn ensure_auth_context(app: &AppHandle) -> Result<AuthContext, String> {
    let account = crate::music_library_db::get_latest_connector_account_by_connector_id(
        app,
        BILIBILI_CONNECTOR_ID,
    )?
    .ok_or_else(|| "Bilibili connector is not authorized".to_string())?;

    if !account.auth_state.eq_ignore_ascii_case("authorized") {
        return Err("Bilibili connector is not authorized".to_string());
    }

    let cookie_header = get_auth_cookie_header()
        .or_else(|| {
            account
                .token_ref
                .as_deref()
                .and_then(read_cookie_header_from_token_ref)
        })
        .ok_or_else(|| {
            "Bilibili login token is unavailable in current session, please scan QR again".to_string()
        })?;

    set_auth_cookie_state(cookie_header.clone());

    Ok(AuthContext {
        account,
        cookie_header,
    })
}

fn request_bilibili_data(
    client: &Client,
    endpoint: &str,
    query: &[(&str, String)],
    cookie_header: &str,
    context: &str,
) -> Result<Value, String> {
    request_bilibili_data_with_optional_cookie(
        client,
        endpoint,
        query,
        Some(cookie_header),
        context,
    )
}

fn request_bilibili_data_with_optional_cookie(
    client: &Client,
    endpoint: &str,
    query: &[(&str, String)],
    cookie_header: Option<&str>,
    context: &str,
) -> Result<Value, String> {
    request_bilibili_data_with_optional_cookie_and_headers(
        client,
        endpoint,
        query,
        cookie_header,
        context,
        None,
        None,
    )
}

fn request_bilibili_data_with_optional_cookie_and_headers(
    client: &Client,
    endpoint: &str,
    query: &[(&str, String)],
    cookie_header: Option<&str>,
    context: &str,
    referer: Option<&str>,
    origin: Option<&str>,
) -> Result<Value, String> {
    let mut request = client.get(endpoint).query(query);
    if let Some(cookie_header) = cookie_header {
        let cookie_value = HeaderValue::from_str(cookie_header)
            .map_err(|error| format!("Invalid Bilibili cookie for {context}: {error}"))?;
        request = request.header(COOKIE, cookie_value);
    }
    if let Some(referer) = referer {
        let referer_value = HeaderValue::from_str(referer)
            .map_err(|error| format!("Invalid Bilibili referer for {context}: {error}"))?;
        request = request.header(REFERER, referer_value);
    }
    if let Some(origin) = origin {
        let origin_value = HeaderValue::from_str(origin)
            .map_err(|error| format!("Invalid Bilibili origin for {context}: {error}"))?;
        request = request.header(ORIGIN, origin_value);
    }

    let response = request
        .send()
        .map_err(|error| format!("Bilibili {context} request failed: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Bilibili {context} returned non-success status: {status}"));
    }

    let payload: BilibiliApiEnvelope<Value> = response
        .json()
        .map_err(|error| format!("Failed to decode Bilibili {context} response: {error}"))?;

    if payload.code != 0 {
        return Err(format!(
            "Bilibili {context} failed (code={}): {}",
            payload.code,
            payload.message.unwrap_or_else(|| "unknown failure".to_string())
        ));
    }

    Ok(payload.data.unwrap_or(Value::Null))
}

fn extract_wbi_key_from_url(value: &str) -> Option<String> {
    let parsed = Url::parse(value).ok()?;
    let file_name = parsed
        .path_segments()
        .into_iter()
        .flat_map(|segments| segments)
        .last()?
        .trim();
    if file_name.is_empty() {
        return None;
    }

    let stem = file_name.split('.').next()?.trim();
    if stem.is_empty() {
        return None;
    }
    Some(stem.to_string())
}

fn build_wbi_mixin_key(img_key: &str, sub_key: &str) -> Option<String> {
    let source = format!("{}{}", img_key.trim(), sub_key.trim());
    let source_chars: Vec<char> = source.chars().collect();
    if source_chars.is_empty() {
        return None;
    }

    let mut mixed = String::new();
    for index in BILIBILI_WBI_MIXIN_KEY_INDEX {
        let Some(ch) = source_chars.get(index) else {
            continue;
        };
        mixed.push(*ch);
        if mixed.chars().count() >= 32 {
            break;
        }
    }

    if mixed.is_empty() {
        return None;
    }

    if mixed.chars().count() < 32 {
        let fallback: String = source_chars.into_iter().take(32).collect();
        if !fallback.is_empty() {
            return Some(fallback);
        }
    }

    if mixed.chars().count() > 32 {
        return Some(mixed.chars().take(32).collect());
    }

    Some(mixed)
}

fn sanitize_wbi_query_value(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !matches!(ch, '!' | '\'' | '(' | ')' | '*'))
        .collect()
}

fn resolve_wbi_mixin_key(client: &Client, cookie_header: &str) -> Result<String, String> {
    let now = now_ms();
    if let Ok(state) = lock_wbi_signing_state() {
        if let Some(cached) = state.as_ref() {
            if now.saturating_sub(cached.updated_at_ms) <= BILIBILI_WBI_MIXIN_KEY_TTL_MS
                && !cached.mixin_key.trim().is_empty()
            {
                return Ok(cached.mixin_key.clone());
            }
        }
    }

    let nav_data = request_bilibili_data(
        client,
        BILIBILI_NAV_ENDPOINT,
        &[],
        cookie_header,
        "nav (wbi key)",
    )?;

    let wbi_img = nav_data
        .get("wbi_img")
        .ok_or_else(|| "Bilibili nav response missing wbi_img".to_string())?;
    let img_url = wbi_img
        .get("img_url")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Bilibili nav response missing wbi_img.img_url".to_string())?;
    let sub_url = wbi_img
        .get("sub_url")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Bilibili nav response missing wbi_img.sub_url".to_string())?;

    let img_key = extract_wbi_key_from_url(img_url)
        .ok_or_else(|| "Failed to parse wbi img key from nav response".to_string())?;
    let sub_key = extract_wbi_key_from_url(sub_url)
        .ok_or_else(|| "Failed to parse wbi sub key from nav response".to_string())?;

    let mixin_key = build_wbi_mixin_key(&img_key, &sub_key)
        .ok_or_else(|| "Failed to build wbi mixin key".to_string())?;

    if let Ok(mut state) = lock_wbi_signing_state() {
        *state = Some(WbiSigningState {
            mixin_key: mixin_key.clone(),
            updated_at_ms: now,
        });
    }

    Ok(mixin_key)
}

fn parse_cookie_pairs(cookie_header: &str) -> HashMap<String, String> {
    let mut pairs = HashMap::new();
    for segment in cookie_header.split(';') {
        let normalized = segment.trim();
        if normalized.is_empty() {
            continue;
        }
        let mut parts = normalized.splitn(2, '=');
        let Some(name) = parts.next() else {
            continue;
        };
        let Some(value) = parts.next() else {
            continue;
        };
        let key = name.trim().to_string();
        let val = value.trim().to_string();
        if key.is_empty() || val.is_empty() {
            continue;
        }
        pairs.insert(key, val);
    }
    pairs
}

fn build_cookie_header_from_pairs(pairs: &HashMap<String, String>) -> String {
    let mut keys: Vec<&String> = pairs.keys().collect();
    keys.sort();
    keys.into_iter()
        .filter_map(|key| pairs.get(key).map(|value| format!("{key}={value}")))
        .collect::<Vec<String>>()
        .join("; ")
}

fn normalize_cookie_header_for_playurl(client: &Client, cookie_header: &str) -> String {
    let mut pairs = parse_cookie_pairs(cookie_header);
    if pairs.is_empty() {
        return cookie_header.trim().to_string();
    }

    pairs
        .entry("CURRENT_FNVAL".to_string())
        .or_insert_with(|| "4048".to_string());
    pairs
        .entry("CURRENT_QUALITY".to_string())
        .or_insert_with(|| "80".to_string());

    if !pairs.contains_key("buvid3") || !pairs.contains_key("buvid4") {
        if let Ok(spi_data) = request_bilibili_data_with_optional_cookie(
            client,
            BILIBILI_FINGER_SPI_ENDPOINT,
            &[],
            Some(cookie_header),
            "finger spi",
        ) {
            if !pairs.contains_key("buvid3") {
                if let Some(value) = spi_data
                    .get("b_3")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    pairs.insert("buvid3".to_string(), value.to_string());
                }
            }
            if !pairs.contains_key("buvid4") {
                if let Some(value) = spi_data
                    .get("b_4")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    pairs.insert("buvid4".to_string(), value.to_string());
                }
            }
        }
    }

    let normalized = build_cookie_header_from_pairs(&pairs);
    if normalized.trim().is_empty() {
        cookie_header.trim().to_string()
    } else {
        normalized
    }
}

fn extract_json_object_after_marker(html: &str, marker: &str) -> Option<String> {
    let start = html.find(marker)? + marker.len();
    let bytes = &html[start..];

    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    let mut started = false;
    let mut collected = String::new();

    for ch in bytes.chars() {
        if !started {
            if ch == '{' {
                started = true;
                depth = 1;
                collected.push(ch);
            }
            continue;
        }

        collected.push(ch);

        if in_string {
            if escaped {
                escaped = false;
                continue;
            }
            if ch == '\\' {
                escaped = true;
                continue;
            }
            if ch == '"' {
                in_string = false;
            }
            continue;
        }

        if ch == '"' {
            in_string = true;
            continue;
        }

        if ch == '{' {
            depth += 1;
            continue;
        }

        if ch == '}' {
            depth -= 1;
            if depth == 0 {
                return Some(collected);
            }
        }
    }

    None
}

fn request_video_playinfo_from_page(
    client: &Client,
    cookie_header: Option<&str>,
    bvid: &str,
    cid: &str,
) -> Result<Option<Value>, String> {
    let referer = format!("https://www.bilibili.com/video/{bvid}");
    let page_url = format!("https://www.bilibili.com/video/{bvid}?cid={cid}&p=1");
    let mut request = client
        .get(&page_url)
        .header(REFERER, HeaderValue::from_str(&referer).map_err(|error| {
            format!("Invalid Bilibili referer for playinfo page fetch: {error}")
        })?)
        .header(ORIGIN, HeaderValue::from_static("https://www.bilibili.com"));

    if let Some(cookie_header) = cookie_header {
        let cookie_value = HeaderValue::from_str(cookie_header)
            .map_err(|error| format!("Invalid Bilibili cookie for playinfo page fetch: {error}"))?;
        request = request.header(COOKIE, cookie_value);
    }

    let response = request
        .send()
        .map_err(|error| format!("Bilibili playinfo page request failed: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Bilibili playinfo page returned non-success status: {status}"));
    }

    let html = response
        .text()
        .map_err(|error| format!("Failed to read Bilibili playinfo page html: {error}"))?;
    let Some(raw_json) = extract_json_object_after_marker(&html, "window.__playinfo__=") else {
        return Ok(None);
    };

    let parsed: Value = serde_json::from_str(raw_json.trim())
        .map_err(|error| format!("Failed to parse Bilibili playinfo json: {error}"))?;

    if let Some(data) = parsed.get("data") {
        return Ok(Some(data.clone()));
    }

    if parsed.get("dash").is_some() || parsed.get("durl").is_some() {
        return Ok(Some(parsed));
    }

    Ok(None)
}

fn build_wbi_signed_playurl_query(
    client: &Client,
    cookie_header: &str,
    bvid: &str,
    cid: &str,
    qn: &str,
    fnval: &str,
    platform: Option<&str>,
) -> Result<Vec<(&'static str, String)>, String> {
    let mixin_key = resolve_wbi_mixin_key(client, cookie_header)?;
    let bvid_value = sanitize_wbi_query_value(bvid.trim());
    let cid_value = sanitize_wbi_query_value(cid.trim());
    let qn_value = sanitize_wbi_query_value(qn.trim());
    let fnval_value = sanitize_wbi_query_value(fnval.trim());
    let platform_value = platform
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(sanitize_wbi_query_value);
    let wts_value = (now_ms() / 1000).to_string();

    let mut signature_pairs: Vec<(&str, String)> = vec![
        ("bvid", bvid_value.clone()),
        ("cid", cid_value.clone()),
        ("qn", qn_value.clone()),
        ("fnver", "0".to_string()),
        ("fnval", fnval_value.clone()),
        ("fourk", "1".to_string()),
        ("wts", wts_value.clone()),
    ];
    if let Some(platform_value) = platform_value.clone() {
        signature_pairs.push(("platform", platform_value));
    }
    signature_pairs.sort_by(|left, right| left.0.cmp(right.0));

    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in &signature_pairs {
        serializer.append_pair(key, value);
    }
    let unsigned_query = serializer.finish();
    let w_rid = format!("{:x}", md5::compute(format!("{}{mixin_key}", unsigned_query)));

    let mut query = vec![
        ("bvid", bvid_value),
        ("cid", cid_value),
        ("qn", qn_value),
        ("fnver", "0".to_string()),
        ("fnval", fnval_value),
        ("fourk", "1".to_string()),
    ];
    if let Some(platform_value) = platform_value {
        query.push(("platform", platform_value));
    }
    query.push(("wts", wts_value));
    query.push(("w_rid", w_rid));
    Ok(query)
}

fn request_video_playurl_data_wbi(
    client: &Client,
    cookie_header: &str,
    bvid: &str,
    cid: &str,
    fnval: &str,
    qn: &str,
    platform: Option<&str>,
    context: &str,
) -> Result<Value, String> {
    let query = build_wbi_signed_playurl_query(client, cookie_header, bvid, cid, qn, fnval, platform)?;
    let referer = format!("https://www.bilibili.com/video/{bvid}");
    request_bilibili_data_with_optional_cookie_and_headers(
        client,
        BILIBILI_PLAYER_WBI_PLAYURL_ENDPOINT,
        &query,
        Some(cookie_header),
        context,
        Some(&referer),
        Some("https://www.bilibili.com"),
    )
}

fn persist_connector_account_auth_state(
    app: &AppHandle,
    account: &crate::music_library_db::LibraryConnectorAccountRecord,
    auth_state: &str,
    account_uid: Option<String>,
) {
    let _ = crate::music_library_db::upsert_connector_account(
        app,
        crate::music_library_db::LibraryConnectorAccountUpsertInput {
            id: account.id.clone(),
            connector_id: BILIBILI_CONNECTOR_ID.to_string(),
            account_uid,
            auth_state: auth_state.to_string(),
            token_ref: account.token_ref.clone(),
            refresh_token_ref: account.refresh_token_ref.clone(),
            expires_at_ms: account.expires_at_ms,
            created_at_ms: Some(account.created_at_ms),
            updated_at_ms: Some(now_ms()),
        },
    );
}

fn probe_auth_availability(client: &Client, cookie_header: &str) -> AuthAvailabilityProbe {
    let normalized_cookie = cookie_header.trim();
    if normalized_cookie.is_empty() {
        return AuthAvailabilityProbe {
            availability: AUTH_AVAILABILITY_UNAVAILABLE.to_string(),
            availability_message: Some(
                "Bilibili login token is empty; please login again".to_string(),
            ),
            account_uid: None,
            should_mark_expired: true,
        };
    }

    let cookie_value = match HeaderValue::from_str(normalized_cookie) {
        Ok(value) => value,
        Err(error) => {
            return AuthAvailabilityProbe {
                availability: AUTH_AVAILABILITY_UNAVAILABLE.to_string(),
                availability_message: Some(format!("Invalid Bilibili cookie header: {error}")),
                account_uid: None,
                should_mark_expired: true,
            }
        }
    };

    let response = match client
        .get(BILIBILI_NAV_ENDPOINT)
        .header(COOKIE, cookie_value)
        .send()
    {
        Ok(value) => value,
        Err(error) => {
            return AuthAvailabilityProbe {
                availability: AUTH_AVAILABILITY_DEGRADED.to_string(),
                availability_message: Some(format!(
                    "Failed to verify Bilibili auth availability: {error}"
                )),
                account_uid: None,
                should_mark_expired: false,
            }
        }
    };

    let status = response.status();
    if !status.is_success() {
        return AuthAvailabilityProbe {
            availability: AUTH_AVAILABILITY_DEGRADED.to_string(),
            availability_message: Some(format!(
                "Bilibili nav returned non-success status: {status}"
            )),
            account_uid: None,
            should_mark_expired: false,
        };
    }

    let payload: BilibiliApiEnvelope<Value> = match response.json() {
        Ok(value) => value,
        Err(error) => {
            return AuthAvailabilityProbe {
                availability: AUTH_AVAILABILITY_DEGRADED.to_string(),
                availability_message: Some(format!(
                    "Failed to decode Bilibili nav payload: {error}"
                )),
                account_uid: None,
                should_mark_expired: false,
            }
        }
    };

    if payload.code == 0 {
        let account_uid = payload
            .data
            .as_ref()
            .and_then(|data| {
                to_u64(data.get("mid"))
                    .map(|value| value.to_string())
                    .or_else(|| to_non_empty_string(data.get("mid")))
            })
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        return AuthAvailabilityProbe {
            availability: AUTH_AVAILABILITY_AVAILABLE.to_string(),
            availability_message: None,
            account_uid,
            should_mark_expired: false,
        };
    }

    let message = payload
        .message
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("Bilibili nav failed with code {}", payload.code));
    let looks_like_auth_expired = payload.code == BILIBILI_AUTH_EXPIRED_CODE
        || message.contains('登')
        || message.to_ascii_lowercase().contains("login");

    AuthAvailabilityProbe {
        availability: if looks_like_auth_expired {
            AUTH_AVAILABILITY_UNAVAILABLE.to_string()
        } else {
            AUTH_AVAILABILITY_DEGRADED.to_string()
        },
        availability_message: Some(message),
        account_uid: None,
        should_mark_expired: looks_like_auth_expired,
    }
}

fn resolve_account_uid(app: &AppHandle, client: &Client, context: &AuthContext) -> Result<String, String> {
    if let Some(account_uid) = context
        .account
        .account_uid
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(account_uid.to_string());
    }

    let nav_data = request_bilibili_data(
        client,
        BILIBILI_NAV_ENDPOINT,
        &[],
        &context.cookie_header,
        "nav",
    )?;
    let mid = to_u64(nav_data.get("mid"))
        .ok_or_else(|| "Bilibili nav response missing mid".to_string())?
        .to_string();

    let _ = crate::music_library_db::upsert_connector_account(
        app,
        crate::music_library_db::LibraryConnectorAccountUpsertInput {
            id: context.account.id.clone(),
            connector_id: BILIBILI_CONNECTOR_ID.to_string(),
            account_uid: Some(mid.clone()),
            auth_state: "authorized".to_string(),
            token_ref: context.account.token_ref.clone(),
            refresh_token_ref: context.account.refresh_token_ref.clone(),
            expires_at_ms: context.account.expires_at_ms,
            created_at_ms: Some(context.account.created_at_ms),
            updated_at_ms: Some(now_ms()),
        },
    );

    Ok(mid)
}

fn normalize_content_kind(value: Option<&Value>) -> String {
    match to_i64(value) {
        Some(2) => "video".to_string(),
        Some(12) => "audio".to_string(),
        _ => "unknown".to_string(),
    }
}

fn infer_resource_locators(resource: &Value, resource_id: &str) -> (String, Option<String>, Option<String>, Option<String>, String) {
    let bvid = to_non_empty_string(resource.get("bvid"));
    let cid = to_i64(
        resource
            .get("ugc")
            .and_then(|ugc| ugc.get("first_cid")),
    )
    .map(|value| value.to_string())
    .or_else(|| parse_cid_from_text(&to_non_empty_string(resource.get("link")).unwrap_or_default()));

    let linked_text = to_non_empty_string(resource.get("link")).unwrap_or_default();
    let sid = parse_sid_from_text(&linked_text)
        .or_else(|| parse_sid_from_text(&to_non_empty_string(resource.get("short_link")).unwrap_or_default()));

    if let Some(normalized_bvid) = bvid.clone().or_else(|| parse_bvid_from_text(&linked_text)) {
        let source_locator = if let Some(cid) = cid.clone() {
            format!("bilibili://video/{normalized_bvid}?cid={cid}")
        } else {
            format!("bilibili://video/{normalized_bvid}")
        };
        let lyric_locator = Some(if let Some(cid) = cid.clone() {
            format!("bilibili://subtitle?bvid={normalized_bvid}&cid={cid}")
        } else {
            format!("bilibili://subtitle?bvid={normalized_bvid}")
        });
        return (
            source_locator,
            lyric_locator,
            Some(normalized_bvid),
            cid,
            "video".to_string(),
        );
    }

    if let Some(normalized_sid) = sid {
        let source_locator = format!("bilibili://audio/{normalized_sid}");
        let lyric_locator = Some(format!("bilibili://audio-lyric?sid={normalized_sid}"));
        return (
            source_locator,
            lyric_locator,
            None,
            None,
            "audio".to_string(),
        );
    }

    let source_locator = if !linked_text.trim().is_empty() {
        normalize_url(&linked_text)
    } else {
        format!("bilibili://resource/{resource_id}")
    };

    (
        source_locator,
        None,
        bvid,
        cid,
        normalize_content_kind(resource.get("type")),
    )
}

fn resolve_video_first_cid(
    client: &Client,
    cookie_header: &str,
    bvid: &str,
) -> Result<Option<String>, String> {
    let data = request_bilibili_data(
        client,
        BILIBILI_VIEW_ENDPOINT,
        &[("bvid", bvid.to_string())],
        cookie_header,
        "view",
    )?;

    if let Some(cid) = to_i64(data.get("cid")) {
        return Ok(Some(cid.to_string()));
    }

    let pages = data.get("pages").and_then(Value::as_array);
    if let Some(first_page) = pages.and_then(|items| items.first()) {
        return Ok(to_i64(first_page.get("cid")).map(|value| value.to_string()));
    }

    Ok(None)
}

fn resolve_video_subtitle_locator(
    client: &Client,
    cookie_header: &str,
    bvid: &str,
    cid: &str,
) -> Result<Option<BilibiliLyricLocatorRef>, String> {
    let data = request_bilibili_data(
        client,
        BILIBILI_PLAYER_V2_ENDPOINT,
        &[("bvid", bvid.to_string()), ("cid", cid.to_string())],
        cookie_header,
        "player subtitle",
    )?;

    let subtitles = data
        .get("subtitle")
        .and_then(|value| value.get("subtitles"))
        .and_then(Value::as_array);

    let Some(subtitle_items) = subtitles else {
        return Ok(None);
    };

    for subtitle in subtitle_items {
        let Some(subtitle_url) = to_non_empty_string(subtitle.get("subtitle_url")) else {
            continue;
        };
        let locator = normalize_url(&subtitle_url);
        let lang = to_non_empty_string(subtitle.get("lan_doc"))
            .or_else(|| to_non_empty_string(subtitle.get("lan")));

        return Ok(Some(BilibiliLyricLocatorRef {
            locator,
            format: "json".to_string(),
            lang,
            source_kind: "video-subtitle".to_string(),
        }));
    }

    Ok(None)
}

fn resolve_audio_lyric_locator(
    client: &Client,
    cookie_header: &str,
    sid: &str,
) -> Result<Option<BilibiliLyricLocatorRef>, String> {
    let data = request_bilibili_data(
        client,
        BILIBILI_AUDIO_SONG_INFO_ENDPOINT,
        &[("sid", sid.to_string())],
        cookie_header,
        "audio song info",
    )?;

    let Some(locator_raw) = to_non_empty_string(data.get("lyric")) else {
        return Ok(None);
    };
    let locator = normalize_url(&locator_raw);
    let lowered = locator.to_ascii_lowercase();
    let format = if lowered.ends_with(".lrc") {
        "lrc"
    } else if lowered.ends_with(".yrc") {
        "yrc"
    } else {
        "plain"
    };

    Ok(Some(BilibiliLyricLocatorRef {
        locator,
        format: format.to_string(),
        lang: None,
        source_kind: "audio-lyric".to_string(),
    }))
}

fn sanitize_cache_file_segment(value: &str) -> String {
    let normalized: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();

    let trimmed = normalized.trim_matches('_').trim();
    if trimmed.is_empty() {
        "unknown".to_string()
    } else {
        trimmed.to_string()
    }
}

fn infer_cache_extension(stream_url: &str, mime_type: Option<&str>) -> String {
    if let Some(mime) = mime_type {
        let lowered = mime.to_ascii_lowercase();
        if lowered.contains("audio/mpeg") {
            return "mp3".to_string();
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
                if lowered == "m4a"
                    || lowered == "mp3"
                    || lowered == "aac"
                    || lowered == "ogg"
                    || lowered == "flac"
                    || lowered == "wav"
                {
                    return lowered;
                }
            }
        }
    }

    "m4a".to_string()
}

fn infer_cover_extension(cover_url: &str, mime_type: Option<&str>) -> String {
    if let Some(mime) = mime_type {
        let lowered = mime.to_ascii_lowercase();
        if lowered.contains("image/webp") {
            return "webp".to_string();
        }
        if lowered.contains("image/png") {
            return "png".to_string();
        }
        if lowered.contains("image/jpeg") || lowered.contains("image/jpg") {
            return "jpg".to_string();
        }
    }

    if let Ok(parsed) = Url::parse(cover_url) {
        if let Some(last) = parsed
            .path_segments()
            .into_iter()
            .flat_map(|segments| segments)
            .last()
        {
            if let Some(extension) = Path::new(last).extension().and_then(|ext| ext.to_str()) {
                let lowered = extension.trim().to_ascii_lowercase();
                if lowered == "jpg" || lowered == "jpeg" || lowered == "png" || lowered == "webp" {
                    return if lowered == "jpeg" {
                        "jpg".to_string()
                    } else {
                        lowered
                    };
                }
            }
        }
    }

    "jpg".to_string()
}

fn build_cover_cache_key(url: &str) -> String {
    let mut hasher = DefaultHasher::new();
    url.hash(&mut hasher);
    format!("cover-{:016x}", hasher.finish())
}

fn build_cover_cache_path(dirs: &BilibiliPlaybackCacheDirs, key: &str, ext: &str) -> PathBuf {
    dirs.cover_dir.join(format!("{key}.{ext}"))
}

fn find_existing_cover_cache_path(dirs: &BilibiliPlaybackCacheDirs, key: &str) -> Option<PathBuf> {
    let candidates = ["jpg", "png", "webp"];
    for ext in candidates {
        let path = build_cover_cache_path(dirs, key, ext);
        let exists = fs::metadata(&path).ok().map(|meta| meta.len() > 0).unwrap_or(false);
        if exists {
            return Some(path);
        }
    }
    None
}

fn quality_label_by_key(key: &str) -> &'static str {
    match key {
        QUALITY_KEY_64K => "64K",
        QUALITY_KEY_132K => "132K",
        QUALITY_KEY_192K => "192K",
        QUALITY_KEY_DOLBY => "Dolby Atmos",
        QUALITY_KEY_HIRES => "Hi-Res Lossless",
        _ => "Auto",
    }
}

fn quality_score_by_key(key: &str) -> i64 {
    match key {
        QUALITY_KEY_HIRES => 5_000,
        QUALITY_KEY_DOLBY => 4_000,
        QUALITY_KEY_192K => 3_000,
        QUALITY_KEY_132K => 2_000,
        QUALITY_KEY_64K => 1_000,
        _ => 0,
    }
}

fn normalize_quality_hint(value: Option<&str>) -> &'static str {
    let normalized = value
        .map(str::trim)
        .unwrap_or_default()
        .to_ascii_lowercase();
    match normalized.as_str() {
        QUALITY_KEY_64K => QUALITY_KEY_64K,
        QUALITY_KEY_132K => QUALITY_KEY_132K,
        QUALITY_KEY_192K => QUALITY_KEY_192K,
        QUALITY_KEY_DOLBY => QUALITY_KEY_DOLBY,
        QUALITY_KEY_HIRES => QUALITY_KEY_HIRES,
        _ => QUALITY_KEY_AUTO,
    }
}

fn quality_fallback_order(quality_key: &str) -> &'static [&'static str] {
    match quality_key {
        QUALITY_KEY_64K => &[
            QUALITY_KEY_64K,
            QUALITY_KEY_132K,
            QUALITY_KEY_192K,
            QUALITY_KEY_DOLBY,
            QUALITY_KEY_HIRES,
            QUALITY_KEY_AUTO,
        ],
        QUALITY_KEY_132K => &[
            QUALITY_KEY_132K,
            QUALITY_KEY_192K,
            QUALITY_KEY_64K,
            QUALITY_KEY_DOLBY,
            QUALITY_KEY_HIRES,
            QUALITY_KEY_AUTO,
        ],
        QUALITY_KEY_192K => &[
            QUALITY_KEY_192K,
            QUALITY_KEY_132K,
            QUALITY_KEY_64K,
            QUALITY_KEY_DOLBY,
            QUALITY_KEY_HIRES,
            QUALITY_KEY_AUTO,
        ],
        QUALITY_KEY_DOLBY => &[
            QUALITY_KEY_DOLBY,
            QUALITY_KEY_HIRES,
            QUALITY_KEY_192K,
            QUALITY_KEY_132K,
            QUALITY_KEY_64K,
            QUALITY_KEY_AUTO,
        ],
        QUALITY_KEY_HIRES => &[
            QUALITY_KEY_HIRES,
            QUALITY_KEY_DOLBY,
            QUALITY_KEY_192K,
            QUALITY_KEY_132K,
            QUALITY_KEY_64K,
            QUALITY_KEY_AUTO,
        ],
        _ => &[
            QUALITY_KEY_HIRES,
            QUALITY_KEY_DOLBY,
            QUALITY_KEY_192K,
            QUALITY_KEY_132K,
            QUALITY_KEY_64K,
            QUALITY_KEY_AUTO,
        ],
    }
}

fn extract_stream_url(item: &Value) -> Option<String> {
    to_non_empty_string(item.get("baseUrl"))
        .or_else(|| to_non_empty_string(item.get("base_url")))
        .or_else(|| {
            item.get("backupUrl")
                .or_else(|| item.get("backup_url"))
                .and_then(Value::as_array)
                .and_then(|values| values.first())
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
        .map(|value| normalize_url(&value))
}

fn infer_quality_key_from_codec_or_mime(item: &Value) -> Option<&'static str> {
    let codec_or_mime = to_non_empty_string(item.get("codecs"))
        .or_else(|| to_non_empty_string(item.get("codec")))
        .or_else(|| to_non_empty_string(item.get("mimeType")))
        .or_else(|| to_non_empty_string(item.get("mime_type")))
        .unwrap_or_default()
        .to_ascii_lowercase();

    if codec_or_mime.is_empty() {
        return None;
    }

    if codec_or_mime.contains("flac") || codec_or_mime.contains("alac") {
        return Some(QUALITY_KEY_HIRES);
    }

    if codec_or_mime.contains("ec-3")
        || codec_or_mime.contains("eac-3")
        || codec_or_mime.contains("ec3")
        || codec_or_mime.contains("eac3")
        || codec_or_mime.contains("dolby")
    {
        return Some(QUALITY_KEY_DOLBY);
    }

    None
}

fn map_dash_quality_by_audio_item(
    item: &Value,
    audio_id: Option<u64>,
    bandwidth: u64,
) -> (&'static str, &'static str) {
    match audio_id.unwrap_or_default() {
        30216 => (QUALITY_KEY_64K, "64K"),
        30232 => (QUALITY_KEY_132K, "132K"),
        30280 => (QUALITY_KEY_192K, "192K"),
        30250 => (QUALITY_KEY_DOLBY, "Dolby Atmos"),
        30251 => (QUALITY_KEY_HIRES, "Hi-Res Lossless"),
        _ => {
            if let Some(inferred_quality_key) = infer_quality_key_from_codec_or_mime(item) {
                return (inferred_quality_key, quality_label_by_key(inferred_quality_key));
            }

            if bandwidth >= 180_000 {
                (QUALITY_KEY_192K, "192K")
            } else if bandwidth >= 95_000 {
                (QUALITY_KEY_132K, "132K")
            } else {
                (QUALITY_KEY_64K, "64K")
            }
        }
    }
}

fn push_special_quality_candidate(
    candidates: &mut Vec<BilibiliPlaybackStreamCandidate>,
    item: &Value,
    quality_key: &str,
) {
    let Some(url) = extract_stream_url(item) else {
        return;
    };

    let bandwidth = to_u64(item.get("bandwidth")).unwrap_or(0);
    let score = quality_score_by_key(quality_key) + i64::try_from(bandwidth / 1024).unwrap_or(0);
    candidates.push(BilibiliPlaybackStreamCandidate {
        quality_key: quality_key.to_string(),
        quality_label: quality_label_by_key(quality_key).to_string(),
        stream_url: url,
        score,
    });
}

fn build_stream_candidates(playurl_data: &Value) -> Vec<BilibiliPlaybackStreamCandidate> {
    let mut candidates: Vec<BilibiliPlaybackStreamCandidate> = Vec::new();

    if let Some(url) = playurl_data
        .get("durl")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| to_non_empty_string(item.get("url")))
    {
        candidates.push(BilibiliPlaybackStreamCandidate {
            quality_key: QUALITY_KEY_AUTO.to_string(),
            quality_label: quality_label_by_key(QUALITY_KEY_AUTO).to_string(),
            stream_url: normalize_url(&url),
            score: 100,
        });
    }

    if let Some(audio_items) = playurl_data
        .get("dash")
        .and_then(|dash| dash.get("audio"))
        .and_then(Value::as_array)
    {
        for item in audio_items {
            let Some(url) = extract_stream_url(item) else {
                continue;
            };
            let audio_id = to_u64(item.get("id"));
            let bandwidth = to_u64(item.get("bandwidth")).unwrap_or(0);
            let (quality_key, quality_label) = map_dash_quality_by_audio_item(item, audio_id, bandwidth);
            let score = quality_score_by_key(quality_key) + i64::try_from(bandwidth / 1024).unwrap_or(0);
            candidates.push(BilibiliPlaybackStreamCandidate {
                quality_key: quality_key.to_string(),
                quality_label: quality_label.to_string(),
                stream_url: url,
                score,
            });
        }
    }

    if let Some(dolby_audio_value) = playurl_data
        .get("dolby")
        .and_then(|dolby| dolby.get("audio"))
        .or_else(|| {
            playurl_data
                .get("dash")
                .and_then(|dash| dash.get("dolby"))
                .and_then(|dolby| dolby.get("audio"))
        })
    {
        if let Some(dolby_audio_items) = dolby_audio_value.as_array() {
            for item in dolby_audio_items {
                push_special_quality_candidate(&mut candidates, item, QUALITY_KEY_DOLBY);
            }
        } else if dolby_audio_value.is_object() {
            push_special_quality_candidate(&mut candidates, dolby_audio_value, QUALITY_KEY_DOLBY);
        }
    }

    if let Some(flac_audio_value) = playurl_data
        .get("flac")
        .and_then(|flac| flac.get("audio"))
        .or_else(|| {
            playurl_data
                .get("dash")
                .and_then(|dash| dash.get("flac"))
                .and_then(|flac| flac.get("audio"))
        })
    {
        if let Some(flac_audio_items) = flac_audio_value.as_array() {
            for item in flac_audio_items {
                push_special_quality_candidate(&mut candidates, item, QUALITY_KEY_HIRES);
            }
        } else if flac_audio_value.is_object() {
            push_special_quality_candidate(&mut candidates, flac_audio_value, QUALITY_KEY_HIRES);
        }
    }

    candidates
}

fn build_playback_quality_options(playurl_data: &Value) -> Vec<BilibiliPlaybackQualityOption> {
    let candidates = build_stream_candidates(playurl_data);
    let available_keys: HashSet<String> = candidates
        .iter()
        .map(|item| item.quality_key.clone())
        .collect();
    let mut available_keys = available_keys;

    let has_dolby_display = playurl_data
        .get("dolby")
        .and_then(|dolby| dolby.get("display"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || playurl_data
            .get("dash")
            .and_then(|dash| dash.get("dolby"))
            .and_then(|dolby| dolby.get("display"))
            .and_then(Value::as_bool)
            .unwrap_or(false);

    let has_hires_display = playurl_data
        .get("flac")
        .and_then(|flac| flac.get("display"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || playurl_data
            .get("dash")
            .and_then(|dash| dash.get("flac"))
            .and_then(|flac| flac.get("display"))
            .and_then(Value::as_bool)
            .unwrap_or(false);

    if has_dolby_display {
        available_keys.insert(QUALITY_KEY_DOLBY.to_string());
    }
    if has_hires_display {
        available_keys.insert(QUALITY_KEY_HIRES.to_string());
    }

    [
        QUALITY_KEY_AUTO,
        QUALITY_KEY_64K,
        QUALITY_KEY_132K,
        QUALITY_KEY_192K,
        QUALITY_KEY_DOLBY,
        QUALITY_KEY_HIRES,
    ]
    .iter()
    .map(|key| BilibiliPlaybackQualityOption {
        key: (*key).to_string(),
        label: quality_label_by_key(key).to_string(),
        available: if *key == QUALITY_KEY_AUTO {
            !candidates.is_empty()
        } else {
            available_keys.contains(*key)
        },
    })
    .collect()
}

fn select_stream_candidate(
    candidates: &[BilibiliPlaybackStreamCandidate],
    quality_hint: Option<&str>,
) -> Option<BilibiliPlaybackStreamCandidate> {
    if candidates.is_empty() {
        return None;
    }

    let requested_quality = normalize_quality_hint(quality_hint);
    for quality_key in quality_fallback_order(requested_quality) {
        if *quality_key == QUALITY_KEY_AUTO {
            return candidates.iter().max_by_key(|item| item.score).cloned();
        }

        if let Some(selected) = candidates
            .iter()
            .filter(|item| item.quality_key == *quality_key)
            .max_by_key(|item| item.score)
        {
            return Some(selected.clone());
        }
    }

    candidates.iter().max_by_key(|item| item.score).cloned()
}

fn request_video_playurl_data_with_fallback(
    client: &Client,
    cookie_header: &str,
    bvid: &str,
    cid: &str,
) -> Result<Value, String> {
    let normalized_cookie_header = normalize_cookie_header_for_playurl(client, cookie_header);
    let wbi_attempts: [(&str, &str, Option<&str>, &str); 2] = [
        ("4048", "127", None, "player wbi playurl dash full"),
        ("16", "80", None, "player wbi playurl dash"),
    ];
    let legacy_attempts: [(&str, &str, Option<&str>, &str); 4] = [
        ("4048", "127", None, "player playurl dash full"),
        ("16", "80", None, "player playurl dash"),
        ("0", "80", Some("html5"), "player playurl durl"),
        ("0", "64", Some("html5"), "player playurl durl fallback"),
    ];
    let public_attempts: [(&str, &str, Option<&str>, &str); 2] = [
        ("0", "80", Some("html5"), "player playurl public durl"),
        ("0", "64", Some("html5"), "player playurl public durl fallback"),
    ];
    let mut errors: Vec<String> = Vec::new();

    for (fnval, qn, platform, context) in wbi_attempts {
        match request_video_playurl_data_wbi(
            client,
            &normalized_cookie_header,
            bvid,
            cid,
            fnval,
            qn,
            platform,
            context,
        ) {
            Ok(data) => {
                if !build_stream_candidates(&data).is_empty() {
                    return Ok(data);
                }
                errors.push(format!("{context}: no playable stream fields"));
            }
            Err(error) => errors.push(error),
        }
    }

    for (fnval, qn, platform, context) in legacy_attempts {
        let mut query = vec![
            ("bvid", bvid.to_string()),
            ("cid", cid.to_string()),
            ("qn", qn.to_string()),
            ("fnver", "0".to_string()),
            ("fnval", fnval.to_string()),
            ("fourk", "1".to_string()),
        ];
        if let Some(platform) = platform {
            query.push(("platform", platform.to_string()));
        }
        let referer = format!("https://www.bilibili.com/video/{bvid}");

        match request_bilibili_data_with_optional_cookie_and_headers(
            client,
            BILIBILI_PLAYER_PLAYURL_ENDPOINT,
            &query,
            Some(&normalized_cookie_header),
            context,
            Some(&referer),
            Some("https://www.bilibili.com"),
        ) {
            Ok(data) => {
                if !build_stream_candidates(&data).is_empty() {
                    return Ok(data);
                }
                errors.push(format!("{context}: no playable stream fields"));
            }
            Err(error) => errors.push(error),
        }
    }

    match request_video_playinfo_from_page(client, Some(&normalized_cookie_header), bvid, cid) {
        Ok(Some(data)) => {
            if !build_stream_candidates(&data).is_empty() {
                return Ok(data);
            }
            errors.push("playinfo page (auth): no playable stream fields".to_string());
        }
        Ok(None) => errors.push("playinfo page (auth): no __playinfo__ payload".to_string()),
        Err(error) => errors.push(error),
    }

    match request_video_playinfo_from_page(client, None, bvid, cid) {
        Ok(Some(data)) => {
            if !build_stream_candidates(&data).is_empty() {
                return Ok(data);
            }
            errors.push("playinfo page (public): no playable stream fields".to_string());
        }
        Ok(None) => errors.push("playinfo page (public): no __playinfo__ payload".to_string()),
        Err(error) => errors.push(error),
    }

    for (fnval, qn, platform, context) in public_attempts {
        let mut query = vec![
            ("bvid", bvid.to_string()),
            ("cid", cid.to_string()),
            ("qn", qn.to_string()),
            ("fnver", "0".to_string()),
            ("fnval", fnval.to_string()),
            ("fourk", "1".to_string()),
        ];
        if let Some(platform) = platform {
            query.push(("platform", platform.to_string()));
        }
        let referer = format!("https://www.bilibili.com/video/{bvid}");

        match request_bilibili_data_with_optional_cookie_and_headers(
            client,
            BILIBILI_PLAYER_PLAYURL_ENDPOINT,
            &query,
            None,
            context,
            Some(&referer),
            Some("https://www.bilibili.com"),
        ) {
            Ok(data) => {
                if !build_stream_candidates(&data).is_empty() {
                    return Ok(data);
                }
                errors.push(format!("{context}: no playable stream fields"));
            }
            Err(error) => errors.push(error),
        }
    }

    if errors.is_empty() {
        return Err("No playable Bilibili audio stream resolved".to_string());
    }

    Err(format!(
        "No playable Bilibili audio stream resolved: {}",
        errors.join(" | ")
    ))
}

fn pick_video_duration_seconds(playurl_data: &Value) -> Option<u32> {
    if let Some(duration_ms) = to_u64(playurl_data.get("timelength")) {
        let seconds = duration_ms / 1000;
        if seconds > 0 {
            if let Ok(value) = u32::try_from(seconds) {
                return Some(value);
            }
        }
    }

    if let Some(seconds) = playurl_data
        .get("dash")
        .and_then(|dash| dash.get("duration"))
        .and_then(Value::as_f64)
    {
        if seconds.is_finite() && seconds > 0.0 {
            return u32::try_from(seconds.floor() as u64).ok();
        }
    }

    None
}

fn resolve_video_playback_stream(
    client: &Client,
    cookie_header: &str,
    bvid: &str,
    cid: &str,
    quality_hint: Option<&str>,
) -> Result<(BilibiliPlaybackStreamCandidate, Option<u32>, Vec<BilibiliPlaybackQualityOption>), String> {
    let playurl_data = request_video_playurl_data_with_fallback(client, cookie_header, bvid, cid)?;
    let candidates = build_stream_candidates(&playurl_data);
    let selected = select_stream_candidate(&candidates, quality_hint)
        .ok_or_else(|| "No playable Bilibili audio stream resolved".to_string())?;
    let duration_seconds = pick_video_duration_seconds(&playurl_data);
    let quality_options = build_playback_quality_options(&playurl_data);

    Ok((selected, duration_seconds, quality_options))
}

fn build_qr_image_data_url(content: &str) -> Result<String, String> {
    let code = QrCode::new(content.as_bytes())
        .map_err(|error| format!("Failed to build QR code matrix: {error}"))?;

    let image = code
        .render::<Luma<u8>>()
        .min_dimensions(240, 240)
        .max_dimensions(360, 360)
        .build();
    let mut bytes = Vec::new();
    {
        let mut cursor = Cursor::new(&mut bytes);
        image::DynamicImage::ImageLuma8(image)
            .write_to(&mut cursor, image::ImageFormat::Png)
            .map_err(|error| format!("Failed to encode QR image as PNG: {error}"))?;
    }

    Ok(format!(
        "data:image/png;base64,{}",
        BASE64_STANDARD.encode(bytes)
    ))
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    ensure_connector(app)?;
    let _ = cleanup_session_cover_cache_internal(app);

    if let Some(account) = crate::music_library_db::get_latest_connector_account_by_connector_id(
        app,
        BILIBILI_CONNECTOR_ID,
    )? {
        if account.auth_state.eq_ignore_ascii_case("authorized") {
            if let Some(cookie_header) = account
                .token_ref
                .as_deref()
                .and_then(read_cookie_header_from_token_ref)
            {
                set_auth_cookie_state(cookie_header);
            }
        }
    }

    Ok(())
}

pub fn cleanup_session_cover_cache(app: &AppHandle) -> Result<(), String> {
    cleanup_session_cover_cache_internal(app)
}

pub fn get_playback_cache_settings(app: &AppHandle) -> Result<BilibiliPlaybackCacheSettings, String> {
    let state = get_playback_cache_settings_state(app)?;
    let effective_root_path = resolve_effective_playback_cache_root(app)?;
    let default_root_path = resolve_default_playback_cache_root(app)?;

    Ok(BilibiliPlaybackCacheSettings {
        custom_root_path: state.custom_root_path,
        effective_root_path: effective_root_path.to_string_lossy().to_string(),
        default_root_path: default_root_path.to_string_lossy().to_string(),
    })
}

pub fn set_playback_cache_settings(
    app: &AppHandle,
    custom_root_path: Option<String>,
) -> Result<BilibiliPlaybackCacheSettings, String> {
    let state = persist_playback_cache_settings_state(
        app,
        BilibiliPlaybackCacheSettingsState { custom_root_path },
    )?;

    let effective_root_path = resolve_effective_playback_cache_root(app)?;
    let _ = ensure_playback_cache_dirs_for_root(app, effective_root_path.clone());
    let default_root_path = resolve_default_playback_cache_root(app)?;

    Ok(BilibiliPlaybackCacheSettings {
        custom_root_path: state.custom_root_path,
        effective_root_path: effective_root_path.to_string_lossy().to_string(),
        default_root_path: default_root_path.to_string_lossy().to_string(),
    })
}

pub fn qr_generate(app: &AppHandle) -> Result<BilibiliQrCodeSession, String> {
    ensure_connector(app)?;
    cleanup_expired_qr_sessions(now_ms());

    let client = build_http_client()?;
    let response = client
        .get(BILIBILI_QR_GENERATE_ENDPOINT)
        .send()
        .map_err(|error| format!("Bilibili QR generate request failed: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "Bilibili QR generate returned non-success status: {status}"
        ));
    }

    let payload: BilibiliApiEnvelope<BilibiliQrGenerateData> = response
        .json()
        .map_err(|error| format!("Failed to decode Bilibili QR generate response: {error}"))?;

    if payload.code != 0 {
        return Err(format!(
            "Bilibili QR generate failed (code={}): {}",
            payload.code,
            payload
                .message
                .as_deref()
                .unwrap_or("unknown generate failure")
        ));
    }

    let data = payload
        .data
        .ok_or_else(|| "Bilibili QR generate response missing data".to_string())?;

    let generated_at_ms = now_ms();
    let expires_at_ms = generated_at_ms.saturating_add(QR_SESSION_TTL_MS);
    let session_id = data.qrcode_key.trim().to_string();
    if session_id.is_empty() {
        return Err("Bilibili QR generate response missing qrcode_key".to_string());
    }

    {
        let mut sessions = lock_qr_sessions()?;
        sessions.insert(
            session_id.clone(),
            QrSessionState {
                qrcode_key: session_id.clone(),
                expires_at_ms,
            },
        );
    }

    let qr_image_data_url = build_qr_image_data_url(data.url.as_str())?;

    Ok(BilibiliQrCodeSession {
        connector_id: BILIBILI_CONNECTOR_ID.to_string(),
        session_id: session_id.clone(),
        qrcode_key: session_id,
        qr_url: data.url,
        qr_image_data_url,
        generated_at_ms,
        expires_at_ms,
    })
}

pub fn qr_poll(app: &AppHandle, session_id: &str) -> Result<BilibiliQrPollResult, String> {
    ensure_connector(app)?;
    cleanup_expired_qr_sessions(now_ms());

    let normalized_session_id = session_id.trim();
    if normalized_session_id.is_empty() {
        return Err("Bilibili QR poll requires sessionId".to_string());
    }

    let session = {
        let sessions = lock_qr_sessions()?;
        sessions
            .get(normalized_session_id)
            .cloned()
            .ok_or_else(|| format!("Bilibili QR session not found: {normalized_session_id}"))?
    };

    let now = now_ms();
    if now >= session.expires_at_ms {
        let mut sessions = lock_qr_sessions()?;
        sessions.remove(normalized_session_id);

        return Ok(BilibiliQrPollResult {
            connector_id: BILIBILI_CONNECTOR_ID.to_string(),
            session_id: normalized_session_id.to_string(),
            state: "expired".to_string(),
            state_code: 86038,
            state_message: "二维码已过期，请重新生成".to_string(),
            auth_state: "expired".to_string(),
            account_uid: None,
            expires_at_ms: Some(session.expires_at_ms),
        });
    }

    let client = build_http_client()?;
    let response = client
        .get(BILIBILI_QR_POLL_ENDPOINT)
        .query(&[("qrcode_key", session.qrcode_key.as_str())])
        .send()
        .map_err(|error| format!("Bilibili QR poll request failed: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "Bilibili QR poll returned non-success status: {status}"
        ));
    }

    let payload: BilibiliApiEnvelope<BilibiliQrPollData> = response
        .json()
        .map_err(|error| format!("Failed to decode Bilibili QR poll response: {error}"))?;

    if payload.code != 0 {
        return Err(format!(
            "Bilibili QR poll failed (code={}): {}",
            payload.code,
            payload.message.as_deref().unwrap_or("unknown poll failure")
        ));
    }

    let data = payload
        .data
        .ok_or_else(|| "Bilibili QR poll response missing data".to_string())?;

    let state_message = data
        .message
        .clone()
        .unwrap_or_else(|| "unknown state".to_string());
    let (state, auth_state, terminal) = map_poll_state(data.code, &state_message);
    let account_uid = data
        .url
        .as_deref()
        .and_then(|value| extract_query_param(value, "DedeUserID"));

    if auth_state == "authorized" {
        let account_id = format!(
            "{}::{}",
            BILIBILI_CONNECTOR_ID,
            account_uid
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(normalized_session_id)
        );

        let cookie_header = data
            .url
            .as_deref()
            .and_then(build_cookie_header_from_auth_callback_url);

        let token_ref = if let Some(cookie_header) = cookie_header.as_deref() {
            match write_cookie_header_to_keyring(&account_id, cookie_header) {
                Ok(token_ref) => Some(token_ref),
                Err(error) => {
                    eprintln!(
                        "[music_platform_bilibili] keyring store failed, fallback to legacy token_ref: {error}"
                    );
                    encode_cookie_header_token_ref_legacy(cookie_header)
                }
            }
        } else {
            None
        };

        let refresh_token_ref = data
            .refresh_token
            .as_ref()
            .map(|_| format!("volatile://bilibili-refresh/{normalized_session_id}"));

        if let Some(cookie_header) = cookie_header {
            set_auth_cookie_state(cookie_header);
        }

        let _ = crate::music_library_db::upsert_connector_account(
            app,
            crate::music_library_db::LibraryConnectorAccountUpsertInput {
                id: account_id,
                connector_id: BILIBILI_CONNECTOR_ID.to_string(),
                account_uid: account_uid.clone(),
                auth_state: "authorized".to_string(),
                token_ref,
                refresh_token_ref,
                expires_at_ms: None,
                created_at_ms: None,
                updated_at_ms: Some(now_ms()),
            },
        );
    }

    if terminal {
        let mut sessions = lock_qr_sessions()?;
        sessions.remove(normalized_session_id);
    }

    Ok(BilibiliQrPollResult {
        connector_id: BILIBILI_CONNECTOR_ID.to_string(),
        session_id: normalized_session_id.to_string(),
        state,
        state_code: data.code,
        state_message,
        auth_state,
        account_uid,
        expires_at_ms: Some(session.expires_at_ms),
    })
}

pub fn get_auth_status(app: &AppHandle) -> Result<BilibiliAuthStatus, String> {
    ensure_connector(app)?;
    let now = now_ms();
    let account = crate::music_library_db::get_latest_connector_account_by_connector_id(
        app,
        BILIBILI_CONNECTOR_ID,
    )?;

    let (
        mut auth_state,
        mut account_uid,
        mut updated_at_ms,
        expires_at_ms,
        mut availability,
        mut availability_message,
    ) = if let Some(account) = account.as_ref() {
        let normalized_state = account.auth_state.trim().to_ascii_lowercase();
        let derived_state = if normalized_state == "authorized" {
            if account
                .expires_at_ms
                .is_some_and(|expires_at| expires_at <= now)
            {
                "expired".to_string()
            } else {
                "authorized".to_string()
            }
        } else if normalized_state.is_empty() {
            "unauthorized".to_string()
        } else {
            normalized_state
        };
        (
            derived_state,
            account.account_uid.clone(),
            Some(account.updated_at_ms),
            account.expires_at_ms,
            Some(AUTH_AVAILABILITY_UNAVAILABLE.to_string()),
            None,
        )
    } else {
        (
            "unauthorized".to_string(),
            None,
            None,
            None,
            Some(AUTH_AVAILABILITY_UNAVAILABLE.to_string()),
            Some("Bilibili account is not logged in".to_string()),
        )
    };

    if let Some(account) = account.as_ref() {
        if auth_state.eq_ignore_ascii_case("authorized") {
            let cookie_header = get_auth_cookie_header().or_else(|| {
                account
                    .token_ref
                    .as_deref()
                    .and_then(read_cookie_header_from_token_ref)
            });

            if let Some(cookie_header) = cookie_header {
                set_auth_cookie_state(cookie_header.clone());
                let client = build_http_client()?;
                let probe = probe_auth_availability(&client, &cookie_header);
                availability = Some(probe.availability.clone());
                availability_message = probe.availability_message.clone();

                if let Some(probe_uid) = probe.account_uid {
                    let should_update_uid = account_uid
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        != Some(probe_uid.as_str());
                    if should_update_uid {
                        account_uid = Some(probe_uid.clone());
                        persist_connector_account_auth_state(
                            app,
                            account,
                            "authorized",
                            Some(probe_uid),
                        );
                        updated_at_ms = Some(now_ms());
                    }
                }

                if probe.should_mark_expired {
                    auth_state = "expired".to_string();
                    availability = Some(AUTH_AVAILABILITY_UNAVAILABLE.to_string());
                    persist_connector_account_auth_state(app, account, "expired", account_uid.clone());
                    updated_at_ms = Some(now_ms());
                }
            } else {
                auth_state = "expired".to_string();
                availability = Some(AUTH_AVAILABILITY_UNAVAILABLE.to_string());
                availability_message = Some(
                    "Bilibili login token is unavailable in current session, please scan QR again"
                        .to_string(),
                );
                persist_connector_account_auth_state(app, account, "expired", account_uid.clone());
                updated_at_ms = Some(now_ms());
            }
        } else if auth_state.eq_ignore_ascii_case("pending") {
            availability = Some(AUTH_AVAILABILITY_DEGRADED.to_string());
            availability_message = Some("Waiting for Bilibili QR confirmation".to_string());
        } else if auth_state.eq_ignore_ascii_case("expired") {
            availability = Some(AUTH_AVAILABILITY_UNAVAILABLE.to_string());
            availability_message = Some("Bilibili login expired, please login again".to_string());
        } else if auth_state.eq_ignore_ascii_case("revoked") {
            availability = Some(AUTH_AVAILABILITY_UNAVAILABLE.to_string());
            availability_message = Some("Bilibili connector session revoked".to_string());
        }
    }

    Ok(BilibiliAuthStatus {
        connector_id: BILIBILI_CONNECTOR_ID.to_string(),
        auth_state,
        account_uid,
        updated_at_ms,
        expires_at_ms,
        availability,
        availability_message,
    })
}

pub fn logout(app: &AppHandle) -> Result<BilibiliAuthStatus, String> {
    ensure_connector(app)?;

    if let Some(account) = crate::music_library_db::get_latest_connector_account_by_connector_id(
        app,
        BILIBILI_CONNECTOR_ID,
    )? {
        if let Some(token_ref) = account.token_ref.as_deref() {
            delete_cookie_header_by_token_ref(token_ref);
        }

        let _ = crate::music_library_db::upsert_connector_account(
            app,
            crate::music_library_db::LibraryConnectorAccountUpsertInput {
                id: account.id,
                connector_id: BILIBILI_CONNECTOR_ID.to_string(),
                account_uid: account.account_uid,
                auth_state: "revoked".to_string(),
                token_ref: None,
                refresh_token_ref: None,
                expires_at_ms: None,
                created_at_ms: Some(account.created_at_ms),
                updated_at_ms: Some(now_ms()),
            },
        )?;
    }

    if let Ok(mut sessions) = lock_qr_sessions() {
        sessions.clear();
    }
    clear_auth_cookie_state();

    get_auth_status(app)
}

pub fn list_favorite_folders(app: &AppHandle) -> Result<Vec<BilibiliFavoriteFolder>, String> {
    ensure_connector(app)?;
    let auth_context = ensure_auth_context(app)?;
    let client = build_http_client()?;
    let account_uid = resolve_account_uid(app, &client, &auth_context)?;

    let data = request_bilibili_data(
        &client,
        BILIBILI_FAVORITE_FOLDERS_ENDPOINT,
        &[
            ("up_mid", account_uid),
            ("type", "2".to_string()),
            ("platform", "web".to_string()),
        ],
        &auth_context.cookie_header,
        "favorite folder list",
    )?;

    let list = data
        .get("list")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut folders: Vec<BilibiliFavoriteFolder> = Vec::with_capacity(list.len());
    for folder in list {
        let folder_id = to_u64(folder.get("id"))
            .map(|value| value.to_string())
            .or_else(|| to_non_empty_string(folder.get("id")));
        let title = to_non_empty_string(folder.get("title"));
        let Some(folder_id) = folder_id else {
            continue;
        };
        let Some(title) = title else {
            continue;
        };

        let media_count = to_u64(folder.get("media_count")).unwrap_or(0);
        let cover_url = to_non_empty_string(folder.get("cover")).map(|url| normalize_url(&url));
        let updated_at_ms = to_i64(folder.get("mtime")).map(|seconds| seconds.saturating_mul(1000));

        folders.push(BilibiliFavoriteFolder {
            folder_id,
            title,
            media_count,
            cover_url,
            updated_at_ms,
        });
    }

    folders.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
    Ok(folders)
}

pub fn list_favorite_resources(
    app: &AppHandle,
    folder_id: &str,
    page_num: Option<u32>,
    page_size: Option<u32>,
) -> Result<BilibiliFavoriteResourcePage, String> {
    ensure_connector(app)?;
    let auth_context = ensure_auth_context(app)?;

    let normalized_folder_id = folder_id.trim();
    if normalized_folder_id.is_empty() {
        return Err("folderId is required".to_string());
    }

    let normalized_page_num = page_num.unwrap_or(1).clamp(1, 200);
    let normalized_page_size = page_size.unwrap_or(20).clamp(1, 100);
    let client = build_http_client()?;

    let data = request_bilibili_data(
        &client,
        BILIBILI_FAVORITE_RESOURCES_ENDPOINT,
        &[
            ("media_id", normalized_folder_id.to_string()),
            ("pn", normalized_page_num.to_string()),
            ("ps", normalized_page_size.to_string()),
            ("type", "0".to_string()),
            ("platform", "web".to_string()),
            ("order", "mtime".to_string()),
        ],
        &auth_context.cookie_header,
        "favorite resource list",
    )?;

    let medias = data
        .get("medias")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut items: Vec<BilibiliFavoriteResourceItem> = Vec::with_capacity(medias.len());
    for resource in medias {
        let resource_id = to_u64(resource.get("id"))
            .map(|value| value.to_string())
            .or_else(|| to_non_empty_string(resource.get("id")))
            .unwrap_or_else(|| format!("resource-{}", items.len() + 1));

        let title = to_non_empty_string(resource.get("title"))
            .unwrap_or_else(|| "Untitled resource".to_string());
        let owner_name = resource
            .get("upper")
            .and_then(|upper| to_non_empty_string(upper.get("name")));
        let duration_seconds = to_u64(resource.get("duration"))
            .or_else(|| to_u64(resource.get("duration_sec")))
            .and_then(|value| u32::try_from(value).ok());
        let cover_url = to_non_empty_string(resource.get("cover")).map(|url| normalize_url(&url));

        let (source_locator, lyric_locator, bvid, cid, inferred_kind) =
            infer_resource_locators(&resource, &resource_id);
        let content_kind = if inferred_kind == "unknown" {
            normalize_content_kind(resource.get("type"))
        } else {
            inferred_kind
        };

        items.push(BilibiliFavoriteResourceItem {
            resource_id,
            title,
            owner_name,
            duration_seconds,
            cover_url,
            source_locator,
            lyric_locator,
            bvid,
            cid,
            content_kind,
        });
    }

    let total = to_u64(
        data.get("info")
            .and_then(|info| info.get("media_count")),
    )
    .unwrap_or_else(|| items.len() as u64);
    let has_more = data
        .get("has_more")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| {
            (normalized_page_num as u64).saturating_mul(normalized_page_size as u64) < total
        });

    Ok(BilibiliFavoriteResourcePage {
        folder_id: normalized_folder_id.to_string(),
        page_num: normalized_page_num,
        page_size: normalized_page_size,
        total,
        has_more,
        items,
    })
}

pub fn search_resource_by_bvid(
    app: &AppHandle,
    bvid: &str,
) -> Result<Option<BilibiliFavoriteResourceItem>, String> {
    ensure_connector(app)?;
    let auth_cookie = ensure_auth_context(app).ok().map(|context| context.cookie_header);
    let client = build_http_client()?;

    let normalized_bvid = parse_bvid_from_text(bvid)
        .ok_or_else(|| "Invalid Bilibili BV id".to_string())?;

    let data = request_bilibili_data_with_optional_cookie(
        &client,
        BILIBILI_VIEW_ENDPOINT,
        &[("bvid", normalized_bvid.clone())],
        auth_cookie.as_deref(),
        "view",
    )?;

    if data.is_null() {
        return Ok(None);
    }

    let title = to_non_empty_string(data.get("title")).unwrap_or_else(|| normalized_bvid.clone());
    let owner_name = data
        .get("owner")
        .and_then(|owner| to_non_empty_string(owner.get("name")));
    let duration_seconds = to_u64(data.get("duration")).and_then(|value| u32::try_from(value).ok());
    let cover_url = to_non_empty_string(data.get("pic")).map(|url| normalize_url(&url));
    let cid = to_i64(data.get("cid")).map(|value| value.to_string()).or_else(|| {
        data.get("pages")
            .and_then(Value::as_array)
            .and_then(|pages| pages.first())
            .and_then(|page| to_i64(page.get("cid")))
            .map(|value| value.to_string())
    });

    let source_locator = if let Some(value) = cid.clone() {
        format!("bilibili://video/{normalized_bvid}?cid={value}")
    } else {
        format!("bilibili://video/{normalized_bvid}")
    };
    let lyric_locator = cid
        .as_ref()
        .map(|value| format!("bilibili://subtitle?bvid={normalized_bvid}&cid={value}"));

    Ok(Some(BilibiliFavoriteResourceItem {
        resource_id: format!("bvid:{normalized_bvid}"),
        title,
        owner_name,
        duration_seconds,
        cover_url,
        source_locator,
        lyric_locator,
        bvid: Some(normalized_bvid),
        cid,
        content_kind: "video".to_string(),
    }))
}

pub fn prepare_cover_cache(app: &AppHandle, cover_url: &str) -> Result<Option<String>, String> {
    ensure_connector(app)?;

    let normalized_cover_url = normalize_url(cover_url);
    if normalized_cover_url.trim().is_empty() {
        return Ok(None);
    }

    let cache_dirs = ensure_playback_cache_dirs(app)?;
    let cache_key = build_cover_cache_key(&normalized_cover_url);
    if let Some(existing_path) = find_existing_cover_cache_path(&cache_dirs, &cache_key) {
        return Ok(Some(existing_path.to_string_lossy().to_string()));
    }

    let auth_cookie = ensure_auth_context(app).ok().map(|context| context.cookie_header);
    let client = build_http_client()?;

    let mut request = client.get(&normalized_cover_url).header(
        REFERER,
        HeaderValue::from_static("https://www.bilibili.com/"),
    );
    if let Some(cookie_header) = auth_cookie.as_deref() {
        if let Ok(cookie_value) = HeaderValue::from_str(cookie_header) {
            request = request.header(COOKIE, cookie_value);
        }
    }

    let response = request
        .send()
        .map_err(|error| format!("Failed to fetch Bilibili cover image: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "Bilibili cover image returned non-success status: {status}"
        ));
    }

    let mime_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let extension = infer_cover_extension(&normalized_cover_url, mime_type.as_deref());
    let cache_path = build_cover_cache_path(&cache_dirs, &cache_key, &extension);

    let payload = response
        .bytes()
        .map_err(|error| format!("Failed to read Bilibili cover image bytes: {error}"))?;
    fs::write(&cache_path, payload.as_ref())
        .map_err(|error| format!("Failed to write Bilibili cover cache file: {error}"))?;

    Ok(Some(cache_path.to_string_lossy().to_string()))
}

pub fn list_playback_qualities(
    app: &AppHandle,
    source_locator: &str,
) -> Result<Vec<BilibiliPlaybackQualityOption>, String> {
    ensure_connector(app)?;
    let auth_context = ensure_auth_context(app)?;
    let client = build_http_client()?;

    let normalized_source_locator = source_locator.trim();
    if normalized_source_locator.is_empty() {
        return Err("sourceLocator is required".to_string());
    }

    let bvid = parse_bvid_from_text(normalized_source_locator)
        .ok_or_else(|| "Only Bilibili video playback is supported in current MVP".to_string())?;
    let cid = parse_cid_from_text(normalized_source_locator)
        .or_else(|| resolve_video_first_cid(&client, &auth_context.cookie_header, &bvid).ok().flatten())
        .ok_or_else(|| "Failed to resolve cid for Bilibili playback".to_string())?;

    let playurl_data =
        request_video_playurl_data_with_fallback(&client, &auth_context.cookie_header, &bvid, &cid)?;
    Ok(build_playback_quality_options(&playurl_data))
}

pub fn prepare_cached_playback(
    app: &AppHandle,
    source_locator: &str,
    quality_hint: Option<&str>,
) -> Result<BilibiliPlaybackPrepared, String> {
    ensure_connector(app)?;
    let auth_context = ensure_auth_context(app)?;
    let client = build_http_client()?;

    let normalized_source_locator = source_locator.trim();
    if normalized_source_locator.is_empty() {
        return Err("sourceLocator is required".to_string());
    }
    let playback_cookie_header =
        normalize_cookie_header_for_playurl(&client, &auth_context.cookie_header);

    let bvid = parse_bvid_from_text(normalized_source_locator)
        .ok_or_else(|| "Only Bilibili video playback is supported in current MVP".to_string())?;
    let cid = parse_cid_from_text(normalized_source_locator)
        .or_else(|| resolve_video_first_cid(&client, &auth_context.cookie_header, &bvid).ok().flatten())
        .ok_or_else(|| "Failed to resolve cid for Bilibili playback".to_string())?;

    let (selected_stream, duration_seconds, _quality_options) = resolve_video_playback_stream(
        &client,
        &playback_cookie_header,
        &bvid,
        &cid,
        quality_hint,
    )?;
    let stream_url = selected_stream.stream_url.clone();
    let selected_quality_key = selected_stream.quality_key.clone();
    let selected_quality_label = selected_stream.quality_label.clone();
    let referer = format!("https://www.bilibili.com/video/{bvid}");

    let cache_dirs = ensure_playback_cache_dirs(app)?;
    let _ = cleanup_stale_incomplete_playback_cache(&cache_dirs, now_ms());
    let _ = prune_completed_playback_cache(&cache_dirs, BILIBILI_PLAYBACK_CACHE_MAX_BYTES);

    let cache_key = build_playback_cache_key(&bvid, &cid, &selected_quality_key);
    let extension = infer_cache_extension(&stream_url, None);
    let cache_path = build_playback_cache_object_path(&cache_dirs, &cache_key, &extension);
    let marker_path = build_playback_cache_marker_path(&cache_dirs, &cache_key);

    let mime_type = None;
    let mut active_job: Option<Arc<BilibiliPlaybackDownloadJob>> = None;
    let cache_ready = is_playback_cache_file_ready(&cache_path, &marker_path);
    if !cache_ready {
        let job = spawn_or_get_playback_download_job(
            &cache_key,
            cache_path.clone(),
            marker_path.clone(),
            stream_url.clone(),
            playback_cookie_header.clone(),
            referer,
        )?;
        active_job = Some(job.clone());

        let state = wait_for_playback_prebuffer(
            &job,
            BILIBILI_PLAYBACK_CACHE_PREBUFFER_BYTES,
            Duration::from_millis(BILIBILI_PLAYBACK_CACHE_WAIT_TIMEOUT_MS),
        )?;
        let ready_bytes = fs::metadata(&cache_path)
            .ok()
            .map(|meta| meta.len())
            .unwrap_or(state.bytes_written);
        if ready_bytes == 0 {
            return Err("Bilibili stream prebuffer failed before any cache bytes were ready".to_string());
        }
    }

    if !can_probe_playback_cache(&cache_path) {
        if let Some(job) = active_job.as_ref() {
            let state = wait_for_playback_prebuffer(
                &job,
                BILIBILI_PLAYBACK_CACHE_PROBE_SOFT_BYTES,
                Duration::from_millis(BILIBILI_PLAYBACK_CACHE_PROBE_SOFT_WAIT_MS),
            )?;

            if state.completed && !can_probe_playback_cache(&cache_path) {
                return Err(
                    "Bilibili playback cache download completed but remains undecodable"
                        .to_string(),
                );
            }
        } else {
            return Err(
                "Bilibili playback cache exists but is not decodable; please refresh and retry"
                    .to_string(),
            );
        }
    }

    Ok(BilibiliPlaybackPrepared {
        source_locator: normalized_source_locator.to_string(),
        stream_url,
        cache_path: cache_path.to_string_lossy().to_string(),
        mime_type,
        duration_seconds,
        content_kind: "video".to_string(),
        selected_quality_key,
        selected_quality_label,
    })
}

pub fn resolve_lyric_locator(
    app: &AppHandle,
    lyric_locator: &str,
) -> Result<Option<BilibiliLyricLocatorRef>, String> {
    ensure_connector(app)?;
    let auth_context = ensure_auth_context(app)?;
    let client = build_http_client()?;

    let normalized_locator = lyric_locator.trim();
    if normalized_locator.is_empty() {
        return Ok(None);
    }

    if normalized_locator.starts_with("bilibili://audio-lyric")
        || normalized_locator.starts_with("bilibili://audio/")
    {
        if let Some(sid) = parse_sid_from_text(normalized_locator) {
            return resolve_audio_lyric_locator(&client, &auth_context.cookie_header, &sid);
        }
        return Ok(None);
    }

    if normalized_locator.starts_with("bilibili://subtitle")
        || normalized_locator.starts_with("bilibili://video/")
        || normalized_locator.contains("bilibili.com/video/")
    {
        let Some(bvid) = parse_bvid_from_text(normalized_locator) else {
            return Ok(None);
        };

        let cid = if let Some(value) = parse_cid_from_text(normalized_locator) {
            Some(value)
        } else {
            resolve_video_first_cid(&client, &auth_context.cookie_header, &bvid)?
        };
        let Some(cid) = cid else {
            return Ok(None);
        };

        return resolve_video_subtitle_locator(&client, &auth_context.cookie_header, &bvid, &cid);
    }

    if let Some(sid) = parse_sid_from_text(normalized_locator) {
        return resolve_audio_lyric_locator(&client, &auth_context.cookie_header, &sid);
    }

    if let Some(bvid) = parse_bvid_from_text(normalized_locator) {
        let cid = parse_cid_from_text(normalized_locator)
            .or_else(|| resolve_video_first_cid(&client, &auth_context.cookie_header, &bvid).ok().flatten());
        let Some(cid) = cid else {
            return Ok(None);
        };
        return resolve_video_subtitle_locator(&client, &auth_context.cookie_header, &bvid, &cid);
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::{
        build_stream_candidates,
        build_wbi_mixin_key,
        parse_bvid_from_text,
        sanitize_wbi_query_value,
        QUALITY_KEY_DOLBY,
        QUALITY_KEY_HIRES,
    };
    use serde_json::json;

    #[test]
    fn parse_plain_bvid_text() {
        let parsed = parse_bvid_from_text("BV1xx411c7mD");
        assert_eq!(parsed.as_deref(), Some("BV1xx411c7mD"));
    }

    #[test]
    fn parse_lowercase_bv_prefix() {
        let parsed = parse_bvid_from_text("bv1xx411c7mD");
        assert_eq!(parsed.as_deref(), Some("BV1xx411c7mD"));
    }

    #[test]
    fn parse_bilibili_video_url() {
        let parsed = parse_bvid_from_text("https://www.bilibili.com/video/BV1xx411c7mD?p=1");
        assert_eq!(parsed.as_deref(), Some("BV1xx411c7mD"));
    }

    #[test]
    fn parse_bvid_from_query_param() {
        let parsed = parse_bvid_from_text("https://example.test/player?foo=1&bvid=BV1xx411c7mD");
        assert_eq!(parsed.as_deref(), Some("BV1xx411c7mD"));
    }

    #[test]
    fn parse_invalid_bvid_returns_none() {
        assert_eq!(parse_bvid_from_text("BV1xx41"), None);
        assert_eq!(parse_bvid_from_text("https://www.bilibili.com/video/"), None);
        assert_eq!(parse_bvid_from_text(""), None);
    }

    #[test]
    fn build_stream_candidates_detects_hires_from_dash_flac_audio() {
        let payload = json!({
            "dash": {
                "audio": [
                    {
                        "id": 30280,
                        "baseUrl": "https://example.test/audio-192k.m4a",
                        "bandwidth": 192000
                    }
                ],
                "flac": {
                    "audio": {
                        "base_url": "https://example.test/audio-hires.flac",
                        "bandwidth": 720000,
                        "codecs": "fLaC"
                    }
                }
            }
        });

        let candidates = build_stream_candidates(&payload);
        assert!(
            candidates.iter().any(|item| item.quality_key == QUALITY_KEY_HIRES),
            "expected hires candidate from dash.flac.audio"
        );
    }

    #[test]
    fn build_stream_candidates_detects_dolby_from_dash_dolby_audio() {
        let payload = json!({
            "dash": {
                "audio": [
                    {
                        "id": 30232,
                        "baseUrl": "https://example.test/audio-132k.m4a",
                        "bandwidth": 132000
                    }
                ],
                "dolby": {
                    "audio": [
                        {
                            "baseUrl": "https://example.test/audio-dolby.ec3",
                            "bandwidth": 384000,
                            "codecs": "ec-3"
                        }
                    ]
                }
            }
        });

        let candidates = build_stream_candidates(&payload);
        assert!(
            candidates.iter().any(|item| item.quality_key == QUALITY_KEY_DOLBY),
            "expected dolby candidate from dash.dolby.audio"
        );
    }

    #[test]
    fn build_wbi_mixin_key_outputs_32_chars() {
        let img_key = "7cd084941338484aae1ad9425b84077c";
        let sub_key = "4932caff0ff746eab6f01bf08b70ac45";
        let mixin = build_wbi_mixin_key(img_key, sub_key).expect("mixin should be generated");
        assert_eq!(mixin.chars().count(), 32);
    }

    #[test]
    fn sanitize_wbi_query_value_removes_filtered_symbols() {
        let sanitized = sanitize_wbi_query_value("a!b'c(d)e*f");
        assert_eq!(sanitized, "abcdef");
    }
}
