use once_cell::sync::{Lazy, OnceCell};
use rusqlite::{
    params, params_from_iter,
    types::{Value, ValueRef},
    Connection, Transaction,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value as JsonValue};
use std::{
    collections::{hash_map::DefaultHasher, HashMap, VecDeque},
    hash::{Hash, Hasher},
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const DB_VERSION: i32 = 9;
pub const EVENT_MUSIC_LIBRARY_SCHEMA_CHANGED: &str = "music-library-schema-changed";

static DB_CONN: Lazy<Mutex<Option<Connection>>> = Lazy::new(|| Mutex::new(None));
static DB_PATH: OnceCell<PathBuf> = OnceCell::new();
static OBSERVED_SCHEMA_STATE: Lazy<Mutex<Option<ObservedLibrarySchemaState>>> =
    Lazy::new(|| Mutex::new(None));

const TRACK_QUERY_COUNT_CACHE_MAX_ENTRIES: usize = 64;
const TRACK_QUERY_COUNT_CACHE_TTL_MS: i64 = 4_000;

#[derive(Clone, Copy)]
struct TrackQueryCountCacheEntry {
    total: u64,
    captured_at_ms: i64,
}

#[derive(Default)]
struct TrackQueryCountCache {
    order: VecDeque<u64>,
    entries: HashMap<u64, TrackQueryCountCacheEntry>,
}

static TRACK_QUERY_COUNT_CACHE: Lazy<Mutex<TrackQueryCountCache>> =
    Lazy::new(|| Mutex::new(TrackQueryCountCache::default()));

fn invalidate_track_query_count_cache() {
    if let Ok(mut cache) = TRACK_QUERY_COUNT_CACHE.lock() {
        cache.order.clear();
        cache.entries.clear();
    }
}

fn hash_track_query_count_key(from_where_sql: &str, bind_values: &[Value]) -> u64 {
    let mut hasher = DefaultHasher::new();
    from_where_sql.hash(&mut hasher);

    for value in bind_values {
        match value {
            Value::Null => {
                0_u8.hash(&mut hasher);
            }
            Value::Integer(item) => {
                1_u8.hash(&mut hasher);
                item.hash(&mut hasher);
            }
            Value::Real(item) => {
                2_u8.hash(&mut hasher);
                item.to_bits().hash(&mut hasher);
            }
            Value::Text(item) => {
                3_u8.hash(&mut hasher);
                item.hash(&mut hasher);
            }
            Value::Blob(item) => {
                4_u8.hash(&mut hasher);
                item.hash(&mut hasher);
            }
        }
    }

    hasher.finish()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySourceUpsertInput {
    pub id: String,
    pub path: String,
    pub display_name: Option<String>,
    pub category: Option<String>,
    pub is_visible: Option<bool>,
    pub is_scanned: Option<bool>,
    pub added_at_ms: Option<i64>,
    pub last_scanned_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySourceRecord {
    pub id: String,
    pub path: String,
    pub display_name: Option<String>,
    pub category: String,
    pub track_count: u64,
    pub is_visible: bool,
    pub is_scanned: bool,
    pub added_at_ms: i64,
    pub last_scanned_at_ms: Option<i64>,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryConnectorRecord {
    pub id: String,
    pub kind: String,
    pub driver: String,
    pub display_name: Option<String>,
    pub status: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryConnectorAccountUpsertInput {
    pub id: String,
    pub connector_id: String,
    pub account_uid: Option<String>,
    pub auth_state: String,
    pub token_ref: Option<String>,
    pub refresh_token_ref: Option<String>,
    pub expires_at_ms: Option<i64>,
    pub created_at_ms: Option<i64>,
    pub updated_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryConnectorAccountRecord {
    pub id: String,
    pub connector_id: String,
    pub account_uid: Option<String>,
    pub auth_state: String,
    pub token_ref: Option<String>,
    pub refresh_token_ref: Option<String>,
    pub expires_at_ms: Option<i64>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTrackUpsertInput {
    pub id: String,
    pub file_path: String,
    pub quick_fingerprint: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i64>,
    pub format: Option<String>,
    pub duration: Option<f64>,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u32>,
    pub file_size: Option<u64>,
    pub mtime_ms: Option<i64>,
    pub replay_gain_track_db: Option<f32>,
    pub replay_gain_album_db: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTrackSyncResult {
    pub upserted: usize,
    pub marked_missing: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTrackQueryInput {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub include_missing: Option<bool>,
    pub visible_only: Option<bool>,
    pub projection: Option<String>,
    pub search_query: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track_id: Option<String>,
    pub source_id: Option<String>,
    pub quick_fingerprint: Option<String>,
    pub file_path: Option<String>,
    pub base_query: Option<LibraryTrackBaseQueryInput>,
    pub filters: Option<Vec<LibraryTrackFilterInput>>,
    pub group_by: Option<Vec<LibraryTrackGroupByInput>>,
    pub sort: Option<Vec<LibraryTrackSortInput>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTrackBaseQueryInput {
    pub filter_operator: Option<String>,
    pub filter_groups: Option<Vec<LibraryTrackFilterGroupInput>>,
    pub filters: Option<Vec<LibraryTrackFilterInput>>,
    pub group_by: Option<Vec<LibraryTrackGroupByInput>>,
    pub sort: Option<Vec<LibraryTrackSortInput>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTrackFilterGroupInput {
    pub operator: Option<String>,
    pub filters: Option<Vec<LibraryTrackFilterInput>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTrackFilterInput {
    pub field: String,
    pub operator: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTrackSortInput {
    pub field: String,
    pub order: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTrackGroupByInput {
    pub field: String,
    pub order: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTrackRecord {
    pub id: String,
    pub source_id: String,
    pub file_path: String,
    pub quick_fingerprint: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i64>,
    pub format: Option<String>,
    pub duration_seconds: Option<f64>,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u32>,
    pub file_size: Option<u64>,
    pub mtime_ms: Option<i64>,
    pub replay_gain_track_db: Option<f32>,
    pub replay_gain_album_db: Option<f32>,
    pub play_count: u64,
    pub last_played_at_ms: Option<i64>,
    pub status: String,
    pub created_at_ms: Option<i64>,
    pub updated_at_ms: i64,
    pub last_seen_at_ms: Option<i64>,
    pub extra_fields: Option<JsonMap<String, JsonValue>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTrackQueryPageResult {
    pub items: Vec<LibraryTrackRecord>,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTrackFieldCatalogRecord {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub track_key: String,
    pub column_name: String,
    pub source_table: String,
    pub declared_type: String,
    pub nullable: bool,
    pub filterable: bool,
    pub sortable: bool,
    pub groupable: bool,
    pub facetable: bool,
    pub native_filter_field: Option<String>,
    pub native_sort_field: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFacetQueryInput {
    pub include_missing: Option<bool>,
    pub visible_only: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTextFacetQueryInput {
    pub field: String,
    pub include_missing: Option<bool>,
    pub visible_only: Option<bool>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFacetEntriesQueryInput {
    pub kind: String,
    pub field: Option<String>,
    pub include_missing: Option<bool>,
    pub visible_only: Option<bool>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryAlbumRecord {
    pub album: String,
    pub artist: String,
    pub cover_track_id: String,
    pub cover_track_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFacetCatalogRecord {
    pub id: String,
    pub field: String,
    pub label: String,
    pub kind: String,
    pub native_field: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFacetEntriesResult {
    pub kind: String,
    pub text_values: Option<Vec<String>>,
    pub albums: Option<Vec<LibraryAlbumRecord>>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySchemaSourceTableRecord {
    pub name: String,
    pub column_count: u32,
    pub schema_hash: String,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySchemaEnvelope {
    pub schema_version: i32,
    pub generated_at_ms: i64,
    pub schema_fingerprint: String,
    pub source_tables: Vec<LibrarySchemaSourceTableRecord>,
    pub track_fields: Vec<LibraryTrackFieldCatalogRecord>,
    pub facet_collections: Vec<LibraryFacetCatalogRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySchemaChangedEventPayload {
    pub reason: String,
    pub emitted_at_ms: i64,
    pub schema_version: i32,
    pub schema_fingerprint: String,
    pub source_tables: Vec<LibrarySchemaSourceTableRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ObservedLibrarySchemaState {
    schema_version: i32,
    schema_fingerprint: String,
    source_tables: Vec<LibrarySchemaSourceTableRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStatsRecord {
    pub total_tracks: u64,
    pub total_artists: u64,
    pub total_albums: u64,
    pub total_size: u64,
    pub total_duration: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySourceHealthQueryInput {
    pub source_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySourceHealthRecord {
    pub source_id: String,
    pub source_path: String,
    pub source_display_name: Option<String>,
    pub total_tracks: u64,
    pub available_tracks: u64,
    pub missing_tracks: u64,
    pub total_artists: u64,
    pub total_albums: u64,
    pub total_size: u64,
    pub source_updated_at_ms: i64,
    pub last_track_updated_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryUserEntryUpsertInput {
    pub id: String,
    pub owner_uid: String,
    pub track_id: Option<String>,
    pub quick_fingerprint: Option<String>,
    pub cloud_content_id: Option<String>,
    pub display_title: Option<String>,
    pub display_artist: Option<String>,
    pub rating: Option<i64>,
    pub tags_json: Option<String>,
    pub in_cloud: Option<bool>,
    pub is_missing: Option<bool>,
    pub created_at_ms: Option<i64>,
    pub updated_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryUserEntryQueryInput {
    pub owner_uid: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub in_cloud_only: Option<bool>,
    pub include_missing: Option<bool>,
    pub search_query: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryUserEntryRecord {
    pub id: String,
    pub owner_uid: String,
    pub track_id: Option<String>,
    pub quick_fingerprint: Option<String>,
    pub cloud_content_id: Option<String>,
    pub display_title: Option<String>,
    pub display_artist: Option<String>,
    pub rating: Option<i64>,
    pub tags_json: Option<String>,
    pub in_cloud: bool,
    pub is_missing: bool,
    pub play_count: u64,
    pub last_played_at_ms: Option<i64>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPlaylistUpsertInput {
    pub id: String,
    pub owner_uid: String,
    pub name: String,
    pub description: Option<String>,
    pub cover_url: Option<String>,
    pub kind: Option<String>,
    pub source_connector_id: Option<String>,
    pub source_playlist_id: Option<String>,
    pub smart_rule_json: Option<String>,
    pub is_readonly: Option<bool>,
    pub created_at_ms: Option<i64>,
    pub updated_at_ms: Option<i64>,
    pub last_opened_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPlaylistQueryInput {
    pub owner_uid: Option<String>,
    pub kind: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPlaylistRecord {
    pub id: String,
    pub owner_uid: String,
    pub name: String,
    pub description: Option<String>,
    pub cover_url: Option<String>,
    pub kind: String,
    pub source_connector_id: Option<String>,
    pub source_playlist_id: Option<String>,
    pub smart_rule_json: Option<String>,
    pub is_readonly: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub last_opened_at_ms: Option<i64>,
    pub track_count: u64,
    pub total_duration: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPlaylistItemUpsertInput {
    pub id: Option<String>,
    pub position: Option<i64>,
    pub local_track_id: Option<String>,
    pub entry_id: Option<String>,
    pub track_payload_json: Option<String>,
    pub snapshot_title: Option<String>,
    pub snapshot_artist: Option<String>,
    pub snapshot_album: Option<String>,
    pub snapshot_duration_seconds: Option<f64>,
    pub created_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPlaylistItemRecord {
    pub id: String,
    pub playlist_id: String,
    pub position: i64,
    pub local_track_id: Option<String>,
    pub entry_id: Option<String>,
    pub track_payload_json: Option<String>,
    pub snapshot_title: Option<String>,
    pub snapshot_artist: Option<String>,
    pub snapshot_album: Option<String>,
    pub snapshot_duration_seconds: Option<f64>,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPlaylistTrackPageQueryInput {
    pub playlist_id: String,
    pub search_query: Option<String>,
    pub sort_field: Option<String>,
    pub sort_direction: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPlaylistTrackPageResult {
    pub items: Vec<LibraryPlaylistItemRecord>,
    pub total: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFallbackTaskUpsertInput {
    pub id: Option<String>,
    pub owner_uid: String,
    pub entry_id: String,
    pub cloud_content_id: Option<String>,
    pub track_id: Option<String>,
    pub quick_fingerprint: Option<String>,
    pub reason: Option<String>,
    pub requested_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFallbackTaskQueryInput {
    pub owner_uid: Option<String>,
    pub status: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFallbackTaskRecord {
    pub id: String,
    pub owner_uid: String,
    pub entry_id: String,
    pub cloud_content_id: Option<String>,
    pub track_id: Option<String>,
    pub quick_fingerprint: Option<String>,
    pub reason: String,
    pub status: String,
    pub enqueue_count: u64,
    pub requested_at_ms: i64,
    pub last_requested_at_ms: i64,
    pub updated_at_ms: i64,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCloudHashJobUpsertInput {
    pub id: Option<String>,
    pub owner_uid: String,
    pub entry_id: String,
    pub track_id: Option<String>,
    pub quick_fingerprint: Option<String>,
    pub status: Option<String>,
    pub cloud_full_hash: Option<String>,
    pub last_error: Option<String>,
    pub requested_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCloudHashJobQueryInput {
    pub owner_uid: Option<String>,
    pub status: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCloudHashJobRecord {
    pub id: String,
    pub owner_uid: String,
    pub entry_id: String,
    pub track_id: Option<String>,
    pub quick_fingerprint: Option<String>,
    pub status: String,
    pub cloud_full_hash: Option<String>,
    pub last_error: Option<String>,
    pub attempt_count: u64,
    pub requested_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct LibrarySourceSyncStateRecord {
    pub source_id: String,
    pub connector_id: String,
    pub sync_cursor: Option<String>,
    pub full_scan_at_ms: Option<i64>,
    pub incremental_scan_at_ms: Option<i64>,
    pub last_success_at_ms: Option<i64>,
    pub last_error: Option<String>,
    pub backoff_until_ms: Option<i64>,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct LibrarySourceFingerprintStateRecord {
    pub source_id: String,
    pub tree_fingerprint: Option<String>,
    pub file_count: u64,
    pub total_size: u64,
    pub sampled_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct LibraryMetadataRefreshJobClaimRecord {
    pub id: String,
    pub entry_id: String,
    pub kind: String,
    pub priority: i64,
    pub attempt_count: u64,
    pub track_id: Option<String>,
    pub track_file_path: Option<String>,
}

#[derive(Debug, Clone)]
pub struct LibraryCoverRefUpsertInput {
    pub entry_id: String,
    pub provider_cover_id: Option<String>,
    pub cover_locator: String,
    pub etag: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub updated_at_ms: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct LibraryLyricRefUpsertInput {
    pub entry_id: String,
    pub provider_lyric_id: Option<String>,
    pub lyric_locator: String,
    pub format: Option<String>,
    pub lang: Option<String>,
    pub etag: Option<String>,
    pub updated_at_ms: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct LibraryLyricDocumentUpsertInput {
    pub id: Option<String>,
    pub selection_key: String,
    pub entry_id: Option<String>,
    pub track_id: Option<String>,
    pub quick_fingerprint: Option<String>,
    pub source_kind: String,
    pub source_locator: Option<String>,
    pub format: String,
    pub language: Option<String>,
    pub is_dynamic: bool,
    pub has_word_timing: bool,
    pub confidence: Option<f32>,
    pub payload_json: String,
    pub content_hash: Option<String>,
    pub updated_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryLyricDocumentRecord {
    pub id: String,
    pub selection_key: String,
    pub entry_id: Option<String>,
    pub track_id: Option<String>,
    pub quick_fingerprint: Option<String>,
    pub source_kind: String,
    pub source_locator: Option<String>,
    pub format: String,
    pub language: Option<String>,
    pub is_dynamic: bool,
    pub has_word_timing: bool,
    pub confidence: f32,
    pub payload_json: String,
    pub content_hash: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone)]
pub struct LibraryLyricCandidateUpsertInput {
    pub id: Option<String>,
    pub selection_key: String,
    pub entry_id: Option<String>,
    pub document_id: String,
    pub source_kind: String,
    pub rank_score: Option<f64>,
    pub source_priority: Option<i64>,
    pub resolver: Option<String>,
    pub status: Option<String>,
    pub updated_at_ms: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct LibraryLyricSelectionUpsertInput {
    pub selection_key: String,
    pub entry_id: Option<String>,
    pub selected_document_id: String,
    pub selected_candidate_id: Option<String>,
    pub selected_by: Option<String>,
    pub updated_at_ms: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct LibraryLyricFetchJobUpsertInput {
    pub id: Option<String>,
    pub selection_key: String,
    pub entry_id: Option<String>,
    pub track_id: Option<String>,
    pub priority: Option<i64>,
    pub status: Option<String>,
    pub attempt_count: Option<u64>,
    pub next_run_at_ms: Option<i64>,
    pub last_error: Option<String>,
    pub payload_json: Option<String>,
    pub updated_at_ms: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct LibrarySourceSyncFailureRecord {
    pub source_id: String,
    pub source_path: String,
    pub source_display_name: Option<String>,
    pub connector_id: String,
    pub last_error: Option<String>,
    pub backoff_until_ms: Option<i64>,
    pub last_success_at_ms: Option<i64>,
    pub incremental_scan_at_ms: Option<i64>,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone)]
pub struct LibrarySourceSyncStateUpsertInput {
    pub source_id: String,
    pub connector_id: String,
    pub sync_cursor: Option<String>,
    pub full_scan_at_ms: Option<i64>,
    pub incremental_scan_at_ms: Option<i64>,
    pub last_success_at_ms: Option<i64>,
    pub last_error: Option<String>,
    pub backoff_until_ms: Option<i64>,
    pub updated_at_ms: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct LibrarySourceFingerprintStateUpsertInput {
    pub source_id: String,
    pub tree_fingerprint: Option<String>,
    pub file_count: u64,
    pub total_size: u64,
    pub sampled_at_ms: i64,
    pub updated_at_ms: Option<i64>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

fn db_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Unable to resolve app data directory".to_string())?;
    let dir = app_data_dir.join("music-library");
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Failed to create music-library directory: {error}"))?;
    Ok(dir.join("music-library-v1.sqlite3"))
}

fn conn() -> Result<std::sync::MutexGuard<'static, Option<Connection>>, String> {
    DB_CONN
        .lock()
        .map_err(|_| "Music library DB state is locked".to_string())
}

fn observed_schema_state(
) -> Result<std::sync::MutexGuard<'static, Option<ObservedLibrarySchemaState>>, String> {
    OBSERVED_SCHEMA_STATE
        .lock()
        .map_err(|_| "Music library observed schema state is locked".to_string())
}

fn replace_observed_schema_state(
    next: ObservedLibrarySchemaState,
) -> Result<Option<ObservedLibrarySchemaState>, String> {
    let mut guard = observed_schema_state()?;
    Ok(guard.replace(next))
}

fn with_conn<T>(op: impl FnOnce(&mut Connection) -> Result<T, String>) -> Result<T, String> {
    let mut guard = conn()?;
    let Some(conn) = guard.as_mut() else {
        return Err("Music library DB is not initialized".to_string());
    };
    op(conn)
}

fn ensure_sangreal_v5_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS connectors (
          id TEXT PRIMARY KEY NOT NULL,
          kind TEXT NOT NULL,
          driver TEXT NOT NULL,
          display_name TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS connectors_kind_idx ON connectors(kind);
        CREATE INDEX IF NOT EXISTS connectors_status_idx ON connectors(status);

        CREATE TABLE IF NOT EXISTS connector_accounts (
          id TEXT PRIMARY KEY NOT NULL,
          connector_id TEXT NOT NULL,
          account_uid TEXT,
          auth_state TEXT NOT NULL,
          token_ref TEXT,
          refresh_token_ref TEXT,
          expires_at_ms INTEGER,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          FOREIGN KEY(connector_id) REFERENCES connectors(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS connector_accounts_connector_id_idx ON connector_accounts(connector_id);
        CREATE INDEX IF NOT EXISTS connector_accounts_auth_state_idx ON connector_accounts(auth_state);

        CREATE TABLE IF NOT EXISTS source_sync_state (
          source_id TEXT PRIMARY KEY NOT NULL,
          connector_id TEXT NOT NULL,
          sync_cursor TEXT,
          full_scan_at_ms INTEGER,
          incremental_scan_at_ms INTEGER,
          last_success_at_ms INTEGER,
          last_error TEXT,
          backoff_until_ms INTEGER,
          updated_at_ms INTEGER NOT NULL,
          FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE,
          FOREIGN KEY(connector_id) REFERENCES connectors(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS source_sync_state_connector_id_idx ON source_sync_state(connector_id);
        CREATE INDEX IF NOT EXISTS source_sync_state_backoff_until_ms_idx ON source_sync_state(backoff_until_ms);

        CREATE TABLE IF NOT EXISTS source_fingerprint_state (
          source_id TEXT PRIMARY KEY NOT NULL,
          tree_fingerprint TEXT,
          file_count INTEGER NOT NULL DEFAULT 0,
          total_size INTEGER NOT NULL DEFAULT 0,
          sampled_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS source_fingerprint_state_sampled_at_ms_idx ON source_fingerprint_state(sampled_at_ms);

        CREATE TABLE IF NOT EXISTS track_provider_refs (
          id TEXT PRIMARY KEY NOT NULL,
          entry_id TEXT NOT NULL,
          source_id TEXT,
          connector_id TEXT NOT NULL,
          provider_track_id TEXT,
          provider_album_id TEXT,
          source_locator TEXT,
          quality_tier TEXT,
          availability TEXT NOT NULL DEFAULT 'unknown',
          updated_at_ms INTEGER NOT NULL,
          FOREIGN KEY(entry_id) REFERENCES user_entries(id) ON DELETE CASCADE,
          FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE SET NULL,
          FOREIGN KEY(connector_id) REFERENCES connectors(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS track_provider_refs_entry_id_idx ON track_provider_refs(entry_id);
        CREATE INDEX IF NOT EXISTS track_provider_refs_connector_id_idx ON track_provider_refs(connector_id);
        CREATE INDEX IF NOT EXISTS track_provider_refs_provider_track_id_idx ON track_provider_refs(provider_track_id);
        CREATE INDEX IF NOT EXISTS track_provider_refs_source_locator_idx ON track_provider_refs(source_locator);

        CREATE TABLE IF NOT EXISTS cover_refs (
          id TEXT PRIMARY KEY NOT NULL,
          entry_id TEXT NOT NULL,
          provider_cover_id TEXT,
          cover_locator TEXT,
          etag TEXT,
          width INTEGER,
          height INTEGER,
          updated_at_ms INTEGER NOT NULL,
          FOREIGN KEY(entry_id) REFERENCES user_entries(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS cover_refs_entry_id_idx ON cover_refs(entry_id);

        CREATE TABLE IF NOT EXISTS lyric_refs (
          id TEXT PRIMARY KEY NOT NULL,
          entry_id TEXT NOT NULL,
          provider_lyric_id TEXT,
          lyric_locator TEXT,
          format TEXT,
          lang TEXT,
          etag TEXT,
          updated_at_ms INTEGER NOT NULL,
          FOREIGN KEY(entry_id) REFERENCES user_entries(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS lyric_refs_entry_id_idx ON lyric_refs(entry_id);
        CREATE INDEX IF NOT EXISTS lyric_refs_provider_lyric_id_idx ON lyric_refs(provider_lyric_id);

        CREATE TABLE IF NOT EXISTS metadata_refresh_jobs (
          id TEXT PRIMARY KEY NOT NULL,
          entry_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          priority INTEGER NOT NULL DEFAULT 100,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          next_run_at_ms INTEGER,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          FOREIGN KEY(entry_id) REFERENCES user_entries(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS metadata_refresh_jobs_status_idx ON metadata_refresh_jobs(status);
        CREATE INDEX IF NOT EXISTS metadata_refresh_jobs_next_run_at_ms_idx ON metadata_refresh_jobs(next_run_at_ms);
        CREATE INDEX IF NOT EXISTS metadata_refresh_jobs_priority_idx ON metadata_refresh_jobs(priority);
        "#,
    )
    .map_err(|error| format!("Failed to ensure music library schema v5 extensions: {error}"))
}

fn ensure_sangreal_v6_lyrics_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS lyric_documents (
          id TEXT PRIMARY KEY NOT NULL,
          selection_key TEXT NOT NULL,
          entry_id TEXT,
          track_id TEXT,
          quick_fingerprint TEXT,
          source_kind TEXT NOT NULL,
          source_locator TEXT,
          format TEXT NOT NULL DEFAULT 'plain',
          language TEXT,
          is_dynamic INTEGER NOT NULL DEFAULT 0,
          has_word_timing INTEGER NOT NULL DEFAULT 0,
          confidence REAL NOT NULL DEFAULT 0,
          payload_json TEXT NOT NULL,
          content_hash TEXT,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS lyric_documents_selection_key_idx
          ON lyric_documents(selection_key);
        CREATE INDEX IF NOT EXISTS lyric_documents_entry_id_idx
          ON lyric_documents(entry_id);
        CREATE INDEX IF NOT EXISTS lyric_documents_track_id_idx
          ON lyric_documents(track_id);
        CREATE INDEX IF NOT EXISTS lyric_documents_quick_fingerprint_idx
          ON lyric_documents(quick_fingerprint);
        CREATE INDEX IF NOT EXISTS lyric_documents_content_hash_idx
          ON lyric_documents(content_hash);

        CREATE TABLE IF NOT EXISTS lyric_candidates (
          id TEXT PRIMARY KEY NOT NULL,
          selection_key TEXT NOT NULL,
          entry_id TEXT,
          document_id TEXT NOT NULL,
          source_kind TEXT NOT NULL,
          rank_score REAL NOT NULL DEFAULT 0,
          source_priority INTEGER NOT NULL DEFAULT 1000,
          resolver TEXT,
          status TEXT NOT NULL DEFAULT 'ready',
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          FOREIGN KEY(document_id) REFERENCES lyric_documents(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS lyric_candidates_selection_key_idx
          ON lyric_candidates(selection_key);
        CREATE INDEX IF NOT EXISTS lyric_candidates_entry_id_idx
          ON lyric_candidates(entry_id);
        CREATE INDEX IF NOT EXISTS lyric_candidates_document_id_idx
          ON lyric_candidates(document_id);
        CREATE INDEX IF NOT EXISTS lyric_candidates_rank_score_idx
          ON lyric_candidates(rank_score DESC);
        CREATE INDEX IF NOT EXISTS lyric_candidates_source_priority_idx
          ON lyric_candidates(source_priority);

        CREATE TABLE IF NOT EXISTS lyric_selection (
          selection_key TEXT PRIMARY KEY NOT NULL,
          entry_id TEXT,
          selected_document_id TEXT NOT NULL,
          selected_candidate_id TEXT,
          selected_by TEXT NOT NULL DEFAULT 'system',
          selected_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          FOREIGN KEY(selected_document_id) REFERENCES lyric_documents(id) ON DELETE CASCADE,
          FOREIGN KEY(selected_candidate_id) REFERENCES lyric_candidates(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS lyric_selection_entry_id_idx
          ON lyric_selection(entry_id);
        CREATE INDEX IF NOT EXISTS lyric_selection_selected_document_id_idx
          ON lyric_selection(selected_document_id);

        CREATE TABLE IF NOT EXISTS lyric_fetch_jobs (
          id TEXT PRIMARY KEY NOT NULL,
          selection_key TEXT NOT NULL,
          entry_id TEXT,
          track_id TEXT,
          priority INTEGER NOT NULL DEFAULT 100,
          status TEXT NOT NULL DEFAULT 'queued',
          attempt_count INTEGER NOT NULL DEFAULT 0,
          next_run_at_ms INTEGER,
          last_error TEXT,
          payload_json TEXT,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS lyric_fetch_jobs_selection_key_idx
          ON lyric_fetch_jobs(selection_key);
        CREATE INDEX IF NOT EXISTS lyric_fetch_jobs_entry_id_idx
          ON lyric_fetch_jobs(entry_id);
        CREATE INDEX IF NOT EXISTS lyric_fetch_jobs_status_idx
          ON lyric_fetch_jobs(status);
        CREATE INDEX IF NOT EXISTS lyric_fetch_jobs_next_run_at_ms_idx
          ON lyric_fetch_jobs(next_run_at_ms);
        "#,
    )
    .map_err(|error| format!("Failed to ensure music library schema v6 lyric pipeline: {error}"))
}

fn ensure_sangreal_v7_playlist_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS playlists (
          id TEXT PRIMARY KEY NOT NULL,
          owner_uid TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          kind TEXT NOT NULL DEFAULT 'manual',
          source_connector_id TEXT,
          source_playlist_id TEXT,
          smart_rule_json TEXT,
          is_readonly INTEGER NOT NULL DEFAULT 0,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          last_opened_at_ms INTEGER
        );

        CREATE INDEX IF NOT EXISTS playlists_owner_uid_idx ON playlists(owner_uid);
        CREATE INDEX IF NOT EXISTS playlists_kind_idx ON playlists(kind);
        CREATE INDEX IF NOT EXISTS playlists_owner_kind_idx ON playlists(owner_uid, kind);
        CREATE INDEX IF NOT EXISTS playlists_owner_last_opened_idx
          ON playlists(owner_uid, last_opened_at_ms DESC);

        CREATE TABLE IF NOT EXISTS playlist_items (
          id TEXT PRIMARY KEY NOT NULL,
          playlist_id TEXT NOT NULL,
          position INTEGER NOT NULL,
          local_track_id TEXT,
          entry_id TEXT,
          track_payload_json TEXT,
          snapshot_title TEXT,
          snapshot_artist TEXT,
          snapshot_album TEXT,
          snapshot_duration_seconds REAL,
          created_at_ms INTEGER NOT NULL,
          FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
          FOREIGN KEY(local_track_id) REFERENCES local_tracks(id) ON DELETE SET NULL,
          FOREIGN KEY(entry_id) REFERENCES user_entries(id) ON DELETE SET NULL,
          CHECK(local_track_id IS NOT NULL OR entry_id IS NOT NULL OR track_payload_json IS NOT NULL),
          UNIQUE(playlist_id, position)
        );

        CREATE INDEX IF NOT EXISTS playlist_items_playlist_id_idx ON playlist_items(playlist_id);
        CREATE INDEX IF NOT EXISTS playlist_items_local_track_id_idx ON playlist_items(local_track_id);
        CREATE INDEX IF NOT EXISTS playlist_items_entry_id_idx ON playlist_items(entry_id);
        "#,
    )
    .map_err(|error| format!("Failed to ensure music library schema v7 playlist pipeline: {error}"))
}

fn ensure_sangreal_v8_playlist_cover_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        ALTER TABLE playlists ADD COLUMN cover_url TEXT;
        "#,
    )
    .or_else(|error| {
        let message = error.to_string();
        if message.contains("duplicate column name") {
            Ok(())
        } else {
            Err(error)
        }
    })
    .map_err(|error| format!("Failed to ensure music library schema v8 playlist cover: {error}"))
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|error| format!("Failed to enable foreign keys: {error}"))?;
    conn.execute_batch("PRAGMA journal_mode = WAL;")
        .map_err(|error| format!("Failed to set journal mode: {error}"))?;
    conn.execute_batch("PRAGMA synchronous = NORMAL;")
        .map_err(|error| format!("Failed to set synchronous pragma: {error}"))?;

    let mut version: i32 = conn
        .query_row("PRAGMA user_version;", [], |row| row.get(0))
        .map_err(|error| format!("Failed to read schema version: {error}"))?;

    if version == 0 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS sources (
              id TEXT PRIMARY KEY NOT NULL,
              path TEXT NOT NULL UNIQUE,
              display_name TEXT,
              category TEXT NOT NULL DEFAULT 'music',
              is_visible INTEGER NOT NULL DEFAULT 1,
              is_scanned INTEGER NOT NULL DEFAULT 1,
              added_at_ms INTEGER NOT NULL,
              last_scanned_at_ms INTEGER,
              updated_at_ms INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS sources_is_visible_idx ON sources(is_visible);
            CREATE INDEX IF NOT EXISTS sources_is_scanned_idx ON sources(is_scanned);

            CREATE TABLE IF NOT EXISTS local_tracks (
              id TEXT PRIMARY KEY NOT NULL,
              source_id TEXT NOT NULL,
              file_path TEXT NOT NULL,
              quick_fingerprint TEXT,
              title TEXT,
              artist TEXT,
              album TEXT,
              genre TEXT,
              year INTEGER,
              format TEXT,
              duration_seconds REAL,
              sample_rate INTEGER,
              bit_depth INTEGER,
              file_size INTEGER,
              mtime_ms INTEGER,
              replay_gain_track_db REAL,
              replay_gain_album_db REAL,
              play_count INTEGER NOT NULL DEFAULT 0,
              last_played_at_ms INTEGER,
              status TEXT NOT NULL DEFAULT 'available',
              created_at_ms INTEGER NOT NULL,
              updated_at_ms INTEGER NOT NULL,
              last_seen_at_ms INTEGER NOT NULL,
              FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE,
              UNIQUE(source_id, file_path)
            );

            CREATE INDEX IF NOT EXISTS local_tracks_source_id_idx ON local_tracks(source_id);
            CREATE INDEX IF NOT EXISTS local_tracks_quick_fingerprint_idx ON local_tracks(quick_fingerprint);
            CREATE INDEX IF NOT EXISTS local_tracks_status_idx ON local_tracks(status);

            CREATE TABLE IF NOT EXISTS user_entries (
              id TEXT PRIMARY KEY NOT NULL,
              owner_uid TEXT NOT NULL,
              track_id TEXT,
              quick_fingerprint TEXT,
              cloud_content_id TEXT,
              display_title TEXT,
              display_artist TEXT,
              rating INTEGER,
              tags_json TEXT,
              in_cloud INTEGER NOT NULL DEFAULT 0,
              is_missing INTEGER NOT NULL DEFAULT 0,
              play_count INTEGER NOT NULL DEFAULT 0,
              last_played_at_ms INTEGER,
              created_at_ms INTEGER NOT NULL,
              updated_at_ms INTEGER NOT NULL,
              FOREIGN KEY(track_id) REFERENCES local_tracks(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS user_entries_owner_uid_idx ON user_entries(owner_uid);
            CREATE INDEX IF NOT EXISTS user_entries_track_id_idx ON user_entries(track_id);
            CREATE INDEX IF NOT EXISTS user_entries_quick_fingerprint_idx ON user_entries(quick_fingerprint);
            CREATE INDEX IF NOT EXISTS user_entries_cloud_content_id_idx ON user_entries(cloud_content_id);
            CREATE INDEX IF NOT EXISTS user_entries_last_played_at_ms_idx ON user_entries(last_played_at_ms);

            CREATE TABLE IF NOT EXISTS fallback_tasks (
              id TEXT PRIMARY KEY NOT NULL,
              owner_uid TEXT NOT NULL,
              entry_id TEXT NOT NULL,
              cloud_content_id TEXT,
              track_id TEXT,
              quick_fingerprint TEXT,
              reason TEXT NOT NULL DEFAULT 'local-miss',
              status TEXT NOT NULL DEFAULT 'queued',
              enqueue_count INTEGER NOT NULL DEFAULT 1,
              requested_at_ms INTEGER NOT NULL,
              last_requested_at_ms INTEGER NOT NULL,
              updated_at_ms INTEGER NOT NULL,
              last_error TEXT
            );

            CREATE INDEX IF NOT EXISTS fallback_tasks_owner_uid_idx ON fallback_tasks(owner_uid);
            CREATE INDEX IF NOT EXISTS fallback_tasks_status_idx ON fallback_tasks(status);
            CREATE INDEX IF NOT EXISTS fallback_tasks_last_requested_at_ms_idx ON fallback_tasks(last_requested_at_ms);
            CREATE INDEX IF NOT EXISTS fallback_tasks_entry_id_idx ON fallback_tasks(entry_id);

            CREATE TABLE IF NOT EXISTS cloud_hash_jobs (
              id TEXT PRIMARY KEY NOT NULL,
              owner_uid TEXT NOT NULL,
              entry_id TEXT NOT NULL,
              track_id TEXT,
              quick_fingerprint TEXT,
              status TEXT NOT NULL DEFAULT 'pending',
              cloud_full_hash TEXT,
              last_error TEXT,
              attempt_count INTEGER NOT NULL DEFAULT 1,
              requested_at_ms INTEGER NOT NULL,
              updated_at_ms INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS cloud_hash_jobs_owner_uid_idx ON cloud_hash_jobs(owner_uid);
            CREATE INDEX IF NOT EXISTS cloud_hash_jobs_status_idx ON cloud_hash_jobs(status);
            CREATE INDEX IF NOT EXISTS cloud_hash_jobs_requested_at_ms_idx ON cloud_hash_jobs(requested_at_ms);
            CREATE INDEX IF NOT EXISTS cloud_hash_jobs_entry_id_idx ON cloud_hash_jobs(entry_id);

            PRAGMA user_version = 4;
            "#,
        )
        .map_err(|error| format!("Failed to initialize music library schema: {error}"))?;
        version = 4;
    }

    if version == 1 {
        conn.execute_batch(
            r#"
            ALTER TABLE local_tracks ADD COLUMN genre TEXT;
            PRAGMA user_version = 2;
            "#,
        )
        .map_err(|error| format!("Failed to migrate music library schema to v2: {error}"))?;
        version = 2;
    }

    if version == 2 {
        conn.execute_batch(
            r#"
            ALTER TABLE local_tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE local_tracks ADD COLUMN last_played_at_ms INTEGER;
            PRAGMA user_version = 3;
            "#,
        )
        .map_err(|error| format!("Failed to migrate music library schema to v3: {error}"))?;
        version = 3;
    }

    if version == 3 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS user_entries (
              id TEXT PRIMARY KEY NOT NULL,
              owner_uid TEXT NOT NULL,
              track_id TEXT,
              quick_fingerprint TEXT,
              cloud_content_id TEXT,
              display_title TEXT,
              display_artist TEXT,
              rating INTEGER,
              tags_json TEXT,
              in_cloud INTEGER NOT NULL DEFAULT 0,
              is_missing INTEGER NOT NULL DEFAULT 0,
              play_count INTEGER NOT NULL DEFAULT 0,
              last_played_at_ms INTEGER,
              created_at_ms INTEGER NOT NULL,
              updated_at_ms INTEGER NOT NULL,
              FOREIGN KEY(track_id) REFERENCES local_tracks(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS user_entries_owner_uid_idx ON user_entries(owner_uid);
            CREATE INDEX IF NOT EXISTS user_entries_track_id_idx ON user_entries(track_id);
            CREATE INDEX IF NOT EXISTS user_entries_quick_fingerprint_idx ON user_entries(quick_fingerprint);
            CREATE INDEX IF NOT EXISTS user_entries_cloud_content_id_idx ON user_entries(cloud_content_id);
            CREATE INDEX IF NOT EXISTS user_entries_last_played_at_ms_idx ON user_entries(last_played_at_ms);

            CREATE TABLE IF NOT EXISTS fallback_tasks (
              id TEXT PRIMARY KEY NOT NULL,
              owner_uid TEXT NOT NULL,
              entry_id TEXT NOT NULL,
              cloud_content_id TEXT,
              track_id TEXT,
              quick_fingerprint TEXT,
              reason TEXT NOT NULL DEFAULT 'local-miss',
              status TEXT NOT NULL DEFAULT 'queued',
              enqueue_count INTEGER NOT NULL DEFAULT 1,
              requested_at_ms INTEGER NOT NULL,
              last_requested_at_ms INTEGER NOT NULL,
              updated_at_ms INTEGER NOT NULL,
              last_error TEXT
            );

            CREATE INDEX IF NOT EXISTS fallback_tasks_owner_uid_idx ON fallback_tasks(owner_uid);
            CREATE INDEX IF NOT EXISTS fallback_tasks_status_idx ON fallback_tasks(status);
            CREATE INDEX IF NOT EXISTS fallback_tasks_last_requested_at_ms_idx ON fallback_tasks(last_requested_at_ms);
            CREATE INDEX IF NOT EXISTS fallback_tasks_entry_id_idx ON fallback_tasks(entry_id);

            CREATE TABLE IF NOT EXISTS cloud_hash_jobs (
              id TEXT PRIMARY KEY NOT NULL,
              owner_uid TEXT NOT NULL,
              entry_id TEXT NOT NULL,
              track_id TEXT,
              quick_fingerprint TEXT,
              status TEXT NOT NULL DEFAULT 'pending',
              cloud_full_hash TEXT,
              last_error TEXT,
              attempt_count INTEGER NOT NULL DEFAULT 1,
              requested_at_ms INTEGER NOT NULL,
              updated_at_ms INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS cloud_hash_jobs_owner_uid_idx ON cloud_hash_jobs(owner_uid);
            CREATE INDEX IF NOT EXISTS cloud_hash_jobs_status_idx ON cloud_hash_jobs(status);
            CREATE INDEX IF NOT EXISTS cloud_hash_jobs_requested_at_ms_idx ON cloud_hash_jobs(requested_at_ms);
            CREATE INDEX IF NOT EXISTS cloud_hash_jobs_entry_id_idx ON cloud_hash_jobs(entry_id);

            PRAGMA user_version = 4;
            "#,
        )
        .map_err(|error| format!("Failed to migrate music library schema to v4: {error}"))?;
        version = 4;
    }

    if version == 4 {
        ensure_sangreal_v5_schema(conn)?;
        conn.execute_batch("PRAGMA user_version = 5;")
            .map_err(|error| format!("Failed to migrate music library schema to v5: {error}"))?;
        version = 5;
    }

    if version == 5 {
        ensure_sangreal_v6_lyrics_schema(conn)?;
        conn.execute_batch("PRAGMA user_version = 6;")
            .map_err(|error| format!("Failed to migrate music library schema to v6: {error}"))?;
        version = 6;
    }

    if version == 6 {
        ensure_sangreal_v7_playlist_schema(conn)?;
        conn.execute_batch("PRAGMA user_version = 7;")
            .map_err(|error| format!("Failed to migrate music library schema to v7: {error}"))?;
        version = 7;
    }

    if version == 7 {
        ensure_sangreal_v8_playlist_cover_schema(conn)?;
        conn.execute_batch("PRAGMA user_version = 8;")
            .map_err(|error| format!("Failed to migrate music library schema to v8: {error}"))?;
        version = 8;
    }

    if version == 8 {
        let local_track_columns = list_table_columns(conn, "local_tracks")?;

        if !local_track_columns.iter().any(|column| column == "year") {
            conn.execute_batch("ALTER TABLE local_tracks ADD COLUMN year INTEGER;")
                .map_err(|error| {
                    format!("Failed to migrate music library schema to v9 (year): {error}")
                })?;
        }

        if !local_track_columns.iter().any(|column| column == "format") {
            conn.execute_batch("ALTER TABLE local_tracks ADD COLUMN format TEXT;")
                .map_err(|error| {
                    format!("Failed to migrate music library schema to v9 (format): {error}")
                })?;
        }

        conn.execute_batch("PRAGMA user_version = 9;")
            .map_err(|error| format!("Failed to migrate music library schema to v9: {error}"))?;
        version = 9;
    }

    if version != DB_VERSION {
        return Err(format!(
            "Unsupported music library DB schema version: {version} (expected {DB_VERSION})"
        ));
    }

    conn.execute_batch(
        r#"
        CREATE INDEX IF NOT EXISTS local_tracks_artist_idx ON local_tracks(artist);
        CREATE INDEX IF NOT EXISTS local_tracks_album_idx ON local_tracks(album);
        CREATE INDEX IF NOT EXISTS local_tracks_year_idx ON local_tracks(year);
        CREATE INDEX IF NOT EXISTS local_tracks_format_idx ON local_tracks(format);
        CREATE INDEX IF NOT EXISTS local_tracks_last_played_at_ms_idx ON local_tracks(last_played_at_ms);
        "#,
    )
    .map_err(|error| format!("Failed to ensure music library query indexes: {error}"))?;

    Ok(())
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    {
        let guard = conn()?;
        if guard.is_some() {
            return Ok(());
        }
    }

    invalidate_track_query_count_cache();

    let path = db_file_path(app)?;
    let _ = DB_PATH.set(path.clone());
    let connection = Connection::open(&path)
        .map_err(|error| format!("Failed to open music library DB: {error}"))?;
    connection.set_prepared_statement_cache_capacity(64);
    migrate(&connection)?;
    let initial_schema_state = read_observed_schema_state(&connection)?;

    let mut guard = conn()?;
    *guard = Some(connection);
    drop(guard);
    let _ = replace_observed_schema_state(initial_schema_state)?;
    Ok(())
}

fn ensure_initialized(app: &AppHandle) -> Result<(), String> {
    let ready = {
        let guard = conn()?;
        guard.is_some()
    };
    if ready {
        Ok(())
    } else {
        init(app)
    }
}

fn normalize_bool_flag(value: Option<bool>, fallback: bool) -> i64 {
    if value.unwrap_or(fallback) {
        1
    } else {
        0
    }
}

fn normalize_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn normalize_quick_fingerprint(value: Option<&str>) -> Option<String> {
    let raw = value?.trim().to_lowercase();
    if raw.is_empty() {
        return None;
    }

    let normalized = raw.strip_prefix("qf2:").unwrap_or(raw.as_str());
    if normalized.len() < 16 || normalized.len() > 128 {
        return None;
    }
    if !normalized.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return None;
    }

    Some(format!("qf2:{normalized}"))
}

fn normalize_owner_uid(value: Option<&str>) -> Option<String> {
    normalize_text(value)
}

fn normalize_rating(value: Option<i64>) -> Option<i64> {
    value.map(|score| score.clamp(0, 100))
}

fn normalize_playlist_kind(value: Option<&str>) -> String {
    match value
        .map(|item| item.trim().to_ascii_lowercase())
        .filter(|item| !item.is_empty())
        .as_deref()
    {
        Some("manual") => "manual".to_string(),
        Some("smart") => "smart".to_string(),
        Some("platform") => "platform".to_string(),
        _ => "manual".to_string(),
    }
}

fn normalize_fallback_reason(value: Option<&str>) -> String {
    match value
        .map(|item| item.trim().to_ascii_lowercase())
        .filter(|item| !item.is_empty())
        .as_deref()
    {
        Some("manual-retry") => "manual-retry".to_string(),
        Some("sync-restore") => "sync-restore".to_string(),
        Some("local-miss") => "local-miss".to_string(),
        _ => "local-miss".to_string(),
    }
}

fn normalize_fallback_status(value: Option<&str>) -> String {
    match value
        .map(|item| item.trim().to_ascii_lowercase())
        .filter(|item| !item.is_empty())
        .as_deref()
    {
        Some("queued") => "queued".to_string(),
        Some("dispatching") => "dispatching".to_string(),
        Some("resolved") => "resolved".to_string(),
        Some("failed") => "failed".to_string(),
        Some("cancelled") => "cancelled".to_string(),
        _ => "queued".to_string(),
    }
}

fn normalize_cloud_hash_job_status(value: Option<&str>) -> String {
    match value
        .map(|item| item.trim().to_ascii_lowercase())
        .filter(|item| !item.is_empty())
        .as_deref()
    {
        Some("pending") => "pending".to_string(),
        Some("running") => "running".to_string(),
        Some("completed") => "completed".to_string(),
        Some("failed") => "failed".to_string(),
        _ => "pending".to_string(),
    }
}

fn normalize_lyric_source_kind(value: Option<&str>) -> String {
    match value
        .map(|item| item.trim().to_ascii_lowercase())
        .filter(|item| !item.is_empty())
        .as_deref()
    {
        Some("embedded") => "embedded".to_string(),
        Some("sidecar") => "sidecar".to_string(),
        Some("cache") => "cache".to_string(),
        Some("web") => "web".to_string(),
        _ => "cache".to_string(),
    }
}

fn normalize_lyric_candidate_status(value: Option<&str>) -> String {
    match value
        .map(|item| item.trim().to_ascii_lowercase())
        .filter(|item| !item.is_empty())
        .as_deref()
    {
        Some("ready") => "ready".to_string(),
        Some("rejected") => "rejected".to_string(),
        Some("stale") => "stale".to_string(),
        _ => "ready".to_string(),
    }
}

fn normalize_lyric_fetch_job_status(value: Option<&str>) -> String {
    match value
        .map(|item| item.trim().to_ascii_lowercase())
        .filter(|item| !item.is_empty())
        .as_deref()
    {
        Some("queued") => "queued".to_string(),
        Some("running") => "running".to_string(),
        Some("retrying") => "retrying".to_string(),
        Some("failed") => "failed".to_string(),
        Some("completed") => "completed".to_string(),
        _ => "queued".to_string(),
    }
}

fn normalize_limit(value: Option<u32>) -> i64 {
    value
        .map(|item| item.clamp(1, 2000) as i64)
        .unwrap_or(i64::MAX)
}

fn normalize_offset(value: Option<u32>) -> i64 {
    value.map(|item| item as i64).unwrap_or(0)
}

fn build_fallback_task_id(
    owner_uid: &str,
    entry_id: &str,
    track_id: Option<&str>,
    quick_fingerprint: Option<&str>,
    cloud_content_id: Option<&str>,
) -> String {
    format!(
        "{}::{}::{}::{}::{}",
        owner_uid,
        entry_id,
        track_id.unwrap_or_default(),
        quick_fingerprint.unwrap_or_default(),
        cloud_content_id.unwrap_or_default()
    )
}

fn build_cloud_hash_job_id(owner_uid: &str, entry_id: &str, track_id: Option<&str>) -> String {
    format!(
        "{}::{}::{}",
        owner_uid,
        entry_id,
        track_id.unwrap_or_default()
    )
}

fn user_entry_record_by_id(
    conn: &Connection,
    entry_id: &str,
) -> Result<LibraryUserEntryRecord, String> {
    conn.query_row(
        r#"
        SELECT
          id,
          owner_uid,
          track_id,
          quick_fingerprint,
          cloud_content_id,
          display_title,
          display_artist,
          rating,
          tags_json,
          in_cloud,
          is_missing,
          play_count,
          last_played_at_ms,
          created_at_ms,
          updated_at_ms
        FROM user_entries
        WHERE id = ?1
        "#,
        params![entry_id],
        |row| {
            Ok(LibraryUserEntryRecord {
                id: row.get(0)?,
                owner_uid: row.get(1)?,
                track_id: row.get(2)?,
                quick_fingerprint: row.get(3)?,
                cloud_content_id: row.get(4)?,
                display_title: row.get(5)?,
                display_artist: row.get(6)?,
                rating: row.get(7)?,
                tags_json: row.get(8)?,
                in_cloud: row.get::<_, i64>(9)? != 0,
                is_missing: row.get::<_, i64>(10)? != 0,
                play_count: row.get::<_, i64>(11)?.max(0) as u64,
                last_played_at_ms: row.get(12)?,
                created_at_ms: row.get(13)?,
                updated_at_ms: row.get(14)?,
            })
        },
    )
    .map_err(|error| format!("Failed to load user entry record: {error}"))
}

fn playlist_record_by_id(
    conn: &Connection,
    playlist_id: &str,
) -> Result<LibraryPlaylistRecord, String> {
    conn.query_row(
        r#"
        SELECT
          id,
          owner_uid,
          name,
          description,
          cover_url,
          kind,
          source_connector_id,
          source_playlist_id,
          smart_rule_json,
          is_readonly,
          created_at_ms,
          updated_at_ms,
          last_opened_at_ms,
          (
            SELECT COUNT(*)
            FROM playlist_items pi
            WHERE pi.playlist_id = playlists.id
          ) AS track_count,
          (
            SELECT COALESCE(SUM(COALESCE(pi.snapshot_duration_seconds, 0.0)), 0.0)
            FROM playlist_items pi
            WHERE pi.playlist_id = playlists.id
          ) AS total_duration
        FROM playlists
        WHERE id = ?1
        "#,
        params![playlist_id],
        |row| {
            Ok(LibraryPlaylistRecord {
                id: row.get(0)?,
                owner_uid: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                cover_url: row.get(4)?,
                kind: row.get(5)?,
                source_connector_id: row.get(6)?,
                source_playlist_id: row.get(7)?,
                smart_rule_json: row.get(8)?,
                is_readonly: row.get::<_, i64>(9)? != 0,
                created_at_ms: row.get(10)?,
                updated_at_ms: row.get(11)?,
                last_opened_at_ms: row.get(12)?,
                track_count: row.get::<_, i64>(13)?.max(0) as u64,
                total_duration: row.get::<_, f64>(14)?.max(0.0),
            })
        },
    )
    .map_err(|error| format!("Failed to load playlist record: {error}"))
}

fn fallback_task_record_by_id(
    conn: &Connection,
    task_id: &str,
) -> Result<LibraryFallbackTaskRecord, String> {
    conn.query_row(
        r#"
        SELECT
          id,
          owner_uid,
          entry_id,
          cloud_content_id,
          track_id,
          quick_fingerprint,
          reason,
          status,
          enqueue_count,
          requested_at_ms,
          last_requested_at_ms,
          updated_at_ms,
          last_error
        FROM fallback_tasks
        WHERE id = ?1
        "#,
        params![task_id],
        |row| {
            Ok(LibraryFallbackTaskRecord {
                id: row.get(0)?,
                owner_uid: row.get(1)?,
                entry_id: row.get(2)?,
                cloud_content_id: row.get(3)?,
                track_id: row.get(4)?,
                quick_fingerprint: row.get(5)?,
                reason: row.get(6)?,
                status: row.get(7)?,
                enqueue_count: row.get::<_, i64>(8)?.max(0) as u64,
                requested_at_ms: row.get(9)?,
                last_requested_at_ms: row.get(10)?,
                updated_at_ms: row.get(11)?,
                last_error: row.get(12)?,
            })
        },
    )
    .map_err(|error| format!("Failed to load fallback task record: {error}"))
}

fn cloud_hash_job_record_by_id(
    conn: &Connection,
    job_id: &str,
) -> Result<LibraryCloudHashJobRecord, String> {
    conn.query_row(
        r#"
        SELECT
          id,
          owner_uid,
          entry_id,
          track_id,
          quick_fingerprint,
          status,
          cloud_full_hash,
          last_error,
          attempt_count,
          requested_at_ms,
          updated_at_ms
        FROM cloud_hash_jobs
        WHERE id = ?1
        "#,
        params![job_id],
        |row| {
            Ok(LibraryCloudHashJobRecord {
                id: row.get(0)?,
                owner_uid: row.get(1)?,
                entry_id: row.get(2)?,
                track_id: row.get(3)?,
                quick_fingerprint: row.get(4)?,
                status: row.get(5)?,
                cloud_full_hash: row.get(6)?,
                last_error: row.get(7)?,
                attempt_count: row.get::<_, i64>(8)?.max(0) as u64,
                requested_at_ms: row.get(9)?,
                updated_at_ms: row.get(10)?,
            })
        },
    )
    .map_err(|error| format!("Failed to load cloud hash job record: {error}"))
}

fn connector_account_record_by_id(
    conn: &Connection,
    account_id: &str,
) -> Result<LibraryConnectorAccountRecord, String> {
    conn.query_row(
        r#"
        SELECT
          id,
          connector_id,
          account_uid,
          auth_state,
          token_ref,
          refresh_token_ref,
          expires_at_ms,
          created_at_ms,
          updated_at_ms
        FROM connector_accounts
        WHERE id = ?1
        LIMIT 1
        "#,
        params![account_id],
        |row| {
            Ok(LibraryConnectorAccountRecord {
                id: row.get(0)?,
                connector_id: row.get(1)?,
                account_uid: row.get(2)?,
                auth_state: row.get(3)?,
                token_ref: row.get(4)?,
                refresh_token_ref: row.get(5)?,
                expires_at_ms: row.get(6)?,
                created_at_ms: row.get(7)?,
                updated_at_ms: row.get(8)?,
            })
        },
    )
    .map_err(|error| format!("Failed to load connector account record: {error}"))
}

fn source_record_by_id(conn: &Connection, source_id: &str) -> Result<LibrarySourceRecord, String> {
    conn.query_row(
        r#"
        SELECT
          id,
          path,
          display_name,
          category,
          (
            SELECT COUNT(*)
            FROM local_tracks t
            WHERE t.source_id = sources.id
              AND t.status = 'available'
          ) AS track_count,
          is_visible,
          is_scanned,
          added_at_ms,
          last_scanned_at_ms,
          updated_at_ms
        FROM sources
        WHERE id = ?1
        "#,
        params![source_id],
        |row| {
            Ok(LibrarySourceRecord {
                id: row.get(0)?,
                path: row.get(1)?,
                display_name: row.get(2)?,
                category: row.get(3)?,
                track_count: row.get::<_, i64>(4)?.max(0) as u64,
                is_visible: row.get::<_, i64>(5)? != 0,
                is_scanned: row.get::<_, i64>(6)? != 0,
                added_at_ms: row.get(7)?,
                last_scanned_at_ms: row.get(8)?,
                updated_at_ms: row.get(9)?,
            })
        },
    )
    .map_err(|error| format!("Failed to load source record: {error}"))
}

pub fn upsert_source(
    app: &AppHandle,
    input: LibrarySourceUpsertInput,
) -> Result<LibrarySourceRecord, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let source_id = input.id.trim();
        if source_id.is_empty() {
            return Err("Source id is required".to_string());
        }

        let source_path = input.path.trim();
        if source_path.is_empty() {
            return Err("Source path is required".to_string());
        }

        let now = now_ms();
        let category =
            normalize_text(input.category.as_deref()).unwrap_or_else(|| "music".to_string());
        let display_name = normalize_text(input.display_name.as_deref());

        conn.execute(
            r#"
            INSERT INTO sources(
              id,
              path,
              display_name,
              category,
              is_visible,
              is_scanned,
              added_at_ms,
              last_scanned_at_ms,
              updated_at_ms
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(id) DO UPDATE SET
              path = excluded.path,
              display_name = excluded.display_name,
              category = excluded.category,
              is_visible = excluded.is_visible,
              is_scanned = excluded.is_scanned,
              last_scanned_at_ms = COALESCE(excluded.last_scanned_at_ms, sources.last_scanned_at_ms),
              updated_at_ms = excluded.updated_at_ms
            "#,
            params![
                source_id,
                source_path,
                display_name,
                category,
                normalize_bool_flag(input.is_visible, true),
                normalize_bool_flag(input.is_scanned, true),
                input.added_at_ms.unwrap_or(now),
                input.last_scanned_at_ms,
                now,
            ],
        )
        .map_err(|error| format!("Failed to upsert source: {error}"))?;

        invalidate_track_query_count_cache();

        source_record_by_id(conn, source_id)
    })
}

pub fn list_sources(app: &AppHandle) -> Result<Vec<LibrarySourceRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  id,
                  path,
                  display_name,
                  category,
                  (
                    SELECT COUNT(*)
                    FROM local_tracks t
                    WHERE t.source_id = sources.id
                      AND t.status = 'available'
                  ) AS track_count,
                  is_visible,
                  is_scanned,
                  added_at_ms,
                  last_scanned_at_ms,
                  updated_at_ms
                FROM sources
                ORDER BY added_at_ms ASC
                "#,
            )
            .map_err(|error| format!("Failed to prepare list sources query: {error}"))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(LibrarySourceRecord {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    display_name: row.get(2)?,
                    category: row.get(3)?,
                    track_count: row.get::<_, i64>(4)?.max(0) as u64,
                    is_visible: row.get::<_, i64>(5)? != 0,
                    is_scanned: row.get::<_, i64>(6)? != 0,
                    added_at_ms: row.get(7)?,
                    last_scanned_at_ms: row.get(8)?,
                    updated_at_ms: row.get(9)?,
                })
            })
            .map_err(|error| format!("Failed to query source rows: {error}"))?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|error| format!("Failed to parse source row: {error}"))?);
        }
        Ok(items)
    })
}

pub fn remove_source(app: &AppHandle, source_id: &str) -> Result<(), String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        conn.execute("DELETE FROM sources WHERE id = ?1", params![source_id])
            .map_err(|error| format!("Failed to remove source: {error}"))?;
        invalidate_track_query_count_cache();
        Ok(())
    })
}

pub fn list_connectors(app: &AppHandle) -> Result<Vec<LibraryConnectorRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  id,
                  kind,
                  driver,
                  display_name,
                  status,
                  created_at_ms,
                  updated_at_ms
                FROM connectors
                ORDER BY
                  CASE kind
                    WHEN 'local' THEN 0
                    WHEN 'nas' THEN 1
                    WHEN 'platform' THEN 2
                    ELSE 3
                  END,
                  updated_at_ms DESC,
                  id ASC
                "#,
            )
            .map_err(|error| format!("Failed to prepare connector list query: {error}"))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(LibraryConnectorRecord {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    driver: row.get(2)?,
                    display_name: row.get(3)?,
                    status: row.get(4)?,
                    created_at_ms: row.get(5)?,
                    updated_at_ms: row.get(6)?,
                })
            })
            .map_err(|error| format!("Failed to query connectors: {error}"))?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|error| format!("Failed to parse connector row: {error}"))?);
        }

        Ok(items)
    })
}

pub fn ensure_connector(
    app: &AppHandle,
    connector_id: &str,
    kind: &str,
    driver: &str,
    display_name: Option<&str>,
    status: Option<&str>,
) -> Result<(), String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let id = connector_id.trim();
        if id.is_empty() {
            return Err("Connector id is required".to_string());
        }

        let normalized_kind = normalize_text(Some(kind))
            .unwrap_or_else(|| "local".to_string())
            .to_ascii_lowercase();
        let normalized_driver =
            normalize_text(Some(driver)).unwrap_or_else(|| "filesystem".to_string());
        let normalized_status = normalize_text(status)
            .unwrap_or_else(|| "active".to_string())
            .to_ascii_lowercase();
        let normalized_display_name = normalize_text(display_name);
        let now = now_ms();

        conn.execute(
            r#"
            INSERT INTO connectors(
              id,
              kind,
              driver,
              display_name,
              status,
              created_at_ms,
              updated_at_ms
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(id) DO UPDATE SET
              kind = excluded.kind,
              driver = excluded.driver,
              display_name = excluded.display_name,
              status = excluded.status,
              updated_at_ms = excluded.updated_at_ms
            "#,
            params![
                id,
                normalized_kind,
                normalized_driver,
                normalized_display_name,
                normalized_status,
                now,
                now,
            ],
        )
        .map_err(|error| format!("Failed to ensure connector: {error}"))?;

        Ok(())
    })
}

pub fn upsert_connector_account(
    app: &AppHandle,
    input: LibraryConnectorAccountUpsertInput,
) -> Result<LibraryConnectorAccountRecord, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let account_id = input.id.trim();
        if account_id.is_empty() {
            return Err("Connector account id is required".to_string());
        }

        let connector_id = input.connector_id.trim();
        if connector_id.is_empty() {
            return Err("Connector account connectorId is required".to_string());
        }

        let auth_state = normalize_text(Some(input.auth_state.as_str()))
            .unwrap_or_else(|| "unauthorized".to_string())
            .to_ascii_lowercase();
        let account_uid = normalize_text(input.account_uid.as_deref());
        let token_ref = normalize_text(input.token_ref.as_deref());
        let refresh_token_ref = normalize_text(input.refresh_token_ref.as_deref());

        let now = now_ms();
        let created_at_ms = input.created_at_ms.unwrap_or(now);
        let updated_at_ms = input.updated_at_ms.unwrap_or(now);

        conn.execute(
            r#"
            INSERT INTO connector_accounts(
              id,
              connector_id,
              account_uid,
              auth_state,
              token_ref,
              refresh_token_ref,
              expires_at_ms,
              created_at_ms,
              updated_at_ms
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(id) DO UPDATE SET
              connector_id = excluded.connector_id,
              account_uid = excluded.account_uid,
              auth_state = excluded.auth_state,
              token_ref = excluded.token_ref,
              refresh_token_ref = excluded.refresh_token_ref,
              expires_at_ms = excluded.expires_at_ms,
              created_at_ms = connector_accounts.created_at_ms,
              updated_at_ms = excluded.updated_at_ms
            "#,
            params![
                account_id,
                connector_id,
                account_uid,
                auth_state,
                token_ref,
                refresh_token_ref,
                input.expires_at_ms,
                created_at_ms,
                updated_at_ms,
            ],
        )
        .map_err(|error| format!("Failed to upsert connector account: {error}"))?;

        connector_account_record_by_id(conn, account_id)
    })
}

pub fn list_connector_accounts(
    app: &AppHandle,
    connector_id: Option<&str>,
) -> Result<Vec<LibraryConnectorAccountRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_connector_id = normalize_text(connector_id);
        let mut items = Vec::new();

        if let Some(connector_id) = normalized_connector_id {
            let mut stmt = conn
                .prepare(
                    r#"
                    SELECT
                      id,
                      connector_id,
                      account_uid,
                      auth_state,
                      token_ref,
                      refresh_token_ref,
                      expires_at_ms,
                      created_at_ms,
                      updated_at_ms
                    FROM connector_accounts
                    WHERE connector_id = ?1
                    ORDER BY updated_at_ms DESC, created_at_ms DESC, id ASC
                    "#,
                )
                .map_err(|error| {
                    format!("Failed to prepare connector account list query (filtered): {error}")
                })?;

            let rows = stmt
                .query_map(params![connector_id], |row| {
                    Ok(LibraryConnectorAccountRecord {
                        id: row.get(0)?,
                        connector_id: row.get(1)?,
                        account_uid: row.get(2)?,
                        auth_state: row.get(3)?,
                        token_ref: row.get(4)?,
                        refresh_token_ref: row.get(5)?,
                        expires_at_ms: row.get(6)?,
                        created_at_ms: row.get(7)?,
                        updated_at_ms: row.get(8)?,
                    })
                })
                .map_err(|error| format!("Failed to query connector account list rows: {error}"))?;

            for row in rows {
                items.push(row.map_err(|error| {
                    format!("Failed to parse connector account list row: {error}")
                })?);
            }

            return Ok(items);
        }

        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  id,
                  connector_id,
                  account_uid,
                  auth_state,
                  token_ref,
                  refresh_token_ref,
                  expires_at_ms,
                  created_at_ms,
                  updated_at_ms
                FROM connector_accounts
                ORDER BY updated_at_ms DESC, created_at_ms DESC, id ASC
                "#,
            )
            .map_err(|error| format!("Failed to prepare connector account list query: {error}"))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(LibraryConnectorAccountRecord {
                    id: row.get(0)?,
                    connector_id: row.get(1)?,
                    account_uid: row.get(2)?,
                    auth_state: row.get(3)?,
                    token_ref: row.get(4)?,
                    refresh_token_ref: row.get(5)?,
                    expires_at_ms: row.get(6)?,
                    created_at_ms: row.get(7)?,
                    updated_at_ms: row.get(8)?,
                })
            })
            .map_err(|error| format!("Failed to query connector account list rows: {error}"))?;

        for row in rows {
            items.push(
                row.map_err(|error| {
                    format!("Failed to parse connector account list row: {error}")
                })?,
            );
        }

        Ok(items)
    })
}

pub fn get_latest_connector_account_by_connector_id(
    app: &AppHandle,
    connector_id: &str,
) -> Result<Option<LibraryConnectorAccountRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let connector_id = connector_id.trim();
        if connector_id.is_empty() {
            return Ok(None);
        }

        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  id,
                  connector_id,
                  account_uid,
                  auth_state,
                  token_ref,
                  refresh_token_ref,
                  expires_at_ms,
                  created_at_ms,
                  updated_at_ms
                FROM connector_accounts
                WHERE connector_id = ?1
                ORDER BY updated_at_ms DESC, created_at_ms DESC, id ASC
                LIMIT 1
                "#,
            )
            .map_err(|error| {
                format!("Failed to prepare latest connector account query: {error}")
            })?;

        let mut rows = stmt
            .query(params![connector_id])
            .map_err(|error| format!("Failed to query latest connector account: {error}"))?;

        let Some(row) = rows
            .next()
            .map_err(|error| format!("Failed to parse latest connector account row: {error}"))?
        else {
            return Ok(None);
        };

        Ok(Some(LibraryConnectorAccountRecord {
            id: row.get(0).map_err(|error| {
                format!("Failed to read latest connector account id column: {error}")
            })?,
            connector_id: row.get(1).map_err(|error| {
                format!("Failed to read latest connector account connector_id column: {error}")
            })?,
            account_uid: row.get(2).map_err(|error| {
                format!("Failed to read latest connector account account_uid column: {error}")
            })?,
            auth_state: row.get(3).map_err(|error| {
                format!("Failed to read latest connector account auth_state column: {error}")
            })?,
            token_ref: row.get(4).map_err(|error| {
                format!("Failed to read latest connector account token_ref column: {error}")
            })?,
            refresh_token_ref: row.get(5).map_err(|error| {
                format!("Failed to read latest connector account refresh_token_ref column: {error}")
            })?,
            expires_at_ms: row.get(6).map_err(|error| {
                format!("Failed to read latest connector account expires_at_ms column: {error}")
            })?,
            created_at_ms: row.get(7).map_err(|error| {
                format!("Failed to read latest connector account created_at_ms column: {error}")
            })?,
            updated_at_ms: row.get(8).map_err(|error| {
                format!("Failed to read latest connector account updated_at_ms column: {error}")
            })?,
        }))
    })
}

pub fn get_source_sync_state(
    app: &AppHandle,
    source_id: &str,
) -> Result<Option<LibrarySourceSyncStateRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  source_id,
                  connector_id,
                  sync_cursor,
                  full_scan_at_ms,
                  incremental_scan_at_ms,
                  last_success_at_ms,
                  last_error,
                  backoff_until_ms,
                  updated_at_ms
                FROM source_sync_state
                WHERE source_id = ?1
                LIMIT 1
                "#,
            )
            .map_err(|error| format!("Failed to prepare source sync state query: {error}"))?;

        let mut rows = stmt
            .query(params![source_id])
            .map_err(|error| format!("Failed to query source sync state: {error}"))?;

        let Some(row) = rows
            .next()
            .map_err(|error| format!("Failed to parse source sync state row: {error}"))?
        else {
            return Ok(None);
        };

        Ok(Some(LibrarySourceSyncStateRecord {
            source_id: row.get(0).map_err(|error| {
                format!("Failed to read source sync state source_id column: {error}")
            })?,
            connector_id: row.get(1).map_err(|error| {
                format!("Failed to read source sync state connector_id column: {error}")
            })?,
            sync_cursor: row.get(2).map_err(|error| {
                format!("Failed to read source sync state sync_cursor: {error}")
            })?,
            full_scan_at_ms: row.get(3).map_err(|error| {
                format!("Failed to read source sync state full_scan_at_ms column: {error}")
            })?,
            incremental_scan_at_ms: row.get(4).map_err(|error| {
                format!("Failed to read source sync state incremental_scan_at_ms column: {error}")
            })?,
            last_success_at_ms: row.get(5).map_err(|error| {
                format!("Failed to read source sync state last_success_at_ms column: {error}")
            })?,
            last_error: row.get(6).map_err(|error| {
                format!("Failed to read source sync state last_error column: {error}")
            })?,
            backoff_until_ms: row.get(7).map_err(|error| {
                format!("Failed to read source sync state backoff_until_ms column: {error}")
            })?,
            updated_at_ms: row.get(8).map_err(|error| {
                format!("Failed to read source sync state updated_at_ms column: {error}")
            })?,
        }))
    })
}

pub fn upsert_source_sync_state(
    app: &AppHandle,
    input: LibrarySourceSyncStateUpsertInput,
) -> Result<(), String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let source_id = input.source_id.trim();
        if source_id.is_empty() {
            return Err("Source sync state source_id is required".to_string());
        }

        let connector_id = input.connector_id.trim();
        if connector_id.is_empty() {
            return Err("Source sync state connector_id is required".to_string());
        }

        let now = input.updated_at_ms.unwrap_or_else(now_ms);
        let sync_cursor = normalize_text(input.sync_cursor.as_deref());
        let last_error = normalize_text(input.last_error.as_deref());

        conn.execute(
            r#"
            INSERT INTO source_sync_state(
              source_id,
              connector_id,
              sync_cursor,
              full_scan_at_ms,
              incremental_scan_at_ms,
              last_success_at_ms,
              last_error,
              backoff_until_ms,
              updated_at_ms
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(source_id) DO UPDATE SET
              connector_id = excluded.connector_id,
              sync_cursor = excluded.sync_cursor,
              full_scan_at_ms = COALESCE(excluded.full_scan_at_ms, source_sync_state.full_scan_at_ms),
              incremental_scan_at_ms = excluded.incremental_scan_at_ms,
              last_success_at_ms = excluded.last_success_at_ms,
              last_error = excluded.last_error,
              backoff_until_ms = excluded.backoff_until_ms,
              updated_at_ms = excluded.updated_at_ms
            "#,
            params![
                source_id,
                connector_id,
                sync_cursor,
                input.full_scan_at_ms,
                input.incremental_scan_at_ms,
                input.last_success_at_ms,
                last_error,
                input.backoff_until_ms,
                now,
            ],
        )
        .map_err(|error| format!("Failed to upsert source sync state: {error}"))?;

        Ok(())
    })
}

pub fn list_source_sync_failures(
    app: &AppHandle,
    limit: Option<u32>,
) -> Result<Vec<LibrarySourceSyncFailureRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_limit = limit
            .map(|value| value.clamp(1, 1000) as i64)
            .unwrap_or(200);

        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  sss.source_id,
                  COALESCE(src.path, ''),
                  src.display_name,
                  sss.connector_id,
                  sss.last_error,
                  sss.backoff_until_ms,
                  sss.last_success_at_ms,
                  sss.incremental_scan_at_ms,
                  sss.updated_at_ms
                FROM source_sync_state sss
                LEFT JOIN sources src ON src.id = sss.source_id
                WHERE sss.last_error IS NOT NULL OR sss.backoff_until_ms IS NOT NULL
                ORDER BY
                  CASE WHEN sss.backoff_until_ms IS NULL THEN 0 ELSE 1 END DESC,
                  sss.backoff_until_ms DESC,
                  sss.updated_at_ms DESC
                LIMIT ?1
                "#,
            )
            .map_err(|error| format!("Failed to prepare source sync failures query: {error}"))?;

        let rows = stmt
            .query_map(params![normalized_limit], |row| {
                let source_id: String = row.get(0)?;
                let source_path_raw: String = row.get(1)?;
                let source_path = if source_path_raw.trim().is_empty() {
                    source_id.clone()
                } else {
                    source_path_raw
                };

                Ok(LibrarySourceSyncFailureRecord {
                    source_id,
                    source_path,
                    source_display_name: row.get(2)?,
                    connector_id: row.get(3)?,
                    last_error: row.get(4)?,
                    backoff_until_ms: row.get(5)?,
                    last_success_at_ms: row.get(6)?,
                    incremental_scan_at_ms: row.get(7)?,
                    updated_at_ms: row.get(8)?,
                })
            })
            .map_err(|error| format!("Failed to query source sync failures: {error}"))?;

        let mut items = Vec::new();
        for row in rows {
            items.push(
                row.map_err(|error| format!("Failed to parse source sync failure row: {error}"))?,
            );
        }
        Ok(items)
    })
}

pub fn clear_source_sync_failures(
    app: &AppHandle,
    source_ids: Option<Vec<String>>,
) -> Result<u64, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let now = now_ms();

        let Some(source_ids) = source_ids else {
            conn.execute(
                r#"
                UPDATE source_sync_state
                SET
                  last_error = NULL,
                  backoff_until_ms = NULL,
                  updated_at_ms = ?1
                WHERE last_error IS NOT NULL OR backoff_until_ms IS NOT NULL
                "#,
                params![now],
            )
            .map_err(|error| format!("Failed to clear source sync failures: {error}"))?;
            return Ok(conn.changes());
        };

        let mut normalized_source_ids: Vec<String> = Vec::new();
        for source_id in source_ids {
            let normalized = source_id.trim();
            if normalized.is_empty() {
                continue;
            }
            if normalized_source_ids.iter().any(|item| item == normalized) {
                continue;
            }
            normalized_source_ids.push(normalized.to_string());
        }

        if normalized_source_ids.is_empty() {
            return Ok(0);
        }

        let tx = conn.transaction().map_err(|error| {
            format!("Failed to start clear source sync failures transaction: {error}")
        })?;
        let mut stmt = tx
            .prepare(
                r#"
                UPDATE source_sync_state
                SET
                  last_error = NULL,
                  backoff_until_ms = NULL,
                  updated_at_ms = ?2
                WHERE source_id = ?1
                  AND (last_error IS NOT NULL OR backoff_until_ms IS NOT NULL)
                "#,
            )
            .map_err(|error| {
                format!("Failed to prepare clear source sync failures statement: {error}")
            })?;

        let mut affected: u64 = 0;
        for source_id in normalized_source_ids {
            let changed = stmt
                .execute(params![source_id, now])
                .map_err(|error| format!("Failed to clear source sync failure row: {error}"))?;
            affected = affected.saturating_add(changed as u64);
        }

        drop(stmt);
        tx.commit().map_err(|error| {
            format!("Failed to commit clear source sync failures transaction: {error}")
        })?;

        Ok(affected)
    })
}

pub fn get_source_fingerprint_state(
    app: &AppHandle,
    source_id: &str,
) -> Result<Option<LibrarySourceFingerprintStateRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  source_id,
                  tree_fingerprint,
                  file_count,
                  total_size,
                  sampled_at_ms,
                  updated_at_ms
                FROM source_fingerprint_state
                WHERE source_id = ?1
                LIMIT 1
                "#,
            )
            .map_err(|error| {
                format!("Failed to prepare source fingerprint state query: {error}")
            })?;

        let mut rows = stmt
            .query(params![source_id])
            .map_err(|error| format!("Failed to query source fingerprint state: {error}"))?;

        let Some(row) = rows
            .next()
            .map_err(|error| format!("Failed to parse source fingerprint state row: {error}"))?
        else {
            return Ok(None);
        };

        Ok(Some(LibrarySourceFingerprintStateRecord {
            source_id: row.get(0).map_err(|error| {
                format!("Failed to read source fingerprint state source_id column: {error}")
            })?,
            tree_fingerprint: row.get(1).map_err(|error| {
                format!("Failed to read source fingerprint state tree_fingerprint: {error}")
            })?,
            file_count: row
                .get::<_, i64>(2)
                .map_err(|error| {
                    format!("Failed to read source fingerprint state file_count column: {error}")
                })?
                .max(0) as u64,
            total_size: row
                .get::<_, i64>(3)
                .map_err(|error| {
                    format!("Failed to read source fingerprint state total_size column: {error}")
                })?
                .max(0) as u64,
            sampled_at_ms: row.get(4).map_err(|error| {
                format!("Failed to read source fingerprint state sampled_at_ms column: {error}")
            })?,
            updated_at_ms: row.get(5).map_err(|error| {
                format!("Failed to read source fingerprint state updated_at_ms column: {error}")
            })?,
        }))
    })
}

pub fn upsert_source_fingerprint_state(
    app: &AppHandle,
    input: LibrarySourceFingerprintStateUpsertInput,
) -> Result<(), String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let source_id = input.source_id.trim();
        if source_id.is_empty() {
            return Err("Source fingerprint state source_id is required".to_string());
        }

        let now = input.updated_at_ms.unwrap_or_else(now_ms);
        let tree_fingerprint = normalize_text(input.tree_fingerprint.as_deref());
        let file_count = (input.file_count.min(i64::MAX as u64)) as i64;
        let total_size = (input.total_size.min(i64::MAX as u64)) as i64;

        conn.execute(
            r#"
            INSERT INTO source_fingerprint_state(
              source_id,
              tree_fingerprint,
              file_count,
              total_size,
              sampled_at_ms,
              updated_at_ms
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(source_id) DO UPDATE SET
              tree_fingerprint = excluded.tree_fingerprint,
              file_count = excluded.file_count,
              total_size = excluded.total_size,
              sampled_at_ms = excluded.sampled_at_ms,
              updated_at_ms = excluded.updated_at_ms
            "#,
            params![
                source_id,
                tree_fingerprint,
                file_count,
                total_size,
                input.sampled_at_ms,
                now,
            ],
        )
        .map_err(|error| format!("Failed to upsert source fingerprint state: {error}"))?;

        Ok(())
    })
}

pub fn enqueue_metadata_refresh_jobs_for_source(
    app: &AppHandle,
    source_id: &str,
    limit: Option<u32>,
) -> Result<u64, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let source_key = source_id.trim();
        if source_key.is_empty() {
            return Err("Metadata refresh source_id is required".to_string());
        }

        let normalized_limit = limit
            .map(|value| value.clamp(1, 5000) as i64)
            .unwrap_or(500);
        let now = now_ms();

        conn.execute(
            r#"
            INSERT OR IGNORE INTO metadata_refresh_jobs(
              id,
              entry_id,
              kind,
              status,
              priority,
              attempt_count,
              next_run_at_ms,
              created_at_ms,
              updated_at_ms
            )
            SELECT
              'meta::' || ue.id || '::both',
              ue.id,
              'both',
              'queued',
              100,
              0,
              ?1,
              ?1,
              ?1
            FROM user_entries ue
            JOIN local_tracks lt ON lt.id = ue.track_id
            LEFT JOIN cover_refs cr ON cr.entry_id = ue.id
            LEFT JOIN lyric_refs lr ON lr.entry_id = ue.id
            WHERE lt.source_id = ?2
              AND (cr.id IS NULL OR lr.id IS NULL)
            LIMIT ?3
            "#,
            params![now, source_key, normalized_limit],
        )
        .map_err(|error| format!("Failed to enqueue metadata refresh jobs: {error}"))?;

        Ok(conn.changes())
    })
}

pub fn claim_metadata_refresh_jobs(
    app: &AppHandle,
    limit: Option<u32>,
) -> Result<Vec<LibraryMetadataRefreshJobClaimRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_limit = limit.map(|value| value.clamp(1, 500) as i64).unwrap_or(50);
        let now = now_ms();
        let tx = conn
            .transaction()
            .map_err(|error| format!("Failed to start metadata job claim transaction: {error}"))?;

        let mut query_stmt = tx
            .prepare(
                r#"
                SELECT
                  mrj.id,
                  mrj.entry_id,
                  mrj.kind,
                  mrj.priority,
                  mrj.attempt_count,
                  ue.track_id,
                  lt.file_path
                FROM metadata_refresh_jobs mrj
                LEFT JOIN user_entries ue ON ue.id = mrj.entry_id
                LEFT JOIN local_tracks lt ON lt.id = ue.track_id
                WHERE mrj.status IN ('queued', 'retrying')
                  AND (mrj.next_run_at_ms IS NULL OR mrj.next_run_at_ms <= ?1)
                ORDER BY mrj.priority ASC, COALESCE(mrj.next_run_at_ms, mrj.created_at_ms) ASC, mrj.id ASC
                LIMIT ?2
                "#,
            )
            .map_err(|error| format!("Failed to prepare metadata job claim query: {error}"))?;

        let rows = query_stmt
            .query_map(params![now, normalized_limit], |row| {
                Ok(LibraryMetadataRefreshJobClaimRecord {
                    id: row.get(0)?,
                    entry_id: row.get(1)?,
                    kind: row.get(2)?,
                    priority: row.get(3)?,
                    attempt_count: row.get::<_, i64>(4)?.max(0) as u64,
                    track_id: row.get(5)?,
                    track_file_path: row.get(6)?,
                })
            })
            .map_err(|error| format!("Failed to query metadata jobs: {error}"))?;

        let mut selected: Vec<LibraryMetadataRefreshJobClaimRecord> = Vec::new();
        for row in rows {
            selected
                .push(row.map_err(|error| format!("Failed to parse metadata job row: {error}"))?);
        }

        drop(query_stmt);

        if selected.is_empty() {
            tx.commit()
                .map_err(|error| format!("Failed to commit metadata claim transaction: {error}"))?;
            return Ok(selected);
        }

        let mut update_stmt = tx
            .prepare(
                r#"
                UPDATE metadata_refresh_jobs
                SET
                  status = 'running',
                  attempt_count = attempt_count + 1,
                  updated_at_ms = ?2,
                  last_error = NULL
                WHERE id = ?1
                  AND status IN ('queued', 'retrying')
                "#,
            )
            .map_err(|error| format!("Failed to prepare metadata job claim update: {error}"))?;

        let mut claimed: Vec<LibraryMetadataRefreshJobClaimRecord> = Vec::new();
        for mut job in selected {
            let affected = update_stmt
                .execute(params![job.id.as_str(), now])
                .map_err(|error| format!("Failed to mark metadata job as running: {error}"))?;
            if affected == 0 {
                continue;
            }
            job.attempt_count = job.attempt_count.saturating_add(1);
            claimed.push(job);
        }

        drop(update_stmt);
        tx.commit()
            .map_err(|error| format!("Failed to commit metadata job claim transaction: {error}"))?;

        Ok(claimed)
    })
}

pub fn complete_metadata_refresh_job(app: &AppHandle, job_id: &str) -> Result<bool, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let id = job_id.trim();
        if id.is_empty() {
            return Ok(false);
        }

        let now = now_ms();
        let affected = conn
            .execute(
                r#"
                UPDATE metadata_refresh_jobs
                SET
                  status = 'completed',
                  last_error = NULL,
                  next_run_at_ms = NULL,
                  updated_at_ms = ?2
                WHERE id = ?1
                "#,
                params![id, now],
            )
            .map_err(|error| format!("Failed to complete metadata refresh job: {error}"))?;
        Ok(affected > 0)
    })
}

