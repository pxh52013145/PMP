use super::descriptor::BackendModuleDescriptor;

pub const DESCRIPTOR: BackendModuleDescriptor = BackendModuleDescriptor {
    id: "network",
    version: "1.0.0",
    display_name: "Network Module",
    depends_on: &["performance"],
    command_domains: &[],
};
