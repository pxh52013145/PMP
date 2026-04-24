use crate::sidecar_bridge::{
    SidecarBridgeOpenRequest, SidecarBridgeOpenResponse, SidecarBridgeRegistry,
};
use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallSourceFile {
    pub relative_path: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallSourcePayload {
    pub manifest_path: String,
    pub root_dir: String,
    pub manifest_raw: String,
    pub files: Vec<PluginInstallSourceFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDevProjectAssetScopePayload {
    pub manifest_path: String,
    pub root_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformPackDevSourceDiagnostic {
    pub severity: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformPackDevSourcePayload {
    pub root_dir: String,
    pub manifest_path: String,
    pub manifest_raw: Option<String>,
    pub contract_path: Option<String>,
    pub contract_raw: Option<String>,
    pub runtime_path: Option<String>,
    pub runtime_raw: Option<String>,
    pub runtime_exists: Option<bool>,
    pub icon_path: Option<String>,
    pub icon_raw_base64: Option<String>,
    pub icon_exists: Option<bool>,
    pub sidecar_path: Option<String>,
    pub sidecar_exists: Option<bool>,
    pub diagnostics: Vec<PlatformPackDevSourceDiagnostic>,
}

fn normalize_display_path(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    normalized
        .strip_prefix("//?/")
        .map(|value| value.to_string())
        .unwrap_or(normalized)
}

fn normalize_install_source_path(file_path: &str) -> Result<PathBuf, String> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Err("Extension manifest path is required".to_string());
    }

    if trimmed.starts_with("file://") {
        let url = url::Url::parse(trimmed)
            .map_err(|error| format!("Invalid extension manifest file URL: {error}"))?;
        return url
            .to_file_path()
            .map_err(|_| format!("Invalid extension manifest file URL: {trimmed}"));
    }

    if let Some(stripped) = trimmed.strip_prefix(r"\\?\") {
        return Ok(PathBuf::from(stripped));
    }

    Ok(PathBuf::from(trimmed))
}

fn resolve_manifest_path(install_path: &Path) -> Result<PathBuf, String> {
    if !install_path.exists() {
        return Err(format!(
            "Extension manifest path does not exist: {}",
            normalize_display_path(install_path)
        ));
    }

    let manifest_path = if install_path.is_dir() {
        install_path.join("manifest.v2.json")
    } else {
        install_path.to_path_buf()
    };

    if manifest_path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| *value == "manifest.v2.json")
        .is_none()
    {
        return Err(format!(
            "Selected file must be manifest.v2.json: {}",
            normalize_display_path(&manifest_path)
        ));
    }

    if !manifest_path.exists() {
        return Err(format!(
            "manifest.v2.json not found: {}",
            normalize_display_path(&manifest_path)
        ));
    }

    Ok(manifest_path)
}

fn resolve_canonical_manifest_and_root(file_path: &str) -> Result<(PathBuf, PathBuf), String> {
    let install_path = normalize_install_source_path(file_path)?;
    let manifest_path = resolve_manifest_path(&install_path)?;
    let manifest_path = fs::canonicalize(&manifest_path).map_err(|error| {
        format!(
            "Failed to resolve manifest.v2.json path {}: {}",
            normalize_display_path(&manifest_path),
            error
        )
    })?;
    let root_dir = manifest_path
        .parent()
        .ok_or_else(|| {
            format!(
                "Failed to resolve extension root for {}",
                normalize_display_path(&manifest_path)
            )
        })?
        .to_path_buf();
    Ok((manifest_path, root_dir))
}

fn resolve_platform_pack_dev_manifest_and_root(
    file_path: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let install_path = normalize_install_source_path(file_path)?;
    if !install_path.exists() {
        return Err(format!(
            "Platform pack project path does not exist: {}",
            normalize_display_path(&install_path)
        ));
    }

    let root_dir = if install_path.is_dir() {
        install_path
    } else if install_path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| *value == "manifest.json")
        .is_some()
    {
        install_path
            .parent()
            .ok_or_else(|| {
                format!(
                    "Failed to resolve platform pack root for {}",
                    normalize_display_path(&install_path)
                )
            })?
            .to_path_buf()
    } else {
        return Err(format!(
            "Selected file must be manifest.json or a platform pack project directory: {}",
            normalize_display_path(&install_path)
        ));
    };

    let root_dir = fs::canonicalize(&root_dir).map_err(|error| {
        format!(
            "Failed to resolve platform pack project root {}: {}",
            normalize_display_path(&root_dir),
            error
        )
    })?;
    Ok((root_dir.join("manifest.json"), root_dir))
}

