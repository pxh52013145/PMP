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
      coverUrlCacheEntries: 10,
      coverUrlInflight: 0,
      albumCoverUrlCacheEntries: 2,
    });
    expect(plan.tier).toBeGreaterThanOrEqual(1);
    expect(plan.actions).toContain('clear-cover-runtime-caches');
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
  });
});

