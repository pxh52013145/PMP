pub(crate) mod atomic_f32;
pub(crate) mod buffer;
pub(crate) mod dsd2pcm;
pub(crate) mod emitter;
pub(crate) mod engine;
pub(crate) mod events;
pub mod input;
pub(crate) mod mixer;
pub mod output;
pub(crate) mod pipeline;
pub(crate) mod playback;
pub(crate) mod policy;
pub(crate) mod realtime_scheduler;
pub(crate) mod resample;
pub(crate) mod spectrum;
pub(crate) mod threading;

pub(crate) fn shutdown() {
    emitter::shutdown();
}
