import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DEFAULT_TELEMETRY_POLICY, type TelemetryStatus } from '../../contracts/telemetry';
import type {
  TelemetryListener,
  TelemetryLogger,
  TelemetryService,
  TelemetrySnapshot,
} from '../telemetry';
import { DefaultProcessPerfService } from './ProcessPerfService';

const { requestProcessPerfSnapshotMock, requestProcessPerfTotalsSnapshotMock } = vi.hoisted(() => ({
  requestProcessPerfSnapshotMock: vi.fn(),
  requestProcessPerfTotalsSnapshotMock: vi.fn(),
}));

vi.mock('../../modules/debug/processPerf', () => ({
  requestProcessPerfSnapshot: requestProcessPerfSnapshotMock,
  requestProcessPerfTotalsSnapshot: requestProcessPerfTotalsSnapshotMock,
}));

function createTelemetryStatus(): TelemetryStatus {
  return {
    enabled: true,
    currentSessionId: 'session-test',
    queuedRecords: 0,
    flushedRecords: 0,
    droppedRecords: 0,
    currentFileBytes: 0,
    currentFilePath: null,
    frontendMinLevel: 'info',
    backendMinLevel: 'info',
    persistMinLevel: 'warn',
    lastError: null,
  };
}

function createTelemetrySnapshot(): TelemetrySnapshot {
  return {
    policy: {
      ...DEFAULT_TELEMETRY_POLICY,
      modules: {
        performance: {
          perf: true,
        },
      },
    },
    status: createTelemetryStatus(),
    tail: [],
    bufferedRecords: 0,
    queueDroppedRecords: 0,
    tailDroppedRecords: 0,
    transportAvailable: true,
    bootstrapState: 'ready',
    lastFlushAtMs: null,
    lastBootstrapAtMs: null,
  };
}

function createTelemetryService() {
  let snapshot = createTelemetrySnapshot();
  const listeners = new Set<TelemetryListener>();
  const logger: TelemetryLogger = {
    log: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    metric: vi.fn(),
    startSpan: vi.fn(() => ({ end: vi.fn() })),
  };

  const service: TelemetryService = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refreshRuntime: async () => snapshot,
    clearSession: async () => undefined,
    flushNow: async () => undefined,
    getLogger: () => logger,
    ingest: vi.fn(),
    destroy: vi.fn(),
  };

  return {
    service,
    updateSnapshot(next: Partial<TelemetrySnapshot>) {
      snapshot = {
        ...snapshot,
        ...next,
      };
      for (const listener of Array.from(listeners)) {
        listener(snapshot);
      }
    },
  };
}

describe('DefaultProcessPerfService', () => {
  beforeEach(() => {
    requestProcessPerfSnapshotMock.mockReset();
    requestProcessPerfTotalsSnapshotMock.mockReset();
  });

  it('reuses cached totals snapshots within the configured cadence', async () => {
    const telemetry = createTelemetryService();
    const service = new DefaultProcessPerfService(telemetry.service);

    requestProcessPerfTotalsSnapshotMock.mockResolvedValue({
      timestampMs: 10,
      sampleIntervalMs: 1000,
      cpuCount: 8,
      rootPid: 1,
      systemMemory: null,
      totals: {
        workingSetBytes: 10,
        privateBytes: 20,
        cpuPercent: 5,
        appWorkingSetBytes: 1,
        appPrivateBytes: 2,
        appCpuPercent: 1,
        webview2WorkingSetBytes: 3,
        webview2PrivateBytes: 4,
        webview2CpuPercent: 2,
        otherWorkingSetBytes: 5,
        otherPrivateBytes: 6,
        otherCpuPercent: 3,
      },
    });

    const first = await service.refreshTotalsSnapshot();
    const second = await service.refreshTotalsSnapshot();

    expect(first?.timestampMs).toBe(10);
    expect(second?.timestampMs).toBe(10);
    expect(requestProcessPerfTotalsSnapshotMock).toHaveBeenCalledTimes(1);

    requestProcessPerfTotalsSnapshotMock.mockResolvedValueOnce({
      timestampMs: 30,
      sampleIntervalMs: 1000,
      cpuCount: 8,
      rootPid: 1,
      systemMemory: null,
      totals: {
        workingSetBytes: 30,
        privateBytes: 40,
        cpuPercent: 7,
        appWorkingSetBytes: 1,
        appPrivateBytes: 2,
        appCpuPercent: 1,
        webview2WorkingSetBytes: 5,
        webview2PrivateBytes: 6,
        webview2CpuPercent: 3,
        otherWorkingSetBytes: 7,
        otherPrivateBytes: 8,
        otherCpuPercent: 4,
      },
    });

    const forced = await service.refreshTotalsSnapshot({ force: true });

    expect(forced?.timestampMs).toBe(30);
    expect(requestProcessPerfTotalsSnapshotMock).toHaveBeenCalledTimes(2);
  });

  it('tracks unsupported availability and notifies subscribers', async () => {
    const telemetry = createTelemetryService();
    const service = new DefaultProcessPerfService(telemetry.service);
    const seenAvailability: string[] = [];

    service.subscribe((snapshot) => {
      seenAvailability.push(snapshot.availability);
    });

    requestProcessPerfTotalsSnapshotMock.mockRejectedValue(
      Object.assign(new Error('Process performance snapshot is only supported on Windows.'), {
        code: 'unsupported',
      })
    );

    const result = await service.refreshTotalsSnapshot({ force: true });

    expect(result).toBeNull();
    expect(service.getSnapshot().availability).toBe('unsupported');
    expect(service.getSnapshot().lastError).toContain('only supported on Windows');
    expect(seenAvailability).toContain('unsupported');
  });

  it('releases cached runtime snapshots without destroying the service', async () => {
    const telemetry = createTelemetryService();
    const service = new DefaultProcessPerfService(telemetry.service);

    requestProcessPerfTotalsSnapshotMock.mockResolvedValue({
      timestampMs: 10,
      sampleIntervalMs: 1000,
      cpuCount: 8,
      rootPid: 1,
      systemMemory: null,
      totals: {
        workingSetBytes: 10,
        privateBytes: 20,
        cpuPercent: 5,
        appWorkingSetBytes: 1,
        appPrivateBytes: 2,
        appCpuPercent: 1,
        webview2WorkingSetBytes: 3,
        webview2PrivateBytes: 4,
        webview2CpuPercent: 2,
        otherWorkingSetBytes: 5,
        otherPrivateBytes: 6,
        otherCpuPercent: 3,
      },
    });

    await service.refreshTotalsSnapshot({ force: true });
    expect(service.getSnapshot().availability).toBe('ready');
    expect(service.getSnapshot().totalsSnapshot).not.toBeNull();

    service.releaseRuntimeCaches('test');

    expect(service.getSnapshot()).toMatchObject({
      availability: 'idle',
      detailLevel: 'none',
      fullSnapshot: null,
      totalsSnapshot: null,
      lastError: null,
    });
  });
});
