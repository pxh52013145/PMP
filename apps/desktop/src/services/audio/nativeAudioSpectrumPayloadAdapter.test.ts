import { describe, expect, it } from 'vitest';
import {
  applyNativeAudioSpectrumPayload,
  type NativeAudioSpectrumPayloadState,
} from './nativeAudioSpectrumPayloadAdapter';

function createState(): NativeAudioSpectrumPayloadState {
  return {
    outputSampleRate: 48_000,
    sourceSampleRate: 44_100,
    spectrumData: null,
    spectrumFrames: {},
  };
}

describe('nativeAudioSpectrumPayloadAdapter', () => {
  it('applies legacy untapped float bins to default spectrum data', () => {
    const state = createState();

    const applied = applyNativeAudioSpectrumPayload(state, {
      bins: [0, 0.5, 1, 0.25, Number.NaN],
    });

    expect(applied).toBe(true);
    expect(Array.from(state.spectrumData ?? [])).toEqual([0, 128, 255, 64, 0]);
    expect(state.spectrumFrames).toEqual({});
  });

  it('stores tapped byte-encoded frames and uses payload metadata', () => {
    const state = createState();

    const applied = applyNativeAudioSpectrumPayload(state, {
      bins: [0, 64.4, 256, -1],
      timeDomain: [0, 127.5, 255, Number.NaN],
      frameId: 7,
      timestampMs: 1_234,
      tapId: 'post-dsp',
      sampleRate: 96_000,
    });

    expect(applied).toBe(true);
    expect(state.spectrumFrames['post-dsp']).toMatchObject({
      frameId: 7,
      timestampMs: 1_234,
      tap: 'post-dsp',
      sampleRate: 96_000,
    });
    expect(Array.from(state.spectrumFrames['post-dsp']?.bins ?? [])).toEqual([
      0,
      64,
      255,
      0,
    ]);
    expect(Array.from(state.spectrumFrames['post-dsp']?.timeDomain ?? [])).toEqual([
      0,
      128,
      255,
      128,
    ]);
    expect(state.spectrumData).toBe(state.spectrumFrames['post-dsp']?.bins);
  });

  it('preserves post-dsp default data when pre-dsp frames arrive later', () => {
    const state = createState();

    applyNativeAudioSpectrumPayload(state, {
      bins: [0.25, 0.75],
      tap: 'post-dsp',
      timestampMs: 10,
    });
    const postDspData = state.spectrumData;

    applyNativeAudioSpectrumPayload(state, {
      bins: [0.1, 0.2],
      tap: 'pre-dsp',
      timestampMs: 20,
    });

    expect(state.spectrumData).toBe(postDspData);
    expect(Array.from(state.spectrumFrames['pre-dsp']?.bins ?? [])).toEqual([26, 51]);
  });

  it('falls back to output sample rate and injected timestamp', () => {
    const state = createState();

    applyNativeAudioSpectrumPayload(
      state,
      {
        bins: [0.2],
        tap: 'pre-dsp',
      },
      {
        nowMs: () => 4_321,
      }
    );

    expect(state.spectrumFrames['pre-dsp']).toMatchObject({
      frameId: 0,
      timestampMs: 4_321,
      sampleRate: 48_000,
    });
  });

  it('ignores invalid payloads', () => {
    const state = createState();

    expect(applyNativeAudioSpectrumPayload(state, null)).toBe(false);
    expect(
      applyNativeAudioSpectrumPayload(state, {
        bins: undefined as unknown as number[],
      })
    ).toBe(false);
    expect(state.spectrumData).toBeNull();
  });
});
