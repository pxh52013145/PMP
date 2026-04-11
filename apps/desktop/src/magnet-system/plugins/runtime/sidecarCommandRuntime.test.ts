import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent, RuntimeHello } from '@pixel-matrix/plugin-platform-contracts';
import type { PluginMountApi } from '../host-api';
import { DEFAULT_TELEMETRY_POLICY, type TelemetryRecord } from '../../../contracts/telemetry';
import {
  setGlobalTelemetryService,
  type TelemetryService,
  type TelemetrySnapshot,
} from '../../../services/telemetry';
import { runPmpmBridgeSidecarCommand } from './sidecarCommandRuntime';
import type { RuntimeBridgeTransportMessage } from './runtimeBridgeHostSession';
import * as pluginConfigModule from '../pluginConfig';
import * as pluginHostApiModule from '../pluginHostApi';
import * as pmpmGovernanceModule from '../pmpmGovernance';
import * as pmpmModule from '../pmpm';

function createRuntimeEvent(
  runtimeContext: Pick<RuntimeEvent, 'bridgeVersion' | 'pluginId' | 'runtimeId' | 'runtimeInstanceId'>,
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
        { id: 'host.pmp.navigation', version: '1.0.0' },
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
          pluginId: 'sidecar-plugin',
          runtimeId: 'sidecar.main',
          runtimeInstanceId,
          supportedBridgeVersions: ['1.0'],
          runtimeKind: 'sidecar',
          carrier: 'native-process',
          supportsViewMount: false,
          supportedDataPlanes: ['inline-json', 'pipe'],
        } satisfies RuntimeHello);
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

afterEach(() => {
  setGlobalTelemetryService(null);
  vi.restoreAllMocks();
});

