import type { AudioSpectrumFrame, AudioSpectrumTap } from './types';
import type { NativeAudioSpectrumPayload } from './nativeAudioServiceTypes';

export type NativeAudioSpectrumPayloadState = {
  outputSampleRate: number;
  sourceSampleRate: number;
  spectrumData: Uint8Array | null;
  spectrumFrames: Partial<Record<AudioSpectrumTap, AudioSpectrumFrame>>;
};

function resolveSpectrumTap(payload: NativeAudioSpectrumPayload): AudioSpectrumTap | null {
  if (payload.tapId === 'pre-dsp' || payload.tap === 'pre-dsp') return 'pre-dsp';
  if (payload.tapId === 'post-dsp' || payload.tap === 'post-dsp') return 'post-dsp';
  return null;
}

function isByteEncodedSpectrumBins(bins: number[]): boolean {
  const probeCount = Math.min(8, bins.length);
  for (let index = 0; index < probeCount; index += 1) {
    const value = bins[index];
    if (typeof value === 'number' && Number.isFinite(value) && value > 1.001) {
      return true;
    }
  }
  return false;
}

function ensureSpectrumBuffer(
  current: Uint8Array | null | undefined,
  length: number
): Uint8Array {
  if (current && current.length === length) return current;
  return new Uint8Array(length);
}

function copySpectrumBinsToTarget(
  bins: number[],
  target: Uint8Array,
  isByteEncodedBins: boolean
): void {
  for (let index = 0; index < bins.length; index += 1) {
    const value = typeof bins[index] === 'number' && Number.isFinite(bins[index]) ? bins[index] : 0;
    if (isByteEncodedBins) {
      target[index] = Math.max(0, Math.min(255, Math.round(value)));
      continue;
    }

    const clamped = Math.max(0, Math.min(1, value));
    target[index] = Math.round(clamped * 255);
  }
}

export function applyNativeAudioSpectrumPayload(
  state: NativeAudioSpectrumPayloadState,
  payload: NativeAudioSpectrumPayload | null | undefined,
  options?: {
    nowMs?: () => number;
  }
): boolean {
  if (!payload?.bins || !Array.isArray(payload.bins)) return false;

  const bins = payload.bins;
  const isByteEncodedBins = isByteEncodedSpectrumBins(bins);
  const tap = resolveSpectrumTap(payload);

  if (!tap) {
    const target = ensureSpectrumBuffer(state.spectrumData, bins.length);
    copySpectrumBinsToTarget(bins, target, isByteEncodedBins);
    state.spectrumData = target;
    return true;
  }

  const frameId =
    typeof payload.frameId === 'number' && Number.isFinite(payload.frameId) ? payload.frameId : 0;
  const timestampMs =
    typeof payload.timestampMs === 'number' && Number.isFinite(payload.timestampMs)
      ? payload.timestampMs
      : options?.nowMs?.() ?? Date.now();
  const sampleRate =
    typeof payload.sampleRate === 'number' && Number.isFinite(payload.sampleRate)
      ? payload.sampleRate
      : state.outputSampleRate || state.sourceSampleRate || 0;

  const existingBins = state.spectrumFrames[tap]?.bins;
  const target = ensureSpectrumBuffer(existingBins, bins.length);
  copySpectrumBinsToTarget(bins, target, isByteEncodedBins);

  state.spectrumFrames[tap] = {
    frameId,
    timestampMs,
    tap,
    sampleRate,
    bins: target,
  };

  // Default frequency data drives most visualizers: prefer post-dsp when available.
  if (tap === 'post-dsp' || !state.spectrumData) {
    state.spectrumData = target;
  }

  return true;
}
