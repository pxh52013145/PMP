use serde::Serialize;

use crate::audio::{diagnostics::AudioDiagnosticEvent, engine::SpectrumTapKind};

pub const NATIVE_AUDIO_STATE_EVENT: &str = "native_audio_state";
pub const NATIVE_AUDIO_SPECTRUM_EVENT: &str = "native_audio_spectrum";
pub const NATIVE_AUDIO_ERROR_EVENT: &str = "native_audio_error";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioStatePayload {
    pub playback_state: String,
    pub volume: f32,
    pub gain_db: f32,
    pub replay_gain_db: f32,
    pub dynamic_gain_enabled: bool,
    pub dynamic_gain_db: f32,
    pub muted: bool,
    pub track_path: Option<String>,
    pub current_time: f64,
    pub duration: f64,
    /// Absolute time position (seconds) up to which audio is currently buffered/ready.
    /// Semantics are "best-effort" and should be treated as a single contiguous range for UI.
    pub buffered_time: f64,
    /// How many seconds of audio are currently available ahead of `current_time`.
    pub buffered_ahead: f64,
    /// Decode-reservoir ahead seconds. For streaming inputs this represents decoded PCM waiting to
    /// be transferred into the render queue.
    pub decode_buffered_ahead: f64,
    /// Output-side render-queue ahead seconds. For streaming inputs this is the immediate queue
    /// consumed by the source feeding the sink.
    pub output_buffered_ahead: f64,
    pub sample_rate: Option<u32>,
    pub source_sample_rate: Option<u32>,
    pub bit_depth: Option<u32>,
    pub device: Option<String>,
    pub queue: Option<Vec<String>>,
    pub current_index: Option<i32>,
    pub ended: bool,
    pub underrun_events: u64,
    pub underrun_frames: u64,
    pub scheduler_profile: Option<String>,
    pub transport_mode: Option<String>,
    pub hq_src_phase_mode: Option<String>,
    pub src_mode: Option<String>,
    pub src_backend: Option<String>,
    pub src_target_sample_rate: Option<u32>,
    pub output_quantization_mode: Option<String>,
    pub hq_src_stopband_db: Option<u16>,
    pub hq_src_active: Option<bool>,
    pub hq_src_ratio: Option<f64>,
    pub transport_exact_int32_container: Option<bool>,
    pub output_callback_metrics_valid: Option<bool>,
    pub output_callback_p99_us: Option<u32>,
    pub output_wait_timeout_count: Option<u64>,
    pub output_render_underrun_events: Option<u64>,
    pub output_render_underrun_frames: Option<u64>,
    pub output_callback_interval_jitter_p99_us: Option<u32>,
    pub output_callback_interval_overrun_count: Option<u64>,
    pub output_callback_expected_interval_us: Option<u32>,
    pub transfer_low_watermark_samples: Option<u64>,
    pub transfer_render_low_hit_count: Option<u64>,
    pub transfer_decode_low_hit_count: Option<u64>,
    pub transfer_adaptation_level: Option<u64>,
    pub transfer_oscillation_streak: Option<u64>,
    pub render_queue_page_locked: Option<bool>,
    pub shared_render_ahead_enabled: Option<bool>,
    pub shared_render_underrun_events: Option<u64>,
    pub shared_render_underrun_frames: Option<u64>,
    pub shared_render_low_hit_count: Option<u64>,
    pub shared_render_low_watermark_samples: Option<u64>,
    pub memory_pool_f32_growth_events: Option<u64>,
    pub memory_pool_f32_growth_bytes: Option<u64>,
    pub memory_pool_f32_prewarm_hits: Option<u64>,
    pub control_queue_lock_free: Option<bool>,
    pub control_queue_mode: Option<String>,
    pub control_queue_capacity: Option<u64>,
    pub control_queue_overwrite_events: Option<u64>,
    pub control_queue_drop_newest_events: Option<u64>,
    pub control_queue_coalesced_overflow_events: Option<u64>,
    pub control_queue_critical_overflow_events: Option<u64>,
    pub retire_pending_tasks: Option<u64>,
    pub retire_enqueued_total: Option<u64>,
    pub retire_executed_total: Option<u64>,
    pub retire_inline_fallback_total: Option<u64>,
    pub retire_panic_total: Option<u64>,
    pub diagnostic_timeline_dropped_events: Option<u64>,
    pub diagnostic_timeline: Option<Vec<AudioDiagnosticEvent>>,
    pub error_seq: Option<u64>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioSpectrumFramePayload<'a> {
    pub frame_id: u64,
    pub timestamp_ms: u64,
    pub tap: SpectrumTapKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tap_id: Option<&'a str>,
    pub sample_rate: u32,
    pub bins: &'a [u8],
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioErrorPayload {
    pub seq: u64,
    pub code: String,
    pub message: String,
}
