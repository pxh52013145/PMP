use crate::sidecar_bridge::{
    SidecarBridgeOpenRequest, SidecarBridgeOpenResponse, SidecarBridgeRegistry,
};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

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
    let install_path = normalize_install_source_path(&file_path)?;
    let manifest_path = resolve_manifest_path(&install_path)?;
    let manifest_path = fs::canonicalize(&manifest_path).map_err(|error| {
        format!(
            "Failed to resolve manifest.v2.json path {}: {}",
            normalize_display_path(&manifest_path),
            error
        )
    })?;
    let root_dir = manifest_path.parent().ok_or_else(|| {
        format!(
            "Failed to resolve extension root for {}",
            normalize_display_path(&manifest_path)
        )
    })?;
    let manifest_raw = fs::read_to_string(&manifest_path).map_err(|error| {
        format!(
            "Failed to read manifest.v2.json {}: {}",
            normalize_display_path(&manifest_path),
            error
        )
    })?;

    let mut files = Vec::new();
    collect_install_source_files(root_dir, root_dir, &mut files)?;
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    Ok(PluginInstallSourcePayload {
        manifest_path: normalize_display_path(&manifest_path),
        root_dir: normalize_display_path(root_dir),
        manifest_raw,
        files,
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
}
