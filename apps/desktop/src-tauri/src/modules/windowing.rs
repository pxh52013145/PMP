use super::descriptor::BackendModuleDescriptor;

pub const DESCRIPTOR: BackendModuleDescriptor = BackendModuleDescriptor {
    id: "windowing",
    version: "1.0.0",
    display_name: "Windowing Module",
    depends_on: &["performance"],
    command_domains: &["windows", "tray", "window_lifecycle"],
};
