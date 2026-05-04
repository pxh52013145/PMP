import { describe, expect, it } from 'vitest';
import {
  NATIVE_AUDIO_DIAGNOSTIC_TIMELINE_MAX_ENTRIES,
  normalizeNativeAudioDiagnosticTimeline,
} from './nativeAudioDiagnosticTimelineAdapter';

describe('nativeAudioDiagnosticTimelineAdapter', () => {
  it('normalizes timeline entries with the same clamping used by native listeners', () => {
    const timeline = normalizeNativeAudioDiagnosticTimeline([
      {
        seq: 1.8,
        timestampMs: 123.9,
        kind: ' shared.render.low_watermark ',
        value: 4.7,
        aux: 512.3,
      },
      {
        seq: 2,
        timestampMs: 200,
        kind: 'shared.render.underrun',
        value: Number.NaN,
        aux: -10,
      },
    ]);

    expect(timeline).toEqual([
      {
        seq: 1,
        timestampMs: 123,
        kind: 'shared.render.low_watermark',
        value: 4,
        aux: 512,
      },
      {
        seq: 2,
        timestampMs: 200,
        kind: 'shared.render.underrun',
        value: 0,
        aux: 0,
      },
    ]);
  });

  it('filters entries missing finite sequence, timestamp, or kind', () => {
    const timeline = normalizeNativeAudioDiagnosticTimeline([
      null,
      { seq: Number.NaN, timestampMs: 1, kind: 'bad-seq' },
      { seq: 1, timestampMs: Infinity, kind: 'bad-time' },
      { seq: 2, timestampMs: 2, kind: '   ' },
      { seq: 3, timestampMs: 3, kind: 'ok' },
    ]);

    expect(timeline).toEqual([
      {
        seq: 3,
        timestampMs: 3,
        kind: 'ok',
        value: 0,
        aux: 0,
      },
    ]);
  });

  it('keeps only the most recent timeline entries', () => {
    const input = Array.from(
      { length: NATIVE_AUDIO_DIAGNOSTIC_TIMELINE_MAX_ENTRIES + 3 },
      (_, index) => ({
        seq: index,
        timestampMs: index,
        kind: `event-${index}`,
      })
    );

    const timeline = normalizeNativeAudioDiagnosticTimeline(input);

    expect(timeline).toHaveLength(NATIVE_AUDIO_DIAGNOSTIC_TIMELINE_MAX_ENTRIES);
    expect(timeline?.[0]?.seq).toBe(3);
    expect(timeline?.at(-1)?.seq).toBe(26);
  });

  it('returns null for non-array payloads', () => {
    expect(normalizeNativeAudioDiagnosticTimeline(null)).toBeNull();
    expect(normalizeNativeAudioDiagnosticTimeline({})).toBeNull();
  });
});
