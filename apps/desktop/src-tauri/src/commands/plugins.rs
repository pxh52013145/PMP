use crate::sidecar_bridge::{
    SidecarBridgeOpenRequest, SidecarBridgeOpenResponse, SidecarBridgeRegistry,
};
use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallSourceFile {
    pub relative_path: String,
    pub bytes: Vec<u8>,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallSourceDiagnostic {
    pub severity: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallSourcePayload {
    pub manifest_path: String,
    pub root_dir: String,
    pub manifest_raw: String,
    pub validated_manifest: Option<serde_json::Value>,
    pub validation_diagnostics: Vec<PluginInstallSourceDiagnostic>,
    pub package_digest: String,
    pub files: Vec<PluginInstallSourceFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRuntimeArtifactIntegrityPayload {
    pub artifact_path: String,
    pub sha256: String,
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
    pub manifest: Option<serde_json::Value>,
    pub manifest_modified_at_ms: Option<u64>,
    pub contract_path: Option<String>,
    pub contract_raw: Option<String>,
    pub contract: Option<serde_json::Value>,
    pub contract_modified_at_ms: Option<u64>,
    pub runtime_path: Option<String>,
    pub runtime_raw: Option<String>,
    pub runtime_exists: Option<bool>,
    pub runtime_modified_at_ms: Option<u64>,
    pub icon_path: Option<String>,
    pub icon_raw_base64: Option<String>,
    pub icon_exists: Option<bool>,
    pub icon_modified_at_ms: Option<u64>,
    pub sidecar_path: Option<String>,
    pub sidecar_exists: Option<bool>,
    pub sidecar_modified_at_ms: Option<u64>,
    pub diagnostics: Vec<PlatformPackDevSourceDiagnostic>,
}

fn normalize_display_path(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    normalized
        .strip_prefix("//?/")
        .map(|value| value.to_string())
        .unwrap_or(normalized)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn compute_install_source_tree_digest(files: &[PluginInstallSourceFile]) -> String {
    let mut sorted_files: Vec<&PluginInstallSourceFile> = files.iter().collect();
    sorted_files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    let mut hasher = Sha256::new();
    for file in sorted_files {
        hasher.update(file.relative_path.as_bytes());
        hasher.update([0]);
        hasher.update(&file.bytes);
        hasher.update([0]);
    }
    format!("{:x}", hasher.finalize())
}

fn push_plugin_install_source_diagnostic(
    diagnostics: &mut Vec<PluginInstallSourceDiagnostic>,
    severity: &str,
    code: &str,
    message: String,
) {
    diagnostics.push(PluginInstallSourceDiagnostic {
        severity: severity.to_string(),
        code: code.to_string(),
        message,
    });
}

fn plugin_install_source_has_errors(diagnostics: &[PluginInstallSourceDiagnostic]) -> bool {
    diagnostics
        .iter()
        .any(|diagnostic| diagnostic.severity == "error")
}

fn expect_manifest_object<'a>(
    value: Option<&'a serde_json::Value>,
    label: &str,
    diagnostics: &mut Vec<PluginInstallSourceDiagnostic>,
) -> Option<&'a serde_json::Map<String, serde_json::Value>> {
    match value.and_then(|value| value.as_object()) {
        Some(object) => Some(object),
        None => {
            push_plugin_install_source_diagnostic(
                diagnostics,
                "error",
                &format!("{label}.object"),
                format!("{label} must be an object"),
            );
            None
        }
    }
}

fn expect_manifest_array<'a>(
    value: Option<&'a serde_json::Value>,
    label: &str,
    diagnostics: &mut Vec<PluginInstallSourceDiagnostic>,
) -> Option<&'a Vec<serde_json::Value>> {
    match value.and_then(|value| value.as_array()) {
        Some(array) => Some(array),
        None => {
            push_plugin_install_source_diagnostic(
                diagnostics,
                "error",
                &format!("{label}.array"),
                format!("{label} must be an array"),
            );
            None
        }
    }
}

fn normalize_manifest_string(
    value: Option<&serde_json::Value>,
    label: &str,
    diagnostics: &mut Vec<PluginInstallSourceDiagnostic>,
) -> Option<String> {
    let Some(value) = value.and_then(|value| value.as_str()) else {
        push_plugin_install_source_diagnostic(
            diagnostics,
            "error",
            &format!("{label}.required"),
            format!("{label} is required"),
        );
        return None;
    };

    let trimmed = value.trim();
    if trimmed.is_empty() {
        push_plugin_install_source_diagnostic(
            diagnostics,
            "error",
            &format!("{label}.required"),
            format!("{label} is required"),
        );
        return None;
    }

    Some(trimmed.to_string())
}

fn validate_manifest_string_array(
    value: Option<&serde_json::Value>,
    label: &str,
    diagnostics: &mut Vec<PluginInstallSourceDiagnostic>,
) {
    let Some(value) = value else {
        return;
    };
    let Some(array) = expect_manifest_array(Some(value), label, diagnostics) else {
        return;
    };

    for (index, entry) in array.iter().enumerate() {
        normalize_manifest_string(Some(entry), &format!("{label}[{index}]"), diagnostics);
    }
}

fn collapse_manifest_slashes(value: &str) -> String {
    let mut collapsed = String::with_capacity(value.len());
    let mut previous_was_slash = false;
    for character in value.chars() {
        if character == '/' {
            if !previous_was_slash {
                collapsed.push(character);
            }
            previous_was_slash = true;
        } else {
            collapsed.push(character);
            previous_was_slash = false;
        }
    }
    collapsed
}

fn normalize_manifest_relative_path(
    value: &str,
    label: &str,
    diagnostics: &mut Vec<PluginInstallSourceDiagnostic>,
) -> Option<String> {
    let mut normalized = value.trim().replace('\\', "/");
    while normalized.starts_with("./") {
        normalized = normalized[2..].to_string();
    }
    normalized = collapse_manifest_slashes(&normalized);

    if normalized.is_empty() {
        push_plugin_install_source_diagnostic(
            diagnostics,
            "error",
            &format!("{label}.required"),
            format!("{label} is required"),
        );
        return None;
    }

    let looks_like_windows_drive = normalized.len() >= 3
        && normalized.as_bytes()[1] == b':'
        && normalized.as_bytes()[2] == b'/'
        && normalized.as_bytes()[0].is_ascii_alphabetic();
    if normalized.starts_with('/') || looks_like_windows_drive {
        push_plugin_install_source_diagnostic(
            diagnostics,
            "error",
            &format!("{label}.relative"),
            format!("{label} must be relative"),
        );
        return None;
    }

    if normalized
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        push_plugin_install_source_diagnostic(
            diagnostics,
            "error",
            &format!("{label}.segments"),
            format!("{label} contains invalid segments"),
        );
        return None;
    }

    Some(normalized)
}

