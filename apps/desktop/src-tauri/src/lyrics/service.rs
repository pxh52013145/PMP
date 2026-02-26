use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use lofty::{file::TaggedFileExt, read_from_path, tag::ItemKey};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::lyrics::{
    domain::{LyricSourceKind, PMPLyricDocument},
    parser, repository,
};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricResolveRequest {
    pub entry_id: Option<String>,
    pub track_id: Option<String>,
    pub track_file_path: Option<String>,
    pub quick_fingerprint: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub duration_seconds: Option<f64>,
    pub embedded_lyrics: Option<String>,
    pub lyric_locator: Option<String>,
    pub cache_key: Option<String>,
    pub language: Option<String>,
    pub force_web_lookup: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricResolveQuery {
    pub entry_id: Option<String>,
    pub track_id: Option<String>,
    pub track_file_path: Option<String>,
    pub quick_fingerprint: Option<String>,
    pub cache_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricResolveResult {
    pub selection_key: String,
    pub selected: Option<PMPLyricDocument>,
    pub selected_source: Option<String>,
    pub tried_sources: Vec<String>,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LyricWriteBackPolicy {
    None,
    Sidecar,
    Embedded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricWriteBackRequest {
    pub query: LyricResolveQuery,
    pub track_file_path: Option<String>,
    pub policy: Option<LyricWriteBackPolicy>,
    pub format_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricWriteBackResult {
    pub applied: bool,
    pub policy: String,
    pub output_path: Option<String>,
    pub skipped_reason: Option<String>,
    pub updated_at_ms: i64,
}

pub fn resolve_for_track(
    app: &AppHandle,
    request: LyricResolveRequest,
) -> Result<LyricResolveResult, String> {
    let selection_key = derive_selection_key_from_request(&request).ok_or_else(|| {
        "Lyrics resolve requires entry_id/track_id/quick_fingerprint/track_file_path".to_string()
    })?;
    let cache_root = resolve_cache_root(app)?;

    let mut result = resolve_with_cache_root(&request, &selection_key, Some(cache_root.as_path()))?;

    if let Some(selected_document) = &result.selected {
        match repository::persist_selected_document(
            app,
            &selection_key,
            "system",
            selected_document,
        ) {
            Ok(persisted) => {
                result.selected = Some(persisted);
            }
            Err(error) => {
                result
                    .diagnostics
                    .push(format!("persist-selected-document-failed: {error}"));
            }
        }
    } else {
        let payload_json = serde_json::to_string(&request).ok();
        if let Err(error) = repository::enqueue_fetch_job(
            app,
            &selection_key,
            request.entry_id.as_deref(),
            request.track_id.as_deref(),
            payload_json.as_deref(),
        ) {
            result
                .diagnostics
                .push(format!("enqueue-fetch-job-failed: {error}"));
        }
    }

    Ok(result)
}

pub fn get_selected_for_query(
    app: &AppHandle,
    query: LyricResolveQuery,
) -> Result<Option<PMPLyricDocument>, String> {
    let Some(selection_key) = derive_selection_key_from_query(&query) else {
        return Ok(None);
    };
    repository::get_selected_document(app, &selection_key)
}

pub fn write_back_selected(
    app: &AppHandle,
    request: LyricWriteBackRequest,
) -> Result<LyricWriteBackResult, String> {
    let now = now_ms();
    let policy = request
        .policy
        .clone()
        .unwrap_or(LyricWriteBackPolicy::Sidecar);
    let policy_label = policy_label(&policy).to_string();

    let Some(selection_key) = derive_selection_key_from_query(&request.query) else {
        return Ok(LyricWriteBackResult {
            applied: false,
            policy: policy_label,
            output_path: None,
            skipped_reason: Some("missing-selection-key".to_string()),
            updated_at_ms: now,
        });
    };

    let Some(document) = repository::get_selected_document(app, &selection_key)? else {
        return Ok(LyricWriteBackResult {
            applied: false,
            policy: policy_label,
            output_path: None,
            skipped_reason: Some("no-selected-lyric".to_string()),
            updated_at_ms: now,
        });
    };

    match policy {
        LyricWriteBackPolicy::None => Ok(LyricWriteBackResult {
            applied: false,
            policy: policy_label,
            output_path: None,
            skipped_reason: Some("policy-none".to_string()),
            updated_at_ms: now,
        }),
        LyricWriteBackPolicy::Embedded => Ok(LyricWriteBackResult {
            applied: false,
            policy: policy_label,
            output_path: None,
            skipped_reason: Some("embedded-writeback-not-enabled".to_string()),
            updated_at_ms: now,
        }),
        LyricWriteBackPolicy::Sidecar => {
            let track_file_path = request
                .track_file_path
                .as_deref()
                .and_then(normalize_text)
                .or_else(|| {
                    request
                        .query
                        .track_file_path
                        .as_deref()
                        .and_then(normalize_text)
                })
                .ok_or_else(|| "sidecar write-back requires track_file_path".to_string())?;

            let base_path = PathBuf::from(track_file_path);
            let extension = normalize_format(
                request
                    .format_hint
                    .as_deref()
                    .or(Some(document.format.as_str())),
            )
            .unwrap_or_else(|| "lrc".to_string());

            let output_path = base_path.with_extension(match extension.as_str() {
                "plain" => "txt",
                other => other,
            });

            let content = if extension == "lrc" || extension == "yrc" {
                render_lrc_document(&document)
            } else {
                render_plain_document(&document)
            };

            fs::write(&output_path, content)
                .map_err(|error| format!("Write sidecar lyric failed: {error}"))?;

            Ok(LyricWriteBackResult {
                applied: true,
                policy: policy_label,
                output_path: Some(output_path.to_string_lossy().to_string()),
                skipped_reason: None,
                updated_at_ms: now,
            })
        }
    }
}

fn resolve_with_cache_root(
    request: &LyricResolveRequest,
    selection_key: &str,
    cache_root: Option<&Path>,
) -> Result<LyricResolveResult, String> {
    let mut tried_sources = Vec::new();
    let mut diagnostics = Vec::new();

    tried_sources.push("embedded".to_string());
    if let Some(document) = resolve_embedded_lyrics(request)? {
        return Ok(LyricResolveResult {
            selection_key: selection_key.to_string(),
            selected_source: Some("embedded".to_string()),
            selected: Some(document),
            tried_sources,
            diagnostics,
        });
    }

    tried_sources.push("sidecar".to_string());
    if let Some(document) = resolve_sidecar_lyrics(request)? {
        if let Some(root) = cache_root {
            if let Some(cache_key) = derive_cache_key(request, selection_key) {
                if let Err(error) = write_cache_document(root, &cache_key, &document) {
                    diagnostics.push(format!("cache-write-failed: {error}"));
                }
            }
        }

        return Ok(LyricResolveResult {
            selection_key: selection_key.to_string(),
            selected_source: Some("sidecar".to_string()),
            selected: Some(document),
            tried_sources,
            diagnostics,
        });
    }

    tried_sources.push("cache".to_string());
    if let Some(root) = cache_root {
        if let Some(cache_key) = derive_cache_key(request, selection_key) {
            if let Some(document) = resolve_cached_lyrics(request, root, &cache_key)? {
                return Ok(LyricResolveResult {
                    selection_key: selection_key.to_string(),
                    selected_source: Some("cache".to_string()),
                    selected: Some(document),
                    tried_sources,
                    diagnostics,
                });
            }
        }
    }

    tried_sources.push("web".to_string());
    match resolve_web_lyrics(request) {
        Ok(Some(document)) => {
            if let Some(root) = cache_root {
                if let Some(cache_key) = derive_cache_key(request, selection_key) {
                    if let Err(error) = write_cache_document(root, &cache_key, &document) {
                        diagnostics.push(format!("cache-write-failed: {error}"));
                    }
                }
            }
            Ok(LyricResolveResult {
                selection_key: selection_key.to_string(),
                selected_source: Some("web".to_string()),
                selected: Some(document),
                tried_sources,
                diagnostics,
            })
        }
        Ok(None) => Ok(LyricResolveResult {
            selection_key: selection_key.to_string(),
            selected_source: None,
            selected: None,
            tried_sources,
            diagnostics,
        }),
        Err(error) => {
            diagnostics.push(format!("web-resolve-failed: {error}"));
            Ok(LyricResolveResult {
                selection_key: selection_key.to_string(),
                selected_source: None,
                selected: None,
                tried_sources,
                diagnostics,
            })
        }
    }
}

fn resolve_embedded_lyrics(
    request: &LyricResolveRequest,
) -> Result<Option<PMPLyricDocument>, String> {
    if let Some(embedded) = request.embedded_lyrics.as_deref().and_then(normalize_text) {
        return Ok(parse_document(
            request,
            LyricSourceKind::Embedded,
            Some("embedded://request".to_string()),
            None,
            embedded,
        ));
    }

    let Some(track_file_path) = request.track_file_path.as_deref().and_then(normalize_text) else {
        return Ok(None);
    };

    let track_path = Path::new(track_file_path);
    let Some(embedded) = read_embedded_lyrics_from_file(track_path)? else {
        return Ok(None);
    };

    Ok(parse_document(
        request,
        LyricSourceKind::Embedded,
        Some(format!("embedded://{}", track_path.to_string_lossy())),
        None,
        &embedded,
    ))
}

fn read_embedded_lyrics_from_file(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let tagged_file = match read_from_path(path) {
        Ok(tagged_file) => tagged_file,
        Err(_) => return Ok(None),
    };

    for tag in tagged_file.tags() {
        if let Some(lyrics) = extract_lyrics_from_tag(tag) {
            return Ok(Some(lyrics));
        }
    }

    Ok(None)
}

fn extract_lyrics_from_tag(tag: &lofty::tag::Tag) -> Option<String> {
    if let Some(lyrics) = tag.get_string(&ItemKey::Lyrics).and_then(normalize_text) {
        return Some(lyrics.to_string());
    }

    tag.items()
        .filter_map(|item| {
            let maybe_key = match item.key() {
                ItemKey::Lyrics => Some("lyrics"),
                ItemKey::Unknown(key) => Some(key.as_str()),
                _ => None,
            };

            let key = maybe_key?;
            if !key.to_ascii_lowercase().contains("lyric") {
                return None;
            }

            item.value()
                .text()
                .and_then(normalize_text)
                .map(str::to_string)
                .or_else(|| {
                    item.value()
                        .locator()
                        .and_then(normalize_text)
                        .map(str::to_string)
                })
        })
        .next()
}

fn resolve_sidecar_lyrics(
    request: &LyricResolveRequest,
) -> Result<Option<PMPLyricDocument>, String> {
    let Some(track_file_path) = request.track_file_path.as_deref().and_then(normalize_text) else {
        return Ok(None);
    };

    let track_path = PathBuf::from(track_file_path);
    let stem = track_path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "track_file_path has no valid file stem".to_string())?;
    let parent = track_path
        .parent()
        .ok_or_else(|| "track_file_path has no parent directory".to_string())?;

    for (extension, format_hint) in [
        ("yrc", "yrc"),
        ("lrc", "lrc"),
        ("txt", "plain"),
        ("ass", "plain"),
    ] {
        let candidate_path = parent.join(format!("{stem}.{extension}"));
        if !candidate_path.exists() {
            continue;
        }

        let content = read_text_file(&candidate_path)?;
        if let Some(document) = parse_document(
            request,
            LyricSourceKind::Sidecar,
            Some(candidate_path.to_string_lossy().to_string()),
            Some(format_hint),
            &content,
        ) {
            return Ok(Some(document));
        }
    }

    Ok(None)
}

fn resolve_cached_lyrics(
    request: &LyricResolveRequest,
    cache_root: &Path,
    cache_key: &str,
) -> Result<Option<PMPLyricDocument>, String> {
    for (extension, format_hint) in [("yrc", "yrc"), ("lrc", "lrc"), ("txt", "plain")] {
        let candidate_path = cache_root.join(format!("{cache_key}.{extension}"));
        if !candidate_path.exists() {
            continue;
        }

        let content = read_text_file(&candidate_path)?;
        if let Some(document) = parse_document(
            request,
            LyricSourceKind::Cache,
            Some(candidate_path.to_string_lossy().to_string()),
            Some(format_hint),
            &content,
        ) {
            return Ok(Some(document));
        }
    }

    Ok(None)
}

fn resolve_web_lyrics(request: &LyricResolveRequest) -> Result<Option<PMPLyricDocument>, String> {
    let force_web_lookup = request.force_web_lookup.unwrap_or(false);
    let Some(locator) = request.lyric_locator.as_deref().and_then(normalize_text) else {
        return Ok(None);
    };
    if !force_web_lookup && !locator.starts_with("http://") && !locator.starts_with("https://") {
        return Ok(None);
    }

    if !locator.starts_with("http://") && !locator.starts_with("https://") {
        return Ok(None);
    }

    let response = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .build()
        .map_err(|error| format!("build lyric request client failed: {error}"))?
        .get(locator)
        .send()
        .map_err(|error| format!("fetch lyric locator failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "lyric locator returned status {}",
            response.status()
        ));
    }
    let content = response
        .text()
        .map_err(|error| format!("decode lyric response failed: {error}"))?;

    let format_hint = if locator.to_ascii_lowercase().ends_with(".yrc") {
        Some("yrc")
    } else if locator.to_ascii_lowercase().ends_with(".txt") {
        Some("plain")
    } else {
        Some("lrc")
    };

    Ok(parse_document(
        request,
        LyricSourceKind::Web,
        Some(locator.to_string()),
        format_hint,
        &content,
    ))
}

fn parse_document(
    request: &LyricResolveRequest,
    source_kind: LyricSourceKind,
    source_locator: Option<String>,
    format_hint: Option<&str>,
    text: &str,
) -> Option<PMPLyricDocument> {
    let normalized_text = text.trim();
    if normalized_text.is_empty() {
        return None;
    }

    let format = normalize_format(format_hint).unwrap_or_else(|| detect_format(normalized_text));
    let parsed = match format.as_str() {
        "lrc" | "yrc" => parser::lrc::parse_lrc(normalized_text),
        _ => parser::parse_plain_text(normalized_text),
    };
    if parsed.is_empty() {
        return None;
    }

    Some(PMPLyricDocument {
        id: String::new(),
        entry_id: request
            .entry_id
            .as_deref()
            .and_then(normalize_text)
            .map(str::to_string),
        track_id: request
            .track_id
            .as_deref()
            .and_then(normalize_text)
            .map(str::to_string),
        quick_fingerprint: request
            .quick_fingerprint
            .as_deref()
            .and_then(normalize_text)
            .map(str::to_string),
        source_kind,
        source_locator,
        format,
        language: request
            .language
            .as_deref()
            .and_then(normalize_text)
            .map(str::to_string),
        is_dynamic: parsed.is_dynamic,
        has_word_timing: parsed.has_word_timing,
        confidence: source_confidence(source_kind),
        lines: parsed.lines,
        raw_text: Some(normalized_text.to_string()),
        updated_at_ms: now_ms(),
    })
}

fn write_cache_document(
    cache_root: &Path,
    cache_key: &str,
    document: &PMPLyricDocument,
) -> Result<(), String> {
    fs::create_dir_all(cache_root)
        .map_err(|error| format!("create lyric cache directory failed: {error}"))?;

    let extension = match document.format.as_str() {
        "yrc" => "yrc",
        "plain" => "txt",
        _ => "lrc",
    };

    let output = cache_root.join(format!("{cache_key}.{extension}"));
    let content = if extension == "txt" {
        render_plain_document(document)
    } else {
        render_lrc_document(document)
    };

    fs::write(output, content).map_err(|error| format!("write lyric cache failed: {error}"))
}

fn render_lrc_document(document: &PMPLyricDocument) -> String {
    if let Some(raw_text) = document.raw_text.as_deref().and_then(normalize_text) {
        return format!("{raw_text}\n");
    }

    let mut content = String::new();
    for line in &document.lines {
        let timestamp = to_lrc_timestamp(line.start_ms);
        content.push_str(&format!("[{timestamp}]{}\n", line.text));
    }
    content
}

fn render_plain_document(document: &PMPLyricDocument) -> String {
    if let Some(raw_text) = document.raw_text.as_deref().and_then(normalize_text) {
        return format!("{raw_text}\n");
    }

    let lines: Vec<String> = document
        .lines
        .iter()
        .map(|line| line.text.clone())
        .collect();
    if lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", lines.join("\n"))
    }
}

fn to_lrc_timestamp(time_ms: u64) -> String {
    let total_seconds = time_ms / 1000;
    let minute = total_seconds / 60;
    let second = total_seconds % 60;
    let centisecond = (time_ms % 1000) / 10;
    format!("{minute:02}:{second:02}.{centisecond:02}")
}

fn resolve_cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Unable to resolve app data directory for lyrics cache".to_string())?;
    Ok(app_data_dir.join("music-library").join("lyrics-cache"))
}

fn derive_cache_key(request: &LyricResolveRequest, selection_key: &str) -> Option<String> {
    request
        .cache_key
        .as_deref()
        .and_then(normalize_text)
        .map(str::to_string)
        .or_else(|| {
            request
                .quick_fingerprint
                .as_deref()
                .and_then(normalize_text)
                .map(|value| value.to_ascii_lowercase())
        })
        .or_else(|| {
            request
                .track_id
                .as_deref()
                .and_then(normalize_text)
                .map(str::to_string)
        })
        .or_else(|| {
            request
                .track_file_path
                .as_deref()
                .and_then(normalize_text)
                .map(stable_hash)
        })
        .or_else(|| Some(stable_hash(selection_key)))
}

fn derive_selection_key_from_request(request: &LyricResolveRequest) -> Option<String> {
    if let Some(entry_id) = request.entry_id.as_deref().and_then(normalize_text) {
        return Some(format!("entry::{entry_id}"));
    }
    if let Some(quick_fingerprint) = request
        .quick_fingerprint
        .as_deref()
        .and_then(normalize_text)
    {
        return Some(format!(
            "fingerprint::{}",
            quick_fingerprint.to_ascii_lowercase()
        ));
    }
    if let Some(track_id) = request.track_id.as_deref().and_then(normalize_text) {
        return Some(format!("track::{track_id}"));
    }
    request
        .track_file_path
        .as_deref()
        .and_then(normalize_text)
        .map(|path| format!("path::{}", stable_hash(path)))
}

fn derive_selection_key_from_query(query: &LyricResolveQuery) -> Option<String> {
    if let Some(entry_id) = query.entry_id.as_deref().and_then(normalize_text) {
        return Some(format!("entry::{entry_id}"));
    }
    if let Some(quick_fingerprint) = query.quick_fingerprint.as_deref().and_then(normalize_text) {
        return Some(format!(
            "fingerprint::{}",
            quick_fingerprint.to_ascii_lowercase()
        ));
    }
    if let Some(track_id) = query.track_id.as_deref().and_then(normalize_text) {
        return Some(format!("track::{track_id}"));
    }
    if let Some(cache_key) = query.cache_key.as_deref().and_then(normalize_text) {
        return Some(format!("cache::{cache_key}"));
    }
    query
        .track_file_path
        .as_deref()
        .and_then(normalize_text)
        .map(|path| format!("path::{}", stable_hash(path)))
}

fn stable_hash(input: &str) -> String {
    format!("{:x}", md5::compute(input.as_bytes()))
}

fn source_confidence(source_kind: LyricSourceKind) -> f32 {
    match source_kind {
        LyricSourceKind::Embedded => 0.96,
        LyricSourceKind::Sidecar => 0.92,
        LyricSourceKind::Cache => 0.88,
        LyricSourceKind::Web => 0.78,
    }
}

fn detect_format(input: &str) -> String {
    if input.contains('[') && input.contains(']') && input.contains(':') {
        return "lrc".to_string();
    }
    "plain".to_string()
}

fn normalize_format(value: Option<&str>) -> Option<String> {
    match value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| item.to_ascii_lowercase())
        .as_deref()
    {
        Some("lrc") => Some("lrc".to_string()),
        Some("yrc") => Some("yrc".to_string()),
        Some("txt") | Some("plain") | Some("ass") | Some("srt") => Some("plain".to_string()),
        _ => None,
    }
}

