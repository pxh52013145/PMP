import { describe, expect, it } from 'vitest';
import {
  clampQualityLevel,
  DEFAULT_QUALITY_SETTINGS_V1,
  guessInitialAutoQualityLevel,
  nextHigherQuality,
  nextLowerQuality,
  parseQualitySettings,
  resolveQualityProfile,
} from '../quality';

describe('quality contracts', () => {
  it('parses and clamps quality settings', () => {
    const parsed = parseQualitySettings({
      version: 1,
      mode: 'auto',
      fixedLevel: 'high',
      auto: {
        minLevel: 'potato',
        maxLevel: 'ultra',
        targetFpsForeground: 999,
        targetFpsBackground: 0,
        sampleWindowMs: 10,
        downgradeCooldownMs: -1,
        upgradeCooldownMs: 999999,
        jankFrameMs: 1,
        jankRatioDowngrade: 2,
        jankRatioUpgrade: -1,
      },
    });

    expect(parsed.version).toBe(1);
    expect(parsed.auto.targetFpsForeground).toBeLessThanOrEqual(240);
    expect(parsed.auto.targetFpsBackground).toBeGreaterThanOrEqual(1);
    expect(parsed.auto.sampleWindowMs).toBeGreaterThanOrEqual(800);
    expect(parsed.auto.downgradeCooldownMs).toBeGreaterThanOrEqual(0);
    expect(parsed.auto.upgradeCooldownMs).toBeLessThanOrEqual(120000);
    expect(parsed.auto.jankFrameMs).toBeGreaterThanOrEqual(16);
    expect(parsed.auto.jankRatioDowngrade).toBeLessThanOrEqual(1);
    expect(parsed.auto.jankRatioUpgrade).toBeGreaterThanOrEqual(0);
  });

  it('falls back for invalid settings', () => {
    expect(parseQualitySettings(null)).toEqual(DEFAULT_QUALITY_SETTINGS_V1);
    expect(parseQualitySettings({ version: 2 })).toEqual(DEFAULT_QUALITY_SETTINGS_V1);
  });

  it('clamps level between min and max', () => {
    expect(clampQualityLevel('ultra', 'potato', 'balanced')).toBe('balanced');
    expect(clampQualityLevel('potato', 'balanced', 'ultra')).toBe('balanced');
  });

  it('navigates levels in expected direction', () => {
    expect(nextLowerQuality('ultra')).toBe('high');
    expect(nextLowerQuality('potato')).toBe('potato');
    expect(nextHigherQuality('potato')).toBe('low');
    expect(nextHigherQuality('ultra')).toBe('ultra');
  });

  it('resolves profile deterministically', () => {
    const profile = resolveQualityProfile('balanced');
    expect(profile.renderScale).toBeGreaterThan(0);
    expect(profile.fpsBackground).toBeGreaterThan(0);
  });

  it('guesses initial auto level within range', () => {
    const guess = guessInitialAutoQualityLevel(DEFAULT_QUALITY_SETTINGS_V1);
    expect(['ultra', 'high', 'balanced', 'low', 'potato']).toContain(guess.level);
    expect(guess.detail.length).toBeGreaterThan(0);
  });
});
