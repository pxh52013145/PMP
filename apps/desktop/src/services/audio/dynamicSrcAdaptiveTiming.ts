import type { AudioDynamicSrcAdaptiveProfile } from './types';

export type DynamicSrcTimingBaseConfig = {
  restoreDebounceMs: number;
  minSwitchIntervalMs: number;
  seekHoldMs: number;
  underrunHoldMs: number;
  sharedStressHoldMs: number;
  outputErrorHoldMs: number;
};

export type DynamicSrcEffectiveTiming = {
  profile: AudioDynamicSrcAdaptiveProfile;
  stressScore: number;
  restoreDebounceMs: number;
  minSwitchIntervalMs: number;
  seekHoldMs: number;
  underrunHoldMs: number;
  sharedStressHoldMs: number;
  outputErrorHoldMs: number;
};

export type ResolveDynamicSrcAdaptiveProfileInput = {
  adaptiveEnabled: boolean;
  stressScore: number;
  elevatedScoreThreshold: number;
  criticalScoreThreshold: number;
};

export type ResolveDynamicSrcEffectiveTimingInput = {
  adaptiveEnabled: boolean;
  stressScore: number;
  learningScale: number;
  elevatedScoreThreshold: number;
  criticalScoreThreshold: number;
  base: DynamicSrcTimingBaseConfig;
};

export function resolveDynamicSrcAdaptiveProfile(
  input: ResolveDynamicSrcAdaptiveProfileInput
): AudioDynamicSrcAdaptiveProfile {
  if (!input.adaptiveEnabled) {
    return 'baseline';
  }
  if (input.stressScore >= input.criticalScoreThreshold) {
    return 'critical';
  }
  if (input.stressScore >= input.elevatedScoreThreshold) {
    return 'elevated';
  }
  return 'baseline';
}

export function getDynamicSrcAdaptiveScale(profile: AudioDynamicSrcAdaptiveProfile): number {
  if (profile === 'critical') return 1.8;
  if (profile === 'elevated') return 1.35;
  return 1;
}

export function resolveDynamicSrcEffectiveTiming(
  input: ResolveDynamicSrcEffectiveTimingInput
): DynamicSrcEffectiveTiming {
  const profile = resolveDynamicSrcAdaptiveProfile({
    adaptiveEnabled: input.adaptiveEnabled,
    stressScore: input.stressScore,
    elevatedScoreThreshold: input.elevatedScoreThreshold,
    criticalScoreThreshold: input.criticalScoreThreshold,
  });
  const scale = getDynamicSrcAdaptiveScale(profile) * Math.max(0.5, input.learningScale);

  const scaleMs = (
    value: number,
    options: { min: number; max: number; inverse?: boolean }
  ): number => {
    const raw = options.inverse ? value / scale : value * scale;
    return Math.max(options.min, Math.min(options.max, Math.floor(raw)));
  };

  return {
    profile,
    stressScore: Math.max(0, Math.floor(input.stressScore)),
    restoreDebounceMs: scaleMs(input.base.restoreDebounceMs, { min: 500, max: 30_000 }),
    minSwitchIntervalMs: scaleMs(input.base.minSwitchIntervalMs, {
      min: 100,
      max: 10_000,
      inverse: true,
    }),
    seekHoldMs: scaleMs(input.base.seekHoldMs, { min: 500, max: 20_000 }),
    underrunHoldMs: scaleMs(input.base.underrunHoldMs, { min: 2_000, max: 120_000 }),
    sharedStressHoldMs: scaleMs(input.base.sharedStressHoldMs, { min: 1_000, max: 90_000 }),
    outputErrorHoldMs: scaleMs(input.base.outputErrorHoldMs, { min: 1_000, max: 120_000 }),
  };
}
