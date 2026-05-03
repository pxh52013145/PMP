import { describe, expect, it, vi } from 'vitest';
import {
  NativeAudioDynamicSrcLearningController,
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

  it('owns learning update throttling and immediate persistence', () => {
    const persisted: unknown[] = [];
    const controller = new NativeAudioDynamicSrcLearningController({
      maxItems: 8,
      persistMinIntervalMs: 2_000,
      updateMinIntervalMs: 250,
      minDelta: 0.0005,
      persistProfile: (profile) => {
        persisted.push(profile);
      },
    });

    expect(
      controller.updateFromStress({
        enabled: true,
        stressScore: 8,
        nowMs: 2_500,
        deviceKey: 'wasapi::default',
      })
    ).toBe(true);
    expect(controller.getProfile()['wasapi::default']).toEqual({
      stressIndex: 0.8,
      updatedAtMs: 2_500,
    });
    expect(persisted).toEqual([
      {
        'wasapi::default': { stressIndex: 0.8, updatedAtMs: 2_500 },
      },
    ]);

    expect(
      controller.updateFromStress({
        enabled: true,
        stressScore: 9,
        nowMs: 2_600,
        deviceKey: 'wasapi::default',
      })
    ).toBe(false);
  });

  it('debounces learning persistence and clears pending timers on dispose', () => {
    const persisted: unknown[] = [];
    const timers: Array<{ handler: () => void; timeoutMs: number }> = [];
    const cleared: unknown[] = [];
    const controller = new NativeAudioDynamicSrcLearningController({
      maxItems: 8,
      persistMinIntervalMs: 2_000,
      updateMinIntervalMs: 0,
      minDelta: 0.0005,
      persistProfile: (profile) => {
        persisted.push(profile);
      },
      setTimeoutFn: (handler, timeoutMs) => {
        timers.push({ handler, timeoutMs });
        return { timer: timers.length } as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: (timer) => {
        cleared.push(timer);
      },
    });

    controller.restorePersistedProfile(
      JSON.stringify({ device: { stressIndex: 1, updatedAtMs: 1_000 } })
    );
    expect(
      controller.updateFromStress({
        enabled: true,
        stressScore: 5,
        nowMs: 500,
        deviceKey: 'device',
      })
    ).toBe(true);

    expect(persisted).toEqual([]);
    expect(timers).toEqual([{ handler: expect.any(Function), timeoutMs: 1_500 }]);

    controller.dispose();
    expect(cleared).toHaveLength(1);

    const persistSpy = vi.fn();
    const disabledController = new NativeAudioDynamicSrcLearningController({
      maxItems: 8,
      persistMinIntervalMs: 2_000,
      updateMinIntervalMs: 0,
      minDelta: 0.0005,
      persistProfile: persistSpy,
      setTimeoutFn: (handler, timeoutMs) => {
        timers.push({ handler, timeoutMs });
        return { timer: timers.length } as unknown as ReturnType<typeof setTimeout>;
      },
    });
    expect(
      disabledController.updateFromStress({
        enabled: false,
        stressScore: 10,
        nowMs: 3_000,
        deviceKey: 'device',
      })
    ).toBe(false);
    expect(persistSpy).not.toHaveBeenCalled();
  });
});