async function flushMessages(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('sidecar command runtime', () => {
  it('runs a command through the native-process bridge and round-trips config mutation', async () => {
    const configState: Record<string, unknown> = { count: 0 };
    const api = createStubApi(configState);
    const harness = createSidecarControllerHarness();

    vi.spyOn(pluginHostApiModule, 'createPluginMountApi').mockReturnValue(api);
    vi.spyOn(pluginConfigModule, 'readPmpmPluginConfig').mockReturnValue({ ...configState });
    vi.spyOn(pluginConfigModule, 'subscribePmpmPluginConfig').mockReturnValue(() => {});
    vi.spyOn(pmpmModule, 'getPmpmPluginEffectivePermissions').mockReturnValue(
      new Set(['api:host', 'storage:local'])
    );
    vi.spyOn(pmpmModule, 'getInstalledPmpmPlugin').mockReturnValue({
      manifest: { permissions: ['api:host', 'storage:local'] },
      deniedPermissions: [],
    } as never);
    const crashSpy = vi.spyOn(pmpmModule, 'recordPmpmPluginCrash').mockImplementation(() => {});

    let runtimeInstanceId = '';

    const runtimePromise = runPmpmBridgeSidecarCommand(
      {
        pluginId: 'sidecar-plugin',
        runtimeId: 'sidecar.main',
        entryPath: 'bin/sidecar-plugin',
        commandId: 'increment',
        audioService: api.audio as never,
        navigation: api.navigation as never,
      },
      {
        now: () => 1234,
        createPortController: (options) => {
          expect(options.pluginId).toBe('sidecar-plugin');
          expect(options.runtimeId).toBe('sidecar.main');
          expect(options.runtimeInstanceId).toContain('sidecar-plugin:command:1234');
          expect(options.entryPath).toBe('bin/sidecar-plugin');
          expect(options.commandId).toBe('increment');
          runtimeInstanceId = options.runtimeInstanceId;
          return harness.controller;
        },
      }
    );

    await flushMessages();

    harness.emitRuntimeHello(runtimeInstanceId);
    await flushMessages();

    const runtimeInit = harness.sent.find(
      (message) => (message as Record<string, unknown>).op === 'runtime.init'
    ) as Record<string, unknown> | undefined;
    expect(runtimeInit).toBeTruthy();

    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.init.ack',
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId,
    });
    await flushMessages();

    const runtimeActivate = harness.sent.find(
      (message) => (message as Record<string, unknown>).op === 'runtime.activate'
    ) as Record<string, unknown> | undefined;
    expect(runtimeActivate).toBeTruthy();
    expect(runtimeActivate?.payload).toMatchObject({
      commandId: 'increment',
      entryPath: 'bin/sidecar-plugin',
      initialConfig: { count: 0 },
      permissions: ['api:host', 'storage:local'],
      hostInfo: {
        pluginId: 'sidecar-plugin',
        hostLabel: 'PluginCommandSidecar',
      },
    });

    const runtimeContext = {
      bridgeVersion: '1.0',
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId,
    };

    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.activate.ack',
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId,
    });
    await flushMessages();

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
    await flushMessages();

    harness.emit(createRuntimeEvent(runtimeContext, 'command.result', { ok: true }));
    await expect(runtimePromise).resolves.toBeUndefined();

    expect(api.config.patch).toHaveBeenCalledWith({
      count: 1,
      lastCommand: 'increment',
    });
    expect(configState).toEqual({
      count: 1,
      lastCommand: 'increment',
    });
    expect(harness.dispose).toHaveBeenCalledWith('runtime-command-finished');
    expect(crashSpy).not.toHaveBeenCalled();
  });

  it('records crashes and disposes the controller when the sidecar reports command failure', async () => {
    const api = createStubApi({ count: 0 });
    const harness = createSidecarControllerHarness();
    let runtimeInstanceId = '';

    vi.spyOn(pluginHostApiModule, 'createPluginMountApi').mockReturnValue(api);
    vi.spyOn(pluginConfigModule, 'readPmpmPluginConfig').mockReturnValue({ count: 0 });
    vi.spyOn(pluginConfigModule, 'subscribePmpmPluginConfig').mockReturnValue(() => {});
    vi.spyOn(pmpmModule, 'getPmpmPluginEffectivePermissions').mockReturnValue(new Set());
    vi.spyOn(pmpmModule, 'getInstalledPmpmPlugin').mockReturnValue({
      manifest: { permissions: [] },
      deniedPermissions: [],
    } as never);
    const crashSpy = vi.spyOn(pmpmModule, 'recordPmpmPluginCrash').mockImplementation(() => {});
    vi.spyOn(pmpmGovernanceModule, 'recordPmpmAuditEvent').mockImplementation(() => {});

    const runtimePromise = runPmpmBridgeSidecarCommand(
      {
        pluginId: 'sidecar-plugin',
        runtimeId: 'sidecar.main',
        entryPath: 'bin/sidecar-plugin',
        commandId: 'explode',
        audioService: api.audio as never,
        navigation: api.navigation as never,
        timeoutMs: 2_000,
      },
      {
        now: () => 1234,
        createPortController: (options) => {
          runtimeInstanceId = options.runtimeInstanceId;
          return harness.controller;
        },
      }
    );

    await flushMessages();
    harness.emitRuntimeHello(runtimeInstanceId);
    await flushMessages();

    const runtimeInit = harness.sent.find(
      (message) => (message as Record<string, unknown>).op === 'runtime.init'
    ) as Record<string, unknown> | undefined;
    runtimeInstanceId = String(runtimeInit?.runtimeInstanceId ?? '');

    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.init.ack',
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId,
    });
    await flushMessages();

    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.activate.ack',
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId,
    });
    await flushMessages();

    harness.emit(
      createRuntimeEvent(
        {
          bridgeVersion: '1.0',
          pluginId: 'sidecar-plugin',
          runtimeId: 'sidecar.main',
          runtimeInstanceId,
        },
        'command.result',
        { ok: false, message: 'boom' }
      )
    );

    await expect(runtimePromise).rejects.toThrow('boom');

    expect(crashSpy).toHaveBeenCalledWith('sidecar-plugin', expect.any(Error), 'command');
    expect(harness.dispose).toHaveBeenCalledWith('runtime-crash');
  });

  it('emits plugin.sidecar.bridge.failed when opening the native-process bridge fails', async () => {
    const telemetry = createTelemetryServiceSpy();
    setGlobalTelemetryService(telemetry.service);

    const api = createStubApi({ count: 0 });
    vi.spyOn(pluginHostApiModule, 'createPluginMountApi').mockReturnValue(api);
    vi.spyOn(pluginConfigModule, 'readPmpmPluginConfig').mockReturnValue({ count: 0 });
    vi.spyOn(pluginConfigModule, 'subscribePmpmPluginConfig').mockReturnValue(() => {});
    vi.spyOn(pmpmModule, 'getPmpmPluginEffectivePermissions').mockReturnValue(new Set());
    vi.spyOn(pmpmModule, 'getInstalledPmpmPlugin').mockReturnValue({
      manifest: { permissions: [] },
      deniedPermissions: [],
    } as never);
    vi.spyOn(pmpmModule, 'recordPmpmPluginCrash').mockImplementation(() => {});

    await expect(
      runPmpmBridgeSidecarCommand(
        {
          pluginId: 'sidecar-plugin',
          runtimeId: 'sidecar.main',
          entryPath: 'bin/sidecar-plugin',
          commandId: 'explode',
          audioService: api.audio as never,
          navigation: api.navigation as never,
          timeoutMs: 2_000,
        },
        {
          now: () => 1234,
          createPortController: async () => {
            throw new Error('open bridge failed');
          },
        }
      )
    ).rejects.toThrow('open bridge failed');

    expect(telemetry.calls.filter((entry) => entry.event === 'plugin.sidecar.bridge.failed')).toHaveLength(1);
    expect(telemetry.calls.at(-1)).toMatchObject({
      level: 'error',
      event: 'plugin.sidecar.bridge.failed',
      message: 'open bridge failed',
      fields: expect.objectContaining({
        pluginId: 'sidecar-plugin',
        sourceKind: 'pmpm',
        runtimeId: 'sidecar.main',
        surfaceKind: 'command',
        surfaceId: 'explode',
        cause: 'command',
        stage: 'open',
      }),
    });
  });
});