fn push_platform_pack_dev_diagnostic(
    diagnostics: &mut Vec<PlatformPackDevSourceDiagnostic>,
    severity: &str,
    code: &str,
    message: String,
) {
    if diagnostics.iter().any(|diagnostic| diagnostic.code == code) {
        return;
    }
    diagnostics.push(PlatformPackDevSourceDiagnostic {
        severity: severity.to_string(),
        code: code.to_string(),
        message,
    });
}

fn normalize_platform_pack_dev_relative_path(path: &str, label: &str) -> Result<String, String> {
    let normalized = path
        .trim()
        .replace('\\', "/")
        .trim_start_matches("./")
        .replace("//", "/");
    if normalized.is_empty() {
        return Err(format!("{label} is required"));
    }
    if normalized.starts_with('/') || normalized.starts_with("file://") {
        return Err(format!("{label} must be relative"));
    }
    if normalized.len() >= 3 {
        let bytes = normalized.as_bytes();
        if bytes[1] == b':' && bytes[2] == b'/' && bytes[0].is_ascii_alphabetic() {
            return Err(format!("{label} must be relative"));
        }
    }
    if normalized
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err(format!("{label} contains invalid segments"));
    }
    Ok(normalized)
}

fn resolve_platform_pack_dev_entry_path(root_dir: &Path, relative_path: &str) -> PathBuf {
    let mut path = root_dir.to_path_buf();
    for segment in relative_path.split('/') {
        path.push(segment);
    }
    path
}

fn read_platform_pack_manifest_entry(
    manifest: &serde_json::Value,
    field: &str,
    required: bool,
    diagnostics: &mut Vec<PlatformPackDevSourceDiagnostic>,
) -> Option<String> {
    let code_prefix = format!("manifest.entry.{field}");
    let raw_value = manifest
        .get("entry")
        .and_then(|entry| entry.get(field))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string());

    let Some(raw_value) = raw_value else {
        if required {
            push_platform_pack_dev_diagnostic(
                diagnostics,
                "error",
                &format!("{code_prefix}.missing"),
                format!("manifest.entry.{field} is required"),
            );
        }
        return None;
    };

    match normalize_platform_pack_dev_relative_path(&raw_value, &format!("manifest.entry.{field}"))
    {
        Ok(value) => Some(value),
        Err(message) => {
            push_platform_pack_dev_diagnostic(
                diagnostics,
                "error",
                &format!("{code_prefix}.invalid"),
                message,
            );
            None
        }
    }
}

fn read_platform_pack_dev_text_file(
    path: &Path,
    diagnostics: &mut Vec<PlatformPackDevSourceDiagnostic>,
    missing_code: &str,
    read_failed_code: &str,
    missing_message: String,
) -> Option<String> {
    if !path.exists() {
        push_platform_pack_dev_diagnostic(diagnostics, "error", missing_code, missing_message);
        return None;
    }

    match fs::read_to_string(path) {
        Ok(value) => Some(value),
        Err(error) => {
            push_platform_pack_dev_diagnostic(
                diagnostics,
                "error",
                read_failed_code,
                format!("Failed to read {}: {}", normalize_display_path(path), error),
            );
            None
        }
    }
}

fn read_platform_pack_dev_binary_file_base64(
    path: &Path,
    diagnostics: &mut Vec<PlatformPackDevSourceDiagnostic>,
    read_failed_code: &str,
) -> Option<String> {
    match fs::read(path) {
        Ok(value) => Some(general_purpose::STANDARD.encode(value)),
        Err(error) => {
            push_platform_pack_dev_diagnostic(
                diagnostics,
                "error",
                read_failed_code,
                format!("Failed to read {}: {}", normalize_display_path(path), error),
            );
            None
        }
    }
}

