use crate::{music_library, music_library_db};

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_scan(
    app: tauri::AppHandle,
    paths: Vec<String>,
    options: Option<music_library::ScanOptions>,
) -> Result<Vec<music_library::ScannedTrack>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_library::scan_library_paths(&app, paths, options)
    })
    .await
    .map_err(|e| format!("Scan task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_get_cover(
    app: tauri::AppHandle,
    path: String,
    max_bytes: Option<u64>,
    max_edge_px: Option<u32>,
) -> Result<Option<music_library::CachedCover>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_library::get_or_create_cover(&app, path, max_bytes, max_edge_px)
    })
    .await
    .map_err(|e| format!("Cover task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_remove_cover(app: tauri::AppHandle, key: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || music_library::remove_cached_cover(&app, key))
        .await
        .map_err(|e| format!("Remove cover task failed: {e}"))?
}

#[tauri::command]
pub fn music_library_cancel_scan() -> Result<(), String> {
    music_library::request_cancel_scan();
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_upsert_source(
    app: tauri::AppHandle,
    source: music_library_db::LibrarySourceUpsertInput,
) -> Result<music_library_db::LibrarySourceRecord, String> {
    tauri::async_runtime::spawn_blocking(move || music_library_db::upsert_source(&app, source))
        .await
        .map_err(|e| format!("Music library source upsert task failed: {e}"))?
}

#[tauri::command]
pub async fn music_library_db_list_sources(
    app: tauri::AppHandle,
) -> Result<Vec<music_library_db::LibrarySourceRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || music_library_db::list_sources(&app))
        .await
        .map_err(|e| format!("Music library source list task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_remove_source(
    app: tauri::AppHandle,
    source_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || music_library_db::remove_source(&app, &source_id))
        .await
        .map_err(|e| format!("Music library source remove task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_sync_tracks(
    app: tauri::AppHandle,
    source_id: String,
    upserts: Vec<music_library_db::LibraryTrackUpsertInput>,
    missing_track_ids: Vec<String>,
) -> Result<music_library_db::LibraryTrackSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_library_db::sync_source_tracks(&app, &source_id, upserts, missing_track_ids)
    })
    .await
    .map_err(|e| format!("Music library track sync task failed: {e}"))?
}

