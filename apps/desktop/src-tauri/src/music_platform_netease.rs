use keyring::Entry;
use once_cell::sync::Lazy;
use reqwest::blocking::Client;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;
use url::Url;

const NETEASE_CONNECTOR_ID: &str = "connector.platform.netease";
const NETEASE_CONNECTOR_KIND: &str = "platform";
const NETEASE_CONNECTOR_DRIVER: &str = "netease-api-enhanced";
const NETEASE_CONNECTOR_DISPLAY_NAME: &str = "Netease Cloud Music";
const NETEASE_CONNECTOR_STATUS_ACTIVE: &str = "active";

const NETEASE_API_BASE_URL_ENV: &str = "PMP_NETEASE_API_BASE_URL";
const NETEASE_API_BASE_URL_DEFAULT: &str = "http://127.0.0.1:3000";

const NETEASE_KEYRING_SERVICE: &str = "pixel-matrix-player.netease";
const NETEASE_KEYRING_TOKEN_REF_PREFIX: &str = "keyring://netease-cookie/";

const NETEASE_QR_KEY_ENDPOINT: &str = "/login/qr/key";
const NETEASE_QR_CREATE_ENDPOINT: &str = "/login/qr/create";
const NETEASE_QR_CHECK_ENDPOINT: &str = "/login/qr/check";
const NETEASE_LOGIN_STATUS_ENDPOINT: &str = "/login/status";
const NETEASE_RECOMMEND_SONGS_ENDPOINT: &str = "/recommend/songs";
const NETEASE_RECOMMEND_PLAYLISTS_ENDPOINT: &str = "/recommend/resource";
const NETEASE_USER_PLAYLISTS_ENDPOINT: &str = "/user/playlist";
const NETEASE_PLAYLIST_TRACKS_ENDPOINT: &str = "/playlist/track/all";
const NETEASE_CLOUDSEARCH_ENDPOINT: &str = "/cloudsearch";
const NETEASE_SONG_URL_ENDPOINT: &str = "/song/url";

const QR_SESSION_TTL_MS: i64 = 180_000;
const NETEASE_PLAYBACK_CACHE_DIR_NAME: &str = "playback-cache";
const NETEASE_PLAYBACK_CACHE_BR: i64 = 320_000;

