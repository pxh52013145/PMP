use serde::Serialize;
use std::collections::HashSet;

pub const APP_COMMAND_NAMES: &[&str] = &["greet", "app_request_exit", "app_restart"];

pub const DEBUG_COMMAND_NAMES: &[&str] = &[
    "debug_get_config",
    "debug_set_config",
    "debug_get_env_snapshot",
    "debug_get_recent_git_commits",
    "debug_get_editor_windows_state",
    "governance_destroy_hidden_editor_windows",
    "governance_destroy_hidden_plugin_windows",
    "governance_destroy_hidden_vst_manager_windows",
    "debug_get_process_perf_snapshot",
    "debug_get_process_perf_totals",
    "debug_get_backend_modules",
    "debug_get_registered_commands",
];

pub const MEDIA_COMMAND_NAMES: &[&str] = &["background_import_media", "ornament_import_media"];

pub const WINDOW_COMMAND_NAMES: &[&str] = &[
    "open_editor_window",
    "close_editor_window",
    "close_all_editor_windows",
    "open_plugin_window",
    "close_plugin_window",
    "open_vst_manager_window",
    "close_vst_manager_window",
    "set_editor_blur_enabled",
];

pub const LIBRARY_COMMAND_NAMES: &[&str] = &[
    "music_library_scan",
    "music_library_get_cover",
    "music_library_remove_cover",
    "music_library_cancel_scan",
    "music_library_db_upsert_source",
    "music_library_db_list_sources",
    "music_library_db_remove_source",
    "music_library_db_sync_tracks",
    "music_library_db_query_tracks",
    "music_library_db_list_artists",
    "music_library_db_list_genres",
    "music_library_db_list_albums",
    "music_library_db_get_stats",
];

pub const AUDIO_COMMAND_NAMES: &[&str] = &[
    "native_audio_load",
    "native_audio_load_and_play",
    "native_audio_play",
    "native_audio_crossfade_to",
    "native_audio_pause",
    "native_audio_stop",
    "native_audio_mark_seek_seq",
    "native_audio_seek",
    "native_audio_set_volume",
    "native_audio_set_mute",
    "native_audio_set_gain",
    "native_audio_set_replay_gain",
    "native_audio_set_dsp_chain",
    "native_audio_list_output_backends",
    "native_audio_select_output_backend",
    "native_audio_list_audio_inputs",
    "native_audio_select_audio_input",
    "native_audio_get_audio_components_state",
    "native_audio_get_streaming_buffer_settings",
    "native_audio_set_streaming_buffer_settings",
    "native_audio_set_spectrum_enabled",
    "native_audio_get_engine_policy",
    "native_audio_set_engine_policy",
    "native_audio_list_devices",
    "native_audio_list_devices_v2",
    "native_audio_select_device",
    "native_audio_open_asio_control_panel",
    "native_audio_sync_queue",
];

pub const DSP_COMMAND_NAMES: &[&str] =
    &["native_audio_get_dsp_graph", "native_audio_set_dsp_graph"];

pub const VST_COMMAND_NAMES: &[&str] = &[
    "native_audio_vst_list_plugins",
    "native_audio_vst_describe_plugin",
    "native_audio_vst_library_list_plugins",
    "native_audio_vst_library_get_plugin_params",
    "native_audio_vst_library_reset_plugin_scan_status",
    "native_audio_vst_library_invalidate_plugin_params_cache",
    "native_audio_vst_library_list_scan_runs",
    "native_audio_vst_library_list_scan_events",
    "native_audio_vst_library_get_scan_run_summary",
    "native_audio_vst_scan_paths_exist",
    "native_audio_vst_scan_start",
    "native_audio_vst_scan_cancel",
    "native_audio_vst_scan_state",
    "native_audio_vst_list_session_statuses",
    "native_audio_vst_set_enabled",
    "native_audio_vst_warmup",
    "native_audio_vst_open_native_editor",
    "native_audio_vst_close_native_editor",
    "native_audio_vst_bring_editors_to_front",
    "native_audio_vst_set_params",
    "native_audio_vst_set_param_value",
    "native_audio_vst_get_params",
    "native_audio_vst_dispose_session",
    "native_audio_vst_get_settings",
    "native_audio_vst_set_settings",
    "native_audio_vst_get_compatibility",
    "native_audio_vst_set_compat_rule",
    "native_audio_vst_clear_compat_rule",
    "native_audio_vst_list_presets",
    "native_audio_vst_save_preset",
    "native_audio_vst_delete_preset",
    "native_audio_vst_apply_preset",
    "native_audio_vst_get_locked_params",
    "native_audio_vst_set_param_locked",
    "native_audio_vst_get_audit_log",
    "native_audio_vst_clear_audit_log",
    "native_audio_vst_get_governance",
    "native_audio_vst_disable_plugin",
    "native_audio_vst_enable_plugin",
];

