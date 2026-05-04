use super::descriptor::BackendModuleDescriptor;

pub const DESCRIPTOR: BackendModuleDescriptor = BackendModuleDescriptor {
    id: "editor",
    version: "1.0.0",
    display_name: "Editor Window Module",
    depends_on: &["windowing", "custom", "performance"],
    command_domains: &[
        "open_editor_window",
        "close_editor_window",
        "editor_effects",
        "set_editor_memory_first_enabled",
    ],
};
