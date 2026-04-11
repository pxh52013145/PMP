import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContributionRegistry, ServiceRegistry } from '../../kernel';
import type { CommandContribution } from '../../contracts/contributions';
import { SHELL_SURFACE_MANAGER_TOKEN, DefaultShellSurfaceManager } from './shellSurfaceManager';
import { createPmpmContributionsModule } from './pmpmContributionsModule';
import { createInstalledExtensionContributionsModule } from './extensionContributionsModule';
import { INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN } from './installedExtensionRuntimeManager';

type MockPmpmPlugin = {
  manifest: {
    metadata: {
      id: string;
      name: string;
      version: string;
    };
    permissions: string[];
    contributions?: {
      shellSurfaces?: Array<{
        kind: 'shell-surface';
        id: string;
        title: string;
        surfaceType: 'overlay' | 'desktop-widget';
        width: number;
        height: number;
        pointerPolicy: 'capture-input' | 'passthrough';
      }>;
    };
  };
  installedAt: number;
  enabled: boolean;
  disabledReason?: string;
};

type MockInstalledExtensionRecord = {
  manifest: {
    schemaVersion: '2.0';
    kind: 'extension';
    identity: {
      id: string;
      publisher: string;
      version: string;
      name: string;
      displayName: string;
    };
    hostTargets: Array<{ hostId: string }>;
    runtimes: Array<{
      runtimeId: string;
      kind: 'webview';
      entry: string;
      platform: string[];
      arch: string[];
    }>;
    contributes: {
      host: {
        pmp: {
          shellSurfaces: Array<{
            id: string;
            title: string;
            surfaceType: 'overlay' | 'desktop-widget';
            width: number;
            height: number;
            pointerPolicy: 'capture-input' | 'passthrough';
          }>;
        };
      };
    };
  };
  installedAt: number;
  enabled: boolean;
  disabledReason?: string;
};

const harness = vi.hoisted(() => {
  type PmpmListener = () => void;
  type ExtensionListener = () => void;
  type RestartKind = 'pmpm' | 'extv2';
  type RestartListener = () => void;

  return {
    telemetryLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      log: vi.fn(),
      metric: vi.fn(),
      startSpan: vi.fn(() => ({ end: vi.fn() })),
    },
    pmpmPlugins: [] as MockPmpmPlugin[],
    installedExtensions: [] as MockInstalledExtensionRecord[],
    pmpmListeners: new Set<PmpmListener>(),
    extensionListeners: new Set<ExtensionListener>(),
    restartListeners: new Set<RestartListener>(),
    restartRequests: {
      pmpm: null as { kind: RestartKind; pluginId: string; at: number; reason?: string } | null,
      extv2: null as { kind: RestartKind; pluginId: string; at: number; reason?: string } | null,
    },
    clearPmpmPluginRuntimeCacheMock: vi.fn(),
    requestHostExtensionRuntimeRestartMock: vi.fn(),
    recordPmpmPluginCrashMock: vi.fn(),
    invokeWithTelemetryMock: vi.fn(async () => undefined),
    getMainWindowBoundsMock: vi.fn(async () => ({
      x: 100,
      y: 80,
      width: 1200,
      height: 800,
    })),
    isTauriRuntimeMock: vi.fn(() => true),
    emitPmpmSync() {
      for (const listener of Array.from(this.pmpmListeners)) {
        listener();
      }
    },
    emitExtensionSync() {
      for (const listener of Array.from(this.extensionListeners)) {
        listener();
      }
    },
    emitRestartSignal() {
      for (const listener of Array.from(this.restartListeners)) {
        listener();
      }
    },
    reset() {
      this.telemetryLogger.info.mockReset();
      this.telemetryLogger.warn.mockReset();
      this.telemetryLogger.error.mockReset();
      this.telemetryLogger.debug.mockReset();
      this.telemetryLogger.trace.mockReset();
      this.telemetryLogger.fatal.mockReset();
      this.telemetryLogger.log.mockReset();
      this.telemetryLogger.metric.mockReset();
      this.telemetryLogger.startSpan.mockClear();
      this.pmpmPlugins = [];
      this.installedExtensions = [];
      this.pmpmListeners.clear();
      this.extensionListeners.clear();
      this.restartListeners.clear();
      this.restartRequests.pmpm = null;
      this.restartRequests.extv2 = null;
      this.clearPmpmPluginRuntimeCacheMock.mockReset();
      this.requestHostExtensionRuntimeRestartMock.mockReset();
      this.recordPmpmPluginCrashMock.mockReset();
      this.invokeWithTelemetryMock.mockReset();
      this.invokeWithTelemetryMock.mockResolvedValue(undefined);
      this.getMainWindowBoundsMock.mockReset();
      this.getMainWindowBoundsMock.mockResolvedValue({
        x: 100,
        y: 80,
        width: 1200,
        height: 800,
      });
      this.isTauriRuntimeMock.mockReset();
      this.isTauriRuntimeMock.mockReturnValue(true);
    },
  };
});

