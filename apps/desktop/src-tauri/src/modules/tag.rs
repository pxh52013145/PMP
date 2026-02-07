use super::descriptor::BackendModuleDescriptor;

pub const DESCRIPTOR: BackendModuleDescriptor = BackendModuleDescriptor {
    id: "tag",
    version: "1.0.0",
    display_name: "Tag Metadata Module",
    depends_on: &["library"],
    command_domains: &[],
};
