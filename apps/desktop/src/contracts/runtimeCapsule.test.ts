import { describe, expect, it } from 'vitest';

import { resolveRuntimeCapsuleIdleReclaimPolicy } from './runtimeCapsule';

describe('resolveRuntimeCapsuleIdleReclaimPolicy', () => {
  it('keeps pinned and realtime-critical capsules protected by default', () => {
    expect(
      resolveRuntimeCapsuleIdleReclaimPolicy({
        backgroundPolicy: 'pinned',
      })
    ).toBe('protected');
    expect(
      resolveRuntimeCapsuleIdleReclaimPolicy({
        backgroundPolicy: 'realtime-critical',
      })
    ).toBe('protected');
  });

  it('uses normal idle reclaim for non-critical background policies by default', () => {
    expect(
      resolveRuntimeCapsuleIdleReclaimPolicy({
        backgroundPolicy: 'while-active',
      })
    ).toBe('default');
  });

  it('allows manifests to opt into a narrower explicit idle reclaim policy', () => {
    expect(
      resolveRuntimeCapsuleIdleReclaimPolicy({
        backgroundPolicy: 'realtime-critical',
        idleReclaimPolicy: 'after-retention',
      })
    ).toBe('after-retention');
  });
});
