import { describe, expect, it, vi } from 'vitest';
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
});
