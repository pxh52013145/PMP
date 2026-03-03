import type {
  AudioTuningAutoSettings,
  AudioTuningAutoSettingsPatch,
} from './types';

function clampMs(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function clampCount(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function resolveNextAudioTuningAutoSettings(input: {
  current: AudioTuningAutoSettings;
  patch: AudioTuningAutoSettingsPatch;
}): AudioTuningAutoSettings {
  const nextElevatedStressScore = clampCount(
    input.patch.elevatedStressScore,
    input.current.elevatedStressScore,
    1,
    20,
  );

  return {
    enabled: typeof input.patch.enabled === 'boolean' ? input.patch.enabled : input.current.enabled,
    tickIntervalMs: clampMs(input.patch.tickIntervalMs, input.current.tickIntervalMs, 500, 10_000),
    stableWindowMs: clampMs(input.patch.stableWindowMs, input.current.stableWindowMs, 5_000, 120_000),
    minSwitchIntervalMs: clampMs(
      input.patch.minSwitchIntervalMs,
      input.current.minSwitchIntervalMs,
      1_000,
      120_000,
    ),
    postSwitchObserveWindowMs: clampMs(
      input.patch.postSwitchObserveWindowMs,
      input.current.postSwitchObserveWindowMs,
      1_000,
      120_000,
    ),
    elevatedStressScore: nextElevatedStressScore,
    criticalStressScore: clampCount(
      input.patch.criticalStressScore,
      input.current.criticalStressScore,
      nextElevatedStressScore,
      30,
    ),
    criticalUnderrunEventsWindow: clampCount(
      input.patch.criticalUnderrunEventsWindow,
      input.current.criticalUnderrunEventsWindow,
      1,
      12,
    ),
    criticalOverflowGrowthTicks: clampCount(
      input.patch.criticalOverflowGrowthTicks,
      input.current.criticalOverflowGrowthTicks,
      1,
      8,
    ),
  };
}

