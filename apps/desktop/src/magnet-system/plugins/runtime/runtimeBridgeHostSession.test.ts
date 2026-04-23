import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  RuntimeActivate,
  RuntimeEvent,
  RuntimeHealthRequest,
  RuntimeHealthResponse,
  RuntimeHello,
  RuntimeInit,
} from '@pixel-matrix/plugin-platform-contracts';
import type { PluginMountApi } from '../host-api';
import { DEFAULT_TELEMETRY_POLICY, type TelemetryRecord } from '../../../contracts/telemetry';
import {
  setGlobalTelemetryService,
  type TelemetryService,
  type TelemetrySnapshot,
} from '../../../services/telemetry';
import { createRuntimeResourceRegistry } from './runtimeResourceRegistry';
import {
  createRuntimeBridgeHostSession,
  type RuntimeBridgePort,
  type RuntimeBridgeTransportMessage,
} from './runtimeBridgeHostSession';

type TelemetryCall = {
  moduleId: string;
  component: string | null | undefined;
  level: string;
  event: string;
  message?: string | null;
  traceId?: string | null;
  spanId?: string | null;
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
          traceId: options?.traceId ?? null,
          spanId: options?.spanId ?? null,
          fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined,
        });
      },
      trace: (event, options) =>
        calls.push({
          moduleId,
          component,
          level: 'trace',
          event,
          message: options?.message ?? null,
          traceId: options?.traceId ?? null,
          spanId: options?.spanId ?? null,
          fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined,
        }),
      debug: (event, options) =>
        calls.push({
          moduleId,
          component,
          level: 'debug',
          event,
          message: options?.message ?? null,
          traceId: options?.traceId ?? null,
          spanId: options?.spanId ?? null,
          fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined,
        }),
      info: (event, options) =>
        calls.push({
          moduleId,
          component,
          level: 'info',
          event,
          message: options?.message ?? null,
          traceId: options?.traceId ?? null,
          spanId: options?.spanId ?? null,
          fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined,
        }),
      warn: (event, options) =>
        calls.push({
          moduleId,
          component,
          level: 'warn',
          event,
          message: options?.message ?? null,
          traceId: options?.traceId ?? null,
          spanId: options?.spanId ?? null,
          fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined,
        }),
      error: (event, options) =>
        calls.push({
          moduleId,
          component,
          level: 'error',
          event,
          message: options?.message ?? null,
          traceId: options?.traceId ?? null,
          spanId: options?.spanId ?? null,
          fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined,
        }),
      fatal: (event, options) =>
        calls.push({
          moduleId,
          component,
          level: 'fatal',
          event,
          message: options?.message ?? null,
          traceId: options?.traceId ?? null,
          spanId: options?.spanId ?? null,
          fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined,
        }),
      metric: (event, fields, options) =>
        calls.push({
          moduleId,
          component,
          level: options?.level ?? 'info',
          event,
          message: options?.message ?? null,
          traceId: options?.traceId ?? null,
          spanId: options?.spanId ?? null,
          fields: fields as Record<string, unknown>,
        }),
      startSpan: () => ({
        end: () => {},
      }),
    }),
    ingest: () => {},
    destroy: () => {},
  };

  return { calls, service };
}

function createStreamController() {
  const dataListeners = new Set<(payload: unknown, envelope: Record<string, unknown>) => void>();
  const endListeners = new Set<(reason?: string, envelope?: Record<string, unknown>) => void>();
  let ended = false;

  const handle = {
    streamId: 'analysis-stream-1',
    mode: 'push' as const,
    transport: 'inline-json' as const,
    onData: (cb: (payload: unknown, envelope: Record<string, unknown>) => void) => {
      dataListeners.add(cb);
      return () => dataListeners.delete(cb);
    },
    onEnd: (cb: (reason?: string, envelope?: Record<string, unknown>) => void) => {
      endListeners.add(cb);
      return () => endListeners.delete(cb);
    },
    cancel: vi.fn(async (reason?: string) => {
      if (ended) return;
      ended = true;
      const envelope = { streamId: 'analysis-stream-1', reason: reason ?? 'cancelled' };
      for (const listener of Array.from(endListeners)) {
        listener(envelope.reason, envelope);
      }
    }),
    dispose: vi.fn(async (reason?: string) => {
      if (ended) return;
      ended = true;
      const envelope = { streamId: 'analysis-stream-1', reason: reason ?? 'disposed' };
      for (const listener of Array.from(endListeners)) {
        listener(envelope.reason, envelope);
      }
    }),
  };

  return {
    handle,
    emitData: (payload: unknown, sequence = 0) => {
      if (ended) return;
      const envelope = { streamId: 'analysis-stream-1', sequence, payload };
      for (const listener of Array.from(dataListeners)) {
        listener(payload, envelope);
      }
    },
  };
}