vi.mock('../../services/telemetry/TelemetryService', () => ({
  getTelemetryLogger: () => harness.telemetryLogger,
}));

vi.mock('../../services/telemetry/tauriInvokeTelemetry', () => ({
  invokeWithTelemetry: harness.invokeWithTelemetryMock,
}));

vi.mock('../../utils/editorWindows', () => ({
  getMainWindowBounds: harness.getMainWindowBoundsMock,
}));

vi.mock('../../utils/tauriRuntime', () => ({
  isTauriRuntime: harness.isTauriRuntimeMock,
}));

vi.mock('./pmpm', () => ({
  loadInstalledPmpmPlugins: () => harness.pmpmPlugins,
  getInstalledPmpmPlugin: (id: string) =>
    harness.pmpmPlugins.find((plugin) => plugin.manifest.metadata.id === id) ?? null,
  subscribePmpmPlugins: (listener: () => void) => {
    harness.pmpmListeners.add(listener);
    return () => harness.pmpmListeners.delete(listener);
  },
  recordPmpmPluginCrash: harness.recordPmpmPluginCrashMock,
}));

vi.mock('./extensions', () => ({
  loadInstalledExtensions: () => harness.installedExtensions,
  getInstalledExtensionRecord: (id: string) =>
    harness.installedExtensions.find((record) => record.manifest.identity.id === id) ?? null,
  subscribeInstalledExtensions: (listener: () => void) => {
    harness.extensionListeners.add(listener);
    return () => harness.extensionListeners.delete(listener);
  },
}));

vi.mock('./hostExtensionRuntimeSupervisor', () => ({
  subscribeHostExtensionRuntimeRestart: (listener: () => void) => {
    harness.restartListeners.add(listener);
    return () => harness.restartListeners.delete(listener);
  },
  readHostExtensionRuntimeRestartRequest: (kind: 'pmpm' | 'extv2') =>
    harness.restartRequests[kind],
  requestHostExtensionRuntimeRestart: harness.requestHostExtensionRuntimeRestartMock,
}));

vi.mock('./pmpmRuntime', () => ({
  clearPmpmPluginRuntimeCache: harness.clearPmpmPluginRuntimeCacheMock,
}));

function createPmpmShellSurfacePlugin(): MockPmpmPlugin {
  return {
    manifest: {
      metadata: {
        id: 'demo-plugin',
        name: 'Demo Plugin',
        version: '1.0.0',
      },
      permissions: [],
      contributions: {
        shellSurfaces: [
          {
            kind: 'shell-surface',
            id: 'demo-overlay',
            title: 'Demo Overlay',
            surfaceType: 'overlay',
            width: 420,
            height: 260,
            pointerPolicy: 'capture-input',
          },
        ],
      },
    },
    installedAt: 1,
    enabled: true,
  };
}

function createInstalledExtensionShellSurfaceRecord(): MockInstalledExtensionRecord {
  return {
    manifest: {
      schemaVersion: '2.0',
      kind: 'extension',
      identity: {
        id: 'demo-extension',
        publisher: 'pixel',
        version: '1.0.0',
        name: 'Demo Extension',
        displayName: 'Demo Extension',
      },
      hostTargets: [{ hostId: 'pmp' }],
      runtimes: [
        {
          runtimeId: 'webview.main',
          kind: 'webview',
          entry: 'dist/index.html',
          platform: ['win32'],
          arch: ['x64'],
        },
      ],
      contributes: {
        host: {
          pmp: {
            shellSurfaces: [
              {
                id: 'demo-widget',
                title: 'Demo Widget',
                surfaceType: 'desktop-widget',
                width: 320,
                height: 220,
                pointerPolicy: 'passthrough',
              },
            ],
          },
        },
      },
    },
    installedAt: 1,
    enabled: true,
  };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  harness.reset();
});

