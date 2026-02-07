use super::descriptor::BackendModuleDescriptor;

pub const DESCRIPTOR: BackendModuleDescriptor = BackendModuleDescriptor {
    id: "dsp",
    version: "1.0.0",
    display_name: "DSP Graph Module",
    depends_on: &["audio-engine", "performance"],
    command_domains: &["dsp_graph"],
};
