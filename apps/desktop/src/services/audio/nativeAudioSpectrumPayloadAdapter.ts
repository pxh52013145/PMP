import type { AudioSpectrumFrame, AudioSpectrumTap } from './types';
import type { NativeAudioSpectrumPayload } from './nativeAudioServiceTypes';

export type NativeAudioSpectrumPayloadState = {
  outputSampleRate: number;
  sourceSampleRate: number;
  spectrumData: Uint8Array | null;
  spectrumFrames: Partial<Record<AudioSpectrumTap, AudioSpectrumFrame>>;
};

export type NativeAudioSpectrumBinaryFrame = {
  frameId: number;
  timestampMs: number;
  tap: AudioSpectrumTap;
  sampleRate: number;
  bins: Uint8Array;
  timeDomain?: Uint8Array;
};

const BINARY_FRAME_HEADER_BYTES = 32;
const BINARY_FRAME_VERSION = 1;
const FLAG_HAS_TIME_DOMAIN = 0b0000_0001;

function readU64AsNumber(view: DataView, offset: number): number {
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  return high * 0x1_0000_0000 + low;
}

export function decodeNativeAudioSpectrumBinaryFrame(
  buffer: ArrayBuffer
): NativeAudioSpectrumBinaryFrame | null {
  if (buffer.byteLength < BINARY_FRAME_HEADER_BYTES) return null;

  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4d || bytes[2] !== 0x53 || bytes[3] !== 0x31) {
    return null;
  }
  if (bytes[4] !== BINARY_FRAME_VERSION) return null;

  const tap = bytes[5] === 0 ? 'pre-dsp' : bytes[5] === 1 ? 'post-dsp' : null;
  if (!tap) return null;

  const flags = bytes[6] ?? 0;
  const view = new DataView(buffer);
  const frameId = readU64AsNumber(view, 8);
  const timestampMs = readU64AsNumber(view, 16);
  const sampleRate = view.getUint32(24, true);
  const binsLength = view.getUint16(28, true);
  const timeDomainLength = view.getUint16(30, true);
  const payloadLength = binsLength + timeDomainLength;
  if (buffer.byteLength !== BINARY_FRAME_HEADER_BYTES + payloadLength) return null;
  if ((flags & FLAG_HAS_TIME_DOMAIN) === 0 && timeDomainLength !== 0) return null;

  const bins = new Uint8Array(buffer, BINARY_FRAME_HEADER_BYTES, binsLength);
  const timeDomain =
    timeDomainLength > 0
      ? new Uint8Array(buffer, BINARY_FRAME_HEADER_BYTES + binsLength, timeDomainLength)
      : undefined;
  return {
    frameId,
    timestampMs,
    tap,
    sampleRate,
    bins,
    ...(timeDomain ? { timeDomain } : {}),
  };
}

export function applyNativeAudioSpectrumBinaryFrame(
  state: NativeAudioSpectrumPayloadState,
  frame: NativeAudioSpectrumBinaryFrame | null | undefined
): boolean {
  if (!frame || frame.bins.length === 0 || !Number.isFinite(frame.frameId)) return false;

  const previous = state.spectrumFrames[frame.tap];
  if (previous && frame.frameId <= previous.frameId) return false;

  state.spectrumFrames[frame.tap] = {
    frameId: frame.frameId,
    timestampMs: frame.timestampMs,
    tap: frame.tap,
    sampleRate: frame.sampleRate,
    bins: frame.bins,
    ...(frame.timeDomain ? { timeDomain: frame.timeDomain } : {}),
  };
  if (frame.tap === 'post-dsp' || !state.spectrumData) {
    state.spectrumData = frame.bins;
  }
  return true;
}

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

function copyByteValuesToTarget(values: number[], target: Uint8Array): void {
  for (let index = 0; index < values.length; index += 1) {
    const value = typeof values[index] === 'number' && Number.isFinite(values[index]) ? values[index] : 128;
    target[index] = Math.max(0, Math.min(255, Math.round(value)));
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
  const timeDomainPayload = Array.isArray(payload.timeDomain) ? payload.timeDomain : null;
  const existingTimeDomain = state.spectrumFrames[tap]?.timeDomain;
  const timeDomain = timeDomainPayload
    ? ensureSpectrumBuffer(existingTimeDomain, timeDomainPayload.length)
    : undefined;
  if (timeDomainPayload && timeDomain) {
    copyByteValuesToTarget(timeDomainPayload, timeDomain);
  }

  state.spectrumFrames[tap] = {
    frameId,
    timestampMs,
    tap,
    sampleRate,
    bins: target,
    ...(timeDomain ? { timeDomain } : {}),
  };

  // Default frequency data drives most visualizers: prefer post-dsp when available.
  if (tap === 'post-dsp' || !state.spectrumData) {
    state.spectrumData = target;
  }

  return true;
}
