pub(crate) mod atomic_f32;
pub(crate) mod buffer;
pub(crate) mod buffer_policy;
pub(crate) mod bulk_source;
pub(crate) mod control_plane;
pub(crate) mod decoder_sidecar;
pub(crate) mod diagnostics;
pub(crate) mod dsd2pcm;
pub(crate) mod emitter;
pub(crate) mod engine;
pub(crate) mod events;
pub mod input;
pub(crate) mod kernel;
pub(crate) mod memory_pool;
pub(crate) mod mixer;
#[allow(dead_code)]
pub(crate) mod nn_processor;
#[allow(dead_code)]
pub(crate) mod nn_runtime;
pub mod output;
pub(crate) mod pipeline;
pub(crate) mod policy;
pub(crate) mod realtime_memory_guard;
pub(crate) mod realtime_scheduler;
pub(crate) mod resample;
pub(crate) mod retire_plane;
pub(crate) mod source;
pub(crate) mod spectrum;
pub(crate) mod stability;
pub(crate) mod stability_controller;
pub(crate) mod threading;

pub(crate) fn shutdown() {
    retire_plane::shutdown();
    emitter::shutdown();
}
