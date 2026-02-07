use super::descriptor::BackendModuleDescriptor;

pub const DESCRIPTOR: BackendModuleDescriptor = BackendModuleDescriptor {
    id: "keybind",
    version: "1.0.0",
    display_name: "Keybind Module",
    depends_on: &["windowing"],
    command_domains: &[],
};
