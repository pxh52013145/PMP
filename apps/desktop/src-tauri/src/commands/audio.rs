use crate::{audio::decoder_sidecar, native_audio};

#[tauri::command]
pub async fn native_audio_load(app: tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::load(&app, path))
        .await
        .map_err(|e| format!("Native audio load task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_load_and_play(
    app: tauri::AppHandle,
    path: String,
    replay_gain_db: Option<f32>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        native_audio::load_and_play(&app, path, replay_gain_db)
    })
    .await
    .map_err(|e| format!("Native audio load+play task failed: {e}"))?
}

#[tauri::command]
pub async fn native_audio_play(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::play(&app))
        .await
        .map_err(|e| format!("Native audio play task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_crossfade_to(
    app: tauri::AppHandle,
    path: String,
    duration_ms: u64,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        native_audio::crossfade_to(&app, path, duration_ms)
    })
    .await
    .map_err(|e| format!("Native audio crossfade task failed: {e}"))?
}

#[tauri::command]
pub async fn native_audio_pause(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::pause(&app))
        .await
        .map_err(|e| format!("Native audio pause task failed: {e}"))?
}

#[tauri::command]
pub async fn native_audio_stop(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::stop(&app))
        .await
        .map_err(|e| format!("Native audio stop task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub fn native_audio_mark_seek_seq(seek_seq: Option<u64>) -> Result<(), String> {
    native_audio::mark_latest_seek_sequence(seek_seq);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_seek(
    app: tauri::AppHandle,
    time: f64,
    seek_seq: Option<u64>,
) -> Result<(), String> {
    // `native_audio::seek` is now a fast enqueue into the backend coalescer.
    native_audio::seek(&app, time, seek_seq)
}

#[tauri::command]
pub async fn native_audio_set_volume(app: tauri::AppHandle, volume: f32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::set_volume(&app, volume))
        .await
        .map_err(|e| format!("Native audio set volume task failed: {e}"))?
}

#[tauri::command]
pub async fn native_audio_set_mute(app: tauri::AppHandle, muted: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::set_mute(&app, muted))
        .await
        .map_err(|e| format!("Native audio set mute task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_set_gain(app: tauri::AppHandle, db: f32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::set_gain(&app, db))
        .await
        .map_err(|e| format!("Native audio set gain task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_set_replay_gain(
    app: tauri::AppHandle,
    db: Option<f32>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::set_replay_gain(&app, db))
        .await
        .map_err(|e| format!("Native audio set replay gain task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_set_dynamic_gain_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        native_audio::set_dynamic_gain_enabled(&app, enabled)
    })
    .await
    .map_err(|e| format!("Native audio set dynamic gain task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_set_dsp_chain(
    app: tauri::AppHandle,
    chain: Vec<native_audio::DspNodeConfig>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::set_dsp_chain(&app, chain))
        .await
        .map_err(|e| format!("Native audio set DSP chain task failed: {e}"))?
}

#[tauri::command]
pub async fn native_audio_list_output_backends() -> Result<Vec<String>, String> {
    native_audio::list_output_backends()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_select_output_backend(
    app: tauri::AppHandle,
    backend_id: Option<String>,
) -> Result<native_audio::NativeAudioComponentsStatePayload, String> {
    tauri::async_runtime::spawn_blocking(move || {
        native_audio::select_output_backend(&app, backend_id)
    })
    .await
    .map_err(|e| format!("Native audio select output backend task failed: {e}"))?
}

#[tauri::command]
pub async fn native_audio_list_audio_inputs() -> Result<Vec<String>, String> {
    native_audio::list_audio_inputs()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_select_audio_input(
    app: tauri::AppHandle,
    input_id: Option<String>,
) -> Result<native_audio::NativeAudioComponentsStatePayload, String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::select_audio_input(&app, input_id))
        .await
        .map_err(|e| format!("Native audio select audio input task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_decoder_sidecar_describe_provider(
    provider_id: String,
    protocol_version: Option<String>,
) -> Result<decoder_sidecar::DecoderSidecarDescribeProviderResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        decoder_sidecar::describe_provider(decoder_sidecar::DecoderSidecarDescribeProviderRequest {
            provider_id,
            protocol_version,
        })
    })
    .await
    .map_err(|e| format!("Decoder sidecar describe provider task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_decoder_sidecar_probe(
    provider_id: String,
    protocol_version: Option<String>,
    source_path: String,
    preferred_input_id: Option<String>,
) -> Result<decoder_sidecar::DecoderSidecarProbeResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        decoder_sidecar::probe(decoder_sidecar::DecoderSidecarProbeRequest {
            provider_id,
            protocol_version,
            source_path,
            preferred_input_id,
        })
    })
    .await
    .map_err(|e| format!("Decoder sidecar probe task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_decoder_sidecar_open_session(
    provider_id: String,
    protocol_version: Option<String>,
    source_path: String,
    preferred_input_id: Option<String>,
) -> Result<decoder_sidecar::DecoderSidecarOpenSessionResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        decoder_sidecar::open_session(decoder_sidecar::DecoderSidecarOpenSessionRequest {
            provider_id,
            protocol_version,
            source_path,
            preferred_input_id,
        })
    })
    .await
    .map_err(|e| format!("Decoder sidecar open session task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_decoder_sidecar_close_session(
    provider_id: String,
    protocol_version: Option<String>,
    session_id: Option<String>,
    provider_session_id: Option<String>,
) -> Result<decoder_sidecar::DecoderSidecarCloseSessionResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        decoder_sidecar::close_session(decoder_sidecar::DecoderSidecarCloseSessionRequest {
            provider_id,
            protocol_version,
            session_id,
            provider_session_id,
        })
    })
    .await
    .map_err(|e| format!("Decoder sidecar close session task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_decoder_sidecar_health(
    provider_id: String,
    protocol_version: Option<String>,
) -> Result<decoder_sidecar::DecoderSidecarHealthResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        decoder_sidecar::health(decoder_sidecar::DecoderSidecarHealthRequest {
            provider_id,
            protocol_version,
        })
    })
    .await
    .map_err(|e| format!("Decoder sidecar health task failed: {e}"))?
}

