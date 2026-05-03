import { afterEach, describe, expect, it, vi } from 'vitest';

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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('acquires and releases dependency leases with the owning lease', () => {
    const service = new DefaultRuntimeCapsuleManagerService(() => 250);
    service.registerCapsule({
      id: 'audio.shell',
      kind: 'audio',
      memoryTier: 'light',
      startup: 'core',
      backgroundPolicy: 'while-active',
      warmRetentionMs: 30_000,
      hibernateAfterMs: 120_000,
      provides: ['audio.shell'],
    });
    service.registerCapsule({
      id: 'audio.transport',
      kind: 'audio',
      memoryTier: 'medium',
      startup: 'first-use',
      backgroundPolicy: 'realtime-critical',
      warmRetentionMs: 60_000,
      hibernateAfterMs: 300_000,
      dependencies: ['audio.shell'],
      provides: ['audio.transport'],
    });

    const lease = service.acquireLease({
      capabilityId: 'audio.transport',
      ownerKind: 'magnet',
      ownerId: 'transport-control',
    });

    expect(lease).toMatchObject({ capsuleId: 'audio.transport' });
    expect(service.collectSnapshot()).toMatchObject({
      activeLeaseCount: 2,
      capsules: [
        expect.objectContaining({
          manifest: expect.objectContaining({ id: 'audio.shell' }),
          state: 'active',
          activeLeases: [
            expect.objectContaining({
              ownerKind: 'system',
              ownerId: 'runtime-capsule-manager:dependency',
            }),
          ],
        }),
        expect.objectContaining({
          manifest: expect.objectContaining({ id: 'audio.transport' }),
          state: 'active',
        }),
      ],
    });

    service.releaseLease(lease?.id ?? '');

    expect(service.collectSnapshot().capsules).toEqual([
      expect.objectContaining({
        manifest: expect.objectContaining({ id: 'audio.shell' }),
        state: 'idle-warm',
        activeLeases: [],
      }),
      expect.objectContaining({
        manifest: expect.objectContaining({ id: 'audio.transport' }),
        state: 'idle-warm',
        activeLeases: [],
      }),
    ]);
  });

  it('renews keyed leases and sweeps expired TTL leases', () => {
    let now = 1_000;
    const service = new DefaultRuntimeCapsuleManagerService(() => now);
    service.registerCapsule(TEST_CAPSULE);

    const lease = service.acquireLease({
      capabilityId: 'visual.canvas.pixi',
      leaseKey: 'matrix:visual-tool',
      ownerKind: 'magnet',
      ownerId: 'visual-tool',
      ttlMs: 100,
    });

    now = 1_050;
    const renewed = service.acquireLease({
      capabilityId: 'visual.canvas.pixi',
      leaseKey: 'matrix:visual-tool',
      ownerKind: 'magnet',
      ownerId: 'visual-tool',
      ttlMs: 200,
      reason: { detail: 'same magnet render pass renewed' },
    });

    expect(renewed?.id).toBe(lease?.id);
    expect(service.collectSnapshot().capsules[0].activeLeases).toEqual([
      expect.objectContaining({
        id: lease?.id,
        lastRenewedAtMs: 1_050,
        expiresAtMs: 1_250,
        reason: expect.objectContaining({ detail: 'same magnet render pass renewed' }),
      }),
    ]);

    expect(service.sweepExpiredLeases(1_249)).toEqual([]);
    expect(service.sweepExpiredLeases(1_250)).toEqual([lease?.id]);
    expect(service.collectSnapshot().capsules[0]).toMatchObject({
      state: 'idle-warm',
      activeLeases: [],
    });
  });

  it('keeps warming pending until async warm hooks settle', async () => {
    let now = 2_000;
    const warmHook = { resolve: null as (() => void) | null };
    const service = new DefaultRuntimeCapsuleManagerService(() => now);
    service.registerCapsule(TEST_CAPSULE);
    service.registerParticipant('visual.canvas.pixi', {
      id: 'async-canvas',
      capsuleId: 'visual.canvas.pixi',
      onWarm: () =>
        new Promise<void>((resolve) => {
          warmHook.resolve = resolve;
        }),
    });

    service.acquireLease({
      capabilityId: 'visual.canvas.pixi',
      ownerKind: 'magnet',
      ownerId: 'visual-tool',
    });

    expect(service.collectSnapshot().capsules[0].state).toBe('warming');

    now = 2_100;
    warmHook.resolve?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(service.collectSnapshot().capsules[0].state).toBe('active');
  });

  it('keeps teardown pending until async teardown hooks time out', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(3_000);
    const service = new DefaultRuntimeCapsuleManagerService(() => Date.now(), 50);
    service.registerCapsule(TEST_CAPSULE);
    service.registerParticipant('visual.canvas.pixi', {
      id: 'async-canvas',
      capsuleId: 'visual.canvas.pixi',
      onTeardown: () => new Promise<void>(() => undefined),
    });
    const lease = service.acquireLease({
      capabilityId: 'visual.canvas.pixi',
      ownerKind: 'magnet',
      ownerId: 'visual-tool',
    });

    vi.setSystemTime(4_000);
    service.releaseLease(lease?.id ?? '');
    service.reclaimInactiveCapsules({
      mode: 'teardown',
      minMemoryTier: 'medium',
      bypassWarmRetention: true,
      reason: { kind: 'memory-pressure', pressureLevel: 'high' },
    });

    expect(service.collectSnapshot().capsules[0].state).toBe('tearing_down');

    await vi.advanceTimersByTimeAsync(50);

    expect(service.collectSnapshot().capsules[0].state).toBe('cold');
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

  it('invokes participant hooks when capsule lifecycle state changes', () => {
    let now = 300;
    const service = new DefaultRuntimeCapsuleManagerService(() => now);
    const onWarm = vi.fn();
    const onSuspend = vi.fn();
    const onHibernate = vi.fn();
    const onTeardown = vi.fn();
    service.registerCapsule(TEST_CAPSULE);
    service.registerParticipant('visual.canvas.pixi', {
      id: 'pixel-matrix-canvas',
      capsuleId: 'visual.canvas.pixi',
      onWarm,
      onSuspend,
      onHibernate,
      onTeardown,
      collectSnapshot: () => ({
        id: 'pixel-matrix-canvas',
        capsuleId: 'visual.canvas.pixi',
        state: 'active',
        detail: { rendererMounted: true },
      }),
    });

    const lease = service.acquireLease({
      capabilityId: 'visual.canvas.pixi',
      ownerKind: 'magnet',
      ownerId: 'visual-tool',
    });
    now = 400;
    service.releaseLease(lease?.id ?? '');
    now = 9_000;
    service.reclaimInactiveCapsules({
      mode: 'hibernate',
      minMemoryTier: 'medium',
      reason: { kind: 'memory-pressure', pressureLevel: 'watch' },
    });
    service.reclaimInactiveCapsules({
      mode: 'teardown',
      minMemoryTier: 'medium',
      bypassWarmRetention: true,
      reason: { kind: 'memory-pressure', pressureLevel: 'high' },
    });

    expect(onWarm).toHaveBeenCalledTimes(1);
    expect(onSuspend).toHaveBeenCalledTimes(1);
    expect(onHibernate).toHaveBeenCalledTimes(1);
    expect(onTeardown).toHaveBeenCalledTimes(1);
    expect(service.collectSnapshot().capsules[0].participants).toEqual([
      expect.objectContaining({
        id: 'pixel-matrix-canvas',
        capsuleId: 'visual.canvas.pixi',
      }),
    ]);
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

  it('hibernates idle capsules after their warm retention window', () => {
    let now = 1_000;
    const service = new DefaultRuntimeCapsuleManagerService(() => now);
    service.registerCapsule(TEST_CAPSULE);
    const lease = service.acquireLease({
      capabilityId: 'visual.canvas.pixi',
      ownerKind: 'magnet',
      ownerId: 'visual-tool',
    });

    now = 2_000;
    service.releaseLease(lease?.id ?? '');
    now = 9_999;
    expect(
      service.reclaimInactiveCapsules({
        mode: 'hibernate',
        minMemoryTier: 'medium',
        reason: { kind: 'memory-pressure' },
      })
    ).toEqual([]);

    now = 10_000;
    const reclaimed = service.reclaimInactiveCapsules({
      mode: 'hibernate',
      minMemoryTier: 'medium',
      reason: { kind: 'memory-pressure', pressureLevel: 'watch' },
    });

    expect(reclaimed).toEqual([
      expect.objectContaining({
        capsuleId: 'visual.canvas.pixi',
        from: 'idle-warm',
        to: 'hibernated',
        memoryTier: 'heavy',
      }),
    ]);
    expect(service.collectSnapshot().capsules[0]).toMatchObject({
      state: 'hibernated',
      activeLeases: [],
    });
  });

  it('tears down inactive capsules under high pressure without touching active leases', () => {
    let now = 1_000;
    const service = new DefaultRuntimeCapsuleManagerService(() => now);
    service.registerCapsule(TEST_CAPSULE);
    service.registerCapsule({
      ...TEST_CAPSULE,
      id: 'debug.process-perf',
      kind: 'debug',
      memoryTier: 'medium',
      startup: 'manual',
      provides: ['debug.process-perf'],
    });
    const activeLease = service.acquireLease({
      capabilityId: 'debug.process-perf',
      ownerKind: 'debug',
      ownerId: 'debug-center',
    });
    const idleLease = service.acquireLease({
      capabilityId: 'visual.canvas.pixi',
      ownerKind: 'magnet',
      ownerId: 'visual-tool',
    });

    now = 2_000;
    service.releaseLease(idleLease?.id ?? '');
    const reclaimed = service.reclaimInactiveCapsules({
      mode: 'teardown',
      minMemoryTier: 'medium',
      bypassWarmRetention: true,
      reason: { kind: 'memory-pressure', pressureLevel: 'high' },
    });

    expect(reclaimed.map((item) => item.capsuleId)).toEqual(['visual.canvas.pixi']);
    expect(service.collectSnapshot().capsules).toEqual([
      expect.objectContaining({ manifest: expect.objectContaining({ id: 'debug.process-perf' }), state: 'active' }),
      expect.objectContaining({ manifest: expect.objectContaining({ id: 'visual.canvas.pixi' }), state: 'cold' }),
    ]);
    expect(activeLease).toMatchObject({ capsuleId: 'debug.process-perf' });
  });
});
