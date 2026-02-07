use super::descriptor::BackendModuleDescriptor;

pub const DESCRIPTOR: BackendModuleDescriptor = BackendModuleDescriptor {
    id: "audio-engine",
    version: "1.0.0",
    display_name: "Audio Engine Module",
    depends_on: &["dsp", "performance"],
    command_domains: &["native_audio", "audio_backend", "audio_devices"],
};
