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
  });
});