fn validate_manifest_relative_path_value(
    value: Option<&serde_json::Value>,
    label: &str,
    diagnostics: &mut Vec<PluginInstallSourceDiagnostic>,
) -> Option<String> {
    let value = normalize_manifest_string(value, label, diagnostics)?;
    normalize_manifest_relative_path(&value, label, diagnostics)
}

fn is_manifest_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 48
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn validate_manifest_capability_requirements(
    value: Option<&serde_json::Value>,
    label: &str,
    diagnostics: &mut Vec<PluginInstallSourceDiagnostic>,
) {
    let Some(value) = value else {
        return;
    };
    let Some(array) = expect_manifest_array(Some(value), label, diagnostics) else {
        return;
    };

    for (index, entry) in array.iter().enumerate() {
        let Some(requirement) =
            expect_manifest_object(Some(entry), &format!("{label}[{index}]"), diagnostics)
        else {
            continue;
        };
        normalize_manifest_string(
            requirement.get("capabilityId"),
            &format!("{label}[{index}].capabilityId"),
            diagnostics,
        );
        if let Some(version_range) = requirement.get("versionRange") {
            normalize_manifest_string(
                Some(version_range),
                &format!("{label}[{index}].versionRange"),
                diagnostics,
            );
        }
        validate_manifest_string_array(
            requirement.get("reasons"),
            &format!("{label}[{index}].reasons"),
            diagnostics,
        );
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct ManifestContributionValidationOptions {
    validate_dimensions: bool,
    validate_inputs: bool,
    validate_shell_surface: bool,
}

fn validate_manifest_contribution_array(
    value: Option<&serde_json::Value>,
    label: &str,
    options: ManifestContributionValidationOptions,
    diagnostics: &mut Vec<PluginInstallSourceDiagnostic>,
) {
    let Some(value) = value else {
        return;
    };
    let Some(array) = expect_manifest_array(Some(value), label, diagnostics) else {
        return;
    };

    let mut ids = HashSet::new();
    for item in array {
        let Some(record) =
            expect_manifest_object(Some(item), &format!("{label} entries"), diagnostics)
        else {
            continue;
        };
        let Some(id) =
            normalize_manifest_string(record.get("id"), &format!("{label}[].id"), diagnostics)
        else {
            continue;
        };

        if !is_manifest_id(&id) {
            push_plugin_install_source_diagnostic(
                diagnostics,
                "error",
                &format!("{label}.id.invalid"),
                format!("{label}[].id must match /^[a-z0-9-]{{1,48}}$/"),
            );
        }
        if !ids.insert(id.clone()) {
            push_plugin_install_source_diagnostic(
                diagnostics,
                "error",
                &format!("{label}.id.duplicated"),
                format!("{label}[].id duplicated: \"{id}\""),
            );
        }

        normalize_manifest_string(
            record.get("title"),
            &format!("{label}[\"{id}\"].title"),
            diagnostics,
        );
        if let Some(description) = record.get("description") {
            normalize_manifest_string(
                Some(description),
                &format!("{label}[\"{id}\"].description"),
                diagnostics,
            );
        }
        if let Some(group) = record.get("group") {
            normalize_manifest_string(
                Some(group),
                &format!("{label}[\"{id}\"].group"),
                diagnostics,
            );
        }
        if let Some(order) = record.get("order") {
            if order.as_f64().is_none() {
                push_plugin_install_source_diagnostic(
                    diagnostics,
                    "error",
                    &format!("{label}.{id}.order"),
                    format!("{label}[\"{id}\"].order must be a number"),
                );
            }
        }
        validate_manifest_string_array(
            record.get("tags"),
            &format!("{label}[\"{id}\"].tags"),
            diagnostics,
        );
        if let Some(metadata) = record.get("metadata") {
            expect_manifest_object(
                Some(metadata),
                &format!("{label}[\"{id}\"].metadata"),
                diagnostics,
            );
        }

        if options.validate_dimensions {
            for field in ["width", "height"] {
                if let Some(value) = record.get(field) {
                    if value.as_f64().filter(|number| *number > 0.0).is_none() {
                        push_plugin_install_source_diagnostic(
                            diagnostics,
                            "error",
                            &format!("{label}.{id}.{field}"),
                            format!("{label}[\"{id}\"].{field} must be a positive number"),
                        );
                    }
                }
            }
        }

        if options.validate_shell_surface {
            match record.get("surfaceType").and_then(|value| value.as_str()) {
                Some("overlay" | "desktop-widget") => {}
                _ => push_plugin_install_source_diagnostic(
                    diagnostics,
                    "error",
                    &format!("{label}.{id}.surfaceType"),
                    format!(
                        "{label}[\"{id}\"].surfaceType must be \"overlay\" or \"desktop-widget\""
                    ),
                ),
            }
            if let Some(pointer_policy) = record.get("pointerPolicy") {
                match pointer_policy.as_str() {
                    Some("capture-input" | "passthrough") => {}
                    _ => push_plugin_install_source_diagnostic(
                        diagnostics,
                        "error",
                        &format!("{label}.{id}.pointerPolicy"),
                        format!(
                            "{label}[\"{id}\"].pointerPolicy must be \"capture-input\" or \"passthrough\""
                        ),
                    ),
                }
            }
            for field in ["alwaysOnTop", "focusable", "dismissOnEscape"] {
                if let Some(value) = record.get(field) {
                    if !value.is_boolean() {
                        push_plugin_install_source_diagnostic(
                            diagnostics,
                            "error",
                            &format!("{label}.{id}.{field}"),
                            format!("{label}[\"{id}\"].{field} must be a boolean"),
                        );
                    }
                }
            }
        }

        if options.validate_inputs {
            validate_manifest_string_array(
                record.get("inputs"),
                &format!("{label}[\"{id}\"].inputs"),
                diagnostics,
            );
        }
    }
}

fn validate_manifest_pmp_host_magnet_descriptor(
    value: Option<&serde_json::Value>,
    label: &str,
    diagnostics: &mut Vec<PluginInstallSourceDiagnostic>,
) {
    let Some(value) = value else {
        return;
    };
    let Some(magnet) = expect_manifest_object(Some(value), label, diagnostics) else {
        return;
    };

    if let Some(default_anchor_value) = magnet.get("defaultAnchor") {
        let Some(default_anchor) = expect_manifest_object(
            Some(default_anchor_value),
            &format!("{label}.defaultAnchor"),
            diagnostics,
        ) else {
            return;
        };
        if let Some(anchor_type) = default_anchor.get("type") {
            match anchor_type.as_str() {
                Some("single" | "range") => {}
                _ => push_plugin_install_source_diagnostic(
                    diagnostics,
                    "error",
                    &format!("{label}.defaultAnchor.type"),
                    format!("{label}.defaultAnchor.type must be \"single\" or \"range\""),
                ),
            }
        }

        if let Some(coordinates_value) = default_anchor.get("coordinates") {
            let Some(coordinates) = expect_manifest_array(
                Some(coordinates_value),
                &format!("{label}.defaultAnchor.coordinates"),
                diagnostics,
            ) else {
                return;
            };

            for item in coordinates {
                let Some(coordinate) = expect_manifest_object(
                    Some(item),
                    &format!("{label}.defaultAnchor.coordinates"),
                    diagnostics,
                ) else {
                    continue;
                };
                let valid = coordinate
                    .get("x")
                    .and_then(|value| value.as_f64())
                    .is_some()
                    && coordinate
                        .get("y")
                        .and_then(|value| value.as_f64())
                        .is_some();
                if !valid {
                    push_plugin_install_source_diagnostic(
                        diagnostics,
                        "error",
                        &format!("{label}.defaultAnchor.coordinates.item"),
                        format!(
                            "{label}.defaultAnchor.coordinates must be an array of {{x:number,y:number}}"
                        ),
                    );
                }
            }
        }
    }

    if let Some(default_style) = magnet.get("defaultStyle") {
        expect_manifest_object(
            Some(default_style),
            &format!("{label}.defaultStyle"),
            diagnostics,
        );
    }

    if let Some(default_variant) = magnet.get("defaultVariant") {
        if let Some(default_variant) = normalize_manifest_string(
            Some(default_variant),
            &format!("{label}.defaultVariant"),
            diagnostics,
        ) {
            if !is_manifest_id(&default_variant) {
                push_plugin_install_source_diagnostic(
                    diagnostics,
                    "error",
                    &format!("{label}.defaultVariant.invalid"),
                    format!("{label}.defaultVariant must match /^[a-z0-9-]{{1,48}}$/"),
                );
            }
        }
    }

    let mut variant_ids = HashSet::new();
    if let Some(variants_value) = magnet.get("variants") {
        let Some(variants) = expect_manifest_array(
            Some(variants_value),
            &format!("{label}.variants"),
            diagnostics,
        ) else {
            return;
        };

        for item in variants {
            let Some(variant) =
                expect_manifest_object(Some(item), &format!("{label}.variants"), diagnostics)
            else {
                continue;
            };
            let Some(variant_id) = normalize_manifest_string(
                variant.get("id"),
                &format!("{label}.variants[].id"),
                diagnostics,
            ) else {
                continue;
            };
            if !is_manifest_id(&variant_id) {
                push_plugin_install_source_diagnostic(
                    diagnostics,
                    "error",
                    &format!("{label}.variants.id.invalid"),
                    format!("{label}.variants[].id must match /^[a-z0-9-]{{1,48}}$/"),
                );
            }
            if !variant_ids.insert(variant_id.clone()) {
                push_plugin_install_source_diagnostic(
                    diagnostics,
                    "error",
                    &format!("{label}.variants.id.duplicated"),
                    format!("{label}.variants[].id duplicated: \"{variant_id}\""),
                );
            }

            normalize_manifest_string(
                variant.get("label"),
                &format!("{label}.variants[\"{variant_id}\"].label"),
                diagnostics,
            );
            if let Some(description) = variant.get("description") {
                normalize_manifest_string(
                    Some(description),
                    &format!("{label}.variants[\"{variant_id}\"].description"),
                    diagnostics,
                );
            }
            if let Some(metadata) = variant.get("metadata") {
                expect_manifest_object(
                    Some(metadata),
                    &format!("{label}.variants[\"{variant_id}\"].metadata"),
                    diagnostics,
                );
            }
        }

        if let Some(default_variant) = magnet
            .get("defaultVariant")
            .and_then(|value| value.as_str())
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            if !variant_ids.contains(default_variant) {
                push_plugin_install_source_diagnostic(
                    diagnostics,
                    "error",
                    &format!("{label}.defaultVariant.missing"),
                    format!("{label}.defaultVariant must exist in {label}.variants"),
                );
            }
        }
    }
}

fn validate_manifest_host_contributions(
    value: Option<&serde_json::Value>,
    label: &str,
    diagnostics: &mut Vec<PluginInstallSourceDiagnostic>,
) {
    let Some(value) = value else {
        return;
    };
    let Some(host) = expect_manifest_object(Some(value), label, diagnostics) else {
        return;
    };
    let Some(pmp_value) = host.get("pmp") else {
        return;
    };
    let Some(pmp) = expect_manifest_object(Some(pmp_value), &format!("{label}.pmp"), diagnostics)
    else {
        return;
    };

    validate_manifest_contribution_array(
        pmp.get("pages"),
        &format!("{label}.pmp.pages"),
        ManifestContributionValidationOptions::default(),
        diagnostics,
    );
    validate_manifest_contribution_array(
        pmp.get("windows"),
        &format!("{label}.pmp.windows"),
        ManifestContributionValidationOptions {
            validate_dimensions: true,
            ..Default::default()
        },
        diagnostics,
    );
    validate_manifest_contribution_array(
        pmp.get("shellSurfaces"),
        &format!("{label}.pmp.shellSurfaces"),
        ManifestContributionValidationOptions {
            validate_dimensions: true,
            validate_shell_surface: true,
            ..Default::default()
        },
        diagnostics,
    );
    validate_manifest_contribution_array(
        pmp.get("settingsPanels"),
        &format!("{label}.pmp.settingsPanels"),
        ManifestContributionValidationOptions::default(),
        diagnostics,
    );
    validate_manifest_contribution_array(
        pmp.get("visualizers"),
        &format!("{label}.pmp.visualizers"),
        ManifestContributionValidationOptions {
            validate_inputs: true,
            ..Default::default()
        },
        diagnostics,
    );
    validate_manifest_pmp_host_magnet_descriptor(
        pmp.get("magnets"),
        &format!("{label}.pmp.magnets"),
        diagnostics,
    );
}

fn validate_extension_manifest_value(
    manifest: &serde_json::Value,
) -> Vec<PluginInstallSourceDiagnostic> {
    let mut diagnostics = Vec::new();
    let Some(object) = expect_manifest_object(Some(manifest), "manifest", &mut diagnostics) else {
        return diagnostics;
    };

    if object.get("schemaVersion").and_then(|value| value.as_str()) != Some("2.0") {
        push_plugin_install_source_diagnostic(
            &mut diagnostics,
            "error",
            "manifest.schemaVersion",
            "manifest.schemaVersion must be \"2.0\"".to_string(),
        );
    }
    if object.get("kind").and_then(|value| value.as_str()) != Some("extension") {
        push_plugin_install_source_diagnostic(
            &mut diagnostics,
            "error",
            "manifest.kind",
            "manifest.kind must be \"extension\"".to_string(),
        );
    }

    if let Some(identity) = expect_manifest_object(
        object.get("identity"),
        "manifest.identity",
        &mut diagnostics,
    ) {
        for field in ["id", "publisher", "version", "name"] {
            normalize_manifest_string(
                identity.get(field),
                &format!("manifest.identity.{field}"),
                &mut diagnostics,
            );
        }
    }

    match object.get("hostTargets").and_then(|value| value.as_array()) {
        Some(host_targets) if !host_targets.is_empty() => {
            for (index, entry) in host_targets.iter().enumerate() {
                let Some(target) = expect_manifest_object(
                    Some(entry),
                    &format!("manifest.hostTargets[{index}]"),
                    &mut diagnostics,
                ) else {
                    continue;
                };
                normalize_manifest_string(
                    target.get("hostId"),
                    &format!("manifest.hostTargets[{index}].hostId"),
                    &mut diagnostics,
                );
            }
        }
        _ => push_plugin_install_source_diagnostic(
            &mut diagnostics,
            "error",
            "manifest.hostTargets",
            "manifest.hostTargets must be a non-empty array".to_string(),
        ),
    }

    match object.get("runtimes").and_then(|value| value.as_array()) {
        Some(runtimes) if !runtimes.is_empty() => {
            for (index, entry) in runtimes.iter().enumerate() {
                let Some(runtime) = expect_manifest_object(
                    Some(entry),
                    &format!("manifest.runtimes[{index}]"),
                    &mut diagnostics,
                ) else {
                    continue;
                };
                normalize_manifest_string(
                    runtime.get("runtimeId"),
                    &format!("manifest.runtimes[{index}].runtimeId"),
                    &mut diagnostics,
                );
                if let Some(kind) = normalize_manifest_string(
                    runtime.get("kind"),
                    &format!("manifest.runtimes[{index}].kind"),
                    &mut diagnostics,
                ) {
                    if !["extension-host", "webview", "sidecar"].contains(&kind.as_str()) {
                        push_plugin_install_source_diagnostic(
                            &mut diagnostics,
                            "error",
                            &format!("manifest.runtimes[{index}].kind"),
                            format!(
                                "manifest.runtimes[{index}].kind must be one of extension-host, webview, sidecar"
                            ),
                        );
                    }
                }
                validate_manifest_relative_path_value(
                    runtime.get("entry"),
                    &format!("manifest.runtimes[{index}].entry"),
                    &mut diagnostics,
                );
                validate_manifest_string_array(
                    runtime.get("platform"),
                    &format!("manifest.runtimes[{index}].platform"),
                    &mut diagnostics,
                );
                validate_manifest_string_array(
                    runtime.get("arch"),
                    &format!("manifest.runtimes[{index}].arch"),
                    &mut diagnostics,
                );
            }
        }
        _ => push_plugin_install_source_diagnostic(
            &mut diagnostics,
            "error",
            "manifest.runtimes",
            "manifest.runtimes must be a non-empty array".to_string(),
        ),
    }

    validate_manifest_capability_requirements(
        object.get("requiresCapabilities"),
        "manifest.requiresCapabilities",
        &mut diagnostics,
    );
    validate_manifest_capability_requirements(
        object.get("optionalCapabilities"),
        "manifest.optionalCapabilities",
        &mut diagnostics,
    );

    if let Some(contributes_value) = object.get("contributes") {
        if let Some(contributes) = expect_manifest_object(
            Some(contributes_value),
            "manifest.contributes",
            &mut diagnostics,
        ) {
            validate_manifest_host_contributions(
                contributes.get("host"),
                "manifest.contributes.host",
                &mut diagnostics,
            );
        }
    }

    diagnostics
}

fn validate_runtime_artifact_digest_metadata(
    expected_sha256: &str,
    artifact_path: &str,
) -> Result<String, String> {
    let normalized = expected_sha256.trim().to_ascii_lowercase();
    if normalized.len() != 64
        || !normalized
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(format!(
            "Invalid runtime artifact digest metadata: {artifact_path}"
        ));
    }
    Ok(normalized)
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
    let mut normalized = path.trim().replace('\\', "/");
    while normalized.starts_with("./") {
        normalized = normalized[2..].to_string();
    }
    let normalized = collapse_manifest_slashes(&normalized);
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

fn platform_pack_dev_json_object<'a>(
    value: &'a serde_json::Value,
    message: &str,
) -> Result<&'a serde_json::Map<String, serde_json::Value>, String> {
    value.as_object().ok_or_else(|| message.to_string())
}

