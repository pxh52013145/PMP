import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TELEMETRY_POLICY, type TelemetryStatus } from '../../contracts/telemetry';
import { EventBus } from '../../kernel/EventBus';
import type { AppEvents } from '../../contracts/events';
import {
  DEFAULT_PERFORMANCE_CONTROL_SNAPSHOT,
  type PerformanceControlSnapshot,
} from '../../contracts/performanceControl';
import {
  DEFAULT_QUALITY_SETTINGS_V1,
  resolveEffectiveQualityForLevel,
  type QualitySnapshot,
} from '../../contracts/quality';
import type {
  TelemetryListener,
  TelemetryLogger,
  TelemetryService,
  TelemetrySnapshot,
} from '../telemetry';
import type {
  ProcessPerfService,
  ProcessPerfServiceSnapshot,
  ProcessPerfSnapshotListener,
} from './ProcessPerfService';
import { attachPerformanceObservabilityBridge } from './performanceObservability';

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

function createTelemetryService() {
  let snapshot: TelemetrySnapshot = {
    policy: {
      ...DEFAULT_TELEMETRY_POLICY,
      modules: {
        performance: {
          perf: true,
          realtimeVerbose: true,
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
  const listeners = new Set<TelemetryListener>();
  const calls: Array<{ level: string; event: string; fields: Record<string, unknown> | null | undefined }> = [];
  const logger: TelemetryLogger = {
    log: vi.fn((level, event, options) => {
      calls.push({ level, event, fields: options?.fields });
    }),
    trace: vi.fn(),
    debug: vi.fn((event, options) => {
      calls.push({ level: 'debug', event, fields: options?.fields });
    }),
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
    calls,
    updatePolicy(
      modules: NonNullable<TelemetrySnapshot['policy']['modules']>
    ) {
      snapshot = {
        ...snapshot,
        policy: {
          ...snapshot.policy,
          modules,
        },
      };
      for (const listener of Array.from(listeners)) {
        listener(snapshot);
      }
    },
  };
}

function createProcessPerfService(initial: ProcessPerfServiceSnapshot) {
  let snapshot = initial;
  const listeners = new Set<ProcessPerfSnapshotListener>();

  const service: ProcessPerfService = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      listener(snapshot);
      return () => {
        listeners.delete(listener);
      };
    },
    refreshSnapshot: async () => snapshot.fullSnapshot,
    refreshTotalsSnapshot: async () => snapshot.totalsSnapshot,
    destroy: () => undefined,
  };

  return {
    service,
    push(next: ProcessPerfServiceSnapshot) {
      snapshot = next;
      for (const listener of Array.from(listeners)) {
        listener(snapshot);
      }
    },
  };
}

function createQualitySnapshot(): QualitySnapshot {
  return {
    settings: DEFAULT_QUALITY_SETTINGS_V1,
    effective: resolveEffectiveQualityForLevel('balanced'),
    updatedAtMs: 0,
  };
}

describe('attachPerformanceObservabilityBridge', () => {
  it('emits performance telemetry only on state changes', () => {
    const telemetry = createTelemetryService();
    const events = new EventBus<AppEvents>().withSource('test');
    const processPerf = createProcessPerfService({
      updatedAtMs: 0,
      lastAttemptAtMs: null,
      lastSuccessAtMs: null,
      availability: 'idle',
      detailLevel: 'none',
      lastError: null,
      fullSnapshot: null,
      totalsSnapshot: null,
      policy: {
        samplingMs: 1000,
        perfTelemetryEnabled: true,
        realtimeVerbose: true,
      },
    });

    const detach = attachPerformanceObservabilityBridge({
      events,
      telemetryService: telemetry.service,
      processPerfService: processPerf.service,
      performanceControlSnapshot: DEFAULT_PERFORMANCE_CONTROL_SNAPSHOT,
      qualitySnapshot: createQualitySnapshot(),
    });

    const changedPressureSnapshot: PerformanceControlSnapshot = {
      ...DEFAULT_PERFORMANCE_CONTROL_SNAPSHOT,
      pressure: 'watch',
      governance: {
        ...DEFAULT_PERFORMANCE_CONTROL_SNAPSHOT.governance,
        tier: 1,
      },
      webview2: {
        sampledAtMs: 10,
        webview2PrivateBytes: 100,
        webview2WorkingSetBytes: 120,
        webview2CpuPercent: 22,
      },
    };

    events.emit('performance-control/changed', changedPressureSnapshot);
    events.emit('performance-control/changed', changedPressureSnapshot);

    events.emit('quality/changed', {
      ...createQualitySnapshot(),
      updatedAtMs: 20,
      lastDecision: {
        atMs: 20,
        from: 'balanced',
        to: 'low',
        reason: { kind: 'auto-downgrade', detail: 'jank' },
      },
    });
    events.emit('quality/changed', {
      ...createQualitySnapshot(),
      updatedAtMs: 20,
      lastDecision: {
        atMs: 20,
        from: 'balanced',
        to: 'low',
        reason: { kind: 'auto-downgrade', detail: 'jank' },
      },
    });

    events.emit('memory-governance/ran', {
      reason: 'interval',
      snapshot: {
        atMs: 30,
        isTauri: true,
        navigationHistoryBytes: 10,
        coverBlobUrlTotalBytes: 0,
        coverBlobUrlCacheEntries: 0,
        coverDecodedEstimateEntries: 0,
        coverDecodedEstimateTotalBytes: 0,
        coverUrlCacheEntries: 0,
        coverUrlInflight: 0,
        albumCoverUrlCacheEntries: 0,
        webview2: {
          processSampleAtMs: 25,
          sampleIntervalMs: 1000,
          cpuCount: 8,
          webview2WorkingSetBytes: 110,
          webview2PrivateBytes: 90,
          webview2CpuPercent: 18,
          treeWorkingSetBytes: 210,
          treePrivateBytes: 190,
          treeCpuPercent: 12,
        },
      },
      plan: {
        tier: 1,
        actions: ['trim-webview2-working-set'],
      },
      executed: ['trim-webview2-working-set'],
    });
    events.emit('memory-governance/ran', {
      reason: 'interval',
      snapshot: {
        atMs: 30,
        isTauri: true,
        navigationHistoryBytes: 10,
        coverBlobUrlTotalBytes: 0,
        coverBlobUrlCacheEntries: 0,
        coverDecodedEstimateEntries: 0,
        coverDecodedEstimateTotalBytes: 0,
        coverUrlCacheEntries: 0,
        coverUrlInflight: 0,
        albumCoverUrlCacheEntries: 0,
      },
      plan: {
        tier: 1,
        actions: ['trim-webview2-working-set'],
      },
      executed: ['trim-webview2-working-set'],
    });

    processPerf.push({
      updatedAtMs: 40,
      lastAttemptAtMs: 40,
      lastSuccessAtMs: null,
      availability: 'unsupported',
      detailLevel: 'totals',
      lastError: 'only supported on Windows',
      fullSnapshot: null,
      totalsSnapshot: null,
      policy: {
        samplingMs: 1000,
        perfTelemetryEnabled: true,
        realtimeVerbose: true,
      },
    });
    processPerf.push({
      updatedAtMs: 40,
      lastAttemptAtMs: 40,
      lastSuccessAtMs: null,
      availability: 'unsupported',
      detailLevel: 'totals',
      lastError: 'only supported on Windows',
      fullSnapshot: null,
      totalsSnapshot: null,
      policy: {
        samplingMs: 1000,
        perfTelemetryEnabled: true,
        realtimeVerbose: true,
      },
    });
    processPerf.push({
      updatedAtMs: 50,
      lastAttemptAtMs: 50,
      lastSuccessAtMs: 50,
      availability: 'ready',
      detailLevel: 'totals',
      lastError: null,
      fullSnapshot: null,
      totalsSnapshot: {
        timestampMs: 50,
        sampleIntervalMs: 1000,
        cpuCount: 8,
        rootPid: 1,
        systemMemory: null,
        totals: {
          workingSetBytes: 100,
          privateBytes: 80,
          cpuPercent: 15,
          appWorkingSetBytes: 10,
          appPrivateBytes: 9,
          appCpuPercent: 5,
          webview2WorkingSetBytes: 70,
          webview2PrivateBytes: 60,
          webview2CpuPercent: 12,
          otherWorkingSetBytes: 20,
          otherPrivateBytes: 11,
          otherCpuPercent: 4,
        },
      },
      policy: {
        samplingMs: 1000,
        perfTelemetryEnabled: true,
        realtimeVerbose: true,
      },
    });

    expect(
      telemetry.calls.filter((entry) => entry.event === 'performance.pressure.changed')
    ).toHaveLength(1);
    expect(
      telemetry.calls.filter((entry) => entry.event === 'performance.quality.decision')
    ).toHaveLength(1);
    expect(
      telemetry.calls.filter((entry) => entry.event === 'performance.memory-governance.executed')
    ).toHaveLength(1);
    expect(
      telemetry.calls.filter((entry) => entry.event === 'performance.process-snapshot.unavailable')
    ).toHaveLength(1);
    expect(
      telemetry.calls.filter((entry) => entry.event === 'performance.process-snapshot.recovered')
    ).toHaveLength(1);
    expect(
      telemetry.calls.filter((entry) => entry.event === 'performance.process-snapshot.sampled')
    ).toHaveLength(1);

    detach();
  });
});