function createStubApi(options: {
  streamHandle?: Awaited<ReturnType<typeof createStreamController>>['handle'];
} = {}): PluginMountApi {
  return {
    host: {
      getInfo: vi.fn(() => null),
      listPermissions: vi.fn(() => []),
      hasPermission: vi.fn(() => false),
      listCapabilities: vi.fn(async () => [{ id: 'host.pmp.navigation', version: '1.0.0' }]),
      invokeCapability: vi.fn(async () => ({ ok: true })),
      openStream: vi.fn(async () => options.streamHandle ?? null),
      openSession: vi.fn(async () => ({
        sessionId: 'audio-input-session-1',
        providerSessionId: 'provider-session-1',
        metadata: { selectedInputId: 'symphonia' },
      })),
      closeSession: vi.fn(async () => undefined),
    },
    audio: {
      getState: vi.fn(() => ({ playbackState: 'paused' })),
      onStateChange: vi.fn(() => () => {}),
      onTimeUpdate: vi.fn(() => () => {}),
      onEnded: vi.fn(() => () => {}),
      onLoadProgress: vi.fn(() => () => {}),
      onError: vi.fn(() => () => {}),
      getCover: vi.fn(async () => ({ url: 'cover://demo', colors: { accent: '#fff' } })),
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
      get: vi.fn(() => ({ enabled: true })),
      onChange: vi.fn(() => () => {}),
      set: vi.fn(() => undefined),
      patch: vi.fn(() => undefined),
      reset: vi.fn(() => undefined),
    },
    window: {
      open: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    },
  } as unknown as PluginMountApi;
}

function createPortHarness(initialBufferedMessages: RuntimeBridgeTransportMessage[] = []): {
  port: RuntimeBridgePort;
  sent: RuntimeBridgeTransportMessage[];
  emit: (message: RuntimeBridgeTransportMessage) => void;
} {
  const listeners = new Set<(message: RuntimeBridgeTransportMessage) => void>();
  const sent: RuntimeBridgeTransportMessage[] = [];
  const bufferedMessages = [...initialBufferedMessages];

  return {
    port: {
      postMessage: (message) => {
        sent.push(message);
      },
      onMessage: (listener) => {
        listeners.add(listener);
        if (bufferedMessages.length > 0) {
          const pending = bufferedMessages.splice(0, bufferedMessages.length);
          for (const message of pending) {
            listener(message);
          }
        }
        return () => listeners.delete(listener);
      },
    },
    sent,
    emit: (message) => {
      for (const listener of Array.from(listeners)) {
        listener(message);
      }
    },
  };
}

function createRuntimeHello(overrides: Partial<RuntimeHello> = {}): RuntimeHello {
  return {
    bridgeVersion: '1.0',
    op: 'runtime.hello',
    pluginId: 'worker-plugin',
    runtimeId: 'worker.main',
    runtimeInstanceId: 'runtime-instance-1',
    supportedBridgeVersions: ['1.0'],
    runtimeKind: 'extension-host',
    carrier: 'dedicated-worker',
    supportsViewMount: false,
    ...overrides,
  };
}

function createRuntimeInit(overrides: Partial<RuntimeInit> = {}): RuntimeInit {
  return {
    bridgeVersion: '1.0',
    op: 'runtime.init',
    pluginId: 'worker-plugin',
    runtimeId: 'worker.main',
    runtimeInstanceId: 'runtime-instance-1',
    hostId: 'pmp',
    trustLevel: 'sandboxed',
    grantedCapabilities: [],
    ...overrides,
  };
}

function createRuntimeActivate(overrides: Partial<RuntimeActivate> = {}): RuntimeActivate {
  return {
    bridgeVersion: '1.0',
    op: 'runtime.activate',
    pluginId: 'worker-plugin',
    runtimeId: 'worker.main',
    runtimeInstanceId: 'runtime-instance-1',
    cause: 'startup',
    ...overrides,
  };
}

function createRuntimeEvent(
  eventName: string,
  payload?: unknown,
  overrides: Partial<RuntimeEvent> = {}
): RuntimeEvent {
  return {
    bridgeVersion: '1.0',
    op: 'runtime.event',
    pluginId: 'worker-plugin',
    runtimeId: 'worker.main',
    runtimeInstanceId: 'runtime-instance-1',
    eventName,
    payload,
    ...overrides,
  };
}

function createSidecarRuntimeHello(overrides: Partial<RuntimeHello> = {}): RuntimeHello {
  return createRuntimeHello({
    pluginId: 'sidecar-plugin',
    runtimeId: 'sidecar.main',
    runtimeInstanceId: 'sidecar-instance-1',
    runtimeKind: 'sidecar',
    carrier: 'native-process',
    supportsViewMount: false,
    supportedDataPlanes: ['pipe'],
    ...overrides,
  });
}

