mod builtin_pack_providers;

use builtin_pack_providers::{
    list_builtin_pack_provider_descriptors, resolve_builtin_pack_provider_descriptor,
};
use serde::Deserialize;
use serde::Serialize;
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Clone)]
pub(crate) struct HeadlessMusicPlatformRuntimeContext {
    app_data_dir: PathBuf,
    app_cache_dir: Option<PathBuf>,
}

#[derive(Clone)]
pub(crate) enum MusicPlatformRuntimeHost {
    TauriApp(AppHandle),
    Headless(HeadlessMusicPlatformRuntimeContext),
}

pub(crate) struct MusicPlatformRuntimePathResolver<'a> {
    host: &'a MusicPlatformRuntimeHost,
}

pub(crate) struct MusicPlatformRuntimeAssetScope<'a> {
    host: &'a MusicPlatformRuntimeHost,
}

impl MusicPlatformRuntimeHost {
    pub(crate) fn from_app_handle(app: &AppHandle) -> Self {
        Self::TauriApp(app.clone())
    }

    pub(crate) fn new_headless() -> Result<Self, String> {
        let context = tauri::generate_context!();
        let config = context.config();
        let app_data_dir = tauri::api::path::app_data_dir(config).ok_or_else(|| {
            "Failed to resolve app data directory for music platform headless runtime".to_string()
        })?;
        let app_cache_dir = tauri::api::path::app_cache_dir(config);

        Ok(Self::Headless(HeadlessMusicPlatformRuntimeContext {
            app_data_dir,
            app_cache_dir,
        }))
    }

    pub(crate) fn path_resolver(&self) -> MusicPlatformRuntimePathResolver<'_> {
        MusicPlatformRuntimePathResolver { host: self }
    }

    pub(crate) fn asset_protocol_scope(&self) -> MusicPlatformRuntimeAssetScope<'_> {
        MusicPlatformRuntimeAssetScope { host: self }
    }

    fn app_data_dir(&self) -> Option<PathBuf> {
        match self {
            Self::TauriApp(app) => app.path_resolver().app_data_dir(),
            Self::Headless(context) => Some(context.app_data_dir.clone()),
        }
    }

    fn app_cache_dir(&self) -> Option<PathBuf> {
        match self {
            Self::TauriApp(app) => app.path_resolver().app_cache_dir(),
            Self::Headless(context) => context.app_cache_dir.clone(),
        }
    }

    fn allow_asset_directory(&self, path: &Path, recursive: bool) -> Result<(), String> {
        match self {
            Self::TauriApp(app) => app
                .asset_protocol_scope()
                .allow_directory(path, recursive)
                .map_err(|error| {
                    format!("Failed to allow music platform runtime asset directory: {error}")
                }),
            Self::Headless(_) => Err(
                "Music platform headless runtime does not manage a Tauri asset scope".to_string(),
            ),
        }
    }
}

impl MusicPlatformRuntimePathResolver<'_> {
    pub(crate) fn app_data_dir(&self) -> Option<PathBuf> {
        self.host.app_data_dir()
    }

    pub(crate) fn app_cache_dir(&self) -> Option<PathBuf> {
        self.host.app_cache_dir()
    }
}