pub const MAGNET_LAYOUT_COMMAND_NAMES: &[&str] = &[
    "magnet_layout_store_get_state",
    "magnet_layout_store_bootstrap",
    "magnet_layout_store_apply_patch",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandDomainCatalogEntry {
    pub domain: &'static str,
    pub commands: &'static [&'static str],
}

pub fn list_command_catalog() -> Vec<CommandDomainCatalogEntry> {
    vec![
        CommandDomainCatalogEntry {
            domain: "app",
            commands: APP_COMMAND_NAMES,
        },
        CommandDomainCatalogEntry {
            domain: "debug",
            commands: DEBUG_COMMAND_NAMES,
        },
        CommandDomainCatalogEntry {
            domain: "media",
            commands: MEDIA_COMMAND_NAMES,
        },
        CommandDomainCatalogEntry {
            domain: "windows",
            commands: WINDOW_COMMAND_NAMES,
        },
        CommandDomainCatalogEntry {
            domain: "library",
            commands: LIBRARY_COMMAND_NAMES,
        },
        CommandDomainCatalogEntry {
            domain: "audio",
            commands: AUDIO_COMMAND_NAMES,
        },
        CommandDomainCatalogEntry {
            domain: "dsp",
            commands: DSP_COMMAND_NAMES,
        },
        CommandDomainCatalogEntry {
            domain: "vst",
            commands: VST_COMMAND_NAMES,
        },
        CommandDomainCatalogEntry {
            domain: "magnet-layout",
            commands: MAGNET_LAYOUT_COMMAND_NAMES,
        },
    ]
}

pub fn list_registered_command_names() -> Vec<&'static str> {
    let mut commands = Vec::new();
    for entry in list_command_catalog() {
        commands.extend_from_slice(entry.commands);
    }
    commands
}

pub fn registered_command_set() -> HashSet<&'static str> {
    list_registered_command_names().into_iter().collect()
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn has_duplicate_commands() -> bool {
    let commands = list_registered_command_names();
    let unique = registered_command_set();
    commands.len() != unique.len()
}

