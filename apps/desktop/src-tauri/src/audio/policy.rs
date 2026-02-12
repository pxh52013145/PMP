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

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeAudioSrcMode {
    SourceNative,
    MatchOutput,
    TargetRate,
}

impl NativeAudioSrcMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SourceNative => "source-native",
            Self::MatchOutput => "match-output",
            Self::TargetRate => "target-rate",
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeAudioSrcBackend {
    Rubato,
    LinearSimd,
}

impl NativeAudioSrcBackend {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Rubato => "rubato",
            Self::LinearSimd => "linear-simd",
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeAudioOutputQuantizationMode {
    Round,
    Tpdf,
}

impl NativeAudioOutputQuantizationMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Round => "round",
            Self::Tpdf => "tpdf",
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioEnginePolicyPayload {
    pub transport_mode: NativeAudioTransportMode,
    pub hq_src_enabled: bool,
    pub hq_src_phase_mode: NativeAudioHqSrcPhaseMode,
    pub src_mode: NativeAudioSrcMode,
    pub src_backend: NativeAudioSrcBackend,
    pub src_target_sample_rate: Option<u32>,
    pub output_quantization_mode: NativeAudioOutputQuantizationMode,
    pub hq_src_stopband_db: u16,
    pub transport_exact_int32_container: bool,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioEnginePolicyPatch {
    pub transport_mode: Option<NativeAudioTransportMode>,
    pub hq_src_enabled: Option<bool>,
    pub hq_src_phase_mode: Option<NativeAudioHqSrcPhaseMode>,
    pub src_mode: Option<NativeAudioSrcMode>,
    pub src_backend: Option<NativeAudioSrcBackend>,
    pub src_target_sample_rate: Option<u32>,
    pub output_quantization_mode: Option<NativeAudioOutputQuantizationMode>,
}

impl NativeAudioEnginePolicyPatch {
    pub fn is_noop(&self) -> bool {
        self.transport_mode.is_none()
            && self.hq_src_enabled.is_none()
            && self.hq_src_phase_mode.is_none()
            && self.src_mode.is_none()
            && self.src_backend.is_none()
            && self.src_target_sample_rate.is_none()
            && self.output_quantization_mode.is_none()
    }
}