fn collect_install_source_files(
    root_dir: &Path,
    current_dir: &Path,
    files: &mut Vec<PluginInstallSourceFile>,
) -> Result<(), String> {
    let entries = fs::read_dir(current_dir).map_err(|error| {
        format!(
            "Failed to read extension directory {}: {}",
            normalize_display_path(current_dir),
            error
        )
    })?;

    for entry_result in entries {
        let entry = entry_result.map_err(|error| {
            format!(
                "Failed to enumerate extension directory {}: {}",
                normalize_display_path(current_dir),
                error
            )
        })?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "Failed to read extension entry metadata {}: {}",
                normalize_display_path(&path),
                error
            )
        })?;

        if file_type.is_symlink() {
            return Err(format!(
                "Extension install source cannot contain symlinks: {}",
                normalize_display_path(&path)
            ));
        }

        if file_type.is_dir() {
            collect_install_source_files(root_dir, &path, files)?;
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        let relative_path = path
            .strip_prefix(root_dir)
            .map_err(|_| {
                format!(
                    "Extension file is outside manifest root: {}",
                    normalize_display_path(&path)
                )
            })?
            .to_string_lossy()
            .replace('\\', "/");
        let bytes = fs::read(&path).map_err(|error| {
            format!(
                "Failed to read extension file {}: {}",
                normalize_display_path(&path),
                error
            )
        })?;

        files.push(PluginInstallSourceFile {
            relative_path,
            bytes,
        });
    }

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn plugin_read_install_source(file_path: String) -> Result<PluginInstallSourcePayload, String> {
    let (manifest_path, root_dir) = resolve_canonical_manifest_and_root(&file_path)?;
    let manifest_raw = fs::read_to_string(&manifest_path).map_err(|error| {
        format!(
            "Failed to read manifest.v2.json {}: {}",
            normalize_display_path(&manifest_path),
            error
        )
    })?;

    let mut files = Vec::new();
    collect_install_source_files(&root_dir, &root_dir, &mut files)?;
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    Ok(PluginInstallSourcePayload {
        manifest_path: normalize_display_path(&manifest_path),
        root_dir: normalize_display_path(&root_dir),
        manifest_raw,
        files,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn plugin_allow_dev_project_asset_scope(
    app: tauri::AppHandle,
    file_path: String,
) -> Result<PluginDevProjectAssetScopePayload, String> {
    let (manifest_path, root_dir) = resolve_canonical_manifest_and_root(&file_path)?;
    app.asset_protocol_scope()
        .allow_directory(&root_dir, true)
        .map_err(|error| {
            format!(
                "Failed to allow plugin dev project asset directory {}: {}",
                normalize_display_path(&root_dir),
                error
            )
        })?;

    Ok(PluginDevProjectAssetScopePayload {
        manifest_path: normalize_display_path(&manifest_path),
        root_dir: normalize_display_path(&root_dir),
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn plugin_read_platform_pack_dev_source(
    file_path: String,
) -> Result<PlatformPackDevSourcePayload, String> {
    let (manifest_path, root_dir) = resolve_platform_pack_dev_manifest_and_root(&file_path)?;
    let mut diagnostics = Vec::new();
    let manifest_raw = read_platform_pack_dev_text_file(
        &manifest_path,
        &mut diagnostics,
        "manifest.missing",
        "manifest.read-failed",
        format!(
            "Platform pack manifest.json was not found: {}",
            normalize_display_path(&manifest_path)
        ),
    );

    let mut contract_path = None;
    let mut contract_raw = None;
    let mut runtime_path = None;
    let mut runtime_raw = None;
    let mut runtime_exists = None;
    let mut icon_path = None;
    let mut icon_raw_base64 = None;
    let mut icon_exists = None;
    let mut sidecar_path = None;
    let mut sidecar_exists = None;

    if let Some(raw) = manifest_raw.as_deref() {
        match serde_json::from_str::<serde_json::Value>(raw) {
            Ok(manifest) => {
                if let Some(relative_path) =
                    read_platform_pack_manifest_entry(&manifest, "contract", true, &mut diagnostics)
                {
                    let path = resolve_platform_pack_dev_entry_path(&root_dir, &relative_path);
                    contract_path = Some(normalize_display_path(&path));
                    contract_raw = read_platform_pack_dev_text_file(
                        &path,
                        &mut diagnostics,
                        "contract.entry.missing",
                        "contract.read-failed",
                        format!("Contract entry is missing: {relative_path}"),
                    );
                }

                if let Some(relative_path) =
                    read_platform_pack_manifest_entry(&manifest, "runtime", true, &mut diagnostics)
                {
                    let path = resolve_platform_pack_dev_entry_path(&root_dir, &relative_path);
                    let exists = path.exists();
                    runtime_path = Some(normalize_display_path(&path));
                    runtime_exists = Some(exists);
                    if exists {
                        runtime_raw = read_platform_pack_dev_text_file(
                            &path,
                            &mut diagnostics,
                            "runtime.entry.missing",
                            "runtime.read-failed",
                            format!("Runtime entry is missing: {relative_path}"),
                        );
                    } else {
                        push_platform_pack_dev_diagnostic(
                            &mut diagnostics,
                            "error",
                            "runtime.entry.missing",
                            format!("Runtime entry is missing: {relative_path}"),
                        );
                    }
                }

                if let Some(relative_path) =
                    read_platform_pack_manifest_entry(&manifest, "icon", true, &mut diagnostics)
                {
                    let path = resolve_platform_pack_dev_entry_path(&root_dir, &relative_path);
                    let exists = path.exists();
                    icon_path = Some(normalize_display_path(&path));
                    icon_exists = Some(exists);
                    if exists {
                        icon_raw_base64 = read_platform_pack_dev_binary_file_base64(
                            &path,
                            &mut diagnostics,
                            "icon.read-failed",
                        );
                    } else {
                        push_platform_pack_dev_diagnostic(
                            &mut diagnostics,
                            "error",
                            "icon.entry.missing",
                            format!("Icon entry is missing: {relative_path}"),
                        );
                    }
                }

                if let Some(relative_path) =
                    read_platform_pack_manifest_entry(&manifest, "sidecar", false, &mut diagnostics)
                {
                    let path = resolve_platform_pack_dev_entry_path(&root_dir, &relative_path);
                    let exists = path.exists();
                    sidecar_path = Some(normalize_display_path(&path));
                    sidecar_exists = Some(exists);
                    if !exists {
                        push_platform_pack_dev_diagnostic(
                            &mut diagnostics,
                            "error",
                            "sidecar.entry.missing",
                            format!("Sidecar entry is missing: {relative_path}"),
                        );
                    }
                }
            }
            Err(error) => {
                push_platform_pack_dev_diagnostic(
                    &mut diagnostics,
                    "error",
                    "manifest.invalid-json",
                    format!("manifest.json contains invalid JSON: {error}"),
                );
            }
        }
    }

    Ok(PlatformPackDevSourcePayload {
        root_dir: normalize_display_path(&root_dir),
        manifest_path: normalize_display_path(&manifest_path),
        manifest_raw,
        contract_path,
        contract_raw,
        runtime_path,
        runtime_raw,
        runtime_exists,
        icon_path,
        icon_raw_base64,
        icon_exists,
        sidecar_path,
        sidecar_exists,
        diagnostics,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn plugin_sidecar_bridge_open(
    app: tauri::AppHandle,
    registry: tauri::State<'_, SidecarBridgeRegistry>,
    plugin_id: String,
    runtime_id: String,
    runtime_instance_id: String,
    entry_path: String,
    command_id: String,
    args: Option<serde_json::Value>,
    timeout_ms: u64,
) -> Result<SidecarBridgeOpenResponse, String> {
    registry.open_session(
        &app,
        SidecarBridgeOpenRequest {
            plugin_id,
            runtime_id,
            runtime_instance_id,
            entry_path,
            command_id,
            args,
            timeout_ms,
        },
    )
}

#[tauri::command(rename_all = "camelCase")]
pub fn plugin_sidecar_bridge_send(
    registry: tauri::State<'_, SidecarBridgeRegistry>,
    session_id: String,
    message: serde_json::Value,
) -> Result<(), String> {
    registry.send_message(&session_id, message)
}

#[tauri::command(rename_all = "camelCase")]
pub fn plugin_sidecar_bridge_close(
    app: tauri::AppHandle,
    registry: tauri::State<'_, SidecarBridgeRegistry>,
    session_id: String,
    reason: Option<String>,
) -> Result<(), String> {
    registry.close_session(&app, &session_id, reason.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn create_temp_dir(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "pmp-plugin-install-source-{label}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    fn write_file(path: &Path, contents: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(path, contents).expect("write file");
    }

    #[test]
    fn reads_manifest_from_directory_and_collects_files() {
        let root_dir = create_temp_dir("directory");
        let manifest_path = root_dir.join("manifest.v2.json");
        let entry_path = root_dir.join("index.js");

        write_file(
            &manifest_path,
            br#"{"schemaVersion":"2.0","kind":"extension"}"#,
        );
        write_file(&entry_path, b"export const demo = true;\n");

        let payload =
            plugin_read_install_source(root_dir.to_string_lossy().into_owned()).expect("payload");

        assert!(payload.manifest_path.ends_with("/manifest.v2.json"));
        assert_eq!(payload.root_dir, normalize_display_path(&root_dir));
        assert_eq!(
            payload
                .files
                .iter()
                .map(|file| file.relative_path.as_str())
                .collect::<Vec<_>>(),
            vec!["index.js", "manifest.v2.json"]
        );

        fs::remove_dir_all(root_dir).ok();
    }

    #[test]
    fn accepts_file_url_manifest_paths() {
        let root_dir = create_temp_dir("file-url");
        let manifest_path = root_dir.join("manifest.v2.json");

        write_file(
            &manifest_path,
            br#"{"schemaVersion":"2.0","kind":"extension"}"#,
        );

        let manifest_url = url::Url::from_file_path(&manifest_path)
            .expect("file url")
            .to_string();
        let payload = plugin_read_install_source(manifest_url).expect("payload");

        assert_eq!(
            payload.manifest_path,
            normalize_display_path(&manifest_path)
        );
        assert!(payload.manifest_raw.contains("\"schemaVersion\""));

        fs::remove_dir_all(root_dir).ok();
    }

    #[test]
    fn reads_platform_pack_dev_source_from_directory() {
        let root_dir = create_temp_dir("platform-pack");
        write_file(
            &root_dir.join("manifest.json"),
            br#"{
              "formatVersion": "1.0",
              "type": "platform-pack",
              "metadata": { "id": "demo-pack", "name": "Demo", "version": "0.1.0" },
              "connector": {
                "connectorId": "connector.platform.demo",
                "workspaceKind": "demo",
                "workspaceMode": "dedicated"
              },
              "entry": {
                "contract": "contract.json",
                "runtime": "runtime.js",
                "icon": "icon.svg"
              }
            }"#,
        );
        write_file(
            &root_dir.join("contract.json"),
            br#"{
              "contractVersion": "1.0",
              "platform": { "platformId": "demo", "displayName": "Demo", "staticIcon": "demo" },
              "auth": { "loginMode": "none" },
              "capabilities": {},
              "apiBindings": { "auth": "auth" },
              "extension": {
                "connectorId": "connector.platform.demo",
                "workspaceKind": "demo",
                "workspaceMode": "dedicated"
              }
            }"#,
        );
        write_file(
            &root_dir.join("runtime.js"),
            b"export function mountPage() {}\n",
        );
        write_file(&root_dir.join("icon.svg"), b"<svg></svg>\n");

        let payload = plugin_read_platform_pack_dev_source(root_dir.to_string_lossy().into_owned())
            .expect("payload");

        assert!(payload.manifest_path.ends_with("/manifest.json"));
        assert_eq!(payload.root_dir, normalize_display_path(&root_dir));
        assert!(payload.contract_path.unwrap().ends_with("/contract.json"));
        assert!(payload
            .contract_raw
            .unwrap()
            .contains("\"contractVersion\""));
        assert!(payload
            .runtime_raw
            .unwrap()
            .contains("mountPage"));
        assert_eq!(payload.runtime_exists, Some(true));
        assert!(payload.icon_raw_base64.is_some());
        assert_eq!(payload.icon_exists, Some(true));
        assert!(payload.diagnostics.is_empty());

        fs::remove_dir_all(root_dir).ok();
    }

    #[test]
    fn reports_missing_platform_pack_runtime_entry() {
        let root_dir = create_temp_dir("platform-pack-missing-runtime");
        write_file(
            &root_dir.join("manifest.json"),
            br#"{
              "formatVersion": "1.0",
              "type": "platform-pack",
              "metadata": { "id": "demo-pack", "name": "Demo", "version": "0.1.0" },
              "connector": {
                "connectorId": "connector.platform.demo",
                "workspaceKind": "demo"
              },
              "entry": {
                "contract": "contract.json",
                "runtime": "runtime.js",
                "icon": "icon.svg"
              }
            }"#,
        );
        write_file(&root_dir.join("contract.json"), b"{}\n");
        write_file(&root_dir.join("icon.svg"), b"<svg></svg>\n");

        let payload = plugin_read_platform_pack_dev_source(root_dir.to_string_lossy().into_owned())
            .expect("payload");

        assert_eq!(payload.runtime_exists, Some(false));
        assert!(payload
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "runtime.entry.missing"));

        fs::remove_dir_all(root_dir).ok();
    }
}