pub fn reschedule_metadata_refresh_job(
    app: &AppHandle,
    job_id: &str,
    last_error: &str,
    next_run_at_ms: Option<i64>,
    terminal_failed: bool,
) -> Result<bool, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let id = job_id.trim();
        if id.is_empty() {
            return Ok(false);
        }

        let status = if terminal_failed {
            "failed"
        } else {
            "retrying"
        };
        let normalized_error = normalize_text(Some(last_error));
        let now = now_ms();
        let affected = conn
            .execute(
                r#"
                UPDATE metadata_refresh_jobs
                SET
                  status = ?2,
                  last_error = ?3,
                  next_run_at_ms = ?4,
                  updated_at_ms = ?5
                WHERE id = ?1
                "#,
                params![id, status, normalized_error, next_run_at_ms, now],
            )
            .map_err(|error| format!("Failed to reschedule metadata refresh job: {error}"))?;
        Ok(affected > 0)
    })
}

pub fn upsert_cover_ref(app: &AppHandle, input: LibraryCoverRefUpsertInput) -> Result<(), String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let entry_id = input.entry_id.trim();
        if entry_id.is_empty() {
            return Err("Cover ref entry_id is required".to_string());
        }

        let locator = input.cover_locator.trim();
        if locator.is_empty() {
            return Err("Cover ref cover_locator is required".to_string());
        }

        let now = input.updated_at_ms.unwrap_or_else(now_ms);
        let ref_id = format!("cover::{entry_id}");
        conn.execute(
            "DELETE FROM cover_refs WHERE entry_id = ?1",
            params![entry_id],
        )
        .map_err(|error| format!("Failed to cleanup cover refs before upsert: {error}"))?;

        conn.execute(
            r#"
            INSERT INTO cover_refs(
              id,
              entry_id,
              provider_cover_id,
              cover_locator,
              etag,
              width,
              height,
              updated_at_ms
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                ref_id,
                entry_id,
                normalize_text(input.provider_cover_id.as_deref()),
                locator,
                normalize_text(input.etag.as_deref()),
                input.width.map(|value| value as i64),
                input.height.map(|value| value as i64),
                now,
            ],
        )
        .map_err(|error| format!("Failed to upsert cover ref: {error}"))?;

        Ok(())
    })
}

