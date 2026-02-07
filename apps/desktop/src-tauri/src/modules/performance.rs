use super::descriptor::BackendModuleDescriptor;

pub const DESCRIPTOR: BackendModuleDescriptor = BackendModuleDescriptor {
    id: "performance",
    version: "1.0.0",
    display_name: "Performance Governance Module",
    depends_on: &[],
    command_domains: &["process_perf", "window_governance", "command_registry"],
};
