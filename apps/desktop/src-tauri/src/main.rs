// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;

mod app_builder;
mod app_runtime;
mod asio_diag;
mod audio;
mod audio_smoke;
mod background_media;
mod commands;
mod debug_config;
mod dsp_graph;
mod magnet_layout_store;
mod modules;
mod music_library;
mod native_audio;
mod ornament_media;
mod perf_monitor;
mod vst_audit;
mod vst_bridge;
mod vst_compat;
mod vst_dsp;
mod vst_governance;
mod vst_instance_manager;
mod vst_library;
mod vst_presets;
mod vst_runtime;
mod vst_scanner;
mod vst_settings;
mod vst_shm;
mod windows;

use crate::app_runtime::{EditorEffectsState, ExitFlag};

#[cfg(test)]
mod tests {
    #[test]
    fn greet_returns_expected_message() {
        let message = crate::commands::app::greet("Tester");
        assert_eq!(message, "Hello, Tester! Welcome to Pixel Matrix Player!");
    }
}

fn is_minimal_boot_enabled() -> bool {
    std::env::var("PMP_MINIMAL_BOOT")
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            normalized == "1" || normalized == "true" || normalized == "yes"
        })
        .unwrap_or(false)
}

fn is_blank_baseline_profile(context: &tauri::Context<tauri::utils::assets::EmbeddedAssets>) -> bool {
    matches!(
        context.config().package.product_name.as_deref(),
        Some("Pixel Matrix Blank Baseline") | Some("Pixel Matrix Player Next Blank")
    )
}

fn main() {
    let context = tauri::generate_context!();

    if is_minimal_boot_enabled() || is_blank_baseline_profile(&context) {
        tauri::Builder::default()
            .run(context)
            .expect("error while running tauri application");
        return;
    }

    if let Some(exit_code) = asio_diag::maybe_run_from_cli() {
        std::process::exit(exit_code);
    }
    if let Some(exit_code) = audio_smoke::maybe_run_from_cli() {
        std::process::exit(exit_code);
    }

    tauri::Builder::default()
        .manage(ExitFlag::new())
        .manage(EditorEffectsState::new(true))
        .manage(Arc::new(perf_monitor::PerfMonitor::new()))
        .system_tray(app_builder::create_system_tray())
        .on_system_tray_event(|app, event| app_builder::handle_system_tray_event(app, event))
        .setup(app_builder::setup_app)
        .invoke_handler(crate::pmp_generate_handler!())
        .run(context)
        .expect("error while running tauri application");
}