pub fn upsert_lyric_ref(app: &AppHandle, input: LibraryLyricRefUpsertInput) -> Result<(), String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let entry_id = input.entry_id.trim();
        if entry_id.is_empty() {
            return Err("Lyric ref entry_id is required".to_string());
        }

        let locator = input.lyric_locator.trim();
        if locator.is_empty() {
            return Err("Lyric ref lyric_locator is required".to_string());
        }

        let now = input.updated_at_ms.unwrap_or_else(now_ms);
        let ref_id = format!("lyric::{entry_id}");
        conn.execute(
            "DELETE FROM lyric_refs WHERE entry_id = ?1",
            params![entry_id],
        )
        .map_err(|error| format!("Failed to cleanup lyric refs before upsert: {error}"))?;

        conn.execute(
            r#"
            INSERT INTO lyric_refs(
              id,
              entry_id,
              provider_lyric_id,
              lyric_locator,
              format,
              lang,
              etag,
              updated_at_ms
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                ref_id,
                entry_id,
                normalize_text(input.provider_lyric_id.as_deref()),
                locator,
                normalize_text(input.format.as_deref()),
                normalize_text(input.lang.as_deref()),
                normalize_text(input.etag.as_deref()),
                now,
            ],
        )
        .map_err(|error| format!("Failed to upsert lyric ref: {error}"))?;

        Ok(())
    })
}

