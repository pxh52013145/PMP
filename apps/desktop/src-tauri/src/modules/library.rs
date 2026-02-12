use super::descriptor::BackendModuleDescriptor;

pub const DESCRIPTOR: BackendModuleDescriptor = BackendModuleDescriptor {
    id: "library",
    version: "1.0.0",
    display_name: "Music Library Module",
    depends_on: &["performance", "tag"],
    command_domains: &[
        "music_library_scan",
        "music_library_cover",
        "music_library_cancel_scan",
    ],
};
