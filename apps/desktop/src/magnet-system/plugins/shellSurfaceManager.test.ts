import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('DefaultShellSurfaceManager', () => {
  it('tracks shell surfaces after a successful summon', async () => {
    const { DefaultShellSurfaceManager } = await import('./shellSurfaceManager');
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
    const { DefaultShellSurfaceManager } = await import('./shellSurfaceManager');
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
    const { DefaultShellSurfaceManager } = await import('./shellSurfaceManager');
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
    const { DefaultShellSurfaceManager } = await import('./shellSurfaceManager');
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

  it('runtime restart cleanup destroys tracked surfaces for the restarting plugin', async () => {
    const { DefaultShellSurfaceManager } = await import('./shellSurfaceManager');
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
});
