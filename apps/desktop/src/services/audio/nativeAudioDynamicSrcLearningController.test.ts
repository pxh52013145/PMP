import { describe, expect, it } from 'vitest';
import {
  normalizeDynamicSrcLearningProfile,
  parseDynamicSrcLearningProfile,
  resolveDynamicSrcLearningScale,
  resolveDynamicSrcLearningUpdate,
} from './nativeAudioDynamicSrcLearningController';

describe('nativeAudioDynamicSrcLearningController', () => {
  it('parses, clamps, and trims learning profiles by recency', () => {
    const profile = parseDynamicSrcLearningProfile({
      raw: JSON.stringify({
        stale: { stressIndex: 99, updatedAtMs: 1 },
        newest: { stressIndex: 6, updatedAtMs: 3 },
        older: { stressIndex: -2, updatedAtMs: 2 },
        invalid: { stressIndex: 'bad', updatedAtMs: 4 },
      }),
      maxItems: 2,
    });

    expect(profile).toEqual({
      newest: { stressIndex: 6, updatedAtMs: 3 },
      older: { stressIndex: 0, updatedAtMs: 2 },
    });
  });

  it('normalizes existing profiles without mutating the input object', () => {
    const input = {
      a: { stressIndex: 2, updatedAtMs: 10 },
      b: { stressIndex: 20, updatedAtMs: 20 },
    };

    expect(normalizeDynamicSrcLearningProfile({ profile: input, maxItems: 1 })).toEqual({
      b: { stressIndex: 12, updatedAtMs: 20 },
    });
    expect(input.b?.stressIndex).toBe(20);
  });

  it('updates a device stress index with the same damped blend used by runtime learning', () => {
    const update = resolveDynamicSrcLearningUpdate({
      profile: {
        'wasapi::default': { stressIndex: 2, updatedAtMs: 1_000 },
      },
      deviceKey: 'wasapi::default',
      stressScore: 8,
      nowMs: 2_000,
      minDelta: 0.0005,
    });

    expect(update.changed).toBe(true);
    expect(update.profile['wasapi::default']).toEqual({
      stressIndex: 2.6,
      updatedAtMs: 2_000,
    });
  });

  it('resolves the bounded adaptive scale from learned stress', () => {
    expect(
      resolveDynamicSrcLearningScale({
        enabled: true,
        profile: {
          device: { stressIndex: 12, updatedAtMs: 1 },
        },
        deviceKey: 'device',
      })
    ).toBe(1.4);

    expect(
      resolveDynamicSrcLearningScale({
        enabled: false,
        profile: {
          device: { stressIndex: 12, updatedAtMs: 1 },
        },
        deviceKey: 'device',
      })
    ).toBe(1);
  });
});
