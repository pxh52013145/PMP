use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyInit, KeyIvInit};
use aes::Aes128;
use base64::{
    engine::general_purpose::{STANDARD as BASE64_STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use image::Luma;
use keyring::Entry;
use num_bigint::BigUint;
use once_cell::sync::Lazy;
use qrcode::QrCode;
use rand::Rng;
use reqwest::{
    blocking::Client,
    header::{HeaderMap, HeaderValue, CONTENT_TYPE, COOKIE, REFERER, SET_COOKIE, USER_AGENT},
};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    fs,
    io::{Cursor, Write},
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;
use url::{form_urlencoded::byte_serialize, Url};

const NETEASE_CONNECTOR_ID: &str = "connector.platform.netease";
const NETEASE_CONNECTOR_KIND: &str = "platform";
const NETEASE_CONNECTOR_DRIVER: &str = "netease-web";
const NETEASE_CONNECTOR_DISPLAY_NAME: &str = "Netease Cloud Music";
const NETEASE_CONNECTOR_STATUS_ACTIVE: &str = "active";

const NETEASE_DOMAIN: &str = "https://music.163.com";
const NETEASE_API_DOMAIN: &str = "https://interface.music.163.com";
const NETEASE_WEAPI_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const NETEASE_EAPI_USER_AGENT: &str = "NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)";
const NETEASE_EAPI_KEY: &str = "e82ckenh8dichen8";
const NETEASE_WEAPI_PRESET_KEY: &str = "0CoJUm6Qyw8W8jud";
const NETEASE_WEAPI_IV: &str = "0102030405060708";
const NETEASE_PUBLIC_KEY_MODULUS_B64URL: &str =
    "4LUJ9iWd-GQtvDVmKQFHffImd-wVK1_2is5hW7e3JRUrOrF6h2rqilqnbS5BdinsTuNB9WE1_M9pUoAQTgMS7L2pJVfJOHARSvbJ0FxPfww2hbeka-4lWTJXXM4QtCTYE8_kh10-ggR7l93vUnQdVGuOKJ3Gk1s-zgRi2woiuOc";
const NETEASE_PUBLIC_KEY_EXPONENT: u32 = 65_537;
const NETEASE_PC_OS: &str = "pc";
const NETEASE_PC_APPVER: &str = "3.1.17.204416";
const NETEASE_PC_OSVER: &str = "Microsoft-Windows-10-Professional-build-19045-64bit";
const NETEASE_PC_CHANNEL: &str = "netease";
const NETEASE_COOKIE_VERSION_CODE: &str = "140";
const NETEASE_COOKIE_MOBILENAME: &str = "";
const NETEASE_COOKIE_RESOLUTION: &str = "1920x1080";
const NETEASE_COOKIE_WEVNSM: &str = "1.0.0";
const NETEASE_COOKIE_REMEMBER_ME: &str = "true";
const NETEASE_COOKIE_KAOLA_AD: &str = "1";
const NETEASE_QR_URL_BASE: &str = "https://music.163.com/login?codekey=";

const NETEASE_KEYRING_SERVICE: &str = "pixel-matrix-player.netease";
const NETEASE_KEYRING_TOKEN_REF_PREFIX: &str = "keyring://netease-cookie/";

const NETEASE_QR_KEY_API: &str = "/api/login/qrcode/unikey";
const NETEASE_QR_CHECK_API: &str = "/api/login/qrcode/client/login";
const NETEASE_REGISTER_ANONYMOUS_API: &str = "/api/register/anonimous";
const NETEASE_LOGIN_STATUS_API: &str = "/api/w/nuser/account/get";
const NETEASE_RECOMMEND_SONGS_API: &str = "/api/v3/discovery/recommend/songs";
const NETEASE_RECOMMEND_PLAYLISTS_API: &str = "/api/v1/discovery/recommend/resource";
const NETEASE_USER_PLAYLISTS_API: &str = "/api/user/playlist";
const NETEASE_PLAYLIST_DETAIL_API: &str = "/api/v6/playlist/detail";
const NETEASE_SONG_DETAIL_API: &str = "/api/v3/song/detail";
const NETEASE_CLOUDSEARCH_API: &str = "/api/cloudsearch/pc";
const NETEASE_SONG_URL_API: &str = "/api/song/enhance/player/url";

const QR_SESSION_TTL_MS: i64 = 180_000;
const NETEASE_PLAYBACK_CACHE_DIR_NAME: &str = "playback-cache";
const NETEASE_PLAYBACK_CACHE_BR: i64 = 320_000;
const NETEASE_QR_PLATFORM: &str = "web";
const NETEASE_ANONYMOUS_ID_XOR_KEY: &str = "3go8&$8*3*3h0k(2)2";

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
    cookie_header: Option<String>,
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

#[derive(Debug, Clone)]
struct NeteaseApiResponse {
    body: Value,
    cookie_header: Option<String>,
}

static QR_SESSIONS: Lazy<Mutex<HashMap<String, QrSessionState>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static AUTH_COOKIE_STATE: Lazy<Mutex<Option<AuthCookieState>>> = Lazy::new(|| Mutex::new(None));
static ANONYMOUS_COOKIE_STATE: Lazy<Mutex<Option<AuthCookieState>>> =
    Lazy::new(|| Mutex::new(None));
static NETEASE_SESSION_DEVICE_ID: Lazy<String> = Lazy::new(|| generate_random_hex_string(52, true));
static NETEASE_SESSION_WNMCID: Lazy<String> = Lazy::new(generate_wnmcid);
static NETEASE_SESSION_NTES_NUID: Lazy<String> =
    Lazy::new(|| generate_random_hex_string(64, false));
static NETEASE_SESSION_NTES_NNID: Lazy<String> =
    Lazy::new(|| format!("{},{}", NETEASE_SESSION_NTES_NUID.as_str(), now_ms()));

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

fn lock_anonymous_cookie_state() -> Result<MutexGuard<'static, Option<AuthCookieState>>, String> {
    ANONYMOUS_COOKIE_STATE
        .lock()
        .map_err(|_| "Netease anonymous cookie store is locked".to_string())
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

fn set_anonymous_cookie_state(cookie_header: String) {
    if let Ok(mut state) = lock_anonymous_cookie_state() {
        *state = Some(AuthCookieState { cookie_header });
    }
}

fn get_anonymous_cookie_header() -> Option<String> {
    lock_anonymous_cookie_state()
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

fn truncate_error_text(raw: &str) -> String {
    let normalized = raw.trim();
    if normalized.len() <= 240 {
        return normalized.to_string();
    }
    format!("{}...", &normalized[..240])
}

fn percent_encode_component(value: &str) -> String {
    byte_serialize(value.as_bytes()).collect()
}

fn build_form_urlencoded_body(pairs: &[(&str, String)]) -> String {
    pairs
        .iter()
        .map(|(key, value)| {
            format!(
                "{}={}",
                percent_encode_component(key),
                percent_encode_component(value)
            )
        })
        .collect::<Vec<String>>()
        .join("&")
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
        let value = value.trim().to_string();
        if key.is_empty() || value.is_empty() {
            continue;
        }

        pairs.insert(key, value);
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

fn extract_set_cookie_pairs(headers: &HeaderMap) -> HashMap<String, String> {
    let mut pairs = HashMap::new();
    for value in headers.get_all(SET_COOKIE).iter() {
        let Ok(raw) = value.to_str() else {
            continue;
        };
        let Some(first_segment) = raw.split(';').next() else {
            continue;
        };
        let mut parts = first_segment.splitn(2, '=');
        let Some(name) = parts.next() else {
            continue;
        };
        let Some(cookie_value) = parts.next() else {
            continue;
        };

        let key = name.trim();
        let value = cookie_value.trim();
        if key.is_empty() || value.is_empty() {
            continue;
        }

        pairs.insert(key.to_string(), value.to_string());
    }
    pairs
}

fn merge_cookie_headers(
    base_cookie_header: Option<&str>,
    response_headers: &HeaderMap,
) -> Option<String> {
    let mut pairs = base_cookie_header
        .map(parse_cookie_pairs)
        .unwrap_or_default();
    let response_pairs = extract_set_cookie_pairs(response_headers);
    pairs.extend(response_pairs);

    let normalized = build_cookie_header_from_pairs(&pairs);
    if normalized.trim().is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn generate_random_hex_string(len: usize, uppercase: bool) -> String {
    let alphabet = if uppercase {
        b"0123456789ABCDEF"
    } else {
        b"0123456789abcdef"
    };

    let mut rng = rand::thread_rng();
    let mut output = String::with_capacity(len);
    for _ in 0..len {
        let index = rng.gen_range(0..alphabet.len());
        output.push(alphabet[index] as char);
    }
    output
}

fn generate_random_base62_string(len: usize) -> String {
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = rand::thread_rng();
    let mut output = String::with_capacity(len);
    for _ in 0..len {
        let index = rng.gen_range(0..ALPHABET.len());
        output.push(ALPHABET[index] as char);
    }
    output
}

fn generate_wnmcid() -> String {
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
    let mut rng = rand::thread_rng();
    let mut prefix = String::with_capacity(6);
    for _ in 0..6 {
        let index = rng.gen_range(0..ALPHABET.len());
        prefix.push(ALPHABET[index] as char);
    }
    format!("{prefix}.{}.01.0", now_ms())
}

fn generate_request_id() -> String {
    let mut rng = rand::thread_rng();
    format!(
        "{}_{}",
        now_ms(),
        format!("{:04}", rng.gen_range(0..1000_u32))
    )
}

fn encode_anonymous_device_id(device_id: &str) -> String {
    let xor_key = NETEASE_ANONYMOUS_ID_XOR_KEY.as_bytes();
    let xored: Vec<u8> = device_id
        .as_bytes()
        .iter()
        .enumerate()
        .map(|(index, byte)| byte ^ xor_key[index % xor_key.len()])
        .collect();
    let digest = md5::compute(xored);
    BASE64_STANDARD.encode(digest.0)
}

fn build_anonymous_username() -> String {
    let device_id = NETEASE_SESSION_DEVICE_ID.as_str();
    let encoded = encode_anonymous_device_id(device_id);
    BASE64_STANDARD.encode(format!("{device_id} {encoded}").as_bytes())
}

fn build_netease_request_cookie_pairs(
    cookie_header: Option<&str>,
    api_path: &str,
) -> HashMap<String, String> {
    let mut pairs = cookie_header.map(parse_cookie_pairs).unwrap_or_default();

    pairs
        .entry("__remember_me".to_string())
        .or_insert_with(|| NETEASE_COOKIE_REMEMBER_ME.to_string());
    pairs
        .entry("ntes_kaola_ad".to_string())
        .or_insert_with(|| NETEASE_COOKIE_KAOLA_AD.to_string());
    pairs
        .entry("_ntes_nuid".to_string())
        .or_insert_with(|| NETEASE_SESSION_NTES_NUID.clone());
    pairs
        .entry("_ntes_nnid".to_string())
        .or_insert_with(|| NETEASE_SESSION_NTES_NNID.clone());
    pairs
        .entry("WNMCID".to_string())
        .or_insert_with(|| NETEASE_SESSION_WNMCID.clone());
    pairs
        .entry("WEVNSM".to_string())
        .or_insert_with(|| NETEASE_COOKIE_WEVNSM.to_string());
    pairs
        .entry("osver".to_string())
        .or_insert_with(|| NETEASE_PC_OSVER.to_string());
    pairs
        .entry("deviceId".to_string())
        .or_insert_with(|| NETEASE_SESSION_DEVICE_ID.clone());
    pairs
        .entry("os".to_string())
        .or_insert_with(|| NETEASE_PC_OS.to_string());
    pairs
        .entry("channel".to_string())
        .or_insert_with(|| NETEASE_PC_CHANNEL.to_string());
    pairs
        .entry("appver".to_string())
        .or_insert_with(|| NETEASE_PC_APPVER.to_string());
    pairs
        .entry("versioncode".to_string())
        .or_insert_with(|| NETEASE_COOKIE_VERSION_CODE.to_string());
    pairs
        .entry("mobilename".to_string())
        .or_insert_with(|| NETEASE_COOKIE_MOBILENAME.to_string());
    pairs
        .entry("resolution".to_string())
        .or_insert_with(|| NETEASE_COOKIE_RESOLUTION.to_string());
    pairs
        .entry("buildver".to_string())
        .or_insert_with(|| (now_ms() / 1000).to_string());

    if !api_path.contains("login") {
        pairs
            .entry("NMTID".to_string())
            .or_insert_with(|| generate_random_hex_string(32, false));
    }

    pairs
}

fn build_eapi_header_payload(cookie_pairs: &HashMap<String, String>) -> Map<String, Value> {
    let mut payload = Map::new();
    payload.insert(
        "osver".to_string(),
        Value::String(
            cookie_pairs
                .get("osver")
                .cloned()
                .unwrap_or_else(|| NETEASE_PC_OSVER.to_string()),
        ),
    );
    payload.insert(
        "deviceId".to_string(),
        Value::String(
            cookie_pairs
                .get("deviceId")
                .cloned()
                .unwrap_or_else(|| NETEASE_SESSION_DEVICE_ID.clone()),
        ),
    );
    payload.insert(
        "os".to_string(),
        Value::String(
            cookie_pairs
                .get("os")
                .cloned()
                .unwrap_or_else(|| NETEASE_PC_OS.to_string()),
        ),
    );
    payload.insert(
        "appver".to_string(),
        Value::String(
            cookie_pairs
                .get("appver")
                .cloned()
                .unwrap_or_else(|| NETEASE_PC_APPVER.to_string()),
        ),
    );
    payload.insert(
        "versioncode".to_string(),
        Value::String(
            cookie_pairs
                .get("versioncode")
                .cloned()
                .unwrap_or_else(|| NETEASE_COOKIE_VERSION_CODE.to_string()),
        ),
    );
    payload.insert(
        "mobilename".to_string(),
        Value::String(
            cookie_pairs
                .get("mobilename")
                .cloned()
                .unwrap_or_else(|| NETEASE_COOKIE_MOBILENAME.to_string()),
        ),
    );
    payload.insert(
        "buildver".to_string(),
        Value::String(
            cookie_pairs
                .get("buildver")
                .cloned()
                .unwrap_or_else(|| (now_ms() / 1000).to_string()),
        ),
    );
    payload.insert(
        "resolution".to_string(),
        Value::String(
            cookie_pairs
                .get("resolution")
                .cloned()
                .unwrap_or_else(|| NETEASE_COOKIE_RESOLUTION.to_string()),
        ),
    );
    payload.insert(
        "__csrf".to_string(),
        Value::String(cookie_pairs.get("__csrf").cloned().unwrap_or_default()),
    );
    payload.insert(
        "channel".to_string(),
        Value::String(
            cookie_pairs
                .get("channel")
                .cloned()
                .unwrap_or_else(|| NETEASE_PC_CHANNEL.to_string()),
        ),
    );
    payload.insert(
        "requestId".to_string(),
        Value::String(generate_request_id()),
    );
    payload
}

fn build_eapi_cookie_header(
    cookie_pairs: &HashMap<String, String>,
    header_payload: &Map<String, Value>,
) -> String {
    let mut pairs = HashMap::new();

    for key in [
        "osver",
        "deviceId",
        "os",
        "appver",
        "versioncode",
        "mobilename",
        "buildver",
        "resolution",
        "__csrf",
        "channel",
        "requestId",
    ] {
        if let Some(value) = header_payload.get(key).and_then(Value::as_str) {
            pairs.insert(key.to_string(), value.to_string());
        }
    }

    if let Some(value) = cookie_pairs.get("MUSIC_U").cloned() {
        pairs.insert("MUSIC_U".to_string(), value);
    }
    if let Some(value) = cookie_pairs.get("MUSIC_A").cloned() {
        pairs.insert("MUSIC_A".to_string(), value);
    }

    build_cookie_header_from_pairs(&pairs)
}

fn merge_cookie_header_values(primary: Option<&str>, secondary: Option<&str>) -> Option<String> {
    let mut pairs = primary.map(parse_cookie_pairs).unwrap_or_default();
    let next_pairs = secondary.map(parse_cookie_pairs).unwrap_or_default();
    pairs.extend(next_pairs);

    let normalized = build_cookie_header_from_pairs(&pairs);
    if normalized.trim().is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn ensure_anonymous_cookie_header(client: &Client) -> Result<String, String> {
    if let Some(cookie_header) = get_anonymous_cookie_header() {
        return Ok(cookie_header);
    }

    let response = request_netease_weapi_json(
        client,
        NETEASE_REGISTER_ANONYMOUS_API,
        json!({
            "username": build_anonymous_username(),
        }),
        None,
        "anonymous register",
    )?;

    let cookie_header = response
        .cookie_header
        .clone()
        .or_else(|| to_non_empty_string(response.body.get("cookie")))
        .ok_or_else(|| {
            "Netease anonymous register succeeded but did not return MUSIC_A cookie".to_string()
        })?;

    let normalized = merge_cookie_header_values(Some(cookie_header.as_str()), None)
        .ok_or_else(|| "Netease anonymous cookie header is empty".to_string())?;
    set_anonymous_cookie_state(normalized.clone());
    Ok(normalized)
}

fn build_netease_weapi_url(api_path: &str) -> Result<String, String> {
    let suffix = api_path
        .trim()
        .strip_prefix("/api/")
        .ok_or_else(|| format!("Unsupported Netease weapi path: {api_path}"))?;
    Ok(format!("{NETEASE_DOMAIN}/weapi/{suffix}"))
}

fn build_netease_eapi_url(api_path: &str) -> Result<String, String> {
    let suffix = api_path
        .trim()
        .strip_prefix("/api/")
        .ok_or_else(|| format!("Unsupported Netease eapi path: {api_path}"))?;
    Ok(format!("{NETEASE_API_DOMAIN}/eapi/{suffix}"))
}

fn into_json_object(payload: Value, context: &str) -> Result<Map<String, Value>, String> {
    match payload {
        Value::Object(map) => Ok(map),
        Value::Null => Ok(Map::new()),
        _ => Err(format!("Netease {context} payload must be a JSON object")),
    }
}

fn aes_cbc_encrypt_base64(plaintext: &str, key: &str, iv: &str) -> Result<String, String> {
    type Aes128CbcEnc = cbc::Encryptor<Aes128>;

    let encrypted = Aes128CbcEnc::new_from_slices(key.as_bytes(), iv.as_bytes())
        .map_err(|error| format!("Failed to initialize Netease AES-CBC cipher: {error}"))?
        .encrypt_padded_vec_mut::<Pkcs7>(plaintext.as_bytes());

    Ok(BASE64_STANDARD.encode(encrypted))
}

fn aes_ecb_encrypt_hex_upper(plaintext: &str, key: &str) -> Result<String, String> {
    type Aes128EcbEnc = ecb::Encryptor<Aes128>;

    let encrypted = Aes128EcbEnc::new_from_slice(key.as_bytes())
        .map_err(|error| format!("Failed to initialize Netease AES-ECB cipher: {error}"))?
        .encrypt_padded_vec_mut::<Pkcs7>(plaintext.as_bytes());

    Ok(encrypted
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<String>())
}

fn encrypt_weapi_payload(body: &Value) -> Result<(String, String), String> {
    let serialized = serde_json::to_string(body)
        .map_err(|error| format!("Failed to encode weapi JSON: {error}"))?;
    let secret_key = generate_random_base62_string(16);
    let first_pass =
        aes_cbc_encrypt_base64(&serialized, NETEASE_WEAPI_PRESET_KEY, NETEASE_WEAPI_IV)?;
    let params = aes_cbc_encrypt_base64(&first_pass, &secret_key, NETEASE_WEAPI_IV)?;

    let modulus_bytes = URL_SAFE_NO_PAD
        .decode(NETEASE_PUBLIC_KEY_MODULUS_B64URL.as_bytes())
        .map_err(|error| format!("Failed to decode Netease public key modulus: {error}"))?;
    let modulus = BigUint::from_bytes_be(&modulus_bytes);
    let exponent = BigUint::from(NETEASE_PUBLIC_KEY_EXPONENT);
    let reversed_secret: Vec<u8> = secret_key.as_bytes().iter().rev().copied().collect();
    let secret_int = BigUint::from_bytes_be(&reversed_secret);
    let encrypted = secret_int.modpow(&exponent, &modulus);
    let width = modulus_bytes.len().saturating_mul(2);
    let enc_sec_key = format!("{:0width$x}", encrypted, width = width);

    Ok((params, enc_sec_key))
}

fn encrypt_eapi_payload(api_path: &str, body: &Value) -> Result<String, String> {
    let serialized = serde_json::to_string(body)
        .map_err(|error| format!("Failed to encode eapi JSON: {error}"))?;
    let digest = format!(
        "{:x}",
        md5::compute(format!("nobody{api_path}use{serialized}md5forencrypt").as_bytes())
    );
    let message = format!("{api_path}-36cd479b6b5-{serialized}-36cd479b6b5-{digest}");
    aes_ecb_encrypt_hex_upper(&message, NETEASE_EAPI_KEY)
}

fn send_netease_request(
    client: &Client,
    url: &str,
    headers: HeaderMap,
    form_pairs: Vec<(&str, String)>,
    base_cookie_header: Option<&str>,
    context: &str,
) -> Result<NeteaseApiResponse, String> {
    let response = client
        .post(url)
        .headers(headers)
        .body(build_form_urlencoded_body(&form_pairs))
        .send()
        .map_err(|error| format!("Netease {context} request failed via {url}: {error}"))?;

    let status = response.status();
    let response_headers = response.headers().clone();
    let payload_text = response
        .text()
        .map_err(|error| format!("Failed to read Netease {context} response body: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "Netease {context} returned non-success status {status} via {url}: {}",
            truncate_error_text(&payload_text)
        ));
    }

    let body = serde_json::from_str::<Value>(&payload_text).map_err(|error| {
        format!(
            "Failed to decode Netease {context} payload via {url}: {error}. Body: {}",
            truncate_error_text(&payload_text)
        )
    })?;

    Ok(NeteaseApiResponse {
        body,
        cookie_header: merge_cookie_headers(base_cookie_header, &response_headers),
    })
}

fn request_netease_weapi_json(
    client: &Client,
    api_path: &str,
    payload: Value,
    cookie_header: Option<&str>,
    context: &str,
) -> Result<NeteaseApiResponse, String> {
    let effective_cookie_header = if let Some(cookie_header) =
        cookie_header.map(str::trim).filter(|value| !value.is_empty())
    {
        Some(cookie_header.to_string())
    } else if api_path == NETEASE_REGISTER_ANONYMOUS_API {
        None
    } else {
        Some(ensure_anonymous_cookie_header(client)?)
    };
    let mut body = into_json_object(payload, context)?;
    let cookie_pairs =
        build_netease_request_cookie_pairs(effective_cookie_header.as_deref(), api_path);
    body.insert(
        "csrf_token".to_string(),
        Value::String(cookie_pairs.get("__csrf").cloned().unwrap_or_default()),
    );

    let (params, enc_sec_key) = encrypt_weapi_payload(&Value::Object(body))?;
    let normalized_cookie_header = build_cookie_header_from_pairs(&cookie_pairs);
    let url = build_netease_weapi_url(api_path)?;

    let mut headers = HeaderMap::new();
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/x-www-form-urlencoded"),
    );
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static(NETEASE_WEAPI_USER_AGENT),
    );
    headers.insert(REFERER, HeaderValue::from_static(NETEASE_DOMAIN));
    if !normalized_cookie_header.is_empty() {
        let header_value = HeaderValue::from_str(&normalized_cookie_header).map_err(|error| {
            format!("Failed to encode Netease weapi cookie header for {context}: {error}")
        })?;
        headers.insert(COOKIE, header_value);
    }

    send_netease_request(
        client,
        &url,
        headers,
        vec![("params", params), ("encSecKey", enc_sec_key)],
        if normalized_cookie_header.is_empty() {
            None
        } else {
            Some(normalized_cookie_header.as_str())
        },
        context,
    )
}

fn request_netease_eapi_json(
    client: &Client,
    api_path: &str,
    payload: Value,
    cookie_header: Option<&str>,
    context: &str,
) -> Result<NeteaseApiResponse, String> {
    let effective_cookie_header = if let Some(cookie_header) =
        cookie_header.map(str::trim).filter(|value| !value.is_empty())
    {
        Some(cookie_header.to_string())
    } else {
        Some(ensure_anonymous_cookie_header(client)?)
    };
    let mut body = into_json_object(payload, context)?;
    let cookie_pairs =
        build_netease_request_cookie_pairs(effective_cookie_header.as_deref(), api_path);
    let header_payload = build_eapi_header_payload(&cookie_pairs);
    body.insert("e_r".to_string(), Value::Bool(false));
    body.insert("header".to_string(), Value::Object(header_payload.clone()));

    let params = encrypt_eapi_payload(api_path, &Value::Object(body))?;
    let normalized_cookie_header = build_eapi_cookie_header(&cookie_pairs, &header_payload);
    let url = build_netease_eapi_url(api_path)?;

    let mut headers = HeaderMap::new();
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/x-www-form-urlencoded"),
    );
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static(NETEASE_EAPI_USER_AGENT),
    );
    headers.insert(REFERER, HeaderValue::from_static(NETEASE_DOMAIN));
    if !normalized_cookie_header.is_empty() {
        let header_value = HeaderValue::from_str(&normalized_cookie_header).map_err(|error| {
            format!("Failed to encode Netease eapi cookie header for {context}: {error}")
        })?;
        headers.insert(COOKIE, header_value);
    }

    send_netease_request(
        client,
        &url,
        headers,
        vec![("params", params)],
        if normalized_cookie_header.is_empty() {
            None
        } else {
            Some(normalized_cookie_header.as_str())
        },
        context,
    )
}

fn generate_chain_id(cookie_header: Option<&str>) -> String {
    let cookie_pairs = cookie_header.map(parse_cookie_pairs).unwrap_or_default();
    let device_id = cookie_pairs
        .get("sDeviceId")
        .cloned()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            format!(
                "unknown-{}",
                rand::thread_rng().gen_range(100_000..1_000_000)
            )
        });

    format!("v1_{device_id}_{NETEASE_QR_PLATFORM}_login_{}", now_ms())
}

