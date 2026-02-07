use super::descriptor::BackendModuleDescriptor;

pub const DESCRIPTOR: BackendModuleDescriptor = BackendModuleDescriptor {
    id: "i18n",
    version: "1.0.0",
    display_name: "Localization Module",
    depends_on: &[],
    command_domains: &[],
};