#[tauri::command]
pub async fn music_library_db_clear_tracks(app: tauri::AppHandle) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || music_library_db::clear_tracks(&app))
        .await
        .map_err(|e| format!("Music library track clear task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_delete_tracks(
    app: tauri::AppHandle,
    track_ids: Vec<String>,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || music_library_db::delete_tracks(&app, track_ids))
        .await
        .map_err(|e| format!("Music library track delete task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_mark_track_played(
    app: tauri::AppHandle,
    track_id: String,
    played_at_ms: Option<i64>,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_library_db::mark_track_played(&app, &track_id, played_at_ms)
    })
    .await
    .map_err(|e| format!("Music library mark track played task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_upsert_user_entry(
    app: tauri::AppHandle,
    entry: music_library_db::LibraryUserEntryUpsertInput,
) -> Result<music_library_db::LibraryUserEntryRecord, String> {
    tauri::async_runtime::spawn_blocking(move || music_library_db::upsert_user_entry(&app, entry))
        .await
        .map_err(|e| format!("Music library upsert user entry task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_list_user_entries(
    app: tauri::AppHandle,
    query: Option<music_library_db::LibraryUserEntryQueryInput>,
) -> Result<Vec<music_library_db::LibraryUserEntryRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || music_library_db::list_user_entries(&app, query))
        .await
        .map_err(|e| format!("Music library list user entries task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_delete_user_entry(
    app: tauri::AppHandle,
    entry_id: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_library_db::delete_user_entry(&app, &entry_id)
    })
    .await
    .map_err(|e| format!("Music library delete user entry task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_mark_user_entry_played(
    app: tauri::AppHandle,
    entry_id: String,
    played_at_ms: Option<i64>,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_library_db::mark_user_entry_played(&app, &entry_id, played_at_ms)
    })
    .await
    .map_err(|e| format!("Music library mark user entry played task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_upsert_fallback_task(
    app: tauri::AppHandle,
    task: music_library_db::LibraryFallbackTaskUpsertInput,
) -> Result<music_library_db::LibraryFallbackTaskRecord, String> {
    tauri::async_runtime::spawn_blocking(move || music_library_db::upsert_fallback_task(&app, task))
        .await
        .map_err(|e| format!("Music library upsert fallback task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_list_fallback_tasks(
    app: tauri::AppHandle,
    query: Option<music_library_db::LibraryFallbackTaskQueryInput>,
) -> Result<Vec<music_library_db::LibraryFallbackTaskRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || music_library_db::list_fallback_tasks(&app, query))
        .await
        .map_err(|e| format!("Music library list fallback tasks task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_update_fallback_task_status(
    app: tauri::AppHandle,
    task_id: String,
    status: String,
    last_error: Option<String>,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_library_db::update_fallback_task_status(&app, &task_id, &status, last_error)
    })
    .await
    .map_err(|e| format!("Music library update fallback task status task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_upsert_cloud_hash_job(
    app: tauri::AppHandle,
    job: music_library_db::LibraryCloudHashJobUpsertInput,
) -> Result<music_library_db::LibraryCloudHashJobRecord, String> {
    tauri::async_runtime::spawn_blocking(move || music_library_db::upsert_cloud_hash_job(&app, job))
        .await
        .map_err(|e| format!("Music library upsert cloud hash job task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_list_cloud_hash_jobs(
    app: tauri::AppHandle,
    query: Option<music_library_db::LibraryCloudHashJobQueryInput>,
) -> Result<Vec<music_library_db::LibraryCloudHashJobRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_library_db::list_cloud_hash_jobs(&app, query)
    })
    .await
    .map_err(|e| format!("Music library list cloud hash jobs task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_update_cloud_hash_job_status(
    app: tauri::AppHandle,
    job_id: String,
    status: String,
    cloud_full_hash: Option<String>,
    last_error: Option<String>,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_library_db::update_cloud_hash_job_status(
            &app,
            &job_id,
            &status,
            cloud_full_hash,
            last_error,
        )
    })
    .await
    .map_err(|e| format!("Music library update cloud hash job status task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_list_source_health(
    app: tauri::AppHandle,
    query: Option<music_library_db::LibrarySourceHealthQueryInput>,
) -> Result<Vec<music_library_db::LibrarySourceHealthRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || music_library_db::list_source_health(&app, query))
        .await
        .map_err(|e| format!("Music library source health task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_cleanup_source_tracks(
    app: tauri::AppHandle,
    source_id: String,
    missing_only: Option<bool>,
) -> Result<u64, String> {
    let normalized_missing_only = missing_only.unwrap_or(true);
    tauri::async_runtime::spawn_blocking(move || {
        music_library_db::cleanup_source_tracks(&app, &source_id, normalized_missing_only)
    })
    .await
    .map_err(|e| format!("Music library source cleanup task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_query_tracks(
    app: tauri::AppHandle,
    query: Option<music_library_db::LibraryTrackQueryInput>,
) -> Result<Vec<music_library_db::LibraryTrackRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || music_library_db::query_tracks(&app, query))
        .await
        .map_err(|e| format!("Music library track query task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_list_artists(
    app: tauri::AppHandle,
    query: Option<music_library_db::LibraryFacetQueryInput>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || music_library_db::list_artists(&app, query))
        .await
        .map_err(|e| format!("Music library artist list task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_list_genres(
    app: tauri::AppHandle,
    query: Option<music_library_db::LibraryFacetQueryInput>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || music_library_db::list_genres(&app, query))
        .await
        .map_err(|e| format!("Music library genre list task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_list_albums(
    app: tauri::AppHandle,
    query: Option<music_library_db::LibraryFacetQueryInput>,
) -> Result<Vec<music_library_db::LibraryAlbumRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || music_library_db::list_albums(&app, query))
        .await
        .map_err(|e| format!("Music library album list task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_get_stats(
    app: tauri::AppHandle,
    query: Option<music_library_db::LibraryFacetQueryInput>,
) -> Result<music_library_db::LibraryStatsRecord, String> {
    tauri::async_runtime::spawn_blocking(move || music_library_db::get_stats(&app, query))
        .await
        .map_err(|e| format!("Music library stats task failed: {e}"))?
}
