pub mod input;
pub mod output;
pub(crate) mod atomic_f32;
pub(crate) mod events;
pub(crate) mod engine;
pub(crate) mod emitter;
pub(crate) mod pipeline;
pub(crate) mod playback;
pub(crate) mod spectrum;
pub(crate) mod dsd2pcm;
pub(crate) mod resample;
pub(crate) mod resample_cache;

pub(crate) fn shutdown() {
    emitter::shutdown();
    resample_cache::shutdown_worker();
}