afterEach(() => {
  harness.reset();
});

describe('shell-surface governance integration', () => {
  it('routes a registered PMPM shell-surface summon command into manager tracking and cleans up on runtime revoke signal', async () => {
    harness.pmpmPlugins = [createPmpmShellSurfacePlugin()];
    const contributions = new ContributionRegistry();
    const services = new ServiceRegistry();
    const openSurface = vi.fn(async () => undefined);
    const destroySurface = vi.fn(async () => undefined);
    const manager = new DefaultShellSurfaceManager({
      enableBackgroundSync: true,
      deps: {
        openSurface,
        destroySurface,
      },
    });

    services.register(SHELL_SURFACE_MANAGER_TOKEN, manager);
    const disposeManager = () => manager.dispose();
    manager.start();

    const module = createPmpmContributionsModule();
    const deactivate = module.activate({
      contributions,
      services,
      events: {} as never,
    });

    const command = contributions.get<CommandContribution>(
      'command',
      'pmpm:demo-plugin:shell-surface:demo-overlay:summon'
    );
    expect(command).not.toBeNull();

    await command?.run();

    expect(openSurface).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKind: 'pmpm',
        pluginId: 'demo-plugin',
        surfaceId: 'demo-overlay',
        surfaceType: 'overlay',
      })
    );
    expect(manager.listTrackedSurfaces()).toHaveLength(1);

    harness.restartRequests.pmpm = {
      kind: 'pmpm',
      pluginId: 'demo-plugin',
      at: Date.now(),
      reason: 'capability-revoke',
    };
    harness.emitRestartSignal();
    await flushAsyncWork();

    expect(destroySurface).toHaveBeenCalledWith(
      'demo-plugin',
      'demo-overlay',
      'overlay',
      'pmpm'
    );
    expect(manager.listTrackedSurfaces()).toEqual([]);
    expect(
      contributions.get('command', 'pmpm:demo-plugin:shell-surface:demo-overlay:summon')
    ).not.toBeNull();

    if (typeof deactivate === 'function') {
      deactivate();
    }
    disposeManager();
  });

  it('unregisters extv2 shell-surface commands and cleans tracked surfaces when the plugin becomes disabled', async () => {
    harness.installedExtensions = [createInstalledExtensionShellSurfaceRecord()];
    const contributions = new ContributionRegistry();
    const services = new ServiceRegistry();
    const openSurface = vi.fn(async () => undefined);
    const destroySurface = vi.fn(async () => undefined);
    const manager = new DefaultShellSurfaceManager({
      enableBackgroundSync: true,
      deps: {
        openSurface,
        destroySurface,
      },
    });

    services.register(SHELL_SURFACE_MANAGER_TOKEN, manager);
    services.register(INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN, {
      runCommand: vi.fn(),
    } as never);
    manager.start();

    const module = createInstalledExtensionContributionsModule();
    const deactivate = module.activate({
      contributions,
      services,
      events: {} as never,
    });

    const command = contributions.get<CommandContribution>(
      'command',
      'extv2:demo-extension:shell-surface:demo-widget:summon'
    );
    expect(command).not.toBeNull();

    await command?.run();

    expect(openSurface).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKind: 'extv2',
        pluginId: 'demo-extension',
        surfaceId: 'demo-widget',
        surfaceType: 'desktop-widget',
      })
    );
    expect(manager.listTrackedSurfaces()).toHaveLength(1);

    harness.installedExtensions = [
      {
        ...createInstalledExtensionShellSurfaceRecord(),
        enabled: false,
        disabledReason: 'crash',
      },
    ];
    harness.emitExtensionSync();
    await flushAsyncWork();

    expect(
      contributions.get('command', 'extv2:demo-extension:shell-surface:demo-widget:summon')
    ).toBeNull();
    expect(destroySurface).toHaveBeenCalledWith(
      'demo-extension',
      'demo-widget',
      'desktop-widget',
      'extv2'
    );
    expect(manager.listTrackedSurfaces()).toEqual([]);

    if (typeof deactivate === 'function') {
      deactivate();
    }
    manager.dispose();
  });

  it('routes PMPM shell-surface summon and revoke cleanup through the tauri window contract', async () => {
    harness.pmpmPlugins = [createPmpmShellSurfacePlugin()];
    const contributions = new ContributionRegistry();
    const services = new ServiceRegistry();
    const manager = new DefaultShellSurfaceManager({
      enableBackgroundSync: true,
    });

    services.register(SHELL_SURFACE_MANAGER_TOKEN, manager);
    manager.start();

    const module = createPmpmContributionsModule();
    const deactivate = module.activate({
      contributions,
      services,
      events: {} as never,
    });

    const command = contributions.get<CommandContribution>(
      'command',
      'pmpm:demo-plugin:shell-surface:demo-overlay:summon'
    );
    expect(command).not.toBeNull();

    await command?.run();

    expect(harness.invokeWithTelemetryMock).toHaveBeenNthCalledWith(
      1,
      'open_plugin_shell_surface',
      expect.objectContaining({
        sourceKind: 'pmpm',
        pluginId: 'demo-plugin',
        surfaceId: 'demo-overlay',
        surfaceType: 'overlay',
      }),
      expect.objectContaining({
        event: 'window.plugin-shell-surface.open',
      })
    );

    harness.restartRequests.pmpm = {
      kind: 'pmpm',
      pluginId: 'demo-plugin',
      at: Date.now(),
      reason: 'runtime-unresponsive',
    };
    harness.emitRestartSignal();
    await flushAsyncWork();

    expect(harness.invokeWithTelemetryMock).toHaveBeenNthCalledWith(
      2,
      'destroy_plugin_shell_surface',
      {
        sourceKind: 'pmpm',
        pluginId: 'demo-plugin',
        surfaceId: 'demo-overlay',
        surfaceType: 'overlay',
      },
      expect.objectContaining({
        event: 'window.plugin-shell-surface.destroy',
      })
    );

    if (typeof deactivate === 'function') {
      deactivate();
    }
    manager.dispose();
  });

  it('routes extv2 disable cleanup through the tauri destroy shell-surface contract', async () => {
    harness.installedExtensions = [createInstalledExtensionShellSurfaceRecord()];
    const contributions = new ContributionRegistry();
    const services = new ServiceRegistry();
    const manager = new DefaultShellSurfaceManager({
      enableBackgroundSync: true,
    });

    services.register(SHELL_SURFACE_MANAGER_TOKEN, manager);
    services.register(INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN, {
      runCommand: vi.fn(),
    } as never);
    manager.start();

    const module = createInstalledExtensionContributionsModule();
    const deactivate = module.activate({
      contributions,
      services,
      events: {} as never,
    });

    const command = contributions.get<CommandContribution>(
      'command',
      'extv2:demo-extension:shell-surface:demo-widget:summon'
    );
    expect(command).not.toBeNull();

    await command?.run();

    expect(harness.invokeWithTelemetryMock).toHaveBeenNthCalledWith(
      1,
      'open_plugin_shell_surface',
      expect.objectContaining({
        sourceKind: 'extv2',
        pluginId: 'demo-extension',
        surfaceId: 'demo-widget',
        surfaceType: 'desktop-widget',
      }),
      expect.objectContaining({
        event: 'window.plugin-shell-surface.open',
      })
    );

    harness.installedExtensions = [
      {
        ...createInstalledExtensionShellSurfaceRecord(),
        enabled: false,
        disabledReason: 'crash',
      },
    ];
    harness.emitExtensionSync();
    await flushAsyncWork();

    expect(harness.invokeWithTelemetryMock).toHaveBeenNthCalledWith(
      2,
      'destroy_plugin_shell_surface',
      {
        sourceKind: 'extv2',
        pluginId: 'demo-extension',
        surfaceId: 'demo-widget',
        surfaceType: 'desktop-widget',
      },
      expect.objectContaining({
        event: 'window.plugin-shell-surface.destroy',
      })
    );

    if (typeof deactivate === 'function') {
      deactivate();
    }
    manager.dispose();
  });
});
