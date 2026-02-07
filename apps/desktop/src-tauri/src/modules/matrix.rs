use super::descriptor::BackendModuleDescriptor;

pub const DESCRIPTOR: BackendModuleDescriptor = BackendModuleDescriptor {
    id: "matrix",
    version: "1.0.0",
    display_name: "Matrix Compute Module",
    depends_on: &["magnet", "performance"],
    command_domains: &[],
};
