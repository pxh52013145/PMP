import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent, RuntimeHello } from '@pixel-matrix/plugin-platform-contracts';
import type { PluginMountApi } from '../pluginHostApi';
import { runResolvedInstalledExtensionCommand } from './extensionCommandRuntime';
import type { ResolvedPluginRuntime } from './types';
import * as pluginConfigModule from '../pluginConfig';
import * as pluginHostApiModule from '../pluginHostApi';
import * as extensionsModule from '../extensions';
import * as extensionsGovernanceModule from '../extensionsGovernance';
import type { RuntimeBridgeTransportMessage } from './runtimeBridgeHostSession';

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
  runtimeContext: Pick<
    RuntimeEvent,
    'bridgeVersion' | 'pluginId' | 'runtimeId' | 'runtimeInstanceId'
  >,
  eventName: string,
  payload?: unknown,
  overrides: Partial<RuntimeEvent> = {}
): RuntimeEvent {
  return {
    bridgeVersion: runtimeContext.bridgeVersion,
    op: 'runtime.event',
    pluginId: runtimeContext.pluginId,
    runtimeId: runtimeContext.runtimeId,
    runtimeInstanceId: runtimeContext.runtimeInstanceId,
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

function createSidecarControllerHarness() {
  const listeners = new Set<(message: RuntimeBridgeTransportMessage) => void>();
  const sent: unknown[] = [];
  const dispose = vi.fn(async () => undefined);

  return {
    controller: {
      port: {
        postMessage: (message: RuntimeBridgeTransportMessage) => {
          sent.push(message);
        },
        onMessage: (listener: (message: RuntimeBridgeTransportMessage) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      dispose,
    },
    sent,
    emitRuntimeHello: (runtimeInstanceId: string) => {
      for (const listener of Array.from(listeners)) {
        listener({
          bridgeVersion: '1.0',
          op: 'runtime.hello',
          pluginId: 'native-sidecar-demo',
          runtimeId: 'sidecar.main',
          runtimeInstanceId,
          supportedBridgeVersions: ['1.0'],
          runtimeKind: 'sidecar',
          carrier: 'native-process',
          supportsViewMount: false,
          supportedDataPlanes: ['inline-json', 'pipe'],
        });
      }
    },
    emit: (message: RuntimeBridgeTransportMessage) => {
      for (const listener of Array.from(listeners)) {
        listener(message);
      }
    },
    dispose,
  };
}

afterEach(() => {
  vi.useRealTimers();
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
    vi.spyOn(pluginConfigModule, 'readExtensionConfig').mockReturnValue({ ...configState });
    vi.spyOn(pluginConfigModule, 'subscribeExtensionConfig').mockReturnValue(() => {});
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

  it('runs sidecar-backed manifest-v2 commands through the native-process bridge controller', async () => {
    const configState: Record<string, unknown> = { count: 0 };
    const api = createStubApi(configState);
    const harness = createSidecarControllerHarness();
    const record: extensionsModule.InstalledHostExtensionRecord = {
      manifest: {
        schemaVersion: '2.0',
        kind: 'extension',
        identity: {
          id: 'native-sidecar-demo',
          publisher: 'pixel-matrix.dev',
          version: '0.1.0',
          name: 'native-sidecar-demo',
        },
        hostTargets: [{ hostId: 'pmp', required: true }],
        runtimes: [
          {
            runtimeId: 'sidecar.main',
            kind: 'sidecar',
            entry: 'bin/demo-sidecar.js',
            bridge: 'pxp.runtime.bridge.v1',
            dataPlane: { kinds: ['pipe'] },
          },
        ],
        requiresCapabilities: [{ capabilityId: 'host.pmp.storage.config' }],
      },
      installedAt: 1_710_000_000_000,
      enabled: true,
      resolvedArtifacts: [
        {
          runtimeId: 'sidecar.main',
          path: 'C:/Users/test/AppData/Roaming/PMP/pmp-durable/extensions-v2/native-sidecar-demo/current/bin/demo-sidecar.js',
        },
      ],
    };
    const artifact = record.resolvedArtifacts?.[0];
    expect(artifact).toBeTruthy();

    const resolution: ResolvedPluginRuntime = {
      status: 'resolved',
      pluginId: 'native-sidecar-demo',
      manifest: record.manifest,
      installedRecord: record,
      hostId: 'pmp',
      issues: [],
      runtime: record.manifest.runtimes[0],
      launcher: {
        id: 'pxp.sidecar.native-process',
        runtimeKinds: ['sidecar'],
        surfaceKinds: ['command'],
        availability: 'available',
        transport: 'sidecar-process',
        description: 'Native sidecar launcher for command-oriented sidecar runtimes',
      },
      artifact: artifact!,
      source: 'manifest-runtime',
    };

    vi.spyOn(pluginHostApiModule, 'createPluginMountApi').mockReturnValue(api);
    vi.spyOn(pluginConfigModule, 'readExtensionConfig').mockReturnValue({ ...configState });
    vi.spyOn(pluginConfigModule, 'subscribeExtensionConfig').mockReturnValue(() => {});
    const crashSpy = vi
      .spyOn(extensionsModule, 'recordInstalledExtensionCrash')
      .mockImplementation(() => {});

    let runtimeInstanceId = '';

    const runtimePromise = runResolvedInstalledExtensionCommand(
      {
        record,
        resolution,
        commandId: 'increment',
        audioService: api.audio as never,
        navigation: api.navigation as never,
      },
      {
        now: () => 4321,
        createPortController: (options) => {
          runtimeInstanceId = options.runtimeInstanceId;
          expect(options.entryPath).toBe(
            'C:/Users/test/AppData/Roaming/PMP/pmp-durable/extensions-v2/native-sidecar-demo/current/bin/demo-sidecar.js'
          );
          return harness.controller;
        },
      }
    );

    await flushAsyncWork();
    harness.emitRuntimeHello(runtimeInstanceId);
    await flushAsyncWork();

    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.init.ack',
      pluginId: 'native-sidecar-demo',
      runtimeId: 'sidecar.main',
      runtimeInstanceId,
    });
    await flushAsyncWork();

    const runtimeActivate = harness.sent.find(
      (message) => (message as Record<string, unknown>).op === 'runtime.activate'
    ) as Record<string, unknown> | undefined;
    expect(runtimeActivate?.payload).toMatchObject({
      commandId: 'increment',
      entryPath:
        'C:/Users/test/AppData/Roaming/PMP/pmp-durable/extensions-v2/native-sidecar-demo/current/bin/demo-sidecar.js',
      permissions: ['storage:local'],
      initialConfig: { count: 0 },
    });

    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.activate.ack',
      pluginId: 'native-sidecar-demo',
      runtimeId: 'sidecar.main',
      runtimeInstanceId,
    });
    await flushAsyncWork();

    harness.emit({
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
    await flushAsyncWork();

    harness.emit(
      createRuntimeEvent(
        {
          bridgeVersion: '1.0',
          pluginId: 'native-sidecar-demo',
          runtimeId: 'sidecar.main',
          runtimeInstanceId,
        },
        'command.result',
        { ok: true }
      )
    );

    await expect(runtimePromise).resolves.toBeUndefined();
    expect(configState).toEqual({
      count: 1,
      lastCommand: 'increment',
    });
    expect(harness.dispose).toHaveBeenCalledWith('runtime-command-finished');
    expect(crashSpy).not.toHaveBeenCalled();
  });

  it('preserves runtime-unresponsive teardown for sidecar-backed manifest-v2 activate hangs', async () => {
    vi.useFakeTimers();

    const api = createStubApi({ count: 0 });
    const harness = createSidecarControllerHarness();
    const record: extensionsModule.InstalledHostExtensionRecord = {
      manifest: {
        schemaVersion: '2.0',
        kind: 'extension',
        identity: {
          id: 'native-sidecar-demo',
          publisher: 'pixel-matrix.dev',
          version: '0.1.0',
          name: 'native-sidecar-demo',
        },
        hostTargets: [{ hostId: 'pmp', required: true }],
        runtimes: [
          {
            runtimeId: 'sidecar.main',
            kind: 'sidecar',
            entry: 'bin/demo-sidecar.js',
            bridge: 'pxp.runtime.bridge.v1',
            dataPlane: { kinds: ['pipe'] },
          },
        ],
        requiresCapabilities: [{ capabilityId: 'host.pmp.storage.config' }],
      },
      installedAt: 1_710_000_000_000,
      enabled: true,
      resolvedArtifacts: [
        {
          runtimeId: 'sidecar.main',
          path: 'C:/Users/test/AppData/Roaming/PMP/pmp-durable/extensions-v2/native-sidecar-demo/current/bin/demo-sidecar.js',
        },
      ],
    };
    const artifact = record.resolvedArtifacts?.[0];
    expect(artifact).toBeTruthy();

    const resolution: ResolvedPluginRuntime = {
      status: 'resolved',
      pluginId: 'native-sidecar-demo',
      manifest: record.manifest,
      installedRecord: record,
      hostId: 'pmp',
      issues: [],
      runtime: record.manifest.runtimes[0],
      launcher: {
        id: 'pxp.sidecar.native-process',
        runtimeKinds: ['sidecar'],
        surfaceKinds: ['command'],
        availability: 'available',
        transport: 'sidecar-process',
        description: 'Native sidecar launcher for command-oriented sidecar runtimes',
      },
      artifact: artifact!,
      source: 'manifest-runtime',
    };

    vi.spyOn(pluginHostApiModule, 'createPluginMountApi').mockReturnValue(api);
    vi.spyOn(pluginConfigModule, 'readExtensionConfig').mockReturnValue({ count: 0 });
    vi.spyOn(pluginConfigModule, 'subscribeExtensionConfig').mockReturnValue(() => {});
    extensionsModule.upsertInstalledExtensionRecord(record);
    const crashSpy = vi
      .spyOn(extensionsModule, 'recordInstalledExtensionCrash')
      .mockImplementation(() => {});

    let runtimeInstanceId = '';

    const runtimePromise = runResolvedInstalledExtensionCommand(
      {
        record,
        resolution,
        commandId: 'hang-on-activate',
        audioService: api.audio as never,
        navigation: api.navigation as never,
        timeoutMs: 25,
      },
      {
        now: () => 4321,
        createPortController: (options) => {
          runtimeInstanceId = options.runtimeInstanceId;
          return harness.controller;
        },
      }
    );
    const runtimeExpectation = expect(runtimePromise).rejects.toThrow(
      'Installed extension command timeout (25ms)'
    );

    await vi.advanceTimersByTimeAsync(0);
    harness.emitRuntimeHello(runtimeInstanceId);
    await vi.advanceTimersByTimeAsync(0);

    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.init.ack',
      pluginId: 'native-sidecar-demo',
      runtimeId: 'sidecar.main',
      runtimeInstanceId,
    });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(25);

    await runtimeExpectation;
    expect(harness.dispose).toHaveBeenCalledWith('runtime-unresponsive');
    expect(crashSpy).not.toHaveBeenCalled();
    expect(
      extensionsGovernanceModule.readInstalledExtensionAuditLog().map((event) => event.type)
    ).toEqual(['runtime-unresponsive', 'quarantined']);
    expect(extensionsModule.getInstalledExtensionRecord('native-sidecar-demo')).toMatchObject({
      enabled: false,
      disabledReason: 'quarantine',
    });
  });

  it('blocks sidecar-backed manifest-v2 launch when the persisted artifact digest mismatches', async () => {
    const api = createStubApi({ count: 0 });
    const record: extensionsModule.InstalledHostExtensionRecord = {
      manifest: {
        schemaVersion: '2.0',
        kind: 'extension',
        identity: {
          id: 'native-sidecar-demo',
          publisher: 'pixel-matrix.dev',
          version: '0.1.0',
          name: 'native-sidecar-demo',
        },
        hostTargets: [{ hostId: 'pmp', required: true }],
        runtimes: [
          {
            runtimeId: 'sidecar.main',
            kind: 'sidecar',
            entry: 'bin/demo-sidecar.js',
            bridge: 'pxp.runtime.bridge.v1',
            dataPlane: { kinds: ['pipe'] },
          },
        ],
        requiresCapabilities: [{ capabilityId: 'host.pmp.storage.config' }],
      },
      installedAt: 1_710_000_000_000,
      enabled: true,
      resolvedArtifacts: [
        {
          runtimeId: 'sidecar.main',
          path: 'C:/Users/test/AppData/Roaming/PMP/pmp-durable/extensions-v2/native-sidecar-demo/current/bin/demo-sidecar.js',
          sha256: 'f'.repeat(64),
        },
      ],
    };
    const artifact = record.resolvedArtifacts?.[0];
    expect(artifact).toBeTruthy();

    const resolution: ResolvedPluginRuntime = {
      status: 'resolved',
      pluginId: 'native-sidecar-demo',
      manifest: record.manifest,
      installedRecord: record,
      hostId: 'pmp',
      issues: [],
      runtime: record.manifest.runtimes[0],
      launcher: {
        id: 'pxp.sidecar.native-process',
        runtimeKinds: ['sidecar'],
        surfaceKinds: ['command'],
        availability: 'available',
        transport: 'sidecar-process',
        description: 'Native sidecar launcher for command-oriented sidecar runtimes',
      },
      artifact: artifact!,
      source: 'manifest-runtime',
    };

    vi.spyOn(pluginHostApiModule, 'createPluginMountApi').mockReturnValue(api);
    vi.spyOn(pluginConfigModule, 'readExtensionConfig').mockReturnValue({ count: 0 });
    vi.spyOn(pluginConfigModule, 'subscribeExtensionConfig').mockReturnValue(() => {});
    extensionsModule.upsertInstalledExtensionRecord(record);

    const createPortController = vi.fn();

    await expect(
      runResolvedInstalledExtensionCommand(
        {
          record,
          resolution,
          commandId: 'blocked-digest-mismatch',
          audioService: api.audio as never,
          navigation: api.navigation as never,
          timeoutMs: 2_000,
        },
        {
          createPortController,
          readArtifactBytes: async () => new Uint8Array([1, 2, 3]),
          now: () => 4321,
        }
      )
    ).rejects.toThrow(
      'Runtime artifact integrity check failed (sha256 mismatch): C:/Users/test/AppData/Roaming/PMP/pmp-durable/extensions-v2/native-sidecar-demo/current/bin/demo-sidecar.js'
    );

    expect(createPortController).not.toHaveBeenCalled();
    expect(extensionsModule.getInstalledExtensionRecord('native-sidecar-demo')).toMatchObject({
      enabled: false,
      disabledReason: 'policy',
    });
    expect(extensionsGovernanceModule.readInstalledExtensionAuditLog().at(-1)).toMatchObject({
      type: 'disabled',
      pluginId: 'native-sidecar-demo',
      reason:
        'Runtime artifact integrity check failed (sha256 mismatch): C:/Users/test/AppData/Roaming/PMP/pmp-durable/extensions-v2/native-sidecar-demo/current/bin/demo-sidecar.js',
    });
  });
});