pub fn upsert_lyric_document(
    app: &AppHandle,
    input: LibraryLyricDocumentUpsertInput,
) -> Result<LibraryLyricDocumentRecord, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let selection_key = input.selection_key.trim();
        if selection_key.is_empty() {
            return Err("Lyric document selection_key is required".to_string());
        }

        let payload_json = input.payload_json.trim();
        if payload_json.is_empty() {
            return Err("Lyric document payload_json is required".to_string());
        }

        let source_kind = normalize_lyric_source_kind(Some(input.source_kind.as_str()));
        let normalized_format = normalize_text(Some(input.format.as_str()))
            .map(|value| value.to_ascii_lowercase())
            .filter(|value| matches!(value.as_str(), "lrc" | "yrc" | "plain"))
            .unwrap_or_else(|| "plain".to_string());
        let confidence = input.confidence.unwrap_or(0.0).clamp(0.0, 1.0);
        let now = input.updated_at_ms.unwrap_or_else(now_ms).max(0);

        let document_id = normalize_text(input.id.as_deref()).unwrap_or_else(|| {
            format!(
                "lydoc::{selection_key}::{:x}",
                md5::compute(
                    format!(
                        "{}|{}|{}",
                        selection_key,
                        input.source_locator.as_deref().unwrap_or_default(),
                        payload_json
                    )
                    .as_bytes()
                )
            )
        });

        conn.execute(
            r#"
            INSERT INTO lyric_documents(
              id,
              selection_key,
              entry_id,
              track_id,
              quick_fingerprint,
              source_kind,
              source_locator,
              format,
              language,
              is_dynamic,
              has_word_timing,
              confidence,
              payload_json,
              content_hash,
              created_at_ms,
              updated_at_ms
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)
            ON CONFLICT(id) DO UPDATE SET
              selection_key = excluded.selection_key,
              entry_id = excluded.entry_id,
              track_id = excluded.track_id,
              quick_fingerprint = excluded.quick_fingerprint,
              source_kind = excluded.source_kind,
              source_locator = excluded.source_locator,
              format = excluded.format,
              language = excluded.language,
              is_dynamic = excluded.is_dynamic,
              has_word_timing = excluded.has_word_timing,
              confidence = excluded.confidence,
              payload_json = excluded.payload_json,
              content_hash = excluded.content_hash,
              updated_at_ms = excluded.updated_at_ms
            "#,
            params![
                document_id,
                selection_key,
                normalize_text(input.entry_id.as_deref()),
                normalize_text(input.track_id.as_deref()),
                normalize_quick_fingerprint(input.quick_fingerprint.as_deref()),
                source_kind,
                normalize_text(input.source_locator.as_deref()),
                normalized_format,
                normalize_text(input.language.as_deref()),
                if input.is_dynamic { 1_i64 } else { 0_i64 },
                if input.has_word_timing { 1_i64 } else { 0_i64 },
                confidence,
                payload_json,
                normalize_text(input.content_hash.as_deref()),
                now,
            ],
        )
        .map_err(|error| format!("Failed to upsert lyric document: {error}"))?;

        conn.query_row(
            r#"
            SELECT
              id,
              selection_key,
              entry_id,
              track_id,
              quick_fingerprint,
              source_kind,
              source_locator,
              format,
              language,
              is_dynamic,
              has_word_timing,
              confidence,
              payload_json,
              content_hash,
              created_at_ms,
              updated_at_ms
            FROM lyric_documents
            WHERE id = ?1
            "#,
            params![document_id],
            |row| {
                Ok(LibraryLyricDocumentRecord {
                    id: row.get(0)?,
                    selection_key: row.get(1)?,
                    entry_id: row.get(2)?,
                    track_id: row.get(3)?,
                    quick_fingerprint: row.get(4)?,
                    source_kind: row.get(5)?,
                    source_locator: row.get(6)?,
                    format: row.get(7)?,
                    language: row.get(8)?,
                    is_dynamic: row.get::<_, i64>(9)? != 0,
                    has_word_timing: row.get::<_, i64>(10)? != 0,
                    confidence: row.get::<_, f64>(11)?.clamp(0.0, 1.0) as f32,
                    payload_json: row.get(12)?,
                    content_hash: row.get(13)?,
                    created_at_ms: row.get(14)?,
                    updated_at_ms: row.get(15)?,
                })
            },
        )
        .map_err(|error| format!("Failed to read lyric document record: {error}"))
    })
}

pub fn upsert_lyric_candidate(
    app: &AppHandle,
    input: LibraryLyricCandidateUpsertInput,
) -> Result<(), String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let selection_key = input.selection_key.trim();
        if selection_key.is_empty() {
            return Err("Lyric candidate selection_key is required".to_string());
        }

        let document_id = input.document_id.trim();
        if document_id.is_empty() {
            return Err("Lyric candidate document_id is required".to_string());
        }

        let source_kind = normalize_lyric_source_kind(Some(input.source_kind.as_str()));
        let source_priority = input
            .source_priority
            .unwrap_or_else(|| match source_kind.as_str() {
                "embedded" => 10,
                "sidecar" => 20,
                "cache" => 30,
                "web" => 40,
                _ => 100,
            });
        let rank_score = input.rank_score.unwrap_or(0.0).clamp(0.0, 1.0);
        let status = normalize_lyric_candidate_status(input.status.as_deref());
        let now = input.updated_at_ms.unwrap_or_else(now_ms).max(0);

        let candidate_id = normalize_text(input.id.as_deref())
            .unwrap_or_else(|| format!("lycand::{selection_key}::{document_id}"));

        conn.execute(
            r#"
            INSERT INTO lyric_candidates(
              id,
              selection_key,
              entry_id,
              document_id,
              source_kind,
              rank_score,
              source_priority,
              resolver,
              status,
              created_at_ms,
              updated_at_ms
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
            ON CONFLICT(id) DO UPDATE SET
              selection_key = excluded.selection_key,
              entry_id = excluded.entry_id,
              document_id = excluded.document_id,
              source_kind = excluded.source_kind,
              rank_score = excluded.rank_score,
              source_priority = excluded.source_priority,
              resolver = excluded.resolver,
              status = excluded.status,
              updated_at_ms = excluded.updated_at_ms
            "#,
            params![
                candidate_id,
                selection_key,
                normalize_text(input.entry_id.as_deref()),
                document_id,
                source_kind,
                rank_score,
                source_priority,
                normalize_text(input.resolver.as_deref()),
                status,
                now,
            ],
        )
        .map_err(|error| format!("Failed to upsert lyric candidate: {error}"))?;

        Ok(())
    })
}

pub fn upsert_lyric_selection(
    app: &AppHandle,
    input: LibraryLyricSelectionUpsertInput,
) -> Result<(), String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let selection_key = input.selection_key.trim();
        if selection_key.is_empty() {
            return Err("Lyric selection selection_key is required".to_string());
        }

        let selected_document_id = input.selected_document_id.trim();
        if selected_document_id.is_empty() {
            return Err("Lyric selection selected_document_id is required".to_string());
        }

        let selected_by =
            normalize_text(input.selected_by.as_deref()).unwrap_or_else(|| "system".to_string());
        let now = input.updated_at_ms.unwrap_or_else(now_ms).max(0);

        conn.execute(
            r#"
            INSERT INTO lyric_selection(
              selection_key,
              entry_id,
              selected_document_id,
              selected_candidate_id,
              selected_by,
              selected_at_ms,
              updated_at_ms
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
            ON CONFLICT(selection_key) DO UPDATE SET
              entry_id = excluded.entry_id,
              selected_document_id = excluded.selected_document_id,
              selected_candidate_id = excluded.selected_candidate_id,
              selected_by = excluded.selected_by,
              selected_at_ms = excluded.selected_at_ms,
              updated_at_ms = excluded.updated_at_ms
            "#,
            params![
                selection_key,
                normalize_text(input.entry_id.as_deref()),
                selected_document_id,
                normalize_text(input.selected_candidate_id.as_deref()),
                selected_by,
                now,
            ],
        )
        .map_err(|error| format!("Failed to upsert lyric selection: {error}"))?;

        if let Some(entry_id) = normalize_text(input.entry_id.as_deref()) {
            let selected = conn
                .query_row(
                    r#"
                    SELECT source_locator, format, language, content_hash
                    FROM lyric_documents
                    WHERE id = ?1
                    LIMIT 1
                    "#,
                    params![selected_document_id],
                    |row| {
                        Ok((
                            row.get::<_, Option<String>>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, Option<String>>(3)?,
                        ))
                    },
                )
                .ok();

            if let Some((source_locator, format, language, content_hash)) = selected {
                if let Some(locator) = normalize_text(source_locator.as_deref()) {
                    let ref_id = format!("lyric::{entry_id}");
                    conn.execute(
                        "DELETE FROM lyric_refs WHERE entry_id = ?1",
                        params![entry_id],
                    )
                    .map_err(|error| {
                        format!("Failed to cleanup lyric refs before selection sync: {error}")
                    })?;

                    conn.execute(
                        r#"
                        INSERT INTO lyric_refs(
                          id,
                          entry_id,
                          provider_lyric_id,
                          lyric_locator,
                          format,
                          lang,
                          etag,
                          updated_at_ms
                        )
                        VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7)
                        "#,
                        params![
                            ref_id,
                            entry_id,
                            locator,
                            normalize_text(Some(format.as_str())),
                            normalize_text(language.as_deref()),
                            normalize_text(content_hash.as_deref()),
                            now,
                        ],
                    )
                    .map_err(|error| format!("Failed to sync lyric ref from selection: {error}"))?;
                }
            }
        }

        Ok(())
    })
}

pub fn get_selected_lyric_document(
    app: &AppHandle,
    selection_key: &str,
) -> Result<Option<LibraryLyricDocumentRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let key = selection_key.trim();
        if key.is_empty() {
            return Ok(None);
        }

        let selected = conn
            .query_row(
                r#"
                SELECT
                  ld.id,
                  ld.selection_key,
                  ld.entry_id,
                  ld.track_id,
                  ld.quick_fingerprint,
                  ld.source_kind,
                  ld.source_locator,
                  ld.format,
                  ld.language,
                  ld.is_dynamic,
                  ld.has_word_timing,
                  ld.confidence,
                  ld.payload_json,
                  ld.content_hash,
                  ld.created_at_ms,
                  ld.updated_at_ms
                FROM lyric_selection ls
                JOIN lyric_documents ld ON ld.id = ls.selected_document_id
                WHERE ls.selection_key = ?1
                LIMIT 1
                "#,
                params![key],
                |row| {
                    Ok(LibraryLyricDocumentRecord {
                        id: row.get(0)?,
                        selection_key: row.get(1)?,
                        entry_id: row.get(2)?,
                        track_id: row.get(3)?,
                        quick_fingerprint: row.get(4)?,
                        source_kind: row.get(5)?,
                        source_locator: row.get(6)?,
                        format: row.get(7)?,
                        language: row.get(8)?,
                        is_dynamic: row.get::<_, i64>(9)? != 0,
                        has_word_timing: row.get::<_, i64>(10)? != 0,
                        confidence: row.get::<_, f64>(11)?.clamp(0.0, 1.0) as f32,
                        payload_json: row.get(12)?,
                        content_hash: row.get(13)?,
                        created_at_ms: row.get(14)?,
                        updated_at_ms: row.get(15)?,
                    })
                },
            )
            .ok();

        if selected.is_some() {
            return Ok(selected);
        }

        let legacy_entry_id = key
            .strip_prefix("entry::")
            .and_then(|value| normalize_text(Some(value)));
        let Some(entry_id) = legacy_entry_id else {
            return Ok(None);
        };

        let legacy = conn
            .query_row(
                r#"
                SELECT
                  ue.id,
                  ue.track_id,
                  ue.quick_fingerprint,
                  lr.lyric_locator,
                  lr.format,
                  lr.lang,
                  lr.etag,
                  lr.updated_at_ms
                FROM lyric_refs lr
                LEFT JOIN user_entries ue ON ue.id = lr.entry_id
                WHERE lr.entry_id = ?1
                LIMIT 1
                "#,
                params![entry_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, Option<i64>>(7)?,
                    ))
                },
            )
            .ok();

        let Some((
            entry_id_raw,
            track_id,
            quick_fingerprint,
            locator,
            format,
            language,
            etag,
            updated_at_ms,
        )) = legacy
        else {
            return Ok(None);
        };

        let locator_value = locator.unwrap_or_default();
        if locator_value.trim().is_empty() {
            return Ok(None);
        }

        let source_kind =
            if locator_value.starts_with("http://") || locator_value.starts_with("https://") {
                "web".to_string()
            } else if locator_value.contains("lyrics-cache") {
                "cache".to_string()
            } else {
                "sidecar".to_string()
            };
        let format_value = format
            .as_deref()
            .and_then(|value| normalize_text(Some(value)))
            .map(|value| value.to_ascii_lowercase())
            .unwrap_or_else(|| {
                if locator_value.to_ascii_lowercase().ends_with(".txt") {
                    "plain".to_string()
                } else {
                    "lrc".to_string()
                }
            });

        let now = updated_at_ms.unwrap_or_else(now_ms).max(0);
        let is_dynamic = format_value == "lrc" || format_value == "yrc";
        let payload_json = serde_json::json!({
            "id": format!("legacy::{entry_id}"),
            "entryId": entry_id_raw,
            "trackId": track_id,
            "quickFingerprint": quick_fingerprint,
            "sourceKind": source_kind,
            "sourceLocator": locator_value,
            "format": format_value,
            "language": language,
            "isDynamic": is_dynamic,
            "hasWordTiming": false,
            "confidence": 0.6,
            "lines": [],
            "rawText": null,
            "updatedAtMs": now,
        })
        .to_string();

        Ok(Some(LibraryLyricDocumentRecord {
            id: format!("legacy::{entry_id}"),
            selection_key: key.to_string(),
            entry_id: entry_id_raw,
            track_id,
            quick_fingerprint,
            source_kind,
            source_locator: Some(locator_value),
            format: format_value.clone(),
            language,
            is_dynamic,
            has_word_timing: false,
            confidence: 0.6,
            payload_json,
            content_hash: etag,
            created_at_ms: now,
            updated_at_ms: now,
        }))
    })
}

pub fn upsert_lyric_fetch_job(
    app: &AppHandle,
    input: LibraryLyricFetchJobUpsertInput,
) -> Result<u64, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let selection_key = input.selection_key.trim();
        if selection_key.is_empty() {
            return Err("Lyric fetch job selection_key is required".to_string());
        }

        let now = input.updated_at_ms.unwrap_or_else(now_ms).max(0);
        let status = normalize_lyric_fetch_job_status(input.status.as_deref());
        let priority = input.priority.unwrap_or(100).clamp(0, 1000);
        let attempt_count = input.attempt_count.unwrap_or(0).min(i64::MAX as u64) as i64;

        let job_id = normalize_text(input.id.as_deref())
            .unwrap_or_else(|| format!("lyjob::{selection_key}"));

        conn.execute(
            r#"
            INSERT INTO lyric_fetch_jobs(
              id,
              selection_key,
              entry_id,
              track_id,
              priority,
              status,
              attempt_count,
              next_run_at_ms,
              last_error,
              payload_json,
              created_at_ms,
              updated_at_ms
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
            ON CONFLICT(id) DO UPDATE SET
              selection_key = excluded.selection_key,
              entry_id = excluded.entry_id,
              track_id = excluded.track_id,
              priority = excluded.priority,
              status = excluded.status,
              attempt_count = excluded.attempt_count,
              next_run_at_ms = excluded.next_run_at_ms,
              last_error = excluded.last_error,
              payload_json = excluded.payload_json,
              updated_at_ms = excluded.updated_at_ms
            "#,
            params![
                job_id,
                selection_key,
                normalize_text(input.entry_id.as_deref()),
                normalize_text(input.track_id.as_deref()),
                priority,
                status,
                attempt_count,
                input.next_run_at_ms,
                normalize_text(input.last_error.as_deref()),
                normalize_text(input.payload_json.as_deref()),
                now,
            ],
        )
        .map_err(|error| format!("Failed to upsert lyric fetch job: {error}"))?;

        Ok(conn.changes())
    })
}

pub fn sync_source_tracks(
    app: &AppHandle,
    source_id: &str,
    upserts: Vec<LibraryTrackUpsertInput>,
    missing_track_ids: Vec<String>,
) -> Result<LibraryTrackSyncResult, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let now = now_ms();
        let tx = conn
            .transaction()
            .map_err(|error| format!("Failed to start source track sync transaction: {error}"))?;

        let mut upserted = 0usize;
        for item in upserts {
            let track_id = item.id.trim();
            let file_path = item.file_path.trim();
            if track_id.is_empty() || file_path.is_empty() {
                continue;
            }

            tx.execute(
                r#"
                INSERT INTO local_tracks(
                  id,
                  source_id,
                  file_path,
                  quick_fingerprint,
                  title,
                  artist,
                  album,
                  genre,
                  year,
                  format,
                  duration_seconds,
                  sample_rate,
                  bit_depth,
                  file_size,
                  mtime_ms,
                  replay_gain_track_db,
                  replay_gain_album_db,
                  status,
                  created_at_ms,
                  updated_at_ms,
                  last_seen_at_ms
                )
                VALUES (
                  ?1,
                  ?2,
                  ?3,
                  ?4,
                  ?5,
                  ?6,
                  ?7,
                  ?8,
                  ?9,
                  ?10,
                  ?11,
                  ?12,
                  ?13,
                  ?14,
                  ?15,
                  ?16,
                  ?17,
                  'available',
                  ?18,
                  ?19,
                  ?20
                )
                ON CONFLICT(id) DO UPDATE SET
                  source_id = excluded.source_id,
                  file_path = excluded.file_path,
                  quick_fingerprint = excluded.quick_fingerprint,
                  title = excluded.title,
                  artist = excluded.artist,
                  album = excluded.album,
                  genre = excluded.genre,
                  year = excluded.year,
                  format = excluded.format,
                  duration_seconds = excluded.duration_seconds,
                  sample_rate = excluded.sample_rate,
                  bit_depth = excluded.bit_depth,
                  file_size = excluded.file_size,
                  mtime_ms = excluded.mtime_ms,
                  replay_gain_track_db = excluded.replay_gain_track_db,
                  replay_gain_album_db = excluded.replay_gain_album_db,
                  status = 'available',
                  updated_at_ms = excluded.updated_at_ms,
                  last_seen_at_ms = excluded.last_seen_at_ms
                "#,
                params![
                    track_id,
                    source_id,
                    file_path,
                    normalize_quick_fingerprint(item.quick_fingerprint.as_deref()),
                    normalize_text(item.title.as_deref()),
                    normalize_text(item.artist.as_deref()),
                    normalize_text(item.album.as_deref()),
                    normalize_text(item.genre.as_deref()),
                    item.year,
                    normalize_text(item.format.as_deref()),
                    item.duration,
                    item.sample_rate.map(|value| value as i64),
                    item.bit_depth.map(|value| value as i64),
                    item.file_size.map(|value| value as i64),
                    item.mtime_ms,
                    item.replay_gain_track_db,
                    item.replay_gain_album_db,
                    now,
                    now,
                    now,
                ],
            )
            .map_err(|error| format!("Failed to upsert source track: {error}"))?;
            upserted += 1;
        }

        let mut marked_missing = 0usize;
        for track_id in missing_track_ids {
            let normalized = track_id.trim();
            if normalized.is_empty() {
                continue;
            }

            let affected = tx
                .execute(
                    r#"
                    UPDATE local_tracks
                    SET status = 'missing', updated_at_ms = ?3
                    WHERE source_id = ?1 AND id = ?2
                    "#,
                    params![source_id, normalized, now],
                )
                .map_err(|error| format!("Failed to mark track as missing: {error}"))?;
            marked_missing += affected as usize;
        }

        tx.execute(
            "UPDATE sources SET last_scanned_at_ms = ?2, updated_at_ms = ?2 WHERE id = ?1",
            params![source_id, now],
        )
        .map_err(|error| format!("Failed to update source scan metadata: {error}"))?;

        tx.commit()
            .map_err(|error| format!("Failed to commit source track sync transaction: {error}"))?;

        invalidate_track_query_count_cache();

        Ok(LibraryTrackSyncResult {
            upserted,
            marked_missing,
        })
    })
}

pub fn clear_tracks(app: &AppHandle) -> Result<u64, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let affected = conn
            .execute("DELETE FROM local_tracks", [])
            .map_err(|error| format!("Failed to clear tracks: {error}"))?;
        invalidate_track_query_count_cache();
        Ok(affected as u64)
    })
}

pub fn delete_tracks(app: &AppHandle, track_ids: Vec<String>) -> Result<u64, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_ids: Vec<String> = track_ids
            .into_iter()
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty())
            .collect();

        if normalized_ids.is_empty() {
            return Ok(0);
        }

        let tx = conn
            .transaction()
            .map_err(|error| format!("Failed to start delete tracks transaction: {error}"))?;

        let mut deleted = 0_u64;
        for track_id in normalized_ids {
            let affected = tx
                .execute("DELETE FROM local_tracks WHERE id = ?1", params![track_id])
                .map_err(|error| format!("Failed to delete track: {error}"))?;
            deleted += affected as u64;
        }

        tx.commit()
            .map_err(|error| format!("Failed to commit delete tracks transaction: {error}"))?;

        invalidate_track_query_count_cache();

        Ok(deleted)
    })
}

pub fn mark_track_played(
    app: &AppHandle,
    track_id: &str,
    played_at_ms: Option<i64>,
) -> Result<bool, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_track_id = track_id.trim();
        if normalized_track_id.is_empty() {
            return Ok(false);
        }

        let now = played_at_ms.unwrap_or_else(now_ms).max(0);
        let affected = conn
            .execute(
                r#"
                UPDATE local_tracks
                SET
                  play_count = COALESCE(play_count, 0) + 1,
                  last_played_at_ms = ?2,
                  updated_at_ms = CASE
                    WHEN updated_at_ms > ?2 THEN updated_at_ms
                    ELSE ?2
                  END
                WHERE id = ?1
                "#,
                params![normalized_track_id, now],
            )
            .map_err(|error| format!("Failed to mark track played: {error}"))?;
        Ok(affected > 0)
    })
}

pub fn upsert_user_entry(
    app: &AppHandle,
    input: LibraryUserEntryUpsertInput,
) -> Result<LibraryUserEntryRecord, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let entry_id = input.id.trim();
        if entry_id.is_empty() {
            return Err("User entry id is required".to_string());
        }

        let owner_uid = normalize_owner_uid(Some(input.owner_uid.as_str()))
            .ok_or_else(|| "User entry ownerUid is required".to_string())?;

        let now = now_ms();
        let created_at_ms = input.created_at_ms.unwrap_or(now).max(0);
        let updated_at_ms = input.updated_at_ms.unwrap_or(now).max(created_at_ms);

        conn.execute(
            r#"
            INSERT INTO user_entries(
              id,
              owner_uid,
              track_id,
              quick_fingerprint,
              cloud_content_id,
              display_title,
              display_artist,
              rating,
              tags_json,
              in_cloud,
              is_missing,
              created_at_ms,
              updated_at_ms
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            ON CONFLICT(id) DO UPDATE SET
              owner_uid = excluded.owner_uid,
              track_id = excluded.track_id,
              quick_fingerprint = excluded.quick_fingerprint,
              cloud_content_id = excluded.cloud_content_id,
              display_title = excluded.display_title,
              display_artist = excluded.display_artist,
              rating = excluded.rating,
              tags_json = excluded.tags_json,
              in_cloud = excluded.in_cloud,
              is_missing = excluded.is_missing,
              updated_at_ms = excluded.updated_at_ms
            "#,
            params![
                entry_id,
                owner_uid,
                normalize_text(input.track_id.as_deref()),
                normalize_quick_fingerprint(input.quick_fingerprint.as_deref()),
                normalize_text(input.cloud_content_id.as_deref()),
                normalize_text(input.display_title.as_deref()),
                normalize_text(input.display_artist.as_deref()),
                normalize_rating(input.rating),
                normalize_text(input.tags_json.as_deref()),
                normalize_bool_flag(input.in_cloud, false),
                normalize_bool_flag(input.is_missing, false),
                created_at_ms,
                updated_at_ms,
            ],
        )
        .map_err(|error| format!("Failed to upsert user entry: {error}"))?;

        user_entry_record_by_id(conn, entry_id)
    })
}

