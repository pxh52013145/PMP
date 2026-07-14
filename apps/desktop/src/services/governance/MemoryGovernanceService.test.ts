import { describe, expect, it, vi } from 'vitest';

import type { AppEvents } from '../../contracts/events';
import type { NavigationService } from '../navigation/NavigationService';
import { EventBus } from '../../kernel/EventBus';
import type { ProcessPerfService } from '../performance-control';
import { DefaultRuntimeCapsuleManagerService } from '../runtime-capsules';
import {
  DefaultMemoryGovernanceService,
  type MemoryGovernanceCoverRuntimeCacheHostProvider,
} from './MemoryGovernanceService';

const mocks = vi.hoisted(() => ({
  isTauri: false,
  scheduleProcessWorkingSetTrim: vi.fn(),
  invokeWithTelemetry: vi.fn(() => Promise.resolve(0)),
  readJson: vi.fn(() => []),
  writeJson: vi.fn(),
  telemetry: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../utils/tauriRuntime', () => ({
  isTauriRuntime: () => mocks.isTauri,
}));

vi.mock('../../utils/processWorkingSetTrim', () => ({
  scheduleProcessWorkingSetTrim: mocks.scheduleProcessWorkingSetTrim,
}));

vi.mock('../telemetry/tauriInvokeTelemetry', () => ({
  invokeWithTelemetry: mocks.invokeWithTelemetry,
}));

vi.mock('../telemetry/TelemetryService', () => ({
  getTelemetryLogger: () => mocks.telemetry,
}));

vi.mock('../../modules/storage', () => ({
  readJson: mocks.readJson,
  writeJson: mocks.writeJson,
}));

