use crate::dsp_graph;

#[tauri::command]
pub async fn native_audio_get_dsp_graph(
    app: tauri::AppHandle,
) -> Result<dsp_graph::DspGraphConfig, String> {
    tauri::async_runtime::spawn_blocking(move || dsp_graph::get_dsp_graph(&app))
        .await
        .map_err(|e| format!("Get DSP graph task failed: {e}"))?
}

#[tauri::command]
pub async fn native_audio_set_dsp_graph(
    app: tauri::AppHandle,
    graph: dsp_graph::DspGraphConfig,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || dsp_graph::set_dsp_graph(&app, graph))
        .await
        .map_err(|e| format!("Set DSP graph task failed: {e}"))?
}