pub fn list_user_entries(
    app: &AppHandle,
    query: Option<LibraryUserEntryQueryInput>,
) -> Result<Vec<LibraryUserEntryRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_limit = normalize_limit(query.as_ref().and_then(|item| item.limit));
        let normalized_offset = normalize_offset(query.as_ref().and_then(|item| item.offset));
        let normalized_owner_uid = query
            .as_ref()
            .and_then(|item| item.owner_uid.as_ref())
            .and_then(|value| normalize_owner_uid(Some(value.as_str())));
        let owner_uid_enabled_flag = if normalized_owner_uid.is_some() {
            1_i64
        } else {
            0_i64
        };
        let owner_uid_exact_value = normalized_owner_uid.unwrap_or_default();
        let in_cloud_only_flag = if query
            .as_ref()
            .and_then(|item| item.in_cloud_only)
            .unwrap_or(false)
        {
            1_i64
        } else {
            0_i64
        };
        let include_missing_flag = if query
            .as_ref()
            .and_then(|item| item.include_missing)
            .unwrap_or(true)
        {
            1_i64
        } else {
            0_i64
        };
        let normalized_search_query = query
            .as_ref()
            .and_then(|item| item.search_query.as_ref())
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| !value.is_empty());
        let search_enabled_flag = if normalized_search_query.is_some() {
            1_i64
        } else {
            0_i64
        };
        let search_like_pattern = normalized_search_query
            .map(|value| format!("%{value}%"))
            .unwrap_or_else(|| "%".to_string());

        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  id,
                  owner_uid,
                  track_id,
                  quick_fingerprint,
                  cloud_content_id,
                  display_title,
                  display_artist,
                  rating,
                  tags_json,
                  in_cloud,
                  is_missing,
                  play_count,
                  last_played_at_ms,
                  created_at_ms,
                  updated_at_ms
                FROM user_entries
                WHERE (?1 = 0 OR owner_uid = ?2)
                  AND (?3 = 0 OR in_cloud = 1)
                  AND (?4 = 1 OR is_missing = 0)
                  AND (
                    ?5 = 0
                    OR LOWER(COALESCE(display_title, '')) LIKE ?6
                    OR LOWER(COALESCE(display_artist, '')) LIKE ?6
                    OR LOWER(COALESCE(cloud_content_id, '')) LIKE ?6
                    OR LOWER(COALESCE(quick_fingerprint, '')) LIKE ?6
                    OR LOWER(id) LIKE ?6
                  )
                ORDER BY
                  COALESCE(last_played_at_ms, updated_at_ms) DESC,
                  updated_at_ms DESC,
                  id ASC
                LIMIT ?7
                OFFSET ?8
                "#,
            )
            .map_err(|error| format!("Failed to prepare list user entries statement: {error}"))?;

        let rows = stmt
            .query_map(
                params![
                    owner_uid_enabled_flag,
                    owner_uid_exact_value,
                    in_cloud_only_flag,
                    include_missing_flag,
                    search_enabled_flag,
                    search_like_pattern,
                    normalized_limit,
                    normalized_offset,
                ],
                |row| {
                    Ok(LibraryUserEntryRecord {
                        id: row.get(0)?,
                        owner_uid: row.get(1)?,
                        track_id: row.get(2)?,
                        quick_fingerprint: row.get(3)?,
                        cloud_content_id: row.get(4)?,
                        display_title: row.get(5)?,
                        display_artist: row.get(6)?,
                        rating: row.get(7)?,
                        tags_json: row.get(8)?,
                        in_cloud: row.get::<_, i64>(9)? != 0,
                        is_missing: row.get::<_, i64>(10)? != 0,
                        play_count: row.get::<_, i64>(11)?.max(0) as u64,
                        last_played_at_ms: row.get(12)?,
                        created_at_ms: row.get(13)?,
                        updated_at_ms: row.get(14)?,
                    })
                },
            )
            .map_err(|error| format!("Failed to query user entries: {error}"))?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|error| format!("Failed to parse user entry row: {error}"))?);
        }
        Ok(items)
    })
}

pub fn delete_user_entry(app: &AppHandle, entry_id: &str) -> Result<bool, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_entry_id = entry_id.trim();
        if normalized_entry_id.is_empty() {
            return Ok(false);
        }
        let affected = conn
            .execute(
                "DELETE FROM user_entries WHERE id = ?1",
                params![normalized_entry_id],
            )
            .map_err(|error| format!("Failed to delete user entry: {error}"))?;
        Ok(affected > 0)
    })
}

pub fn mark_user_entry_played(
    app: &AppHandle,
    entry_id: &str,
    played_at_ms: Option<i64>,
) -> Result<bool, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_entry_id = entry_id.trim();
        if normalized_entry_id.is_empty() {
            return Ok(false);
        }

        let now = played_at_ms.unwrap_or_else(now_ms).max(0);
        let affected = conn
            .execute(
                r#"
                UPDATE user_entries
                SET
                  play_count = COALESCE(play_count, 0) + 1,
                  last_played_at_ms = ?2,
                  updated_at_ms = CASE
                    WHEN updated_at_ms > ?2 THEN updated_at_ms
                    ELSE ?2
                  END
                WHERE id = ?1
                "#,
                params![normalized_entry_id, now],
            )
            .map_err(|error| format!("Failed to mark user entry played: {error}"))?;

        Ok(affected > 0)
    })
}

pub fn upsert_playlist(
    app: &AppHandle,
    input: LibraryPlaylistUpsertInput,
) -> Result<LibraryPlaylistRecord, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let playlist_id = input.id.trim();
        if playlist_id.is_empty() {
            return Err("Playlist id is required".to_string());
        }

        let owner_uid = normalize_owner_uid(Some(input.owner_uid.as_str()))
            .ok_or_else(|| "Playlist ownerUid is required".to_string())?;
        let name = normalize_text(Some(input.name.as_str()))
            .ok_or_else(|| "Playlist name is required".to_string())?;
        let kind = normalize_playlist_kind(input.kind.as_deref());

        let now = now_ms();
        let created_at_ms = input.created_at_ms.unwrap_or(now).max(0);
        let updated_at_ms = input.updated_at_ms.unwrap_or(now).max(created_at_ms);
        let last_opened_at_ms = input.last_opened_at_ms.map(|value| value.max(0));

        conn.execute(
            r#"
            INSERT INTO playlists(
              id,
              owner_uid,
              name,
              description,
              cover_url,
              kind,
              source_connector_id,
              source_playlist_id,
              smart_rule_json,
              is_readonly,
              created_at_ms,
              updated_at_ms,
              last_opened_at_ms
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            ON CONFLICT(id) DO UPDATE SET
              owner_uid = excluded.owner_uid,
              name = excluded.name,
              description = excluded.description,
              cover_url = excluded.cover_url,
              kind = excluded.kind,
              source_connector_id = excluded.source_connector_id,
              source_playlist_id = excluded.source_playlist_id,
              smart_rule_json = excluded.smart_rule_json,
              is_readonly = excluded.is_readonly,
              updated_at_ms = excluded.updated_at_ms,
              last_opened_at_ms = excluded.last_opened_at_ms
            "#,
            params![
                playlist_id,
                owner_uid,
                name,
                normalize_text(input.description.as_deref()),
                normalize_text(input.cover_url.as_deref()),
                kind,
                normalize_text(input.source_connector_id.as_deref()),
                normalize_text(input.source_playlist_id.as_deref()),
                normalize_text(input.smart_rule_json.as_deref()),
                normalize_bool_flag(input.is_readonly, false),
                created_at_ms,
                updated_at_ms,
                last_opened_at_ms,
            ],
        )
        .map_err(|error| format!("Failed to upsert playlist: {error}"))?;

        playlist_record_by_id(conn, playlist_id)
    })
}

pub fn list_playlists(
    app: &AppHandle,
    query: Option<LibraryPlaylistQueryInput>,
) -> Result<Vec<LibraryPlaylistRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_limit = normalize_limit(query.as_ref().and_then(|item| item.limit));
        let normalized_offset = normalize_offset(query.as_ref().and_then(|item| item.offset));
        let normalized_owner_uid = query
            .as_ref()
            .and_then(|item| item.owner_uid.as_ref())
            .and_then(|value| normalize_owner_uid(Some(value.as_str())));
        let owner_uid_enabled_flag = if normalized_owner_uid.is_some() {
            1_i64
        } else {
            0_i64
        };
        let owner_uid_exact_value = normalized_owner_uid.unwrap_or_default();
        let normalized_kind = query
            .as_ref()
            .and_then(|item| item.kind.as_ref())
            .map(|value| normalize_playlist_kind(Some(value.as_str())))
            .filter(|value| !value.is_empty());
        let kind_enabled_flag = if normalized_kind.is_some() {
            1_i64
        } else {
            0_i64
        };
        let kind_exact_value = normalized_kind.unwrap_or_default();

        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  id,
                  owner_uid,
                  name,
                  description,
                  cover_url,
                  kind,
                  source_connector_id,
                  source_playlist_id,
                  smart_rule_json,
                  is_readonly,
                  created_at_ms,
                  updated_at_ms,
                  last_opened_at_ms,
                  (
                    SELECT COUNT(*)
                    FROM playlist_items pi
                    WHERE pi.playlist_id = playlists.id
                  ) AS track_count,
                  (
                    SELECT COALESCE(SUM(COALESCE(pi.snapshot_duration_seconds, 0.0)), 0.0)
                    FROM playlist_items pi
                    WHERE pi.playlist_id = playlists.id
                  ) AS total_duration
                FROM playlists
                WHERE (?1 = 0 OR owner_uid = ?2)
                  AND (?3 = 0 OR kind = ?4)
                ORDER BY
                  COALESCE(last_opened_at_ms, updated_at_ms) DESC,
                  updated_at_ms DESC,
                  id ASC
                LIMIT ?5
                OFFSET ?6
                "#,
            )
            .map_err(|error| format!("Failed to prepare list playlists statement: {error}"))?;

        let rows = stmt
            .query_map(
                params![
                    owner_uid_enabled_flag,
                    owner_uid_exact_value,
                    kind_enabled_flag,
                    kind_exact_value,
                    normalized_limit,
                    normalized_offset,
                ],
                |row| {
                    Ok(LibraryPlaylistRecord {
                        id: row.get(0)?,
                        owner_uid: row.get(1)?,
                        name: row.get(2)?,
                        description: row.get(3)?,
                        cover_url: row.get(4)?,
                        kind: row.get(5)?,
                        source_connector_id: row.get(6)?,
                        source_playlist_id: row.get(7)?,
                        smart_rule_json: row.get(8)?,
                        is_readonly: row.get::<_, i64>(9)? != 0,
                        created_at_ms: row.get(10)?,
                        updated_at_ms: row.get(11)?,
                        last_opened_at_ms: row.get(12)?,
                        track_count: row.get::<_, i64>(13)?.max(0) as u64,
                        total_duration: row.get::<_, f64>(14)?.max(0.0),
                    })
                },
            )
            .map_err(|error| format!("Failed to query playlists: {error}"))?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|error| format!("Failed to parse playlist row: {error}"))?);
        }
        Ok(items)
    })
}

pub fn delete_playlist(app: &AppHandle, playlist_id: &str) -> Result<bool, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_playlist_id = playlist_id.trim();
        if normalized_playlist_id.is_empty() {
            return Ok(false);
        }
        let affected = conn
            .execute(
                "DELETE FROM playlists WHERE id = ?1",
                params![normalized_playlist_id],
            )
            .map_err(|error| format!("Failed to delete playlist: {error}"))?;
        Ok(affected > 0)
    })
}

pub fn touch_playlist_opened(
    app: &AppHandle,
    playlist_id: &str,
    opened_at_ms: Option<i64>,
) -> Result<bool, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_playlist_id = playlist_id.trim();
        if normalized_playlist_id.is_empty() {
            return Ok(false);
        }
        let opened = opened_at_ms.unwrap_or_else(now_ms).max(0);
        let affected = conn
            .execute(
                r#"
                UPDATE playlists
                SET
                  last_opened_at_ms = ?2,
                  updated_at_ms = CASE
                    WHEN updated_at_ms > ?2 THEN updated_at_ms
                    ELSE ?2
                  END
                WHERE id = ?1
                "#,
                params![normalized_playlist_id, opened],
            )
            .map_err(|error| format!("Failed to touch playlist opened timestamp: {error}"))?;

        Ok(affected > 0)
    })
}

pub fn replace_playlist_items(
    app: &AppHandle,
    playlist_id: &str,
    items: Vec<LibraryPlaylistItemUpsertInput>,
) -> Result<u64, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_playlist_id = playlist_id.trim();
        if normalized_playlist_id.is_empty() {
            return Ok(0);
        }

        let tx = conn.transaction().map_err(|error| {
            format!("Failed to start replace playlist items transaction: {error}")
        })?;

        tx.execute(
            "DELETE FROM playlist_items WHERE playlist_id = ?1",
            params![normalized_playlist_id],
        )
        .map_err(|error| format!("Failed to clear previous playlist items: {error}"))?;

        let now = now_ms();
        let mut inserted: u64 = 0;
        for (index, raw_item) in items.into_iter().enumerate() {
            let fallback_position = index as i64;
            let position = raw_item.position.unwrap_or(fallback_position).max(0);
            let local_track_id = normalize_text(raw_item.local_track_id.as_deref());
            let entry_id = normalize_text(raw_item.entry_id.as_deref());
            let track_payload_json = normalize_text(raw_item.track_payload_json.as_deref());

            if local_track_id.is_none() && entry_id.is_none() && track_payload_json.is_none() {
                continue;
            }

            let item_id = normalize_text(raw_item.id.as_deref())
                .unwrap_or_else(|| format!("pli::{normalized_playlist_id}::{position}::{index}"));
            let created_at_ms = raw_item.created_at_ms.unwrap_or(now).max(0);
            let snapshot_duration_seconds = raw_item
                .snapshot_duration_seconds
                .filter(|value| value.is_finite() && *value >= 0.0);

            tx.execute(
                r#"
                INSERT INTO playlist_items(
                  id,
                  playlist_id,
                  position,
                  local_track_id,
                  entry_id,
                  track_payload_json,
                  snapshot_title,
                  snapshot_artist,
                  snapshot_album,
                  snapshot_duration_seconds,
                  created_at_ms
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                "#,
                params![
                    item_id,
                    normalized_playlist_id,
                    position,
                    local_track_id,
                    entry_id,
                    track_payload_json,
                    normalize_text(raw_item.snapshot_title.as_deref()),
                    normalize_text(raw_item.snapshot_artist.as_deref()),
                    normalize_text(raw_item.snapshot_album.as_deref()),
                    snapshot_duration_seconds,
                    created_at_ms,
                ],
            )
            .map_err(|error| format!("Failed to insert playlist item: {error}"))?;
            inserted = inserted.saturating_add(1);
        }

        tx.commit().map_err(|error| {
            format!("Failed to commit replace playlist items transaction: {error}")
        })?;

        Ok(inserted)
    })
}

pub fn list_playlist_items(
    app: &AppHandle,
    playlist_id: &str,
    limit: Option<u32>,
) -> Result<Vec<LibraryPlaylistItemRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_playlist_id = playlist_id.trim();
        if normalized_playlist_id.is_empty() {
            return Ok(Vec::new());
        }

        let normalized_limit = limit.map(|value| value.max(1).min(512) as i64);

        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  id,
                  playlist_id,
                  position,
                  local_track_id,
                  entry_id,
                  track_payload_json,
                  snapshot_title,
                  snapshot_artist,
                  snapshot_album,
                  snapshot_duration_seconds,
                  created_at_ms
                FROM playlist_items
                WHERE playlist_id = ?1
                ORDER BY position ASC, created_at_ms ASC, id ASC
                LIMIT COALESCE(?2, -1)
                "#,
            )
            .map_err(|error| format!("Failed to prepare list playlist items statement: {error}"))?;

        let rows = stmt
            .query_map(
                params![normalized_playlist_id, normalized_limit],
                parse_playlist_item_row,
            )
            .map_err(|error| format!("Failed to query playlist items: {error}"))?;

        let mut result = Vec::new();
        for row in rows {
            result
                .push(row.map_err(|error| format!("Failed to parse playlist item row: {error}"))?);
        }
        Ok(result)
    })
}

fn parse_playlist_item_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<LibraryPlaylistItemRecord> {
    Ok(LibraryPlaylistItemRecord {
        id: row.get(0)?,
        playlist_id: row.get(1)?,
        position: row.get(2)?,
        local_track_id: row.get(3)?,
        entry_id: row.get(4)?,
        track_payload_json: row.get(5)?,
        snapshot_title: row.get(6)?,
        snapshot_artist: row.get(7)?,
        snapshot_album: row.get(8)?,
        snapshot_duration_seconds: row.get(9)?,
        created_at_ms: row.get(10)?,
    })
}

#[derive(Debug, Default, Clone)]
struct PlaylistItemCompareKeys {
    identity: String,
    normalized_path: String,
}

fn normalize_compare_text(value: Option<&str>) -> String {
    value
        .map(|item| item.trim().to_ascii_lowercase())
        .filter(|item| !item.is_empty())
        .unwrap_or_default()
}

fn normalize_track_path_for_compare(value: Option<&str>) -> String {
    let Some(raw_path) = value else {
        return String::new();
    };

    let mut normalized = raw_path.trim().to_string();
    if normalized.is_empty() {
        return String::new();
    }

    let lower = normalized.to_ascii_lowercase();
    if lower.starts_with("file://localhost") {
        normalized = normalized[16..].to_string();
    } else if lower.starts_with("file://") {
        normalized = normalized[7..].to_string();
    }

    if normalized.starts_with("\\\\?\\") {
        normalized = normalized[4..].to_string();
    } else if normalized.starts_with("//?/") {
        normalized = normalized[4..].to_string();
    }

    let normalized_bytes = normalized.as_bytes();
    if normalized_bytes.len() >= 3
        && normalized_bytes[0] == b'/'
        && normalized_bytes[2] == b':'
        && normalized_bytes[1].is_ascii_alphabetic()
    {
        normalized = normalized[1..].to_string();
    }

    normalized = normalized.replace('\\', "/");
    while normalized.contains("//") {
        normalized = normalized.replace("//", "/");
    }
    while normalized.ends_with('/') {
        normalized.pop();
    }

    normalized.trim().to_ascii_lowercase()
}

fn read_track_payload_string_field<'a>(payload: &'a JsonValue, field: &str) -> Option<&'a str> {
    payload
        .get(field)
        .and_then(JsonValue::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn build_playlist_item_compare_keys(
    track_payload_json: Option<&str>,
    snapshot_title: Option<&str>,
    snapshot_artist: Option<&str>,
) -> PlaylistItemCompareKeys {
    let payload = track_payload_json.and_then(|raw| serde_json::from_str::<JsonValue>(raw).ok());
    let payload_ref = payload.as_ref();
    let id = normalize_compare_text(
        payload_ref.and_then(|value| read_track_payload_string_field(value, "id")),
    );
    let original_path = normalize_compare_text(
        payload_ref.and_then(|value| read_track_payload_string_field(value, "originalPath")),
    );
    let file_path = normalize_compare_text(
        payload_ref.and_then(|value| read_track_payload_string_field(value, "filePath")),
    );
    let path = normalize_compare_text(
        payload_ref.and_then(|value| read_track_payload_string_field(value, "path")),
    );
    let title = normalize_compare_text(
        payload_ref
            .and_then(|value| read_track_payload_string_field(value, "title"))
            .or(snapshot_title),
    );
    let artist = normalize_compare_text(
        payload_ref
            .and_then(|value| read_track_payload_string_field(value, "artist"))
            .or(snapshot_artist),
    );

    let identity = if !id.is_empty() {
        format!("id:{id}")
    } else if !original_path.is_empty() {
        format!("origin:{original_path}")
    } else if !file_path.is_empty() {
        format!("file:{file_path}")
    } else if !path.is_empty() {
        format!("path:{path}")
    } else if !title.is_empty() {
        format!("meta:{title}|{artist}")
    } else {
        String::new()
    };

    let normalized_path = normalize_track_path_for_compare(
        payload_ref
            .and_then(|value| read_track_payload_string_field(value, "filePath"))
            .or_else(|| {
                payload_ref.and_then(|value| read_track_payload_string_field(value, "path"))
            })
            .or_else(|| {
                payload_ref.and_then(|value| read_track_payload_string_field(value, "originalPath"))
            }),
    );

    PlaylistItemCompareKeys {
        identity,
        normalized_path,
    }
}

fn resequence_playlist_items(tx: &Transaction<'_>, playlist_id: &str) -> Result<(), String> {
    let mut stmt = tx
        .prepare(
            r#"
            SELECT id
            FROM playlist_items
            WHERE playlist_id = ?1
            ORDER BY position ASC, created_at_ms ASC, id ASC
            "#,
        )
        .map_err(|error| format!("Failed to prepare playlist item resequence query: {error}"))?;

    let rows = stmt
        .query_map(params![playlist_id], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Failed to query playlist item ids for resequence: {error}"))?;

    let mut ordered_ids = Vec::new();
    for row in rows {
        ordered_ids.push(row.map_err(|error| {
            format!("Failed to parse playlist item id for resequence: {error}")
        })?);
    }
    drop(stmt);

    for (index, item_id) in ordered_ids.into_iter().enumerate() {
        tx.execute(
            "UPDATE playlist_items SET position = ?2 WHERE id = ?1",
            params![item_id, index as i64],
        )
        .map_err(|error| format!("Failed to resequence playlist item position: {error}"))?;
    }

    Ok(())
}

fn touch_playlist_updated_at(
    tx: &Transaction<'_>,
    playlist_id: &str,
    updated_at_ms: i64,
) -> Result<(), String> {
    tx.execute(
        r#"
        UPDATE playlists
        SET updated_at_ms = ?2
        WHERE id = ?1
        "#,
        params![playlist_id, updated_at_ms.max(0)],
    )
    .map_err(|error| format!("Failed to update playlist timestamp: {error}"))?;
    Ok(())
}

pub fn prepend_playlist_item(
    app: &AppHandle,
    playlist_id: &str,
    item: LibraryPlaylistItemUpsertInput,
) -> Result<LibraryPlaylistRecord, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_playlist_id = playlist_id.trim();
        if normalized_playlist_id.is_empty() {
            return Err("Playlist id is required".to_string());
        }

        let local_track_id = normalize_text(item.local_track_id.as_deref());
        let entry_id = normalize_text(item.entry_id.as_deref());
        let track_payload_json = normalize_text(item.track_payload_json.as_deref());
        if local_track_id.is_none() && entry_id.is_none() && track_payload_json.is_none() {
            return playlist_record_by_id(conn, normalized_playlist_id);
        }

        let incoming_keys = build_playlist_item_compare_keys(
            track_payload_json.as_deref(),
            item.snapshot_title.as_deref(),
            item.snapshot_artist.as_deref(),
        );

        let mut dedup_stmt = conn
            .prepare(
                r#"
                SELECT
                  id,
                  track_payload_json,
                  snapshot_title,
                  snapshot_artist
                FROM playlist_items
                WHERE playlist_id = ?1
                ORDER BY position ASC, created_at_ms ASC, id ASC
                "#,
            )
            .map_err(|error| format!("Failed to prepare playlist dedup query: {error}"))?;

        let dedup_rows = dedup_stmt
            .query_map(params![normalized_playlist_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })
            .map_err(|error| format!("Failed to query playlist dedup rows: {error}"))?;

        let mut duplicate_ids = Vec::new();
        for row in dedup_rows {
            let (item_id, payload_json, snapshot_title, snapshot_artist) =
                row.map_err(|error| format!("Failed to parse playlist dedup row: {error}"))?;
            let candidate_keys = build_playlist_item_compare_keys(
                payload_json.as_deref(),
                snapshot_title.as_deref(),
                snapshot_artist.as_deref(),
            );
            let same_identity = !incoming_keys.identity.is_empty()
                && incoming_keys.identity == candidate_keys.identity;
            let same_path = !incoming_keys.normalized_path.is_empty()
                && incoming_keys.normalized_path == candidate_keys.normalized_path;
            if same_identity || same_path {
                duplicate_ids.push(item_id);
            }
        }
        drop(dedup_stmt);

        let tx = conn.transaction().map_err(|error| {
            format!("Failed to start prepend playlist item transaction: {error}")
        })?;

        for duplicate_id in duplicate_ids {
            tx.execute(
                "DELETE FROM playlist_items WHERE id = ?1",
                params![duplicate_id],
            )
            .map_err(|error| format!("Failed to remove duplicate playlist item: {error}"))?;
        }

        resequence_playlist_items(&tx, normalized_playlist_id)?;

        tx.execute(
            "UPDATE playlist_items SET position = position + 1 WHERE playlist_id = ?1",
            params![normalized_playlist_id],
        )
        .map_err(|error| format!("Failed to shift playlist item positions: {error}"))?;

        let now = now_ms();
        let item_id = normalize_text(item.id.as_deref())
            .unwrap_or_else(|| format!("pli::{normalized_playlist_id}::0::{now}"));
        let created_at_ms = item.created_at_ms.unwrap_or(now).max(0);
        let snapshot_duration_seconds = item
            .snapshot_duration_seconds
            .filter(|value| value.is_finite() && *value >= 0.0);

        tx.execute(
            r#"
            INSERT INTO playlist_items(
              id,
              playlist_id,
              position,
              local_track_id,
              entry_id,
              track_payload_json,
              snapshot_title,
              snapshot_artist,
              snapshot_album,
              snapshot_duration_seconds,
              created_at_ms
            )
            VALUES (?1, ?2, 0, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            "#,
            params![
                item_id,
                normalized_playlist_id,
                local_track_id,
                entry_id,
                track_payload_json,
                normalize_text(item.snapshot_title.as_deref()),
                normalize_text(item.snapshot_artist.as_deref()),
                normalize_text(item.snapshot_album.as_deref()),
                snapshot_duration_seconds,
                created_at_ms,
            ],
        )
        .map_err(|error| format!("Failed to insert prepended playlist item: {error}"))?;

        touch_playlist_updated_at(&tx, normalized_playlist_id, now)?;
        tx.commit().map_err(|error| {
            format!("Failed to commit prepend playlist item transaction: {error}")
        })?;

        playlist_record_by_id(conn, normalized_playlist_id)
    })
}

pub fn remove_playlist_item_at(
    app: &AppHandle,
    playlist_id: &str,
    position: i64,
) -> Result<LibraryPlaylistRecord, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_playlist_id = playlist_id.trim();
        if normalized_playlist_id.is_empty() {
            return Err("Playlist id is required".to_string());
        }
        if position < 0 {
            return playlist_record_by_id(conn, normalized_playlist_id);
        }

        let tx = conn.transaction().map_err(|error| {
            format!("Failed to start remove playlist item transaction: {error}")
        })?;

        tx.execute(
            "DELETE FROM playlist_items WHERE playlist_id = ?1 AND position = ?2",
            params![normalized_playlist_id, position],
        )
        .map_err(|error| format!("Failed to delete playlist item by position: {error}"))?;

        resequence_playlist_items(&tx, normalized_playlist_id)?;
        touch_playlist_updated_at(&tx, normalized_playlist_id, now_ms())?;
        tx.commit().map_err(|error| {
            format!("Failed to commit remove playlist item transaction: {error}")
        })?;

        playlist_record_by_id(conn, normalized_playlist_id)
    })
}