function createNavigation(): NavigationService {
  return {
    getSnapshot: () => ({
      currentPage: { type: 'home' },
      history: [{ type: 'home' }],
      currentIndex: 0,
    }),
    navigateTo: vi.fn(),
    goBack: vi.fn(),
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createProcessPerfService(
  refreshTotalsSnapshot = vi.fn(() => Promise.resolve(null))
): ProcessPerfService {
  return {
    getSnapshot: vi.fn(() => ({
      updatedAtMs: 0,
      lastAttemptAtMs: null,
      lastSuccessAtMs: null,
      availability: 'idle',
      detailLevel: 'none',
      lastError: null,
      fullSnapshot: null,
      totalsSnapshot: null,
      policy: {
        samplingMs: 1_000,
        perfTelemetryEnabled: true,
        realtimeVerbose: false,
      },
    })),
    subscribe: vi.fn(() => () => undefined),
    refreshSnapshot: vi.fn(() => Promise.resolve(null)),
    refreshTotalsSnapshot,
    releaseRuntimeCaches: vi.fn(),
    destroy: vi.fn(),
  };
}

function createService(options: {
  processPerfService?: ProcessPerfService;
  runtimeCapsuleManager?: DefaultRuntimeCapsuleManagerService | null;
  coverRuntimeCacheHostProvider?: MemoryGovernanceCoverRuntimeCacheHostProvider;
} = {}): DefaultMemoryGovernanceService {
  const events = new EventBus<AppEvents>();
  return new DefaultMemoryGovernanceService(
    createNavigation(),
    events,
    options.processPerfService ?? createProcessPerfService(),
    null,
    options.runtimeCapsuleManager ?? null,
    options.coverRuntimeCacheHostProvider
  );
}

describe('DefaultMemoryGovernanceService', () => {
  it('serializes overlapping runs and preserves the stronger queued reason', async () => {
    mocks.isTauri = true;
    const firstRefresh = createDeferred<null>();
    const secondRefresh = createDeferred<null>();
    const refreshTotalsSnapshot = vi
      .fn()
      .mockReturnValueOnce(firstRefresh.promise)
      .mockReturnValueOnce(secondRefresh.promise);
    const service = createService({
      processPerfService: createProcessPerfService(refreshTotalsSnapshot),
    });

    const firstRun = service.runOnce('interval');
    const queuedRun = service.runOnce('playback-active');
    const upgradedQueuedRun = service.runOnce('visibility-hidden');

    expect(queuedRun).toBe(upgradedQueuedRun);
    expect(refreshTotalsSnapshot).toHaveBeenCalledTimes(1);

    firstRefresh.resolve(null);
    await expect(firstRun).resolves.toMatchObject({ reason: 'interval' });
    await Promise.resolve();

    expect(refreshTotalsSnapshot).toHaveBeenCalledTimes(2);
    secondRefresh.resolve(null);
    await expect(queuedRun).resolves.toMatchObject({
      reason: 'visibility-hidden',
      executed: expect.arrayContaining([
        'trim-webview2-working-set',
        'trim-tree-working-set',
        'destroy-hidden-editor-windows',
      ]),
    });
  });

  it('runs terminal hidden cleanup immediately while an interval run is in flight', async () => {
    mocks.isTauri = true;
    const firstRefresh = createDeferred<null>();
    const refreshTotalsSnapshot = vi.fn().mockReturnValueOnce(firstRefresh.promise);
    const service = createService({
      processPerfService: createProcessPerfService(refreshTotalsSnapshot),
    });

    const intervalRun = service.runOnce('interval');
    const terminalRun = service.runOnce('beforeunload');

    expect(refreshTotalsSnapshot).toHaveBeenCalledTimes(1);
    await expect(terminalRun).resolves.toMatchObject({
      reason: 'beforeunload',
      snapshot: {
        webview2: undefined,
      },
      executed: expect.arrayContaining([
        'trim-webview2-working-set',
        'trim-tree-working-set',
        'destroy-hidden-editor-windows',
      ]),
    });
    expect(refreshTotalsSnapshot).toHaveBeenCalledTimes(1);

    firstRefresh.resolve(null);
    await expect(intervalRun).resolves.toMatchObject({ reason: 'interval' });
  });

  it('skips WebView2 sampling for terminal runs even without an active run', async () => {
    mocks.isTauri = true;
    const refreshTotalsSnapshot = vi.fn(() => Promise.resolve(null));
    const service = createService({
      processPerfService: createProcessPerfService(refreshTotalsSnapshot),
    });

    await expect(service.runOnce('pagehide')).resolves.toMatchObject({
      reason: 'pagehide',
      snapshot: {
        webview2: undefined,
      },
      executed: expect.arrayContaining(['trim-webview2-working-set']),
    });
    expect(refreshTotalsSnapshot).not.toHaveBeenCalled();
  });

  it('enforces Editor teardown and working-set trimming on edit exit without memory pressure', async () => {
    mocks.isTauri = true;
    const result = await createService().runOnce('editor-exit');

    expect(result.plan.tier).toBe(0);
    expect(result.executed).toEqual(
      expect.arrayContaining([
        'destroy-hidden-editor-windows',
        'trim-webview2-working-set',
        'trim-tree-working-set',
      ])
    );
    expect(mocks.scheduleProcessWorkingSetTrim).toHaveBeenCalledWith(
      'webview2',
      expect.objectContaining({ reason: 'memory-governance:editor-exit' })
    );
    expect(mocks.scheduleProcessWorkingSetTrim).toHaveBeenCalledWith(
      'tree',
      expect.objectContaining({ reason: 'memory-governance:editor-exit' })
    );
  });

  it('hibernates idle capsules that exceed declared participant budgets before retention expires', async () => {
    mocks.isTauri = false;
    let now = 1_000;
    const runtimeCapsuleManager = new DefaultRuntimeCapsuleManagerService(() => now);
    runtimeCapsuleManager.registerCapsule({
      id: 'plugin.runtime',
      kind: 'plugin',
      memoryTier: 'medium',
      startup: 'first-use',
      backgroundPolicy: 'while-active',
      warmRetentionMs: 60_000,
      hibernateAfterMs: 300_000,
      provides: ['plugin.runtime'],
      budget: {
        maxListeners: 1,
      },
    });
    runtimeCapsuleManager.registerParticipant('plugin.runtime', {
      id: 'plugin-host',
      capsuleId: 'plugin.runtime',
      collectSnapshot: () => ({
        id: 'plugin-host',
        capsuleId: 'plugin.runtime',
        state: 'idle-warm',
        listeners: 3,
      }),
    });
    const lease = runtimeCapsuleManager.acquireLease({
      capabilityId: 'plugin.runtime',
      ownerKind: 'plugin',
      ownerId: 'plugin-host',
    });

    now = 2_000;
    runtimeCapsuleManager.releaseLease(lease?.id ?? '');

    const result = await createService({ runtimeCapsuleManager }).runOnce('interval');

    expect(result.snapshot.runtimeCapsules).toMatchObject({
      budgetViolationCapsuleIds: ['plugin.runtime'],
      reclaimableCapsuleIds: ['plugin.runtime'],
    });
    expect(result.executed).toContain('hibernate-idle-runtime-capsules');
    expect(runtimeCapsuleManager.collectSnapshot().capsules[0]).toMatchObject({
      state: 'hibernated',
      activeLeases: [],
    });
  });

  it('uses an injected cover cache host instead of reaching for a global music-library instance', async () => {
    mocks.isTauri = false;
    const coverHost = {
      getCoverRuntimeCacheStats: vi.fn(() => ({
        coverUrlCacheEntries: 0,
        coverBlobUrlCacheEntries: 1,
        coverBlobUrlTotalBytes: 11 * 1024 * 1024,
        coverDecodedEstimateEntries: 0,
        coverDecodedEstimateTotalBytes: 0,
        coverUrlInflight: 0,
        albumCoverUrlCacheEntries: 0,
        albumCoverUrlInflight: 0,
      })),
      clearCoverRuntimeCaches: vi.fn(),
      applyCoverRuntimeCachePolicy: vi.fn(),
    };

    const result = await createService({
      coverRuntimeCacheHostProvider: () => coverHost,
    }).runOnce('interval');

    expect(result.executed).toContain('tighten-cover-runtime-caches-watch');
    expect(coverHost.getCoverRuntimeCacheStats).toHaveBeenCalledTimes(1);
    expect(coverHost.applyCoverRuntimeCachePolicy).toHaveBeenCalledWith('watch');
  });
});
