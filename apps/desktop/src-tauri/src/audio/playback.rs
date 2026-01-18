use std::sync::Arc;

use crate::audio::input::{AudioInputKind, AudioInputMeta, AudioInputOpenResult, StreamingPlayback};
use crate::audio::output::BoxedSource;
use crate::audio::pipeline::{boxed_with_dsp, DspRuntime, SpectrumTap};

pub(crate) struct PreparedPlayback {
    pub input_id: &'static str,
    pub meta: AudioInputMeta,
    pub streaming: Option<StreamingPlayback>,
    pub decoded_samples: Option<Arc<Vec<f32>>>,
    pub source: BoxedSource,
}

pub(crate) fn prepare_playback(
    opened: AudioInputOpenResult,
    dsp: Arc<DspRuntime>,
    tap: SpectrumTap,
) -> PreparedPlayback {
    let AudioInputOpenResult {
        input_id,
        meta,
        kind,
        source,
    } = opened;

    let mut streaming: Option<StreamingPlayback> = None;
    let mut decoded_samples: Option<Arc<Vec<f32>>> = None;

    match kind {
        AudioInputKind::Streaming(playback) => {
            streaming = Some(playback);
        }
        AudioInputKind::Decoded { samples } => {
            decoded_samples = Some(samples);
        }
        AudioInputKind::Rodio => {}
    }

    let source = boxed_with_dsp(source, dsp, tap);

    PreparedPlayback {
        input_id,
        meta,
        streaming,
        decoded_samples,
        source,
    }
}

