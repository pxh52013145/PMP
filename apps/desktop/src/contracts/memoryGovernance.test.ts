import { describe, expect, it } from 'vitest';

import {
  decideMemoryGovernancePlan,
  type MemoryGovernanceSnapshot,
} from './memoryGovernance';

const BASE_SNAPSHOT: MemoryGovernanceSnapshot = {
  atMs: 1_000,
  isTauri: false,
  navigationHistoryBytes: 0,
  coverBlobUrlTotalBytes: 0,
  coverBlobUrlCacheEntries: 0,
  coverDecodedEstimateEntries: 0,
  coverDecodedEstimateTotalBytes: 0,
  coverUrlCacheEntries: 0,
  coverUrlInflight: 0,
  albumCoverUrlCacheEntries: 0,
};

describe('decideMemoryGovernancePlan', () => {
  it('hibernates reclaimable idle runtime capsules without requiring global pressure', () => {
    const plan = decideMemoryGovernancePlan({
      ...BASE_SNAPSHOT,
      runtimeCapsules: {
        activeLeaseCount: 0,
        activeCapsuleIds: [],
        idleWarmCapsuleIds: ['visual.canvas.pixi'],
        hibernatedCapsuleIds: [],
        reclaimableCapsuleIds: ['visual.canvas.pixi'],
        heavyReclaimableCapsuleIds: ['visual.canvas.pixi'],
      },
    });

    expect(plan.actions).toContain('hibernate-idle-runtime-capsules');
    expect(plan.actions).not.toContain('teardown-idle-runtime-capsules');
  });

  it('tears down idle runtime capsules under high memory pressure', () => {
    const plan = decideMemoryGovernancePlan({
      ...BASE_SNAPSHOT,
      jsHeapUsedBytes: 700_000_000,
      runtimeCapsules: {
        activeLeaseCount: 0,
        activeCapsuleIds: [],
        idleWarmCapsuleIds: ['visual.canvas.pixi'],
        hibernatedCapsuleIds: ['debug.process-perf'],
        reclaimableCapsuleIds: ['visual.canvas.pixi'],
        heavyReclaimableCapsuleIds: ['visual.canvas.pixi'],
      },
    });

    expect(plan.tier).toBe(2);
    expect(plan.actions).toContain('teardown-idle-runtime-capsules');
    expect(plan.actions).not.toContain('hibernate-idle-runtime-capsules');
  });

  it('only includes pressure-only runtime capsules when pressure is high', () => {
    const idlePlan = decideMemoryGovernancePlan({
      ...BASE_SNAPSHOT,
      runtimeCapsules: {
        activeLeaseCount: 0,
        activeCapsuleIds: [],
        idleWarmCapsuleIds: ['plugin.runtime'],
        hibernatedCapsuleIds: [],
        reclaimableCapsuleIds: [],
        pressureReclaimableCapsuleIds: ['plugin.runtime'],
        heavyReclaimableCapsuleIds: [],
      },
    });

    expect(idlePlan.actions).not.toContain('hibernate-idle-runtime-capsules');
    expect(idlePlan.actions).not.toContain('teardown-idle-runtime-capsules');

    const pressurePlan = decideMemoryGovernancePlan({
      ...BASE_SNAPSHOT,
      jsHeapUsedBytes: 700_000_000,
      runtimeCapsules: {
        activeLeaseCount: 0,
        activeCapsuleIds: [],
        idleWarmCapsuleIds: ['plugin.runtime'],
        hibernatedCapsuleIds: [],
        reclaimableCapsuleIds: [],
        pressureReclaimableCapsuleIds: ['plugin.runtime'],
        heavyReclaimableCapsuleIds: [],
      },
    });

    expect(pressurePlan.tier).toBe(2);
    expect(pressurePlan.actions).toContain('teardown-idle-runtime-capsules');
  });

  it('does not trim WebView2 working set for a moderate working-set-only sample', () => {
    const plan = decideMemoryGovernancePlan({
      ...BASE_SNAPSHOT,
      isTauri: true,
      webview2: {
        processSampleAtMs: 1_000,
        sampleIntervalMs: 1_000,
        cpuCount: 8,
        webview2PrivateWorkingSetBytes: 260_000_000,
        webview2WorkingSetBytes: 520_000_000,
        webview2PrivateBytes: 260_000_000,
        webview2CpuPercent: 0,
        treePrivateWorkingSetBytes: 400_000_000,
        treeWorkingSetBytes: 650_000_000,
        treePrivateBytes: 400_000_000,
        treeCpuPercent: 0,
      },
    });

    expect(plan.tier).toBe(1);
    expect(plan.actions).not.toContain('trim-webview2-working-set');
    expect(plan.actions).not.toContain('trim-tree-working-set');
  });

  it('does not trim for high committed bytes when task-manager memory is moderate', () => {
    const plan = decideMemoryGovernancePlan({
      ...BASE_SNAPSHOT,
      isTauri: true,
      webview2: {
        processSampleAtMs: 1_000,
        sampleIntervalMs: 1_000,
        cpuCount: 8,
        webview2PrivateWorkingSetBytes: 300_000_000,
        webview2WorkingSetBytes: 520_000_000,
        webview2PrivateBytes: 540_000_000,
        webview2CpuPercent: 0,
        treePrivateWorkingSetBytes: 450_000_000,
        treeWorkingSetBytes: 650_000_000,
        treePrivateBytes: 700_000_000,
        treeCpuPercent: 0,
      },
    });

    expect(plan.tier).toBe(1);
    expect(plan.actions).not.toContain('trim-webview2-working-set');
    expect(plan.actions).not.toContain('trim-tree-working-set');
  });

  it('trims working set only once WebView2 pressure is material', () => {
    const plan = decideMemoryGovernancePlan({
      ...BASE_SNAPSHOT,
      isTauri: true,
      webview2: {
        processSampleAtMs: 1_000,
        sampleIntervalMs: 1_000,
        cpuCount: 8,
        webview2PrivateWorkingSetBytes: 540_000_000,
        webview2WorkingSetBytes: 760_000_000,
        webview2PrivateBytes: 540_000_000,
        webview2CpuPercent: 0,
        treePrivateWorkingSetBytes: 700_000_000,
        treeWorkingSetBytes: 900_000_000,
        treePrivateBytes: 700_000_000,
        treeCpuPercent: 0,
      },
    });

    expect(plan.tier).toBe(2);
    expect(plan.actions).toContain('trim-webview2-working-set');
    expect(plan.actions).not.toContain('trim-tree-working-set');
  });
});
