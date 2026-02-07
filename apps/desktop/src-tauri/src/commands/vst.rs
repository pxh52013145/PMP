use crate::{
    dsp_graph, native_audio, vst_audit, vst_bridge, vst_compat, vst_governance, vst_library,
    vst_presets, vst_runtime, vst_scanner, vst_settings,
};

#[tauri::command]
pub async fn native_audio_vst_list_plugins() -> Result<Vec<vst_bridge::BridgePluginDescriptor>, String>
{
    tauri::async_runtime::spawn_blocking(|| vst_runtime::list_plugins())
        .await
        .map_err(|e| format!("VST list task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_describe_plugin(
    plugin_id: String,
) -> Result<vst_bridge::BridgePluginDescriptor, String> {
    tauri::async_runtime::spawn_blocking(move || vst_runtime::describe_plugin(plugin_id.as_str()))
        .await
        .map_err(|e| format!("VST describe task failed: {e}"))?
}

#[tauri::command]
pub async fn native_audio_vst_library_list_plugins() -> Result<Vec<vst_library::VstLibraryPlugin>, String>
{
    tauri::async_runtime::spawn_blocking(|| vst_library::list_plugins())
        .await
        .map_err(|e| format!("VST library list task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_library_get_plugin_params(
    plugin_id: String,
) -> Result<Vec<vst_library::VstLibraryParamDescriptor>, String> {
    tauri::async_runtime::spawn_blocking(move || vst_library::get_plugin_params(plugin_id.as_str()))
        .await
        .map_err(|e| format!("VST library params task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_library_reset_plugin_scan_status(plugin_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || vst_library::reset_plugin_scan_status(plugin_id.as_str()))
        .await
        .map_err(|e| format!("VST library reset scan status task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_library_invalidate_plugin_params_cache(
    plugin_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || vst_library::invalidate_plugin_params_cache(plugin_id.as_str()))
        .await
        .map_err(|e| format!("VST library invalidate params cache task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_library_list_scan_runs(
    limit: Option<u32>,
) -> Result<Vec<vst_library::VstScanRun>, String> {
    tauri::async_runtime::spawn_blocking(move || vst_library::list_scan_runs(limit.unwrap_or(40)))
        .await
        .map_err(|e| format!("VST library scan runs task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_library_list_scan_events(
    run_id: String,
    limit: Option<u32>,
) -> Result<Vec<vst_library::VstScanEvent>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        vst_library::list_scan_events(run_id.as_str(), limit.unwrap_or(80))
    })
    .await
    .map_err(|e| format!("VST library scan events task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_library_get_scan_run_summary(
    run_id: String,
) -> Result<vst_library::VstScanRunSummary, String> {
    tauri::async_runtime::spawn_blocking(move || vst_library::get_scan_run_summary(run_id.as_str()))
        .await
        .map_err(|e| format!("VST library scan run summary task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_scan_paths_exist(
    paths: Vec<String>,
) -> Result<std::collections::HashMap<String, bool>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = std::collections::HashMap::new();
        for raw in paths {
            let path = raw.trim();
            if path.is_empty() {
                continue;
            }
            let exists = std::path::Path::new(path).exists();
            out.insert(raw, exists);
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("VST scan path exists task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_scan_start(
    app: tauri::AppHandle,
    request: vst_scanner::VstScanRequest,
) -> Result<String, String> {
    vst_scanner::start_scan(&app, request)
}

#[tauri::command]
pub async fn native_audio_vst_scan_cancel() -> Result<(), String> {
    vst_scanner::cancel_scan()
}

#[tauri::command]
pub async fn native_audio_vst_scan_state() -> Result<vst_scanner::VstScanState, String> {
    vst_scanner::get_state()
}

#[tauri::command]
pub async fn native_audio_vst_list_session_statuses() -> Result<Vec<vst_runtime::VstSessionStatus>, String> {
    Ok(tauri::async_runtime::spawn_blocking(|| vst_runtime::list_session_statuses())
        .await
        .map_err(|e| format!("VST list session statuses task failed: {e}"))?)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_set_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::set_vst_enabled(&app, enabled))
        .await
        .map_err(|e| format!("VST set enabled task failed: {e}"))?
}

#[tauri::command]
pub async fn native_audio_vst_warmup(app: tauri::AppHandle) -> Result<Vec<native_audio::VstWarmupNodeReport>, String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::vst_warmup(&app))
        .await
        .map_err(|e| format!("VST warmup task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_open_native_editor(
    app: tauri::AppHandle,
    node_id: String,
    title: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        vst_runtime::open_native_editor(&app, node_id, title)
    })
    .await
    .map_err(|e| format!("VST open editor task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_close_native_editor(node_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || vst_runtime::close_native_editor(node_id))
        .await
        .map_err(|e| format!("VST close editor task failed: {e}"))?
}

#[tauri::command]
pub async fn native_audio_vst_bring_editors_to_front(app: tauri::AppHandle) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || vst_runtime::bring_all_editors_to_front(&app))
        .await
        .map_err(|e| format!("VST bring editors task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_set_params(
    app: tauri::AppHandle,
    node_id: String,
    params: Vec<dsp_graph::VstParamValue>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || vst_runtime::set_params(&app, node_id, params))
        .await
        .map_err(|e| format!("VST set params task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_set_param_value(
    app: tauri::AppHandle,
    node_id: String,
    key: String,
    value: f32,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        vst_runtime::set_param_value(&app, node_id, key, value)
    })
    .await
    .map_err(|e| format!("VST set param task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_get_params(
    app: tauri::AppHandle,
    node_id: String,
) -> Result<Vec<dsp_graph::VstParamValue>, String> {
    tauri::async_runtime::spawn_blocking(move || vst_runtime::get_params(&app, node_id))
        .await
        .map_err(|e| format!("VST get params task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_dispose_session(node_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || vst_runtime::dispose_session(node_id))
        .await
        .map_err(|e| format!("VST dispose task failed: {e}"))?
}

#[tauri::command]
pub async fn native_audio_vst_get_settings(
    app: tauri::AppHandle,
) -> Result<vst_settings::VstSettings, String> {
    tauri::async_runtime::spawn_blocking(move || vst_settings::get_settings(&app))
        .await
        .map_err(|e| format!("VST get settings task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_set_settings(
    app: tauri::AppHandle,
    settings: vst_settings::VstSettings,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        vst_settings::set_settings(&app, settings)?;
        if let Err(err) = native_audio::refresh_dsp_chain(&app) {
            eprintln!("[VST] Failed to refresh DSP chain after settings update: {err}");
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("VST set settings task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_get_compatibility(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<vst_compat::VstCompatQueryResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        vst_compat::get_compatibility(&app, plugin_id.as_str())
    })
    .await
    .map_err(|e| format!("VST get compatibility task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_set_compat_rule(
    app: tauri::AppHandle,
    scope: vst_compat::VstCompatScope,
    key: String,
    rule: vst_compat::VstCompatRule,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        vst_compat::set_rule(&app, scope, key.as_str(), rule)
    })
    .await
    .map_err(|e| format!("VST set compatibility task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_clear_compat_rule(
    app: tauri::AppHandle,
    scope: vst_compat::VstCompatScope,
    key: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        vst_compat::clear_rule(&app, scope, key.as_str())
    })
    .await
    .map_err(|e| format!("VST clear compatibility task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_list_presets(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<Vec<vst_presets::VstPresetSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || vst_presets::list_presets(&app, plugin_id.as_str()))
        .await
        .map_err(|e| format!("VST list presets task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_save_preset(
    app: tauri::AppHandle,
    node_id: String,
    name: String,
) -> Result<vst_presets::VstPresetSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        vst_presets::save_preset_from_node(&app, node_id.as_str(), name.as_str())
    })
    .await
    .map_err(|e| format!("VST save preset task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_delete_preset(
    app: tauri::AppHandle,
    plugin_id: String,
    preset_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        vst_presets::delete_preset(&app, plugin_id.as_str(), preset_id.as_str())
    })
    .await
    .map_err(|e| format!("VST delete preset task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_apply_preset(
    app: tauri::AppHandle,
    node_id: String,
    preset_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        vst_presets::apply_preset_to_node(&app, node_id.as_str(), preset_id.as_str())
    })
    .await
    .map_err(|e| format!("VST apply preset task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_get_locked_params(
    app: tauri::AppHandle,
    node_id: String,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || vst_presets::locked_params(&app, node_id.as_str()))
        .await
        .map_err(|e| format!("VST get locked params task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_set_param_locked(
    app: tauri::AppHandle,
    node_id: String,
    key: String,
    locked: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        vst_presets::set_param_locked(&app, node_id.as_str(), key.as_str(), locked)
    })
    .await
    .map_err(|e| format!("VST set param locked task failed: {e}"))?
}

#[tauri::command]
pub async fn native_audio_vst_get_audit_log() -> Result<vst_audit::VstAuditLog, String> {
    tauri::async_runtime::spawn_blocking(|| vst_audit::get_log())
        .await
        .map_err(|e| format!("VST audit log task failed: {e}"))?
}

#[tauri::command]
pub async fn native_audio_vst_clear_audit_log() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| vst_audit::clear_events())
        .await
        .map_err(|e| format!("VST audit log clear task failed: {e}"))?
}

#[tauri::command]
pub async fn native_audio_vst_get_governance() -> Result<vst_governance::VstGovernanceState, String> {
    tauri::async_runtime::spawn_blocking(|| vst_governance::state())
        .await
        .map_err(|e| format!("VST governance task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_disable_plugin(
    plugin_id: String,
    reason: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        vst_governance::disable_plugin(
            plugin_id,
            None,
            reason.unwrap_or_else(|| "Disabled by user".to_string()),
            None,
        )
        .map(|_| ())
    })
    .await
    .map_err(|e| format!("VST disable plugin task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_vst_enable_plugin(plugin_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        vst_governance::enable_plugin(plugin_id.as_str()).map(|_| ())
    })
    .await
    .map_err(|e| format!("VST enable plugin task failed: {e}"))?
}
