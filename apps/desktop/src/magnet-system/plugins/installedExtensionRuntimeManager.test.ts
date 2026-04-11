import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledHostExtensionRecord } from './extensions';
import { DefaultInstalledExtensionRuntimeManager } from './installedExtensionRuntimeManager';
import { DEFAULT_TELEMETRY_POLICY, type TelemetryRecord } from '../../contracts/telemetry';
import {
  setGlobalTelemetryService,
  type TelemetryService,
  type TelemetrySnapshot,
} from '../../services/telemetry';

const {
  runResolvedInstalledExtensionCommandMock,
  recordInstalledExtensionCrashMock,
  readHostExtensionRuntimeRestartRequestMock,
} = vi.hoisted(() => ({
  runResolvedInstalledExtensionCommandMock: vi.fn(),
  recordInstalledExtensionCrashMock: vi.fn(),
  readHostExtensionRuntimeRestartRequestMock: vi.fn(),
}));

vi.mock('./runtime/extensionCommandRuntime', () => ({
  runResolvedInstalledExtensionCommand: runResolvedInstalledExtensionCommandMock,
}));

vi.mock('./runtime/extensionStartupRuntime', () => ({
  startInstalledExtensionStartupRuntime: vi.fn(),
}));

vi.mock('./extensions', async () => {
  const actual = await vi.importActual<typeof import('./extensions')>('./extensions');
  return {
    ...actual,
    loadInstalledExtensions: vi.fn(() => []),
    subscribeInstalledExtensions: vi.fn(() => () => {}),
    recordInstalledExtensionCrash: recordInstalledExtensionCrashMock,
  };
});

vi.mock('./hostExtensionRuntimeSupervisor', async () => {
  const actual =
    await vi.importActual<typeof import('./hostExtensionRuntimeSupervisor')>(
      './hostExtensionRuntimeSupervisor'
    );
  return {
    ...actual,
    readHostExtensionRuntimeRestartRequest: readHostExtensionRuntimeRestartRequestMock,
    subscribeHostExtensionRuntimeRestart: vi.fn(() => () => {}),
  };
});

function createManager() {
  return new DefaultInstalledExtensionRuntimeManager({
    audioEngine: {
      getSnapshot: () => ({
        audioService: {
          getState: () => ({ playbackState: 'paused' }),
        },
      }),
    } as never,
    commands: null,
    navigation: {
      navigateTo: vi.fn(),
      goBack: vi.fn(),
      getSnapshot: vi.fn(() => ({ currentIndex: 0 })),
    } as never,
    keybindings: null,
  });
}

type TelemetryCall = {
  moduleId: string;
  component: string | null | undefined;
  level: string;
  event: string;
  message?: string | null;
  fields?: Record<string, unknown>;
};

function createTelemetryServiceSpy(): {
  calls: TelemetryCall[];
  service: TelemetryService;
} {
  const calls: TelemetryCall[] = [];
  const snapshot: TelemetrySnapshot = {
    policy: { ...DEFAULT_TELEMETRY_POLICY },
    status: {
      enabled: true,
      currentSessionId: 'session-1',
      queuedRecords: 0,
      flushedRecords: 0,
      droppedRecords: 0,
      currentFileBytes: 0,
      currentFilePath: null,
      frontendMinLevel: 'info',
      backendMinLevel: 'info',
      persistMinLevel: 'warn',
      lastError: null,
    },
    tail: [] as TelemetryRecord[],
    bufferedRecords: 0,
    queueDroppedRecords: 0,
    tailDroppedRecords: 0,
    transportAvailable: true,
    bootstrapState: 'ready',
    lastFlushAtMs: null,
    lastBootstrapAtMs: null,
  };

  const service: TelemetryService = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    refreshRuntime: async () => snapshot,
    clearSession: async () => {},
    flushNow: async () => {},
    getLogger: (moduleId, component) => ({
      log: (level, event, options) => {
        calls.push({
          moduleId,
          component,
          level,
          event,
          message: options?.message ?? null,
          fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined,
        });
      },
      trace: (event, options) =>
        calls.push({ moduleId, component, level: 'trace', event, message: options?.message ?? null, fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined }),
      debug: (event, options) =>
        calls.push({ moduleId, component, level: 'debug', event, message: options?.message ?? null, fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined }),
      info: (event, options) =>
        calls.push({ moduleId, component, level: 'info', event, message: options?.message ?? null, fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined }),
      warn: (event, options) =>
        calls.push({ moduleId, component, level: 'warn', event, message: options?.message ?? null, fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined }),
      error: (event, options) =>
        calls.push({ moduleId, component, level: 'error', event, message: options?.message ?? null, fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined }),
      fatal: (event, options) =>
        calls.push({ moduleId, component, level: 'fatal', event, message: options?.message ?? null, fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined }),
      metric: (event, fields, options) =>
        calls.push({ moduleId, component, level: options?.level ?? 'info', event, message: options?.message ?? null, fields: fields as Record<string, unknown> }),
      startSpan: () => ({
        end: () => {},
      }),
    }),
    ingest: () => {},
    destroy: () => {},
  };

  return { calls, service };
}

