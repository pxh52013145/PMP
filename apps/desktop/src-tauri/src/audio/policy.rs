use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NativeAudioTransportMode {
    Robust,
    TransportExact,
}

impl NativeAudioTransportMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Robust => "robust",
            Self::TransportExact => "transport-exact",
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NativeAudioHqSrcPhaseMode {
    Linear,
    Minimum,
    Intermediate,
}

impl NativeAudioHqSrcPhaseMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Linear => "linear",
            Self::Minimum => "minimum",
            Self::Intermediate => "intermediate",
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioEnginePolicyPayload {
    pub transport_mode: NativeAudioTransportMode,
    pub hq_src_enabled: bool,
    pub hq_src_phase_mode: NativeAudioHqSrcPhaseMode,
    pub hq_src_stopband_db: u16,
    pub transport_exact_int32_container: bool,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioEnginePolicyPatch {
    pub transport_mode: Option<NativeAudioTransportMode>,
    pub hq_src_enabled: Option<bool>,
    pub hq_src_phase_mode: Option<NativeAudioHqSrcPhaseMode>,
}

impl NativeAudioEnginePolicyPatch {
    pub fn is_noop(&self) -> bool {
        self.transport_mode.is_none() && self.hq_src_enabled.is_none() && self.hq_src_phase_mode.is_none()
    }
}

