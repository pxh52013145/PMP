import { describe, expect, it, vi } from 'vitest';

import type { RuntimeCapsuleManifest } from '../../contracts/runtimeCapsule';
import { DefaultRuntimeCapsuleManagerService } from './RuntimeCapsuleManagerService';

vi.mock('../telemetry/TelemetryService', () => ({
  getTelemetryLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const TEST_CAPSULE: RuntimeCapsuleManifest = {
  id: 'visual.canvas.pixi',
  kind: 'visualizer',
  memoryTier: 'heavy',
  startup: 'active-space',
  backgroundPolicy: 'while-visible',
  warmRetentionMs: 8_000,
  hibernateAfterMs: 30_000,
  provides: ['visual.canvas.pixi'],
};

describe('DefaultRuntimeCapsuleManagerService', () => {
  it('registers capsule manifests and exposes snapshots', () => {
    const service = new DefaultRuntimeCapsuleManagerService(() => 100);

    service.registerCapsule(TEST_CAPSULE);

    const snapshot = service.collectSnapshot();
    expect(snapshot.capsules).toHaveLength(1);
    expect(snapshot.registeredCapabilityCount).toBe(1);
    expect(snapshot.capsules[0]).toMatchObject({
      state: 'cold',
      manifest: { id: 'visual.canvas.pixi', memoryTier: 'heavy' },
    });
  });

  it('acquires leases through capability ids', () => {
    const service = new DefaultRuntimeCapsuleManagerService(() => 200);
    service.registerCapsule(TEST_CAPSULE);

    const lease = service.acquireLease({
      capabilityId: 'visual.canvas.pixi',
      ownerKind: 'magnet',
      ownerId: 'visual-tool',
      reason: { spaceId: 'space1' },
    });

    expect(lease).toMatchObject({
      capsuleId: 'visual.canvas.pixi',
      capabilityId: 'visual.canvas.pixi',
      ownerKind: 'magnet',
      ownerId: 'visual-tool',
    });
    expect(service.collectSnapshot().capsules[0]).toMatchObject({
      state: 'active',
      activeLeases: [expect.objectContaining({ ownerId: 'visual-tool' })],
    });
  });

  it('moves capsules to idle-warm after the last lease is released', () => {
    let now = 300;
    const service = new DefaultRuntimeCapsuleManagerService(() => now);
    service.registerCapsule(TEST_CAPSULE);
    const lease = service.acquireLease({
      capabilityId: 'visual.canvas.pixi',
      ownerKind: 'magnet',
      ownerId: 'visual-tool',
    });

    now = 400;
    service.releaseLease(lease?.id ?? '');

    const capsule = service.collectSnapshot().capsules[0];
    expect(capsule.state).toBe('idle-warm');
    expect(capsule.activeLeases).toEqual([]);
    expect(capsule.lastTransition).toMatchObject({
      from: 'active',
      to: 'idle-warm',
      atMs: 400,
    });
  });

  it('releases all leases owned by the same owner', () => {
    const service = new DefaultRuntimeCapsuleManagerService(() => 500);
    service.registerCapsule(TEST_CAPSULE);
    service.acquireLease({
      capabilityId: 'visual.canvas.pixi',
      ownerKind: 'magnet',
      ownerId: 'visual-tool',
    });
    service.acquireLease({
      capabilityId: 'visual.canvas.pixi',
      ownerKind: 'magnet',
      ownerId: 'visual-tool',
    });

    service.releaseLeasesByOwner('magnet', 'visual-tool');

    const capsule = service.collectSnapshot().capsules[0];
    expect(capsule.state).toBe('idle-warm');
    expect(capsule.activeLeases).toHaveLength(0);
  });
});
