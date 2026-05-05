use std::{
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use lofty::{
    file::{FileType, TaggedFileExt},
    read_from_path,
    tag::{Accessor, ItemKey, Tag, TagItem},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Runtime};

use crate::backend_telemetry::{self, BackendTelemetryOptions};
use crate::{lyrics, music_library_db};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTagReadLocalRequest {
    pub file_path: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
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
    pub include_network: Option<bool>,
    pub include_lyrics: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTagCandidate {
    pub id: String,
    pub provider: String,
    pub provider_entity_type: String,
    pub provider_entity_id: Option<String>,
    pub metadata: MusicTagCanonicalMetadata,
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
    let seed_metadata = metadata_from_candidate_request(&request);

    let mut candidates = Vec::new();
    let mut searched_providers = Vec::new();
    let mut warnings = Vec::new();
    let mut lyrics_resolution = None;

    if include_network {
        searched_providers.push("musicbrainz".to_string());
        match search_musicbrainz_candidates(&request, &seed_metadata, limit, fetched_at_ms) {
            Ok(mut items) => candidates.append(&mut items),
            Err(error) => warnings.push(format!("musicbrainz: {error}")),
        }

        searched_providers.push("acoustid".to_string());
        match search_acoustid_candidates(&request, &seed_metadata, limit, fetched_at_ms) {
            Ok(mut items) => candidates.append(&mut items),
            Err(error) => warnings.push(format!("acoustid: {error}")),
        }
    }

    if include_lyrics {
        searched_providers.push("lyrics".to_string());
        match resolve_lyrics_candidate(app, &request, &seed_metadata, fetched_at_ms) {
            Ok((summary, candidate)) => {
                lyrics_resolution = summary;
                if let Some(candidate) = candidate {
                    candidates.push(candidate);
                }
            }
            Err(error) => warnings.push(format!("lyrics: {error}")),
        }
    }

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

    Ok(MusicTagReadLocalResult {
        file_path: file_path.to_string(),
        file_size: metadata.len(),
        mtime_ms: metadata.modified().map(system_time_to_millis).unwrap_or(0),
        format: Some(format_file_type(tagged_file.file_type())),
        tag_count: tags.len() as u32,
        tag_types,
        field_count,
        metadata: extracted,
        warnings,
        read_at_ms: now_ms(),
    })
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

#[cfg(test)]
mod tests {
    use lofty::tag::{ItemKey, ItemValue, Tag, TagItem, TagType};

    use super::{extract_metadata_from_tags, parse_position_pair, parse_year};

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
}