#[tauri::command]
pub async fn native_audio_get_audio_components_state(
) -> Result<native_audio::NativeAudioComponentsStatePayload, String> {
    native_audio::get_audio_components_state()
}

#[tauri::command]
pub async fn native_audio_get_streaming_buffer_settings(
    _app: tauri::AppHandle,
) -> Result<native_audio::NativeAudioStreamingBufferSettingsPayload, String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::get_streaming_buffer_settings())
        .await
        .map_err(|e| format!("Native audio get streaming buffer settings task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_set_streaming_buffer_settings(
    app: tauri::AppHandle,
    start_or_seek_seconds: Option<f64>,
    crossfade_seconds: Option<f64>,
    decode_mode: Option<String>,
    interactive_profile: Option<String>,
) -> Result<native_audio::NativeAudioStreamingBufferSettingsPayload, String> {
    tauri::async_runtime::spawn_blocking(move || {
        native_audio::set_streaming_buffer_settings(
            &app,
            start_or_seek_seconds,
            crossfade_seconds,
            decode_mode,
            interactive_profile,
        )
    })
    .await
    .map_err(|e| format!("Native audio set streaming buffer settings task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_set_spectrum_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::set_spectrum_enabled(&app, enabled))
        .await
        .map_err(|e| format!("Native audio set spectrum enabled task failed: {e}"))?
}

#[tauri::command]
pub async fn native_audio_get_engine_policy(
) -> Result<native_audio::NativeAudioEnginePolicyPayload, String> {
    native_audio::get_engine_policy()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_set_engine_policy(
    app: tauri::AppHandle,
    stability_profile: Option<native_audio::NativeAudioStabilityProfile>,
    transport_mode: Option<native_audio::NativeAudioTransportMode>,
    hq_src_enabled: Option<bool>,
    hq_src_phase_mode: Option<native_audio::NativeAudioHqSrcPhaseMode>,
    src_mode: Option<native_audio::NativeAudioSrcMode>,
    src_backend: Option<native_audio::NativeAudioSrcBackend>,
    src_target_sample_rate: Option<u32>,
    output_quantization_mode: Option<native_audio::NativeAudioOutputQuantizationMode>,
) -> Result<native_audio::NativeAudioEnginePolicyPayload, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let patch = native_audio::NativeAudioEnginePolicyPatch {
            stability_profile,
            transport_mode,
            hq_src_enabled,
            hq_src_phase_mode,
            src_mode,
            src_backend,
            src_target_sample_rate,
            output_quantization_mode,
        };
        native_audio::set_engine_policy(&app, patch)
    })
    .await
    .map_err(|e| format!("Native audio set engine policy task failed: {e}"))?
}

#[tauri::command]
pub async fn native_audio_list_devices() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(native_audio::list_output_devices)
        .await
        .map_err(|e| format!("Native audio list devices task failed: {e}"))?
}

