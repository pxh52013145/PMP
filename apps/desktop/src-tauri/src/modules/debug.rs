use super::descriptor::BackendModuleDescriptor;

pub const DESCRIPTOR: BackendModuleDescriptor = BackendModuleDescriptor {
    id: "debug",
    version: "1.0.0",
    display_name: "Debug Diagnostics Module",
    depends_on: &["performance", "windowing"],
    command_domains: &["debug", "process_perf", "governance"],
};
