import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledHostExtensionRecord } from './extensions';
import { DefaultInstalledExtensionRuntimeManager } from './installedExtensionRuntimeManager';
import { EventBus } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { DEFAULT_TELEMETRY_POLICY, type TelemetryRecord } from '../../contracts/telemetry';
import {
  setGlobalTelemetryService,
  type TelemetryService,
  type TelemetrySnapshot,
} from '../../services/telemetry';

const {
  runResolvedInstalledExtensionCommandMock,
  startInstalledExtensionStartupRuntimeMock,
  startInstalledExtensionBackgroundRuntimeMock,
  recordInstalledExtensionCrashMock,
  loadInstalledExtensionsMock,
  subscribeInstalledExtensionsMock,
  readHostExtensionRuntimeRestartRequestMock,
  subscribeHostExtensionRuntimeRestartMock,
} = vi.hoisted(() => ({
  runResolvedInstalledExtensionCommandMock: vi.fn(),
  startInstalledExtensionStartupRuntimeMock: vi.fn(),
  startInstalledExtensionBackgroundRuntimeMock: vi.fn(),
  recordInstalledExtensionCrashMock: vi.fn(),
  loadInstalledExtensionsMock: vi.fn<[], InstalledHostExtensionRecord[]>(() => []),
  subscribeInstalledExtensionsMock: vi.fn<[() => void], () => void>(
    () => () => {}
  ),
  readHostExtensionRuntimeRestartRequestMock: vi.fn(),
  subscribeHostExtensionRuntimeRestartMock: vi.fn<[() => void], () => void>(
    () => () => {}
  ),
}));

vi.mock('./runtime/extensionCommandRuntime', () => ({
  runResolvedInstalledExtensionCommand: runResolvedInstalledExtensionCommandMock,
}));

vi.mock('./runtime/extensionStartupRuntime', () => ({
  startInstalledExtensionStartupRuntime: startInstalledExtensionStartupRuntimeMock,
  startInstalledExtensionBackgroundRuntime: startInstalledExtensionBackgroundRuntimeMock,
}));

vi.mock('./extensions', async () => {
  const actual = await vi.importActual<typeof import('./extensions')>('./extensions');
  return {
    ...actual,
    loadInstalledExtensions: loadInstalledExtensionsMock,
    subscribeInstalledExtensions: subscribeInstalledExtensionsMock,
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
    subscribeHostExtensionRuntimeRestart: subscribeHostExtensionRuntimeRestartMock,
  };
});

function createManagerHarness() {
  const events = new EventBus<AppEvents>();
  const manager = new DefaultInstalledExtensionRuntimeManager({
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
    events: events.withSource('installed-extension-runtime-manager-test'),
  });

  return { manager, events };
}

function createManager() {
  return createManagerHarness().manager;
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

function createStartupRecord(
  overrides: Partial<InstalledHostExtensionRecord> = {}
): InstalledHostExtensionRecord {
  return {
    installedAt: 1,
    enabled: true,
    manifest: {
      schemaVersion: '2.0',
      kind: 'extension',
      identity: {
        id: 'demo-startup-extension',
        publisher: 'pixel',
        version: '1.0.0',
        name: 'Demo Startup Extension',
      },
      hostTargets: [{ hostId: 'pmp' }],
      activationEvents: ['onStartup'],
      requiresCapabilities: [
        {
          capabilityId: 'core.capability-registry',
        },
      ],
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
        path: 'C:/plugins/demo-startup-extension/dist/index.js',
      },
    ],
    ...overrides,
  };
}

function createOptionalCapabilityStartupRecord(
  overrides: Partial<InstalledHostExtensionRecord> = {}
): InstalledHostExtensionRecord {
  const base = createStartupRecord();
  return {
    ...base,
    manifest: {
      ...base.manifest,
      requiresCapabilities: undefined,
      optionalCapabilities: [
        {
          capabilityId: 'host.pmp.audio-engine.analysis',
        },
      ],
    },
    ...overrides,
  };
}

function createCapabilityActivationRecord(
  overrides: Partial<InstalledHostExtensionRecord> = {}
): InstalledHostExtensionRecord {
  const base = createStartupRecord({
    manifest: {
      ...createStartupRecord().manifest,
      identity: {
        ...createStartupRecord().manifest.identity,
        id: 'demo-capability-extension',
        name: 'Demo Capability Extension',
      },
      activationEvents: ['onCapability:host.pmp.navigation'],
    },
    resolvedArtifacts: [
      {
        runtimeId: 'worker.main',
        path: 'C:/plugins/demo-capability-extension/dist/index.js',
      },
    ],
  });

  return {
    ...base,
    ...overrides,
  };
}