pub fn clear_playlist_items(
    app: &AppHandle,
    playlist_id: &str,
) -> Result<LibraryPlaylistRecord, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_playlist_id = playlist_id.trim();
        if normalized_playlist_id.is_empty() {
            return Err("Playlist id is required".to_string());
        }

        let tx = conn.transaction().map_err(|error| {
            format!("Failed to start clear playlist items transaction: {error}")
        })?;

        tx.execute(
            "DELETE FROM playlist_items WHERE playlist_id = ?1",
            params![normalized_playlist_id],
        )
        .map_err(|error| format!("Failed to clear playlist items: {error}"))?;

        touch_playlist_updated_at(&tx, normalized_playlist_id, now_ms())?;
        tx.commit().map_err(|error| {
            format!("Failed to commit clear playlist items transaction: {error}")
        })?;

        playlist_record_by_id(conn, normalized_playlist_id)
    })
}

fn normalize_playlist_track_page_limit(query: Option<&LibraryPlaylistTrackPageQueryInput>) -> i64 {
    query
        .and_then(|value| value.limit)
        .map(|value| value.max(1).min(2000) as i64)
        .unwrap_or(240)
}

fn normalize_playlist_track_page_offset(query: Option<&LibraryPlaylistTrackPageQueryInput>) -> i64 {
    query
        .and_then(|value| value.offset)
        .map(|value| value.max(0) as i64)
        .unwrap_or(0)
}

fn build_playlist_track_page_order_clause(
    query: Option<&LibraryPlaylistTrackPageQueryInput>,
) -> &'static str {
    let sort_direction = query
        .and_then(|value| normalize_text(value.sort_direction.as_deref()))
        .map(|value| value.to_lowercase())
        .unwrap_or_else(|| "asc".to_string());
    let descending = sort_direction == "desc";

    match query
        .and_then(|value| normalize_text(value.sort_field.as_deref()))
        .map(|value| value.to_lowercase())
        .as_deref()
    {
        Some("title") if descending => {
            "LOWER(COALESCE(snapshot_title, '')) DESC, position ASC, created_at_ms ASC, id ASC"
        }
        Some("title") => {
            "LOWER(COALESCE(snapshot_title, '')) ASC, position ASC, created_at_ms ASC, id ASC"
        }
        Some("artist") if descending => {
            "LOWER(COALESCE(snapshot_artist, '')) DESC, position ASC, created_at_ms ASC, id ASC"
        }
        Some("artist") => {
            "LOWER(COALESCE(snapshot_artist, '')) ASC, position ASC, created_at_ms ASC, id ASC"
        }
        Some("album") if descending => {
            "LOWER(COALESCE(snapshot_album, '')) DESC, position ASC, created_at_ms ASC, id ASC"
        }
        Some("album") => {
            "LOWER(COALESCE(snapshot_album, '')) ASC, position ASC, created_at_ms ASC, id ASC"
        }
        Some("duration") if descending => {
            "COALESCE(snapshot_duration_seconds, 0) DESC, position ASC, created_at_ms ASC, id ASC"
        }
        Some("duration") => {
            "COALESCE(snapshot_duration_seconds, 0) ASC, position ASC, created_at_ms ASC, id ASC"
        }
        _ => "position ASC, created_at_ms ASC, id ASC",
    }
}

pub fn query_playlist_tracks_page(
    app: &AppHandle,
    query: Option<LibraryPlaylistTrackPageQueryInput>,
) -> Result<LibraryPlaylistTrackPageResult, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let query_ref = query.as_ref();
        let playlist_id = query_ref
            .and_then(|value| normalize_text(Some(value.playlist_id.as_str())))
            .unwrap_or_default();
        if playlist_id.is_empty() {
            return Ok(LibraryPlaylistTrackPageResult {
                items: Vec::new(),
                total: 0,
            });
        }

        let limit = normalize_playlist_track_page_limit(query_ref);
        let offset = normalize_playlist_track_page_offset(query_ref);
        let order_clause = build_playlist_track_page_order_clause(query_ref);
        let search_pattern = query_ref
            .and_then(|value| normalize_text(value.search_query.as_deref()))
            .map(|value| format!("%{}%", value.to_lowercase()));

        let count_sql_with_search = r#"
            SELECT COUNT(1)
            FROM playlist_items
            WHERE playlist_id = ?1
              AND (
                LOWER(COALESCE(snapshot_title, '')) LIKE ?2
                OR LOWER(COALESCE(snapshot_artist, '')) LIKE ?2
                OR LOWER(COALESCE(snapshot_album, '')) LIKE ?2
              )
        "#;
        let count_sql_without_search = r#"
            SELECT COUNT(1)
            FROM playlist_items
            WHERE playlist_id = ?1
        "#;

        let select_prefix = r#"
            SELECT
              id,
              playlist_id,
              position,
              local_track_id,
              entry_id,
              track_payload_json,
              snapshot_title,
              snapshot_artist,
              snapshot_album,
              snapshot_duration_seconds,
              created_at_ms
            FROM playlist_items
            WHERE playlist_id = ?1
        "#;

        let total = if let Some(search) = search_pattern.as_ref() {
            conn.query_row(count_sql_with_search, params![playlist_id, search], |row| {
                row.get::<_, i64>(0)
            })
            .map(|value| value.max(0) as u64)
            .map_err(|error| format!("Failed to count playlist tracks page rows: {error}"))?
        } else {
            conn.query_row(count_sql_without_search, params![playlist_id], |row| {
                row.get::<_, i64>(0)
            })
            .map(|value| value.max(0) as u64)
            .map_err(|error| format!("Failed to count playlist tracks page rows: {error}"))?
        };

        let sql = if search_pattern.is_some() {
            format!(
                r#"
                {select_prefix}
                  AND (
                    LOWER(COALESCE(snapshot_title, '')) LIKE ?2
                    OR LOWER(COALESCE(snapshot_artist, '')) LIKE ?2
                    OR LOWER(COALESCE(snapshot_album, '')) LIKE ?2
                  )
                ORDER BY {order_clause}
                LIMIT ?3
                OFFSET ?4
                "#
            )
        } else {
            format!(
                r#"
                {select_prefix}
                ORDER BY {order_clause}
                LIMIT ?2
                OFFSET ?3
                "#
            )
        };

        let mut stmt = conn.prepare(sql.as_str()).map_err(|error| {
            format!("Failed to prepare playlist tracks page statement: {error}")
        })?;

        let rows = if let Some(search) = search_pattern.as_ref() {
            stmt.query_map(
                params![playlist_id, search, limit, offset],
                parse_playlist_item_row,
            )
        } else {
            stmt.query_map(params![playlist_id, limit, offset], parse_playlist_item_row)
        }
        .map_err(|error| format!("Failed to query playlist tracks page rows: {error}"))?;

        let mut items = Vec::new();
        for row in rows {
            items.push(
                row.map_err(|error| format!("Failed to parse playlist tracks page row: {error}"))?,
            );
        }

        Ok(LibraryPlaylistTrackPageResult { items, total })
    })
}

pub fn upsert_fallback_task(
    app: &AppHandle,
    input: LibraryFallbackTaskUpsertInput,
) -> Result<LibraryFallbackTaskRecord, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let owner_uid = normalize_owner_uid(Some(input.owner_uid.as_str()))
            .ok_or_else(|| "Fallback task ownerUid is required".to_string())?;
        let entry_id = normalize_text(Some(input.entry_id.as_str()))
            .ok_or_else(|| "Fallback task entryId is required".to_string())?;
        let track_id = normalize_text(input.track_id.as_deref());
        let quick_fingerprint = normalize_quick_fingerprint(input.quick_fingerprint.as_deref());
        let cloud_content_id = normalize_text(input.cloud_content_id.as_deref());
        let reason = normalize_fallback_reason(input.reason.as_deref());

        let task_id = normalize_text(input.id.as_deref()).unwrap_or_else(|| {
            build_fallback_task_id(
                owner_uid.as_str(),
                entry_id.as_str(),
                track_id.as_deref(),
                quick_fingerprint.as_deref(),
                cloud_content_id.as_deref(),
            )
        });

        if task_id.is_empty() {
            return Err("Fallback task id is required".to_string());
        }

        let now = now_ms();
        let requested_at_ms = input.requested_at_ms.unwrap_or(now).max(0);

        conn.execute(
            r#"
            INSERT INTO fallback_tasks(
              id,
              owner_uid,
              entry_id,
              cloud_content_id,
              track_id,
              quick_fingerprint,
              reason,
              status,
              enqueue_count,
              requested_at_ms,
              last_requested_at_ms,
              updated_at_ms,
              last_error
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'queued', 1, ?8, ?8, ?9, NULL)
            ON CONFLICT(id) DO UPDATE SET
              owner_uid = excluded.owner_uid,
              entry_id = excluded.entry_id,
              cloud_content_id = COALESCE(excluded.cloud_content_id, fallback_tasks.cloud_content_id),
              track_id = COALESCE(excluded.track_id, fallback_tasks.track_id),
              quick_fingerprint = COALESCE(excluded.quick_fingerprint, fallback_tasks.quick_fingerprint),
              reason = excluded.reason,
              status = 'queued',
              enqueue_count = COALESCE(fallback_tasks.enqueue_count, 0) + 1,
              last_requested_at_ms = excluded.last_requested_at_ms,
              updated_at_ms = excluded.updated_at_ms,
              last_error = NULL
            "#,
            params![
                task_id,
                owner_uid,
                entry_id,
                cloud_content_id,
                track_id,
                quick_fingerprint,
                reason,
                requested_at_ms,
                now,
            ],
        )
        .map_err(|error| format!("Failed to upsert fallback task: {error}"))?;

        fallback_task_record_by_id(conn, task_id.as_str())
    })
}

pub fn list_fallback_tasks(
    app: &AppHandle,
    query: Option<LibraryFallbackTaskQueryInput>,
) -> Result<Vec<LibraryFallbackTaskRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_limit = normalize_limit(query.as_ref().and_then(|item| item.limit));
        let normalized_offset = normalize_offset(query.as_ref().and_then(|item| item.offset));
        let normalized_owner_uid = query
            .as_ref()
            .and_then(|item| item.owner_uid.as_ref())
            .and_then(|value| normalize_owner_uid(Some(value.as_str())));
        let owner_uid_enabled_flag = if normalized_owner_uid.is_some() {
            1_i64
        } else {
            0_i64
        };
        let owner_uid_exact_value = normalized_owner_uid.unwrap_or_default();
        let normalized_status = query
            .as_ref()
            .and_then(|item| item.status.as_ref())
            .map(|value| normalize_fallback_status(Some(value.as_str())));
        let status_enabled_flag = if normalized_status.is_some() {
            1_i64
        } else {
            0_i64
        };
        let status_exact_value = normalized_status.unwrap_or_default();

        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  id,
                  owner_uid,
                  entry_id,
                  cloud_content_id,
                  track_id,
                  quick_fingerprint,
                  reason,
                  status,
                  enqueue_count,
                  requested_at_ms,
                  last_requested_at_ms,
                  updated_at_ms,
                  last_error
                FROM fallback_tasks
                WHERE (?1 = 0 OR owner_uid = ?2)
                  AND (?3 = 0 OR status = ?4)
                ORDER BY last_requested_at_ms DESC, updated_at_ms DESC, id ASC
                LIMIT ?5
                OFFSET ?6
                "#,
            )
            .map_err(|error| format!("Failed to prepare fallback task query statement: {error}"))?;

        let rows = stmt
            .query_map(
                params![
                    owner_uid_enabled_flag,
                    owner_uid_exact_value,
                    status_enabled_flag,
                    status_exact_value,
                    normalized_limit,
                    normalized_offset,
                ],
                |row| {
                    Ok(LibraryFallbackTaskRecord {
                        id: row.get(0)?,
                        owner_uid: row.get(1)?,
                        entry_id: row.get(2)?,
                        cloud_content_id: row.get(3)?,
                        track_id: row.get(4)?,
                        quick_fingerprint: row.get(5)?,
                        reason: row.get(6)?,
                        status: row.get(7)?,
                        enqueue_count: row.get::<_, i64>(8)?.max(0) as u64,
                        requested_at_ms: row.get(9)?,
                        last_requested_at_ms: row.get(10)?,
                        updated_at_ms: row.get(11)?,
                        last_error: row.get(12)?,
                    })
                },
            )
            .map_err(|error| format!("Failed to query fallback task rows: {error}"))?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|error| format!("Failed to parse fallback task row: {error}"))?);
        }
        Ok(items)
    })
}

pub fn update_fallback_task_status(
    app: &AppHandle,
    task_id: &str,
    status: &str,
    last_error: Option<String>,
) -> Result<bool, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_task_id = task_id.trim();
        if normalized_task_id.is_empty() {
            return Ok(false);
        }
        let normalized_status = normalize_fallback_status(Some(status));
        let now = now_ms();

        let affected = conn
            .execute(
                r#"
                UPDATE fallback_tasks
                SET
                  status = ?2,
                  last_error = ?3,
                  updated_at_ms = ?4
                WHERE id = ?1
                "#,
                params![
                    normalized_task_id,
                    normalized_status,
                    normalize_text(last_error.as_deref()),
                    now
                ],
            )
            .map_err(|error| format!("Failed to update fallback task status: {error}"))?;
        Ok(affected > 0)
    })
}

pub fn upsert_cloud_hash_job(
    app: &AppHandle,
    input: LibraryCloudHashJobUpsertInput,
) -> Result<LibraryCloudHashJobRecord, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let owner_uid = normalize_owner_uid(Some(input.owner_uid.as_str()))
            .ok_or_else(|| "Cloud hash job ownerUid is required".to_string())?;
        let entry_id = normalize_text(Some(input.entry_id.as_str()))
            .ok_or_else(|| "Cloud hash job entryId is required".to_string())?;
        let track_id = normalize_text(input.track_id.as_deref());
        let quick_fingerprint = normalize_quick_fingerprint(input.quick_fingerprint.as_deref());
        let status = normalize_cloud_hash_job_status(input.status.as_deref());
        let cloud_full_hash = normalize_text(input.cloud_full_hash.as_deref());
        let last_error = normalize_text(input.last_error.as_deref());

        let job_id = normalize_text(input.id.as_deref()).unwrap_or_else(|| {
            build_cloud_hash_job_id(owner_uid.as_str(), entry_id.as_str(), track_id.as_deref())
        });
        if job_id.is_empty() {
            return Err("Cloud hash job id is required".to_string());
        }

        let now = now_ms();
        let requested_at_ms = input.requested_at_ms.unwrap_or(now).max(0);

        conn.execute(
            r#"
            INSERT INTO cloud_hash_jobs(
              id,
              owner_uid,
              entry_id,
              track_id,
              quick_fingerprint,
              status,
              cloud_full_hash,
              last_error,
              attempt_count,
              requested_at_ms,
              updated_at_ms
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?10)
            ON CONFLICT(id) DO UPDATE SET
              owner_uid = excluded.owner_uid,
              entry_id = excluded.entry_id,
              track_id = COALESCE(excluded.track_id, cloud_hash_jobs.track_id),
              quick_fingerprint = COALESCE(excluded.quick_fingerprint, cloud_hash_jobs.quick_fingerprint),
              status = excluded.status,
              cloud_full_hash = COALESCE(excluded.cloud_full_hash, cloud_hash_jobs.cloud_full_hash),
              last_error = excluded.last_error,
              attempt_count = CASE
                WHEN excluded.status = 'pending' OR excluded.status = 'running'
                  THEN COALESCE(cloud_hash_jobs.attempt_count, 0) + 1
                ELSE COALESCE(cloud_hash_jobs.attempt_count, 0)
              END,
              requested_at_ms = CASE
                WHEN cloud_hash_jobs.requested_at_ms <= excluded.requested_at_ms
                  THEN cloud_hash_jobs.requested_at_ms
                ELSE excluded.requested_at_ms
              END,
              updated_at_ms = excluded.updated_at_ms
            "#,
            params![
                job_id,
                owner_uid,
                entry_id,
                track_id,
                quick_fingerprint,
                status,
                cloud_full_hash,
                last_error,
                requested_at_ms,
                now,
            ],
        )
        .map_err(|error| format!("Failed to upsert cloud hash job: {error}"))?;

        cloud_hash_job_record_by_id(conn, job_id.as_str())
    })
}

pub fn list_cloud_hash_jobs(
    app: &AppHandle,
    query: Option<LibraryCloudHashJobQueryInput>,
) -> Result<Vec<LibraryCloudHashJobRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_limit = normalize_limit(query.as_ref().and_then(|item| item.limit));
        let normalized_offset = normalize_offset(query.as_ref().and_then(|item| item.offset));
        let normalized_owner_uid = query
            .as_ref()
            .and_then(|item| item.owner_uid.as_ref())
            .and_then(|value| normalize_owner_uid(Some(value.as_str())));
        let owner_uid_enabled_flag = if normalized_owner_uid.is_some() {
            1_i64
        } else {
            0_i64
        };
        let owner_uid_exact_value = normalized_owner_uid.unwrap_or_default();
        let normalized_status = query
            .as_ref()
            .and_then(|item| item.status.as_ref())
            .map(|value| normalize_cloud_hash_job_status(Some(value.as_str())));
        let status_enabled_flag = if normalized_status.is_some() {
            1_i64
        } else {
            0_i64
        };
        let status_exact_value = normalized_status.unwrap_or_default();

        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  id,
                  owner_uid,
                  entry_id,
                  track_id,
                  quick_fingerprint,
                  status,
                  cloud_full_hash,
                  last_error,
                  attempt_count,
                  requested_at_ms,
                  updated_at_ms
                FROM cloud_hash_jobs
                WHERE (?1 = 0 OR owner_uid = ?2)
                  AND (?3 = 0 OR status = ?4)
                ORDER BY updated_at_ms DESC, requested_at_ms DESC, id ASC
                LIMIT ?5
                OFFSET ?6
                "#,
            )
            .map_err(|error| {
                format!("Failed to prepare cloud hash job query statement: {error}")
            })?;

        let rows = stmt
            .query_map(
                params![
                    owner_uid_enabled_flag,
                    owner_uid_exact_value,
                    status_enabled_flag,
                    status_exact_value,
                    normalized_limit,
                    normalized_offset,
                ],
                |row| {
                    Ok(LibraryCloudHashJobRecord {
                        id: row.get(0)?,
                        owner_uid: row.get(1)?,
                        entry_id: row.get(2)?,
                        track_id: row.get(3)?,
                        quick_fingerprint: row.get(4)?,
                        status: row.get(5)?,
                        cloud_full_hash: row.get(6)?,
                        last_error: row.get(7)?,
                        attempt_count: row.get::<_, i64>(8)?.max(0) as u64,
                        requested_at_ms: row.get(9)?,
                        updated_at_ms: row.get(10)?,
                    })
                },
            )
            .map_err(|error| format!("Failed to query cloud hash job rows: {error}"))?;

        let mut items = Vec::new();
        for row in rows {
            items
                .push(row.map_err(|error| format!("Failed to parse cloud hash job row: {error}"))?);
        }
        Ok(items)
    })
}

pub fn update_cloud_hash_job_status(
    app: &AppHandle,
    job_id: &str,
    status: &str,
    cloud_full_hash: Option<String>,
    last_error: Option<String>,
) -> Result<bool, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_job_id = job_id.trim();
        if normalized_job_id.is_empty() {
            return Ok(false);
        }
        let normalized_status = normalize_cloud_hash_job_status(Some(status));
        let now = now_ms();

        let affected = conn
            .execute(
                r#"
                UPDATE cloud_hash_jobs
                SET
                  status = ?2,
                  cloud_full_hash = COALESCE(?3, cloud_full_hash),
                  last_error = ?4,
                  updated_at_ms = ?5
                WHERE id = ?1
                "#,
                params![
                    normalized_job_id,
                    normalized_status,
                    normalize_text(cloud_full_hash.as_deref()),
                    normalize_text(last_error.as_deref()),
                    now,
                ],
            )
            .map_err(|error| format!("Failed to update cloud hash job status: {error}"))?;
        Ok(affected > 0)
    })
}

pub fn list_source_health(
    app: &AppHandle,
    query: Option<LibrarySourceHealthQueryInput>,
) -> Result<Vec<LibrarySourceHealthRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let normalized_source_id = query
            .as_ref()
            .and_then(|item| item.source_id.as_ref())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_default();
        let source_filter_enabled = if normalized_source_id.is_empty() {
            0_i64
        } else {
            1_i64
        };

        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  s.id AS source_id,
                  s.path AS source_path,
                  s.display_name AS source_display_name,
                  COUNT(t.id) AS total_tracks,
                  SUM(CASE WHEN t.status = 'available' THEN 1 ELSE 0 END) AS available_tracks,
                  SUM(CASE WHEN t.status = 'missing' THEN 1 ELSE 0 END) AS missing_tracks,
                  COUNT(DISTINCT CASE
                    WHEN TRIM(COALESCE(t.artist, '')) <> '' THEN LOWER(TRIM(t.artist))
                    ELSE NULL
                  END) AS total_artists,
                  COUNT(DISTINCT CASE
                    WHEN TRIM(COALESCE(t.album, '')) <> '' THEN LOWER(TRIM(t.album))
                    ELSE NULL
                  END) AS total_albums,
                  COALESCE(SUM(COALESCE(t.file_size, 0)), 0) AS total_size,
                  s.updated_at_ms AS source_updated_at_ms,
                  MAX(t.updated_at_ms) AS last_track_updated_at_ms
                FROM sources s
                LEFT JOIN local_tracks t ON t.source_id = s.id
                WHERE (?1 = 0 OR s.id = ?2)
                GROUP BY s.id
                ORDER BY s.updated_at_ms DESC, s.id ASC
                "#,
            )
            .map_err(|error| format!("Failed to prepare source health statement: {error}"))?;

        let rows = stmt
            .query_map(
                params![source_filter_enabled, normalized_source_id],
                |row| {
                    Ok(LibrarySourceHealthRecord {
                        source_id: row.get(0)?,
                        source_path: row.get(1)?,
                        source_display_name: row.get(2)?,
                        total_tracks: row.get::<_, i64>(3)?.max(0) as u64,
                        available_tracks: row.get::<_, i64>(4)?.max(0) as u64,
                        missing_tracks: row.get::<_, i64>(5)?.max(0) as u64,
                        total_artists: row.get::<_, i64>(6)?.max(0) as u64,
                        total_albums: row.get::<_, i64>(7)?.max(0) as u64,
                        total_size: row.get::<_, i64>(8)?.max(0) as u64,
                        source_updated_at_ms: row.get(9)?,
                        last_track_updated_at_ms: row.get(10)?,
                    })
                },
            )
            .map_err(|error| format!("Failed to query source health: {error}"))?;

        let mut result = Vec::new();
        for row in rows {
            result
                .push(row.map_err(|error| format!("Failed to parse source health row: {error}"))?);
        }

        Ok(result)
    })
}

pub fn cleanup_source_tracks(
    app: &AppHandle,
    source_id: &str,
    missing_only: bool,
) -> Result<u64, String> {
    ensure_initialized(app)?;
    let normalized_source_id = source_id.trim();
    if normalized_source_id.is_empty() {
        return Err("Source id is required".to_string());
    }

    with_conn(|conn| {
        let _ = source_record_by_id(conn, normalized_source_id)?;
        let now = now_ms();

        let tx = conn
            .transaction()
            .map_err(|error| format!("Failed to start source cleanup transaction: {error}"))?;

        let deleted = if missing_only {
            tx.execute(
                "DELETE FROM local_tracks WHERE source_id = ?1 AND status = 'missing'",
                params![normalized_source_id],
            )
            .map_err(|error| format!("Failed to cleanup missing source tracks: {error}"))?
        } else {
            tx.execute(
                "DELETE FROM local_tracks WHERE source_id = ?1",
                params![normalized_source_id],
            )
            .map_err(|error| format!("Failed to cleanup source tracks: {error}"))?
        };

        tx.execute(
            "UPDATE sources SET updated_at_ms = ?2 WHERE id = ?1",
            params![normalized_source_id, now],
        )
        .map_err(|error| format!("Failed to update source cleanup timestamp: {error}"))?;

        tx.commit()
            .map_err(|error| format!("Failed to commit source cleanup transaction: {error}"))?;

        invalidate_track_query_count_cache();

        Ok(deleted as u64)
    })
}

fn normalize_logic_operator(raw: Option<&String>, default_value: &'static str) -> &'static str {
    match raw {
        Some(value) if value.trim().eq_ignore_ascii_case("or") => "OR",
        Some(value) if value.trim().eq_ignore_ascii_case("and") => "AND",
        _ => default_value,
    }
}

#[derive(Debug, Clone)]
struct LocalTrackFieldDescriptor {
    field_id: String,
    label: String,
    kind: String,
    track_key: String,
    column_name: String,
    declared_type: String,
    nullable: bool,
    filterable: bool,
    sortable: bool,
    groupable: bool,
    native_filter_field: Option<String>,
    native_sort_field: Option<String>,
}

fn normalize_track_field_token(raw: &str) -> String {
    raw.chars()
        .filter(|char| char.is_ascii_alphanumeric())
        .map(|char| char.to_ascii_lowercase())
        .collect()
}

fn quote_sqlite_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn camel_case_identifier(raw: &str) -> String {
    let mut result = String::new();
    let mut uppercase_next = false;

    for char in raw.chars() {
        if !char.is_ascii_alphanumeric() {
            uppercase_next = true;
            continue;
        }

        if result.is_empty() {
            result.push(char.to_ascii_lowercase());
            uppercase_next = false;
            continue;
        }

        if uppercase_next {
            result.push(char.to_ascii_uppercase());
            uppercase_next = false;
        } else {
            result.push(char.to_ascii_lowercase());
        }
    }

    result
}

fn humanize_identifier(raw: &str) -> String {
    raw.replace('_', " ")
        .split_whitespace()
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_numeric_declared_type(declared_type: &str) -> bool {
    let normalized = declared_type.trim().to_ascii_uppercase();
    normalized.contains("INT")
        || normalized.contains("REAL")
        || normalized.contains("FLOA")
        || normalized.contains("DOUB")
        || normalized.contains("NUM")
        || normalized.contains("DEC")
        || normalized.contains("BOOL")
}

fn local_track_field_alias(column_name: &str) -> (String, String, Option<String>, Option<String>) {
    match column_name {
        "duration_seconds" => (
            "duration".to_string(),
            "duration".to_string(),
            Some("durationSeconds".to_string()),
            Some("durationSeconds".to_string()),
        ),
        "sample_rate" => (
            "sampleRate".to_string(),
            "sampleRate".to_string(),
            None,
            Some("sampleRate".to_string()),
        ),
        "file_size" => (
            "fileSize".to_string(),
            "fileSize".to_string(),
            None,
            Some("fileSize".to_string()),
        ),
        "play_count" => (
            "playCount".to_string(),
            "playCount".to_string(),
            Some("playCount".to_string()),
            Some("playCount".to_string()),
        ),
        "last_played_at_ms" => (
            "lastPlayed".to_string(),
            "lastPlayed".to_string(),
            None,
            Some("lastPlayedAtMs".to_string()),
        ),
        "created_at_ms" => (
            "dateAdded".to_string(),
            "createdAtMs".to_string(),
            Some("createdAtMs".to_string()),
            Some("createdAtMs".to_string()),
        ),
        "updated_at_ms" => (
            "updatedAtMs".to_string(),
            "updatedAtMs".to_string(),
            Some("updatedAtMs".to_string()),
            Some("updatedAtMs".to_string()),
        ),
        "last_seen_at_ms" => (
            "lastSeenAtMs".to_string(),
            "lastSeenAtMs".to_string(),
            Some("lastSeenAtMs".to_string()),
            Some("lastSeenAtMs".to_string()),
        ),
        "source_id" => (
            "libraryPathId".to_string(),
            "libraryPathId".to_string(),
            Some("sourceId".to_string()),
            Some("sourceId".to_string()),
        ),
        "file_path" => (
            "filePath".to_string(),
            "filePath".to_string(),
            Some("filePath".to_string()),
            Some("filePath".to_string()),
        ),
        "quick_fingerprint" => (
            "quickFingerprint".to_string(),
            "quickFingerprint".to_string(),
            Some("quickFingerprint".to_string()),
            Some("quickFingerprint".to_string()),
        ),
        "mtime_ms" => (
            "mtimeMs".to_string(),
            "mtimeMs".to_string(),
            Some("mtimeMs".to_string()),
            Some("mtimeMs".to_string()),
        ),
        "bit_depth" => (
            "bitDepth".to_string(),
            "bitDepth".to_string(),
            Some("bitDepth".to_string()),
            Some("bitDepth".to_string()),
        ),
        "replay_gain_track_db" => (
            "replayGainTrackGainDb".to_string(),
            "replayGainTrackGainDb".to_string(),
            Some("replayGainTrackGainDb".to_string()),
            Some("replayGainTrackGainDb".to_string()),
        ),
        "replay_gain_album_db" => (
            "replayGainAlbumGainDb".to_string(),
            "replayGainAlbumGainDb".to_string(),
            Some("replayGainAlbumGainDb".to_string()),
            Some("replayGainAlbumGainDb".to_string()),
        ),
        _ => {
            let field_id = camel_case_identifier(column_name);
            let native_field = if field_id.is_empty() {
                None
            } else {
                Some(field_id.clone())
            };
            (
                field_id.clone(),
                field_id,
                native_field.clone(),
                native_field,
            )
        }
    }
}

fn list_local_track_field_descriptors(
    conn: &Connection,
) -> Result<Vec<LocalTrackFieldDescriptor>, String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(local_tracks)")
        .map_err(|error| format!("Failed to prepare local_tracks field catalog pragma: {error}"))?;

    let rows = stmt
        .query_map([], |row| {
            let column_name: String = row.get(1)?;
            let declared_type: Option<String> = row.get(2)?;
            let not_null: i64 = row.get(3)?;

            let (field_id, track_key, native_filter_field, native_sort_field) =
                local_track_field_alias(column_name.as_str());

            let normalized_declared_type = declared_type.unwrap_or_default();
            let kind = if is_numeric_declared_type(normalized_declared_type.as_str()) {
                "number".to_string()
            } else {
                "text".to_string()
            };

            Ok(LocalTrackFieldDescriptor {
                field_id: if field_id.is_empty() {
                    column_name.clone()
                } else {
                    field_id
                },
                label: humanize_identifier(column_name.as_str()),
                kind,
                track_key: if track_key.is_empty() {
                    column_name.clone()
                } else {
                    track_key
                },
                column_name,
                declared_type: normalized_declared_type,
                nullable: not_null == 0,
                filterable: true,
                sortable: true,
                groupable: true,
                native_filter_field,
                native_sort_field,
            })
        })
        .map_err(|error| format!("Failed to inspect local_tracks field catalog: {error}"))?;

    let mut items = Vec::new();
    for row in rows {
        items.push(
            row.map_err(|error| {
                format!("Failed to parse local_tracks field catalog row: {error}")
            })?,
        );
    }
    Ok(items)
}

fn resolve_local_track_field_descriptor<'a>(
    descriptors: &'a [LocalTrackFieldDescriptor],
    raw_field: &str,
) -> Option<&'a LocalTrackFieldDescriptor> {
    let normalized = normalize_track_field_token(raw_field);
    if normalized.is_empty() {
        return None;
    }

    descriptors.iter().find(|descriptor| {
        normalized == normalize_track_field_token(descriptor.field_id.as_str())
            || normalized == normalize_track_field_token(descriptor.track_key.as_str())
            || normalized == normalize_track_field_token(descriptor.column_name.as_str())
            || descriptor
                .native_filter_field
                .as_ref()
                .map(|field| normalized == normalize_track_field_token(field.as_str()))
                .unwrap_or(false)
            || descriptor
                .native_sort_field
                .as_ref()
                .map(|field| normalized == normalize_track_field_token(field.as_str()))
                .unwrap_or(false)
    })
}