function createCommandRecord(): InstalledHostExtensionRecord {
  return {
    installedAt: 1,
    enabled: true,
    manifest: {
      schemaVersion: '2.0',
      kind: 'extension',
      identity: {
        id: 'demo-command-extension',
        publisher: 'pixel',
        version: '1.0.0',
        name: 'Demo Command Extension',
      },
      hostTargets: [{ hostId: 'pmp' }],
      activationEvents: ['onCommand:demo-command'],
      runtimes: [
        {
          runtimeId: 'worker.main',
          kind: 'extension-host',
          entry: 'dist/index.js',
          priority: 10,
        },
      ],
    },
    resolvedArtifacts: [
      {
        runtimeId: 'worker.main',
        path: 'C:/plugins/demo-command-extension/dist/index.js',
      },
    ],
  };
}

function createViewRecord(): InstalledHostExtensionRecord {
  return {
    installedAt: 1,
    enabled: true,
    manifest: {
      schemaVersion: '2.0',
      kind: 'extension',
      identity: {
        id: 'demo-view-extension',
        publisher: 'pixel',
        version: '1.0.0',
        name: 'Demo View Extension',
      },
      hostTargets: [{ hostId: 'pmp' }],
      activationEvents: ['onView:demo-page'],
      runtimes: [
        {
          runtimeId: 'webview.main',
          kind: 'webview',
          entry: 'dist/view.html',
          priority: 10,
        },
      ],
    },
    resolvedArtifacts: [
      {
        runtimeId: 'webview.main',
        path: 'C:/plugins/demo-view-extension/dist/view.html',
      },
    ],
  };
}

describe('DefaultInstalledExtensionRuntimeManager', () => {
  beforeEach(() => {
    runResolvedInstalledExtensionCommandMock.mockReset();
    recordInstalledExtensionCrashMock.mockReset();
    readHostExtensionRuntimeRestartRequestMock.mockReset();
  });

  afterEach(() => {
    setGlobalTelemetryService(null);
  });

  it('routes command activation through the unified runtime manager', async () => {
    const telemetry = createTelemetryServiceSpy();
    setGlobalTelemetryService(telemetry.service);

    const manager = createManager();
    const record = createCommandRecord();

    await manager.runCommand({
      record,
      commandId: 'demo-command',
      args: { count: 1 },
    });

    expect(runResolvedInstalledExtensionCommandMock).toHaveBeenCalledTimes(1);
    expect(runResolvedInstalledExtensionCommandMock.mock.calls[0]?.[0]).toMatchObject({
      record,
      commandId: 'demo-command',
      args: { count: 1 },
      hostLabel: 'ExtensionCommand',
    });
    expect(runResolvedInstalledExtensionCommandMock.mock.calls[0]?.[0]?.resolution).toMatchObject({
      status: 'resolved',
      launcher: { id: 'pxp.extension-host.worker' },
    });
    expect(telemetry.calls.filter((entry) => entry.event === 'plugin.runtime.resolve.start')).toHaveLength(1);
    expect(telemetry.calls.filter((entry) => entry.event === 'plugin.runtime.resolve.completed')).toHaveLength(1);
    expect(telemetry.calls.at(-1)).toMatchObject({
      level: 'info',
      event: 'plugin.runtime.resolve.completed',
      fields: expect.objectContaining({
        pluginId: 'demo-command-extension',
        sourceKind: 'extv2',
        surfaceKind: 'command',
        surfaceId: 'demo-command',
        launcherId: 'pxp.extension-host.worker',
        resolutionStatus: 'resolved',
        preferCommandWorker: true,
      }),
    });
    expect(recordInstalledExtensionCrashMock).not.toHaveBeenCalled();
  });

  it('records crashes when a managed command runtime fails', async () => {
    const manager = createManager();
    const record = createCommandRecord();
    const error = new Error('runtime failed');
    runResolvedInstalledExtensionCommandMock.mockRejectedValueOnce(error);

    await expect(
      manager.runCommand({
        record,
        commandId: 'demo-command',
      })
    ).rejects.toThrow('runtime failed');

    expect(recordInstalledExtensionCrashMock).toHaveBeenCalledWith(
      'demo-command-extension',
      error
    );
  });

  it('resolves view surfaces onto the native host-frame launcher', () => {
    const manager = createManager();
    const record = createViewRecord();

    const resolution = manager.resolveRuntime(record, {
      surfaceKind: 'page',
    });

    expect(resolution).toMatchObject({
      status: 'resolved',
      launcher: { id: 'pxp.webview.host-frame' },
    });
  });

  it('reads restart tokens from the shared extv2 restart request store', () => {
    const manager = createManager();
    readHostExtensionRuntimeRestartRequestMock.mockReturnValue({
      kind: 'extv2',
      pluginId: 'demo-command-extension',
      at: 1234,
    });

    expect(manager.getRestartToken('demo-command-extension')).toBe(1234);
    expect(manager.getRestartToken('other-extension')).toBe(0);
  });
});