function createHostEventActivationRecord(
  overrides: Partial<InstalledHostExtensionRecord> = {}
): InstalledHostExtensionRecord {
  const base = createStartupRecord({
    manifest: {
      ...createStartupRecord().manifest,
      identity: {
        ...createStartupRecord().manifest.identity,
        id: 'demo-host-event-extension',
        name: 'Demo Host Event Extension',
      },
      activationEvents: ['onHost:navigation.changed'],
    },
    resolvedArtifacts: [
      {
        runtimeId: 'worker.main',
        path: 'C:/plugins/demo-host-event-extension/dist/index.js',
      },
    ],
  });

  return {
    ...base,
    ...overrides,
  };
}

function createFileActivationRecord(
  overrides: Partial<InstalledHostExtensionRecord> = {}
): InstalledHostExtensionRecord {
  const base = createStartupRecord({
    manifest: {
      ...createStartupRecord().manifest,
      identity: {
        ...createStartupRecord().manifest.identity,
        id: 'demo-file-extension',
        name: 'Demo File Extension',
      },
      activationEvents: ['onFile:json'],
    },
    resolvedArtifacts: [
      {
        runtimeId: 'worker.main',
        path: 'C:/plugins/demo-file-extension/dist/index.js',
      },
    ],
  });

  return {
    ...base,
    ...overrides,
  };
}