#[macro_export]
macro_rules! pmp_generate_handler {
    () => {
        tauri::generate_handler![
            crate::commands::app::greet,
            crate::commands::app::app_request_exit,
            crate::commands::app::app_restart,
            crate::commands::debug::debug_get_config,
            crate::commands::debug::debug_set_config,
            crate::commands::debug::debug_get_env_snapshot,
            crate::commands::debug::debug_get_recent_git_commits,
            crate::commands::debug::debug_get_editor_windows_state,
            crate::commands::debug::governance_destroy_hidden_editor_windows,
            crate::commands::debug::governance_destroy_hidden_plugin_windows,
            crate::commands::debug::governance_destroy_hidden_vst_manager_windows,
            crate::commands::debug::debug_get_process_perf_snapshot,
            crate::commands::debug::debug_get_process_perf_totals,
            crate::commands::debug::debug_get_backend_modules,
            crate::commands::debug::debug_get_registered_commands,
            crate::commands::media::background_import_media,
            crate::commands::media::ornament_import_media,
            crate::commands::windows::open_editor_window,
            crate::commands::windows::close_editor_window,
            crate::commands::windows::close_all_editor_windows,
            crate::commands::windows::open_plugin_window,
            crate::commands::windows::close_plugin_window,
            crate::commands::windows::open_vst_manager_window,
            crate::commands::windows::close_vst_manager_window,
            crate::commands::windows::set_editor_blur_enabled,
            crate::commands::library::music_library_scan,
            crate::commands::library::music_library_get_cover,
            crate::commands::library::music_library_remove_cover,
            crate::commands::library::music_library_cancel_scan,
            crate::commands::library::music_library_db_upsert_source,
            crate::commands::library::music_library_db_list_sources,
            crate::commands::library::music_library_db_remove_source,
            crate::commands::library::music_library_db_sync_tracks,
            crate::commands::library::music_library_db_query_tracks,
            crate::commands::library::music_library_db_list_artists,
            crate::commands::library::music_library_db_list_genres,
            crate::commands::library::music_library_db_list_albums,
            crate::commands::library::music_library_db_get_stats,
            crate::commands::audio::native_audio_load,
            crate::commands::audio::native_audio_load_and_play,
            crate::commands::audio::native_audio_play,
            crate::commands::audio::native_audio_crossfade_to,
            crate::commands::audio::native_audio_pause,
            crate::commands::audio::native_audio_stop,
            crate::commands::audio::native_audio_mark_seek_seq,
            crate::commands::audio::native_audio_seek,
            crate::commands::audio::native_audio_set_volume,
            crate::commands::audio::native_audio_set_mute,
            crate::commands::audio::native_audio_set_gain,
            crate::commands::audio::native_audio_set_replay_gain,
            crate::commands::audio::native_audio_set_dsp_chain,
            crate::commands::dsp::native_audio_get_dsp_graph,
            crate::commands::dsp::native_audio_set_dsp_graph,
            crate::commands::vst::native_audio_vst_list_plugins,
            crate::commands::vst::native_audio_vst_describe_plugin,
            crate::commands::vst::native_audio_vst_library_list_plugins,
            crate::commands::vst::native_audio_vst_library_get_plugin_params,
            crate::commands::vst::native_audio_vst_library_reset_plugin_scan_status,
            crate::commands::vst::native_audio_vst_library_invalidate_plugin_params_cache,
            crate::commands::vst::native_audio_vst_library_list_scan_runs,
            crate::commands::vst::native_audio_vst_library_list_scan_events,
            crate::commands::vst::native_audio_vst_library_get_scan_run_summary,
            crate::commands::vst::native_audio_vst_scan_paths_exist,
            crate::commands::vst::native_audio_vst_scan_start,
            crate::commands::vst::native_audio_vst_scan_cancel,
            crate::commands::vst::native_audio_vst_scan_state,
            crate::commands::vst::native_audio_vst_list_session_statuses,
            crate::commands::vst::native_audio_vst_set_enabled,
            crate::commands::vst::native_audio_vst_warmup,
            crate::commands::vst::native_audio_vst_open_native_editor,
            crate::commands::vst::native_audio_vst_close_native_editor,
            crate::commands::vst::native_audio_vst_bring_editors_to_front,
            crate::commands::vst::native_audio_vst_set_params,
            crate::commands::vst::native_audio_vst_set_param_value,
            crate::commands::vst::native_audio_vst_get_params,
            crate::commands::vst::native_audio_vst_dispose_session,
            crate::commands::vst::native_audio_vst_get_settings,
            crate::commands::vst::native_audio_vst_set_settings,
            crate::commands::vst::native_audio_vst_get_compatibility,
            crate::commands::vst::native_audio_vst_set_compat_rule,
            crate::commands::vst::native_audio_vst_clear_compat_rule,
            crate::commands::vst::native_audio_vst_list_presets,
            crate::commands::vst::native_audio_vst_save_preset,
            crate::commands::vst::native_audio_vst_delete_preset,
            crate::commands::vst::native_audio_vst_apply_preset,
            crate::commands::vst::native_audio_vst_get_locked_params,
            crate::commands::vst::native_audio_vst_set_param_locked,
            crate::commands::vst::native_audio_vst_get_audit_log,
            crate::commands::vst::native_audio_vst_clear_audit_log,
            crate::commands::vst::native_audio_vst_get_governance,
            crate::commands::vst::native_audio_vst_disable_plugin,
            crate::commands::vst::native_audio_vst_enable_plugin,
            crate::commands::audio::native_audio_list_output_backends,
            crate::commands::audio::native_audio_select_output_backend,
            crate::commands::audio::native_audio_list_audio_inputs,
            crate::commands::audio::native_audio_select_audio_input,
            crate::commands::audio::native_audio_get_audio_components_state,
            crate::commands::audio::native_audio_get_streaming_buffer_settings,
            crate::commands::audio::native_audio_set_streaming_buffer_settings,
            crate::commands::audio::native_audio_set_spectrum_enabled,
            crate::commands::audio::native_audio_get_engine_policy,
            crate::commands::audio::native_audio_set_engine_policy,
            crate::commands::audio::native_audio_list_devices,
            crate::commands::audio::native_audio_list_devices_v2,
            crate::commands::audio::native_audio_select_device,
            crate::commands::audio::native_audio_open_asio_control_panel,
            crate::commands::audio::native_audio_sync_queue,
            crate::magnet_layout_store::magnet_layout_store_get_state,
            crate::magnet_layout_store::magnet_layout_store_bootstrap,
            crate::magnet_layout_store::magnet_layout_store_apply_patch
        ]
    };
}

#[cfg(test)]
mod tests {
    use super::has_duplicate_commands;

    #[test]
    fn command_registry_has_no_duplicates() {
        assert!(!has_duplicate_commands());
    }
}