impl MusicPlatformRuntimeAssetScope<'_> {
    pub(crate) fn allow_directory(&self, path: &Path, recursive: bool) -> Result<(), String> {
        self.host.allow_asset_directory(path, recursive)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicPlatformAuthInvokeRequest {
    pub connector_id: String,
    pub method: String,
    pub instance_id: Option<String>,
    pub payload: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicPlatformApiInvokeRequest {
    pub connector_id: String,
    pub binding_id: String,
    pub method: String,
    pub instance_id: Option<String>,
    pub payload: Option<Value>,
}

pub fn init_builtin_platform_runtime_support(app: &AppHandle) {
    let runtime_host = MusicPlatformRuntimeHost::from_app_handle(app);
    for descriptor in list_builtin_pack_provider_descriptors() {
        if let Err(error) = (descriptor.init)(&runtime_host) {
            eprintln!(
                "[MusicLibrary] Failed to init builtin platform runtime for {}: {}",
                descriptor.display_name, error
            );
        }
    }
}

pub fn cleanup_builtin_platform_runtime_state(app: &AppHandle) {
    let runtime_host = MusicPlatformRuntimeHost::from_app_handle(app);
    for descriptor in list_builtin_pack_provider_descriptors() {
        let Some(cleanup) = descriptor.cleanup else {
            continue;
        };

        if let Err(error) = cleanup(&runtime_host) {
            eprintln!(
                "[MusicLibrary] Failed to cleanup builtin platform runtime session state for {}: {}",
                descriptor.display_name, error
            );
        }
    }
}

pub fn invoke_auth(
    app: &AppHandle,
    request: MusicPlatformAuthInvokeRequest,
) -> Result<Value, String> {
    let runtime_host = MusicPlatformRuntimeHost::from_app_handle(app);
    let connector_id = require_non_empty(request.connector_id.as_str(), "connectorId")?;
    let method = require_non_empty(request.method.as_str(), "method")?;
    let instance_id = normalize_non_empty_string(request.instance_id.as_deref());

    let Some(descriptor) = resolve_builtin_pack_provider_descriptor(connector_id.as_str()) else {
        return Err(format!(
            "Unsupported music platform connector: {connector_id}"
        ));
    };

    (descriptor.dispatch_auth)(
        &runtime_host,
        method.as_str(),
        instance_id.as_deref(),
        &request.payload,
    )
}

pub fn invoke_api(
    app: &AppHandle,
    request: MusicPlatformApiInvokeRequest,
) -> Result<Value, String> {
    let runtime_host = MusicPlatformRuntimeHost::from_app_handle(app);
    let connector_id = require_non_empty(request.connector_id.as_str(), "connectorId")?;
    let binding_id = require_non_empty(request.binding_id.as_str(), "bindingId")?;
    let method = require_non_empty(request.method.as_str(), "method")?;
    let instance_id = normalize_non_empty_string(request.instance_id.as_deref());

    let Some(descriptor) = resolve_builtin_pack_provider_descriptor(connector_id.as_str()) else {
        return Err(format!(
            "Unsupported music platform connector: {connector_id}"
        ));
    };

    (descriptor.dispatch_api)(
        &runtime_host,
        binding_id.as_str(),
        method.as_str(),
        instance_id.as_deref(),
        &request.payload,
    )
}

fn require_non_empty(value: &str, field_name: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(format!("{field_name} is required"));
    }
    Ok(normalized.to_string())
}

fn normalize_non_empty_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MusicPlatformSidecarInvokeRequest {
    pub op: String,
    pub request_id: Option<String>,
    pub channel: String,
    pub method: String,
    pub binding_id: Option<String>,
    pub instance_id: Option<String>,
    pub payload: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicPlatformSidecarReady {
    op: &'static str,
    connector_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicPlatformSidecarError {
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MusicPlatformSidecarInvokeResponse {
    op: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<String>,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<MusicPlatformSidecarError>,
}

fn write_sidecar_json_line<T: Serialize>(writer: &mut impl Write, value: &T) -> Result<(), String> {
    let encoded = serde_json::to_vec(value)
        .map_err(|error| format!("Failed to encode music platform sidecar payload: {error}"))?;
    writer
        .write_all(&encoded)
        .map_err(|error| format!("Failed to write music platform sidecar payload: {error}"))?;
    writer
        .write_all(b"\n")
        .map_err(|error| format!("Failed to write music platform sidecar newline: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("Failed to flush music platform sidecar payload: {error}"))
}

fn write_sidecar_error_event(writer: &mut impl Write, message: String) -> Result<(), String> {
    write_sidecar_json_line(
        writer,
        &json!({
            "op": "error",
            "error": {
                "code": "SIDECAR_PROTOCOL_ERROR",
                "message": message,
            }
        }),
    )
}

pub fn run_builtin_pack_provider_sidecar(connector_id: &str) -> Result<(), String> {
    let normalized_connector_id = require_non_empty(connector_id, "connectorId")?;
    let runtime_host = MusicPlatformRuntimeHost::new_headless()?;

    let descriptor = resolve_builtin_pack_provider_descriptor(normalized_connector_id.as_str())
        .ok_or_else(|| {
            format!("Unsupported music platform connector: {normalized_connector_id}")
        })?;

    (descriptor.init)(&runtime_host)?;

    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut reader = std::io::BufReader::new(stdin.lock());
    let mut writer = stdout.lock();
    let mut line = String::new();

    write_sidecar_json_line(
        &mut writer,
        &MusicPlatformSidecarReady {
            op: "ready",
            connector_id: normalized_connector_id.clone(),
        },
    )?;

    loop {
        line.clear();
        let read = reader
            .read_line(&mut line)
            .map_err(|error| format!("Failed to read music platform sidecar request: {error}"))?;
        if read == 0 {
            break;
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<MusicPlatformSidecarInvokeRequest>(trimmed) {
            Ok(request) => {
                let request_id = normalize_non_empty_string(request.request_id.as_deref());
                if request.op.trim() != "invoke" {
                    MusicPlatformSidecarInvokeResponse {
                        op: "response",
                        request_id,
                        ok: false,
                        data: None,
                        error: Some(MusicPlatformSidecarError {
                            code: "INVALID_REQUEST".to_string(),
                            message: format!(
                                "Unsupported music platform sidecar op: {}",
                                request.op.trim()
                            ),
                            details: None,
                        }),
                    }
                } else {
                    let dispatch_result = match request.channel.trim() {
                        "auth" => (descriptor.dispatch_auth)(
                            &runtime_host,
                            request.method.trim(),
                            normalize_non_empty_string(request.instance_id.as_deref()).as_deref(),
                            &request.payload,
                        ),
                        "api" => {
                            if let Some(binding_id) =
                                normalize_non_empty_string(request.binding_id.as_deref())
                            {
                                (descriptor.dispatch_api)(
                                    &runtime_host,
                                    binding_id.as_str(),
                                    request.method.trim(),
                                    normalize_non_empty_string(request.instance_id.as_deref())
                                        .as_deref(),
                                    &request.payload,
                                )
                            } else {
                                Err("bindingId is required for api sidecar requests".to_string())
                            }
                        }
                        other => Err(format!(
                            "Unsupported music platform sidecar channel: {other}"
                        )),
                    };

                    match dispatch_result {
                        Ok(data) => MusicPlatformSidecarInvokeResponse {
                            op: "response",
                            request_id,
                            ok: true,
                            data: Some(data),
                            error: None,
                        },
                        Err(error) => MusicPlatformSidecarInvokeResponse {
                            op: "response",
                            request_id,
                            ok: false,
                            data: None,
                            error: Some(MusicPlatformSidecarError {
                                code: "API_UNAVAILABLE".to_string(),
                                message: error,
                                details: None,
                            }),
                        },
                    }
                }
            }
            Err(error) => {
                write_sidecar_error_event(
                    &mut writer,
                    format!("Failed to parse music platform sidecar request JSON: {error}"),
                )?;
                continue;
            }
        };

        write_sidecar_json_line(&mut writer, &response)?;
    }

    if let Some(cleanup) = descriptor.cleanup {
        let _ = cleanup(&runtime_host);
    }
    Ok(())
}
