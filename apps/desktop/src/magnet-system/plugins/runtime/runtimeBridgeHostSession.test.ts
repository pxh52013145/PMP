import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  RuntimeActivate,
  RuntimeHealthRequest,
  RuntimeHealthResponse,
  RuntimeHello,
  RuntimeInit,
} from '@pixel-matrix/plugin-platform-contracts';
import type { PluginMountApi } from '../host-api';
import { createPmpmCompatRuntimeResourceRegistry } from './pmpmCompatRuntimeResources';
import {
  createRuntimeBridgeHostSession,
  type RuntimeBridgePort,
  type RuntimeBridgeTransportMessage,
} from './runtimeBridgeHostSession';

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

function createPortHarness(): {
  port: RuntimeBridgePort;
  sent: RuntimeBridgeTransportMessage[];
  emit: (message: RuntimeBridgeTransportMessage) => void;
} {
  const listeners = new Set<(message: RuntimeBridgeTransportMessage) => void>();
  const sent: RuntimeBridgeTransportMessage[] = [];

  return {
    port: {
      postMessage: (message) => {
        sent.push(message);
      },
      onMessage: (listener) => {
        listeners.add(listener);
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

async function flushMessages(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
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

  it('forwards stream messages and disposes tracked resources on session shutdown', async () => {
    const controller = createStreamController();
    const api = createStubApi({ streamHandle: controller.handle });
    const harness = createPortHarness();
    const runtimeResources = createPmpmCompatRuntimeResourceRegistry();
    const session = createRuntimeBridgeHostSession({
      pluginId: 'worker-plugin',
      runtimeId: 'worker.main',
      runtimeInstanceId: 'runtime-instance-1',
      runtimeKind: 'extension-host',
      carrier: 'dedicated-worker',
      api,
      permissions: new Set(['api:host', 'api:host-capability', 'api:audio-visual']),
      port: harness.port,
      runtimeInit: createRuntimeInit(),
      runtimeActivate: createRuntimeActivate(),
      runtimeResources,
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
      op: 'stream.open.request',
      requestId: 'stream-open-1',
      capabilityId: 'host.pmp.audio-engine.analysis',
      method: 'openSpectrumFrameStream',
      payload: { tap: 'pre-dsp', intervalMs: 32 },
    });
    await flushMessages();

    expect(harness.sent.at(-1)).toMatchObject({
      op: 'stream.open.response',
      requestId: 'stream-open-1',
      ok: true,
      streamId: 'analysis-stream-1',
    });

    controller.emitData({ tap: 'pre-dsp', bins: [1, 2, 3] }, 0);
    await flushMessages();
    expect(harness.sent.at(-1)).toMatchObject({
      op: 'stream.data',
      requestId: 'stream-open-1',
      streamId: 'analysis-stream-1',
      sequence: 0,
      payload: { tap: 'pre-dsp', bins: [1, 2, 3] },
    });

    await session.dispose('test-cleanup');

    expect(controller.handle.dispose).toHaveBeenCalledWith('test-cleanup');
    expect(session.getState()).toBe('terminated');
  });
});
