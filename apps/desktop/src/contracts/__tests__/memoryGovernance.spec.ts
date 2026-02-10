import { describe, expect, it } from 'vitest';
import { decideMemoryGovernancePlan } from '../memoryGovernance';

describe('decideMemoryGovernancePlan', () => {
  it('returns tier 0 when under budgets', () => {
    const plan = decideMemoryGovernancePlan({
      atMs: Date.now(),
      isTauri: false,
      navigationHistoryBytes: 10_000,
      coverBlobUrlTotalBytes: 1_000_000,
      coverBlobUrlCacheEntries: 3,
      coverUrlCacheEntries: 10,
      coverUrlInflight: 0,
      albumCoverUrlCacheEntries: 2,
    });
    expect(plan.tier).toBe(0);
    expect(plan.actions).toEqual([]);
  });

  it('clears cover caches at tier 1', () => {
    const plan = decideMemoryGovernancePlan({
      atMs: Date.now(),
      isTauri: false,
      navigationHistoryBytes: 10_000,
      coverBlobUrlTotalBytes: 30 * 1024 * 1024,
      coverBlobUrlCacheEntries: 10,
      coverUrlCacheEntries: 1024,
      coverUrlInflight: 0,
      albumCoverUrlCacheEntries: 2,
    });
    expect(plan.tier).toBeGreaterThanOrEqual(1);
    expect(plan.actions).toContain('tighten-cover-runtime-caches-watch');
  });

  it('triggers watch tightening with lower runtime cache counts', () => {
    const plan = decideMemoryGovernancePlan({
      atMs: Date.now(),
      isTauri: true,
      navigationHistoryBytes: 700_000,
      coverBlobUrlTotalBytes: 10 * 1024 * 1024,
      coverBlobUrlCacheEntries: 140,
      coverUrlCacheEntries: 340,
      coverUrlInflight: 0,
      albumCoverUrlCacheEntries: 30,
    });

    expect(plan.tier).toBeGreaterThanOrEqual(1);
    expect(plan.actions).toContain('tighten-cover-runtime-caches-watch');
  });

  it('escalates cover cache tightening under high pressure', () => {
    const plan = decideMemoryGovernancePlan({
      atMs: Date.now(),
      isTauri: true,
      navigationHistoryBytes: 2_200_000,
      coverBlobUrlTotalBytes: 32 * 1024 * 1024,
      coverBlobUrlCacheEntries: 420,
      coverUrlCacheEntries: 1200,
      coverUrlInflight: 0,
      albumCoverUrlCacheEntries: 300,
      webview2: {
        processSampleAtMs: Date.now(),
        sampleIntervalMs: 1000,
        cpuCount: 8,
        webview2WorkingSetBytes: 1_650 * 1024 * 1024,
        webview2PrivateBytes: 1_250 * 1024 * 1024,
        webview2CpuPercent: 62,
        treeWorkingSetBytes: 2_000 * 1024 * 1024,
        treePrivateBytes: 2_400 * 1024 * 1024,
        treeCpuPercent: 70,
      },
    });

    expect(plan.tier).toBe(3);
    expect(plan.actions).toContain('tighten-cover-runtime-caches-watch');
    expect(plan.actions).toContain('tighten-cover-runtime-caches-high');
    expect(plan.actions).toContain('tighten-cover-runtime-caches-critical');
  });

  it('destroys hidden editor windows at tier 2+ in tauri runtime', () => {
    const plan = decideMemoryGovernancePlan({
      atMs: Date.now(),
      isTauri: true,
      navigationHistoryBytes: 1_500_000,
      coverBlobUrlTotalBytes: 2 * 1024 * 1024,
      coverBlobUrlCacheEntries: 10,
      coverUrlCacheEntries: 10,
      coverUrlInflight: 0,
      albumCoverUrlCacheEntries: 2,
    });
    expect(plan.tier).toBeGreaterThanOrEqual(2);
    expect(plan.actions).toContain('destroy-hidden-editor-windows');
    expect(plan.actions).toContain('destroy-hidden-plugin-windows');
    expect(plan.actions).toContain('destroy-hidden-vst-manager-windows');
  });

  it('promotes tier when webview2 private bytes is high', () => {
    const plan = decideMemoryGovernancePlan({
      atMs: Date.now(),
      isTauri: true,
      navigationHistoryBytes: 10_000,
      coverBlobUrlTotalBytes: 2 * 1024 * 1024,
      coverBlobUrlCacheEntries: 10,
      coverUrlCacheEntries: 10,
      coverUrlInflight: 0,
      albumCoverUrlCacheEntries: 2,
      webview2: {
        processSampleAtMs: Date.now(),
        sampleIntervalMs: 1000,
        cpuCount: 8,
        webview2WorkingSetBytes: 920 * 1024 * 1024,
        webview2PrivateBytes: 900 * 1024 * 1024,
        webview2CpuPercent: 18,
        treeWorkingSetBytes: 1300 * 1024 * 1024,
        treePrivateBytes: 1500 * 1024 * 1024,
        treeCpuPercent: 22,
      },
    });

    expect(plan.tier).toBeGreaterThanOrEqual(2);
    expect(plan.actions).toContain('destroy-hidden-editor-windows');
    expect(plan.actions).toContain('destroy-hidden-plugin-windows');
    expect(plan.actions).toContain('destroy-hidden-vst-manager-windows');
  });

  it('promotes tier when webview2 cpu pressure is high', () => {
    const plan = decideMemoryGovernancePlan({
      atMs: Date.now(),
      isTauri: true,
      navigationHistoryBytes: 10_000,
      coverBlobUrlTotalBytes: 2 * 1024 * 1024,
      coverBlobUrlCacheEntries: 10,
      coverUrlCacheEntries: 10,
      coverUrlInflight: 0,
      albumCoverUrlCacheEntries: 2,
      webview2: {
        processSampleAtMs: Date.now(),
        sampleIntervalMs: 1000,
        cpuCount: 8,
        webview2WorkingSetBytes: 500 * 1024 * 1024,
        webview2PrivateBytes: 400 * 1024 * 1024,
        webview2CpuPercent: 58,
        treeWorkingSetBytes: 900 * 1024 * 1024,
        treePrivateBytes: 1000 * 1024 * 1024,
        treeCpuPercent: 40,
      },
    });

    expect(plan.tier).toBeGreaterThanOrEqual(2);
  });
});
