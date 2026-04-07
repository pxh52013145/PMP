import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent, RuntimeHello } from '@pixel-matrix/plugin-platform-contracts';
import type { PluginMountApi } from '../pluginHostApi';
import { runResolvedInstalledExtensionCommand } from './extensionCommandRuntime';
import type { ResolvedPluginRuntime } from './types';
import * as pluginConfigModule from '../pluginConfig';
import * as pluginHostApiModule from '../pluginHostApi';
import * as extensionsModule from '../extensions';
import * as extensionsGovernanceModule from '../extensionsGovernance';

class ScriptedWorker {
  private readonly listeners = {
    message: new Set<(event: { data?: unknown }) => void>(),
    error: new Set<(event: { message?: string; error?: unknown }) => void>(),
  };

  constructor(
    runtimeHello: RuntimeHello,
    private readonly onPostMessage: (message: unknown, worker: ScriptedWorker) => void
  ) {
    queueMicrotask(() => {
      this.emitMessage(runtimeHello);
    });
  }

  postMessage(message: unknown): void {
    this.onPostMessage(message, this);
  }

  terminate(): void {}

  addEventListener(
    type: 'message' | 'error',
    listener: (event: { data?: unknown; message?: string; error?: unknown }) => void
  ): void {
    this.listeners[type].add(listener);
  }

  removeEventListener(
    type: 'message' | 'error',
    listener: (event: { data?: unknown; message?: string; error?: unknown }) => void
  ): void {
    this.listeners[type].delete(listener);
  }

  emitMessage(data: unknown): void {
    for (const listener of Array.from(this.listeners.message)) {
      listener({ data });
    }
  }
}

function createRuntimeEvent(
  runtimeHello: RuntimeHello,
  eventName: string,
  payload?: unknown,
  overrides: Partial<RuntimeEvent> = {}
): RuntimeEvent {
  return {
    bridgeVersion: runtimeHello.bridgeVersion,
    op: 'runtime.event',
    pluginId: runtimeHello.pluginId,
    runtimeId: runtimeHello.runtimeId,
    runtimeInstanceId: runtimeHello.runtimeInstanceId,
    eventName,
    payload,
    ...overrides,
  };
}

