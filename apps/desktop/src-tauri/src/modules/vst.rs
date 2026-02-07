use super::descriptor::BackendModuleDescriptor;

pub const DESCRIPTOR: BackendModuleDescriptor = BackendModuleDescriptor {
    id: "vst",
    version: "1.0.0",
    display_name: "VST Runtime Module",
    depends_on: &["audio-engine", "dsp", "windowing", "performance"],
    command_domains: &["vst_runtime", "vst_library", "vst_scan", "vst_compat", "vst_presets"],
};
