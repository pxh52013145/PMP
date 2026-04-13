import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeHello } from '@pixel-matrix/plugin-platform-contracts';
import type { PluginMountApi } from '../pluginHostApi';
import {
  startInstalledExtensionBackgroundRuntime,
  startInstalledExtensionStartupRuntime,
} from './extensionStartupRuntime';
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

function createStubApi(configState: Record<string, unknown>): PluginMountApi {
  return {
    host: {
      getInfo: vi.fn(() => null),
      listPermissions: vi.fn(() => []),
      hasPermission: vi.fn(() => false),
      listCapabilities: vi.fn(async () => [
        { id: 'core.capability-registry', version: '1.0.0' },
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
      getSnapshot: vi.fn(() => ({ currentIndex: 0 })),
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

describe('installed extension startup runtime', () => {
  it('starts a long-lived worker session for onStartup activation and keeps capability/config bridging alive', async () => {
    const configState: Record<string, unknown> = { startupCount: 0 };
    const api = createStubApi(configState);
    const record: extensionsModule.InstalledHostExtensionRecord = {
      manifest: {
        schemaVersion: '2.0',
        kind: 'extension',
        identity: {
          id: 'startup-worker-demo',
          publisher: 'pixel-matrix.dev',
          version: '0.1.0',
          name: 'startup-worker-demo',
        },
        hostTargets: [{ hostId: 'pmp', required: true }],
        runtimes: [
          {
            runtimeId: 'worker.main',
            kind: 'extension-host',
            entry: 'index.js',
            bridge: 'pxp.runtime.bridge.v1',
            dataPlane: { kinds: ['inline-json'] },
          },
        ],
        activationEvents: ['onStartup'],
        requiresCapabilities: [
          { capabilityId: 'core.capability-registry' },
          { capabilityId: 'host.pmp.storage.config' },
        ],
      },
      installedAt: 1_710_000_000_000,
      enabled: true,
      resolvedArtifacts: [
        {
          runtimeId: 'worker.main',
          path: 'C:/Users/test/AppData/Roaming/PMP/pmp-durable/extensions-v2/startup-worker-demo/current/index.js',
        },
      ],
    };
    const artifact = record.resolvedArtifacts?.[0];
    expect(artifact).toBeTruthy();

    const resolution: ResolvedPluginRuntime = {
      status: 'resolved',
      pluginId: 'startup-worker-demo',
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

    let activateMessage: Record<string, unknown> | null = null;

    const handle = await startInstalledExtensionStartupRuntime(
      {
        record,
        resolution,
        audioService: api.audio as never,
        navigation: api.navigation as never,
      },
      {
        createEntryUrl: async (entryPath: string) =>
          `asset://localhost/${entryPath.replace(/:/g, '%3A')}`,
        createObjectUrl: () => 'blob:test-installed-extension-startup-worker',
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
              activateMessage = envelope;
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
                  requestId: 'startup-capability-list',
                  capabilityId: 'core.capability-registry',
                  method: 'list',
                });
                queueMicrotask(() => {
                  worker.emitMessage({
                    protocolVersion: '1.0',
                    op: 'capability.invoke.request',
                    requestId: 'startup-config-patch',
                    capabilityId: 'host.pmp.storage.config',
                    method: 'patch',
                    payload: {
                      value: {
                        startupCount: 1,
                        lastActivationCause: 'startup',
                        capabilityCount: 2,
                      },
                    },
                  });
                  queueMicrotask(() => {
                    worker.emitMessage({
                      bridgeVersion: runtimeHello.bridgeVersion,
                      op: 'runtime.event',
                      pluginId: runtimeHello.pluginId,
                      runtimeId: runtimeHello.runtimeId,
                      runtimeInstanceId: runtimeHello.runtimeInstanceId,
                      eventName: 'permission.denied',
                      payload: {
                        capability: 'storage:local',
                        action: 'config.patch(next)',
                      },
                    });
                  });
                });
              });
              return;
            }
          }),
      }
    );

    expect(activateMessage).toMatchObject({
      cause: 'startup',
      payload: {
        activationEvent: 'onStartup',
        entryUrl:
          'asset://localhost/C%3A/Users/test/AppData/Roaming/PMP/pmp-durable/extensions-v2/startup-worker-demo/current/index.js',
        permissions: ['api:host', 'api:host-capability', 'storage:local'],
        initialConfig: { startupCount: 0 },
      },
    });

    await flushAsyncWork();
    expect(configState).toEqual({
      startupCount: 1,
      lastActivationCause: 'startup',
      capabilityCount: 2,
    });
    expect(
      extensionsGovernanceModule.readInstalledExtensionAuditLog().map((event) => event.type)
    ).toContain('permission-denied');

    await handle.dispose('test-dispose');
    expect(crashSpy).not.toHaveBeenCalled();
    expect(
      extensionsGovernanceModule.readInstalledExtensionAuditLog().map((event) => event.type)
    ).not.toContain('crash');
  });

  it('supports generic host-event background activations for extv2 workers', async () => {
    const api = createStubApi({});
    const record: extensionsModule.InstalledHostExtensionRecord = {
      manifest: {
        schemaVersion: '2.0',
        kind: 'extension',
        identity: {
          id: 'background-host-demo',
          publisher: 'pixel-matrix.dev',
          version: '0.1.0',
          name: 'background-host-demo',
        },
        hostTargets: [{ hostId: 'pmp', required: true }],
        runtimes: [
          {
            runtimeId: 'worker.main',
            kind: 'extension-host',
            entry: 'index.js',
            bridge: 'pxp.runtime.bridge.v1',
          },
        ],
        activationEvents: ['onHost:navigation.changed'],
        requiresCapabilities: [{ capabilityId: 'core.capability-registry' }],
      },
      installedAt: 1_710_000_000_000,
      enabled: true,
      resolvedArtifacts: [
        {
          runtimeId: 'worker.main',
          path: 'C:/Users/test/AppData/Roaming/PMP/pmp-durable/extensions-v2/background-host-demo/current/index.js',
        },
      ],
    };
    const artifact = record.resolvedArtifacts?.[0];
    expect(artifact).toBeTruthy();

    const resolution: ResolvedPluginRuntime = {
      status: 'resolved',
      pluginId: 'background-host-demo',
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
    vi.spyOn(pluginConfigModule, 'readExtensionConfig').mockReturnValue({});
    vi.spyOn(pluginConfigModule, 'subscribeExtensionConfig').mockReturnValue(() => {});

    let activateMessage: Record<string, unknown> | null = null;

    const handle = await startInstalledExtensionBackgroundRuntime(
      {
        record,
        resolution,
        audioService: api.audio as never,
        navigation: api.navigation as never,
        activation: {
          cause: 'host-event',
          activationEvent: 'onHost:navigation.changed',
          surface: 'host',
          payload: {
            hostEventId: 'navigation.changed',
            eventPayload: {
              currentPage: { type: 'home' },
              currentIndex: 0,
            },
          },
        },
      },
      {
        createEntryUrl: async (entryPath: string) =>
          `asset://localhost/${entryPath.replace(/:/g, '%3A')}`,
        createObjectUrl: () => 'blob:test-installed-extension-background-worker',
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
              activateMessage = envelope;
              worker.emitMessage({
                bridgeVersion: runtimeHello.bridgeVersion,
                op: 'runtime.activate.ack',
                pluginId: runtimeHello.pluginId,
                runtimeId: runtimeHello.runtimeId,
                runtimeInstanceId: runtimeHello.runtimeInstanceId,
              });
            }
          }),
      }
    );

    expect(activateMessage).toMatchObject({
      cause: 'host-event',
      payload: {
        activationEvent: 'onHost:navigation.changed',
        hostEventId: 'navigation.changed',
        eventPayload: {
          currentPage: { type: 'home' },
          currentIndex: 0,
        },
      },
    });

    await handle.dispose('test-dispose');
  });
});