function createStubApi(configState: Record<string, unknown>): PluginMountApi {
  return {
    host: {
      getInfo: vi.fn(() => null),
      listPermissions: vi.fn(() => []),
      hasPermission: vi.fn(() => false),
      listCapabilities: vi.fn(async () => [
        { id: 'host.pmp.storage.config', version: '1.0.0' },
      ]),
      invokeCapability: vi.fn(async () => ({ ok: true })),
      openStream: vi.fn(async () => null),
      openSession: vi.fn(async () => null),
      closeSession: vi.fn(async () => undefined),
    },
    audio: {
      getState: vi.fn(() => ({ playbackState: 'paused' })),
      onStateChange: vi.fn(() => () => {}),
      onTimeUpdate: vi.fn(() => () => {}),
      onEnded: vi.fn(() => () => {}),
      onLoadProgress: vi.fn(() => () => {}),
      onError: vi.fn(() => () => {}),
      getCover: vi.fn(async () => null),
      play: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined),
      stop: vi.fn(() => undefined),
      seek: vi.fn(() => undefined),
      setVolume: vi.fn(() => undefined),
      toggleMute: vi.fn(() => undefined),
      playNext: vi.fn(async () => undefined),
      playPrevious: vi.fn(async () => undefined),
      playTrackAtIndex: vi.fn(async () => undefined),
      getPlayMode: vi.fn(() => 'sequence'),
      setPlayMode: vi.fn(() => undefined),
    },
    visualizer: {
      getSpectrum: vi.fn(() => null),
      getSpectrumFrame: vi.fn(() => null),
      onSpectrum: vi.fn(() => () => {}),
      onSpectrumFrame: vi.fn(() => () => {}),
    },
    navigation: {
      navigateTo: vi.fn(() => undefined),
      goBack: vi.fn(() => undefined),
      getSnapshot: vi.fn(() => ({ currentIndex: 1 })),
      onChange: vi.fn(() => () => {}),
    },
    config: {
      get: vi.fn(() => ({ ...configState })),
      onChange: vi.fn(() => () => {}),
      set: vi.fn((next: Record<string, unknown>) => {
        Object.keys(configState).forEach((key) => delete configState[key]);
        Object.assign(configState, next);
      }),
      patch: vi.fn((next: Record<string, unknown>) => {
        Object.assign(configState, next);
      }),
      reset: vi.fn(() => {
        Object.keys(configState).forEach((key) => delete configState[key]);
      }),
    },
    window: {
      open: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    },
  } as unknown as PluginMountApi;
}

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('installed extension command runtime', () => {
  it('runs extension-host commands through the dedicated worker bridge using entry URLs', async () => {
    const configState: Record<string, unknown> = { count: 0 };
    const api = createStubApi(configState);
    const record: extensionsModule.InstalledHostExtensionRecord = {
      manifest: {
        schemaVersion: '2.0',
        kind: 'extension',
        identity: {
          id: 'native-worker-demo',
          publisher: 'pixel-matrix.dev',
          version: '0.1.0',
          name: 'native-worker-demo',
        },
        hostTargets: [{ hostId: 'pmp', required: true }],
        runtimes: [
          {
            runtimeId: 'worker.main',
            kind: 'extension-host',
            entry: 'dist/index.js',
            bridge: 'pxp.runtime.bridge.v1',
            dataPlane: { kinds: ['inline-json'] },
          },
        ],
        requiresCapabilities: [{ capabilityId: 'host.pmp.storage.config' }],
      },
      installedAt: 1_710_000_000_000,
      enabled: true,
      resolvedArtifacts: [
        {
          runtimeId: 'worker.main',
          path: 'C:/Users/test/AppData/Roaming/PMP/pmp-durable/extensions-v2/native-worker-demo/current/dist/index.js',
        },
      ],
    };
    const artifact = record.resolvedArtifacts?.[0];
    expect(artifact).toBeTruthy();

    const resolution: ResolvedPluginRuntime = {
      status: 'resolved',
      pluginId: 'native-worker-demo',
      manifest: record.manifest,
      installedRecord: record,
      hostId: 'pmp',
      compatLayerIds: [],
      issues: [],
      runtime: record.manifest.runtimes[0],
      launcher: {
        id: 'pxp.extension-host.worker',
        runtimeKinds: ['extension-host'],
        surfaceKinds: ['command'],
        availability: 'available',
        transport: 'worker',
        description: 'Dedicated worker launcher for command-oriented extension-host runtimes',
      },
      artifact: artifact!,
      source: 'manifest-runtime',
    };

    vi.spyOn(pluginHostApiModule, 'createPluginMountApi').mockReturnValue(api);
    vi.spyOn(pluginConfigModule, 'readPmpmPluginConfig').mockReturnValue({ ...configState });
    vi.spyOn(pluginConfigModule, 'subscribePmpmPluginConfig').mockReturnValue(() => {});
    const crashSpy = vi
      .spyOn(extensionsModule, 'recordInstalledExtensionCrash')
      .mockImplementation(() => {});

    const createEntryUrl = vi.fn(
      async (entryPath: string) => `asset://localhost/${entryPath.replace(/:/g, '%3A')}`
    );

    let activatePayload: Record<string, unknown> | null = null;

    const runtimePromise = runResolvedInstalledExtensionCommand(
      {
        record,
        resolution,
        commandId: 'increment',
        audioService: api.audio as never,
        navigation: api.navigation as never,
      },
      {
        createEntryUrl,
        createObjectUrl: () => 'blob:test-installed-extension-worker',
        revokeObjectUrl: () => {},
        createWorker: (_scriptUrl, _options, runtimeHello) =>
          new ScriptedWorker(runtimeHello, (message, worker) => {
            const envelope = message as Record<string, unknown>;

            if (envelope.op === 'runtime.init') {
              worker.emitMessage({
                bridgeVersion: runtimeHello.bridgeVersion,
                op: 'runtime.init.ack',
                pluginId: runtimeHello.pluginId,
                runtimeId: runtimeHello.runtimeId,
                runtimeInstanceId: runtimeHello.runtimeInstanceId,
              });
              return;
            }

            if (envelope.op === 'runtime.activate') {
              activatePayload = (envelope.payload as Record<string, unknown>) ?? null;
              worker.emitMessage({
                bridgeVersion: runtimeHello.bridgeVersion,
                op: 'runtime.activate.ack',
                pluginId: runtimeHello.pluginId,
                runtimeId: runtimeHello.runtimeId,
                runtimeInstanceId: runtimeHello.runtimeInstanceId,
              });
              queueMicrotask(() => {
                worker.emitMessage({
                  protocolVersion: '1.0',
                  op: 'capability.invoke.request',
                  requestId: 'cfg-patch-1',
                  capabilityId: 'host.pmp.storage.config',
                  method: 'patch',
                  payload: {
                    value: {
                      count: 1,
                      lastCommand: 'increment',
                    },
                  },
                });
                queueMicrotask(() => {
                  worker.emitMessage(
                    createRuntimeEvent(runtimeHello, 'permission.denied', {
                      capability: 'storage:local',
                      action: 'config.patch(next)',
                    })
                  );
                  queueMicrotask(() => {
                  worker.emitMessage(
                    createRuntimeEvent(runtimeHello, 'command.result', { ok: true })
                  );
                  });
                });
              });
            }
          }),
      }
    );

    await runtimePromise;
    await flushAsyncWork();

    expect(createEntryUrl).toHaveBeenCalledWith(
      'C:/Users/test/AppData/Roaming/PMP/pmp-durable/extensions-v2/native-worker-demo/current/dist/index.js'
    );
    expect(activatePayload).toMatchObject({
      commandId: 'increment',
      entryUrl:
        'asset://localhost/C%3A/Users/test/AppData/Roaming/PMP/pmp-durable/extensions-v2/native-worker-demo/current/dist/index.js',
      permissions: ['storage:local'],
      initialConfig: { count: 0 },
    });
    expect(configState).toEqual({
      count: 1,
      lastCommand: 'increment',
    });
    expect(crashSpy).not.toHaveBeenCalled();
    expect(
      extensionsGovernanceModule.readInstalledExtensionAuditLog().map((event) => event.type)
    ).toContain('permission-denied');
  });
});