fn build_text_filter_expression(column_name: &str) -> String {
    let column = quote_sqlite_identifier(column_name);
    format!("LOWER(TRIM(COALESCE(t.{column}, '')))")
}

fn build_numeric_filter_expression(column_name: &str) -> String {
    let column = quote_sqlite_identifier(column_name);
    format!("CAST(t.{column} AS REAL)")
}

fn build_order_expression(descriptor: &LocalTrackFieldDescriptor) -> String {
    let column = quote_sqlite_identifier(descriptor.column_name.as_str());
    if descriptor.kind == "number" {
        return format!("COALESCE(CAST(t.{column} AS REAL), 0)");
    }

    if descriptor.column_name == "title" {
        return format!("LOWER(COALESCE(t.{column}, t.\"file_path\"))");
    }

    format!("LOWER(COALESCE(CAST(t.{column} AS TEXT), ''))")
}

fn sqlite_value_ref_to_json(value: ValueRef<'_>) -> JsonValue {
    match value {
        ValueRef::Null => JsonValue::Null,
        ValueRef::Integer(value) => JsonValue::from(value),
        ValueRef::Real(value) => JsonValue::from(value),
        ValueRef::Text(value) => JsonValue::from(String::from_utf8_lossy(value).to_string()),
        ValueRef::Blob(_) => JsonValue::Null,
    }
}

fn build_track_filter_clause(
    filter: &LibraryTrackFilterInput,
    descriptors: &[LocalTrackFieldDescriptor],
) -> Option<(String, Vec<Value>)> {
    let descriptor = resolve_local_track_field_descriptor(descriptors, filter.field.as_str())?;
    let operator = filter.operator.trim().to_ascii_lowercase();
    let value_text = filter
        .value
        .as_ref()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty());

    let text_expr = if descriptor.kind == "text" {
        Some(build_text_filter_expression(
            descriptor.column_name.as_str(),
        ))
    } else {
        None
    };
    let numeric_expr = if descriptor.kind == "number" {
        Some(build_numeric_filter_expression(
            descriptor.column_name.as_str(),
        ))
    } else {
        None
    };

    match operator.as_str() {
        "contains" => {
            if let (Some(expr), Some(value)) = (text_expr, value_text.as_ref()) {
                return Some((
                    format!("{expr} LIKE ?"),
                    vec![Value::Text(format!("%{}%", value.to_ascii_lowercase()))],
                ));
            }
        }
        "equals" => {
            if let Some(expr) = text_expr {
                if let Some(value) = value_text.as_ref() {
                    return Some((
                        format!("{expr} = ?"),
                        vec![Value::Text(value.to_ascii_lowercase())],
                    ));
                }
            } else if let Some(expr) = numeric_expr {
                if let Some(value) = value_text
                    .as_ref()
                    .and_then(|item| item.parse::<f64>().ok())
                {
                    return Some((format!("{expr} = ?"), vec![Value::Real(value)]));
                }
            }
        }
        "not_equals" => {
            if let Some(expr) = text_expr {
                if let Some(value) = value_text.as_ref() {
                    return Some((
                        format!("{expr} <> ?"),
                        vec![Value::Text(value.to_ascii_lowercase())],
                    ));
                }
            } else if let Some(expr) = numeric_expr {
                if let Some(value) = value_text
                    .as_ref()
                    .and_then(|item| item.parse::<f64>().ok())
                {
                    return Some((format!("{expr} <> ?"), vec![Value::Real(value)]));
                }
            }
        }
        "gte" => {
            if let Some(expr) = numeric_expr {
                if let Some(value) = value_text
                    .as_ref()
                    .and_then(|item| item.parse::<f64>().ok())
                {
                    return Some((
                        format!("{expr} IS NOT NULL AND {expr} >= ?"),
                        vec![Value::Real(value)],
                    ));
                }
            }
        }
        "lte" => {
            if let Some(expr) = numeric_expr {
                if let Some(value) = value_text
                    .as_ref()
                    .and_then(|item| item.parse::<f64>().ok())
                {
                    return Some((
                        format!("{expr} IS NOT NULL AND {expr} <= ?"),
                        vec![Value::Real(value)],
                    ));
                }
            }
        }
        "is_empty" => {
            if let Some(expr) = text_expr {
                return Some((format!("{expr} = ''"), vec![]));
            }
            if let Some(expr) = numeric_expr {
                return Some((format!("{expr} IS NULL"), vec![]));
            }
        }
        "is_not_empty" => {
            if let Some(expr) = text_expr {
                return Some((format!("{expr} <> ''"), vec![]));
            }
            if let Some(expr) = numeric_expr {
                return Some((format!("{expr} IS NOT NULL"), vec![]));
            }
        }
        _ => {}
    }

    None
}

struct TrackQuerySqlParts {
    from_where_sql: String,
    bind_values: Vec<Value>,
    order_clauses: Vec<String>,
}

fn resolve_track_query_limit(query_ref: Option<&LibraryTrackQueryInput>) -> i64 {
    query_ref
        .and_then(|item| item.limit)
        .map(|value| value.clamp(1, 2000) as i64)
        .unwrap_or(i64::MAX)
}

fn resolve_track_query_offset(query_ref: Option<&LibraryTrackQueryInput>) -> i64 {
    query_ref
        .and_then(|item| item.offset)
        .map(|value| value as i64)
        .unwrap_or(0)
}

fn uses_list_track_projection(query_ref: Option<&LibraryTrackQueryInput>) -> bool {
    query_ref
        .and_then(|item| item.projection.as_ref())
        .map(|value| value.trim().eq_ignore_ascii_case("list"))
        .unwrap_or(false)
}

fn track_query_select_clause(use_list_projection: bool) -> &'static str {
    if use_list_projection {
        r#"
                SELECT
                  t.id,
                  t.source_id,
                  t.file_path,
                  t.quick_fingerprint,
                  t.title,
                  t.artist,
                  t.album,
                  t.genre,
                  t.year,
                  t.format,
                  t.duration_seconds,
                  t.sample_rate,
                  t.bit_depth,
                  t.file_size,
                  t.mtime_ms,
                  t.replay_gain_track_db,
                  t.replay_gain_album_db,
                  t.play_count,
                  t.last_played_at_ms,
                  t.status,
                  t.created_at_ms,
                  t.updated_at_ms,
                  t.last_seen_at_ms
            "#
    } else {
        r#"
                SELECT
                  t.*
            "#
    }
}

fn build_track_query_sql(
    query_ref: Option<&LibraryTrackQueryInput>,
    track_field_descriptors: &[LocalTrackFieldDescriptor],
) -> TrackQuerySqlParts {
    let include_missing = query_ref
        .and_then(|item| item.include_missing)
        .unwrap_or(false);
    let visible_only = query_ref.and_then(|item| item.visible_only).unwrap_or(true);

    let normalize_lower = |value: Option<&String>| -> Option<String> {
        value
            .map(|item| item.trim().to_ascii_lowercase())
            .filter(|item| !item.is_empty())
    };
    let normalize_trimmed = |value: Option<&String>| -> Option<String> {
        value
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
    };

    let normalized_search_query =
        normalize_lower(query_ref.and_then(|item| item.search_query.as_ref()));
    let normalized_artist = normalize_lower(query_ref.and_then(|item| item.artist.as_ref()));
    let normalized_album = normalize_lower(query_ref.and_then(|item| item.album.as_ref()));
    let normalized_track_id = normalize_trimmed(query_ref.and_then(|item| item.track_id.as_ref()));
    let normalized_source_id =
        normalize_trimmed(query_ref.and_then(|item| item.source_id.as_ref()));
    let normalized_quick_fingerprint = query_ref
        .and_then(|item| item.quick_fingerprint.as_ref())
        .and_then(|value| normalize_quick_fingerprint(Some(value.as_str())));
    let normalized_file_path =
        normalize_trimmed(query_ref.and_then(|item| item.file_path.as_ref()));

    let mut sql = String::from(
        r#"
                FROM local_tracks t
                JOIN sources s ON s.id = t.source_id
                WHERE 1 = 1
            "#,
    );
    let mut bind_values: Vec<Value> = Vec::new();

    if visible_only {
        sql.push_str("\n AND s.is_visible = 1");
    }

    if !include_missing {
        sql.push_str("\n AND t.status = 'available'");
    }

    if let Some(search_query) = normalized_search_query {
        let like_pattern = format!("%{search_query}%");
        sql.push_str(
            "\n AND (\n\
                 LOWER(COALESCE(t.title, '')) LIKE ?\n\
                 OR LOWER(COALESCE(t.artist, '')) LIKE ?\n\
                 OR LOWER(COALESCE(t.album, '')) LIKE ?\n\
                 OR LOWER(t.file_path) LIKE ?\n\
                )",
        );
        bind_values.push(Value::Text(like_pattern.clone()));
        bind_values.push(Value::Text(like_pattern.clone()));
        bind_values.push(Value::Text(like_pattern.clone()));
        bind_values.push(Value::Text(like_pattern));
    }

    if let Some(artist) = normalized_artist {
        sql.push_str("\n AND LOWER(TRIM(COALESCE(t.artist, ''))) = ?");
        bind_values.push(Value::Text(artist));
    }

    if let Some(album) = normalized_album {
        sql.push_str("\n AND LOWER(TRIM(COALESCE(t.album, ''))) = ?");
        bind_values.push(Value::Text(album));
    }

    if let Some(track_id) = normalized_track_id {
        sql.push_str("\n AND t.id = ?");
        bind_values.push(Value::Text(track_id));
    }

    if let Some(source_id) = normalized_source_id {
        sql.push_str("\n AND t.source_id = ?");
        bind_values.push(Value::Text(source_id));
    }

    if let Some(quick_fingerprint) = normalized_quick_fingerprint {
        sql.push_str("\n AND t.quick_fingerprint = ?");
        bind_values.push(Value::Text(quick_fingerprint));
    }

    if let Some(file_path) = normalized_file_path {
        sql.push_str("\n AND t.file_path = ?");
        bind_values.push(Value::Text(file_path));
    }

    let base_query_ref = query_ref.and_then(|item| item.base_query.as_ref());

    let mut has_applied_group_filters = false;
    if let Some(filter_groups) = base_query_ref.and_then(|base| base.filter_groups.as_ref()) {
        let groups_joiner = normalize_logic_operator(
            base_query_ref.and_then(|base| base.filter_operator.as_ref()),
            "AND",
        );

        let mut rendered_group_clauses: Vec<String> = Vec::new();
        let mut rendered_group_bind_values: Vec<Value> = Vec::new();

        for group in filter_groups.iter().take(8) {
            let filters = match group.filters.as_ref() {
                Some(items) => items,
                None => continue,
            };
            let group_joiner = normalize_logic_operator(group.operator.as_ref(), "AND");

            let mut rendered_filter_clauses: Vec<String> = Vec::new();
            let mut rendered_filter_bind_values: Vec<Value> = Vec::new();

            for filter in filters.iter().take(20) {
                if let Some((clause, values)) =
                    build_track_filter_clause(filter, track_field_descriptors)
                {
                    rendered_filter_clauses.push(clause);
                    rendered_filter_bind_values.extend(values);
                }
            }

            if rendered_filter_clauses.is_empty() {
                continue;
            }

            rendered_group_clauses.push(format!(
                "({})",
                rendered_filter_clauses.join(&format!(" {group_joiner} "))
            ));
            rendered_group_bind_values.extend(rendered_filter_bind_values);
        }

        if !rendered_group_clauses.is_empty() {
            sql.push_str("\n AND (");
            sql.push_str(&rendered_group_clauses.join(&format!(" {groups_joiner} ")));
            sql.push(')');
            bind_values.extend(rendered_group_bind_values);
            has_applied_group_filters = true;
        }
    }

    if !has_applied_group_filters {
        let filter_inputs = base_query_ref
            .and_then(|base| base.filters.as_ref())
            .or_else(|| query_ref.and_then(|item| item.filters.as_ref()));

        if let Some(filters) = filter_inputs {
            for filter in filters.iter().take(20) {
                if let Some((clause, values)) =
                    build_track_filter_clause(filter, track_field_descriptors)
                {
                    sql.push_str("\n AND ");
                    sql.push_str(&clause);
                    bind_values.extend(values);
                }
            }
        }
    }

    let mut order_clauses: Vec<String> = Vec::new();
    let mut order_fields: Vec<String> = Vec::new();

    let mut push_order_input = |field_raw: &str, order_raw: Option<&String>| {
        let field = normalize_track_field_token(field_raw);
        if field.is_empty() {
            return;
        }

        if order_fields.iter().any(|item| item == &field) {
            return;
        }

        let maybe_expr = resolve_local_track_field_descriptor(track_field_descriptors, field_raw)
            .map(build_order_expression);

        if let Some(expr) = maybe_expr {
            let direction = match order_raw {
                Some(order) if order.trim().eq_ignore_ascii_case("desc") => "DESC",
                _ => "ASC",
            };

            order_fields.push(field);
            order_clauses.push(format!("{expr} {direction}"));
        }
    };

    let group_inputs = query_ref
        .and_then(|item| item.base_query.as_ref())
        .and_then(|base| base.group_by.as_ref())
        .or_else(|| query_ref.and_then(|item| item.group_by.as_ref()));

    if let Some(groups) = group_inputs {
        for group in groups.iter().take(4) {
            push_order_input(group.field.as_str(), group.order.as_ref());
        }
    }

    let sort_inputs = query_ref
        .and_then(|item| item.base_query.as_ref())
        .and_then(|base| base.sort.as_ref())
        .or_else(|| query_ref.and_then(|item| item.sort.as_ref()));

    if let Some(sorts) = sort_inputs {
        for sort in sorts.iter().take(4) {
            push_order_input(sort.field.as_str(), sort.order.as_ref());
        }
    }

    if order_clauses.is_empty() {
        order_clauses.push("LOWER(COALESCE(t.title, t.file_path)) ASC".to_string());
        order_clauses.push("t.updated_at_ms DESC".to_string());
    }
    order_clauses.push("t.id ASC".to_string());

    TrackQuerySqlParts {
        from_where_sql: sql,
        bind_values,
        order_clauses,
    }
}

fn execute_track_query(
    conn: &Connection,
    sql: &str,
    bind_values: &[Value],
    use_list_projection: bool,
    track_field_descriptors: &[LocalTrackFieldDescriptor],
) -> Result<Vec<LibraryTrackRecord>, String> {
    let mut stmt = conn
        .prepare_cached(sql)
        .map_err(|error| format!("Failed to prepare query tracks statement: {error}"))?;

    let rows = stmt
        .query_map(params_from_iter(bind_values.iter()), |row| {
            let mut extra_fields = JsonMap::new();
            if !use_list_projection {
                for index in 0..row.as_ref().column_count() {
                    let column_name = match row.as_ref().column_name(index) {
                        Ok(value) => value,
                        Err(_) => continue,
                    };

                    if matches!(
                        column_name,
                        "id" | "source_id"
                            | "file_path"
                            | "quick_fingerprint"
                            | "title"
                            | "artist"
                            | "album"
                            | "genre"
                            | "year"
                            | "format"
                            | "duration_seconds"
                            | "sample_rate"
                            | "bit_depth"
                            | "file_size"
                            | "mtime_ms"
                            | "replay_gain_track_db"
                            | "replay_gain_album_db"
                            | "play_count"
                            | "last_played_at_ms"
                            | "status"
                            | "created_at_ms"
                            | "updated_at_ms"
                            | "last_seen_at_ms"
                    ) {
                        continue;
                    }

                    let Some(descriptor) = track_field_descriptors
                        .iter()
                        .find(|descriptor| descriptor.column_name == column_name)
                    else {
                        continue;
                    };

                    let value = sqlite_value_ref_to_json(row.get_ref(index)?);
                    if value.is_null() {
                        continue;
                    }
                    extra_fields.insert(descriptor.track_key.clone(), value);
                }
            }

            Ok(LibraryTrackRecord {
                id: row.get("id")?,
                source_id: row.get("source_id")?,
                file_path: row.get("file_path")?,
                quick_fingerprint: row.get("quick_fingerprint")?,
                title: row.get("title")?,
                artist: row.get("artist")?,
                album: row.get("album")?,
                genre: row.get("genre")?,
                year: row.get("year")?,
                format: row.get("format")?,
                duration_seconds: row.get("duration_seconds")?,
                sample_rate: row
                    .get::<_, Option<i64>>("sample_rate")?
                    .map(|value| value as u32),
                bit_depth: row
                    .get::<_, Option<i64>>("bit_depth")?
                    .map(|value| value as u32),
                file_size: row
                    .get::<_, Option<i64>>("file_size")?
                    .map(|value| value as u64),
                mtime_ms: row.get("mtime_ms")?,
                replay_gain_track_db: row.get("replay_gain_track_db")?,
                replay_gain_album_db: row.get("replay_gain_album_db")?,
                play_count: row.get::<_, i64>("play_count")?.max(0) as u64,
                last_played_at_ms: row.get("last_played_at_ms")?,
                status: row.get("status")?,
                created_at_ms: row.get("created_at_ms")?,
                updated_at_ms: row.get("updated_at_ms")?,
                last_seen_at_ms: row.get("last_seen_at_ms")?,
                extra_fields: if extra_fields.is_empty() {
                    None
                } else {
                    Some(extra_fields)
                },
            })
        })
        .map_err(|error| format!("Failed to query tracks: {error}"))?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|error| format!("Failed to parse queried track row: {error}"))?);
    }

    Ok(items)
}

fn count_track_query(conn: &Connection, sql_parts: &TrackQuerySqlParts) -> Result<u64, String> {
    let cache_key =
        hash_track_query_count_key(sql_parts.from_where_sql.as_str(), sql_parts.bind_values.as_slice());
    let now = now_ms();

    if let Ok(mut cache) = TRACK_QUERY_COUNT_CACHE.lock() {
        let maybe_total = match cache.entries.get(&cache_key) {
            Some(entry) if now.saturating_sub(entry.captured_at_ms) <= TRACK_QUERY_COUNT_CACHE_TTL_MS => {
                Some(entry.total)
            }
            _ => None,
        };

        if let Some(total) = maybe_total {
            if let Some(position) = cache.order.iter().position(|item| item == &cache_key) {
                let _ = cache.order.remove(position);
                cache.order.push_back(cache_key);
            }
            return Ok(total);
        }
    }

    let count_sql = format!("SELECT COUNT(*) {}", sql_parts.from_where_sql);
    let mut stmt = conn
        .prepare_cached(count_sql.as_str())
        .map_err(|error| format!("Failed to prepare track count statement: {error}"))?;
    let total = stmt
        .query_row(
        params_from_iter(sql_parts.bind_values.iter()),
        |row| {
            let value = row.get::<_, i64>(0)?;
            Ok(value.max(0) as u64)
        },
    )
    .map_err(|error| format!("Failed to count queried tracks: {error}"))?;

    if let Ok(mut cache) = TRACK_QUERY_COUNT_CACHE.lock() {
        if let Some(position) = cache.order.iter().position(|item| item == &cache_key) {
            let _ = cache.order.remove(position);
        }
        while cache.entries.len() >= TRACK_QUERY_COUNT_CACHE_MAX_ENTRIES {
            match cache.order.pop_front() {
                Some(evicted) => {
                    cache.entries.remove(&evicted);
                }
                None => {
                    cache.entries.clear();
                    break;
                }
            }
        }

        cache.order.push_back(cache_key);
        cache.entries.insert(
            cache_key,
            TrackQueryCountCacheEntry {
                total,
                captured_at_ms: now,
            },
        );
    }

    Ok(total)
}

pub fn query_tracks(
    app: &AppHandle,
    query: Option<LibraryTrackQueryInput>,
) -> Result<Vec<LibraryTrackRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let track_field_descriptors = list_local_track_field_descriptors(conn)?;
        let query_ref = query.as_ref();
        let normalized_limit = resolve_track_query_limit(query_ref);
        let normalized_offset = resolve_track_query_offset(query_ref);
        let use_list_projection = uses_list_track_projection(query_ref);
        let sql_parts = build_track_query_sql(query_ref, &track_field_descriptors);

        let mut sql = String::from(track_query_select_clause(use_list_projection));
        sql.push_str(&sql_parts.from_where_sql);
        sql.push_str("\n ORDER BY ");
        sql.push_str(&sql_parts.order_clauses.join(", "));
        sql.push_str("\n LIMIT ?\n OFFSET ?");

        let mut bind_values = sql_parts.bind_values;
        bind_values.push(Value::Integer(normalized_limit));
        bind_values.push(Value::Integer(normalized_offset));

        execute_track_query(
            conn,
            sql.as_str(),
            bind_values.as_slice(),
            use_list_projection,
            &track_field_descriptors,
        )
    })
}

pub fn query_tracks_page(
    app: &AppHandle,
    query: Option<LibraryTrackQueryInput>,
) -> Result<LibraryTrackQueryPageResult, String> {
    ensure_initialized(app)?;

    with_conn(|conn| {
        let track_field_descriptors = list_local_track_field_descriptors(conn)?;
        let query_ref = query.as_ref();
        let normalized_limit = resolve_track_query_limit(query_ref);
        let normalized_offset = resolve_track_query_offset(query_ref);
        let use_list_projection = uses_list_track_projection(query_ref);
        let sql_parts = build_track_query_sql(query_ref, &track_field_descriptors);

        let total = count_track_query(conn, &sql_parts)?;

        let mut sql = String::from(track_query_select_clause(use_list_projection));
        sql.push_str(&sql_parts.from_where_sql);
        sql.push_str("\n ORDER BY ");
        sql.push_str(&sql_parts.order_clauses.join(", "));
        sql.push_str("\n LIMIT ?\n OFFSET ?");

        let mut bind_values = sql_parts.bind_values;
        bind_values.push(Value::Integer(normalized_limit));
        bind_values.push(Value::Integer(normalized_offset));

        let items = execute_track_query(
            conn,
            sql.as_str(),
            bind_values.as_slice(),
            use_list_projection,
            &track_field_descriptors,
        )?;

        Ok(LibraryTrackQueryPageResult { items, total })
    })
}

fn list_track_field_catalog_from_descriptors(
    descriptors: &[LocalTrackFieldDescriptor],
) -> Vec<LibraryTrackFieldCatalogRecord> {
    descriptors
        .iter()
        .cloned()
        .map(|descriptor| {
            let facetable =
                descriptor.kind == "text" && (descriptor.filterable || descriptor.groupable);
            LibraryTrackFieldCatalogRecord {
                id: descriptor.field_id,
                label: descriptor.label,
                kind: descriptor.kind,
                track_key: descriptor.track_key,
                column_name: descriptor.column_name,
                source_table: "local_tracks".to_string(),
                declared_type: descriptor.declared_type,
                nullable: descriptor.nullable,
                filterable: descriptor.filterable,
                sortable: descriptor.sortable,
                groupable: descriptor.groupable,
                facetable,
                native_filter_field: descriptor.native_filter_field,
                native_sort_field: descriptor.native_sort_field,
            }
        })
        .collect()
}

pub fn list_track_field_catalog(
    app: &AppHandle,
) -> Result<Vec<LibraryTrackFieldCatalogRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let descriptors = list_local_track_field_descriptors(conn)?;
        Ok(list_track_field_catalog_from_descriptors(&descriptors))
    })
}

fn build_facet_catalog_record(
    id: &str,
    kind: &str,
    descriptor: &LocalTrackFieldDescriptor,
) -> LibraryFacetCatalogRecord {
    LibraryFacetCatalogRecord {
        id: id.to_string(),
        field: descriptor.field_id.clone(),
        label: descriptor.label.clone(),
        kind: kind.to_string(),
        native_field: descriptor
            .native_filter_field
            .clone()
            .or_else(|| Some(descriptor.track_key.clone())),
    }
}

fn list_facet_catalog_from_descriptors(
    descriptors: &[LocalTrackFieldDescriptor],
) -> Vec<LibraryFacetCatalogRecord> {
    let mut items = Vec::new();

    if let Some(descriptor) = resolve_text_facet_descriptor(descriptors, "artist") {
        items.push(build_facet_catalog_record(
            "artists",
            "text-values",
            descriptor,
        ));
    }

    if let Some(descriptor) = resolve_text_facet_descriptor(descriptors, "genre") {
        items.push(build_facet_catalog_record(
            "genres",
            "text-values",
            descriptor,
        ));
    }

    if let Some(descriptor) = resolve_text_facet_descriptor(descriptors, "album") {
        items.push(build_facet_catalog_record(
            "albums",
            "album-summaries",
            descriptor,
        ));
    }

    items
}

pub fn list_facet_catalog(app: &AppHandle) -> Result<Vec<LibraryFacetCatalogRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let descriptors = list_local_track_field_descriptors(conn)?;
        Ok(list_facet_catalog_from_descriptors(&descriptors))
    })
}

