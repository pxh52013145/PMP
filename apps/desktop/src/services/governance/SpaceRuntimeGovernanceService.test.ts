import { afterEach, describe, expect, it, vi } from 'vitest';
import { DefaultSpaceRuntimeGovernanceService } from './SpaceRuntimeGovernanceService';

vi.mock('../telemetry/TelemetryService', () => ({
  getTelemetryLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('DefaultSpaceRuntimeGovernanceService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('freezes the previous active space when another space activates', () => {
    const service = new DefaultSpaceRuntimeGovernanceService();

    service.activateSpace('space1');
    service.activateSpace('space2');

    const snapshot = service.collectSnapshot();
    expect(snapshot.activeSpaceId).toBe('space2');
    expect(snapshot.frozenSpaceIds).toContain('space1');
    expect(snapshot.heavySpaceIds).toContain('space2');
  });

  it('reclaims frozen heavy spaces without tearing down the active space', () => {
    const service = new DefaultSpaceRuntimeGovernanceService();

    service.activateSpace('space2');
    service.activateSpace('space1');

    const reclaimed = service.reclaim({ reason: 'test', minTier: 2 });

    expect(reclaimed).toEqual(['space2']);
    const snapshot = service.collectSnapshot();
    expect(snapshot.activeSpaceId).toBe('space1');
    expect(snapshot.reclaimableSpaceIds).not.toContain('space1');
    expect(snapshot.descriptors.find((descriptor) => descriptor.spaceId === 'space2')?.state).toBe(
      'cold'
    );
  });

  it('does not reclaim warmed heavy spaces before their first activation', () => {
    const service = new DefaultSpaceRuntimeGovernanceService();

    service.warmSpace('space2');
    service.freezeSpace('space2');

    expect(service.collectSnapshot().reclaimableSpaceIds).not.toContain('space2');
    expect(service.reclaim({ reason: 'test', minTier: 2 })).toEqual([]);
  });

  it('keeps associated heavy spaces until all runtime associations are released', () => {
    const service = new DefaultSpaceRuntimeGovernanceService();

    service.activateSpace('space2');
    const release = service.retainSpaceAssociation('space2', 'magnet:platform-magnet');
    service.activateSpace('space1');

    expect(service.collectSnapshot().descriptors.find((item) => item.spaceId === 'space2')).toMatchObject({
      activeAssociationCount: 1,
      hasActivated: true,
    });
    expect(service.reclaim({ reason: 'test', minTier: 2 })).toEqual([]);

    release();

    expect(service.collectSnapshot().zeroAssociationSpaceIds).toContain('space2');
    expect(service.reclaim({ reason: 'test', minTier: 2 })).toEqual(['space2']);
  });

  it('waits for zero-association retention before normal reclaim', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const service = new DefaultSpaceRuntimeGovernanceService();

    service.activateSpace('space2');
    const release = service.retainSpaceAssociation('space2', 'magnet:platform-magnet');
    service.activateSpace('space1');
    release();

    vi.advanceTimersByTime(9_999);
    expect(service.reclaim({ reason: 'test', minTier: 1 })).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(service.reclaim({ reason: 'test', minTier: 1 })).toEqual(['space2']);
    expect(service.collectSnapshot().descriptors.find((item) => item.spaceId === 'space2')).toMatchObject({
      state: 'hibernated',
    });
    expect(service.collectSnapshot().hibernatedSpaceIds).toContain('space2');
  });

  it('tears down hibernated heavy spaces under high pressure', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const service = new DefaultSpaceRuntimeGovernanceService();

    service.activateSpace('space2');
    service.activateSpace('space1');

    vi.advanceTimersByTime(10_000);
    expect(service.reclaim({ reason: 'watch', minTier: 1 })).toEqual(['space2']);
    expect(service.collectSnapshot().hibernatedSpaceIds).toContain('space2');

    expect(service.reclaim({ reason: 'high', minTier: 2 })).toEqual(['space2']);
    expect(service.collectSnapshot().descriptors.find((item) => item.spaceId === 'space2')).toMatchObject({
      state: 'cold',
    });
  });

  it('invokes participant lifecycle hooks for warm, freeze, and teardown', () => {
    const service = new DefaultSpaceRuntimeGovernanceService();
    const onWarm = vi.fn();
    const onFreeze = vi.fn();
    const onTeardown = vi.fn();

    service.registerParticipant('space2', {
      id: 'plugin-workspace',
      capsuleId: 'plugin.runtime',
      onWarm,
      onFreeze,
      onTeardown,
    });

    service.warmSpace('space2');
    service.activateSpace('space2');
    service.activateSpace('space1');
    service.reclaim({ reason: 'test', minTier: 2 });

    expect(onWarm).toHaveBeenCalledTimes(1);
    expect(onFreeze).toHaveBeenCalledTimes(1);
    expect(onTeardown).toHaveBeenCalledTimes(1);
  });

  it('invokes participant lifecycle hooks for suspend and hibernate', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const service = new DefaultSpaceRuntimeGovernanceService();
    const onSuspend = vi.fn();
    const onHibernate = vi.fn();

    service.registerParticipant('space2', {
      id: 'plugin-workspace',
      capsuleId: 'plugin.runtime',
      onSuspend,
      onHibernate,
    });

    service.activateSpace('space2');
    service.suspendSpace('space2', 'test suspend');
    service.activateSpace('space1');
    vi.advanceTimersByTime(10_000);
    service.reclaim({ reason: 'test hibernate', minTier: 1 });

    expect(onSuspend).toHaveBeenCalledTimes(1);
    expect(onHibernate).toHaveBeenCalledTimes(1);
  });

  it('includes registered participant snapshots in the collected space snapshot', () => {
    const service = new DefaultSpaceRuntimeGovernanceService();

    service.registerParticipant('space2', {
      id: 'plugin-workspace',
      capsuleId: 'plugin.runtime',
      collectSnapshot: () => ({
        id: 'plugin-workspace',
        capsuleId: 'plugin.runtime',
        state: 'warming',
        listeners: 3,
        detail: { route: 'dev-session' },
      }),
    });

    service.warmSpace('space2');

    const snapshot = service.collectSnapshot();
    expect(snapshot.descriptors.find((descriptor) => descriptor.spaceId === 'space2')).toMatchObject({
      participants: [
        expect.objectContaining({
          id: 'plugin-workspace',
          capsuleId: 'plugin.runtime',
          state: 'warming',
          listeners: 3,
        }),
      ],
    });
  });
});
