import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TELEMETRY_POLICY, type TelemetryPolicy, type TelemetryStatus } from '../../../contracts/telemetry';
import { getDefaultDebugConfig, type DebugConfig } from '../../../modules/debug';
import {
  DefaultTelemetryService,
  getGlobalTelemetryService,
  getTelemetryLogger,
  setGlobalTelemetryService,
} from '../TelemetryService';

function buildPolicy(overrides: Partial<TelemetryPolicy> = {}): TelemetryPolicy {
  return {
    ...DEFAULT_TELEMETRY_POLICY,
    persistMinLevel: 'info',
    retention: { ...DEFAULT_TELEMETRY_POLICY.retention },
    modules: {},
    ...overrides,
  };
}

function buildDebugConfig(policy: TelemetryPolicy): DebugConfig {
  return {
    ...getDefaultDebugConfig(),
    telemetry: policy,
  };
}

function buildStatus(policy: TelemetryPolicy): TelemetryStatus {
  return {
    enabled: policy.enabled,
    currentSessionId: 'session-test',
    queuedRecords: 0,
    flushedRecords: 0,
    droppedRecords: 0,
    currentFileBytes: 0,
    currentFilePath: null,
    frontendMinLevel: policy.frontendMinLevel,
    backendMinLevel: policy.backendMinLevel,
    persistMinLevel: policy.persistMinLevel,
    lastError: null,
  };
}

describe('DefaultTelemetryService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    setGlobalTelemetryService(null);
    vi.useRealTimers();
  });

  it('bootstraps runtime policy and flushes buffered records in batches', async () => {
    const policy = buildPolicy({ batchFlushMs: 50, batchMaxItems: 8 });
    const ingestBatch = vi.fn(async (records: unknown[]) => ({
      status: {
        ...buildStatus(policy),
        flushedRecords: records.length,
      },
    }));

    const service = new DefaultTelemetryService({
      runtimeDeps: {
        loadDebugConfig: async () => buildDebugConfig(policy),
        loadStatus: async () => buildStatus(policy),
        ingestBatch,
      },
    });

    await service.refreshRuntime();
    const logger = service.getLogger('music-library');
    logger.info('page.enter', {
      message: 'entered page',
      fields: { page: 'music-library' },
    });

    expect(service.getSnapshot().bufferedRecords).toBe(1);

    await vi.advanceTimersByTimeAsync(60);

    expect(ingestBatch).toHaveBeenCalledTimes(1);
    expect(ingestBatch.mock.calls[0]?.[0]).toMatchObject([
      expect.objectContaining({
        moduleId: 'music-library',
        event: 'page.enter',
        sessionId: 'session-test',
      }),
    ]);
    expect(service.getSnapshot().bufferedRecords).toBe(0);
    expect(service.getSnapshot().status.flushedRecords).toBe(1);

    service.destroy();
  });

  it('keeps ui tail and flush queue bounded', async () => {
    const policy = buildPolicy({ batchFlushMs: 10_000, batchMaxItems: 64 });
    const service = new DefaultTelemetryService({
      tailCapacity: 2,
      queueCapacity: 2,
      runtimeDeps: {
        loadDebugConfig: async () => buildDebugConfig(policy),
        loadStatus: async () => buildStatus(policy),
        ingestBatch: async () => ({
          status: buildStatus(policy),
        }),
      },
    });

    await service.refreshRuntime();
    const logger = service.getLogger('playlists');

    logger.info('detail.opened');
    logger.info('detail.hydrated');
    logger.info('detail.ready');
    logger.info('detail.closed');

    const snapshot = service.getSnapshot();
    expect(snapshot.tail.map((entry) => entry.event)).toEqual(['detail.ready', 'detail.closed']);
    expect(snapshot.tailDroppedRecords).toBe(2);
    expect(snapshot.bufferedRecords).toBe(2);
    expect(snapshot.queueDroppedRecords).toBe(2);

    service.destroy();
  });

  it('becomes a no-op when telemetry policy is disabled', async () => {
    const policy = buildPolicy({ enabled: false, uiTailEnabled: false });
    const ingestBatch = vi.fn(async () => ({
      status: buildStatus(policy),
    }));

    const service = new DefaultTelemetryService({
      runtimeDeps: {
        loadDebugConfig: async () => buildDebugConfig(policy),
        loadStatus: async () => buildStatus(policy),
        ingestBatch,
      },
    });

    await service.refreshRuntime();
    service.getLogger('audio').error('engine.failed', {
      message: 'boom',
    });

    await vi.advanceTimersByTimeAsync(300);

    const snapshot = service.getSnapshot();
    expect(snapshot.tail).toEqual([]);
    expect(snapshot.bufferedRecords).toBe(0);
    expect(ingestBatch).not.toHaveBeenCalled();

    service.destroy();
  });

  it('exposes a global telemetry logger proxy for singleton services', async () => {
    const policy = buildPolicy({ batchFlushMs: 10_000, batchMaxItems: 64 });
    const service = new DefaultTelemetryService({
      runtimeDeps: {
        loadDebugConfig: async () => buildDebugConfig(policy),
        loadStatus: async () => buildStatus(policy),
        ingestBatch: async () => ({
          status: buildStatus(policy),
        }),
      },
    });

    await service.refreshRuntime();
    setGlobalTelemetryService(service);

    expect(getGlobalTelemetryService()).toBe(service);

    const logger = getTelemetryLogger('audio', 'NativeAudioService');
    logger.info('audio.queue.clear', {
      fields: { queueLengthBefore: 12 },
    });

    const snapshot = service.getSnapshot();
    expect(snapshot.tail).toEqual([
      expect.objectContaining({
        moduleId: 'audio',
        component: 'NativeAudioService',
        event: 'audio.queue.clear',
        fields: expect.objectContaining({
          queueLengthBefore: 12,
        }),
      }),
    ]);

    setGlobalTelemetryService(null);
    logger.info('audio.queue.clear', {
      fields: { queueLengthBefore: 99 },
    });
    expect(service.getSnapshot().tail).toHaveLength(1);

    service.destroy();
  });
});
