use crate::music_library_db::MusicTagDbPatchResult;
use crate::music_tag::{
    ChromaprintRequest, ChromaprintResult, CoverArtDownloadRequest, CoverArtDownloadResult,
    CoverArtSearchRequest, CoverArtSearchResult, MusicTagBatchRequest, MusicTagBatchState,
    MusicTagCandidateSearchRequest, MusicTagCandidateSearchResult, MusicTagDbPatchRequest,
    MusicTagReadLocalRequest, MusicTagReadLocalResult, MusicTagWriteFileRequest,
    MusicTagWriteFileResult,
};

#[tauri::command(rename_all = "camelCase")]
pub async fn music_tag_read_local_tags(
    app: tauri::AppHandle,
    request: MusicTagReadLocalRequest,
) -> Result<MusicTagReadLocalResult, String> {
    tauri::async_runtime::spawn_blocking(move || crate::music_tag::read_local_tags(&app, request))
        .await
        .map_err(|error| format!("Music tag local read task failed: {error}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_tag_preview_db_patch(
    app: tauri::AppHandle,
    request: MusicTagDbPatchRequest,
) -> Result<MusicTagDbPatchResult, String> {
    tauri::async_runtime::spawn_blocking(move || crate::music_tag::preview_db_patch(&app, request))
        .await
        .map_err(|error| format!("Music tag DB patch preview task failed: {error}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_tag_apply_db_patch(
    app: tauri::AppHandle,
    request: MusicTagDbPatchRequest,
) -> Result<MusicTagDbPatchResult, String> {
    tauri::async_runtime::spawn_blocking(move || crate::music_tag::apply_db_patch(&app, request))
        .await
        .map_err(|error| format!("Music tag DB patch apply task failed: {error}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_tag_search_candidates(
    app: tauri::AppHandle,
    request: MusicTagCandidateSearchRequest,
) -> Result<MusicTagCandidateSearchResult, String> {
    tauri::async_runtime::spawn_blocking(move || crate::music_tag::search_candidates(&app, request))
        .await
        .map_err(|error| format!("Music tag candidate search task failed: {error}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_tag_write_file_tags(
    app: tauri::AppHandle,
    request: MusicTagWriteFileRequest,
) -> Result<MusicTagWriteFileResult, String> {
    tauri::async_runtime::spawn_blocking(move || crate::music_tag::write_file_tags(&app, request))
        .await
        .map_err(|error| format!("Music tag file write task failed: {error}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_tag_search_cover_art(
    app: tauri::AppHandle,
    request: CoverArtSearchRequest,
) -> Result<CoverArtSearchResult, String> {
    tauri::async_runtime::spawn_blocking(move || crate::music_tag::search_cover_art(&app, request))
        .await
        .map_err(|error| format!("Music tag cover art search task failed: {error}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_tag_download_cover_art(
    app: tauri::AppHandle,
    request: CoverArtDownloadRequest,
) -> Result<CoverArtDownloadResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::music_tag::download_cover_art(&app, request)
    })
    .await
    .map_err(|error| format!("Music tag cover art download task failed: {error}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_tag_generate_chromaprint(
    app: tauri::AppHandle,
    request: ChromaprintRequest,
) -> Result<ChromaprintResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::music_tag::generate_chromaprint(&app, request)
    })
    .await
    .map_err(|error| format!("Music tag chromaprint generation task failed: {error}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_tag_batch_start(
    app: tauri::AppHandle,
    request: MusicTagBatchRequest,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || crate::music_tag::start_batch_job(&app, request))
        .await
        .map_err(|error| format!("Music tag batch start task failed: {error}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_tag_batch_cancel() -> Result<bool, String> {
    crate::music_tag::cancel_batch_job()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn music_tag_batch_state() -> Result<MusicTagBatchState, String> {
    Ok(crate::music_tag::get_batch_state())
}
