import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ShellSurfaceEnvironmentSignal } from './shellSurfaceManager';

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

type ShellSurfaceType = 'overlay' | 'desktop-widget';

function createSpec(options: {
  pluginId?: string;
  pluginName?: string;
  surfaceId?: string;
  surfaceType?: ShellSurfaceType;
}) {
  return {
    sourceKind: 'extv2' as const,
    pluginId: options.pluginId ?? 'demo-plugin',
    pluginName: options.pluginName ?? 'Demo Plugin',
    enabled: true,
    descriptor: {
      kind: 'shell-surface' as const,
      id: options.surfaceId ?? 'demo-overlay',
      title: 'Demo Surface',
      surfaceType: options.surfaceType ?? 'overlay',
      width: 480,
      height: 320,
      pointerPolicy: 'capture-input' as const,
    },
  };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.clearAllMocks();
});

let DefaultShellSurfaceManager: typeof import('./shellSurfaceManager').DefaultShellSurfaceManager;

beforeAll(async () => {
  ({ DefaultShellSurfaceManager } = await import('./shellSurfaceManager'));
});

describe('DefaultShellSurfaceManager', () => {
  it('tracks shell surfaces after a successful summon', async () => {
    const openSurface = vi.fn(async () => undefined);
    const manager = new DefaultShellSurfaceManager({
      enableBackgroundSync: false,
      deps: {
        openSurface,
      },
    });
    const spec = createSpec({});

    await manager.summonSurface(spec);

    expect(openSurface).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKind: 'extv2',
        pluginId: 'demo-plugin',
        surfaceId: 'demo-overlay',
        surfaceType: 'overlay',
      })
    );
    expect(manager.listTrackedSurfaces()).toEqual([spec]);
  });

  it('dismisses tracked shell surfaces without removing them from tracking', async () => {
    const openSurface = vi.fn(async () => undefined);
    const dismissSurface = vi.fn(async () => undefined);
    const manager = new DefaultShellSurfaceManager({
      enableBackgroundSync: false,
      deps: {
        openSurface,
        dismissSurface,
      },
    });
    const spec = createSpec({});

    await manager.summonSurface(spec);
    await manager.dismissSurface({
      sourceKind: 'extv2',
      pluginId: 'demo-plugin',
      surfaceId: 'demo-overlay',
      surfaceType: 'overlay',
    });

    expect(dismissSurface).toHaveBeenCalledWith(
      'demo-plugin',
      'demo-overlay',
      'overlay',
      'extv2'
    );
    expect(manager.listTrackedSurfaces()).toEqual([spec]);
  });

  it('cleans up tracked shell surfaces by destroying and untracking them', async () => {
    const openSurface = vi.fn(async () => undefined);
    const destroySurface = vi.fn(async () => undefined);
    const manager = new DefaultShellSurfaceManager({
      enableBackgroundSync: false,
      deps: {
        openSurface,
        destroySurface,
      },
    });
    const spec = createSpec({});

    await manager.summonSurface(spec);
    await manager.cleanupSurface({
      sourceKind: 'extv2',
      pluginId: 'demo-plugin',
      surfaceId: 'demo-overlay',
      surfaceType: 'overlay',
      reason: 'manual-test',
    });

    expect(destroySurface).toHaveBeenCalledWith(
      'demo-plugin',
      'demo-overlay',
      'overlay',
      'extv2',
      'manual-test'
    );
    expect(manager.listTrackedSurfaces()).toEqual([]);
  });

  it('background sync cleans up tracked surfaces when the descriptor disappears', async () => {
    const openSurface = vi.fn(async () => undefined);
    const destroySurface = vi.fn(async () => undefined);
    let syncCallback: (() => void) | null = null;
    let lookupStatus: 'present' | 'missing-surface' = 'present';
    const spec = createSpec({});

    const manager = new DefaultShellSurfaceManager({
      enableBackgroundSync: true,
      deps: {
        openSurface,
        destroySurface,
        inspectSurface: () =>
          lookupStatus === 'present'
            ? { status: 'present', record: spec }
            : {
                status: 'missing-surface',
                sourceKind: 'extv2',
                pluginId: 'demo-plugin',
                pluginName: 'Demo Plugin',
                surfaceId: 'demo-overlay',
              },
        subscribeExtensions: (cb: () => void) => {
          syncCallback = cb;
          return () => {};
        },
        subscribeRuntimeRestart: () => () => {},
        readRuntimeRestart: () => null,
      },
    });

    manager.start();
    await manager.summonSurface(spec);
    lookupStatus = 'missing-surface';
    const missingSurfaceSync = syncCallback as (() => void) | null;
    if (typeof missingSurfaceSync !== 'function') {
      throw new Error('Expected background sync callback');
    }
    missingSurfaceSync();
    await flushAsyncWork();

    expect(destroySurface).toHaveBeenCalledWith(
      'demo-plugin',
      'demo-overlay',
      'overlay',
      'extv2',
      'surface-missing'
    );
    expect(manager.listTrackedSurfaces()).toEqual([]);
  });

  it('background sync cleans up tracked surfaces when the plugin becomes disabled', async () => {
    const openSurface = vi.fn(async () => undefined);
    const destroySurface = vi.fn(async () => undefined);
    let syncCallback: (() => void) | null = null;
    let lookupStatus: 'present' | 'disabled-plugin' = 'present';
    const spec = createSpec({});

    const manager = new DefaultShellSurfaceManager({
      enableBackgroundSync: true,
      deps: {
        openSurface,
        destroySurface,
        inspectSurface: () =>
          lookupStatus === 'present'
            ? { status: 'present', record: spec }
            : {
                status: 'disabled-plugin',
                sourceKind: 'extv2',
                pluginId: 'demo-plugin',
                pluginName: 'Demo Plugin',
                surfaceId: 'demo-overlay',
              },
        subscribeExtensions: (cb: () => void) => {
          syncCallback = cb;
          return () => {};
        },
        subscribeRuntimeRestart: () => () => {},
        readRuntimeRestart: () => null,
      },
    });

    manager.start();
    await manager.summonSurface(spec);
    lookupStatus = 'disabled-plugin';
    const disabledPluginSync = syncCallback as (() => void) | null;
    if (typeof disabledPluginSync !== 'function') {
      throw new Error('Expected background sync callback');
    }
    disabledPluginSync();
    await flushAsyncWork();

    expect(destroySurface).toHaveBeenCalledWith(
      'demo-plugin',
      'demo-overlay',
      'overlay',
      'extv2',
      'plugin-disabled'
    );
    expect(manager.listTrackedSurfaces()).toEqual([]);
  });

  it('environment restore re-opens tracked shell surfaces', async () => {
    const openSurface = vi.fn(async () => undefined);
    let environmentCallback: ((signal: ShellSurfaceEnvironmentSignal) => void) | null = null;
    const spec = createSpec({});

    const manager = new DefaultShellSurfaceManager({
      enableBackgroundSync: true,
      deps: {
        openSurface,
        inspectSurface: () => ({ status: 'present', record: spec }),
        subscribeExtensions: () => () => {},
        subscribeRuntimeRestart: () => () => {},
        readRuntimeRestart: () => null,
        subscribeEnvironmentSignals: (cb) => {
          environmentCallback = cb;
          return () => {};
        },
      },
    });

    manager.start();
    await manager.summonSurface(spec);

    const restoreEnvironment = environmentCallback as
      | ((signal: ShellSurfaceEnvironmentSignal) => void)
      | null;
    if (typeof restoreEnvironment !== 'function') {
      throw new Error('Expected environment callback');
    }
    restoreEnvironment('display-metrics-changed');
    await flushAsyncWork();

    expect(openSurface).toHaveBeenCalledTimes(2);
    expect(openSurface).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceKind: 'extv2',
        pluginId: 'demo-plugin',
        surfaceId: 'demo-overlay',
        surfaceType: 'overlay',
      })
    );
    expect(manager.listTrackedSurfaces()).toEqual([spec]);
  });

  it('runtime restart cleanup removes every tracked surface for the target plugin only', async () => {
    const openSurface = vi.fn(async () => undefined);
    const destroySurface = vi.fn(async () => undefined);
    let restartCallback: (() => void) | null = null;
    let restartRequest:
      | {
          kind: 'extv2';
          pluginId: string;
          at: number;
          reason?: string;
        }
      | null = null;
    const targetOverlay = createSpec({
      pluginId: 'target-plugin',
      pluginName: 'Target Plugin',
      surfaceId: 'target-overlay',
      surfaceType: 'overlay',
    });
    const targetWidget = createSpec({
      pluginId: 'target-plugin',
      pluginName: 'Target Plugin',
      surfaceId: 'target-widget',
      surfaceType: 'desktop-widget',
    });
    const unaffected = createSpec({
      pluginId: 'other-plugin',
      pluginName: 'Other Plugin',
      surfaceId: 'other-overlay',
      surfaceType: 'overlay',
    });

    const manager = new DefaultShellSurfaceManager({
      enableBackgroundSync: true,
      deps: {
        openSurface,
        destroySurface,
        inspectSurface: ({ pluginId, surfaceId, surfaceType }) => ({
          status: 'present',
          record:
            pluginId === 'target-plugin' && surfaceId === 'target-overlay'
              ? targetOverlay
              : pluginId === 'target-plugin' && surfaceId === 'target-widget'
                ? targetWidget
                : {
                    ...unaffected,
                    descriptor: {
                      ...unaffected.descriptor,
                      id: surfaceId,
                      surfaceType: surfaceType ?? unaffected.descriptor.surfaceType,
                    },
                  },
        }),
        subscribeExtensions: () => () => {},
        subscribeRuntimeRestart: (cb: () => void) => {
          restartCallback = cb;
          return () => {};
        },
        readRuntimeRestart: () => restartRequest,
      },
    });

    manager.start();
    await manager.summonSurface(targetOverlay);
    await manager.summonSurface(targetWidget);
    await manager.summonSurface(unaffected);

    restartRequest = {
      kind: 'extv2',
      pluginId: 'target-plugin',
      at: Date.now(),
      reason: 'capability-revoke',
    };
    const restartCleanup = restartCallback as (() => void) | null;
    if (typeof restartCleanup !== 'function') {
      throw new Error('Expected restart callback');
    }
    restartCleanup();
    await flushAsyncWork();

    expect(destroySurface).toHaveBeenNthCalledWith(
      1,
      'target-plugin',
      'target-overlay',
      'overlay',
      'extv2',
      'capability-revoke'
    );
    expect(destroySurface).toHaveBeenNthCalledWith(
      2,
      'target-plugin',
      'target-widget',
      'desktop-widget',
      'extv2',
      'capability-revoke'
    );
    expect(destroySurface).toHaveBeenCalledTimes(2);
    expect(manager.listTrackedSurfaces()).toEqual([unaffected]);
  });
});
