import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContributionRegistry, ServiceRegistry } from '../../kernel';
import type { CommandContribution } from '../../contracts/contributions';
import { SHELL_SURFACE_MANAGER_TOKEN, DefaultShellSurfaceManager } from './shellSurfaceManager';
import { createInstalledExtensionContributionsModule } from './extensionContributionsModule';
import { INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN } from './installedExtensionRuntimeManager';

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
  type ExtensionListener = () => void;
  type RestartKind = 'extv2';
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
    installedExtensions: [] as MockInstalledExtensionRecord[],
    extensionListeners: new Set<ExtensionListener>(),
    restartListeners: new Set<RestartListener>(),
    restartRequests: {
      extv2: null as { kind: RestartKind; pluginId: string; at: number; reason?: string } | null,
    },
    requestHostExtensionRuntimeRestartMock: vi.fn(),
    invokeWithTelemetryMock: vi.fn(async () => undefined),
    getMainWindowBoundsMock: vi.fn(async () => ({
      x: 100,
      y: 80,
      width: 1200,
      height: 800,
    })),
    isTauriRuntimeMock: vi.fn(() => true),
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
      this.installedExtensions = [];
      this.extensionListeners.clear();
      this.restartListeners.clear();
      this.restartRequests.extv2 = null;
      this.requestHostExtensionRuntimeRestartMock.mockReset();
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
  readHostExtensionRuntimeRestartRequest: () => harness.restartRequests.extv2,
  requestHostExtensionRuntimeRestart: harness.requestHostExtensionRuntimeRestartMock,
}));

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
  it('routes a registered extv2 shell-surface summon command into manager tracking and cleans up on runtime revoke signal', async () => {
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
    const disposeManager = () => manager.dispose();
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

    harness.restartRequests.extv2 = {
      kind: 'extv2',
      pluginId: 'demo-extension',
      at: Date.now(),
      reason: 'capability-revoke',
    };
    harness.emitRestartSignal();
    await flushAsyncWork();

    expect(destroySurface).toHaveBeenCalledWith(
      'demo-extension',
      'demo-widget',
      'desktop-widget',
      'extv2',
      'capability-revoke'
    );
    expect(manager.listTrackedSurfaces()).toEqual([]);
    expect(
      contributions.get('command', 'extv2:demo-extension:shell-surface:demo-widget:summon')
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
      'extv2',
      'plugin-disabled'
    );
    expect(manager.listTrackedSurfaces()).toEqual([]);

    if (typeof deactivate === 'function') {
      deactivate();
    }
    manager.dispose();
  });

  it('routes extv2 shell-surface summon and runtime-unresponsive cleanup through the tauri window contract', async () => {
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

    harness.restartRequests.extv2 = {
      kind: 'extv2',
      pluginId: 'demo-extension',
      at: Date.now(),
      reason: 'runtime-unresponsive',
    };
    harness.emitRestartSignal();
    await flushAsyncWork();

    expect(harness.invokeWithTelemetryMock).toHaveBeenNthCalledWith(
      2,
      'destroy_plugin_shell_surface',
      {
        sourceKind: 'extv2',
        pluginId: 'demo-extension',
        surfaceId: 'demo-widget',
        surfaceType: 'desktop-widget',
        reason: 'runtime-unresponsive',
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
        reason: 'plugin-disabled',
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
