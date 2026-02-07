use super::descriptor::BackendModuleDescriptor;

pub const DESCRIPTOR: BackendModuleDescriptor = BackendModuleDescriptor {
    id: "app",
    version: "1.0.0",
    display_name: "Application Runtime Module",
    depends_on: &[],
    command_domains: &["app"],
};
