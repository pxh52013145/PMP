use super::descriptor::BackendModuleDescriptor;

pub const DESCRIPTOR: BackendModuleDescriptor = BackendModuleDescriptor {
    id: "magnet",
    version: "1.0.0",
    display_name: "Magnet Layout Module",
    depends_on: &["windowing"],
    command_domains: &["magnet_layout_store"],
};