fn read_schema_version(conn: &Connection) -> Result<i32, String> {
    conn.query_row("PRAGMA user_version;", [], |row| row.get(0))
        .map_err(|error| format!("Failed to read schema user_version: {error}"))
}

fn list_table_columns(conn: &Connection, table_name: &str) -> Result<Vec<String>, String> {
    let sql = format!("PRAGMA table_info({})", quote_sqlite_identifier(table_name));
    let mut stmt = conn.prepare(sql.as_str()).map_err(|error| {
        format!("Failed to prepare table_info pragma for {table_name}: {error}")
    })?;

    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Failed to inspect table columns for {table_name}: {error}"))?;

    let mut columns = Vec::new();
    for row in rows {
        columns.push(row.map_err(|error| {
            format!("Failed to parse table column row for {table_name}: {error}")
        })?);
    }

    Ok(columns)
}

fn inspect_schema_source_table(
    conn: &Connection,
    table_name: &str,
) -> Result<LibrarySchemaSourceTableRecord, String> {
    let sql = format!("PRAGMA table_info({})", quote_sqlite_identifier(table_name));
    let mut stmt = conn.prepare(sql.as_str()).map_err(|error| {
        format!("Failed to prepare schema table_info pragma for {table_name}: {error}")
    })?;

    let rows = stmt
        .query_map([], |row| {
            let column_name: String = row.get(1)?;
            let declared_type: Option<String> = row.get(2)?;
            let not_null: i64 = row.get(3)?;
            let default_value: Option<String> = row.get(4)?;
            let primary_key: i64 = row.get(5)?;
            Ok((
                column_name,
                declared_type.unwrap_or_default(),
                not_null,
                default_value.unwrap_or_default(),
                primary_key,
            ))
        })
        .map_err(|error| format!("Failed to inspect schema table {table_name}: {error}"))?;

    let mut columns = Vec::new();
    let mut schema_tokens = Vec::new();
    for row in rows {
        let (column_name, declared_type, not_null, default_value, primary_key) =
            row.map_err(|error| {
                format!("Failed to parse schema table row for {table_name}: {error}")
            })?;
        columns.push(column_name.clone());
        schema_tokens.push(format!(
            "{}:{}:{}:{}:{}",
            column_name, declared_type, not_null, default_value, primary_key
        ));
    }

    if columns.is_empty() {
        return Err(format!(
            "Schema source table not found or empty: {table_name}"
        ));
    }

    let mut hasher = DefaultHasher::new();
    table_name.hash(&mut hasher);
    schema_tokens
        .iter()
        .for_each(|token| token.hash(&mut hasher));
    let schema_hash = format!("{:016x}", hasher.finish());

    Ok(LibrarySchemaSourceTableRecord {
        name: table_name.to_string(),
        column_count: columns.len() as u32,
        schema_hash,
        columns,
    })
}

fn list_schema_source_tables(
    conn: &Connection,
) -> Result<Vec<LibrarySchemaSourceTableRecord>, String> {
    ["local_tracks", "sources"]
        .into_iter()
        .map(|table_name| inspect_schema_source_table(conn, table_name))
        .collect()
}

fn compute_schema_fingerprint(
    schema_version: i32,
    source_tables: &[LibrarySchemaSourceTableRecord],
    track_fields: &[LibraryTrackFieldCatalogRecord],
    facet_collections: &[LibraryFacetCatalogRecord],
) -> String {
    let mut hasher = DefaultHasher::new();
    schema_version.hash(&mut hasher);

    source_tables.iter().for_each(|table| {
        table.name.hash(&mut hasher);
        table.column_count.hash(&mut hasher);
        table.schema_hash.hash(&mut hasher);
        table
            .columns
            .iter()
            .for_each(|column| column.hash(&mut hasher));
    });

    track_fields.iter().for_each(|field| {
        field.id.hash(&mut hasher);
        field.kind.hash(&mut hasher);
        field.track_key.hash(&mut hasher);
        field.column_name.hash(&mut hasher);
        field.declared_type.hash(&mut hasher);
        field.nullable.hash(&mut hasher);
        field.filterable.hash(&mut hasher);
        field.sortable.hash(&mut hasher);
        field.groupable.hash(&mut hasher);
        field.facetable.hash(&mut hasher);
        field.native_filter_field.hash(&mut hasher);
        field.native_sort_field.hash(&mut hasher);
    });

    facet_collections.iter().for_each(|facet| {
        facet.id.hash(&mut hasher);
        facet.field.hash(&mut hasher);
        facet.kind.hash(&mut hasher);
        facet.native_field.hash(&mut hasher);
    });

    format!("{:016x}", hasher.finish())
}

fn read_observed_schema_state(conn: &Connection) -> Result<ObservedLibrarySchemaState, String> {
    let descriptors = list_local_track_field_descriptors(conn)?;
    let schema_version = read_schema_version(conn)?;
    let source_tables = list_schema_source_tables(conn)?;
    let track_fields = list_track_field_catalog_from_descriptors(&descriptors);
    let facet_collections = list_facet_catalog_from_descriptors(&descriptors);
    let schema_fingerprint = compute_schema_fingerprint(
        schema_version,
        &source_tables,
        &track_fields,
        &facet_collections,
    );

    Ok(ObservedLibrarySchemaState {
        schema_version,
        schema_fingerprint,
        source_tables,
    })
}

fn observed_schema_state_from_envelope(
    envelope: &LibrarySchemaEnvelope,
) -> ObservedLibrarySchemaState {
    ObservedLibrarySchemaState {
        schema_version: envelope.schema_version,
        schema_fingerprint: envelope.schema_fingerprint.clone(),
        source_tables: envelope.source_tables.clone(),
    }
}

pub fn notify_schema_envelope_changed_if_needed(
    app: &AppHandle,
    reason: &str,
) -> Result<bool, String> {
    ensure_initialized(app)?;
    let next_state = with_conn(|conn| read_observed_schema_state(conn))?;
    let previous_state = replace_observed_schema_state(next_state.clone())?;

    let Some(previous_state) = previous_state else {
        return Ok(false);
    };

    if previous_state == next_state {
        return Ok(false);
    }

    let payload = LibrarySchemaChangedEventPayload {
        reason: reason.trim().to_string(),
        emitted_at_ms: now_ms(),
        schema_version: next_state.schema_version,
        schema_fingerprint: next_state.schema_fingerprint.clone(),
        source_tables: next_state.source_tables.clone(),
    };

    app.emit_all(EVENT_MUSIC_LIBRARY_SCHEMA_CHANGED, payload)
        .map_err(|error| format!("Failed to emit music library schema changed event: {error}"))?;

    invalidate_track_query_count_cache();

    Ok(true)
}

pub fn get_schema_envelope(app: &AppHandle) -> Result<LibrarySchemaEnvelope, String> {
    ensure_initialized(app)?;
    let envelope = with_conn(|conn| {
        let descriptors = list_local_track_field_descriptors(conn)?;
        let schema_version = read_schema_version(conn)?;
        let source_tables = list_schema_source_tables(conn)?;
        let track_fields = list_track_field_catalog_from_descriptors(&descriptors);
        let facet_collections = list_facet_catalog_from_descriptors(&descriptors);
        let schema_fingerprint = compute_schema_fingerprint(
            schema_version,
            &source_tables,
            &track_fields,
            &facet_collections,
        );
        Ok(LibrarySchemaEnvelope {
            schema_version,
            generated_at_ms: now_ms(),
            schema_fingerprint,
            source_tables,
            track_fields,
            facet_collections,
        })
    })?;

    let _ = replace_observed_schema_state(observed_schema_state_from_envelope(&envelope))?;
    Ok(envelope)
}

fn resolve_facet_flag_values(
    include_missing: Option<bool>,
    visible_only: Option<bool>,
) -> (i64, i64) {
    let include_missing_flag = if include_missing.unwrap_or(false) {
        1_i64
    } else {
        0_i64
    };
    let visible_only_flag = if visible_only.unwrap_or(true) {
        1_i64
    } else {
        0_i64
    };
    (include_missing_flag, visible_only_flag)
}

fn resolve_facet_flags(query: Option<&LibraryFacetQueryInput>) -> (i64, i64) {
    resolve_facet_flag_values(
        query.and_then(|item| item.include_missing),
        query.and_then(|item| item.visible_only),
    )
}

fn resolve_facet_limit(limit: Option<u32>) -> i64 {
    limit
        .map(|value| value.clamp(1, 5000) as i64)
        .unwrap_or(i64::MAX)
}

fn resolve_text_facet_limit(query: Option<&LibraryTextFacetQueryInput>) -> i64 {
    resolve_facet_limit(query.and_then(|item| item.limit))
}

fn resolve_facet_kind(raw_kind: &str) -> Option<&'static str> {
    match normalize_track_field_token(raw_kind).as_str() {
        "textvalues" => Some("text-values"),
        "albumsummaries" => Some("album-summaries"),
        _ => None,
    }
}

fn resolve_text_facet_descriptor<'a>(
    descriptors: &'a [LocalTrackFieldDescriptor],
    raw_field: &str,
) -> Option<&'a LocalTrackFieldDescriptor> {
    let descriptor = resolve_local_track_field_descriptor(descriptors, raw_field)?;
    if descriptor.kind != "text" {
        return None;
    }
    Some(descriptor)
}

fn list_text_facet_values_from_conn(
    conn: &Connection,
    descriptors: &[LocalTrackFieldDescriptor],
    raw_field: &str,
    include_missing_flag: i64,
    visible_only_flag: i64,
    limit: i64,
) -> Result<Vec<String>, String> {
    let descriptor = resolve_text_facet_descriptor(descriptors, raw_field)
        .ok_or_else(|| format!("Unsupported text facet field: {raw_field}"))?;

    let column = quote_sqlite_identifier(descriptor.column_name.as_str());
    let value_expr = format!("TRIM(COALESCE(CAST(t.{column} AS TEXT), ''))");
    let order_expr = format!("LOWER({value_expr})");
    let sql = format!(
        r#"
                SELECT DISTINCT {value_expr} AS value
                FROM local_tracks t
                JOIN sources s ON s.id = t.source_id
                WHERE (?1 = 0 OR s.is_visible = 1)
                  AND (?2 = 1 OR t.status = 'available')
                  AND {value_expr} <> ''
                ORDER BY {order_expr} ASC
                LIMIT ?3
                "#
    );

    let mut stmt = conn
        .prepare(sql.as_str())
        .map_err(|error| format!("Failed to prepare text facet statement: {error}"))?;

    let rows = stmt
        .query_map(
            params![visible_only_flag, include_missing_flag, limit],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| format!("Failed to query text facet values: {error}"))?;

    let mut items = Vec::new();
    for row in rows {
        let value = row.map_err(|error| format!("Failed to parse text facet row: {error}"))?;
        let normalized = value.trim();
        if normalized.is_empty() {
            continue;
        }
        items.push(normalized.to_string());
    }
    Ok(items)
}

fn list_album_facet_values_from_conn(
    conn: &Connection,
    include_missing_flag: i64,
    visible_only_flag: i64,
    limit: i64,
) -> Result<Vec<LibraryAlbumRecord>, String> {
    let mut stmt = conn
        .prepare(
            r#"
                SELECT
                  TRIM(t.album) AS album,
                  COALESCE(NULLIF(TRIM(t.artist), ''), 'Unknown Artist') AS artist,
                  MIN(t.id) AS cover_track_id,
                  MIN(t.file_path) AS cover_track_path
                FROM local_tracks t
                JOIN sources s ON s.id = t.source_id
                WHERE (?1 = 0 OR s.is_visible = 1)
                  AND (?2 = 1 OR t.status = 'available')
                  AND TRIM(COALESCE(t.album, '')) <> ''
                GROUP BY
                  LOWER(TRIM(t.album)),
                  LOWER(COALESCE(NULLIF(TRIM(t.artist), ''), 'Unknown Artist'))
                ORDER BY
                  LOWER(TRIM(t.album)) ASC,
                  LOWER(COALESCE(NULLIF(TRIM(t.artist), ''), 'Unknown Artist')) ASC
                LIMIT ?3
                "#,
        )
        .map_err(|error| format!("Failed to prepare album facet statement: {error}"))?;

    let rows = stmt
        .query_map(
            params![visible_only_flag, include_missing_flag, limit],
            |row| {
                Ok(LibraryAlbumRecord {
                    album: row.get(0)?,
                    artist: row.get(1)?,
                    cover_track_id: row.get(2)?,
                    cover_track_path: row.get(3)?,
                })
            },
        )
        .map_err(|error| format!("Failed to query album facet values: {error}"))?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|error| format!("Failed to parse album facet row: {error}"))?);
    }
    Ok(items)
}

pub fn list_text_facet_values(
    app: &AppHandle,
    query: Option<LibraryTextFacetQueryInput>,
) -> Result<Vec<String>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let descriptors = list_local_track_field_descriptors(conn)?;
        let query_ref = query
            .as_ref()
            .ok_or_else(|| "Missing text facet query".to_string())?;
        let field = query_ref.field.trim();
        if field.is_empty() {
            return Err("Missing text facet field".to_string());
        }

        let (include_missing_flag, visible_only_flag) =
            resolve_facet_flag_values(query_ref.include_missing, query_ref.visible_only);
        let limit = resolve_text_facet_limit(query.as_ref());
        list_text_facet_values_from_conn(
            conn,
            &descriptors,
            field,
            include_missing_flag,
            visible_only_flag,
            limit,
        )
    })
}

pub fn list_facet_entries(
    app: &AppHandle,
    query: Option<LibraryFacetEntriesQueryInput>,
) -> Result<LibraryFacetEntriesResult, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let query_ref = query
            .as_ref()
            .ok_or_else(|| "Missing facet query".to_string())?;
        let facet_kind = resolve_facet_kind(query_ref.kind.as_str())
            .ok_or_else(|| format!("Unsupported facet kind: {}", query_ref.kind.trim()))?;
        let (include_missing_flag, visible_only_flag) =
            resolve_facet_flag_values(query_ref.include_missing, query_ref.visible_only);
        let limit = resolve_facet_limit(query_ref.limit);

        match facet_kind {
            "text-values" => {
                let field = query_ref
                    .field
                    .as_deref()
                    .map(|item| item.trim())
                    .filter(|item| !item.is_empty())
                    .ok_or_else(|| "Missing facet field for text-values query".to_string())?;
                let descriptors = list_local_track_field_descriptors(conn)?;
                let values = list_text_facet_values_from_conn(
                    conn,
                    &descriptors,
                    field,
                    include_missing_flag,
                    visible_only_flag,
                    limit,
                )?;
                Ok(LibraryFacetEntriesResult {
                    kind: facet_kind.to_string(),
                    text_values: Some(values),
                    albums: None,
                })
            }
            "album-summaries" => {
                let albums = list_album_facet_values_from_conn(
                    conn,
                    include_missing_flag,
                    visible_only_flag,
                    limit,
                )?;
                Ok(LibraryFacetEntriesResult {
                    kind: facet_kind.to_string(),
                    text_values: None,
                    albums: Some(albums),
                })
            }
            _ => Err(format!("Unsupported facet kind: {}", query_ref.kind.trim())),
        }
    })
}

pub fn list_artists(
    app: &AppHandle,
    query: Option<LibraryFacetQueryInput>,
) -> Result<Vec<String>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let descriptors = list_local_track_field_descriptors(conn)?;
        let (include_missing_flag, visible_only_flag) = resolve_facet_flags(query.as_ref());
        list_text_facet_values_from_conn(
            conn,
            &descriptors,
            "artist",
            include_missing_flag,
            visible_only_flag,
            i64::MAX,
        )
    })
}

pub fn list_genres(
    app: &AppHandle,
    query: Option<LibraryFacetQueryInput>,
) -> Result<Vec<String>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let descriptors = list_local_track_field_descriptors(conn)?;
        let (include_missing_flag, visible_only_flag) = resolve_facet_flags(query.as_ref());
        list_text_facet_values_from_conn(
            conn,
            &descriptors,
            "genre",
            include_missing_flag,
            visible_only_flag,
            i64::MAX,
        )
    })
}

pub fn list_albums(
    app: &AppHandle,
    query: Option<LibraryFacetQueryInput>,
) -> Result<Vec<LibraryAlbumRecord>, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let (include_missing_flag, visible_only_flag) = resolve_facet_flags(query.as_ref());
        list_album_facet_values_from_conn(conn, include_missing_flag, visible_only_flag, i64::MAX)
    })
}

pub fn get_stats(
    app: &AppHandle,
    query: Option<LibraryFacetQueryInput>,
) -> Result<LibraryStatsRecord, String> {
    ensure_initialized(app)?;
    with_conn(|conn| {
        let (include_missing_flag, visible_only_flag) = resolve_facet_flags(query.as_ref());

        conn.query_row(
            r#"
            SELECT
              COUNT(*) AS total_tracks,
              COUNT(DISTINCT CASE
                WHEN TRIM(COALESCE(t.artist, '')) <> '' THEN LOWER(TRIM(t.artist))
                ELSE NULL
              END) AS total_artists,
              COUNT(DISTINCT CASE
                WHEN TRIM(COALESCE(t.album, '')) <> '' THEN LOWER(TRIM(t.album))
                ELSE NULL
              END) AS total_albums,
              COALESCE(SUM(COALESCE(t.file_size, 0)), 0) AS total_size,
              COALESCE(SUM(COALESCE(t.duration_seconds, 0.0)), 0.0) AS total_duration
            FROM local_tracks t
            JOIN sources s ON s.id = t.source_id
            WHERE (?1 = 0 OR s.is_visible = 1)
              AND (?2 = 1 OR t.status = 'available')
            "#,
            params![visible_only_flag, include_missing_flag],
            |row| {
                Ok(LibraryStatsRecord {
                    total_tracks: row.get::<_, i64>(0)?.max(0) as u64,
                    total_artists: row.get::<_, i64>(1)?.max(0) as u64,
                    total_albums: row.get::<_, i64>(2)?.max(0) as u64,
                    total_size: row.get::<_, i64>(3)?.max(0) as u64,
                    total_duration: row.get::<_, f64>(4)?.max(0.0),
                })
            },
        )
        .map_err(|error| format!("Failed to query library stats: {error}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        path::{Path, PathBuf},
    };

    fn open_temp_db(prefix: &str) -> (Connection, PathBuf) {
        let mut path = std::env::temp_dir();
        let unique = format!(
            "{prefix}-{}-{}-{}.sqlite3",
            std::process::id(),
            now_ms(),
            std::thread::current().name().unwrap_or("test")
        );
        path.push(unique.replace(':', "_"));
        let conn = Connection::open(&path).expect("open temp sqlite db");
        (conn, path)
    }

    fn cleanup_temp_db(path: &Path) {
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(path.with_extension("sqlite3-shm"));
        let _ = fs::remove_file(path.with_extension("sqlite3-wal"));
    }

    fn has_table(conn: &Connection, table_name: &str) -> bool {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
            params![table_name],
            |row| row.get::<_, i64>(0),
        )
        .map(|value| value != 0)
        .unwrap_or(false)
    }

    fn has_index(conn: &Connection, index_name: &str) -> bool {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='index' AND name=?1)",
            params![index_name],
            |row| row.get::<_, i64>(0),
        )
        .map(|value| value != 0)
        .unwrap_or(false)
    }

    fn read_user_version(conn: &Connection) -> i32 {
        conn.query_row("PRAGMA user_version;", [], |row| row.get(0))
            .expect("read user_version")
    }

    #[test]
    fn facet_catalog_exposes_builtin_collection_descriptors() {
        let (conn, path) = open_temp_db("music-library-facet-catalog");
        migrate(&conn).expect("migrate empty db");

        let descriptors =
            list_local_track_field_descriptors(&conn).expect("read local track field descriptors");
        let catalog = list_facet_catalog_from_descriptors(&descriptors);

        assert_eq!(
            catalog
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["artists", "genres", "albums"]
        );

        let albums = catalog
            .iter()
            .find(|item| item.id == "albums")
            .expect("find albums facet descriptor");
        assert_eq!(albums.field, "album");
        assert_eq!(albums.kind, "album-summaries");
        assert_eq!(albums.native_field.as_deref(), Some("album"));

        drop(conn);
        cleanup_temp_db(&path);
    }

    #[test]
    fn schema_envelope_reuses_field_and_facet_catalogs() {
        let (conn, path) = open_temp_db("music-library-schema-envelope");
        migrate(&conn).expect("migrate empty db");

        let descriptors =
            list_local_track_field_descriptors(&conn).expect("read local track field descriptors");
        let source_tables = list_schema_source_tables(&conn).expect("read schema source tables");
        let track_fields = list_track_field_catalog_from_descriptors(&descriptors);
        let facet_collections = list_facet_catalog_from_descriptors(&descriptors);
        let envelope = LibrarySchemaEnvelope {
            schema_version: read_schema_version(&conn).expect("read schema version"),
            generated_at_ms: now_ms(),
            schema_fingerprint: compute_schema_fingerprint(
                read_schema_version(&conn).expect("read schema version"),
                &source_tables,
                &track_fields,
                &facet_collections,
            ),
            source_tables,
            track_fields,
            facet_collections,
        };

        assert!(envelope
            .track_fields
            .iter()
            .any(|field| field.id == "artist"));
        assert!(envelope
            .facet_collections
            .iter()
            .any(|facet| facet.id == "artists" && facet.kind == "text-values"));

        drop(conn);
        cleanup_temp_db(&path);
    }

    #[test]
    fn local_track_field_catalog_detects_dynamic_columns() {
        let (conn, path) = open_temp_db("music-library-field-catalog");
        migrate(&conn).expect("migrate empty db");
        conn.execute(
            "ALTER TABLE local_tracks ADD COLUMN custom_score INTEGER",
            [],
        )
        .expect("add custom_score column");
        conn.execute("ALTER TABLE local_tracks ADD COLUMN mood_label TEXT", [])
            .expect("add mood_label column");

        let descriptors =
            list_local_track_field_descriptors(&conn).expect("read local track field descriptors");

        let custom_score = descriptors
            .iter()
            .find(|descriptor| descriptor.column_name == "custom_score")
            .expect("find custom_score descriptor");
        assert_eq!(custom_score.field_id, "customScore");
        assert_eq!(custom_score.track_key, "customScore");
        assert_eq!(custom_score.kind, "number");
        assert_eq!(
            custom_score.native_filter_field.as_deref(),
            Some("customScore")
        );
        assert_eq!(
            custom_score.native_sort_field.as_deref(),
            Some("customScore")
        );

        let mood_label = descriptors
            .iter()
            .find(|descriptor| descriptor.column_name == "mood_label")
            .expect("find mood_label descriptor");
        assert_eq!(mood_label.field_id, "moodLabel");
        assert_eq!(mood_label.track_key, "moodLabel");
        assert_eq!(mood_label.kind, "text");
        assert_eq!(mood_label.native_filter_field.as_deref(), Some("moodLabel"));
        assert_eq!(mood_label.native_sort_field.as_deref(), Some("moodLabel"));

        let created_at = descriptors
            .iter()
            .find(|descriptor| descriptor.column_name == "created_at_ms")
            .expect("find created_at_ms descriptor");
        assert_eq!(created_at.field_id, "dateAdded");
        assert_eq!(created_at.track_key, "createdAtMs");
        assert_eq!(created_at.kind, "number");
        assert_eq!(
            created_at.native_filter_field.as_deref(),
            Some("createdAtMs")
        );
        assert_eq!(created_at.native_sort_field.as_deref(), Some("createdAtMs"));

        drop(conn);
        cleanup_temp_db(&path);
    }

    #[test]
    fn track_filter_clause_resolves_dynamic_fields_from_catalog() {
        let (conn, path) = open_temp_db("music-library-filter-clause");
        migrate(&conn).expect("migrate empty db");
        conn.execute(
            "ALTER TABLE local_tracks ADD COLUMN custom_score INTEGER",
            [],
        )
        .expect("add custom_score column");

        let descriptors =
            list_local_track_field_descriptors(&conn).expect("read local track field descriptors");
        let clause = build_track_filter_clause(
            &LibraryTrackFilterInput {
                field: "customScore".to_string(),
                operator: "gte".to_string(),
                value: Some("80".to_string()),
            },
            &descriptors,
        )
        .expect("resolve dynamic numeric filter clause");

        assert_eq!(clause.0, "CAST(t.\"custom_score\" AS REAL) IS NOT NULL AND CAST(t.\"custom_score\" AS REAL) >= ?");
        assert_eq!(clause.1, vec![Value::Real(80.0)]);

        drop(conn);
        cleanup_temp_db(&path);
    }

    #[test]
    fn migrate_empty_db_to_v9_schema() {
        let (conn, path) = open_temp_db("music-library-migrate-empty");
        migrate(&conn).expect("migrate empty db");

        assert_eq!(read_user_version(&conn), 9);
        assert!(has_table(&conn, "connectors"));
        assert!(has_table(&conn, "source_sync_state"));
        assert!(has_table(&conn, "source_fingerprint_state"));
        assert!(has_table(&conn, "track_provider_refs"));
        assert!(has_table(&conn, "metadata_refresh_jobs"));
        assert!(has_table(&conn, "lyric_documents"));
        assert!(has_table(&conn, "lyric_candidates"));
        assert!(has_table(&conn, "lyric_selection"));
        assert!(has_table(&conn, "lyric_fetch_jobs"));
        assert!(has_table(&conn, "playlists"));
        assert!(has_table(&conn, "playlist_items"));
        assert!(has_index(&conn, "source_sync_state_backoff_until_ms_idx"));
        assert!(has_index(&conn, "metadata_refresh_jobs_next_run_at_ms_idx"));
        assert!(has_index(&conn, "lyric_documents_selection_key_idx"));
        assert!(has_index(&conn, "lyric_fetch_jobs_status_idx"));
        assert!(has_index(&conn, "playlists_owner_uid_idx"));
        assert!(has_index(&conn, "playlist_items_playlist_id_idx"));
        let local_track_columns =
            list_table_columns(&conn, "local_tracks").expect("read local_tracks columns");
        assert!(local_track_columns.iter().any(|column| column == "year"));
        assert!(local_track_columns.iter().any(|column| column == "format"));

        drop(conn);
        cleanup_temp_db(&path);
    }

    #[test]
    fn migrate_v4_db_to_v9_schema() {
        let (conn, path) = open_temp_db("music-library-migrate-v4");
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS sources (
              id TEXT PRIMARY KEY NOT NULL,
              path TEXT NOT NULL UNIQUE,
              updated_at_ms INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS local_tracks (
              id TEXT PRIMARY KEY NOT NULL,
              source_id TEXT NOT NULL,
              file_path TEXT NOT NULL,
              artist TEXT,
              album TEXT,
              last_played_at_ms INTEGER,
              FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE,
              UNIQUE(source_id, file_path)
            );

            CREATE TABLE IF NOT EXISTS user_entries (
              id TEXT PRIMARY KEY NOT NULL,
              owner_uid TEXT NOT NULL,
              track_id TEXT,
              updated_at_ms INTEGER NOT NULL
            );

            PRAGMA user_version = 4;
            "#,
        )
        .expect("seed v4 db schema");

        migrate(&conn).expect("migrate v4 db");

        assert_eq!(read_user_version(&conn), 9);
        assert!(has_table(&conn, "connector_accounts"));
        assert!(has_table(&conn, "cover_refs"));
        assert!(has_table(&conn, "lyric_refs"));
        assert!(has_table(&conn, "lyric_documents"));
        assert!(has_table(&conn, "lyric_selection"));
        assert!(has_table(&conn, "lyric_fetch_jobs"));
        assert!(has_table(&conn, "playlists"));
        assert!(has_table(&conn, "playlist_items"));
        assert!(has_index(
            &conn,
            "track_provider_refs_provider_track_id_idx"
        ));
        assert!(has_index(&conn, "lyric_candidates_document_id_idx"));
        assert!(has_index(&conn, "playlists_owner_last_opened_idx"));
        let local_track_columns =
            list_table_columns(&conn, "local_tracks").expect("read local_tracks columns");
        assert!(local_track_columns.iter().any(|column| column == "year"));
        assert!(local_track_columns.iter().any(|column| column == "format"));

        drop(conn);
        cleanup_temp_db(&path);
    }
}
