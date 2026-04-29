#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    if let Err(error) =
        pixel_matrix_player::music_platform_runtime::run_builtin_pack_provider_sidecar(
            "connector.platform.netease",
        )
    {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
