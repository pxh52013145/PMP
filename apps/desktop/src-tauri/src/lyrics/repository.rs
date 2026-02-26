use crate::{
    lyrics::domain::PMPLyricDocument,
    music_library_db::{
        self, LibraryLyricCandidateUpsertInput, LibraryLyricDocumentUpsertInput,
        LibraryLyricFetchJobUpsertInput, LibraryLyricSelectionUpsertInput,
    },
};
use tauri::AppHandle;

fn stable_hash(input: &str) -> String {
    format!("{:x}", md5::compute(input.as_bytes()))
}

pub fn persist_selected_document(
    app: &AppHandle,
    selection_key: &str,
    selected_by: &str,
    document: &PMPLyricDocument,
) -> Result<PMPLyricDocument, String> {
    let payload_json = serde_json::to_string(document)
        .map_err(|error| format!("Serialize lyric payload failed: {error}"))?;
    let payload_hash = stable_hash(&payload_json);

    let persisted_record = music_library_db::upsert_lyric_document(
        app,
        LibraryLyricDocumentUpsertInput {
            id: if document.id.trim().is_empty() {
                None
            } else {
                Some(document.id.clone())
            },
            selection_key: selection_key.to_string(),
            entry_id: document.entry_id.clone(),
            track_id: document.track_id.clone(),
            quick_fingerprint: document.quick_fingerprint.clone(),
            source_kind: document.source_kind.as_str().to_string(),
            source_locator: document.source_locator.clone(),
            format: document.format.clone(),
            language: document.language.clone(),
            is_dynamic: document.is_dynamic,
            has_word_timing: document.has_word_timing,
            confidence: Some(document.confidence),
            payload_json,
            content_hash: Some(payload_hash.clone()),
            updated_at_ms: Some(document.updated_at_ms),
        },
    )?;

    let candidate_id = format!("lycand::{selection_key}::{payload_hash}");
    music_library_db::upsert_lyric_candidate(
        app,
        LibraryLyricCandidateUpsertInput {
            id: Some(candidate_id.clone()),
            selection_key: selection_key.to_string(),
            entry_id: persisted_record.entry_id.clone(),
            document_id: persisted_record.id.clone(),
            source_kind: persisted_record.source_kind.clone(),
            rank_score: Some(f64::from(document.confidence)),
            source_priority: Some(source_priority(persisted_record.source_kind.as_str())),
            resolver: Some(persisted_record.source_kind.clone()),
            status: Some("ready".to_string()),
            updated_at_ms: Some(document.updated_at_ms),
        },
    )?;

    music_library_db::upsert_lyric_selection(
        app,
        LibraryLyricSelectionUpsertInput {
            selection_key: selection_key.to_string(),
            entry_id: persisted_record.entry_id.clone(),
            selected_document_id: persisted_record.id.clone(),
            selected_candidate_id: Some(candidate_id),
            selected_by: Some(selected_by.trim().to_string()),
            updated_at_ms: Some(document.updated_at_ms),
        },
    )?;

    let mut persisted = document.clone();
    persisted.id = persisted_record.id;
    persisted.updated_at_ms = persisted_record.updated_at_ms;
    Ok(persisted)
}

pub fn get_selected_document(
    app: &AppHandle,
    selection_key: &str,
) -> Result<Option<PMPLyricDocument>, String> {
    let Some(record) = music_library_db::get_selected_lyric_document(app, selection_key)? else {
        return Ok(None);
    };

    let mut parsed = serde_json::from_str::<PMPLyricDocument>(&record.payload_json)
        .map_err(|error| format!("Parse lyric payload failed: {error}"))?;
    parsed.id = record.id;
    parsed.entry_id = record.entry_id;
    parsed.track_id = record.track_id;
    parsed.quick_fingerprint = record.quick_fingerprint;
    parsed.source_locator = record.source_locator;
    parsed.format = record.format;
    parsed.language = record.language;
    parsed.is_dynamic = record.is_dynamic;
    parsed.has_word_timing = record.has_word_timing;
    parsed.confidence = record.confidence;
    parsed.updated_at_ms = record.updated_at_ms;
    Ok(Some(parsed))
}

pub fn enqueue_fetch_job(
    app: &AppHandle,
    selection_key: &str,
    entry_id: Option<&str>,
    track_id: Option<&str>,
    payload_json: Option<&str>,
) -> Result<(), String> {
    music_library_db::upsert_lyric_fetch_job(
        app,
        LibraryLyricFetchJobUpsertInput {
            id: Some(format!("lyjob::{selection_key}")),
            selection_key: selection_key.to_string(),
            entry_id: entry_id.map(str::to_string),
            track_id: track_id.map(str::to_string),
            priority: Some(100),
            status: Some("queued".to_string()),
            attempt_count: Some(0),
            next_run_at_ms: None,
            last_error: None,
            payload_json: payload_json.map(str::to_string),
            updated_at_ms: None,
        },
    )
    .map(|_| ())
}

fn source_priority(source_kind: &str) -> i64 {
    match source_kind {
        "embedded" => 10,
        "sidecar" => 20,
        "cache" => 30,
        "web" => 40,
        _ => 100,
    }
}
