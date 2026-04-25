use super::descriptor::BackendModuleDescriptor;

pub const DESCRIPTOR: BackendModuleDescriptor = BackendModuleDescriptor {
    id: "media",
    version: "1.0.0",
    display_name: "Media Asset Import Module",
    depends_on: &["custom", "performance"],
    command_domains: &["background_import_media"],
};
