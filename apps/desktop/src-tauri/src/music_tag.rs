use std::{
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use lofty::{
    config::WriteOptions,
    file::{AudioFile, FileType, TaggedFileExt},
    read_from_path,
    tag::{Accessor, ItemKey, Tag, TagItem, TagType},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime};

use crate::backend_telemetry::{self, BackendTelemetryOptions};
use crate::{lyrics, music_library_db};

mod providers;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTagReadLocalRequest {
    pub file_path: String,
    pub include_cover: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTagEmbeddedCover {
    pub mime_type: String,
    pub data_base64: String,
    pub byte_length: u64,
    pub picture_type: String,
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTagCanonicalMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub genre: Option<String>,
    pub year: Option<u32>,
    pub date: Option<String>,
    pub original_date: Option<String>,
    pub track_number: Option<u32>,
    pub track_total: Option<u32>,
    pub disc_number: Option<u32>,
    pub disc_total: Option<u32>,
    pub composer: Option<String>,
    pub lyricist: Option<String>,
    pub conductor: Option<String>,
    pub arranger: Option<String>,
    pub label: Option<String>,
    pub catalog_number: Option<String>,
    pub barcode: Option<String>,
    pub isrc: Option<String>,
    pub bpm: Option<f64>,
    pub musical_key: Option<String>,
    pub language: Option<String>,
    pub comment: Option<String>,
    pub lyrics: Option<String>,
    pub mbid_recording: Option<String>,
    pub mbid_release: Option<String>,
    pub mbid_release_group: Option<String>,
    pub mbid_artist: Option<String>,
    pub mbid_album_artist: Option<String>,
    pub acoustid: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTagReadLocalResult {
    pub file_path: String,
    pub file_size: u64,
    pub mtime_ms: i64,
    pub format: Option<String>,
    pub tag_count: u32,
    pub tag_types: Vec<String>,
    pub field_count: u32,
    pub metadata: MusicTagCanonicalMetadata,
    pub embedded_cover: Option<MusicTagEmbeddedCover>,
    pub warnings: Vec<String>,
    pub read_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTagDbPatchRequest {
    pub track_id: String,
    pub source_metadata: MusicTagCanonicalMetadata,
    pub selected_candidate_ids: Option<Vec<String>>,
    pub locked_fields: Option<Vec<String>>,
    pub lock_mode: Option<String>,
    pub tag_source: Option<String>,
    pub tag_confidence: Option<f64>,
    pub expected_mtime_ms: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTagWriteFileRequest {
    pub track_id: Option<String>,
    pub file_path: String,
    pub metadata: MusicTagCanonicalMetadata,
    pub expected_mtime_ms: i64,
    pub write_cover: Option<bool>,
    pub cover_data_base64: Option<String>,
    pub cover_url: Option<String>,
    pub cover_mime_type: Option<String>,
    pub replace_all: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTagWriteFileResult {
    pub audit_id: Option<String>,
    pub file_path: String,
    pub format: String,
    pub fields_written: u32,
    pub mtime_before_ms: i64,
    pub mtime_after_ms: i64,
    pub verified: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverArtSearchRequest {
    pub mbid_release: String,
    pub track_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverArtCandidate {
    pub url: String,
    pub thumbnail_url: Option<String>,
    pub cover_type: String,
    pub approved: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverArtSearchResult {
    pub candidates: Vec<CoverArtCandidate>,
    pub release_mbid: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverArtDownloadRequest {
    pub url: String,
    pub track_id: String,
    pub release_mbid: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverArtDownloadResult {
    pub cache_key: String,
    pub file_size: u64,
    pub mime_type: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChromaprintRequest {
    pub file_path: String,
    pub max_duration_seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChromaprintResult {
    pub file_path: String,
    pub fingerprint: String,
    pub duration_seconds: f64,
    pub sample_rate: u32,
    pub channels: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTagCandidateSearchRequest {
    pub track_id: Option<String>,
    pub file_path: Option<String>,
    pub quick_fingerprint: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_seconds: Option<f64>,
    pub metadata: Option<MusicTagCanonicalMetadata>,
    pub embedded_lyrics: Option<String>,
    pub lyric_locator: Option<String>,
    pub language: Option<String>,
    pub acoustid_fingerprint: Option<String>,
    pub acoustid_api_key: Option<String>,
    pub limit: Option<u32>,
    pub provider_ids: Option<Vec<String>>,
    pub include_network: Option<bool>,
    pub include_lyrics: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTagMetadataProviderDescriptor {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub capabilities: Vec<String>,
    pub builtin: bool,
    pub requires_network: bool,
    pub requires_api_key: bool,
    pub enabled: bool,
    pub priority: i32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTagRollbackRequest {
    pub audit_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTagRollbackResult {
    pub rolled_back_audit_id: String,
    pub created_audit_id: Option<String>,
    pub track_id: String,
    pub restored_db: bool,
    pub restored_file: bool,
    pub db_result: Option<music_library_db::MusicTagDbPatchResult>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTagCandidate {
    pub id: String,
    pub provider: String,
    pub provider_entity_type: String,
    pub provider_entity_id: Option<String>,
    pub metadata: MusicTagCanonicalMetadata,
    pub artwork_url: Option<String>,
    pub score: f64,
    pub confidence: String,
    pub reasons: Vec<String>,
    pub warnings: Vec<String>,
    pub fetched_at_ms: i64,
    pub expires_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTagLyricsResolutionSummary {
    pub selection_key: String,
    pub selected_source: Option<String>,
    pub tried_sources: Vec<String>,
    pub diagnostics: Vec<String>,
    pub has_selected: bool,
    pub format: Option<String>,
    pub language: Option<String>,
    pub confidence: Option<f32>,
    pub has_word_timing: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTagCandidateSearchResult {
    pub candidates: Vec<MusicTagCandidate>,
    pub lyrics_resolution: Option<MusicTagLyricsResolutionSummary>,
    pub searched_providers: Vec<String>,
    pub warnings: Vec<String>,
    pub fetched_at_ms: i64,
}

pub fn list_metadata_providers() -> Vec<MusicTagMetadataProviderDescriptor> {
    providers::provider_descriptors()
}

pub fn list_history(
    app: &AppHandle,
    query: music_library_db::MusicTagHistoryQuery,
) -> Result<music_library_db::MusicTagHistoryPage, String> {
    music_library_db::list_music_tag_history(app, query)
}

pub fn rollback_history(
    app: &AppHandle,
    request: MusicTagRollbackRequest,
) -> Result<MusicTagRollbackResult, String> {
    let entry = music_library_db::get_music_tag_history_entry(app, request.audit_id.as_str())?
        .ok_or_else(|| "MusicTag history version was not found".to_string())?;
    let mut created_audit_id = None;
    let mut db_result = None;
    let mut restored_db = false;
    let mut restored_file = false;
    let mut warnings = Vec::new();

    if entry.write_db {
        let result = music_library_db::rollback_music_tag_db_audit(app, request.audit_id.as_str())?;
        restored_db = result.db_result.applied;
        created_audit_id = result.created_audit_id.clone();
        warnings.extend(result.warnings);
        db_result = Some(result.db_result);
    }

    if entry.write_file {
        let metadata = entry
            .before_file
            .clone()
            .ok_or_else(|| "MusicTag file version has no restorable snapshot".to_string())
            .and_then(|value| {
                serde_json::from_value::<MusicTagCanonicalMetadata>(value)
                    .map_err(|error| format!("Invalid MusicTag file snapshot: {error}"))
            })?;
        let current = read_local_tags_inner(MusicTagReadLocalRequest {
            file_path: entry.file_path.clone(),
            include_cover: Some(false),
        })?;
        let output = write_file_tags_inner(&MusicTagWriteFileRequest {
            track_id: Some(entry.track_id.clone()),
            file_path: entry.file_path.clone(),
            metadata,
            expected_mtime_ms: current.mtime_ms,
            write_cover: Some(false),
            cover_data_base64: None,
            cover_url: None,
            cover_mime_type: None,
            replace_all: Some(true),
        })?;
        let restored = read_local_tags_inner(MusicTagReadLocalRequest {
            file_path: entry.file_path.clone(),
            include_cover: Some(false),
        })?;
        let file_audit_id = music_library_db::record_music_tag_file_audit(
            app,
            music_library_db::MusicTagFileAuditInput {
                track_id: entry.track_id.clone(),
                file_path: entry.file_path.clone(),
                before_file: serde_json::to_value(&current.metadata).unwrap_or(JsonValue::Null),
                after_file: serde_json::to_value(&restored.metadata).unwrap_or(JsonValue::Null),
                changed_fields: metadata_changes(&current.metadata, &restored.metadata),
                file_mtime_before_ms: Some(current.mtime_ms),
                file_mtime_after_ms: Some(restored.mtime_ms),
                status: "rollback".to_string(),
                applied_by: "music-tag-history".to_string(),
            },
        )?;
        if created_audit_id.is_none() {
            created_audit_id = Some(file_audit_id);
        }
        restored_file = output.verified;
        warnings.extend(output.warnings);
        warnings.push("cover-art-not-versioned".to_string());
    }

    if !entry.write_db && !entry.write_file {
        return Err("Selected MusicTag version has no restorable changes".to_string());
    }
    backend_telemetry::info(
        app,
        "music-tag",
        "music-tag.audit.rollback.completed",
        BackendTelemetryOptions::new()
            .component("music_tag")
            .field("trackId", json!(&entry.track_id))
            .field("restoredDb", json!(restored_db))
            .field("restoredFile", json!(restored_file))
            .field("warningCount", json!(warnings.len())),
    );
    Ok(MusicTagRollbackResult {
        rolled_back_audit_id: entry.id,
        created_audit_id,
        track_id: entry.track_id,
        restored_db,
        restored_file,
        db_result,
        warnings,
    })
}

pub fn read_local_tags<R: Runtime>(
    app: &AppHandle<R>,
    request: MusicTagReadLocalRequest,
) -> Result<MusicTagReadLocalResult, String> {
    let result = read_local_tags_inner(request);
    match &result {
        Ok(result) => {
            backend_telemetry::info(
                app,
                "music-tag",
                "music-tag.local.read.completed",
                BackendTelemetryOptions::new()
                    .component("music_tag")
                    .field("format", serde_json::json!(result.format.as_deref()))
                    .field("tagCount", serde_json::json!(result.tag_count))
                    .field("tagTypeCount", serde_json::json!(result.tag_types.len()))
                    .field("fieldCount", serde_json::json!(result.field_count))
                    .field("warningCount", serde_json::json!(result.warnings.len())),
            );
        }
        Err(error) => {
            backend_telemetry::error(
                app,
                "music-tag",
                "music-tag.local.read.failed",
                BackendTelemetryOptions::new()
                    .component("music_tag")
                    .message("local tag read failed")
                    .field("errorKind", serde_json::json!(classify_read_error(error))),
            );
        }
    }
    result
}

pub fn read_local_tags_from_path(file_path: &str) -> Result<MusicTagReadLocalResult, String> {
    read_local_tags_inner(MusicTagReadLocalRequest {
        file_path: file_path.to_string(),
        include_cover: Some(false),
    })
}

pub fn preview_db_patch(
    app: &AppHandle,
    request: MusicTagDbPatchRequest,
) -> Result<music_library_db::MusicTagDbPatchResult, String> {
    let result = db_patch_request_to_input(request)
        .and_then(|input| music_library_db::preview_music_tag_db_patch(app, input));
    emit_db_patch_telemetry(app, "music-tag.db.preview", &result);
    result
}

pub fn apply_db_patch(
    app: &AppHandle,
    request: MusicTagDbPatchRequest,
) -> Result<music_library_db::MusicTagDbPatchResult, String> {
    let result = db_patch_request_to_input(request)
        .and_then(|input| music_library_db::apply_music_tag_db_patch(app, input));
    emit_db_patch_telemetry(app, "music-tag.db.apply", &result);
    result
}

pub fn search_candidates(
    app: &AppHandle,
    request: MusicTagCandidateSearchRequest,
) -> Result<MusicTagCandidateSearchResult, String> {
    let fetched_at_ms = now_ms();
    let limit = request.limit.unwrap_or(8).clamp(1, 20) as usize;
    let include_network = request.include_network.unwrap_or(true);
    let include_lyrics = request.include_lyrics.unwrap_or(true);
    let requested_provider_ids = request
        .provider_ids
        .as_ref()
        .map(|values| {
            values
                .iter()
                .filter_map(|value| normalize_text(value).map(str::to_string))
                .collect::<std::collections::BTreeSet<_>>()
        })
        .filter(|values| !values.is_empty());
    let seed_metadata = metadata_from_candidate_request(&request);

    let mut candidates = Vec::new();
    let mut searched_providers = Vec::new();
    let mut warnings = Vec::new();
    let mut lyrics_resolution = None;

    for provider in providers::builtin_providers() {
        let descriptor = provider.descriptor();
        if !descriptor.enabled {
            continue;
        }
        if requested_provider_ids
            .as_ref()
            .is_some_and(|ids| !ids.contains(descriptor.id.as_str()))
        {
            continue;
        }
        if descriptor.id == "lyrics" && !include_lyrics {
            continue;
        }
        if descriptor.requires_network && descriptor.id != "lyrics" && !include_network {
            continue;
        }

        searched_providers.push(descriptor.id.clone());
        let context = providers::ProviderSearchContext {
            app,
            request: &request,
            metadata: &seed_metadata,
            limit,
            fetched_at_ms,
        };
        match provider.search(&context) {
            Ok(mut output) => {
                candidates.append(&mut output.candidates);
                if output.lyrics_resolution.is_some() {
                    lyrics_resolution = output.lyrics_resolution;
                }
            }
            Err(error) => warnings.push(format!("{}: {error}", descriptor.id)),
        }
    }

    candidates.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    candidates.truncate(limit.saturating_mul(searched_providers.len().max(1)));

    if let Some(track_id) = request.track_id.as_deref().and_then(normalize_text) {
        let persist_inputs = candidates
            .iter()
            .filter_map(|candidate| candidate_to_persist_input(track_id, candidate).ok())
            .collect::<Vec<_>>();
        if !persist_inputs.is_empty() {
            if let Err(error) =
                music_library_db::replace_music_tag_candidates(app, track_id, persist_inputs)
            {
                warnings.push(format!("candidate-cache: {error}"));
            }
        }
    }

    let result = MusicTagCandidateSearchResult {
        candidates,
        lyrics_resolution,
        searched_providers,
        warnings,
        fetched_at_ms,
    };

    backend_telemetry::info(
        app,
        "music-tag",
        "music-tag.candidates.search.completed",
        BackendTelemetryOptions::new()
            .component("music_tag")
            .field("candidateCount", json!(result.candidates.len()))
            .field("providerCount", json!(result.searched_providers.len()))
            .field("warningCount", json!(result.warnings.len()))
            .field(
                "hasLyricsResolution",
                json!(result.lyrics_resolution.is_some()),
            ),
    );

    Ok(result)
}

fn db_patch_request_to_input(
    request: MusicTagDbPatchRequest,
) -> Result<music_library_db::MusicTagDbPatchInput, String> {
    let source_metadata_json = serde_json::to_string(&request.source_metadata)
        .map_err(|error| format!("Serialize MusicTag patch metadata failed: {error}"))?;
    Ok(music_library_db::MusicTagDbPatchInput {
        track_id: request.track_id,
        source_metadata_json,
        selected_candidate_ids: request.selected_candidate_ids.unwrap_or_default(),
        locked_fields: request.locked_fields.unwrap_or_default(),
        lock_mode: request.lock_mode,
        tag_source: request.tag_source,
        tag_confidence: request.tag_confidence,
        expected_mtime_ms: request.expected_mtime_ms,
        restore_null_fields: false,
    })
}

fn emit_db_patch_telemetry(
    app: &AppHandle,
    event_prefix: &'static str,
    result: &Result<music_library_db::MusicTagDbPatchResult, String>,
) {
    match result {
        Ok(result) => {
            backend_telemetry::info(
                app,
                "music-tag",
                format!("{event_prefix}.completed").as_str(),
                BackendTelemetryOptions::new()
                    .component("music_tag")
                    .field("changedFieldCount", json!(result.changed_fields.len()))
                    .field("lockedFieldCount", json!(result.locked_fields.len()))
                    .field("warningCount", json!(result.warnings.len()))
                    .field("canApply", json!(result.can_apply))
                    .field("applied", json!(result.applied)),
            );
        }
        Err(error) => {
            backend_telemetry::error(
                app,
                "music-tag",
                format!("{event_prefix}.failed").as_str(),
                BackendTelemetryOptions::new()
                    .component("music_tag")
                    .message("music tag DB patch failed")
                    .field("errorKind", json!(classify_db_patch_error(error))),
            );
        }
    }
}

fn metadata_from_candidate_request(
    request: &MusicTagCandidateSearchRequest,
) -> MusicTagCanonicalMetadata {
    let mut metadata = request.metadata.clone().unwrap_or_default();
    if metadata.title.is_none() {
        metadata.title = request
            .title
            .as_deref()
            .and_then(normalize_text)
            .map(str::to_string);
    }
    if metadata.artist.is_none() {
        metadata.artist = request
            .artist
            .as_deref()
            .and_then(normalize_text)
            .map(str::to_string);
    }
    if metadata.album.is_none() {
        metadata.album = request
            .album
            .as_deref()
            .and_then(normalize_text)
            .map(str::to_string);
    }
    if metadata.lyrics.is_none() {
        metadata.lyrics = request
            .embedded_lyrics
            .as_deref()
            .and_then(normalize_text)
            .map(str::to_string);
    }
    metadata
}

fn search_musicbrainz_candidates(
    request: &MusicTagCandidateSearchRequest,
    metadata: &MusicTagCanonicalMetadata,
    limit: usize,
    fetched_at_ms: i64,
) -> Result<Vec<MusicTagCandidate>, String> {
    let query = build_musicbrainz_query(request, metadata)
        .ok_or_else(|| "metadata text is required".to_string())?;
    let mut url = reqwest::Url::parse("https://musicbrainz.org/ws/2/recording")
        .map_err(|error| format!("build MusicBrainz URL failed: {error}"))?;
    url.query_pairs_mut()
        .append_pair("query", query.as_str())
        .append_pair("fmt", "json")
        .append_pair("limit", limit.to_string().as_str())
        .append_pair("inc", "artist-credits+releases+isrcs");

    let payload: JsonValue = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| format!("build MusicBrainz client failed: {error}"))?
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            "PixelMatrixPlayer/0.1 (music-tag-workbench)",
        )
        .send()
        .map_err(|error| format!("MusicBrainz request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("MusicBrainz response failed: {error}"))?
        .json()
        .map_err(|error| format!("MusicBrainz JSON parse failed: {error}"))?;

    let recordings = payload
        .get("recordings")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "MusicBrainz response has no recordings".to_string())?;

    let mut candidates = Vec::new();
    for item in recordings.iter().take(limit) {
        let Some(recording_id) = item.get("id").and_then(json_string) else {
            continue;
        };
        let score = item
            .get("score")
            .and_then(json_score)
            .unwrap_or(0.0)
            .clamp(0.0, 1.0);
        let title = item.get("title").and_then(json_string);
        let artist = first_musicbrainz_artist_name(item);
        let artist_id = first_musicbrainz_artist_id(item);
        let release = item
            .get("releases")
            .and_then(|value| value.as_array())
            .and_then(|items| items.first());
        let album = release
            .and_then(|value| value.get("title"))
            .and_then(json_string);
        let release_id = release
            .and_then(|value| value.get("id"))
            .and_then(json_string);
        let release_group_id = release
            .and_then(|value| value.get("release-group"))
            .and_then(|value| value.get("id"))
            .and_then(json_string);
        let year = release
            .and_then(|value| value.get("date"))
            .and_then(json_string)
            .and_then(|value| parse_year(value.as_str()));
        let isrc = item
            .get("isrcs")
            .and_then(|value| value.as_array())
            .and_then(|items| items.first())
            .and_then(json_string);

        let candidate_metadata = MusicTagCanonicalMetadata {
            title,
            artist,
            album,
            year,
            isrc,
            mbid_recording: Some(recording_id.clone()),
            mbid_release: release_id,
            mbid_release_group: release_group_id,
            mbid_artist: artist_id,
            ..MusicTagCanonicalMetadata::default()
        };
        let candidate_id = candidate_id(
            request.track_id.as_deref(),
            "musicbrainz",
            Some(recording_id.as_str()),
            &candidate_metadata,
        );
        candidates.push(MusicTagCandidate {
            id: candidate_id,
            provider: "musicbrainz".to_string(),
            provider_entity_type: "recording".to_string(),
            provider_entity_id: Some(recording_id),
            metadata: candidate_metadata,
            artwork_url: None,
            score,
            confidence: confidence_from_score(score).to_string(),
            reasons: vec!["musicbrainz-recording-search".to_string()],
            warnings: Vec::new(),
            fetched_at_ms,
            expires_at_ms: Some(fetched_at_ms + 14 * 24 * 60 * 60 * 1000),
        });
    }

    Ok(candidates)
}

fn search_netease_candidates(
    request: &MusicTagCandidateSearchRequest,
    metadata: &MusicTagCanonicalMetadata,
    limit: usize,
    fetched_at_ms: i64,
) -> Result<Vec<MusicTagCandidate>, String> {
    let query = [metadata.title.as_deref(), metadata.artist.as_deref()]
        .into_iter()
        .flatten()
        .filter_map(normalize_text)
        .collect::<Vec<_>>()
        .join(" ");
    if query.is_empty() {
        return Err("metadata text is required".to_string());
    }

    let mut url = reqwest::Url::parse("https://music.163.com/api/search/get")
        .map_err(|error| format!("build NetEase Cloud Music URL failed: {error}"))?;
    url.query_pairs_mut()
        .append_pair("s", query.as_str())
        .append_pair("type", "1")
        .append_pair("offset", "0")
        .append_pair("limit", limit.to_string().as_str());

    let payload: JsonValue = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| format!("build NetEase Cloud Music client failed: {error}"))?
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            "PixelMatrixPlayer/0.1 (music-tag-workbench)",
        )
        .send()
        .map_err(|error| format!("NetEase Cloud Music request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("NetEase Cloud Music response failed: {error}"))?
        .json()
        .map_err(|error| format!("NetEase Cloud Music JSON parse failed: {error}"))?;

    let songs = payload
        .get("result")
        .and_then(|value| value.get("songs"))
        .and_then(|value| value.as_array())
        .ok_or_else(|| "NetEase Cloud Music response has no songs".to_string())?;

    let expected_title = metadata
        .title
        .as_deref()
        .and_then(normalize_text)
        .map(|value| value.to_lowercase());
    let expected_artist = metadata
        .artist
        .as_deref()
        .and_then(normalize_text)
        .map(|value| value.to_lowercase());
    let mut candidates = Vec::new();

    for (index, song) in songs.iter().take(limit).enumerate() {
        let Some(entity_id) = song.get("id").and_then(|value| {
            value
                .as_i64()
                .map(|id| id.to_string())
                .or_else(|| json_string(value))
        }) else {
            continue;
        };
        let title = song.get("name").and_then(json_string);
        let artist = song
            .get("artists")
            .and_then(|value| value.as_array())
            .map(|artists| {
                artists
                    .iter()
                    .filter_map(|artist| artist.get("name").and_then(json_string))
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .and_then(normalize_owned_text);
        let album_value = song.get("album");
        let album = album_value
            .and_then(|value| value.get("name"))
            .and_then(json_string);
        let artwork_url = album_value
            .and_then(|value| value.get("picUrl").or_else(|| value.get("blurPicUrl")))
            .and_then(json_string);
        let score = score_text_candidate(
            expected_title.as_deref(),
            expected_artist.as_deref(),
            title.as_deref(),
            artist.as_deref(),
            index,
        );
        let candidate_metadata = MusicTagCanonicalMetadata {
            title,
            artist,
            album,
            ..MusicTagCanonicalMetadata::default()
        };
        candidates.push(MusicTagCandidate {
            id: candidate_id(
                request.track_id.as_deref(),
                "netease-cloud",
                Some(entity_id.as_str()),
                &candidate_metadata,
            ),
            provider: "netease-cloud".to_string(),
            provider_entity_type: "song".to_string(),
            provider_entity_id: Some(entity_id),
            metadata: candidate_metadata,
            artwork_url,
            score,
            confidence: confidence_from_score(score).to_string(),
            reasons: vec!["netease-cloud-song-search".to_string()],
            warnings: Vec::new(),
            fetched_at_ms,
            expires_at_ms: Some(fetched_at_ms + 7 * 24 * 60 * 60 * 1000),
        });
    }

    Ok(candidates)
}

fn score_text_candidate(
    expected_title: Option<&str>,
    expected_artist: Option<&str>,
    title: Option<&str>,
    artist: Option<&str>,
    rank: usize,
) -> f64 {
    let title = title.map(str::to_lowercase);
    let artist = artist.map(str::to_lowercase);
    let mut score: f64 = 0.45 + 0.2 / (rank as f64 + 1.0);
    if expected_title.is_some() && expected_title == title.as_deref() {
        score += 0.25;
    }
    if expected_artist.is_some()
        && artist
            .as_deref()
            .is_some_and(|value| value.contains(expected_artist.unwrap_or_default()))
    {
        score += 0.15;
    }
    score.clamp(0.0, 0.99)
}

fn search_acoustid_candidates(
    request: &MusicTagCandidateSearchRequest,
    metadata: &MusicTagCanonicalMetadata,
    limit: usize,
    fetched_at_ms: i64,
) -> Result<Vec<MusicTagCandidate>, String> {
    let api_key = request
        .acoustid_api_key
        .as_deref()
        .and_then(normalize_text)
        .map(str::to_string)
        .or_else(|| {
            std::env::var("PMP_ACOUSTID_API_KEY")
                .ok()
                .and_then(normalize_owned_text)
        });
    let Some(api_key) = api_key else {
        return Err("api-key-required".to_string());
    };
    let fingerprint = request
        .acoustid_fingerprint
        .as_deref()
        .and_then(normalize_text)
        .ok_or_else(|| "chromaprint-fingerprint-required".to_string())?;
    let duration = request
        .duration_seconds
        .filter(|value| value.is_finite() && *value > 0.0)
        .ok_or_else(|| "duration-required".to_string())?;

    let mut url = reqwest::Url::parse("https://api.acoustid.org/v2/lookup")
        .map_err(|error| format!("build AcoustID URL failed: {error}"))?;
    url.query_pairs_mut()
        .append_pair("client", api_key.as_str())
        .append_pair("duration", format!("{}", duration.round() as i64).as_str())
        .append_pair("fingerprint", fingerprint)
        .append_pair("meta", "recordings+releasegroups")
        .append_pair("format", "json");

    let payload: JsonValue = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| format!("build AcoustID client failed: {error}"))?
        .get(url)
        .send()
        .map_err(|error| format!("AcoustID request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("AcoustID response failed: {error}"))?
        .json()
        .map_err(|error| format!("AcoustID JSON parse failed: {error}"))?;

    let results = payload
        .get("results")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "AcoustID response has no results".to_string())?;

    let mut candidates = Vec::new();
    for result in results.iter().take(limit) {
        let acoustid = result.get("id").and_then(json_string);
        let score = result
            .get("score")
            .and_then(json_score)
            .unwrap_or(0.0)
            .clamp(0.0, 1.0);
        let recording = result
            .get("recordings")
            .and_then(|value| value.as_array())
            .and_then(|items| items.first());
        let recording_id = recording
            .and_then(|value| value.get("id"))
            .and_then(json_string);
        let title = recording
            .and_then(|value| value.get("title"))
            .and_then(json_string)
            .or_else(|| metadata.title.clone());
        let release_group_id = recording
            .and_then(|value| value.get("releasegroups"))
            .and_then(|value| value.as_array())
            .and_then(|items| items.first())
            .and_then(|value| value.get("id"))
            .and_then(json_string);

        let candidate_metadata = MusicTagCanonicalMetadata {
            title,
            artist: metadata.artist.clone(),
            album: metadata.album.clone(),
            mbid_recording: recording_id.clone(),
            mbid_release_group: release_group_id,
            acoustid,
            ..MusicTagCanonicalMetadata::default()
        };
        let provider_entity_id = recording_id.or(candidate_metadata.acoustid.clone());
        let candidate_id = candidate_id(
            request.track_id.as_deref(),
            "acoustid",
            provider_entity_id.as_deref(),
            &candidate_metadata,
        );
        candidates.push(MusicTagCandidate {
            id: candidate_id,
            provider: "acoustid".to_string(),
            provider_entity_type: "recording".to_string(),
            provider_entity_id,
            metadata: candidate_metadata,
            artwork_url: None,
            score,
            confidence: confidence_from_score(score).to_string(),
            reasons: vec!["acoustid-lookup".to_string()],
            warnings: Vec::new(),
            fetched_at_ms,
            expires_at_ms: Some(fetched_at_ms + 14 * 24 * 60 * 60 * 1000),
        });
    }

    Ok(candidates)
}

fn resolve_lyrics_candidate(
    app: &AppHandle,
    request: &MusicTagCandidateSearchRequest,
    metadata: &MusicTagCanonicalMetadata,
    fetched_at_ms: i64,
) -> Result<
    (
        Option<MusicTagLyricsResolutionSummary>,
        Option<MusicTagCandidate>,
    ),
    String,
> {
    let track_id = request.track_id.clone();
    let track_file_path = request.file_path.clone();
    let quick_fingerprint = request.quick_fingerprint.clone();
    if track_id.as_deref().and_then(normalize_text).is_none()
        && track_file_path
            .as_deref()
            .and_then(normalize_text)
            .is_none()
        && quick_fingerprint
            .as_deref()
            .and_then(normalize_text)
            .is_none()
    {
        return Ok((None, None));
    }

    let resolve_request = lyrics::LyricResolveRequest {
        entry_id: None,
        track_id: track_id.clone(),
        track_file_path,
        quick_fingerprint: quick_fingerprint.clone(),
        title: metadata.title.clone(),
        artist: metadata.artist.clone(),
        duration_seconds: request.duration_seconds,
        embedded_lyrics: request
            .embedded_lyrics
            .clone()
            .or_else(|| metadata.lyrics.clone()),
        lyric_locator: request.lyric_locator.clone(),
        cache_key: quick_fingerprint.or(track_id.clone()),
        language: request
            .language
            .clone()
            .or_else(|| metadata.language.clone()),
        force_web_lookup: Some(false),
    };
    let resolved = lyrics::service::resolve_for_track(app, resolve_request)?;
    let selected = resolved.selected.clone();
    let summary = MusicTagLyricsResolutionSummary {
        selection_key: resolved.selection_key.clone(),
        selected_source: resolved.selected_source.clone(),
        tried_sources: resolved.tried_sources.clone(),
        diagnostics: resolved.diagnostics.clone(),
        has_selected: selected.is_some(),
        format: selected.as_ref().map(|document| document.format.clone()),
        language: selected
            .as_ref()
            .and_then(|document| document.language.clone()),
        confidence: selected.as_ref().map(|document| document.confidence),
        has_word_timing: selected
            .as_ref()
            .map(|document| document.has_word_timing)
            .unwrap_or(false),
    };

    let Some(document) = selected else {
        return Ok((Some(summary), None));
    };
    let lyrics_text = document.raw_text.clone().or_else(|| {
        let joined = document
            .lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        normalize_owned_text(joined)
    });
    let score = f64::from(document.confidence).clamp(0.0, 1.0);
    let candidate_metadata = MusicTagCanonicalMetadata {
        title: metadata.title.clone(),
        artist: metadata.artist.clone(),
        album: metadata.album.clone(),
        lyrics: lyrics_text,
        language: document.language.clone(),
        ..MusicTagCanonicalMetadata::default()
    };
    let candidate_id = candidate_id(
        request.track_id.as_deref(),
        "lyrics",
        Some(document.id.as_str()),
        &candidate_metadata,
    );
    let candidate = MusicTagCandidate {
        id: candidate_id,
        provider: "lyrics".to_string(),
        provider_entity_type: "lyrics".to_string(),
        provider_entity_id: Some(document.id),
        metadata: candidate_metadata,
        artwork_url: None,
        score,
        confidence: confidence_from_score(score).to_string(),
        reasons: vec![format!(
            "lyrics-source:{}",
            resolved
                .selected_source
                .unwrap_or_else(|| "unknown".to_string())
        )],
        warnings: resolved.diagnostics,
        fetched_at_ms,
        expires_at_ms: None,
    };

    Ok((Some(summary), Some(candidate)))
}

fn build_musicbrainz_query(
    request: &MusicTagCandidateSearchRequest,
    metadata: &MusicTagCanonicalMetadata,
) -> Option<String> {
    let mut clauses = Vec::new();
    if let Some(isrc) = metadata.isrc.as_deref().and_then(normalize_text) {
        clauses.push(format!("isrc:{}", escape_musicbrainz_query_token(isrc)));
    }
    if let Some(title) = metadata.title.as_deref().and_then(normalize_text) {
        clauses.push(format!(
            "recording:\"{}\"",
            escape_musicbrainz_query_token(title)
        ));
    }
    if let Some(artist) = metadata.artist.as_deref().and_then(normalize_text) {
        clauses.push(format!(
            "artist:\"{}\"",
            escape_musicbrainz_query_token(artist)
        ));
    }
    if let Some(album) = metadata.album.as_deref().and_then(normalize_text) {
        clauses.push(format!(
            "release:\"{}\"",
            escape_musicbrainz_query_token(album)
        ));
    }

    if clauses.is_empty() {
        request
            .title
            .as_deref()
            .and_then(normalize_text)
            .map(|title| format!("recording:\"{}\"", escape_musicbrainz_query_token(title)))
    } else {
        Some(clauses.join(" AND "))
    }
}

fn escape_musicbrainz_query_token(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn first_musicbrainz_artist_name(recording: &JsonValue) -> Option<String> {
    recording
        .get("artist-credit")
        .and_then(|value| value.as_array())
        .and_then(|items| items.first())
        .and_then(|item| {
            item.get("name").and_then(json_string).or_else(|| {
                item.get("artist")
                    .and_then(|artist| artist.get("name"))
                    .and_then(json_string)
            })
        })
}

fn first_musicbrainz_artist_id(recording: &JsonValue) -> Option<String> {
    recording
        .get("artist-credit")
        .and_then(|value| value.as_array())
        .and_then(|items| items.first())
        .and_then(|item| item.get("artist"))
        .and_then(|artist| artist.get("id"))
        .and_then(json_string)
}

fn json_string(value: &JsonValue) -> Option<String> {
    value.as_str().and_then(normalize_text).map(str::to_string)
}

fn json_score(value: &JsonValue) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|item| item as f64))
        .or_else(|| value.as_str().and_then(|text| text.parse::<f64>().ok()))
        .map(|score| if score > 1.0 { score / 100.0 } else { score })
        .filter(|score| score.is_finite())
}

fn confidence_from_score(score: f64) -> &'static str {
    if score >= 0.98 {
        "exact"
    } else if score >= 0.85 {
        "high"
    } else if score >= 0.6 {
        "medium"
    } else {
        "low"
    }
}

fn candidate_id(
    track_id: Option<&str>,
    provider: &str,
    provider_entity_id: Option<&str>,
    metadata: &MusicTagCanonicalMetadata,
) -> String {
    let payload = serde_json::to_string(metadata).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(track_id.unwrap_or_default().as_bytes());
    hasher.update(b"|");
    hasher.update(provider.as_bytes());
    hasher.update(b"|");
    hasher.update(provider_entity_id.unwrap_or_default().as_bytes());
    hasher.update(b"|");
    hasher.update(payload.as_bytes());
    let digest = hasher.finalize();
    let hex = digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("music-tag-candidate:{provider}:{hex}")
}

fn candidate_to_persist_input(
    track_id: &str,
    candidate: &MusicTagCandidate,
) -> Result<music_library_db::MusicTagCandidateUpsertInput, String> {
    Ok(music_library_db::MusicTagCandidateUpsertInput {
        id: candidate.id.clone(),
        track_id: track_id.to_string(),
        provider: candidate.provider.clone(),
        provider_entity_type: candidate.provider_entity_type.clone(),
        provider_entity_id: candidate.provider_entity_id.clone(),
        score: candidate.score,
        confidence: candidate.confidence.clone(),
        metadata_json: serde_json::to_string(&candidate.metadata)
            .map_err(|error| format!("Serialize candidate metadata failed: {error}"))?,
        reasons_json: serde_json::to_string(&candidate.reasons)
            .map_err(|error| format!("Serialize candidate reasons failed: {error}"))?,
        warnings_json: Some(
            serde_json::to_string(&candidate.warnings)
                .map_err(|error| format!("Serialize candidate warnings failed: {error}"))?,
        ),
        raw_payload_json: None,
        fetched_at_ms: candidate.fetched_at_ms,
        expires_at_ms: candidate.expires_at_ms,
    })
}

fn classify_db_patch_error(error: &str) -> &'static str {
    if error.contains("track_id") {
        "missing-track-id"
    } else if error.contains("not found") {
        "track-not-found"
    } else if error.contains("metadata JSON") {
        "invalid-metadata"
    } else {
        "unknown"
    }
}

fn read_local_tags_inner(
    request: MusicTagReadLocalRequest,
) -> Result<MusicTagReadLocalResult, String> {
    let file_path = request.file_path.trim();
    if file_path.is_empty() {
        return Err("music tag local read requires file_path".to_string());
    }

    let path = Path::new(file_path);
    let metadata = std::fs::metadata(path)
        .map_err(|error| format!("Unable to inspect music tag file: {error}"))?;
    if !metadata.is_file() {
        return Err("music tag local read requires a file path".to_string());
    }

    let tagged_file =
        read_from_path(path).map_err(|error| format!("Read music tag file failed: {error}"))?;
    let tags = tagged_file.tags();
    let mut warnings = Vec::new();
    if tags.is_empty() {
        warnings.push("no-tags".to_string());
    }

    let tag_types = tags
        .iter()
        .map(|tag| format!("{:?}", tag.tag_type()))
        .collect::<Vec<_>>();
    let extracted = extract_metadata_from_tags(tags);
    let field_count = extracted.filled_field_count();
    let embedded_cover = if request.include_cover.unwrap_or(false) {
        extract_embedded_cover(tags, &mut warnings)
    } else {
        None
    };

    Ok(MusicTagReadLocalResult {
        file_path: file_path.to_string(),
        file_size: metadata.len(),
        mtime_ms: metadata.modified().map(system_time_to_millis).unwrap_or(0),
        format: Some(format_file_type(tagged_file.file_type())),
        tag_count: tags.len() as u32,
        tag_types,
        field_count,
        metadata: extracted,
        embedded_cover,
        warnings,
        read_at_ms: now_ms(),
    })
}

fn extract_embedded_cover(
    tags: &[Tag],
    warnings: &mut Vec<String>,
) -> Option<MusicTagEmbeddedCover> {
    const MAX_EMBEDDED_COVER_BYTES: usize = 8 * 1024 * 1024;

    let mut first_picture = None;
    let mut front_cover = None;
    for tag in tags {
        for picture in tag.pictures() {
            if first_picture.is_none() {
                first_picture = Some(picture);
            }
            if picture.pic_type() == lofty::picture::PictureType::CoverFront {
                front_cover = Some(picture);
                break;
            }
        }
        if front_cover.is_some() {
            break;
        }
    }

    let picture = front_cover.or(first_picture)?;
    let data = picture.data();
    if data.is_empty() {
        warnings.push("embedded-cover-empty".to_string());
        return None;
    }
    if data.len() > MAX_EMBEDDED_COVER_BYTES {
        warnings.push("embedded-cover-too-large".to_string());
        return None;
    }

    let mime_type = picture
        .mime_type()
        .map(|value| value.as_str().to_string())
        .unwrap_or_else(|| infer_embedded_cover_mime(data).to_string());
    use base64::Engine;
    Some(MusicTagEmbeddedCover {
        mime_type,
        data_base64: base64::engine::general_purpose::STANDARD.encode(data),
        byte_length: data.len() as u64,
        picture_type: format!("{:?}", picture.pic_type()),
    })
}

fn infer_embedded_cover_mime(data: &[u8]) -> &'static str {
    if data.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if data.starts_with(b"GIF8") {
        "image/gif"
    } else if data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else {
        "application/octet-stream"
    }
}

fn extract_metadata_from_tags(tags: &[Tag]) -> MusicTagCanonicalMetadata {
    let (track_number, track_total) = first_position_pair(
        tags,
        &ItemKey::TrackNumber,
        &ItemKey::TrackTotal,
        |tag| tag.track(),
        |tag| tag.track_total(),
    );
    let (disc_number, disc_total) = first_position_pair(
        tags,
        &ItemKey::DiscNumber,
        &ItemKey::DiscTotal,
        |tag| tag.disk(),
        |tag| tag.disk_total(),
    );
    let date = first_text(tags, &[ItemKey::ReleaseDate, ItemKey::RecordingDate]);

    MusicTagCanonicalMetadata {
        title: first_text(tags, &[ItemKey::TrackTitle]).or_else(|| {
            first_accessor_text(tags, |tag| tag.title().map(|value| value.into_owned()))
        }),
        artist: first_text(tags, &[ItemKey::TrackArtist]).or_else(|| {
            first_accessor_text(tags, |tag| tag.artist().map(|value| value.into_owned()))
        }),
        album: first_text(tags, &[ItemKey::AlbumTitle]).or_else(|| {
            first_accessor_text(tags, |tag| tag.album().map(|value| value.into_owned()))
        }),
        album_artist: first_text(tags, &[ItemKey::AlbumArtist]),
        genre: first_text(tags, &[ItemKey::Genre]).or_else(|| {
            first_accessor_text(tags, |tag| tag.genre().map(|value| value.into_owned()))
        }),
        year: first_text(
            tags,
            &[ItemKey::Year, ItemKey::RecordingDate, ItemKey::ReleaseDate],
        )
        .and_then(|value| parse_year(&value))
        .or_else(|| first_accessor_u32(tags, |tag| tag.year())),
        date,
        original_date: first_text(tags, &[ItemKey::OriginalReleaseDate]),
        track_number,
        track_total,
        disc_number,
        disc_total,
        composer: first_text(tags, &[ItemKey::Composer]),
        lyricist: first_text(tags, &[ItemKey::Lyricist]),
        conductor: first_text(tags, &[ItemKey::Conductor]),
        arranger: first_text(tags, &[ItemKey::Arranger]),
        label: first_text(tags, &[ItemKey::Label]),
        catalog_number: first_text(tags, &[ItemKey::CatalogNumber]),
        barcode: first_text(tags, &[ItemKey::Barcode]),
        isrc: first_text(tags, &[ItemKey::Isrc]),
        bpm: first_text(tags, &[ItemKey::Bpm, ItemKey::IntegerBpm])
            .and_then(|value| parse_f64(&value)),
        musical_key: first_text(tags, &[ItemKey::InitialKey]),
        language: first_text(tags, &[ItemKey::Language]),
        comment: first_text(tags, &[ItemKey::Comment]).or_else(|| {
            first_accessor_text(tags, |tag| tag.comment().map(|value| value.into_owned()))
        }),
        lyrics: first_text(tags, &[ItemKey::Lyrics]),
        mbid_recording: first_text(tags, &[ItemKey::MusicBrainzRecordingId]),
        mbid_release: first_text(tags, &[ItemKey::MusicBrainzReleaseId]),
        mbid_release_group: first_text(tags, &[ItemKey::MusicBrainzReleaseGroupId]),
        mbid_artist: first_text(tags, &[ItemKey::MusicBrainzArtistId]),
        mbid_album_artist: first_text(tags, &[ItemKey::MusicBrainzReleaseArtistId]),
        acoustid: first_unknown_text(tags, &["ACOUSTID_ID", "Acoustid Id", "AcoustID"]),
    }
}

impl MusicTagCanonicalMetadata {
    fn filled_field_count(&self) -> u32 {
        let mut count = 0;
        if self.title.is_some() {
            count += 1;
        }
        if self.artist.is_some() {
            count += 1;
        }
        if self.album.is_some() {
            count += 1;
        }
        if self.album_artist.is_some() {
            count += 1;
        }
        if self.genre.is_some() {
            count += 1;
        }
        if self.year.is_some() {
            count += 1;
        }
        if self.date.is_some() {
            count += 1;
        }
        if self.original_date.is_some() {
            count += 1;
        }
        if self.track_number.is_some() {
            count += 1;
        }
        if self.track_total.is_some() {
            count += 1;
        }
        if self.disc_number.is_some() {
            count += 1;
        }
        if self.disc_total.is_some() {
            count += 1;
        }
        if self.composer.is_some() {
            count += 1;
        }
        if self.lyricist.is_some() {
            count += 1;
        }
        if self.conductor.is_some() {
            count += 1;
        }
        if self.arranger.is_some() {
            count += 1;
        }
        if self.label.is_some() {
            count += 1;
        }
        if self.catalog_number.is_some() {
            count += 1;
        }
        if self.barcode.is_some() {
            count += 1;
        }
        if self.isrc.is_some() {
            count += 1;
        }
        if self.bpm.is_some() {
            count += 1;
        }
        if self.musical_key.is_some() {
            count += 1;
        }
        if self.language.is_some() {
            count += 1;
        }
        if self.comment.is_some() {
            count += 1;
        }
        if self.lyrics.is_some() {
            count += 1;
        }
        if self.mbid_recording.is_some() {
            count += 1;
        }
        if self.mbid_release.is_some() {
            count += 1;
        }
        if self.mbid_release_group.is_some() {
            count += 1;
        }
        if self.mbid_artist.is_some() {
            count += 1;
        }
        if self.mbid_album_artist.is_some() {
            count += 1;
        }
        if self.acoustid.is_some() {
            count += 1;
        }
        count
    }
}

fn first_text(tags: &[Tag], keys: &[ItemKey]) -> Option<String> {
    for key in keys {
        for tag in tags {
            if let Some(value) = tag.get_string(key).and_then(normalize_text) {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn first_accessor_text<F>(tags: &[Tag], getter: F) -> Option<String>
where
    F: Fn(&Tag) -> Option<String>,
{
    for tag in tags {
        if let Some(value) = getter(tag).and_then(|value| normalize_owned_text(value)) {
            return Some(value);
        }
    }
    None
}

fn first_accessor_u32<F>(tags: &[Tag], getter: F) -> Option<u32>
where
    F: Fn(&Tag) -> Option<u32>,
{
    tags.iter().find_map(getter)
}

fn first_unknown_text(tags: &[Tag], aliases: &[&str]) -> Option<String> {
    for tag in tags {
        for item in tag.items() {
            let ItemKey::Unknown(key) = item.key() else {
                continue;
            };
            if !aliases.iter().any(|alias| key.eq_ignore_ascii_case(alias)) {
                continue;
            }
            if let Some(value) = item_text_value(item).and_then(normalize_text) {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn first_position_pair<FNumber, FTotal>(
    tags: &[Tag],
    number_key: &ItemKey,
    total_key: &ItemKey,
    number_getter: FNumber,
    total_getter: FTotal,
) -> (Option<u32>, Option<u32>)
where
    FNumber: Fn(&Tag) -> Option<u32>,
    FTotal: Fn(&Tag) -> Option<u32>,
{
    let number_text = first_text(tags, std::slice::from_ref(number_key));
    let total_text = first_text(tags, std::slice::from_ref(total_key));
    let (number_from_text, total_from_number_text) = number_text
        .as_deref()
        .map(parse_position_pair)
        .unwrap_or((None, None));

    let number = number_from_text.or_else(|| first_accessor_u32(tags, number_getter));
    let total = total_text
        .as_deref()
        .and_then(parse_u32)
        .or(total_from_number_text)
        .or_else(|| first_accessor_u32(tags, total_getter));
    (number, total)
}

fn parse_position_pair(value: &str) -> (Option<u32>, Option<u32>) {
    let mut parts = value
        .split(|ch| ch == '/' || ch == '\\')
        .map(str::trim)
        .filter(|part| !part.is_empty());
    let number = parts.next().and_then(parse_u32);
    let total = parts.next().and_then(parse_u32);
    (number, total)
}

fn parse_year(value: &str) -> Option<u32> {
    let mut digits = String::new();
    for ch in value.chars() {
        if ch.is_ascii_digit() {
            digits.push(ch);
            if digits.len() == 4 {
                break;
            }
        } else {
            digits.clear();
        }
    }
    if digits.len() == 4 {
        parse_u32(&digits)
    } else {
        None
    }
}

fn parse_u32(value: &str) -> Option<u32> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    trimmed.parse::<u32>().ok()
}

fn parse_f64(value: &str) -> Option<f64> {
    let normalized = value.trim().replace(',', ".");
    let parsed = normalized.parse::<f64>().ok()?;
    parsed.is_finite().then_some(parsed)
}

fn item_text_value(item: &TagItem) -> Option<&str> {
    item.value().text().or_else(|| item.value().locator())
}

fn normalize_text(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn normalize_owned_text(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn format_file_type(file_type: FileType) -> String {
    match file_type {
        FileType::Aac => "aac",
        FileType::Aiff => "aiff",
        FileType::Ape => "ape",
        FileType::Flac => "flac",
        FileType::Mpeg => "mpeg",
        FileType::Mp4 => "mp4",
        FileType::Mpc => "mpc",
        FileType::Opus => "opus",
        FileType::Vorbis => "vorbis",
        FileType::Speex => "speex",
        FileType::Wav => "wav",
        FileType::WavPack => "wavPack",
        FileType::Custom(value) => value,
        _ => "unknown",
    }
    .to_string()
}

fn classify_read_error(error: &str) -> &'static str {
    if error.contains("requires file_path") {
        "missing-file-path"
    } else if error.contains("requires a file path") {
        "not-file"
    } else if error.contains("Unable to inspect") {
        "inspect-failed"
    } else if error.contains("Read music tag file failed") {
        "read-failed"
    } else {
        "unknown"
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

fn system_time_to_millis(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

pub fn write_file_tags(
    app: &AppHandle,
    request: MusicTagWriteFileRequest,
) -> Result<MusicTagWriteFileResult, String> {
    let before = read_local_tags_inner(MusicTagReadLocalRequest {
        file_path: request.file_path.clone(),
        include_cover: Some(false),
    })
    .ok();
    let mut result = write_file_tags_inner(&request);
    if let (Ok(output), Some(track_id), Some(before)) = (
        result.as_mut(),
        request.track_id.as_deref().and_then(normalize_text),
        before,
    ) {
        if let Ok(after) = read_local_tags_inner(MusicTagReadLocalRequest {
            file_path: request.file_path.clone(),
            include_cover: Some(false),
        }) {
            let changes = metadata_changes(&before.metadata, &after.metadata);
            match music_library_db::record_music_tag_file_audit(
                app,
                music_library_db::MusicTagFileAuditInput {
                    track_id: track_id.to_string(),
                    file_path: request.file_path.clone(),
                    before_file: serde_json::to_value(&before.metadata).unwrap_or(JsonValue::Null),
                    after_file: serde_json::to_value(&after.metadata).unwrap_or(JsonValue::Null),
                    changed_fields: changes,
                    file_mtime_before_ms: Some(before.mtime_ms),
                    file_mtime_after_ms: Some(after.mtime_ms),
                    status: "applied".to_string(),
                    applied_by: "user".to_string(),
                },
            ) {
                Ok(audit_id) => output.audit_id = Some(audit_id),
                Err(error) => output.warnings.push(format!("audit: {error}")),
            }
        }
    }
    match &result {
        Ok(result) => {
            backend_telemetry::info(
                app,
                "music-tag",
                "music-tag.file.write.completed",
                BackendTelemetryOptions::new()
                    .component("music_tag")
                    .field("format", json!(result.format))
                    .field("fieldsWritten", json!(result.fields_written))
                    .field("verified", json!(result.verified))
                    .field("warningCount", json!(result.warnings.len())),
            );
        }
        Err(error) => {
            backend_telemetry::error(
                app,
                "music-tag",
                "music-tag.file.write.failed",
                BackendTelemetryOptions::new()
                    .component("music_tag")
                    .message("file tag write failed")
                    .field("errorKind", json!(classify_write_error(error))),
            );
        }
    }
    result
}

fn metadata_changes(
    before: &MusicTagCanonicalMetadata,
    after: &MusicTagCanonicalMetadata,
) -> Vec<music_library_db::MusicTagDbFieldChangeRecord> {
    let before = serde_json::to_value(before).unwrap_or(JsonValue::Null);
    let after = serde_json::to_value(after).unwrap_or(JsonValue::Null);
    let Some(before) = before.as_object() else {
        return Vec::new();
    };
    let Some(after) = after.as_object() else {
        return Vec::new();
    };
    let fields = before
        .keys()
        .chain(after.keys())
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    fields
        .into_iter()
        .filter_map(|field| {
            let before_value = before
                .get(field.as_str())
                .cloned()
                .unwrap_or(JsonValue::Null);
            let after_value = after
                .get(field.as_str())
                .cloned()
                .unwrap_or(JsonValue::Null);
            if before_value == after_value {
                return None;
            }
            Some(music_library_db::MusicTagDbFieldChangeRecord {
                field: field.clone(),
                column_name: field,
                before: before_value,
                after: after_value,
                locked: false,
            })
        })
        .collect()
}

pub fn search_cover_art(
    app: &AppHandle,
    request: CoverArtSearchRequest,
) -> Result<CoverArtSearchResult, String> {
    let result = search_cover_art_inner(&request);
    match &result {
        Ok(result) => {
            backend_telemetry::info(
                app,
                "music-tag",
                "music-tag.cover-art.search.completed",
                BackendTelemetryOptions::new()
                    .component("music_tag")
                    .field("candidateCount", json!(result.candidates.len()))
                    .field("releaseMbid", json!(result.release_mbid)),
            );
        }
        Err(error) => {
            backend_telemetry::error(
                app,
                "music-tag",
                "music-tag.cover-art.search.failed",
                BackendTelemetryOptions::new()
                    .component("music_tag")
                    .message("cover art search failed")
                    .field("error", json!(error)),
            );
        }
    }
    result
}

pub fn download_cover_art<R: Runtime>(
    app: &AppHandle<R>,
    request: CoverArtDownloadRequest,
) -> Result<CoverArtDownloadResult, String> {
    let result = download_cover_art_inner(app, &request);
    match &result {
        Ok(result) => {
            backend_telemetry::info(
                app,
                "music-tag",
                "music-tag.cover-art.download.completed",
                BackendTelemetryOptions::new()
                    .component("music_tag")
                    .field("cacheKey", json!(result.cache_key))
                    .field("fileSize", json!(result.file_size)),
            );
        }
        Err(error) => {
            backend_telemetry::error(
                app,
                "music-tag",
                "music-tag.cover-art.download.failed",
                BackendTelemetryOptions::new()
                    .component("music_tag")
                    .message("cover art download failed")
                    .field("error", json!(error)),
            );
        }
    }
    result
}

fn write_file_tags_inner(
    request: &MusicTagWriteFileRequest,
) -> Result<MusicTagWriteFileResult, String> {
    let file_path = request.file_path.trim();
    if file_path.is_empty() {
        return Err("music tag file write requires file_path".to_string());
    }

    let path = Path::new(file_path);
    let fs_meta = std::fs::metadata(path)
        .map_err(|error| format!("Unable to inspect file for tag write: {error}"))?;
    if !fs_meta.is_file() {
        return Err("music tag file write requires a file path".to_string());
    }

    let mtime_before_ms = fs_meta.modified().map(system_time_to_millis).unwrap_or(0);
    if request.expected_mtime_ms > 0 && (mtime_before_ms - request.expected_mtime_ms).abs() > 1000 {
        return Err(format!(
            "File mtime mismatch: expected {}, actual {}. File may have been modified externally.",
            request.expected_mtime_ms, mtime_before_ms
        ));
    }

    let mut tagged_file =
        read_from_path(path).map_err(|error| format!("Read file for tag write failed: {error}"))?;
    let file_type = tagged_file.file_type();
    let format = format_file_type(file_type);

    let target_tag_type = preferred_tag_type(file_type);
    if tagged_file.tag(target_tag_type).is_none() {
        tagged_file.insert_tag(Tag::new(target_tag_type));
    }
    let tag = tagged_file
        .tag_mut(target_tag_type)
        .ok_or_else(|| "Failed to acquire mutable tag reference".to_string())?;

    if request.replace_all.unwrap_or(false) {
        clear_supported_metadata(tag);
    }
    let fields_written = set_metadata_to_tag(tag, &request.metadata);

    let mut warnings = Vec::new();

    if request.write_cover.unwrap_or(false) {
        match load_cover_bytes(request) {
            Ok(Some((data, detected_mime))) => {
                let mime = request
                    .cover_mime_type
                    .as_deref()
                    .or(detected_mime.as_deref())
                    .unwrap_or("image/jpeg");
                let picture = lofty::picture::Picture::new_unchecked(
                    lofty::picture::PictureType::CoverFront,
                    Some(lofty::picture::MimeType::from_str(mime)),
                    None,
                    data,
                );
                tag.push_picture(picture);
            }
            Ok(None) => warnings.push("cover-data-missing".to_string()),
            Err(error) => warnings.push(format!("cover-load-failed: {error}")),
        }
    }

    tagged_file
        .save_to_path(path, WriteOptions::default())
        .map_err(|error| format!("Write file tags failed: {error}"))?;

    let fs_meta_after = std::fs::metadata(path)
        .map_err(|error| format!("Unable to inspect file after tag write: {error}"))?;
    let mtime_after_ms = fs_meta_after
        .modified()
        .map(system_time_to_millis)
        .unwrap_or(0);

    let verified = verify_written_tags(
        path,
        &request.metadata,
        request.replace_all.unwrap_or(false),
    );
    if !verified {
        warnings.push("verification-partial".to_string());
    }

    Ok(MusicTagWriteFileResult {
        audit_id: None,
        file_path: file_path.to_string(),
        format,
        fields_written,
        mtime_before_ms,
        mtime_after_ms,
        verified,
        warnings,
    })
}

fn load_cover_bytes(
    request: &MusicTagWriteFileRequest,
) -> Result<Option<(Vec<u8>, Option<String>)>, String> {
    if let Some(cover_b64) = request
        .cover_data_base64
        .as_deref()
        .and_then(normalize_text)
    {
        let payload = cover_b64
            .split_once(",")
            .filter(|(prefix, _)| prefix.starts_with("data:"))
            .map(|(_, payload)| payload)
            .unwrap_or(cover_b64);
        return base64_decode(payload).map(|data| Some((data, None)));
    }
    let Some(cover_url) = request.cover_url.as_deref().and_then(normalize_text) else {
        return Ok(None);
    };
    let response = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("build cover client failed: {error}"))?
        .get(cover_url)
        .header(
            reqwest::header::USER_AGENT,
            "PixelMatrixPlayer/0.1 (music-tag-workbench)",
        )
        .send()
        .map_err(|error| format!("cover request failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("cover response failed: {error}"))?;
    if response
        .content_length()
        .is_some_and(|size| size > 15 * 1024 * 1024)
    {
        return Err("cover image exceeds 15 MiB".to_string());
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let data = response
        .bytes()
        .map_err(|error| format!("read cover response failed: {error}"))?
        .to_vec();
    if data.len() > 15 * 1024 * 1024 {
        return Err("cover image exceeds 15 MiB".to_string());
    }
    Ok(Some((data, mime)))
}

fn preferred_tag_type(file_type: FileType) -> TagType {
    match file_type {
        FileType::Mpeg | FileType::Aac | FileType::Aiff | FileType::Wav => TagType::Id3v2,
        FileType::Flac | FileType::Vorbis | FileType::Opus | FileType::Speex => {
            TagType::VorbisComments
        }
        FileType::Mp4 => TagType::Mp4Ilst,
        FileType::Ape | FileType::WavPack | FileType::Mpc => TagType::Ape,
        _ => TagType::Id3v2,
    }
}

fn set_metadata_to_tag(tag: &mut Tag, metadata: &MusicTagCanonicalMetadata) -> u32 {
    let mut count = 0u32;

    macro_rules! set_text {
        ($field:expr, $key:expr) => {
            if let Some(ref value) = $field {
                let trimmed = value.trim();
                if !trimmed.is_empty() {
                    tag.insert_text($key, trimmed.to_string());
                    count += 1;
                }
            }
        };
    }

    macro_rules! set_u32 {
        ($field:expr, $key:expr) => {
            if let Some(value) = $field {
                tag.insert_text($key, value.to_string());
                count += 1;
            }
        };
    }

    set_text!(metadata.title, ItemKey::TrackTitle);
    set_text!(metadata.artist, ItemKey::TrackArtist);
    set_text!(metadata.album, ItemKey::AlbumTitle);
    set_text!(metadata.album_artist, ItemKey::AlbumArtist);
    set_text!(metadata.genre, ItemKey::Genre);
    if let Some(year) = metadata.year {
        tag.insert_text(ItemKey::Year, year.to_string());
        count += 1;
    }
    set_text!(metadata.date, ItemKey::RecordingDate);
    set_text!(metadata.original_date, ItemKey::OriginalReleaseDate);
    set_u32!(metadata.track_number, ItemKey::TrackNumber);
    set_u32!(metadata.track_total, ItemKey::TrackTotal);
    set_u32!(metadata.disc_number, ItemKey::DiscNumber);
    set_u32!(metadata.disc_total, ItemKey::DiscTotal);
    set_text!(metadata.composer, ItemKey::Composer);
    set_text!(metadata.lyricist, ItemKey::Lyricist);
    set_text!(metadata.conductor, ItemKey::Conductor);
    set_text!(metadata.arranger, ItemKey::Arranger);
    set_text!(metadata.label, ItemKey::Label);
    set_text!(metadata.catalog_number, ItemKey::CatalogNumber);
    set_text!(metadata.barcode, ItemKey::Barcode);
    set_text!(metadata.isrc, ItemKey::Isrc);
    if let Some(bpm) = metadata.bpm {
        if bpm.is_finite() && bpm > 0.0 {
            tag.insert_text(ItemKey::Bpm, format!("{:.0}", bpm));
            count += 1;
        }
    }
    set_text!(metadata.musical_key, ItemKey::InitialKey);
    set_text!(metadata.language, ItemKey::Language);
    set_text!(metadata.comment, ItemKey::Comment);
    set_text!(metadata.lyrics, ItemKey::Lyrics);
    set_text!(metadata.mbid_recording, ItemKey::MusicBrainzRecordingId);
    set_text!(metadata.mbid_release, ItemKey::MusicBrainzReleaseId);
    set_text!(
        metadata.mbid_release_group,
        ItemKey::MusicBrainzReleaseGroupId
    );
    set_text!(metadata.mbid_artist, ItemKey::MusicBrainzArtistId);
    set_text!(
        metadata.mbid_album_artist,
        ItemKey::MusicBrainzReleaseArtistId
    );

    if let Some(ref acoustid_value) = metadata.acoustid {
        let trimmed = acoustid_value.trim();
        if !trimmed.is_empty() {
            tag.insert_unchecked(TagItem::new(
                ItemKey::Unknown("ACOUSTID_ID".to_string()),
                lofty::tag::ItemValue::Text(trimmed.to_string()),
            ));
            count += 1;
        }
    }

    count
}

fn clear_supported_metadata(tag: &mut Tag) {
    let keys = [
        ItemKey::TrackTitle,
        ItemKey::TrackArtist,
        ItemKey::AlbumTitle,
        ItemKey::AlbumArtist,
        ItemKey::Genre,
        ItemKey::Year,
        ItemKey::RecordingDate,
        ItemKey::OriginalReleaseDate,
        ItemKey::TrackNumber,
        ItemKey::TrackTotal,
        ItemKey::DiscNumber,
        ItemKey::DiscTotal,
        ItemKey::Composer,
        ItemKey::Lyricist,
        ItemKey::Conductor,
        ItemKey::Arranger,
        ItemKey::Label,
        ItemKey::CatalogNumber,
        ItemKey::Barcode,
        ItemKey::Isrc,
        ItemKey::Bpm,
        ItemKey::InitialKey,
        ItemKey::Language,
        ItemKey::Comment,
        ItemKey::Lyrics,
        ItemKey::MusicBrainzRecordingId,
        ItemKey::MusicBrainzReleaseId,
        ItemKey::MusicBrainzReleaseGroupId,
        ItemKey::MusicBrainzArtistId,
        ItemKey::MusicBrainzReleaseArtistId,
        ItemKey::Unknown("ACOUSTID_ID".to_string()),
    ];
    for key in keys {
        tag.remove_key(&key);
    }
}

fn verify_written_tags(
    path: &Path,
    expected: &MusicTagCanonicalMetadata,
    replace_all: bool,
) -> bool {
    let Ok(tagged_file) = read_from_path(path) else {
        return false;
    };
    let tags = tagged_file.tags();
    let actual = extract_metadata_from_tags(tags);

    if replace_all {
        return &actual == expected;
    }

    let mut verified = true;
    if expected.title.is_some() && actual.title != expected.title {
        verified = false;
    }
    if expected.artist.is_some() && actual.artist != expected.artist {
        verified = false;
    }
    if expected.album.is_some() && actual.album != expected.album {
        verified = false;
    }
    verified
}

fn search_cover_art_inner(request: &CoverArtSearchRequest) -> Result<CoverArtSearchResult, String> {
    let mbid = request.mbid_release.trim();
    if mbid.is_empty() {
        return Err("cover art search requires mbid_release".to_string());
    }

    let url = format!("https://coverartarchive.org/release/{mbid}");
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("PixelMatrixPlayer/0.1 (music-tag-workbench)")
        .build()
        .map_err(|error| format!("HTTP client build failed: {error}"))?;

    let response = client
        .get(&url)
        .header("Accept", "application/json")
        .send()
        .map_err(|error| format!("Cover Art Archive request failed: {error}"))?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(CoverArtSearchResult {
            candidates: Vec::new(),
            release_mbid: mbid.to_string(),
            warnings: vec!["no-cover-art-for-release".to_string()],
        });
    }

    if !response.status().is_success() {
        return Err(format!(
            "Cover Art Archive returned status {}",
            response.status()
        ));
    }

    let body: JsonValue = response
        .json()
        .map_err(|error| format!("Cover Art Archive JSON parse failed: {error}"))?;

    let mut candidates = Vec::new();
    let mut warnings = Vec::new();

    if let Some(images) = body.get("images").and_then(|v| v.as_array()) {
        for image in images {
            let image_url = image
                .get("image")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            if image_url.is_empty() {
                continue;
            }

            let thumbnail_url = image
                .get("thumbnails")
                .and_then(|t| {
                    t.get("500")
                        .or_else(|| t.get("large"))
                        .or_else(|| t.get("small"))
                })
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let cover_type = if image
                .get("front")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                "front".to_string()
            } else if image.get("back").and_then(|v| v.as_bool()).unwrap_or(false) {
                "back".to_string()
            } else {
                image
                    .get("types")
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|v| v.as_str())
                    .unwrap_or("other")
                    .to_lowercase()
            };

            let approved = image
                .get("approved")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            candidates.push(CoverArtCandidate {
                url: image_url,
                thumbnail_url,
                cover_type,
                approved,
            });
        }
    } else {
        warnings.push("unexpected-response-format".to_string());
    }

    Ok(CoverArtSearchResult {
        candidates,
        release_mbid: mbid.to_string(),
        warnings,
    })
}

fn download_cover_art_inner<R: Runtime>(
    app: &AppHandle<R>,
    request: &CoverArtDownloadRequest,
) -> Result<CoverArtDownloadResult, String> {
    let url = request.url.trim();
    if url.is_empty() {
        return Err("cover art download requires url".to_string());
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("PixelMatrixPlayer/0.1 (music-tag-workbench)")
        .build()
        .map_err(|error| format!("HTTP client build failed: {error}"))?;

    let response = client
        .get(url)
        .send()
        .map_err(|error| format!("Cover art download failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Cover art download returned status {}",
            response.status()
        ));
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    let data = response
        .bytes()
        .map_err(|error| format!("Cover art read bytes failed: {error}"))?;

    let file_size = data.len() as u64;
    let extension = match content_type.as_str() {
        "image/png" => "png",
        "image/webp" => "webp",
        _ => "jpg",
    };

    let hash = {
        let mut hasher = Sha256::new();
        hasher.update(&data);
        let digest = hasher.finalize();
        format!("{:x}", digest)[..16].to_string()
    };

    let cache_key = format!("music-tag-cover-{}-{hash}", request.track_id.trim());
    let cache_dir = app
        .path_resolver()
        .app_cache_dir()
        .ok_or_else(|| "Resolve cache dir failed: no app cache dir".to_string())?
        .join("music-covers");

    std::fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("Create cover cache dir failed: {error}"))?;

    let file_name = format!("{cache_key}.{extension}");
    let file_path = cache_dir.join(&file_name);
    std::fs::write(&file_path, &data)
        .map_err(|error| format!("Write cover cache file failed: {error}"))?;

    Ok(CoverArtDownloadResult {
        cache_key,
        file_size,
        mime_type: content_type,
        width: None,
        height: None,
    })
}

fn classify_write_error(error: &str) -> &'static str {
    if error.contains("requires file_path") {
        "missing-file-path"
    } else if error.contains("requires a file path") {
        "not-file"
    } else if error.contains("mtime mismatch") {
        "stale-file"
    } else if error.contains("Read file for tag write") {
        "read-failed"
    } else if error.contains("Write file tags failed") {
        "write-failed"
    } else {
        "unknown"
    }
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(input)
        .map_err(|error| format!("base64 decode failed: {error}"))
}

pub fn generate_chromaprint<R: Runtime>(
    app: &AppHandle<R>,
    request: ChromaprintRequest,
) -> Result<ChromaprintResult, String> {
    let result = generate_chromaprint_inner(&request);
    match &result {
        Ok(r) => {
            backend_telemetry::info(
                app,
                "music-tag",
                "music-tag.chromaprint.completed",
                BackendTelemetryOptions::new()
                    .component("music_tag")
                    .field("durationSeconds", json!(r.duration_seconds))
                    .field("sampleRate", json!(r.sample_rate))
                    .field("channels", json!(r.channels)),
            );
        }
        Err(error) => {
            backend_telemetry::error(
                app,
                "music-tag",
                "music-tag.chromaprint.failed",
                BackendTelemetryOptions::new()
                    .component("music_tag")
                    .message(error),
            );
        }
    }
    result
}

fn generate_chromaprint_inner(request: &ChromaprintRequest) -> Result<ChromaprintResult, String> {
    use rusty_chromaprint::{Configuration, Fingerprinter};
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file_path = &request.file_path;
    let max_duration = request.max_duration_seconds.unwrap_or(120.0);

    let file = std::fs::File::open(file_path).map_err(|e| format!("open file failed: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = Path::new(file_path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("probe failed: {e}"))?;

    let mut format_reader = probed.format;

    let audio_track = format_reader
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or_else(|| "no audio track found".to_string())?;

    let codec_params = audio_track.codec_params.clone();
    let track_id = audio_track.id;

    let sample_rate = codec_params
        .sample_rate
        .ok_or_else(|| "unknown sample rate".to_string())?;
    let channels = codec_params
        .channels
        .map(|ch| ch.count() as u32)
        .unwrap_or(2);

    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|e| format!("create decoder failed: {e}"))?;

    let config = Configuration::preset_test2();
    let mut printer = Fingerprinter::new(&config);
    printer
        .start(sample_rate, channels)
        .map_err(|e| format!("fingerprinter start failed: {e}"))?;

    let max_samples = (max_duration * sample_rate as f64 * channels as f64) as u64;
    let mut total_samples: u64 = 0;

    loop {
        if total_samples >= max_samples {
            break;
        }

        let packet = match format_reader.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(_) => break,
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(buf) => buf,
            Err(_) => continue,
        };

        let spec = *decoded.spec();
        let num_frames = decoded.frames();
        let mut sample_buf = SampleBuffer::<i16>::new(num_frames as u64, spec);
        sample_buf.copy_interleaved_ref(decoded);

        let samples = sample_buf.samples();
        printer.consume(samples);
        total_samples += samples.len() as u64;
    }

    printer.finish();

    let raw_fingerprint = printer.fingerprint();
    if raw_fingerprint.is_empty() {
        return Err("fingerprint generation produced empty result".to_string());
    }

    let compressed = compress_chromaprint_fingerprint(raw_fingerprint);

    use base64::Engine;
    let fingerprint_str = base64::engine::general_purpose::STANDARD.encode(&compressed);

    let duration_seconds = total_samples as f64 / (sample_rate as f64 * channels as f64);

    Ok(ChromaprintResult {
        file_path: file_path.clone(),
        fingerprint: fingerprint_str,
        duration_seconds,
        sample_rate,
        channels,
    })
}

/// Compress a raw chromaprint fingerprint into the format expected by AcoustID.
/// Implements the Chromaprint v1 compression algorithm.
fn compress_chromaprint_fingerprint(fingerprint: &[u32]) -> Vec<u8> {
    let size = fingerprint.len();

    // Header: algorithm (1 byte) + size (3 bytes big-endian)
    let mut result = Vec::with_capacity(4 + size * 2);
    result.push(1u8);
    result.push(((size >> 16) & 0xFF) as u8);
    result.push(((size >> 8) & 0xFF) as u8);
    result.push((size & 0xFF) as u8);

    // XOR-delta encode, then convert to gray code for better compression
    let mut deltas: Vec<u32> = Vec::with_capacity(size);
    let mut prev: u32 = 0;
    for &value in fingerprint {
        let xor = value ^ prev;
        prev = value;
        // Signed-magnitude encoding for the XOR delta (treat as i32 sign bit)
        // Gray code: value ^ (value >> 1) — but chromaprint uses a different transform:
        // It maps the XOR delta to unsigned via: if sign bit set, flip all bits
        // Actually the transform is: (x << 1) ^ (x >> 31) — zig-zag encoding
        let zigzag = (xor << 1) ^ ((xor as i32 >> 31) as u32);
        deltas.push(zigzag);
    }

    // Encode in 16 sub-bands of 2 bits each
    let mut writer = ChromaprintBitWriter::new();
    for sub in 0..16u32 {
        for &delta in &deltas {
            let bits2 = (delta >> (sub * 2)) & 0x03;
            chromaprint_encode_value(&mut writer, bits2);
        }
    }

    result.extend_from_slice(&writer.into_bytes());
    result
}

struct ChromaprintBitWriter {
    bytes: Vec<u8>,
    bit_count: usize,
}

impl ChromaprintBitWriter {
    fn new() -> Self {
        Self {
            bytes: Vec::new(),
            bit_count: 0,
        }
    }

    fn write_bits(&mut self, mut value: u32, num_bits: u32) {
        for _ in 0..num_bits {
            let byte_idx = self.bit_count / 8;
            let bit_idx = self.bit_count % 8;
            if byte_idx >= self.bytes.len() {
                self.bytes.push(0);
            }
            if value & 1 != 0 {
                self.bytes[byte_idx] |= 1 << bit_idx;
            }
            value >>= 1;
            self.bit_count += 1;
        }
    }

    fn into_bytes(self) -> Vec<u8> {
        self.bytes
    }
}

fn chromaprint_encode_value(writer: &mut ChromaprintBitWriter, mut value: u32) {
    const NORMAL_BITS: u32 = 3;
    const MAX_NORMAL: u32 = (1 << NORMAL_BITS) - 1; // 7
    while value >= MAX_NORMAL {
        writer.write_bits(MAX_NORMAL, NORMAL_BITS);
        value -= MAX_NORMAL;
    }
    writer.write_bits(value, NORMAL_BITS);
}

// ─── Batch Processing ───────────────────────────────────────────────────────

const EVENT_MUSIC_TAG_BATCH_PROGRESS: &str = "music-tag-batch-progress";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MusicTagBatchMode {
    ApplyDb,
    WriteFile,
    ApplyAndWrite,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTagBatchItem {
    pub track_id: String,
    pub file_path: String,
    pub source_metadata: MusicTagCanonicalMetadata,
    pub locked_fields: Vec<String>,
    pub tag_source: Option<String>,
    pub tag_confidence: Option<f64>,
    pub expected_mtime_ms: Option<i64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTagBatchRequest {
    pub mode: MusicTagBatchMode,
    pub items: Vec<MusicTagBatchItem>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTagBatchProgressPayload {
    pub run_id: String,
    pub mode: MusicTagBatchMode,
    pub total: u32,
    pub current: u32,
    pub current_track_id: Option<String>,
    pub status: String,
    pub applied_count: u32,
    pub skipped_count: u32,
    pub error_count: u32,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTagBatchState {
    pub running: bool,
    pub run_id: Option<String>,
    pub mode: Option<MusicTagBatchMode>,
    pub total: u32,
    pub current: u32,
    pub applied_count: u32,
    pub skipped_count: u32,
    pub error_count: u32,
}

struct BatchJob {
    cancel: Arc<AtomicBool>,
}

use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

static BATCH_STATE: Lazy<Mutex<MusicTagBatchState>> = Lazy::new(|| {
    Mutex::new(MusicTagBatchState {
        running: false,
        run_id: None,
        mode: None,
        total: 0,
        current: 0,
        applied_count: 0,
        skipped_count: 0,
        error_count: 0,
    })
});
static BATCH_JOB: Lazy<Mutex<Option<BatchJob>>> = Lazy::new(|| Mutex::new(None));

static BATCH_NONCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub fn start_batch_job(app: &AppHandle, request: MusicTagBatchRequest) -> Result<String, String> {
    {
        let guard = BATCH_STATE.lock().unwrap_or_else(|p| p.into_inner());
        if guard.running {
            return Err("batch job already running".to_string());
        }
    }

    let run_id = format!("batch-{}", BATCH_NONCE.fetch_add(1, Ordering::Relaxed));

    let total = request.items.len() as u32;
    let mode = request.mode.clone();

    {
        let mut guard = BATCH_STATE.lock().unwrap_or_else(|p| p.into_inner());
        *guard = MusicTagBatchState {
            running: true,
            run_id: Some(run_id.clone()),
            mode: Some(mode.clone()),
            total,
            current: 0,
            applied_count: 0,
            skipped_count: 0,
            error_count: 0,
        };
    }

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut guard = BATCH_JOB.lock().unwrap_or_else(|p| p.into_inner());
        *guard = Some(BatchJob {
            cancel: cancel.clone(),
        });
    }

    let app_handle = app.clone();
    let run_id_clone = run_id.clone();

    std::thread::spawn(move || {
        run_batch_job(&app_handle, request, &run_id_clone, cancel);
    });

    Ok(run_id)
}

fn run_batch_job(
    app: &AppHandle,
    request: MusicTagBatchRequest,
    run_id: &str,
    cancel: Arc<AtomicBool>,
) {
    let total = request.items.len() as u32;
    let mode = &request.mode;
    let mut applied_count: u32 = 0;
    let mut skipped_count: u32 = 0;
    let mut error_count: u32 = 0;
    let mut last_error: Option<String> = None;

    for (index, item) in request.items.into_iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            let payload = MusicTagBatchProgressPayload {
                run_id: run_id.to_string(),
                mode: mode.clone(),
                total,
                current: index as u32,
                current_track_id: Some(item.track_id.clone()),
                status: "cancelled".to_string(),
                applied_count,
                skipped_count,
                error_count,
                last_error: last_error.clone(),
            };
            let _ = app.emit_all(EVENT_MUSIC_TAG_BATCH_PROGRESS, payload);
            break;
        }

        let track_id = item.track_id.clone();
        let mut item_applied = false;

        match mode {
            MusicTagBatchMode::ApplyDb | MusicTagBatchMode::ApplyAndWrite => {
                let db_request = MusicTagDbPatchRequest {
                    track_id: item.track_id.clone(),
                    source_metadata: item.source_metadata.clone(),
                    selected_candidate_ids: None,
                    locked_fields: Some(item.locked_fields.clone()),
                    lock_mode: None,
                    tag_source: item.tag_source.clone(),
                    tag_confidence: item.tag_confidence,
                    expected_mtime_ms: item.expected_mtime_ms,
                };
                match apply_db_patch(app, db_request) {
                    Ok(result) => {
                        if result.applied {
                            item_applied = true;
                        } else {
                            skipped_count += 1;
                        }
                    }
                    Err(error) => {
                        error_count += 1;
                        last_error = Some(format!("{}: {}", track_id, error));
                    }
                }
            }
            MusicTagBatchMode::WriteFile => {}
        }

        if matches!(
            mode,
            MusicTagBatchMode::WriteFile | MusicTagBatchMode::ApplyAndWrite
        ) {
            let write_request = MusicTagWriteFileRequest {
                track_id: Some(item.track_id.clone()),
                file_path: item.file_path.clone(),
                metadata: item.source_metadata.clone(),
                expected_mtime_ms: item.expected_mtime_ms.unwrap_or(0),
                write_cover: None,
                cover_data_base64: None,
                cover_url: None,
                cover_mime_type: None,
                replace_all: None,
            };
            match write_file_tags(app, write_request) {
                Ok(_) => {
                    item_applied = true;
                }
                Err(error) => {
                    error_count += 1;
                    last_error = Some(format!("{}: {}", track_id, error));
                }
            }
        }

        if item_applied {
            applied_count += 1;
        }

        {
            let mut guard = BATCH_STATE.lock().unwrap_or_else(|p| p.into_inner());
            guard.current = (index + 1) as u32;
            guard.applied_count = applied_count;
            guard.skipped_count = skipped_count;
            guard.error_count = error_count;
        }

        let payload = MusicTagBatchProgressPayload {
            run_id: run_id.to_string(),
            mode: mode.clone(),
            total,
            current: (index + 1) as u32,
            current_track_id: Some(track_id),
            status: "running".to_string(),
            applied_count,
            skipped_count,
            error_count,
            last_error: last_error.clone(),
        };
        let _ = app.emit_all(EVENT_MUSIC_TAG_BATCH_PROGRESS, payload);
    }

    if !cancel.load(Ordering::Relaxed) {
        let payload = MusicTagBatchProgressPayload {
            run_id: run_id.to_string(),
            mode: mode.clone(),
            total,
            current: total,
            current_track_id: None,
            status: "done".to_string(),
            applied_count,
            skipped_count,
            error_count,
            last_error,
        };
        let _ = app.emit_all(EVENT_MUSIC_TAG_BATCH_PROGRESS, payload);
    }

    {
        let mut guard = BATCH_STATE.lock().unwrap_or_else(|p| p.into_inner());
        guard.running = false;
    }
    {
        let mut guard = BATCH_JOB.lock().unwrap_or_else(|p| p.into_inner());
        *guard = None;
    }
}

pub fn cancel_batch_job() -> Result<bool, String> {
    let guard = BATCH_JOB.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(job) = guard.as_ref() {
        job.cancel.store(true, Ordering::Relaxed);
        Ok(true)
    } else {
        Ok(false)
    }
}

pub fn get_batch_state() -> MusicTagBatchState {
    BATCH_STATE
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
}

#[cfg(test)]
mod tests {
    use lofty::picture::{MimeType, Picture, PictureType};
    use lofty::tag::{ItemKey, ItemValue, Tag, TagItem, TagType};

    use super::{extract_embedded_cover, extract_metadata_from_tags, parse_position_pair, parse_year};

    #[test]
    fn parses_position_pair() {
        assert_eq!(parse_position_pair("7/11"), (Some(7), Some(11)));
        assert_eq!(parse_position_pair(" 03 "), (Some(3), None));
    }

    #[test]
    fn parses_year_from_dates() {
        assert_eq!(parse_year("2024-05-04"), Some(2024));
        assert_eq!(parse_year("released 1999"), Some(1999));
        assert_eq!(parse_year("unknown"), None);
    }

    #[test]
    fn extracts_standard_metadata_from_tag() {
        let mut tag = Tag::new(TagType::Id3v2);
        assert!(tag.insert_text(ItemKey::TrackTitle, "Title".to_string()));
        assert!(tag.insert_text(ItemKey::TrackArtist, "Artist".to_string()));
        assert!(tag.insert_text(ItemKey::AlbumTitle, "Album".to_string()));
        assert!(tag.insert_text(ItemKey::TrackNumber, "7/11".to_string()));
        assert!(tag.insert_text(ItemKey::RecordingDate, "2024-05-04".to_string()));
        tag.insert_unchecked(TagItem::new(
            ItemKey::MusicBrainzRecordingId,
            ItemValue::Text("mbid-1".to_string()),
        ));

        let metadata = extract_metadata_from_tags(&[tag]);
        assert_eq!(metadata.title.as_deref(), Some("Title"));
        assert_eq!(metadata.artist.as_deref(), Some("Artist"));
        assert_eq!(metadata.album.as_deref(), Some("Album"));
        assert_eq!(metadata.track_number, Some(7));
        assert_eq!(metadata.track_total, Some(11));
        assert_eq!(metadata.year, Some(2024));
        assert_eq!(metadata.mbid_recording.as_deref(), Some("mbid-1"));
    }

    #[test]
    fn extracts_acoustid_from_unknown_key() {
        let mut tag = Tag::new(TagType::VorbisComments);
        tag.insert_unchecked(TagItem::new(
            ItemKey::Unknown("ACOUSTID_ID".to_string()),
            ItemValue::Text("acoustid-1".to_string()),
        ));

        let metadata = extract_metadata_from_tags(&[tag]);
        assert_eq!(metadata.acoustid.as_deref(), Some("acoustid-1"));
    }

    #[test]
    fn extracts_front_cover_as_base64() {
        let mut tag = Tag::new(TagType::Id3v2);
        tag.push_picture(Picture::new_unchecked(
            PictureType::CoverFront,
            Some(MimeType::Jpeg),
            None,
            vec![0xFF, 0xD8, 0xFF, 0x01],
        ));

        let mut warnings = Vec::new();
        let cover = extract_embedded_cover(&[tag], &mut warnings).expect("cover");
        assert_eq!(cover.mime_type, "image/jpeg");
        assert_eq!(cover.byte_length, 4);
        assert_eq!(cover.data_base64, "/9j/AQ==");
        assert!(warnings.is_empty());
    }
}