const AUTH_AVAILABILITY_AVAILABLE: &str = "available";
const AUTH_AVAILABILITY_DEGRADED: &str = "degraded";
const AUTH_AVAILABILITY_UNAVAILABLE: &str = "unavailable";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeteaseQrCodeSession {
    pub connector_id: String,
    pub session_id: String,
    pub qr_key: String,
    pub qr_url: String,
    pub qr_image_data_url: String,
    pub generated_at_ms: i64,
    pub expires_at_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeteaseQrPollResult {
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
pub struct NeteaseAuthStatus {
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
pub struct NeteaseUserPlaylist {
    pub playlist_id: String,
    pub title: String,
    pub track_count: u64,
    pub cover_url: Option<String>,
    pub updated_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeteaseRecommendedPlaylist {
    pub playlist_id: String,
    pub title: String,
    pub track_count: u64,
    pub cover_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeteaseSongItem {
    pub song_id: String,
    pub title: String,
    pub artist_names: String,
    pub album_name: Option<String>,
    pub duration_seconds: Option<u32>,
    pub cover_url: Option<String>,
    pub source_locator: String,
    pub web_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeteaseSongPage {
    pub source_kind: String,
    pub source_id: String,
    pub page_num: u32,
    pub page_size: u32,
    pub total: u64,
    pub has_more: bool,
    pub items: Vec<NeteaseSongItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeteasePlaybackPrepared {
    pub source_locator: String,
    pub stream_url: String,
    pub cache_path: String,
    pub mime_type: Option<String>,
    pub duration_seconds: Option<u32>,
    pub song_id: String,
}

#[derive(Debug, Clone)]
struct QrSessionState {
    qr_key: String,
    expires_at_ms: i64,
}

#[derive(Debug, Clone)]
struct AuthCookieState {
    cookie_header: String,
}

#[derive(Debug, Clone)]
struct AuthContext {
    account: crate::music_library_db::LibraryConnectorAccountRecord,
    cookie_header: String,
}

static QR_SESSIONS: Lazy<Mutex<HashMap<String, QrSessionState>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static AUTH_COOKIE_STATE: Lazy<Mutex<Option<AuthCookieState>>> = Lazy::new(|| Mutex::new(None));

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

fn lock_qr_sessions() -> Result<MutexGuard<'static, HashMap<String, QrSessionState>>, String> {
    QR_SESSIONS
        .lock()
        .map_err(|_| "Netease QR session store is locked".to_string())
}

fn lock_auth_cookie_state() -> Result<MutexGuard<'static, Option<AuthCookieState>>, String> {
    AUTH_COOKIE_STATE
        .lock()
        .map_err(|_| "Netease auth cookie store is locked".to_string())
}

fn cleanup_expired_qr_sessions(now: i64) {
    if let Ok(mut sessions) = lock_qr_sessions() {
        sessions.retain(|_, session| session.expires_at_ms > now);
    }
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

fn normalize_url(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix("//") {
        return format!("https://{rest}");
    }
    if let Some(rest) = trimmed.strip_prefix("http://") {
        return format!("https://{rest}");
    }
    trimmed.to_string()
}

fn normalize_api_base_url(raw: &str) -> String {
    let trimmed = raw.trim();
    let normalized = if trimmed.is_empty() {
        NETEASE_API_BASE_URL_DEFAULT
    } else {
        trimmed
    };
    normalized.trim_end_matches('/').to_string()
}

fn resolve_api_base_url() -> String {
    std::env::var(NETEASE_API_BASE_URL_ENV)
        .ok()
        .map(|value| normalize_api_base_url(&value))
        .unwrap_or_else(|| NETEASE_API_BASE_URL_DEFAULT.to_string())
}

fn build_http_client() -> Result<Client, String> {
    Client::builder()
        .user_agent("PixelMatrixPlayer/1.0 (+https://github.com/pxh52013145/PMP)")
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Failed to build Netease HTTP client: {error}"))
}

fn ensure_connector(app: &AppHandle) -> Result<(), String> {
    crate::music_library_db::ensure_connector(
        app,
        NETEASE_CONNECTOR_ID,
        NETEASE_CONNECTOR_KIND,
        NETEASE_CONNECTOR_DRIVER,
        Some(NETEASE_CONNECTOR_DISPLAY_NAME),
        Some(NETEASE_CONNECTOR_STATUS_ACTIVE),
    )
}

fn request_api_json(
    client: &Client,
    endpoint: &str,
    mut query: Vec<(&'static str, String)>,
    cookie_header: Option<&str>,
    context: &str,
) -> Result<Value, String> {
    if let Some(cookie_header) = cookie_header {
        let normalized_cookie = cookie_header.trim();
        if !normalized_cookie.is_empty() {
            query.push(("cookie", normalized_cookie.to_string()));
        }
    }

    let base_url = resolve_api_base_url();
    let url = format!("{base_url}{}", endpoint.trim());
    let response = client
        .get(url)
        .query(&query)
        .send()
        .map_err(|error| format!("Netease {context} request failed: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "Netease {context} returned non-success status: {status}"
        ));
    }

    response
        .json::<Value>()
        .map_err(|error| format!("Failed to decode Netease {context} payload: {error}"))
}

fn to_non_empty_string(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(raw)) => {
            let normalized = raw.trim();
            if normalized.is_empty() {
                None
            } else {
                Some(normalized.to_string())
            }
        }
        Some(Value::Number(number)) => Some(number.to_string()),
        _ => None,
    }
}

fn to_i64(value: Option<&Value>) -> Option<i64> {
    value.and_then(Value::as_i64)
}

fn to_u64(value: Option<&Value>) -> Option<u64> {
    value.and_then(Value::as_u64)
}

fn read_cookie_header_from_keyring_token_ref(token_ref: &str) -> Option<String> {
    let account_id = token_ref
        .strip_prefix(NETEASE_KEYRING_TOKEN_REF_PREFIX)?
        .trim();
    if account_id.is_empty() {
        return None;
    }

    let entry = Entry::new(NETEASE_KEYRING_SERVICE, account_id).ok()?;
    let cookie = entry.get_password().ok()?;
    let normalized = cookie.trim();
    if normalized.is_empty() {
        return None;
    }

    Some(normalized.to_string())
}

fn write_cookie_header_to_keyring(account_id: &str, cookie_header: &str) -> Result<String, String> {
    let normalized_account_id = account_id.trim();
    let normalized_cookie = cookie_header.trim();
    if normalized_account_id.is_empty() {
        return Err("Netease keyring account id is empty".to_string());
    }
    if normalized_cookie.is_empty() {
        return Err("Netease cookie header is empty".to_string());
    }

    let entry = Entry::new(NETEASE_KEYRING_SERVICE, normalized_account_id)
        .map_err(|error| format!("Failed to create Netease keyring entry: {error}"))?;
    entry
        .set_password(normalized_cookie)
        .map_err(|error| format!("Failed to store Netease credential in keyring: {error}"))?;

    Ok(format!(
        "{NETEASE_KEYRING_TOKEN_REF_PREFIX}{normalized_account_id}"
    ))
}

fn delete_cookie_header_from_keyring_token_ref(token_ref: &str) {
    let Some(account_id) = token_ref
        .strip_prefix(NETEASE_KEYRING_TOKEN_REF_PREFIX)
        .map(str::trim)
    else {
        return;
    };

    if account_id.is_empty() {
        return;
    }

    if let Ok(entry) = Entry::new(NETEASE_KEYRING_SERVICE, account_id) {
        let _ = entry.delete_password();
    }
}

fn parse_qr_poll_state(code: i64, message: &str) -> (String, String, bool) {
    match code {
        801 => ("pending_scan".to_string(), "pending".to_string(), false),
        802 => ("pending_confirm".to_string(), "pending".to_string(), false),
        800 => ("expired".to_string(), "expired".to_string(), true),
        803 => ("authorized".to_string(), "authorized".to_string(), true),
        _ => {
            let normalized_message = message.trim().to_ascii_lowercase();
            let auth_state = if normalized_message.contains("expired") {
                "expired"
            } else {
                "error"
            };
            ("failed".to_string(), auth_state.to_string(), true)
        }
    }
}

fn extract_account_uid_from_login_status(payload: &Value) -> Option<String> {
    let data = payload.get("data").unwrap_or(payload);
    to_u64(data.get("profile").and_then(|profile| profile.get("userId")))
        .map(|value| value.to_string())
        .or_else(|| {
            to_u64(data.get("account").and_then(|account| account.get("id")))
                .map(|value| value.to_string())
        })
        .or_else(|| {
            to_non_empty_string(data.get("profile").and_then(|profile| profile.get("userId")))
        })
}

fn extract_login_status_message(payload: &Value) -> Option<String> {
    let data = payload.get("data").unwrap_or(payload);
    to_non_empty_string(data.get("message")).or_else(|| to_non_empty_string(payload.get("message")))
}

fn fetch_login_status_payload(client: &Client, cookie_header: &str) -> Result<Value, String> {
    request_api_json(
        client,
        NETEASE_LOGIN_STATUS_ENDPOINT,
        vec![("timestamp", now_ms().to_string())],
        Some(cookie_header),
        "login status",
    )
}

fn fetch_account_uid_and_persist(
    app: &AppHandle,
    account: &crate::music_library_db::LibraryConnectorAccountRecord,
    cookie_header: &str,
) -> Result<String, String> {
    if let Some(account_uid) = account
        .account_uid
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(account_uid.to_string());
    }

    let client = build_http_client()?;
    let payload = fetch_login_status_payload(&client, cookie_header)?;
    let account_uid = extract_account_uid_from_login_status(&payload)
        .ok_or_else(|| "Netease login status did not expose account uid".to_string())?;

    let _ = crate::music_library_db::upsert_connector_account(
        app,
        crate::music_library_db::LibraryConnectorAccountUpsertInput {
            id: account.id.clone(),
            connector_id: NETEASE_CONNECTOR_ID.to_string(),
            account_uid: Some(account_uid.clone()),
            auth_state: "authorized".to_string(),
            token_ref: account.token_ref.clone(),
            refresh_token_ref: account.refresh_token_ref.clone(),
            expires_at_ms: account.expires_at_ms,
            created_at_ms: Some(account.created_at_ms),
            updated_at_ms: Some(now_ms()),
        },
    );

    Ok(account_uid)
}

fn ensure_auth_context(app: &AppHandle) -> Result<AuthContext, String> {
    let account = crate::music_library_db::get_latest_connector_account_by_connector_id(
        app,
        NETEASE_CONNECTOR_ID,
    )?
    .ok_or_else(|| "Netease connector is not authorized".to_string())?;

    if !account.auth_state.eq_ignore_ascii_case("authorized") {
        return Err("Netease connector is not authorized".to_string());
    }

    let cookie_header = get_auth_cookie_header()
        .or_else(|| {
            account
                .token_ref
                .as_deref()
                .and_then(read_cookie_header_from_keyring_token_ref)
        })
        .ok_or_else(|| {
            "Netease login token is unavailable in current session, please scan QR again"
                .to_string()
        })?;

    set_auth_cookie_state(cookie_header.clone());

    Ok(AuthContext {
        account,
        cookie_header,
    })
}

fn build_song_source_locator(song_id: &str) -> String {
    format!("netease://song/{}", song_id.trim())
}

fn build_song_web_url(song_id: &str) -> String {
    format!("https://music.163.com/#/song?id={}", song_id.trim())
}

fn parse_song_id_from_source_locator(source_locator: &str) -> Option<String> {
    let normalized = source_locator.trim();
    if let Some(song_id) = normalized.strip_prefix("netease://song/") {
        let song_id = song_id.trim();
        if !song_id.is_empty() {
            return Some(song_id.to_string());
        }
    }

    if let Ok(parsed) = Url::parse(normalized) {
        if let Some(song_id) = parsed
            .query_pairs()
            .find_map(|(key, value)| {
                if key.eq_ignore_ascii_case("id") {
                    Some(value.to_string())
                } else {
                    None
                }
            })
            .filter(|value| !value.trim().is_empty())
        {
            return Some(song_id);
        }
    }

    None
}

fn parse_song_artist_names(song: &Value) -> String {
    let candidates = song
        .get("ar")
        .and_then(Value::as_array)
        .or_else(|| song.get("artists").and_then(Value::as_array))
        .cloned()
        .unwrap_or_default();

    let names: Vec<String> = candidates
        .iter()
        .filter_map(|artist| to_non_empty_string(artist.get("name")))
        .collect();
    if names.is_empty() {
        "Netease Cloud Music".to_string()
    } else {
        names.join(" / ")
    }
}

fn parse_song_album_name(song: &Value) -> Option<String> {
    to_non_empty_string(song.get("al").and_then(|album| album.get("name")))
        .or_else(|| to_non_empty_string(song.get("album").and_then(|album| album.get("name"))))
}

fn parse_song_cover_url(song: &Value) -> Option<String> {
    to_non_empty_string(song.get("al").and_then(|album| album.get("picUrl")))
        .or_else(|| to_non_empty_string(song.get("album").and_then(|album| album.get("picUrl"))))
        .map(|url| normalize_url(&url))
}

fn parse_song_duration_seconds(song: &Value) -> Option<u32> {
    to_u64(song.get("dt"))
        .map(|value| (value / 1000) as u32)
        .or_else(|| to_u64(song.get("duration")).map(|value| (value / 1000) as u32))
}

fn map_song_item(song: &Value) -> Option<NeteaseSongItem> {
    let song_id = to_u64(song.get("id"))
        .map(|value| value.to_string())
        .or_else(|| to_non_empty_string(song.get("id")))?;
    let title = to_non_empty_string(song.get("name"))?;

    Some(NeteaseSongItem {
        song_id: song_id.clone(),
        title,
        artist_names: parse_song_artist_names(song),
        album_name: parse_song_album_name(song),
        duration_seconds: parse_song_duration_seconds(song),
        cover_url: parse_song_cover_url(song),
        source_locator: build_song_source_locator(&song_id),
        web_url: build_song_web_url(&song_id),
    })
}

fn ensure_playback_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path_resolver()
        .app_cache_dir()
        .ok_or_else(|| "Failed to resolve app cache directory for Netease playback cache".to_string())?
        .join("music-platform")
        .join("netease")
        .join(NETEASE_PLAYBACK_CACHE_DIR_NAME);
    fs::create_dir_all(&root)
        .map_err(|error| format!("Failed to create Netease playback cache directory: {error}"))?;
    Ok(root)
}

fn infer_file_extension(download_url: &str, content_type: Option<&str>) -> String {
    if let Ok(parsed) = Url::parse(download_url) {
        if let Some(segment) = parsed.path_segments().and_then(|segments| segments.last()) {
            let path = Path::new(segment);
            if let Some(extension) = path.extension().and_then(|extension| extension.to_str()) {
                let normalized = extension.trim().to_ascii_lowercase();
                if !normalized.is_empty() {
                    return normalized;
                }
            }
        }
    }

    if let Some(content_type) = content_type {
        let normalized = content_type.to_ascii_lowercase();
        if normalized.contains("aac") {
            return "aac".to_string();
        }
        if normalized.contains("flac") {
            return "flac".to_string();
        }
        if normalized.contains("ogg") {
            return "ogg".to_string();
        }
        if normalized.contains("wav") {
            return "wav".to_string();
        }
    }

    "mp3".to_string()
}

fn download_song_to_cache(
    client: &Client,
    app: &AppHandle,
    song_id: &str,
    bitrate: i64,
    download_url: &str,
) -> Result<(PathBuf, Option<String>), String> {
    let cache_dir = ensure_playback_cache_dir(app)?;
    let response = client
        .get(download_url)
        .send()
        .map_err(|error| format!("Failed to download Netease playback stream: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "Netease playback stream returned non-success status: {status}"
        ));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let extension = infer_file_extension(download_url, content_type.as_deref());
    let final_path = cache_dir.join(format!("{song_id}-{bitrate}.{extension}"));
    if final_path.is_file() {
        return Ok((final_path, content_type));
    }

    let temp_path = final_path.with_extension(format!("{extension}.download"));
    let bytes = response
        .bytes()
        .map_err(|error| format!("Failed to read Netease playback stream bytes: {error}"))?;
    let mut file = fs::File::create(&temp_path)
        .map_err(|error| format!("Failed to create Netease playback cache file: {error}"))?;
    file.write_all(&bytes)
        .map_err(|error| format!("Failed to write Netease playback cache file: {error}"))?;
    file.flush()
        .map_err(|error| format!("Failed to flush Netease playback cache file: {error}"))?;

    fs::rename(&temp_path, &final_path)
        .map_err(|error| format!("Failed to finalize Netease playback cache file: {error}"))?;
    Ok((final_path, content_type))
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    ensure_connector(app)?;

    if let Some(account) = crate::music_library_db::get_latest_connector_account_by_connector_id(
        app,
        NETEASE_CONNECTOR_ID,
    )? {
        if account.auth_state.eq_ignore_ascii_case("authorized") {
            if let Some(cookie_header) = account
                .token_ref
                .as_deref()
                .and_then(read_cookie_header_from_keyring_token_ref)
            {
                set_auth_cookie_state(cookie_header);
            }
        }
    }

    Ok(())
}

pub fn qr_generate(app: &AppHandle) -> Result<NeteaseQrCodeSession, String> {
    ensure_connector(app)?;
    cleanup_expired_qr_sessions(now_ms());

    let client = build_http_client()?;
    let key_payload = request_api_json(
        &client,
        NETEASE_QR_KEY_ENDPOINT,
        vec![("timestamp", now_ms().to_string())],
        None,
        "qr key",
    )?;
    let qr_key = to_non_empty_string(
        key_payload
            .get("data")
            .and_then(|data| data.get("data"))
            .and_then(|data| data.get("unikey")),
    )
    .or_else(|| to_non_empty_string(key_payload.get("data").and_then(|data| data.get("unikey"))))
    .ok_or_else(|| "Netease QR key response missing unikey".to_string())?;

    let created_payload = request_api_json(
        &client,
        NETEASE_QR_CREATE_ENDPOINT,
        vec![
            ("timestamp", now_ms().to_string()),
            ("key", qr_key.clone()),
            ("qrimg", "1".to_string()),
            ("platform", "pc".to_string()),
        ],
        None,
        "qr create",
    )?;
    let qr_data = created_payload
        .get("data")
        .and_then(|data| data.get("data"))
        .or_else(|| created_payload.get("data"))
        .unwrap_or(&Value::Null);
    let qr_url = to_non_empty_string(qr_data.get("qrurl"))
        .ok_or_else(|| "Netease QR create response missing qrurl".to_string())?;
    let qr_image_data_url = to_non_empty_string(qr_data.get("qrimg")).unwrap_or_default();

    let generated_at_ms = now_ms();
    let expires_at_ms = generated_at_ms.saturating_add(QR_SESSION_TTL_MS);
    let session_id = qr_key.clone();

    {
        let mut sessions = lock_qr_sessions()?;
        sessions.insert(
            session_id.clone(),
            QrSessionState {
                qr_key: qr_key.clone(),
                expires_at_ms,
            },
        );
    }

    Ok(NeteaseQrCodeSession {
        connector_id: NETEASE_CONNECTOR_ID.to_string(),
        session_id,
        qr_key,
        qr_url,
        qr_image_data_url,
        generated_at_ms,
        expires_at_ms,
    })
}

pub fn qr_poll(app: &AppHandle, session_id: &str) -> Result<NeteaseQrPollResult, String> {
    ensure_connector(app)?;
    cleanup_expired_qr_sessions(now_ms());

    let normalized_session_id = session_id.trim();
    if normalized_session_id.is_empty() {
        return Err("Netease QR poll requires sessionId".to_string());
    }

    let session = {
        let sessions = lock_qr_sessions()?;
        sessions
            .get(normalized_session_id)
            .cloned()
            .ok_or_else(|| format!("Netease QR session not found: {normalized_session_id}"))?
    };

    let now = now_ms();
    if now >= session.expires_at_ms {
        if let Ok(mut sessions) = lock_qr_sessions() {
            sessions.remove(normalized_session_id);
        }
        return Ok(NeteaseQrPollResult {
            connector_id: NETEASE_CONNECTOR_ID.to_string(),
            session_id: normalized_session_id.to_string(),
            state: "expired".to_string(),
            state_code: 800,
            state_message: "QR code expired".to_string(),
            auth_state: "expired".to_string(),
            account_uid: None,
            expires_at_ms: Some(session.expires_at_ms),
        });
    }

    let client = build_http_client()?;
    let payload = request_api_json(
        &client,
        NETEASE_QR_CHECK_ENDPOINT,
        vec![
            ("timestamp", now_ms().to_string()),
            ("key", session.qr_key.clone()),
        ],
        None,
        "qr poll",
    )?;
    let state_code = to_i64(payload.get("code")).unwrap_or(500);
    let state_message =
        to_non_empty_string(payload.get("message")).unwrap_or_else(|| "unknown state".to_string());
    let (state, auth_state, terminal) = parse_qr_poll_state(state_code, &state_message);
    let cookie_header = to_non_empty_string(payload.get("cookie"));

    let account_uid = if auth_state == "authorized" {
        if let Some(cookie_header) = cookie_header {
            let profile_payload = fetch_login_status_payload(&client, &cookie_header)?;
            let account_uid = extract_account_uid_from_login_status(&profile_payload);
            let account_id = format!(
                "{}::{}",
                NETEASE_CONNECTOR_ID,
                account_uid
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or(normalized_session_id)
            );
            let token_ref = write_cookie_header_to_keyring(&account_id, &cookie_header)?;
            set_auth_cookie_state(cookie_header);

            let _ = crate::music_library_db::upsert_connector_account(
                app,
                crate::music_library_db::LibraryConnectorAccountUpsertInput {
                    id: account_id,
                    connector_id: NETEASE_CONNECTOR_ID.to_string(),
                    account_uid: account_uid.clone(),
                    auth_state: "authorized".to_string(),
                    token_ref: Some(token_ref),
                    refresh_token_ref: None,
                    expires_at_ms: None,
                    created_at_ms: None,
                    updated_at_ms: Some(now_ms()),
                },
            );

            account_uid
        } else {
            None
        }
    } else {
        None
    };

    if terminal {
        if let Ok(mut sessions) = lock_qr_sessions() {
            sessions.remove(normalized_session_id);
        }
    }

    Ok(NeteaseQrPollResult {
        connector_id: NETEASE_CONNECTOR_ID.to_string(),
        session_id: normalized_session_id.to_string(),
        state,
        state_code,
        state_message,
        auth_state,
        account_uid,
        expires_at_ms: Some(session.expires_at_ms),
    })
}

pub fn get_auth_status(app: &AppHandle) -> Result<NeteaseAuthStatus, String> {
    ensure_connector(app)?;

    let account = crate::music_library_db::get_latest_connector_account_by_connector_id(
        app,
        NETEASE_CONNECTOR_ID,
    )?;
    let Some(account) = account else {
        return Ok(NeteaseAuthStatus {
            connector_id: NETEASE_CONNECTOR_ID.to_string(),
            auth_state: "unauthorized".to_string(),
            account_uid: None,
            updated_at_ms: None,
            expires_at_ms: None,
            availability: Some(AUTH_AVAILABILITY_UNAVAILABLE.to_string()),
            availability_message: Some("Netease connector is not logged in".to_string()),
        });
    };

    let mut auth_state = if account.auth_state.trim().is_empty() {
        "unauthorized".to_string()
    } else {
        account.auth_state.trim().to_ascii_lowercase()
    };
    let mut account_uid = account.account_uid.clone();
    let mut availability = Some(AUTH_AVAILABILITY_UNAVAILABLE.to_string());
    let mut availability_message = None;
    let mut updated_at_ms = Some(account.updated_at_ms);

    if auth_state == "authorized" {
        let cookie_header = get_auth_cookie_header().or_else(|| {
            account
                .token_ref
                .as_deref()
                .and_then(read_cookie_header_from_keyring_token_ref)
        });

        if let Some(cookie_header) = cookie_header {
            set_auth_cookie_state(cookie_header.clone());
            let client = build_http_client()?;
            match fetch_login_status_payload(&client, &cookie_header) {
                Ok(payload) => {
                    let data = payload.get("data").unwrap_or(&payload);
                    let status_code = to_i64(data.get("code"))
                        .or_else(|| to_i64(payload.get("code")))
                        .unwrap_or(500);

                    if status_code == 200 {
                        availability = Some(AUTH_AVAILABILITY_AVAILABLE.to_string());
                        if let Some(next_uid) = extract_account_uid_from_login_status(&payload) {
                            if account_uid.as_deref() != Some(next_uid.as_str()) {
                                account_uid = Some(next_uid.clone());
                                let _ = crate::music_library_db::upsert_connector_account(
                                    app,
                                    crate::music_library_db::LibraryConnectorAccountUpsertInput {
                                        id: account.id.clone(),
                                        connector_id: NETEASE_CONNECTOR_ID.to_string(),
                                        account_uid: Some(next_uid),
                                        auth_state: "authorized".to_string(),
                                        token_ref: account.token_ref.clone(),
                                        refresh_token_ref: account.refresh_token_ref.clone(),
                                        expires_at_ms: account.expires_at_ms,
                                        created_at_ms: Some(account.created_at_ms),
                                        updated_at_ms: Some(now_ms()),
                                    },
                                );
                                updated_at_ms = Some(now_ms());
                            }
                        }
                    } else {
                        auth_state = "expired".to_string();
                        availability = Some(AUTH_AVAILABILITY_UNAVAILABLE.to_string());
                        availability_message = extract_login_status_message(&payload)
                            .or_else(|| Some(format!("Netease login status failed with code {status_code}")));
                    }
                }
                Err(error) => {
                    availability = Some(AUTH_AVAILABILITY_DEGRADED.to_string());
                    availability_message = Some(error);
                }
            }
        } else {
            auth_state = "expired".to_string();
            availability = Some(AUTH_AVAILABILITY_UNAVAILABLE.to_string());
            availability_message = Some(
                "Netease login token is unavailable in current session, please scan QR again"
                    .to_string(),
            );
        }
    } else if auth_state == "pending" {
        availability = Some(AUTH_AVAILABILITY_DEGRADED.to_string());
        availability_message = Some("Waiting for Netease QR confirmation".to_string());
    } else if auth_state == "revoked" {
        availability = Some(AUTH_AVAILABILITY_UNAVAILABLE.to_string());
        availability_message = Some("Netease connector session revoked".to_string());
    } else if auth_state == "expired" {
        availability = Some(AUTH_AVAILABILITY_UNAVAILABLE.to_string());
        availability_message = Some("Netease login expired, please login again".to_string());
    }

    Ok(NeteaseAuthStatus {
        connector_id: NETEASE_CONNECTOR_ID.to_string(),
        auth_state,
        account_uid,
        updated_at_ms,
        expires_at_ms: account.expires_at_ms,
        availability,
        availability_message,
    })
}

pub fn logout(app: &AppHandle) -> Result<NeteaseAuthStatus, String> {
    ensure_connector(app)?;

    if let Some(account) = crate::music_library_db::get_latest_connector_account_by_connector_id(
        app,
        NETEASE_CONNECTOR_ID,
    )? {
        if let Some(token_ref) = account.token_ref.as_deref() {
            delete_cookie_header_from_keyring_token_ref(token_ref);
        }

        let _ = crate::music_library_db::upsert_connector_account(
            app,
            crate::music_library_db::LibraryConnectorAccountUpsertInput {
                id: account.id,
                connector_id: NETEASE_CONNECTOR_ID.to_string(),
                account_uid: account.account_uid,
                auth_state: "revoked".to_string(),
                token_ref: None,
                refresh_token_ref: None,
                expires_at_ms: None,
                created_at_ms: Some(account.created_at_ms),
                updated_at_ms: Some(now_ms()),
            },
        );
    }

    if let Ok(mut sessions) = lock_qr_sessions() {
        sessions.clear();
    }
    clear_auth_cookie_state();

    get_auth_status(app)
}

pub fn list_user_playlists(app: &AppHandle) -> Result<Vec<NeteaseUserPlaylist>, String> {
    ensure_connector(app)?;
    let auth_context = ensure_auth_context(app)?;
    let account_uid =
        fetch_account_uid_and_persist(app, &auth_context.account, &auth_context.cookie_header)?;
    let client = build_http_client()?;
    let payload = request_api_json(
        &client,
        NETEASE_USER_PLAYLISTS_ENDPOINT,
        vec![
            ("timestamp", now_ms().to_string()),
            ("uid", account_uid),
            ("limit", "200".to_string()),
            ("offset", "0".to_string()),
        ],
        Some(&auth_context.cookie_header),
        "user playlists",
    )?;

    let items = payload
        .get("playlist")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut playlists = Vec::with_capacity(items.len());

    for item in items {
        let playlist_id = to_u64(item.get("id"))
            .map(|value| value.to_string())
            .or_else(|| to_non_empty_string(item.get("id")));
        let title = to_non_empty_string(item.get("name"));
        let Some(playlist_id) = playlist_id else {
            continue;
        };
        let Some(title) = title else {
            continue;
        };

        playlists.push(NeteaseUserPlaylist {
            playlist_id,
            title,
            track_count: to_u64(item.get("trackCount")).unwrap_or(0),
            cover_url: to_non_empty_string(item.get("coverImgUrl")).map(|url| normalize_url(&url)),
            updated_at_ms: to_i64(item.get("updateTime")),
        });
    }

    Ok(playlists)
}

pub fn list_recommended_playlists(
    app: &AppHandle,
) -> Result<Vec<NeteaseRecommendedPlaylist>, String> {
    ensure_connector(app)?;
    let auth_context = ensure_auth_context(app)?;
    let client = build_http_client()?;
    let payload = request_api_json(
        &client,
        NETEASE_RECOMMEND_PLAYLISTS_ENDPOINT,
        vec![("timestamp", now_ms().to_string())],
        Some(&auth_context.cookie_header),
        "recommended playlists",
    )?;

    let items = payload
        .get("recommend")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut playlists = Vec::with_capacity(items.len());

    for item in items {
        let playlist_id = to_u64(item.get("id"))
            .map(|value| value.to_string())
            .or_else(|| to_non_empty_string(item.get("id")));
        let title = to_non_empty_string(item.get("name"));
        let Some(playlist_id) = playlist_id else {
            continue;
        };
        let Some(title) = title else {
            continue;
        };

        playlists.push(NeteaseRecommendedPlaylist {
            playlist_id,
            title,
            track_count: to_u64(item.get("trackCount")).unwrap_or(0),
            cover_url: to_non_empty_string(item.get("picUrl"))
                .or_else(|| to_non_empty_string(item.get("coverImgUrl")))
                .map(|url| normalize_url(&url)),
        });
    }

    Ok(playlists)
}

pub fn list_recommended_songs(app: &AppHandle) -> Result<NeteaseSongPage, String> {
    ensure_connector(app)?;
    let auth_context = ensure_auth_context(app)?;
    let client = build_http_client()?;
    let payload = request_api_json(
        &client,
        NETEASE_RECOMMEND_SONGS_ENDPOINT,
        vec![("timestamp", now_ms().to_string())],
        Some(&auth_context.cookie_header),
        "recommended songs",
    )?;

    let items = payload
        .get("data")
        .and_then(|data| data.get("dailySongs"))
        .and_then(Value::as_array)
        .cloned()
        .or_else(|| payload.get("dailySongs").and_then(Value::as_array).cloned())
        .unwrap_or_default();
    let songs: Vec<NeteaseSongItem> = items.iter().filter_map(map_song_item).collect();
    let total = songs.len() as u64;

    Ok(NeteaseSongPage {
        source_kind: "recommended".to_string(),
        source_id: "recommended".to_string(),
        page_num: 1,
        page_size: total.max(1) as u32,
        total,
        has_more: false,
        items: songs,
    })
}

pub fn list_playlist_tracks(
    app: &AppHandle,
    playlist_id: &str,
) -> Result<NeteaseSongPage, String> {
    ensure_connector(app)?;
    let auth_context = ensure_auth_context(app)?;
    let normalized_playlist_id = playlist_id.trim();
    if normalized_playlist_id.is_empty() {
        return Err("playlistId is required".to_string());
    }

    let client = build_http_client()?;
    let payload = request_api_json(
        &client,
        NETEASE_PLAYLIST_TRACKS_ENDPOINT,
        vec![
            ("timestamp", now_ms().to_string()),
            ("id", normalized_playlist_id.to_string()),
            ("limit", "500".to_string()),
            ("offset", "0".to_string()),
        ],
        Some(&auth_context.cookie_header),
        "playlist tracks",
    )?;

    let items = payload
        .get("songs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let songs: Vec<NeteaseSongItem> = items.iter().filter_map(map_song_item).collect();
    let total = songs.len() as u64;

    Ok(NeteaseSongPage {
        source_kind: "user-playlist".to_string(),
        source_id: normalized_playlist_id.to_string(),
        page_num: 1,
        page_size: total.max(1) as u32,
        total,
        has_more: false,
        items: songs,
    })
}

pub fn search_songs(
    app: &AppHandle,
    keyword: &str,
    page_num: Option<u32>,
    page_size: Option<u32>,
) -> Result<NeteaseSongPage, String> {
    ensure_connector(app)?;
    let auth_context = ensure_auth_context(app)?;
    let normalized_keyword = keyword.trim();
    if normalized_keyword.is_empty() {
        return Err("keyword is required".to_string());
    }

    let normalized_page_num = page_num.unwrap_or(1).clamp(1, 200);
    let normalized_page_size = page_size.unwrap_or(40).clamp(1, 100);
    let offset = (normalized_page_num.saturating_sub(1) * normalized_page_size) as u64;

    let client = build_http_client()?;
    let payload = request_api_json(
        &client,
        NETEASE_CLOUDSEARCH_ENDPOINT,
        vec![
            ("timestamp", now_ms().to_string()),
            ("keywords", normalized_keyword.to_string()),
            ("type", "1".to_string()),
            ("limit", normalized_page_size.to_string()),
            ("offset", offset.to_string()),
        ],
        Some(&auth_context.cookie_header),
        "search songs",
    )?;

    let result = payload.get("result").unwrap_or(&Value::Null);
    let items = result
        .get("songs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let songs: Vec<NeteaseSongItem> = items.iter().filter_map(map_song_item).collect();
    let total = to_u64(result.get("songCount")).unwrap_or(songs.len() as u64);
    let has_more = offset.saturating_add(songs.len() as u64) < total;

    Ok(NeteaseSongPage {
        source_kind: "search".to_string(),
        source_id: normalized_keyword.to_string(),
        page_num: normalized_page_num,
        page_size: normalized_page_size,
        total,
        has_more,
        items: songs,
    })
}

pub fn prepare_cached_playback(
    app: &AppHandle,
    source_locator: &str,
) -> Result<NeteasePlaybackPrepared, String> {
    ensure_connector(app)?;
    let auth_context = ensure_auth_context(app)?;
    let song_id = parse_song_id_from_source_locator(source_locator)
        .ok_or_else(|| "Failed to resolve Netease song id from source locator".to_string())?;

    let client = build_http_client()?;
    let payload = request_api_json(
        &client,
        NETEASE_SONG_URL_ENDPOINT,
        vec![
            ("timestamp", now_ms().to_string()),
            ("id", song_id.clone()),
            ("br", NETEASE_PLAYBACK_CACHE_BR.to_string()),
        ],
        Some(&auth_context.cookie_header),
        "song url",
    )?;

    let stream = payload
        .get("data")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .ok_or_else(|| "Netease song url response missing data item".to_string())?;
    let stream_url = to_non_empty_string(stream.get("url"))
        .ok_or_else(|| "Netease song url response missing playable url".to_string())?;
    let bitrate = to_i64(stream.get("br")).unwrap_or(NETEASE_PLAYBACK_CACHE_BR);
    let duration_seconds = to_u64(stream.get("time")).map(|value| (value / 1000) as u32);
    let (cache_path, mime_type) =
        download_song_to_cache(&client, app, &song_id, bitrate, &stream_url)?;

    Ok(NeteasePlaybackPrepared {
        source_locator: build_song_source_locator(&song_id),
        stream_url,
        cache_path: cache_path.to_string_lossy().to_string(),
        mime_type,
        duration_seconds,
        song_id,
    })
}
