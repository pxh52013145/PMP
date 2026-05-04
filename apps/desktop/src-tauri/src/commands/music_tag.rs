use crate::music_library_db::MusicTagDbPatchResult;
use crate::music_tag::{
    MusicTagCandidateSearchRequest, MusicTagCandidateSearchResult, MusicTagDbPatchRequest,
    MusicTagReadLocalRequest, MusicTagReadLocalResult,
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