fn platform_pack_dev_child_object<'a>(
    object: &'a serde_json::Map<String, serde_json::Value>,
    field: &str,
    label: &str,
) -> Result<&'a serde_json::Map<String, serde_json::Value>, String> {
    object
        .get(field)
        .and_then(|value| value.as_object())
        .ok_or_else(|| format!("{label} must be an object"))
}

fn platform_pack_dev_string(value: Option<&serde_json::Value>) -> String {
    value
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

fn platform_pack_dev_optional_string(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Option<String> {
    let value = platform_pack_dev_string(object.get(field));
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn platform_pack_dev_optional_enum_string(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
    allowed: &[&str],
) -> Option<String> {
    let value = platform_pack_dev_string(object.get(field));
    if allowed.contains(&value.as_str()) {
        Some(value)
    } else {
        None
    }
}

fn platform_pack_dev_required_relative_path(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
    label: &str,
) -> Result<String, String> {
    let raw = platform_pack_dev_string(object.get(field));
    normalize_platform_pack_dev_relative_path(&raw, label)
}

fn insert_optional_platform_pack_dev_string(
    object: &mut serde_json::Map<String, serde_json::Value>,
    field: &str,
    value: Option<String>,
) {
    if let Some(value) = value {
        object.insert(field.to_string(), serde_json::Value::String(value));
    }
}

fn normalize_platform_pack_dev_manifest(
    manifest: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let object = platform_pack_dev_json_object(manifest, "manifest.json must be an object")?;
    if object.get("formatVersion").and_then(|value| value.as_str()) != Some("1.0") {
        return Err("manifest.formatVersion must be \"1.0\"".to_string());
    }
    if object.get("type").and_then(|value| value.as_str()) != Some("platform-pack") {
        return Err("manifest.type must be \"platform-pack\"".to_string());
    }

    let metadata = platform_pack_dev_child_object(object, "metadata", "manifest.metadata")?;
    let connector = platform_pack_dev_child_object(object, "connector", "manifest.connector")?;
    let entry = platform_pack_dev_child_object(object, "entry", "manifest.entry")?;
    let connector_id = platform_pack_dev_string(connector.get("connectorId")).to_ascii_lowercase();
    if !connector_id.starts_with("connector.platform.") {
        return Err(
            "manifest.connector.connectorId must start with connector.platform.".to_string(),
        );
    }

    let contract_path =
        platform_pack_dev_required_relative_path(entry, "contract", "manifest.entry.contract")?;
    let runtime_path =
        platform_pack_dev_required_relative_path(entry, "runtime", "manifest.entry.runtime")?;
    let icon_path = platform_pack_dev_required_relative_path(entry, "icon", "manifest.entry.icon")?;
    let sidecar_path = match entry.get("sidecar") {
        Some(_) => Some(platform_pack_dev_required_relative_path(
            entry,
            "sidecar",
            "manifest.entry.sidecar",
        )?),
        None => None,
    };

    let metadata_id = platform_pack_dev_string(metadata.get("id"));
    if metadata_id.is_empty() {
        return Err("manifest.metadata.id is required".to_string());
    }
    let metadata_name = platform_pack_dev_string(metadata.get("name"));
    if metadata_name.is_empty() {
        return Err("manifest.metadata.name is required".to_string());
    }
    let metadata_version = platform_pack_dev_string(metadata.get("version"));
    if metadata_version.is_empty() {
        return Err("manifest.metadata.version is required".to_string());
    }
    let workspace_kind = platform_pack_dev_string(connector.get("workspaceKind"));
    if workspace_kind.is_empty() {
        return Err("manifest.connector.workspaceKind is required".to_string());
    }

    let mut metadata_value = serde_json::Map::new();
    metadata_value.insert("id".to_string(), serde_json::Value::String(metadata_id));
    metadata_value.insert("name".to_string(), serde_json::Value::String(metadata_name));
    metadata_value.insert(
        "version".to_string(),
        serde_json::Value::String(metadata_version),
    );
    insert_optional_platform_pack_dev_string(
        &mut metadata_value,
        "author",
        platform_pack_dev_optional_string(metadata, "author"),
    );
    insert_optional_platform_pack_dev_string(
        &mut metadata_value,
        "description",
        platform_pack_dev_optional_string(metadata, "description"),
    );
    if let Some(tags) = metadata.get("tags").and_then(|value| value.as_array()) {
        let normalized_tags: Vec<serde_json::Value> = tags
            .iter()
            .map(|item| platform_pack_dev_string(Some(item)))
            .filter(|item| !item.is_empty())
            .map(serde_json::Value::String)
            .collect();
        metadata_value.insert(
            "tags".to_string(),
            serde_json::Value::Array(normalized_tags),
        );
    }

    let mut connector_value = serde_json::Map::new();
    connector_value.insert(
        "connectorId".to_string(),
        serde_json::Value::String(connector_id),
    );
    insert_optional_platform_pack_dev_string(
        &mut connector_value,
        "displayName",
        platform_pack_dev_optional_string(connector, "displayName"),
    );
    insert_optional_platform_pack_dev_string(
        &mut connector_value,
        "labelKey",
        platform_pack_dev_optional_string(connector, "labelKey"),
    );
    insert_optional_platform_pack_dev_string(
        &mut connector_value,
        "iconKey",
        platform_pack_dev_optional_string(connector, "iconKey"),
    );
    insert_optional_platform_pack_dev_string(
        &mut connector_value,
        "platformTemplate",
        platform_pack_dev_optional_enum_string(
            connector,
            "platformTemplate",
            &["music", "video", "generic"],
        ),
    );
    connector_value.insert(
        "workspaceKind".to_string(),
        serde_json::Value::String(workspace_kind),
    );
    insert_optional_platform_pack_dev_string(
        &mut connector_value,
        "workspaceMode",
        platform_pack_dev_optional_enum_string(
            connector,
            "workspaceMode",
            &["generic-only", "dedicated"],
        ),
    );
    insert_optional_platform_pack_dev_string(
        &mut connector_value,
        "authFlow",
        platform_pack_dev_optional_enum_string(connector, "authFlow", &["qr", "none"]),
    );
    if let Some(enabled) = connector.get("enabled").and_then(|value| value.as_bool()) {
        connector_value.insert("enabled".to_string(), serde_json::Value::Bool(enabled));
    }
    if let Some(sort_order) = connector.get("sortOrder").and_then(|value| value.as_f64()) {
        if let Some(number) = serde_json::Number::from_f64(sort_order) {
            connector_value.insert("sortOrder".to_string(), serde_json::Value::Number(number));
        }
    }
    insert_optional_platform_pack_dev_string(
        &mut connector_value,
        "accentColor",
        platform_pack_dev_optional_string(connector, "accentColor"),
    );

    let mut entry_value = serde_json::Map::new();
    entry_value.insert(
        "contract".to_string(),
        serde_json::Value::String(contract_path),
    );
    entry_value.insert(
        "runtime".to_string(),
        serde_json::Value::String(runtime_path),
    );
    entry_value.insert("icon".to_string(), serde_json::Value::String(icon_path));
    insert_optional_platform_pack_dev_string(&mut entry_value, "sidecar", sidecar_path);

    let mut normalized = serde_json::Map::new();
    normalized.insert(
        "formatVersion".to_string(),
        serde_json::Value::String("1.0".to_string()),
    );
    normalized.insert(
        "type".to_string(),
        serde_json::Value::String("platform-pack".to_string()),
    );
    normalized.insert(
        "metadata".to_string(),
        serde_json::Value::Object(metadata_value),
    );
    normalized.insert(
        "connector".to_string(),
        serde_json::Value::Object(connector_value),
    );
    normalized.insert("entry".to_string(), serde_json::Value::Object(entry_value));
    Ok(serde_json::Value::Object(normalized))
}

fn normalize_platform_pack_dev_contract(
    contract: &serde_json::Value,
    manifest_connector_id: &str,
) -> Result<serde_json::Value, String> {
    let object = platform_pack_dev_json_object(contract, "contract.json must be an object")?;
    if object
        .get("contractVersion")
        .and_then(|value| value.as_str())
        != Some("1.0")
    {
        return Err("contract.contractVersion must be \"1.0\"".to_string());
    }

    let platform = platform_pack_dev_child_object(object, "platform", "contract.platform")?;
    let auth = platform_pack_dev_child_object(object, "auth", "contract.auth")?;
    let capabilities =
        platform_pack_dev_child_object(object, "capabilities", "contract.capabilities")?;
    let api_bindings =
        platform_pack_dev_child_object(object, "apiBindings", "contract.apiBindings")?;

    let extension_connector_id = object
        .get("extension")
        .and_then(|value| value.as_object())
        .map(|extension| {
            platform_pack_dev_string(extension.get("connectorId")).to_ascii_lowercase()
        })
        .unwrap_or_default();
    if !extension_connector_id.is_empty() && extension_connector_id != manifest_connector_id {
        return Err(format!(
            "contract.extension.connectorId must match manifest.connector.connectorId ({manifest_connector_id})"
        ));
    }

    let mut platform_value = serde_json::Map::new();
    platform_value.insert(
        "platformId".to_string(),
        serde_json::Value::String(platform_pack_dev_string(platform.get("platformId"))),
    );
    platform_value.insert(
        "displayName".to_string(),
        serde_json::Value::String(platform_pack_dev_string(platform.get("displayName"))),
    );
    platform_value.insert(
        "staticIcon".to_string(),
        serde_json::Value::String(platform_pack_dev_string(platform.get("staticIcon"))),
    );
    insert_optional_platform_pack_dev_string(
        &mut platform_value,
        "vendor",
        platform_pack_dev_optional_string(platform, "vendor"),
    );
    platform_value.insert(
        "supportsMultiInstance".to_string(),
        serde_json::Value::Bool(
            platform
                .get("supportsMultiInstance")
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
        ),
    );

    let login_mode = match platform_pack_dev_string(auth.get("loginMode")).as_str() {
        "none" | "cookie" | "qr" | "cookie+qr" => platform_pack_dev_string(auth.get("loginMode")),
        _ => "none".to_string(),
    };
    let mut auth_value = serde_json::Map::new();
    auth_value.insert(
        "loginMode".to_string(),
        serde_json::Value::String(login_mode),
    );
    for field in ["requiresCookie", "requiresAccountId", "supportsRefresh"] {
        auth_value.insert(
            field.to_string(),
            serde_json::Value::Bool(
                auth.get(field)
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false),
            ),
        );
    }

    let mut capabilities_value = serde_json::Map::new();
    for field in [
        "playlists",
        "favorites",
        "dailyRecommendations",
        "search",
        "quality",
        "navigation",
        "settings",
        "pages",
    ] {
        capabilities_value.insert(
            field.to_string(),
            serde_json::Value::Bool(
                capabilities
                    .get(field)
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false),
            ),
        );
    }

    let mut api_bindings_value = serde_json::Map::new();
    api_bindings_value.insert(
        "auth".to_string(),
        serde_json::Value::String(platform_pack_dev_string(api_bindings.get("auth"))),
    );
    for field in [
        "library",
        "recommendations",
        "search",
        "quality",
        "navigation",
        "settings",
        "pages",
    ] {
        insert_optional_platform_pack_dev_string(
            &mut api_bindings_value,
            field,
            platform_pack_dev_optional_string(api_bindings, field),
        );
    }

    let mut normalized = serde_json::Map::new();
    normalized.insert(
        "contractVersion".to_string(),
        serde_json::Value::String("1.0".to_string()),
    );
    normalized.insert(
        "platform".to_string(),
        serde_json::Value::Object(platform_value),
    );
    normalized.insert("auth".to_string(), serde_json::Value::Object(auth_value));
    normalized.insert(
        "capabilities".to_string(),
        serde_json::Value::Object(capabilities_value),
    );
    normalized.insert(
        "apiBindings".to_string(),
        serde_json::Value::Object(api_bindings_value),
    );
    if let Some(workspace) = object.get("workspace") {
        normalized.insert("workspace".to_string(), workspace.clone());
    }
    if let Some(extension) = object.get("extension").and_then(|value| value.as_object()) {
        normalized.insert(
            "extension".to_string(),
            serde_json::Value::Object(extension.clone()),
        );
    }

    Ok(serde_json::Value::Object(normalized))
}

fn platform_pack_dev_manifest_connector_id(manifest: &serde_json::Value) -> Option<String> {
    manifest
        .get("connector")
        .and_then(|connector| connector.get("connectorId"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
}

fn is_platform_pack_dev_supported_icon_path(path: &str) -> bool {
    let normalized = path.trim().to_ascii_lowercase();
    normalized.ends_with(".svg")
        || normalized.ends_with(".png")
        || normalized.ends_with(".jpg")
        || normalized.ends_with(".jpeg")
        || normalized.ends_with(".webp")
        || normalized.ends_with(".gif")
        || normalized.ends_with(".ico")
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

fn read_platform_pack_dev_modified_at_ms(path: &Path) -> Option<u64> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?;
    let duration = modified.duration_since(UNIX_EPOCH).ok()?;
    Some(duration.as_millis().min(u128::from(u64::MAX)) as u64)
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
        let sha256 = sha256_hex(&bytes);

        files.push(PluginInstallSourceFile {
            relative_path,
            bytes,
            sha256,
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

    let (validated_manifest, validation_diagnostics) =
        match serde_json::from_str::<serde_json::Value>(&manifest_raw) {
            Ok(manifest) => {
                let diagnostics = validate_extension_manifest_value(&manifest);
                if plugin_install_source_has_errors(&diagnostics) {
                    (None, diagnostics)
                } else {
                    (Some(manifest), diagnostics)
                }
            }
            Err(error) => {
                let mut diagnostics = Vec::new();
                push_plugin_install_source_diagnostic(
                    &mut diagnostics,
                    "error",
                    "manifest.invalid-json",
                    format!("manifest.v2.json contains invalid JSON: {error}"),
                );
                (None, diagnostics)
            }
        };

    let mut files = Vec::new();
    collect_install_source_files(&root_dir, &root_dir, &mut files)?;
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    let package_digest = compute_install_source_tree_digest(&files);

    Ok(PluginInstallSourcePayload {
        manifest_path: normalize_display_path(&manifest_path),
        root_dir: normalize_display_path(&root_dir),
        manifest_raw,
        validated_manifest,
        validation_diagnostics,
        package_digest,
        files,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn plugin_verify_runtime_artifact_integrity(
    artifact_path: String,
    expected_sha256: String,
) -> Result<PluginRuntimeArtifactIntegrityPayload, String> {
    let expected_sha256 =
        validate_runtime_artifact_digest_metadata(&expected_sha256, &artifact_path)?;
    let artifact_path_buf = normalize_install_source_path(&artifact_path)?;
    let bytes = fs::read(&artifact_path_buf).map_err(|error| {
        format!(
            "Failed to read runtime artifact {}: {}",
            normalize_display_path(&artifact_path_buf),
            error
        )
    })?;
    let actual_sha256 = sha256_hex(&bytes);

    if actual_sha256 != expected_sha256 {
        return Err(format!(
            "Runtime artifact integrity check failed (sha256 mismatch): {artifact_path}"
        ));
    }

    Ok(PluginRuntimeArtifactIntegrityPayload {
        artifact_path: normalize_display_path(&artifact_path_buf),
        sha256: actual_sha256,
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
    let manifest_modified_at_ms = read_platform_pack_dev_modified_at_ms(&manifest_path);
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

    let mut manifest = None;
    let mut contract_path = None;
    let mut contract_raw = None;
    let mut contract = None;
    let mut contract_modified_at_ms = None;
    let mut runtime_path = None;
    let mut runtime_raw = None;
    let mut runtime_exists = None;
    let mut runtime_modified_at_ms = None;
    let mut icon_path = None;
    let mut icon_raw_base64 = None;
    let mut icon_exists = None;
    let mut icon_modified_at_ms = None;
    let mut sidecar_path = None;
    let mut sidecar_exists = None;
    let mut sidecar_modified_at_ms = None;

    if let Some(raw) = manifest_raw.as_deref() {
        match serde_json::from_str::<serde_json::Value>(raw) {
            Ok(manifest_value) => {
                manifest = match normalize_platform_pack_dev_manifest(&manifest_value) {
                    Ok(value) => Some(value),
                    Err(message) => {
                        push_platform_pack_dev_diagnostic(
                            &mut diagnostics,
                            "error",
                            "manifest.invalid",
                            message,
                        );
                        None
                    }
                };

                if let Some(relative_path) = read_platform_pack_manifest_entry(
                    &manifest_value,
                    "contract",
                    true,
                    &mut diagnostics,
                ) {
                    let path = resolve_platform_pack_dev_entry_path(&root_dir, &relative_path);
                    contract_path = Some(normalize_display_path(&path));
                    contract_modified_at_ms = read_platform_pack_dev_modified_at_ms(&path);
                    contract_raw = read_platform_pack_dev_text_file(
                        &path,
                        &mut diagnostics,
                        "contract.missing",
                        "contract.read-failed",
                        format!("Contract entry is missing: {relative_path}"),
                    );
                    if let (Some(contract_raw), Some(manifest_connector_id)) = (
                        contract_raw.as_deref(),
                        manifest
                            .as_ref()
                            .and_then(platform_pack_dev_manifest_connector_id),
                    ) {
                        contract = match serde_json::from_str::<serde_json::Value>(contract_raw) {
                            Ok(contract_value) => match normalize_platform_pack_dev_contract(
                                &contract_value,
                                &manifest_connector_id,
                            ) {
                                Ok(value) => Some(value),
                                Err(message) => {
                                    push_platform_pack_dev_diagnostic(
                                        &mut diagnostics,
                                        "error",
                                        "contract.invalid",
                                        message,
                                    );
                                    None
                                }
                            },
                            Err(error) => {
                                push_platform_pack_dev_diagnostic(
                                    &mut diagnostics,
                                    "error",
                                    "contract.invalid",
                                    format!("contract.json contains invalid JSON: {error}"),
                                );
                                None
                            }
                        };
                    }
                }

                if let Some(relative_path) = read_platform_pack_manifest_entry(
                    &manifest_value,
                    "runtime",
                    true,
                    &mut diagnostics,
                ) {
                    let path = resolve_platform_pack_dev_entry_path(&root_dir, &relative_path);
                    let exists = path.exists();
                    runtime_path = Some(normalize_display_path(&path));
                    runtime_exists = Some(exists);
                    if exists {
                        runtime_modified_at_ms = read_platform_pack_dev_modified_at_ms(&path);
                        runtime_raw = read_platform_pack_dev_text_file(
                            &path,
                            &mut diagnostics,
                            "runtime.entry.missing",
                            "runtime.read-failed",
                            format!("Runtime entry is missing: {relative_path}"),
                        );
                        if runtime_raw
                            .as_deref()
                            .map(|value| value.trim().is_empty())
                            .unwrap_or(false)
                        {
                            push_platform_pack_dev_diagnostic(
                                &mut diagnostics,
                                "error",
                                "runtime.entry.empty",
                                format!(
                                    "Runtime entry is empty or could not be read: {relative_path}"
                                ),
                            );
                        }
                    } else {
                        push_platform_pack_dev_diagnostic(
                            &mut diagnostics,
                            "error",
                            "runtime.entry.missing",
                            format!("Runtime entry is missing: {relative_path}"),
                        );
                    }
                }

                if let Some(relative_path) = read_platform_pack_manifest_entry(
                    &manifest_value,
                    "icon",
                    true,
                    &mut diagnostics,
                ) {
                    let path = resolve_platform_pack_dev_entry_path(&root_dir, &relative_path);
                    let exists = path.exists();
                    icon_path = Some(normalize_display_path(&path));
                    icon_exists = Some(exists);
                    if !is_platform_pack_dev_supported_icon_path(&relative_path) {
                        push_platform_pack_dev_diagnostic(
                            &mut diagnostics,
                            "error",
                            "icon.entry.unsupported",
                            format!("Icon entry has an unsupported file type: {relative_path}"),
                        );
                    }
                    if exists {
                        icon_modified_at_ms = read_platform_pack_dev_modified_at_ms(&path);
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

                if let Some(relative_path) = read_platform_pack_manifest_entry(
                    &manifest_value,
                    "sidecar",
                    false,
                    &mut diagnostics,
                ) {
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
                    } else {
                        sidecar_modified_at_ms = read_platform_pack_dev_modified_at_ms(&path);
                    }
                }
            }
            Err(error) => {
                push_platform_pack_dev_diagnostic(
                    &mut diagnostics,
                    "error",
                    "manifest.invalid",
                    format!("manifest.json contains invalid JSON: {error}"),
                );
            }
        }
    }

    Ok(PlatformPackDevSourcePayload {
        root_dir: normalize_display_path(&root_dir),
        manifest_path: normalize_display_path(&manifest_path),
        manifest_raw,
        manifest,
        manifest_modified_at_ms,
        contract_path,
        contract_raw,
        contract,
        contract_modified_at_ms,
        runtime_path,
        runtime_raw,
        runtime_exists,
        runtime_modified_at_ms,
        icon_path,
        icon_raw_base64,
        icon_exists,
        icon_modified_at_ms,
        sidecar_path,
        sidecar_exists,
        sidecar_modified_at_ms,
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
        assert_eq!(payload.package_digest.len(), 64);
        assert_eq!(
            payload.package_digest,
            compute_install_source_tree_digest(&payload.files)
        );
        assert!(payload.files.iter().all(|file| file.sha256.len() == 64));
        assert!(payload.validated_manifest.is_none());
        assert!(payload.validation_diagnostics.iter().any(
            |diagnostic| diagnostic.message == "manifest.hostTargets must be a non-empty array"
        ));

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
    fn validates_manifest_and_returns_digest_metadata() {
        let root_dir = create_temp_dir("validated");
        let manifest_path = root_dir.join("manifest.v2.json");
        let entry_path = root_dir.join("index.js");

        write_file(
            &manifest_path,
            br#"{
              "schemaVersion": "2.0",
              "kind": "extension",
              "identity": {
                "id": "digest-demo",
                "publisher": "pixel-matrix.dev",
                "version": "0.1.0",
                "name": "digest-demo"
              },
              "hostTargets": [{ "hostId": "pmp", "required": true }],
              "runtimes": [{
                "runtimeId": "worker.main",
                "kind": "extension-host",
                "entry": "index.js"
              }]
            }"#,
        );
        write_file(&entry_path, b"export const demo = true;\n");

        let payload =
            plugin_read_install_source(root_dir.to_string_lossy().into_owned()).expect("payload");

        assert!(payload.validated_manifest.is_some());
        assert!(payload.validation_diagnostics.is_empty());
        assert_eq!(payload.package_digest.len(), 64);
        assert_eq!(
            payload.package_digest,
            compute_install_source_tree_digest(&payload.files)
        );
        assert!(payload
            .files
            .iter()
            .all(|file| file.sha256 == sha256_hex(&file.bytes)));

        fs::remove_dir_all(root_dir).ok();
    }

    #[test]
    fn verifies_runtime_artifact_sha256() {
        let root_dir = create_temp_dir("artifact-integrity");
        let artifact_path = root_dir.join("bin").join("sidecar.js");
        write_file(&artifact_path, b"console.log('sidecar');\n");
        let expected_sha256 = sha256_hex(&fs::read(&artifact_path).expect("read artifact"));

        let payload = plugin_verify_runtime_artifact_integrity(
            artifact_path.to_string_lossy().into_owned(),
            expected_sha256.clone(),
        )
        .expect("integrity payload");

        assert_eq!(payload.sha256, expected_sha256);
        assert!(payload.artifact_path.ends_with("/bin/sidecar.js"));

        let error = plugin_verify_runtime_artifact_integrity(
            artifact_path.to_string_lossy().into_owned(),
            "f".repeat(64),
        )
        .expect_err("mismatch");
        assert!(error.contains("Runtime artifact integrity check failed (sha256 mismatch)"));

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
        assert!(payload.manifest.is_some());
        assert!(payload.manifest_modified_at_ms.is_some());
        assert!(payload.contract_path.unwrap().ends_with("/contract.json"));
        assert!(payload.contract.is_some());
        assert!(payload.contract_modified_at_ms.is_some());
        assert!(payload
            .contract_raw
            .unwrap()
            .contains("\"contractVersion\""));
        assert!(payload.runtime_raw.unwrap().contains("mountPage"));
        assert_eq!(payload.runtime_exists, Some(true));
        assert!(payload.icon_raw_base64.is_some());
        assert_eq!(payload.icon_exists, Some(true));
        assert!(payload.diagnostics.is_empty());

        fs::remove_dir_all(root_dir).ok();
    }

    #[test]
    fn reports_platform_pack_contract_connector_mismatches_in_rust() {
        let root_dir = create_temp_dir("platform-pack-contract-mismatch");
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
        write_file(
            &root_dir.join("contract.json"),
            br#"{
              "contractVersion": "1.0",
              "platform": { "platformId": "demo", "displayName": "Demo", "staticIcon": "demo" },
              "auth": { "loginMode": "none" },
              "capabilities": {},
              "apiBindings": { "auth": "auth" },
              "extension": {
                "connectorId": "connector.platform.other"
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

        assert!(payload.manifest.is_some());
        assert!(payload.contract.is_none());
        assert!(payload
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "contract.invalid"
                && diagnostic.message.contains("connector.platform.demo")));

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