fn normalize_text(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn read_text_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| format!("Read lyric file failed: {error}"))?;
    match String::from_utf8(bytes.clone()) {
        Ok(content) => Ok(content),
        Err(_) => Ok(String::from_utf8_lossy(&bytes).to_string()),
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

fn policy_label(policy: &LyricWriteBackPolicy) -> &'static str {
    match policy {
        LyricWriteBackPolicy::None => "none",
        LyricWriteBackPolicy::Sidecar => "sidecar",
        LyricWriteBackPolicy::Embedded => "embedded",
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use lofty::tag::{ItemKey, ItemValue, Tag, TagItem, TagType};

    use super::{derive_selection_key_from_request, resolve_with_cache_root, LyricResolveRequest};

    fn build_temp_dir(prefix: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "{prefix}-{}-{}",
            std::process::id(),
            super::now_ms()
        ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn prefer_sidecar_over_cache() {
        let root = build_temp_dir("lyrics-prefer-sidecar");
        let track_path = root.join("track.mp3");
        std::fs::write(&track_path, "audio").expect("write track");

        let sidecar_path = root.join("track.lrc");
        std::fs::write(&sidecar_path, "[00:01.00]from-sidecar").expect("write sidecar");

        let cache_root = root.join("cache");
        std::fs::create_dir_all(&cache_root).expect("create cache root");
        std::fs::write(cache_root.join("track-1.lrc"), "[00:01.00]from-cache")
            .expect("write cache");

        let request = LyricResolveRequest {
            entry_id: None,
            track_id: Some("track-1".to_string()),
            track_file_path: Some(track_path.to_string_lossy().to_string()),
            quick_fingerprint: None,
            title: None,
            artist: None,
            duration_seconds: None,
            embedded_lyrics: None,
            lyric_locator: None,
            cache_key: Some("track-1".to_string()),
            language: None,
            force_web_lookup: Some(false),
        };

        let selection_key = derive_selection_key_from_request(&request).expect("selection key");
        let result = resolve_with_cache_root(&request, &selection_key, Some(cache_root.as_path()))
            .expect("resolve lyrics");

        let selected = result.selected.expect("selected document");
        assert_eq!(result.selected_source.as_deref(), Some("sidecar"));
        assert!(selected
            .raw_text
            .unwrap_or_default()
            .contains("from-sidecar"));
    }

    #[test]
    fn prefer_embedded_over_sidecar() {
        let root = build_temp_dir("lyrics-prefer-embedded");
        let track_path = root.join("track.mp3");
        std::fs::write(&track_path, "audio").expect("write track");
        std::fs::write(root.join("track.lrc"), "[00:01.00]from-sidecar").expect("write sidecar");

        let request = LyricResolveRequest {
            entry_id: Some("entry-1".to_string()),
            track_id: Some("track-1".to_string()),
            track_file_path: Some(track_path.to_string_lossy().to_string()),
            quick_fingerprint: Some("qf2:0011223344556677".to_string()),
            title: None,
            artist: None,
            duration_seconds: None,
            embedded_lyrics: Some("[00:01.00]from-embedded".to_string()),
            lyric_locator: None,
            cache_key: None,
            language: None,
            force_web_lookup: Some(false),
        };

        let selection_key = derive_selection_key_from_request(&request).expect("selection key");
        let result =
            resolve_with_cache_root(&request, &selection_key, None).expect("resolve lyrics");
        assert_eq!(result.selected_source.as_deref(), Some("embedded"));

        let selected = result.selected.expect("selected document");
        assert!(selected
            .raw_text
            .unwrap_or_default()
            .contains("from-embedded"));
    }

    #[test]
    fn extract_lyrics_from_standard_tag_item() {
        let mut tag = Tag::new(TagType::Id3v2);
        let inserted = tag.insert_text(ItemKey::Lyrics, "[00:01.00]from-tag".to_string());
        assert!(inserted, "insert standard lyrics item");

        let resolved = super::extract_lyrics_from_tag(&tag);
        assert_eq!(resolved.as_deref(), Some("[00:01.00]from-tag"));
    }

    #[test]
    fn extract_lyrics_from_unknown_lyrics_key() {
        let mut tag = Tag::new(TagType::Ape);
        tag.insert_unchecked(TagItem::new(
            ItemKey::Unknown("LYRICS".to_string()),
            ItemValue::Text("from-unknown-lyrics-key".to_string()),
        ));

        let resolved = super::extract_lyrics_from_tag(&tag);
        assert_eq!(resolved.as_deref(), Some("from-unknown-lyrics-key"));
    }
}
