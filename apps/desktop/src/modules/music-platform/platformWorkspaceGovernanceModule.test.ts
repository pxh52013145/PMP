import { describe, expect, it, vi } from 'vitest';
import { createPlatformWorkspaceLifecycleParticipant } from './platformWorkspaceGovernanceModule';

const telemetryLoggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  log: vi.fn(),
  metric: vi.fn(),
  startSpan: vi.fn(() => ({ end: vi.fn() })),
}));

vi.mock('../../services/telemetry/TelemetryService', () => ({
  getTelemetryLogger: () => telemetryLoggerMock,
}));

describe('platform workspace runtime capsule participant', () => {
  it('unmounts render selections on reclaim and remounts them on warm', () => {
    let selections = [
      {
        instanceId: 'instance-a',
        mounted: true,
        mountedAtMs: 1,
        order: 0,
      },
      {
        instanceId: 'instance-b',
        mounted: false,
        order: 1,
      },
    ];
    const setRenderSelectionMounted = vi.fn((instanceId?: string, mounted?: boolean) => {
      if (!instanceId) return;
      selections = selections.map((selection) =>
        selection.instanceId === instanceId
          ? {
              ...selection,
              mounted: mounted === true,
              mountedAtMs: mounted === true ? 2 : undefined,
            }
          : selection
      );
    });
    const participant = createPlatformWorkspaceLifecycleParticipant({
      listRenderSelections: () => selections,
      setRenderSelectionMounted,
      getActiveInstanceState: () => ({
        activeByConnectorId: {
          'connector.platform.demo': 'instance-a',
        },
      }),
    });

    participant.onHibernate?.({
      kind: 'memory-pressure',
      sourceId: 'test',
    });

    expect(setRenderSelectionMounted).toHaveBeenCalledWith('instance-a', false);
    expect(participant.collectSnapshot?.()).toMatchObject({
      state: 'hibernated',
      detail: {
        activeConnectorCount: 1,
        activeInstanceCount: 1,
        renderSelectionCount: 2,
        mountedRenderSelectionCount: 0,
        suspendedSelectionCount: 1,
      },
    });

    participant.onWarm?.({
      kind: 'magnet',
      ownerId: 'platform-workspace',
    });

    expect(setRenderSelectionMounted).toHaveBeenLastCalledWith('instance-a', true);
    expect(participant.collectSnapshot?.()).toMatchObject({
      state: 'active',
      detail: {
        mountedRenderSelectionCount: 1,
        suspendedSelectionCount: 0,
      },
    });
    expect(telemetryLoggerMock.info).toHaveBeenCalledWith(
      'platform.workspace.cleanup.completed',
      expect.any(Object)
    );
    expect(telemetryLoggerMock.info).toHaveBeenCalledWith(
      'platform.workspace.remount.completed',
      expect.any(Object)
    );
  });
});
