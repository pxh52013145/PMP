use super::descriptor::BackendModuleDescriptor;

pub fn list_backend_modules() -> Vec<BackendModuleDescriptor> {
    vec![
        super::app::DESCRIPTOR.clone(),
        super::matrix::DESCRIPTOR.clone(),
        super::magnet::DESCRIPTOR.clone(),
        super::custom::DESCRIPTOR.clone(),
        super::media::DESCRIPTOR.clone(),
        super::editor::DESCRIPTOR.clone(),
        super::windowing::DESCRIPTOR.clone(),
        super::audio::DESCRIPTOR.clone(),
        super::dsp::DESCRIPTOR.clone(),
        super::vst::DESCRIPTOR.clone(),
        super::library::DESCRIPTOR.clone(),
        super::debug::DESCRIPTOR.clone(),
        super::performance::DESCRIPTOR.clone(),
        super::keybind::DESCRIPTOR.clone(),
        super::i18n::DESCRIPTOR.clone(),
        super::network::DESCRIPTOR.clone(),
        super::tag::DESCRIPTOR.clone(),
    ]
}