#[tauri::command]
pub async fn native_audio_list_devices_v2(
) -> Result<Vec<native_audio::NativeAudioOutputDevicePayload>, String> {
    tauri::async_runtime::spawn_blocking(native_audio::list_output_devices_v2)
        .await
        .map_err(|e| format!("Native audio list devices v2 task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_select_device(
    app: tauri::AppHandle,
    device_id: Option<String>,
    device_name: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        native_audio::select_output_device(&app, device_id, device_name)
    })
    .await
    .map_err(|e| format!("Native audio select device task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_open_asio_control_panel(
    device_name: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::open_asio_control_panel(device_name))
        .await
        .map_err(|e| format!("Native audio open ASIO control panel task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_append_queue(
    app: tauri::AppHandle,
    queue: Vec<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::append_queue(&app, queue))
        .await
        .map_err(|e| format!("Native audio append queue task failed: {e}"))?
}

#[tauri::command]
pub async fn native_audio_clear_queue(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::clear_queue(&app))
        .await
        .map_err(|e| format!("Native audio clear queue task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_remove_queue_item(
    app: tauri::AppHandle,
    index: i32,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::remove_queue_item(&app, index))
        .await
        .map_err(|e| format!("Native audio remove queue item task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_move_queue_item(
    app: tauri::AppHandle,
    from_index: i32,
    to_index: i32,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        native_audio::move_queue_item(&app, from_index, to_index)
    })
    .await
    .map_err(|e| format!("Native audio move queue item task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_replace_queue_item_path(
    app: tauri::AppHandle,
    index: i32,
    path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        native_audio::replace_queue_item_path(&app, index, path)
    })
    .await
    .map_err(|e| format!("Native audio replace queue item path task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_sync_queue_index(
    app: tauri::AppHandle,
    current_index: i32,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        native_audio::sync_queue_index(&app, current_index)
    })
    .await
    .map_err(|e| format!("Native audio sync queue index task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_load_and_play_queue_index(
    app: tauri::AppHandle,
    index: i32,
    replay_gain_db: Option<f32>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        native_audio::load_and_play_queue_index(&app, index, replay_gain_db)
    })
    .await
    .map_err(|e| format!("Native audio load+play queue index task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_load_queue_index(
    app: tauri::AppHandle,
    index: i32,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native_audio::load_queue_index(&app, index))
        .await
        .map_err(|e| format!("Native audio load queue index task failed: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn native_audio_crossfade_to_queue_index(
    app: tauri::AppHandle,
    index: i32,
    duration_ms: u64,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        native_audio::crossfade_to_queue_index(&app, index, duration_ms)
    })
    .await
    .map_err(|e| format!("Native audio crossfade queue index task failed: {e}"))?
}