async function flushAsyncWork(iterations = 3): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('DefaultInstalledExtensionRuntimeManager', () => {
  beforeEach(() => {
    runResolvedInstalledExtensionCommandMock.mockReset();
    startInstalledExtensionStartupRuntimeMock.mockReset();
    startInstalledExtensionBackgroundRuntimeMock.mockReset();
    recordInstalledExtensionCrashMock.mockReset();
    loadInstalledExtensionsMock.mockReset();
    subscribeInstalledExtensionsMock.mockReset();
    readHostExtensionRuntimeRestartRequestMock.mockReset();
    subscribeHostExtensionRuntimeRestartMock.mockReset();
    readHostExtensionRuntimeRestartRequestMock.mockReturnValue(null);
    loadInstalledExtensionsMock.mockReturnValue([]);
    subscribeInstalledExtensionsMock.mockImplementation(() => () => {});
    subscribeHostExtensionRuntimeRestartMock.mockImplementation(() => () => {});
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

  it('restarts managed startup runtimes when optional capability grants change', async () => {
    let records = [createOptionalCapabilityStartupRecord()];
    let installedListener: (() => void) | null = null;
    const firstDispose = vi.fn().mockResolvedValue(undefined);
    const secondDispose = vi.fn().mockResolvedValue(undefined);

    loadInstalledExtensionsMock.mockImplementation(() => records);
    subscribeInstalledExtensionsMock.mockImplementation((listener: () => void) => {
      installedListener = listener;
      return () => {
        if (installedListener === listener) {
          installedListener = null;
        }
      };
    });
    startInstalledExtensionStartupRuntimeMock
      .mockResolvedValueOnce({
        runtimeInstanceId: 'startup-runtime-1',
        dispose: firstDispose,
      })
      .mockResolvedValueOnce({
        runtimeInstanceId: 'startup-runtime-2',
        dispose: secondDispose,
      });

    const manager = createManager();
    const restartListener = vi.fn();
    manager.subscribeRestart(restartListener);
    const notifyInstalledChange = () => {
      if (installedListener) {
        installedListener();
      }
    };

    manager.start();
    await flushAsyncWork();

    expect(startInstalledExtensionStartupRuntimeMock).toHaveBeenCalledTimes(1);
    expect(manager.getRestartToken('demo-startup-extension')).toBe(0);

    records = [
      createOptionalCapabilityStartupRecord({
        deniedCapabilities: ['host.pmp.audio-engine.analysis'],
      }),
    ];
    notifyInstalledChange();
    await flushAsyncWork();

    expect(firstDispose).toHaveBeenCalledWith('capabilities-updated');
    expect(startInstalledExtensionStartupRuntimeMock).toHaveBeenCalledTimes(2);
    expect(
      manager.getRestartToken('demo-startup-extension')
    ).toEqual(expect.any(Number));
    expect(manager.getRestartToken('demo-startup-extension')).toBeGreaterThan(0);
    expect(restartListener).toHaveBeenCalledTimes(1);

    manager.dispose();
    await flushAsyncWork();
    expect(secondDispose).toHaveBeenCalledWith('module-dispose');
  });

  it('stops managed startup runtimes and bumps lifecycle restart tokens when extensions are quarantined', async () => {
    let records = [createStartupRecord()];
    let installedListener: (() => void) | null = null;
    const firstDispose = vi.fn().mockResolvedValue(undefined);

    loadInstalledExtensionsMock.mockImplementation(() => records);
    subscribeInstalledExtensionsMock.mockImplementation((listener: () => void) => {
      installedListener = listener;
      return () => {
        if (installedListener === listener) {
          installedListener = null;
        }
      };
    });
    startInstalledExtensionStartupRuntimeMock.mockResolvedValue({
      runtimeInstanceId: 'startup-runtime-1',
      dispose: firstDispose,
    });

    const manager = createManager();
    const restartListener = vi.fn();
    manager.subscribeRestart(restartListener);
    const notifyInstalledChange = () => {
      if (installedListener) {
        installedListener();
      }
    };

    manager.start();
    await flushAsyncWork();

    records = [
      createStartupRecord({
        enabled: false,
        disabledReason: 'quarantine',
      }),
    ];
    notifyInstalledChange();
    await flushAsyncWork();

    expect(firstDispose).toHaveBeenCalledWith('extension-quarantined');
    expect(startInstalledExtensionStartupRuntimeMock).toHaveBeenCalledTimes(1);
    expect(
      manager.getRestartToken('demo-startup-extension')
    ).toEqual(expect.any(Number));
    expect(manager.getRestartToken('demo-startup-extension')).toBeGreaterThan(0);
    expect(restartListener).toHaveBeenCalledTimes(1);

    manager.dispose();
    await flushAsyncWork();
  });

  it('starts background runtimes for matching capability activations', async () => {
    const record = createCapabilityActivationRecord();
    loadInstalledExtensionsMock.mockReturnValue([record]);
    startInstalledExtensionBackgroundRuntimeMock.mockResolvedValue({
      runtimeInstanceId: 'capability-runtime-1',
      dispose: vi.fn().mockResolvedValue(undefined),
    });

    const manager = createManager();
    await manager.activateForCapability({
      capabilityId: 'host.pmp.navigation',
      method: 'navigateTo',
      requestKind: 'invoke',
      sourcePluginId: 'other-plugin',
      hostLabel: 'CapabilityActivationTest',
    });

    expect(startInstalledExtensionBackgroundRuntimeMock).toHaveBeenCalledTimes(1);
    expect(startInstalledExtensionBackgroundRuntimeMock.mock.calls[0]?.[0]).toMatchObject({
      record,
      hostLabel: 'CapabilityActivationTest',
      activation: {
        cause: 'capability',
        activationEvent: 'onCapability:host.pmp.navigation',
        surface: 'capability',
        payload: {
          capabilityId: 'host.pmp.navigation',
          method: 'navigateTo',
          requestKind: 'invoke',
          sourcePluginId: 'other-plugin',
        },
      },
    });
  });

  it('wires kernel host events onto the runtime manager activation path', async () => {
    const record = createHostEventActivationRecord();
    loadInstalledExtensionsMock.mockReturnValue([record]);
    startInstalledExtensionBackgroundRuntimeMock.mockResolvedValue({
      runtimeInstanceId: 'host-event-runtime-1',
      dispose: vi.fn().mockResolvedValue(undefined),
    });

    const { manager, events } = createManagerHarness();
    manager.start();
    events.emit('navigation/changed', {
      currentPage: { type: 'home' },
      history: [{ type: 'home' }],
      currentIndex: 0,
    });
    await flushAsyncWork();

    expect(startInstalledExtensionBackgroundRuntimeMock).toHaveBeenCalledTimes(1);
    expect(startInstalledExtensionBackgroundRuntimeMock.mock.calls[0]?.[0]).toMatchObject({
      record,
      hostLabel: 'ExtensionHostEventActivation',
      activation: {
        cause: 'host-event',
        activationEvent: 'onHost:navigation.changed',
        surface: 'host',
        payload: {
          hostEventId: 'navigation.changed',
          eventPayload: {
            currentPage: { type: 'home' },
            history: [{ type: 'home' }],
            currentIndex: 0,
          },
        },
      },
    });

    manager.dispose();
    await flushAsyncWork();
  });

  it('starts background runtimes for matching file activations', async () => {
    const record = createFileActivationRecord();
    loadInstalledExtensionsMock.mockReturnValue([record]);
    startInstalledExtensionBackgroundRuntimeMock.mockResolvedValue({
      runtimeInstanceId: 'file-runtime-1',
      dispose: vi.fn().mockResolvedValue(undefined),
    });

    const manager = createManager();
    await manager.activateForFile({
      fileType: 'JSON',
      filePath: 'C:/plugins/demo.json',
      action: 'selected',
      hostLabel: 'FileActivationTest',
    });

    expect(startInstalledExtensionBackgroundRuntimeMock).toHaveBeenCalledTimes(1);
    expect(startInstalledExtensionBackgroundRuntimeMock.mock.calls[0]?.[0]).toMatchObject({
      record,
      hostLabel: 'FileActivationTest',
      activation: {
        cause: 'file',
        activationEvent: 'onFile:json',
        surface: 'file',
        payload: {
          fileType: 'json',
          filePath: 'C:/plugins/demo.json',
          action: 'selected',
        },
      },
    });
  });
});
