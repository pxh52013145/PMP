import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapPerformanceRuntimeProfileStorage } from '../performanceRuntimeBootstrap';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';

describe('bootstrapPerformanceRuntimeProfileStorage', () => {
  const previousProfileEnv = import.meta.env.VITE_PERF_RUNTIME_PROFILE;

  beforeEach(() => {
    localStorage.clear();
    (import.meta.env as ImportMetaEnv & { VITE_PERF_RUNTIME_PROFILE?: string }).VITE_PERF_RUNTIME_PROFILE =
      previousProfileEnv;
  });

  it('aligns preset keys when runtime profile is minimal', () => {
    localStorage.setItem(STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE, JSON.stringify('minimal'));
    localStorage.setItem(STORAGE_KEYS.UI_QUALITY_SETTINGS_V1, JSON.stringify({
      version: 1,
      mode: 'fixed',
      fixedLevel: 'high',
      auto: {
        minLevel: 'potato',
        maxLevel: 'ultra',
        targetFpsForeground: 60,
        targetFpsBackground: 10,
        sampleWindowMs: 2500,
        downgradeCooldownMs: 2500,
        upgradeCooldownMs: 12000,
        jankFrameMs: 50,
        jankRatioDowngrade: 0.22,
        jankRatioUpgrade: 0.05,
      },
    }));
    localStorage.setItem(STORAGE_KEYS.BACKGROUND_RENDER_POLICY, JSON.stringify('full'));
    localStorage.setItem(STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX, JSON.stringify(512));

    const result = bootstrapPerformanceRuntimeProfileStorage();

    expect(result.runtimeProfile).toBe('minimal');
    expect(result.alignedKeys).toContain(STORAGE_KEYS.UI_QUALITY_SETTINGS_V1);
    expect(result.alignedKeys).toContain(STORAGE_KEYS.BACKGROUND_RENDER_POLICY);
    expect(result.alignedKeys).toContain(STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX);

    const uiQuality = JSON.parse(localStorage.getItem(STORAGE_KEYS.UI_QUALITY_SETTINGS_V1) ?? '{}') as {
      fixedLevel?: string;
      mode?: string;
    };
    expect(uiQuality.mode).toBe('fixed');
    expect(uiQuality.fixedLevel).toBe('potato');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.BACKGROUND_RENDER_POLICY) ?? 'null')).toBe('pause');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX) ?? 'null')).toBe(128);
  });

  it('does not overwrite custom profile fields', () => {
    localStorage.setItem(STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE, JSON.stringify('custom'));
    localStorage.setItem(STORAGE_KEYS.UI_QUALITY_SETTINGS_V1, JSON.stringify({
      version: 1,
      mode: 'fixed',
      fixedLevel: 'high',
      auto: {
        minLevel: 'potato',
        maxLevel: 'ultra',
        targetFpsForeground: 60,
        targetFpsBackground: 10,
        sampleWindowMs: 2500,
        downgradeCooldownMs: 2500,
        upgradeCooldownMs: 12000,
        jankFrameMs: 50,
        jankRatioDowngrade: 0.22,
        jankRatioUpgrade: 0.05,
      },
    }));

    const result = bootstrapPerformanceRuntimeProfileStorage();
    expect(result.runtimeProfile).toBe('custom');
    expect(result.alignedKeys).toHaveLength(0);

    const uiQuality = JSON.parse(localStorage.getItem(STORAGE_KEYS.UI_QUALITY_SETTINGS_V1) ?? '{}') as {
      fixedLevel?: string;
    };
    expect(uiQuality.fixedLevel).toBe('high');
  });

  it('honors forced runtime preset from env', () => {
    localStorage.setItem(STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE, JSON.stringify('custom'));
    localStorage.setItem(STORAGE_KEYS.BACKGROUND_RENDER_POLICY, JSON.stringify('full'));
    (
      import.meta.env as ImportMetaEnv & { VITE_PERF_RUNTIME_PROFILE?: string }
    ).VITE_PERF_RUNTIME_PROFILE = 'minimal';

    const result = bootstrapPerformanceRuntimeProfileStorage();

    expect(result.runtimeProfile).toBe('minimal');
    expect(result.alignedKeys).toContain(STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE);

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE) ?? 'null')).toBe(
      'minimal'
    );
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.BACKGROUND_RENDER_POLICY) ?? 'null')).toBe(
      'pause'
    );
  });
});
