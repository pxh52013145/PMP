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
});
