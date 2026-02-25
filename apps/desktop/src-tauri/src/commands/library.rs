use crate::{music_library, music_library_db, music_library_sync, music_platform_bilibili};

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

#[tauri::command]
pub fn music_library_sync_get_status() -> Result<music_library_sync::MusicLibrarySyncStatus, String>
{
    music_library_sync::get_status()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_sync_run_tick(
    app: tauri::AppHandle,
    reason: Option<String>,
) -> Result<music_library_sync::MusicLibrarySyncTickResult, String> {
    tauri::async_runtime::spawn_blocking(move || music_library_sync::run_tick(&app, reason))
        .await
        .map_err(|e| format!("Music library sync tick task failed: {e}"))?
}

#[tauri::command]
pub fn music_library_sync_scheduler_get_status(
) -> Result<music_library_sync::MusicLibrarySyncSchedulerStatus, String> {
    music_library_sync::get_scheduler_status()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_sync_scheduler_start(
    app: tauri::AppHandle,
    interval_ms: Option<u64>,
) -> Result<music_library_sync::MusicLibrarySyncSchedulerStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_library_sync::start_scheduler(&app, interval_ms)
    })
    .await
    .map_err(|e| format!("Music library sync scheduler start task failed: {e}"))?
}

#[tauri::command]
pub async fn music_library_sync_scheduler_stop(
    app: tauri::AppHandle,
) -> Result<music_library_sync::MusicLibrarySyncSchedulerStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_library_sync::stop_scheduler_with_event(&app)
    })
    .await
    .map_err(|e| format!("Music library sync scheduler stop task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_sync_get_failure_overview(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<music_library_sync::MusicLibrarySyncFailureOverview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_library_sync::get_failure_overview(&app, limit)
    })
    .await
    .map_err(|e| format!("Music library sync failure overview task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_sync_retry_failed_sources(
    app: tauri::AppHandle,
    source_ids: Option<Vec<String>>,
    reason: Option<String>,
) -> Result<music_library_sync::MusicLibrarySyncRetryResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_library_sync::retry_failed_sources(&app, source_ids, reason)
    })
    .await
    .map_err(|e| format!("Music library sync retry failed sources task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_sync_clear_failed_sources(
    app: tauri::AppHandle,
    source_ids: Option<Vec<String>>,
) -> Result<music_library_sync::MusicLibrarySyncClearResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_library_sync::clear_failed_sources(&app, source_ids)
    })
    .await
    .map_err(|e| format!("Music library sync clear failed sources task failed: {e}"))?
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

#[tauri::command]
pub async fn music_library_db_list_connectors(
    app: tauri::AppHandle,
) -> Result<Vec<music_library_db::LibraryConnectorRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || music_library_db::list_connectors(&app))
        .await
        .map_err(|e| format!("Music library connector list task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_db_list_connector_accounts(
    app: tauri::AppHandle,
    connector_id: Option<String>,
) -> Result<Vec<music_library_db::LibraryConnectorAccountRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_library_db::list_connector_accounts(&app, connector_id.as_deref())
    })
    .await
    .map_err(|e| format!("Music library connector account list task failed: {e}"))?
}

#[tauri::command]
pub async fn music_library_bilibili_qr_generate(
    app: tauri::AppHandle,
) -> Result<music_platform_bilibili::BilibiliQrCodeSession, String> {
    tauri::async_runtime::spawn_blocking(move || music_platform_bilibili::qr_generate(&app))
        .await
        .map_err(|e| format!("Bilibili QR generate task failed: {e}"))?
}