fn build_qr_image_data_url(content: &str) -> Result<String, String> {
    let code = QrCode::new(content.as_bytes())
        .map_err(|error| format!("Failed to build Netease QR code matrix: {error}"))?;

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
            .map_err(|error| format!("Failed to encode Netease QR image as PNG: {error}"))?;
    }

    Ok(format!(
        "data:image/png;base64,{}",
        BASE64_STANDARD.encode(bytes)
    ))
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
    to_u64(
        data.get("profile")
            .and_then(|profile| profile.get("userId")),
    )
    .map(|value| value.to_string())
    .or_else(|| {
        to_u64(data.get("account").and_then(|account| account.get("id")))
            .map(|value| value.to_string())
    })
    .or_else(|| {
        to_non_empty_string(
            data.get("profile")
                .and_then(|profile| profile.get("userId")),
        )
    })
}

fn extract_login_status_message(payload: &Value) -> Option<String> {
    let data = payload.get("data").unwrap_or(payload);
    to_non_empty_string(data.get("message")).or_else(|| to_non_empty_string(payload.get("message")))
}

fn fetch_login_status_payload(client: &Client, cookie_header: &str) -> Result<Value, String> {
    request_netease_weapi_json(
        client,
        NETEASE_LOGIN_STATUS_API,
        json!({}),
        Some(cookie_header),
        "login status",
    )
    .map(|response| response.body)
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
        .ok_or_else(|| {
            "Failed to resolve app cache directory for Netease playback cache".to_string()
        })?
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
    let key_response = request_netease_eapi_json(
        &client,
        NETEASE_QR_KEY_API,
        json!({
            "type": 3,
        }),
        None,
        "qr key",
    )?;
    let key_payload = &key_response.body;
    let qr_key = to_non_empty_string(
        key_payload
            .get("data")
            .and_then(|data| data.get("data"))
            .and_then(|data| data.get("unikey")),
    )
    .or_else(|| to_non_empty_string(key_payload.get("data").and_then(|data| data.get("unikey"))))
    .or_else(|| to_non_empty_string(key_payload.get("unikey")))
    .ok_or_else(|| "Netease QR key response missing unikey".to_string())?;
    let chain_id = generate_chain_id(key_response.cookie_header.as_deref());
    let qr_url = format!(
        "{NETEASE_QR_URL_BASE}{}&chainId={}",
        percent_encode_component(&qr_key),
        percent_encode_component(&chain_id)
    );
    let qr_image_data_url = build_qr_image_data_url(&qr_url)?;

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
                cookie_header: key_response.cookie_header.clone(),
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
    let response = request_netease_eapi_json(
        &client,
        NETEASE_QR_CHECK_API,
        json!({
            "key": session.qr_key,
            "type": 3,
        }),
        session.cookie_header.as_deref(),
        "qr poll",
    )?;
    let payload = &response.body;
    let state_code = to_i64(payload.get("code")).unwrap_or(500);
    let state_message =
        to_non_empty_string(payload.get("message")).unwrap_or_else(|| "unknown state".to_string());
    let (state, auth_state, terminal) = parse_qr_poll_state(state_code, &state_message);
    let response_cookie_header = response.cookie_header.clone().filter(|header| {
        let pairs = parse_cookie_pairs(header);
        pairs.contains_key("MUSIC_U") || pairs.contains_key("MUSIC_A")
    });
    let payload_cookie_header = to_non_empty_string(payload.get("cookie"));
    let cookie_header = merge_cookie_header_values(
        response_cookie_header.as_deref(),
        payload_cookie_header.as_deref(),
    );

    if !terminal {
        let next_cookie_header = response
            .cookie_header
            .clone()
            .or_else(|| session.cookie_header.clone());
        if let Ok(mut sessions) = lock_qr_sessions() {
            if let Some(entry) = sessions.get_mut(normalized_session_id) {
                entry.cookie_header = next_cookie_header;
            }
        }
    }

    let account_uid = if auth_state == "authorized" {
        if let Some(cookie_header) = cookie_header {
            let account_uid = match fetch_login_status_payload(&client, &cookie_header) {
                Ok(profile_payload) => extract_account_uid_from_login_status(&profile_payload),
                Err(error) => {
                    eprintln!(
                        "[music_platform_netease] QR login authorized but login status lookup failed: {error}"
                    );
                    None
                }
            };
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
            return Err("Netease QR login succeeded but no auth cookie was returned".to_string());
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
                        availability_message =
                            extract_login_status_message(&payload).or_else(|| {
                                Some(format!(
                                    "Netease login status failed with code {status_code}"
                                ))
                            });
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
    let payload = request_netease_weapi_json(
        &client,
        NETEASE_USER_PLAYLISTS_API,
        json!({
            "uid": account_uid,
            "limit": 200,
            "offset": 0,
            "includeVideo": true,
        }),
        Some(&auth_context.cookie_header),
        "user playlists",
    )?
    .body;

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
    let payload = request_netease_weapi_json(
        &client,
        NETEASE_RECOMMEND_PLAYLISTS_API,
        json!({}),
        Some(&auth_context.cookie_header),
        "recommended playlists",
    )?
    .body;

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
    let payload = request_netease_weapi_json(
        &client,
        NETEASE_RECOMMEND_SONGS_API,
        json!({}),
        Some(&auth_context.cookie_header),
        "recommended songs",
    )?
    .body;

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

pub fn list_playlist_tracks(app: &AppHandle, playlist_id: &str) -> Result<NeteaseSongPage, String> {
    ensure_connector(app)?;
    let auth_context = ensure_auth_context(app)?;
    let normalized_playlist_id = playlist_id.trim();
    if normalized_playlist_id.is_empty() {
        return Err("playlistId is required".to_string());
    }

    let client = build_http_client()?;
    let detail_payload = request_netease_eapi_json(
        &client,
        NETEASE_PLAYLIST_DETAIL_API,
        json!({
            "id": normalized_playlist_id,
            "n": 100000,
            "s": 8,
        }),
        Some(&auth_context.cookie_header),
        "playlist detail",
    )?
    .body;

    let playlist = detail_payload.get("playlist").unwrap_or(&Value::Null);
    let track_ids = playlist
        .get("trackIds")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let song_ids: Vec<String> = track_ids
        .iter()
        .filter_map(|item| {
            to_u64(item.get("id"))
                .map(|value| value.to_string())
                .or_else(|| to_non_empty_string(item.get("id")))
        })
        .collect();

    if song_ids.is_empty() {
        return Ok(NeteaseSongPage {
            source_kind: "user-playlist".to_string(),
            source_id: normalized_playlist_id.to_string(),
            page_num: 1,
            page_size: 1,
            total: 0,
            has_more: false,
            items: Vec::new(),
        });
    }

    let detail_items: Vec<Value> = song_ids
        .iter()
        .map(|song_id| match song_id.parse::<u64>() {
            Ok(value) => json!({ "id": value }),
            Err(_) => json!({ "id": song_id }),
        })
        .collect();
    let c_payload = serde_json::to_string(&detail_items)
        .map_err(|error| format!("Failed to encode Netease playlist track ids: {error}"))?;
    let payload = request_netease_eapi_json(
        &client,
        NETEASE_SONG_DETAIL_API,
        json!({
            "c": c_payload,
        }),
        Some(&auth_context.cookie_header),
        "playlist tracks",
    )?
    .body;

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
    let payload = request_netease_eapi_json(
        &client,
        NETEASE_CLOUDSEARCH_API,
        json!({
            "s": normalized_keyword,
            "type": 1,
            "limit": normalized_page_size,
            "offset": offset,
            "total": true,
        }),
        Some(&auth_context.cookie_header),
        "search songs",
    )?
    .body;

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
    let payload = request_netease_eapi_json(
        &client,
        NETEASE_SONG_URL_API,
        json!({
            "ids": serde_json::to_string(&vec![song_id.clone()])
                .map_err(|error| format!("Failed to encode Netease song id list: {error}"))?,
            "br": NETEASE_PLAYBACK_CACHE_BR,
        }),
        Some(&auth_context.cookie_header),
        "song url",
    )?
    .body;

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
