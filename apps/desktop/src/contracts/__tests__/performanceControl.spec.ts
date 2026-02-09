import { describe, expect, it } from 'vitest';
import {
  inferPerformanceRuntimeProfile,
  resolvePerformancePressureLevel,
  resolvePerformanceRuntimePresetSettings,
} from '../performanceControl';

describe('performanceControl contract', () => {
  it('returns high on severe tier/cpu/private pressure', () => {
    expect(
      resolvePerformancePressureLevel({
        memoryTier: 2,
        webview2PrivateBytes: 100 * 1024 * 1024,
        webview2CpuPercent: 5,
      })
    ).toBe('high');

    expect(
      resolvePerformancePressureLevel({
        memoryTier: 0,
        webview2PrivateBytes: 900 * 1024 * 1024,
        webview2CpuPercent: 5,
      })
    ).toBe('high');

    expect(
      resolvePerformancePressureLevel({
        memoryTier: 0,
        webview2PrivateBytes: 200 * 1024 * 1024,
        webview2CpuPercent: 56,
      })
    ).toBe('high');
  });

  it('returns watch on moderate pressure', () => {
    expect(
      resolvePerformancePressureLevel({
        memoryTier: 1,
        webview2PrivateBytes: 100 * 1024 * 1024,
        webview2CpuPercent: 10,
      })
    ).toBe('watch');

    expect(
      resolvePerformancePressureLevel({
        memoryTier: 0,
        webview2PrivateBytes: 700 * 1024 * 1024,
        webview2CpuPercent: 10,
      })
    ).toBe('watch');
  });

  it('returns normal on low pressure', () => {
    expect(
      resolvePerformancePressureLevel({
        memoryTier: 0,
        webview2PrivateBytes: 120 * 1024 * 1024,
        webview2CpuPercent: 12,
      })
    ).toBe('normal');
  });

  it('infers preset profile from resolved preset settings', () => {
    expect(inferPerformanceRuntimeProfile(resolvePerformanceRuntimePresetSettings('minimal'))).toBe(
      'minimal'
    );
    expect(inferPerformanceRuntimeProfile(resolvePerformanceRuntimePresetSettings('balanced'))).toBe(
      'balanced'
    );
    expect(inferPerformanceRuntimeProfile(resolvePerformanceRuntimePresetSettings('boosted'))).toBe(
      'boosted'
    );
  });

  it('marks profile as custom when settings drift from any preset', () => {
    const minimal = resolvePerformanceRuntimePresetSettings('minimal');
    const custom = {
      ...minimal,
      coverMaxEdgePx: minimal.coverMaxEdgePx + 1,
    };

    expect(inferPerformanceRuntimeProfile(custom)).toBe('custom');
  });
});