#[tauri::command]
pub async fn music_library_bilibili_get_playback_cache_settings(
    app: tauri::AppHandle,
) -> Result<music_platform_bilibili::BilibiliPlaybackCacheSettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_platform_bilibili::get_playback_cache_settings(&app)
    })
    .await
    .map_err(|e| format!("Bilibili get playback cache settings task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_bilibili_set_playback_cache_settings(
    app: tauri::AppHandle,
    custom_root_path: Option<String>,
) -> Result<music_platform_bilibili::BilibiliPlaybackCacheSettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_platform_bilibili::set_playback_cache_settings(&app, custom_root_path)
    })
    .await
    .map_err(|e| format!("Bilibili set playback cache settings task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_bilibili_qr_poll(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<music_platform_bilibili::BilibiliQrPollResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_platform_bilibili::qr_poll(&app, &session_id)
    })
    .await
    .map_err(|e| format!("Bilibili QR poll task failed: {e}"))?
}

#[tauri::command]
pub async fn music_library_bilibili_get_auth_status(
    app: tauri::AppHandle,
) -> Result<music_platform_bilibili::BilibiliAuthStatus, String> {
    tauri::async_runtime::spawn_blocking(move || music_platform_bilibili::get_auth_status(&app))
        .await
        .map_err(|e| format!("Bilibili auth status task failed: {e}"))?
}

#[tauri::command]
pub async fn music_library_bilibili_logout(
    app: tauri::AppHandle,
) -> Result<music_platform_bilibili::BilibiliAuthStatus, String> {
    tauri::async_runtime::spawn_blocking(move || music_platform_bilibili::logout(&app))
        .await
        .map_err(|e| format!("Bilibili logout task failed: {e}"))?
}

#[tauri::command]
pub async fn music_library_bilibili_list_favorite_folders(
    app: tauri::AppHandle,
) -> Result<Vec<music_platform_bilibili::BilibiliFavoriteFolder>, String> {
    tauri::async_runtime::spawn_blocking(move || music_platform_bilibili::list_favorite_folders(&app))
        .await
        .map_err(|e| format!("Bilibili favorite folder list task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_bilibili_list_favorite_resources(
    app: tauri::AppHandle,
    folder_id: String,
    page_num: Option<u32>,
    page_size: Option<u32>,
) -> Result<music_platform_bilibili::BilibiliFavoriteResourcePage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_platform_bilibili::list_favorite_resources(&app, &folder_id, page_num, page_size)
    })
    .await
    .map_err(|e| format!("Bilibili favorite resource list task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_bilibili_search_resource_by_bvid(
    app: tauri::AppHandle,
    bvid: String,
) -> Result<Option<music_platform_bilibili::BilibiliFavoriteResourceItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_platform_bilibili::search_resource_by_bvid(&app, &bvid)
    })
    .await
    .map_err(|e| format!("Bilibili search resource by BV task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_bilibili_prepare_cover_cache(
    app: tauri::AppHandle,
    cover_url: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_platform_bilibili::prepare_cover_cache(&app, &cover_url)
    })
    .await
    .map_err(|e| format!("Bilibili prepare cover cache task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_bilibili_list_playback_qualities(
    app: tauri::AppHandle,
    source_locator: String,
) -> Result<Vec<music_platform_bilibili::BilibiliPlaybackQualityOption>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_platform_bilibili::list_playback_qualities(&app, &source_locator)
    })
    .await
    .map_err(|e| format!("Bilibili list playback qualities task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_bilibili_prepare_cached_playback(
    app: tauri::AppHandle,
    source_locator: String,
    quality_hint: Option<String>,
) -> Result<music_platform_bilibili::BilibiliPlaybackPrepared, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_platform_bilibili::prepare_cached_playback(&app, &source_locator, quality_hint.as_deref())
    })
    .await
    .map_err(|e| format!("Bilibili prepare cached playback task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_library_bilibili_resolve_lyric_locator(
    app: tauri::AppHandle,
    lyric_locator: String,
) -> Result<Option<music_platform_bilibili::BilibiliLyricLocatorRef>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        music_platform_bilibili::resolve_lyric_locator(&app, &lyric_locator)
    })
    .await
    .map_err(|e| format!("Bilibili lyric locator resolve task failed: {e}"))?
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
