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
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u32>,
    pub device: Option<String>,
    pub queue: Option<Vec<String>>,
    pub current_index: Option<i32>,
    pub ended: bool,
    pub error_seq: Option<u64>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioSpectrumPayload {
    pub bins: Vec<f32>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioErrorPayload {
    pub seq: u64,
    pub code: String,
    pub message: String,
}