function createSidecarRuntimeInit(overrides: Partial<RuntimeInit> = {}): RuntimeInit {
  return createRuntimeInit({
    pluginId: 'sidecar-plugin',
    runtimeId: 'sidecar.main',
    runtimeInstanceId: 'sidecar-instance-1',
    ...overrides,
  });
}

function createSidecarRuntimeActivate(overrides: Partial<RuntimeActivate> = {}): RuntimeActivate {
  return createRuntimeActivate({
    pluginId: 'sidecar-plugin',
    runtimeId: 'sidecar.main',
    runtimeInstanceId: 'sidecar-instance-1',
    ...overrides,
  });
}

async function flushMessages(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  setGlobalTelemetryService(null);
  vi.clearAllMocks();
});

describe('runtime bridge host session', () => {
  it('completes the hello/init/activate handshake and serves health checks', async () => {
    const api = createStubApi();
    const harness = createPortHarness();
    const session = createRuntimeBridgeHostSession({
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
      runtimeKind: 'extension-host',
      carrier: 'dedicated-worker',
      api,
      permissions: new Set(['api:audio-control']),
      port: harness.port,
      runtimeInit: createRuntimeInit(),
      runtimeActivate: createRuntimeActivate(),
    });

    const startPromise = session.start();
    harness.emit(createRuntimeHello());
    await flushMessages();
    expect(harness.sent[0]).toMatchObject({ op: 'runtime.init' });

    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.init.ack',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
    });
    await flushMessages();
    expect(harness.sent[1]).toMatchObject({ op: 'runtime.activate' });

    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.activate.ack',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
    });
    await startPromise;

    expect(session.getState()).toBe('active');

    const healthPromise = session.requestHealth();
    await flushMessages();
    const healthRequest = harness.sent[2] as RuntimeHealthRequest;
    expect(healthRequest.op).toBe('runtime.health.request');

    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.health.response',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
      requestId: healthRequest.requestId,
      ready: true,
      status: 'healthy',
      message: 'ok',
    } satisfies RuntimeHealthResponse);

    await expect(healthPromise).resolves.toMatchObject({
      op: 'runtime.health.response',
      ready: true,
      status: 'healthy',
    });
  });

  it('routes capability.invoke requests through the host capability dispatcher', async () => {
    const api = createStubApi();
    const harness = createPortHarness();
    const session = createRuntimeBridgeHostSession({
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
      runtimeKind: 'extension-host',
      carrier: 'dedicated-worker',
      api,
      permissions: new Set(['api:audio-control']),
      port: harness.port,
      runtimeInit: createRuntimeInit(),
      runtimeActivate: createRuntimeActivate(),
    });

    const startPromise = session.start();
    harness.emit(createRuntimeHello());
    await flushMessages();
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.init.ack',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
    });
    await flushMessages();
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.activate.ack',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
    });
    await startPromise;

    harness.emit({
      protocolVersion: '1.0',
      op: 'capability.invoke.request',
      requestId: 'cap-1',
      capabilityId: 'host.pmp.audio-engine.playback',
      method: 'play',
    });
    await flushMessages();

    expect(harness.sent.at(-1)).toMatchObject({
      op: 'capability.invoke.response',
      requestId: 'cap-1',
      ok: true,
      data: { played: true },
    });
    expect(api.audio.play).toHaveBeenCalledTimes(1);
  });

  it('buffers outbound runtime events until activation and forwards inbound runtime events', async () => {
    const api = createStubApi();
    const harness = createPortHarness();
    const onRuntimeEvent = vi.fn();
    const session = createRuntimeBridgeHostSession({
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
      runtimeKind: 'extension-host',
      carrier: 'dedicated-worker',
      api,
      permissions: new Set(['api:audio-state']),
      port: harness.port,
      runtimeInit: createRuntimeInit(),
      runtimeActivate: createRuntimeActivate(),
      onRuntimeEvent,
    });

    const queuedEvent = session.emitRuntimeEvent('audio.state', {
      state: { playbackState: 'playing' },
    });
    await flushMessages();
    expect(harness.sent).toHaveLength(0);

    const startPromise = session.start();
    harness.emit(createRuntimeHello());
    await flushMessages();
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.init.ack',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
    });
    await flushMessages();
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.activate.ack',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
    });

    await startPromise;
    await queuedEvent;
    expect(harness.sent.at(-1)).toMatchObject({
      op: 'runtime.event',
      eventName: 'audio.state',
      payload: {
        state: { playbackState: 'playing' },
      },
    });

    harness.emit(
      createRuntimeEvent('command.result', {
        ok: true,
      })
    );
    await flushMessages();

    expect(onRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'runtime.event',
        eventName: 'command.result',
        payload: { ok: true },
      })
    );
  });

  it('emits plugin.runtime.activate lifecycle telemetry for successful handshakes', async () => {
    const telemetry = createTelemetryServiceSpy();
    setGlobalTelemetryService(telemetry.service);

    const api = createStubApi();
    const harness = createPortHarness();
    const session = createRuntimeBridgeHostSession({
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
      runtimeKind: 'extension-host',
      carrier: 'dedicated-worker',
      api,
      permissions: new Set(['api:audio-state']),
      port: harness.port,
      runtimeInit: createRuntimeInit(),
      runtimeActivate: createRuntimeActivate({
        cause: 'command',
        payload: {
          surface: 'command',
          surfaceId: 'demo-command',
          commandId: 'demo-command',
        },
      }),
      telemetry: {
        sourceKind: 'extv2',
        launcherId: 'pxp.extension-host.worker',
        hostLabel: 'PluginCommandWorker',
      },
    });

    const startPromise = session.start();
    harness.emit(createRuntimeHello());
    await flushMessages();
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.init.ack',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
    });
    await flushMessages();
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.activate.ack',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
    });
    await startPromise;

    const activationStart = telemetry.calls.find((entry) => entry.event === 'plugin.runtime.activate.start');
    const activationCompleted = telemetry.calls.find(
      (entry) => entry.event === 'plugin.runtime.activate.completed'
    );

    expect(telemetry.calls.filter((entry) => entry.event === 'plugin.runtime.activate.start')).toHaveLength(1);
    expect(telemetry.calls.filter((entry) => entry.event === 'plugin.runtime.activate.completed')).toHaveLength(1);
    expect(activationStart).toMatchObject({
      level: 'info',
      event: 'plugin.runtime.activate.start',
      fields: expect.objectContaining({
        pluginId: 'worker-plugin',
        sourceKind: 'extv2',
        launcherId: 'pxp.extension-host.worker',
        runtimeId: 'worker.main',
        runtimeInstanceId: 'runtime-instance-1',
        surfaceKind: 'command',
        surfaceId: 'demo-command',
        cause: 'command',
        status: 'start',
      }),
    });
    expect(activationCompleted).toMatchObject({
      level: 'info',
      event: 'plugin.runtime.activate.completed',
      fields: expect.objectContaining({
        pluginId: 'worker-plugin',
        sourceKind: 'extv2',
        status: 'completed',
      }),
    });
    expect(activationCompleted?.fields?.durationMs).toEqual(expect.any(Number));
  });

  it('emits Minimal Tracer startup and health timeline records with stable trace fields', async () => {
    const telemetry = createTelemetryServiceSpy();
    setGlobalTelemetryService(telemetry.service);

    const api = createStubApi();
    const harness = createPortHarness();
    const session = createRuntimeBridgeHostSession({
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
      runtimeKind: 'extension-host',
      carrier: 'dedicated-worker',
      api,
      permissions: new Set(['api:audio-state']),
      port: harness.port,
      runtimeInit: createRuntimeInit(),
      runtimeActivate: createRuntimeActivate(),
      telemetry: {
        sourceKind: 'extv2',
        launcherId: 'pxp.extension-host.worker',
        hostLabel: 'PluginCommandWorker',
      },
    });

    const startPromise = session.start();
    harness.emit(createRuntimeHello());
    await flushMessages();
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.init.ack',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
    });
    await flushMessages();
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.activate.ack',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
    });
    await startPromise;

    const healthPromise = session.requestHealth();
    await flushMessages();
    const healthRequest = harness.sent.at(-1) as RuntimeHealthRequest;
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.health.response',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
      requestId: healthRequest.requestId,
      traceId: healthRequest.traceId,
      ready: true,
      status: 'healthy',
      message: 'ok',
    } satisfies RuntimeHealthResponse);
    await healthPromise;

    const startupStart = telemetry.calls.find(
      (entry) => entry.event === 'plugin.runtime.control.startup.start'
    );
    const startupCompleted = telemetry.calls.find(
      (entry) => entry.event === 'plugin.runtime.control.startup.completed'
    );
    const healthStart = telemetry.calls.find((entry) => entry.event === 'plugin.runtime.control.health.start');
    const healthCompleted = telemetry.calls.find(
      (entry) => entry.event === 'plugin.runtime.control.health.completed'
    );

    expect(startupStart).toMatchObject({
      level: 'debug',
      traceId: expect.any(String),
      spanId: expect.any(String),
      fields: expect.objectContaining({
        channel: 'control',
        pluginId: 'worker-plugin',
        protocolOp: 'runtime.start',
        status: 'start',
      }),
    });
    expect(startupCompleted).toMatchObject({
      level: 'debug',
      traceId: startupStart?.traceId,
      spanId: startupStart?.spanId,
      fields: expect.objectContaining({
        channel: 'control',
        pluginId: 'worker-plugin',
        protocolOp: 'runtime.start',
        status: 'active',
      }),
    });
    expect(healthStart).toMatchObject({
      level: 'debug',
      traceId: expect.any(String),
      spanId: expect.any(String),
      fields: expect.objectContaining({
        channel: 'control',
        pluginId: 'worker-plugin',
        requestId: healthRequest.requestId,
        protocolOp: 'runtime.health.request',
        status: 'start',
      }),
    });
    expect(healthCompleted).toMatchObject({
      level: 'debug',
      traceId: healthStart?.traceId,
      spanId: healthStart?.spanId,
      fields: expect.objectContaining({
        channel: 'control',
        pluginId: 'worker-plugin',
        requestId: healthRequest.requestId,
        protocolOp: 'runtime.health.response',
        status: 'healthy',
      }),
    });
  });

  it('emits plugin.runtime.activate.failed when the startup handshake crashes', async () => {
    const telemetry = createTelemetryServiceSpy();
    setGlobalTelemetryService(telemetry.service);

    const api = createStubApi();
    const harness = createPortHarness();
    const session = createRuntimeBridgeHostSession({
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
      runtimeKind: 'extension-host',
      carrier: 'dedicated-worker',
      api,
      permissions: new Set(['api:audio-state']),
      port: harness.port,
      runtimeInit: createRuntimeInit(),
      runtimeActivate: createRuntimeActivate({
        cause: 'startup',
      }),
      telemetry: {
        sourceKind: 'extv2',
        launcherId: 'pxp.extension-host.worker',
        hostLabel: 'ExtensionStartupWorker',
      },
    });

    const startPromise = session.start();
    harness.emit(createRuntimeHello());
    await flushMessages();
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.error',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
      fatal: true,
      message: 'startup boom',
    });

    await expect(startPromise).rejects.toThrow('startup boom');
    const activationFailed = telemetry.calls.find((entry) => entry.event === 'plugin.runtime.activate.failed');
    expect(telemetry.calls.filter((entry) => entry.event === 'plugin.runtime.activate.start')).toHaveLength(1);
    expect(telemetry.calls.filter((entry) => entry.event === 'plugin.runtime.activate.failed')).toHaveLength(1);
    expect(activationFailed).toMatchObject({
      level: 'error',
      event: 'plugin.runtime.activate.failed',
      message: 'startup boom',
      fields: expect.objectContaining({
        pluginId: 'worker-plugin',
        sourceKind: 'extv2',
        status: 'failed',
        cause: 'startup',
      }),
    });
  });

  it('emits governance revoke telemetry and control trace records for revoke acknowledgements', async () => {
    const telemetry = createTelemetryServiceSpy();
    setGlobalTelemetryService(telemetry.service);

    const api = createStubApi();
    const harness = createPortHarness();
    const session = createRuntimeBridgeHostSession({
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
      runtimeKind: 'extension-host',
      carrier: 'dedicated-worker',
      api,
      permissions: new Set(['api:navigation']),
      port: harness.port,
      runtimeInit: createRuntimeInit({
        grantedCapabilities: [
          {
            capabilityId: 'host.pmp.navigation',
            version: '1.0.0',
            mode: 'required',
          },
        ],
      }),
      runtimeActivate: createRuntimeActivate({
        cause: 'view',
        payload: {
          surface: 'page',
          surfaceId: 'demo-page',
        },
      }),
      telemetry: {
        sourceKind: 'extv2',
        launcherId: 'pxp.extension-host.worker',
        hostLabel: 'InstalledExtensionPageHost',
      },
    });

    const startPromise = session.start();
    harness.emit(createRuntimeHello());
    await flushMessages();
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.init.ack',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
    });
    await flushMessages();
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.activate.ack',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
    });
    await startPromise;

    const revokePromise = session.revokeCapabilities(undefined, 'runtime-dispose', {
      requestId: 'revoke-1',
      traceId: 'trace-revoke-1',
      timeoutMs: 1_000,
    });
    await flushMessages();
    expect(harness.sent.at(-1)).toMatchObject({
      op: 'runtime.capabilities.revoke',
      requestId: 'revoke-1',
      traceId: 'trace-revoke-1',
      capabilityIds: ['host.pmp.navigation'],
      reason: 'runtime-dispose',
    });

    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.capabilities.revoke.ack',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
      requestId: 'revoke-1',
      traceId: 'trace-revoke-1',
      ok: true,
      ignored: true,
      reason: 'runtime-dispose',
    });
    await revokePromise;

    expect(telemetry.calls.filter((entry) => entry.event === 'plugin.governance.revoke.start')).toHaveLength(1);
    expect(telemetry.calls.filter((entry) => entry.event === 'plugin.governance.revoke.completed')).toHaveLength(1);
    expect(telemetry.calls.find((entry) => entry.event === 'plugin.governance.revoke.completed')).toMatchObject({
      level: 'info',
      fields: expect.objectContaining({
        pluginId: 'worker-plugin',
        requestId: 'revoke-1',
        ignored: true,
        reason: 'runtime-dispose',
      }),
    });
    expect(
      telemetry.calls.find((entry) => entry.event === 'plugin.governance.control.revoke.requested')
    ).toMatchObject({
      level: 'debug',
      fields: expect.objectContaining({
        pluginId: 'worker-plugin',
        requestId: 'revoke-1',
        protocolOp: 'runtime.capabilities.revoke',
      }),
    });
    expect(
      telemetry.calls.find((entry) => entry.event === 'plugin.governance.control.revoke.ack')
    ).toMatchObject({
      level: 'debug',
      fields: expect.objectContaining({
        pluginId: 'worker-plugin',
        requestId: 'revoke-1',
        protocolOp: 'runtime.capabilities.revoke.ack',
        ignored: true,
      }),
    });
  });

  it('emits revoke timeout and cleanup telemetry when governance cleanup is forced', async () => {
    const telemetry = createTelemetryServiceSpy();
    setGlobalTelemetryService(telemetry.service);

    const api = createStubApi();
    const harness = createPortHarness();
    const session = createRuntimeBridgeHostSession({
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
      runtimeKind: 'extension-host',
      carrier: 'dedicated-worker',
      api,
      permissions: new Set(['api:navigation']),
      port: harness.port,
      runtimeInit: createRuntimeInit({
        grantedCapabilities: [
          {
            capabilityId: 'host.pmp.navigation',
            version: '1.0.0',
            mode: 'required',
          },
        ],
      }),
      runtimeActivate: createRuntimeActivate(),
      telemetry: {
        sourceKind: 'extv2',
        launcherId: 'pxp.extension-host.worker',
        hostLabel: 'ExtensionStartupWorker',
      },
    });

    const startPromise = session.start();
    harness.emit(createRuntimeHello());
    await flushMessages();
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.init.ack',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
    });
    await flushMessages();
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.activate.ack',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
    });
    await startPromise;

    await expect(
      session.revokeCapabilities(undefined, 'runtime-unresponsive', {
        requestId: 'revoke-timeout-1',
        timeoutMs: 10,
      })
    ).rejects.toThrow('runtime.capabilities.revoke.ack');

    await session.dispose('runtime-unresponsive');

    expect(telemetry.calls.filter((entry) => entry.event === 'plugin.governance.revoke.timeout')).toHaveLength(1);
    expect(telemetry.calls.filter((entry) => entry.event === 'plugin.governance.cleanup.start')).toHaveLength(1);
    expect(telemetry.calls.filter((entry) => entry.event === 'plugin.governance.cleanup.completed')).toHaveLength(1);
    expect(telemetry.calls.find((entry) => entry.event === 'plugin.governance.cleanup.completed')).toMatchObject({
      level: 'info',
      fields: expect.objectContaining({
        pluginId: 'worker-plugin',
        reason: 'runtime-unresponsive',
        status: 'completed',
      }),
    });
  });

  it('ignores stale revoke acknowledgements without crashing an active session', async () => {
    const telemetry = createTelemetryServiceSpy();
    setGlobalTelemetryService(telemetry.service);

    const api = createStubApi();
    const harness = createPortHarness();
    const onRuntimeCrash = vi.fn();
    const session = createRuntimeBridgeHostSession({
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
      runtimeKind: 'extension-host',
      carrier: 'dedicated-worker',
      api,
      permissions: new Set(['api:navigation']),
      port: harness.port,
      runtimeInit: createRuntimeInit({
        grantedCapabilities: [
          {
            capabilityId: 'host.pmp.navigation',
            version: '1.0.0',
            mode: 'required',
          },
        ],
      }),
      runtimeActivate: createRuntimeActivate(),
      onRuntimeCrash,
      telemetry: {
        sourceKind: 'extv2',
        launcherId: 'pxp.extension-host.worker',
        hostLabel: 'ExtensionStartupWorker',
      },
    });

    const startPromise = session.start();
    harness.emit(createRuntimeHello());
    await flushMessages();
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.init.ack',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
    });
    await flushMessages();
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.activate.ack',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
    });
    await startPromise;

    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.capabilities.revoke.ack',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
      requestId: 'runtime-revoke:runtime-instance-1:stale',
      traceId: 'trace-stale-revoke',
      ok: true,
      ignored: true,
      reason: 'runtime-dispose',
    });
    await flushMessages();

    expect(session.getState()).toBe('active');
    expect(onRuntimeCrash).not.toHaveBeenCalled();
    expect(
      telemetry.calls.find(
        (entry) => entry.event === 'plugin.governance.control.revoke.ack.ignored'
      )
    ).toMatchObject({
      level: 'debug',
      fields: expect.objectContaining({
        pluginId: 'worker-plugin',
        requestId: 'runtime-revoke:runtime-instance-1:stale',
        protocolOp: 'runtime.capabilities.revoke.ack',
        status: 'ignored',
        state: 'active',
      }),
    });
  });

  it('emits a control-trace crash -> forced teardown timeline when runtime cleanup follows a fatal error', async () => {
    const telemetry = createTelemetryServiceSpy();
    setGlobalTelemetryService(telemetry.service);

    const api = createStubApi();
    const harness = createPortHarness();
    const session = createRuntimeBridgeHostSession({
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId: 'sidecar-instance-1',
      runtimeKind: 'sidecar',
      carrier: 'native-process',
      api,
      permissions: new Set(['api:host']),
      port: harness.port,
      runtimeInit: createSidecarRuntimeInit(),
      runtimeActivate: createSidecarRuntimeActivate({
        cause: 'capability',
        payload: { reason: 'smoke-test' },
      }),
      telemetry: {
        sourceKind: 'extv2',
        launcherId: 'pxp.sidecar.native-process',
        hostLabel: 'SidecarCapabilityDemo',
      },
    });

    const startPromise = session.start();
    harness.emit(createSidecarRuntimeHello());
    await flushMessages();
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.init.ack',
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId: 'sidecar-instance-1',
    });
    await flushMessages();
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.activate.ack',
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId: 'sidecar-instance-1',
    });
    await startPromise;

    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.error',
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId: 'sidecar-instance-1',
      fatal: true,
      message: 'sidecar crashed',
    });
    await flushMessages();

    const crashReceived = telemetry.calls.find(
      (entry) => entry.event === 'plugin.runtime.control.error.received'
    );
    const forcedTeardownStart = telemetry.calls.find(
      (entry) => entry.event === 'plugin.governance.control.forced-teardown.start'
    );
    const forcedTeardownCompleted = telemetry.calls.find(
      (entry) => entry.event === 'plugin.governance.control.forced-teardown.completed'
    );

    expect(crashReceived).toMatchObject({
      level: 'debug',
      traceId: expect.any(String),
      fields: expect.objectContaining({
        channel: 'control',
        pluginId: 'sidecar-plugin',
        runtimeInstanceId: 'sidecar-instance-1',
        protocolOp: 'runtime.error',
        status: 'crashed',
      }),
    });
    expect(forcedTeardownStart).toMatchObject({
      level: 'debug',
      traceId: crashReceived?.traceId,
      spanId: expect.any(String),
      fields: expect.objectContaining({
        channel: 'control',
        pluginId: 'sidecar-plugin',
        protocolOp: 'runtime.cleanup.forced',
        failureKind: 'crash',
        reason: 'runtime-crash:sidecar crashed',
        status: 'start',
      }),
    });
    expect(forcedTeardownCompleted).toMatchObject({
      level: 'debug',
      traceId: crashReceived?.traceId,
      spanId: forcedTeardownStart?.spanId,
      fields: expect.objectContaining({
        channel: 'control',
        pluginId: 'sidecar-plugin',
        protocolOp: 'runtime.cleanup.forced',
        failureKind: 'crash',
        reason: 'runtime-crash:sidecar crashed',
        state: 'crashed',
        status: 'forced-teardown',
      }),
    });
    expect(forcedTeardownCompleted?.fields?.durationMs).toEqual(expect.any(Number));
  });

  it('notifies onRuntimeCrash when a started sidecar session reports a fatal runtime error', async () => {
    const api = createStubApi();
    const harness = createPortHarness();
    const onRuntimeCrash = vi.fn();
    const session = createRuntimeBridgeHostSession({
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId: 'sidecar-instance-1',
      runtimeKind: 'sidecar',
      carrier: 'native-process',
      api,
      permissions: new Set(['api:host']),
      port: harness.port,
      runtimeInit: createSidecarRuntimeInit(),
      runtimeActivate: createSidecarRuntimeActivate(),
      onRuntimeCrash,
    });

    const startPromise = session.start();
    harness.emit(createSidecarRuntimeHello());
    await flushMessages();
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.init.ack',
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId: 'sidecar-instance-1',
    });
    await flushMessages();
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.activate.ack',
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId: 'sidecar-instance-1',
    });
    await startPromise;

    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.error',
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId: 'sidecar-instance-1',
      fatal: true,
      message: 'sidecar crashed',
    });
    await flushMessages();

    expect(onRuntimeCrash).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'sidecar crashed',
      })
    );
  });

  it('accepts a buffered runtime.hello flushed immediately on subscription', async () => {
    const api = createStubApi();
    const harness = createPortHarness([createRuntimeHello()]);
    const session = createRuntimeBridgeHostSession({
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
      runtimeKind: 'extension-host',
      carrier: 'dedicated-worker',
      api,
      permissions: new Set(['api:audio-state']),
      port: harness.port,
      runtimeInit: createRuntimeInit(),
      runtimeActivate: createRuntimeActivate(),
    });

    const startPromise = session.start();
    await flushMessages();
    expect(harness.sent[0]).toMatchObject({ op: 'runtime.init' });

    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.init.ack',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
    });
    await flushMessages();
    expect(harness.sent[1]).toMatchObject({ op: 'runtime.activate' });

    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.activate.ack',
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
    });

    await expect(startPromise).resolves.toBeUndefined();
    expect(session.getState()).toBe('active');
  });

  it('handles sidecar handshake and capability invocation over the native-process carrier', async () => {
    const api = createStubApi();
    const harness = createPortHarness();
    const session = createRuntimeBridgeHostSession({
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId: 'sidecar-instance-1',
      runtimeKind: 'sidecar',
      carrier: 'native-process',
      api,
      permissions: new Set(['api:host']),
      port: harness.port,
      runtimeInit: createSidecarRuntimeInit({
        grantedCapabilities: [
          {
            capabilityId: 'core.capability-registry',
            version: '1.1.0',
            mode: 'required',
          },
        ],
      }),
      runtimeActivate: createSidecarRuntimeActivate({
        cause: 'capability',
        payload: { reason: 'smoke-test' },
      }),
    });

    const startPromise = session.start();
    harness.emit(createSidecarRuntimeHello());
    await flushMessages();
    expect(harness.sent[0]).toMatchObject({
      op: 'runtime.init',
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId: 'sidecar-instance-1',
      grantedCapabilities: [
        {
          capabilityId: 'core.capability-registry',
          version: '1.1.0',
          mode: 'required',
        },
      ],
    });

    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.init.ack',
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId: 'sidecar-instance-1',
    });
    await flushMessages();
    expect(harness.sent[1]).toMatchObject({
      op: 'runtime.activate',
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId: 'sidecar-instance-1',
      cause: 'capability',
    });

    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.activate.ack',
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId: 'sidecar-instance-1',
    });
    await startPromise;

    harness.emit({
      protocolVersion: '1.0',
      op: 'capability.invoke.request',
      requestId: 'cap-sidecar-1',
      capabilityId: 'core.capability-registry',
      method: 'list',
    });
    await flushMessages();

    expect(harness.sent.at(-1)).toMatchObject({
      op: 'capability.invoke.response',
      requestId: 'cap-sidecar-1',
      ok: true,
      data: [{ id: 'host.pmp.navigation', version: '1.0.0' }],
    });
    expect(api.host.listCapabilities).toHaveBeenCalledTimes(1);
  });

  it('cleans up tracked sidecar runtime resources after a fatal crash', async () => {
    const controller = createStreamController();
    const api = createStubApi({ streamHandle: controller.handle });
    const harness = createPortHarness();
    const runtimeResources = createRuntimeResourceRegistry();
    const session = createRuntimeBridgeHostSession({
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId: 'sidecar-instance-1',
      runtimeKind: 'sidecar',
      carrier: 'native-process',
      api,
      permissions: new Set(['api:host', 'api:host-capability', 'api:audio-visual']),
      port: harness.port,
      runtimeInit: createSidecarRuntimeInit(),
      runtimeActivate: createSidecarRuntimeActivate(),
      runtimeResources,
    });

    const startPromise = session.start();
    harness.emit(createSidecarRuntimeHello());
    await flushMessages();
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.init.ack',
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId: 'sidecar-instance-1',
    });
    await flushMessages();
    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.activate.ack',
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId: 'sidecar-instance-1',
    });
    await startPromise;

    harness.emit({
      protocolVersion: '1.0',
      op: 'stream.open.request',
      requestId: 'sidecar-stream-1',
      capabilityId: 'host.pmp.audio-engine.analysis',
      method: 'openSpectrumFrameStream',
      payload: { tap: 'post-dsp', intervalMs: 32 },
    });
    await flushMessages();

    expect(harness.sent.at(-1)).toMatchObject({
      op: 'stream.open.response',
      requestId: 'sidecar-stream-1',
      ok: true,
      streamId: 'analysis-stream-1',
    });

    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.error',
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId: 'sidecar-instance-1',
      fatal: true,
      message: 'sidecar crashed',
    });
    await flushMessages();

    expect(session.getState()).toBe('crashed');
    expect(controller.handle.dispose).toHaveBeenCalledWith('runtime-crash:sidecar crashed');
  });
});
