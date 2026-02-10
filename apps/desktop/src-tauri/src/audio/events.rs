use serde::Serialize;

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
    pub muted: bool,
    pub track_path: Option<String>,
    pub current_time: f64,
    pub duration: f64,
    /// Absolute time position (seconds) up to which audio is currently buffered/ready.
    /// Semantics are "best-effort" and should be treated as a single contiguous range for UI.
    pub buffered_time: f64,
    /// How many seconds of audio are currently available ahead of `current_time`.
    pub buffered_ahead: f64,
    pub sample_rate: Option<u32>,
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
    pub hq_src_stopband_db: Option<u16>,
    pub transport_exact_int32_container: Option<bool>,
    pub output_callback_metrics_valid: Option<bool>,
    pub output_callback_p99_us: Option<u32>,
    pub output_wait_timeout_count: Option<u64>,
    pub output_render_underrun_events: Option<u64>,
    pub output_render_underrun_frames: Option<u64>,
    pub transfer_low_watermark_samples: Option<u64>,
    pub transfer_render_low_hit_count: Option<u64>,
    pub transfer_decode_low_hit_count: Option<u64>,
    pub render_queue_page_locked: Option<bool>,
    pub error_seq: Option<u64>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioSpectrumPayload<'a> {
    pub bins: &'a [f32],
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioErrorPayload {
    pub seq: u64,
    pub code: String,
    pub message: String,
}
