import type {
  AudioDynamicSrcAutoSettings,
  AudioTuningAutoSettings,
} from './types';

function clampMs(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function clampCount(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function resolveStoredDynamicSrcAutoSettings(input: {
  raw: string | null;
  defaults: AudioDynamicSrcAutoSettings;
}): AudioDynamicSrcAutoSettings {
  const fallback: AudioDynamicSrcAutoSettings = {
    ...input.defaults,
    enabled: true,
  };

  if (!input.raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(input.raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return fallback;
    }

    const record = parsed as Record<string, unknown>;
    return {
      enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
      adaptiveEnabled:
        typeof record.adaptiveEnabled === 'boolean' ? record.adaptiveEnabled : fallback.adaptiveEnabled,
      learningEnabled:
        typeof record.learningEnabled === 'boolean' ? record.learningEnabled : fallback.learningEnabled,
      restoreDebounceMs: clampMs(record.restoreDebounceMs, fallback.restoreDebounceMs, 500, 30_000),
      minSwitchIntervalMs: clampMs(record.minSwitchIntervalMs, fallback.minSwitchIntervalMs, 100, 10_000),
      seekHoldMs: clampMs(record.seekHoldMs, fallback.seekHoldMs, 500, 20_000),
      underrunHoldMs: clampMs(record.underrunHoldMs, fallback.underrunHoldMs, 2_000, 120_000),
      sharedStressHoldMs: clampMs(record.sharedStressHoldMs, fallback.sharedStressHoldMs, 1_000, 90_000),
      outputErrorHoldMs: clampMs(record.outputErrorHoldMs, fallback.outputErrorHoldMs, 1_000, 120_000),
    };
  } catch {
    return fallback;
  }
}

export function resolveStoredTuningAutoSettings(input: {
  raw: string | null;
  defaults: AudioTuningAutoSettings;
}): AudioTuningAutoSettings {
  if (!input.raw) {
    return input.defaults;
  }

  try {
    const parsed = JSON.parse(input.raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return input.defaults;
    }

    const record = parsed as Record<string, unknown>;
    const elevatedStressScore = clampCount(
      record.elevatedStressScore,
      input.defaults.elevatedStressScore,
      1,
      20,
    );
    const criticalStressScore = clampCount(
      record.criticalStressScore,
      input.defaults.criticalStressScore,
      elevatedStressScore,
      30,
    );

    return {
      enabled: typeof record.enabled === 'boolean' ? record.enabled : input.defaults.enabled,
      tickIntervalMs: clampMs(record.tickIntervalMs, input.defaults.tickIntervalMs, 500, 10_000),
      stableWindowMs: clampMs(record.stableWindowMs, input.defaults.stableWindowMs, 5_000, 120_000),
      minSwitchIntervalMs: clampMs(
        record.minSwitchIntervalMs,
        input.defaults.minSwitchIntervalMs,
        1_000,
        120_000,
      ),
      postSwitchObserveWindowMs: clampMs(
        record.postSwitchObserveWindowMs,
        input.defaults.postSwitchObserveWindowMs,
        1_000,
        120_000,
      ),
      elevatedStressScore,
      criticalStressScore,
      criticalUnderrunEventsWindow: clampCount(
        record.criticalUnderrunEventsWindow,
        input.defaults.criticalUnderrunEventsWindow,
        1,
        12,
      ),
      criticalOverflowGrowthTicks: clampCount(
        record.criticalOverflowGrowthTicks,
        input.defaults.criticalOverflowGrowthTicks,
        1,
        8,
      ),
    };
  } catch {
    return input.defaults;
  }
}
