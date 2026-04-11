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
type SourceKind = 'pmpm' | 'extv2';

function createSpec(options: {
  sourceKind?: SourceKind;
  pluginId?: string;
  pluginName?: string;
  surfaceId?: string;
  surfaceType?: ShellSurfaceType;
}) {
  return {
    sourceKind: options.sourceKind ?? 'pmpm',
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
        sourceKind: 'pmpm',
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
      sourceKind: 'pmpm',
      pluginId: 'demo-plugin',
      surfaceId: 'demo-overlay',
      surfaceType: 'overlay',
    });

    expect(dismissSurface).toHaveBeenCalledWith(
      'demo-plugin',
      'demo-overlay',
      'overlay',
      'pmpm'
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
      sourceKind: 'pmpm',
      pluginId: 'demo-plugin',
      surfaceId: 'demo-overlay',
      surfaceType: 'overlay',
      reason: 'manual-test',
    });

    expect(destroySurface).toHaveBeenCalledWith(
      'demo-plugin',
      'demo-overlay',
      'overlay',
      'pmpm'
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
                sourceKind: 'pmpm',
                pluginId: 'demo-plugin',
                pluginName: 'Demo Plugin',
                surfaceId: 'demo-overlay',
              },
        subscribePmpm: (cb) => {
          syncCallback = cb;
          return () => {};
        },
        subscribeExtensions: () => () => {},
        subscribeRuntimeRestart: () => () => {},
        readRuntimeRestart: () => null,
      },
    });

    manager.start();
    await manager.summonSurface(spec);
    lookupStatus = 'missing-surface';
    expect(syncCallback).not.toBeNull();
    (syncCallback as unknown as () => void)();
    await flushAsyncWork();

    expect(destroySurface).toHaveBeenCalledWith(
      'demo-plugin',
      'demo-overlay',
      'overlay',
      'pmpm'
    );
    expect(manager.listTrackedSurfaces()).toEqual([]);
  });

  it('background sync cleans up tracked surfaces when the plugin becomes disabled after summon', async () => {
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
                sourceKind: 'pmpm',
                pluginId: 'demo-plugin',
                pluginName: 'Demo Plugin',
                surfaceId: 'demo-overlay',
              },
        subscribePmpm: (cb) => {
          syncCallback = cb;
          return () => {};
        },
        subscribeExtensions: () => () => {},
        subscribeRuntimeRestart: () => () => {},
        readRuntimeRestart: () => null,
      },
    });

    manager.start();
    await manager.summonSurface(spec);
    lookupStatus = 'disabled-plugin';
    expect(syncCallback).not.toBeNull();
    (syncCallback as unknown as () => void)();
    await flushAsyncWork();

    expect(destroySurface).toHaveBeenCalledWith(
      'demo-plugin',
      'demo-overlay',
      'overlay',
      'pmpm'
    );
    expect(telemetryLoggerMock.info).toHaveBeenCalledWith(
      'plugin.governance.cleanup.start',
      expect.objectContaining({
        fields: expect.objectContaining({
          reason: 'plugin-disabled',
          pluginId: 'demo-plugin',
          surfaceId: 'demo-overlay',
          surfaceKind: 'overlay',
        }),
      })
    );
    expect(manager.listTrackedSurfaces()).toEqual([]);
  });

  it('background sync cleans up tracked surfaces when the plugin disappears after uninstall', async () => {
    const openSurface = vi.fn(async () => undefined);
    const destroySurface = vi.fn(async () => undefined);
    let syncCallback: (() => void) | null = null;
    let lookupStatus: 'present' | 'missing-plugin' = 'present';
    const spec = createSpec({
      sourceKind: 'extv2',
      pluginId: 'demo.extension',
      pluginName: 'Demo Extension',
      surfaceId: 'demo-widget',
      surfaceType: 'desktop-widget',
    });

    const manager = new DefaultShellSurfaceManager({
      enableBackgroundSync: true,
      deps: {
        openSurface,
        destroySurface,
        inspectSurface: () =>
          lookupStatus === 'present'
            ? { status: 'present', record: spec }
            : {
                status: 'missing-plugin',
                sourceKind: 'extv2',
                pluginId: 'demo.extension',
                surfaceId: 'demo-widget',
              },
        subscribePmpm: () => () => {},
        subscribeExtensions: (cb) => {
          syncCallback = cb;
          return () => {};
        },
        subscribeRuntimeRestart: () => () => {},
        readRuntimeRestart: () => null,
      },
    });

    manager.start();
    await manager.summonSurface(spec);
    lookupStatus = 'missing-plugin';
    expect(syncCallback).not.toBeNull();
    (syncCallback as unknown as () => void)();
    await flushAsyncWork();

    expect(destroySurface).toHaveBeenCalledWith(
      'demo.extension',
      'demo-widget',
      'desktop-widget',
      'extv2'
    );
    expect(telemetryLoggerMock.info).toHaveBeenCalledWith(
      'plugin.governance.cleanup.start',
      expect.objectContaining({
        fields: expect.objectContaining({
          reason: 'plugin-missing',
          pluginId: 'demo.extension',
          surfaceId: 'demo-widget',
          surfaceKind: 'desktop-widget',
        }),
      })
    );
    expect(manager.listTrackedSurfaces()).toEqual([]);
  });

  it('environment restore re-opens tracked shell surfaces to reassert placement and visibility', async () => {
    const openSurface = vi.fn(async () => undefined);
    let environmentCallback: ((signal: ShellSurfaceEnvironmentSignal) => void) | null = null;
    const spec = createSpec({});

    const manager = new DefaultShellSurfaceManager({
      enableBackgroundSync: true,
      deps: {
        openSurface,
        inspectSurface: () => ({ status: 'present', record: spec }),
        subscribePmpm: () => () => {},
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

    expect(environmentCallback).not.toBeNull();
    environmentCallback!('display-metrics-changed');
    await flushAsyncWork();

    expect(openSurface).toHaveBeenCalledTimes(2);
    expect(openSurface).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceKind: 'pmpm',
        pluginId: 'demo-plugin',
        surfaceId: 'demo-overlay',
        surfaceType: 'overlay',
      })
    );
    expect(manager.listTrackedSurfaces()).toEqual([spec]);
  });

  it('environment restore cleans missing tracked shell surfaces instead of re-opening them', async () => {
    const openSurface = vi.fn(async () => undefined);
    const destroySurface = vi.fn(async () => undefined);
    let environmentCallback: ((signal: ShellSurfaceEnvironmentSignal) => void) | null = null;
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
                sourceKind: 'pmpm',
                pluginId: 'demo-plugin',
                pluginName: 'Demo Plugin',
                surfaceId: 'demo-overlay',
              },
        subscribePmpm: () => () => {},
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
    lookupStatus = 'missing-surface';

    expect(environmentCallback).not.toBeNull();
    environmentCallback!('page-resume');
    await flushAsyncWork();

    expect(openSurface).toHaveBeenCalledTimes(1);
    expect(destroySurface).toHaveBeenCalledWith(
      'demo-plugin',
      'demo-overlay',
      'overlay',
      'pmpm'
    );
    expect(manager.listTrackedSurfaces()).toEqual([]);
  });

  it('runtime restart cleanup destroys tracked surfaces for the restarting plugin', async () => {
    const openSurface = vi.fn(async () => undefined);
    const destroySurface = vi.fn(async () => undefined);
    let restartCallback: (() => void) | null = null;
    let restartRequest:
      | {
          kind: SourceKind;
          pluginId: string;
          at: number;
          reason?: string;
        }
      | null = null;
    const spec = createSpec({
      sourceKind: 'extv2',
      pluginId: 'demo.extension',
      pluginName: 'Demo Extension',
      surfaceId: 'demo-widget',
      surfaceType: 'desktop-widget',
    });

    const manager = new DefaultShellSurfaceManager({
      enableBackgroundSync: true,
      deps: {
        openSurface,
        destroySurface,
        inspectSurface: () => ({ status: 'present', record: spec }),
        subscribePmpm: () => () => {},
        subscribeExtensions: () => () => {},
        subscribeRuntimeRestart: (cb) => {
          restartCallback = cb;
          return () => {};
        },
        readRuntimeRestart: (kind) => (restartRequest?.kind === kind ? restartRequest : null),
      },
    });

    manager.start();
    await manager.summonSurface(spec);
    restartRequest = {
      kind: 'extv2',
      pluginId: 'demo.extension',
      at: Date.now(),
      reason: 'runtime-restart',
    };
    expect(restartCallback).not.toBeNull();
    (restartCallback as unknown as () => void)();
    await flushAsyncWork();

    expect(destroySurface).toHaveBeenCalledWith(
      'demo.extension',
      'demo-widget',
      'desktop-widget',
      'extv2'
    );
    expect(manager.listTrackedSurfaces()).toEqual([]);
  });

  it('revoke/crash restart cleanup removes every tracked surface for the target plugin only', async () => {
    const openSurface = vi.fn(async () => undefined);
    const destroySurface = vi.fn(async () => undefined);
    let restartCallback: (() => void) | null = null;
    let restartRequest:
      | {
          kind: SourceKind;
          pluginId: string;
          at: number;
          reason?: string;
        }
      | null = null;
    const targetOverlay = createSpec({
      sourceKind: 'pmpm',
      pluginId: 'target-plugin',
      pluginName: 'Target Plugin',
      surfaceId: 'target-overlay',
      surfaceType: 'overlay',
    });
    const targetWidget = createSpec({
      sourceKind: 'pmpm',
      pluginId: 'target-plugin',
      pluginName: 'Target Plugin',
      surfaceId: 'target-widget',
      surfaceType: 'desktop-widget',
    });
    const unaffected = createSpec({
      sourceKind: 'pmpm',
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
        subscribePmpm: () => () => {},
        subscribeExtensions: () => () => {},
        subscribeRuntimeRestart: (cb) => {
          restartCallback = cb;
          return () => {};
        },
        readRuntimeRestart: (kind) => (restartRequest?.kind === kind ? restartRequest : null),
      },
    });

    manager.start();
    await manager.summonSurface(targetOverlay);
    await manager.summonSurface(targetWidget);
    await manager.summonSurface(unaffected);

    restartRequest = {
      kind: 'pmpm',
      pluginId: 'target-plugin',
      at: Date.now(),
      reason: 'capability-revoke',
    };
    expect(restartCallback).not.toBeNull();
    (restartCallback as unknown as () => void)();
    await flushAsyncWork();

    expect(destroySurface).toHaveBeenNthCalledWith(
      1,
      'target-plugin',
      'target-overlay',
      'overlay',
      'pmpm'
    );
    expect(destroySurface).toHaveBeenNthCalledWith(
      2,
      'target-plugin',
      'target-widget',
      'desktop-widget',
      'pmpm'
    );
    expect(destroySurface).toHaveBeenCalledTimes(2);
    expect(telemetryLoggerMock.info).toHaveBeenCalledWith(
      'plugin.governance.cleanup.start',
      expect.objectContaining({
        fields: expect.objectContaining({
          pluginId: 'target-plugin',
          reason: 'capability-revoke',
        }),
      })
    );
    expect(manager.listTrackedSurfaces()).toEqual([unaffected]);
  });
});
