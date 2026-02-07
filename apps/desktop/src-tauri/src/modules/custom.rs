use super::descriptor::BackendModuleDescriptor;

pub const DESCRIPTOR: BackendModuleDescriptor = BackendModuleDescriptor {
    id: "custom",
    version: "1.0.0",
    display_name: "Customization Module",
    depends_on: &["windowing"],
    command_domains: &["background_import_media", "ornament_import_media"],
};
