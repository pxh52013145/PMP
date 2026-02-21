use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

const DECODER_SIDECAR_PROTOCOL_VERSION: &str = "1.0.0";
const DECODER_SIDECAR_STUB_INPUT_ID: &str = "decoder-sidecar-stub";

static DECODER_SIDECAR_RUNTIME: Lazy<Mutex<DecoderSidecarRuntimeState>> =
    Lazy::new(|| Mutex::new(DecoderSidecarRuntimeState::default()));

#[derive(Debug, Default)]
struct DecoderSidecarRuntimeState {
    session_counter: u64,
    sessions: HashMap<String, DecoderSidecarSession>,
}

#[derive(Debug, Clone)]
struct DecoderSidecarSession {
    provider_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecoderSidecarDescribeProviderRequest {
    pub provider_id: String,
    pub protocol_version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecoderSidecarDescribeProviderResponse {
    pub provider_id: String,
    pub ready: bool,
    pub protocol_version: String,
    pub implementation: String,
    pub methods: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecoderSidecarProbeRequest {
    pub provider_id: String,
    pub protocol_version: Option<String>,
    pub source_path: String,
    pub preferred_input_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecoderSidecarProbeResponse {
    pub supported: bool,
    pub score: f64,
    pub input_id: Option<String>,
    pub reason: Option<String>,
    pub details: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecoderSidecarOpenSessionRequest {
    pub provider_id: String,
    pub protocol_version: Option<String>,
    pub source_path: String,
    pub preferred_input_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecoderSidecarOpenSessionResponse {
    pub provider_session_id: String,
    pub selected_input_id: String,
    pub metadata: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecoderSidecarCloseSessionRequest {
    pub provider_id: String,
    pub protocol_version: Option<String>,
    pub session_id: Option<String>,
    pub provider_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecoderSidecarCloseSessionResponse {
    pub closed: bool,
    pub provider_session_id: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecoderSidecarHealthRequest {
    pub provider_id: String,
    pub protocol_version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecoderSidecarHealthResponse {
    pub status: String,
    pub protocol_version: String,
    pub open_session_count: usize,
    pub message: Option<String>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn lock_runtime_state() -> Result<MutexGuard<'static, DecoderSidecarRuntimeState>, String> {
    DECODER_SIDECAR_RUNTIME
        .lock()
        .map_err(|_| "Decoder sidecar runtime state lock poisoned".to_string())
}

fn parse_env_bool(key: &str) -> bool {
    std::env::var(key)
        .ok()
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            normalized == "1" || normalized == "true" || normalized == "yes" || normalized == "on"
        })
        .unwrap_or(false)
}

fn is_sidecar_stub_enabled() -> bool {
    parse_env_bool("PMP_DECODER_SIDECAR_STUB_ENABLED")
}

fn normalize_provider_id(raw_provider_id: &str) -> Result<String, String> {
    let provider_id = raw_provider_id.trim();
    if provider_id.is_empty() {
        return Err("providerId is required".to_string());
    }
    if provider_id.len() > 64 {
        return Err("providerId is too long".to_string());
    }
    let mut chars = provider_id.chars();
    let first = chars
        .next()
        .ok_or_else(|| "providerId is required".to_string())?;

    if !first.is_ascii_alphanumeric() {
        return Err("providerId must start with an alphanumeric character".to_string());
    }
    if !chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-') {
        return Err("providerId contains unsupported characters".to_string());
    }

    Ok(provider_id.to_string())
}

fn normalize_optional_input_id(raw_input_id: Option<String>) -> Option<String> {
    raw_input_id.and_then(|value| {
        let normalized = value.trim();
        (!normalized.is_empty()).then(|| normalized.to_string())
    })
}

fn normalize_source_path(raw_source_path: &str) -> Result<String, String> {
    let source_path = raw_source_path.trim();
    if source_path.is_empty() {
        return Err("sourcePath is required".to_string());
    }
    Ok(source_path.to_string())
}

fn major_version(version: &str) -> Option<&str> {
    version
        .trim()
        .split('.')
        .next()
        .and_then(|segment| (!segment.is_empty()).then_some(segment))
}

fn is_protocol_compatible(protocol_version: Option<&str>) -> bool {
    let Some(requested) = protocol_version.map(|value| value.trim()) else {
        return true;
    };
    if requested.is_empty() {
        return true;
    }

    let requested_major = major_version(requested);
    let runtime_major = major_version(DECODER_SIDECAR_PROTOCOL_VERSION);

    match (requested_major, runtime_major) {
        (Some(left), Some(right)) => left == right,
        _ => true,
    }
}

fn select_stub_input_id(preferred_input_id: Option<String>) -> String {
    normalize_optional_input_id(preferred_input_id)
        .unwrap_or_else(|| DECODER_SIDECAR_STUB_INPUT_ID.to_string())
}

fn is_stub_supported_extension(source_path: &str) -> bool {
    let extension = Path::new(source_path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());

    matches!(
        extension.as_deref(),
        Some("flac")
            | Some("mp3")
            | Some("wav")
            | Some("ogg")
            | Some("opus")
            | Some("aac")
            | Some("m4a")
            | Some("alac")
            | Some("dsf")
            | Some("dff")
            | Some("iso")
    )
}

fn protocol_mismatch_message(requested: Option<&str>) -> String {
    format!(
        "protocol mismatch (request={}, runtime={})",
        requested.unwrap_or("unknown"),
        DECODER_SIDECAR_PROTOCOL_VERSION
    )
}

pub fn describe_provider(
    request: DecoderSidecarDescribeProviderRequest,
) -> Result<DecoderSidecarDescribeProviderResponse, String> {
    let provider_id = normalize_provider_id(request.provider_id.as_str())?;

    if !is_protocol_compatible(request.protocol_version.as_deref()) {
        return Ok(DecoderSidecarDescribeProviderResponse {
            provider_id,
            ready: false,
            protocol_version: DECODER_SIDECAR_PROTOCOL_VERSION.to_string(),
            implementation: "tauri-sidecar-stub".to_string(),
            methods: vec![
                "describeProvider".to_string(),
                "probe".to_string(),
                "openSession".to_string(),
                "closeSession".to_string(),
                "health".to_string(),
            ],
            message: protocol_mismatch_message(request.protocol_version.as_deref()),
        });
    }

    let enabled = is_sidecar_stub_enabled();

    Ok(DecoderSidecarDescribeProviderResponse {
        provider_id,
        ready: enabled,
        protocol_version: DECODER_SIDECAR_PROTOCOL_VERSION.to_string(),
        implementation: "tauri-sidecar-stub".to_string(),
        methods: vec![
            "describeProvider".to_string(),
            "probe".to_string(),
            "openSession".to_string(),
            "closeSession".to_string(),
            "health".to_string(),
        ],
        message: if enabled {
            "decoder-sidecar-stub-ready".to_string()
        } else {
            "decoder-sidecar-stub-disabled (set PMP_DECODER_SIDECAR_STUB_ENABLED=1 to enable)"
                .to_string()
        },
    })
}

pub fn probe(request: DecoderSidecarProbeRequest) -> Result<DecoderSidecarProbeResponse, String> {
    let provider_id = normalize_provider_id(request.provider_id.as_str())?;
    let source_path = normalize_source_path(request.source_path.as_str())?;

    if !is_protocol_compatible(request.protocol_version.as_deref()) {
        return Ok(DecoderSidecarProbeResponse {
            supported: false,
            score: 0.0,
            input_id: None,
            reason: Some(protocol_mismatch_message(
                request.protocol_version.as_deref(),
            )),
            details: Some(json!({
                "providerId": provider_id,
                "sourcePath": source_path,
                "runtimeProtocolVersion": DECODER_SIDECAR_PROTOCOL_VERSION,
            })),
        });
    }

    if !is_sidecar_stub_enabled() {
        return Ok(DecoderSidecarProbeResponse {
            supported: false,
            score: 0.0,
            input_id: None,
            reason: Some("decoder-sidecar-stub-disabled".to_string()),
            details: Some(json!({
                "providerId": provider_id,
                "sourcePath": source_path,
            })),
        });
    }

    if !is_stub_supported_extension(source_path.as_str()) {
        return Ok(DecoderSidecarProbeResponse {
            supported: false,
            score: 0.15,
            input_id: None,
            reason: Some("unsupported-extension".to_string()),
            details: Some(json!({
                "providerId": provider_id,
                "sourcePath": source_path,
            })),
        });
    }

    let selected_input_id = select_stub_input_id(request.preferred_input_id);

    Ok(DecoderSidecarProbeResponse {
        supported: true,
        score: 0.85,
        input_id: Some(selected_input_id),
        reason: Some("decoder-sidecar-stub-match".to_string()),
        details: Some(json!({
            "providerId": provider_id,
            "sourcePath": source_path,
            "mode": "stub",
        })),
    })
}

pub fn open_session(
    request: DecoderSidecarOpenSessionRequest,
) -> Result<DecoderSidecarOpenSessionResponse, String> {
    let provider_id = normalize_provider_id(request.provider_id.as_str())?;
    let source_path = normalize_source_path(request.source_path.as_str())?;

    if !is_protocol_compatible(request.protocol_version.as_deref()) {
        return Err(protocol_mismatch_message(
            request.protocol_version.as_deref(),
        ));
    }

    if !is_sidecar_stub_enabled() {
        return Err(
            "decoder-sidecar-stub-disabled (set PMP_DECODER_SIDECAR_STUB_ENABLED=1 to enable)"
                .to_string(),
        );
    }

    if !is_stub_supported_extension(source_path.as_str()) {
        return Err("decoder-sidecar-stub-unsupported-extension".to_string());
    }

    let selected_input_id = select_stub_input_id(request.preferred_input_id);
    let opened_at_ms = now_ms();

    let mut state = lock_runtime_state()?;
    state.session_counter = state.session_counter.saturating_add(1);
    let provider_session_id = format!("{}-{}", provider_id, state.session_counter);

    state.sessions.insert(
        provider_session_id.clone(),
        DecoderSidecarSession {
            provider_id: provider_id.clone(),
        },
    );

    Ok(DecoderSidecarOpenSessionResponse {
        provider_session_id,
        selected_input_id,
        metadata: json!({
            "providerId": provider_id,
            "sourcePath": source_path,
            "openedAtMs": opened_at_ms,
            "mode": "stub",
        }),
    })
}

pub fn close_session(
    request: DecoderSidecarCloseSessionRequest,
) -> Result<DecoderSidecarCloseSessionResponse, String> {
    let provider_id = normalize_provider_id(request.provider_id.as_str())?;

    if !is_protocol_compatible(request.protocol_version.as_deref()) {
        return Ok(DecoderSidecarCloseSessionResponse {
            closed: false,
            provider_session_id: request.provider_session_id,
            reason: Some(protocol_mismatch_message(
                request.protocol_version.as_deref(),
            )),
        });
    }

    let provider_session_id = request
        .provider_session_id
        .or_else(|| request.session_id)
        .and_then(|value| {
            let normalized = value.trim();
            (!normalized.is_empty()).then(|| normalized.to_string())
        });

    let Some(provider_session_id) = provider_session_id else {
        return Ok(DecoderSidecarCloseSessionResponse {
            closed: false,
            provider_session_id: None,
            reason: Some("providerSessionId or sessionId is required".to_string()),
        });
    };

    let mut state = lock_runtime_state()?;

    let Some(existing) = state.sessions.get(provider_session_id.as_str()) else {
        return Ok(DecoderSidecarCloseSessionResponse {
            closed: false,
            provider_session_id: Some(provider_session_id),
            reason: Some("session-not-found".to_string()),
        });
    };

    if !existing
        .provider_id
        .eq_ignore_ascii_case(provider_id.as_str())
    {
        return Ok(DecoderSidecarCloseSessionResponse {
            closed: false,
            provider_session_id: Some(provider_session_id),
            reason: Some("provider-mismatch".to_string()),
        });
    }

    state.sessions.remove(provider_session_id.as_str());

    Ok(DecoderSidecarCloseSessionResponse {
        closed: true,
        provider_session_id: Some(provider_session_id),
        reason: None,
    })
}

pub fn health(
    request: DecoderSidecarHealthRequest,
) -> Result<DecoderSidecarHealthResponse, String> {
    let provider_id = normalize_provider_id(request.provider_id.as_str())?;
    let state = lock_runtime_state()?;
    let open_session_count = state
        .sessions
        .values()
        .filter(|session| {
            session
                .provider_id
                .eq_ignore_ascii_case(provider_id.as_str())
        })
        .count();

    if !is_protocol_compatible(request.protocol_version.as_deref()) {
        return Ok(DecoderSidecarHealthResponse {
            status: "offline".to_string(),
            protocol_version: DECODER_SIDECAR_PROTOCOL_VERSION.to_string(),
            open_session_count,
            message: Some(protocol_mismatch_message(
                request.protocol_version.as_deref(),
            )),
        });
    }

    if !is_sidecar_stub_enabled() {
        return Ok(DecoderSidecarHealthResponse {
            status: "offline".to_string(),
            protocol_version: DECODER_SIDECAR_PROTOCOL_VERSION.to_string(),
            open_session_count,
            message: Some("decoder-sidecar-stub-disabled".to_string()),
        });
    }

    Ok(DecoderSidecarHealthResponse {
        status: "ready".to_string(),
        protocol_version: DECODER_SIDECAR_PROTOCOL_VERSION.to_string(),
        open_session_count,
        message: Some("decoder-sidecar-stub-ready".to_string()),
    })
}
