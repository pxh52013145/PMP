// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use pixel_matrix_player::app_runtime::{EditorEffectsState, ExitFlag, HostFileOpenState};
use std::sync::Arc;

pub use pixel_matrix_player::{commands, magnet_layout_store};

fn is_minimal_boot_enabled() -> bool {
    std::env::var("PMP_MINIMAL_BOOT")
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            normalized == "1" || normalized == "true" || normalized == "yes"
        })
        .unwrap_or(false)
}

fn is_blank_baseline_profile(
    context: &tauri::Context<tauri::utils::assets::EmbeddedAssets>,
) -> bool {
    matches!(
        context.config().package.product_name.as_deref(),
        Some("Pixel Matrix Blank Baseline") | Some("Pixel Matrix Player Blank")
    )
}

fn main() {
    let context = tauri::generate_context!();

    if is_minimal_boot_enabled() || is_blank_baseline_profile(&context) {
        tauri::Builder::default()
            .register_uri_scheme_protocol("pmp", |app, request| {
                pixel_matrix_player::music_library::handle_pmp_protocol_request(app, request)
            })
            .run(context)
            .expect("error while running tauri application");
        return;
    }

    if let Some(exit_code) = pixel_matrix_player::asio_diag::maybe_run_from_cli() {
        std::process::exit(exit_code);
    }
    if let Some(exit_code) = pixel_matrix_player::audio_smoke::maybe_run_from_cli() {
        std::process::exit(exit_code);
    }
    if pixel_matrix_player::app_runtime::forward_live_host_file_open_to_running_instance_if_any() {
        return;
    }

    tauri::Builder::default()
        .register_uri_scheme_protocol("pmp", |app, request| {
            pixel_matrix_player::music_library::handle_pmp_protocol_request(app, request)
        })
        .manage(ExitFlag::new())
        .manage(EditorEffectsState::new(true))
        .manage(HostFileOpenState::new())
        .manage(Arc::new(
            pixel_matrix_player::perf_monitor::PerfMonitor::new(),
        ))
        .manage(pixel_matrix_player::sidecar_bridge::SidecarBridgeRegistry::new())
        .system_tray(pixel_matrix_player::app_builder::create_system_tray())
        .on_system_tray_event(|app, event| {
            pixel_matrix_player::app_builder::handle_system_tray_event(app, event)
        })
        .setup(pixel_matrix_player::app_builder::setup_app)
        .invoke_handler(pixel_matrix_player::pmp_generate_handler!())
        .run(context)
        .expect("error while running tauri application");
}
