import { describe, expect, it } from 'vitest';

import {
  getDynamicSrcAdaptiveScale,
  resolveDynamicSrcAdaptiveProfile,
  resolveDynamicSrcEffectiveTiming,
} from '../dynamicSrcAdaptiveTiming';

describe('dynamicSrcAdaptiveTiming', () => {
  it('resolves adaptive profile by stress thresholds', () => {
    expect(
      resolveDynamicSrcAdaptiveProfile({
        adaptiveEnabled: false,
        stressScore: 12,
        elevatedScoreThreshold: 4,
        criticalScoreThreshold: 8,
      })
    ).toBe('baseline');

    expect(
      resolveDynamicSrcAdaptiveProfile({
        adaptiveEnabled: true,
        stressScore: 5,
        elevatedScoreThreshold: 4,
        criticalScoreThreshold: 8,
      })
    ).toBe('elevated');

    expect(
      resolveDynamicSrcAdaptiveProfile({
        adaptiveEnabled: true,
        stressScore: 9,
        elevatedScoreThreshold: 4,
        criticalScoreThreshold: 8,
      })
    ).toBe('critical');
  });

  it('maps profile to adaptive scale', () => {
    expect(getDynamicSrcAdaptiveScale('baseline')).toBe(1);
    expect(getDynamicSrcAdaptiveScale('elevated')).toBe(1.35);
    expect(getDynamicSrcAdaptiveScale('critical')).toBe(1.8);
  });

  it('computes scaled timing envelope for stressed profile', () => {
    const result = resolveDynamicSrcEffectiveTiming({
      adaptiveEnabled: true,
      stressScore: 9,
      learningScale: 1.2,
      elevatedScoreThreshold: 4,
      criticalScoreThreshold: 8,
      base: {
        restoreDebounceMs: 4000,
        minSwitchIntervalMs: 600,
        seekHoldMs: 2000,
        underrunHoldMs: 12000,
        sharedStressHoldMs: 8000,
        outputErrorHoldMs: 10000,
      },
    });

    expect(result.profile).toBe('critical');
    expect(result.stressScore).toBe(9);
    expect(result.restoreDebounceMs).toBeGreaterThan(4000);
    expect(result.minSwitchIntervalMs).toBeLessThan(600);
    expect(result.underrunHoldMs).toBeGreaterThan(12000);
  });

  it('keeps baseline timings unchanged with neutral scale', () => {
    const result = resolveDynamicSrcEffectiveTiming({
      adaptiveEnabled: true,
      stressScore: 0,
      learningScale: 1,
      elevatedScoreThreshold: 4,
      criticalScoreThreshold: 8,
      base: {
        restoreDebounceMs: 4000,
        minSwitchIntervalMs: 600,
        seekHoldMs: 2000,
        underrunHoldMs: 12000,
        sharedStressHoldMs: 8000,
        outputErrorHoldMs: 10000,
      },
    });

    expect(result.profile).toBe('baseline');
    expect(result.restoreDebounceMs).toBe(4000);
    expect(result.minSwitchIntervalMs).toBe(600);
    expect(result.seekHoldMs).toBe(2000);
  });
});
