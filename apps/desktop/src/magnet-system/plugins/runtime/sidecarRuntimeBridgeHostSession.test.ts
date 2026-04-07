import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CapabilityInvokeRequest,
  RuntimeBridgeMessage,
  RuntimeHello,
} from '@pixel-matrix/plugin-platform-contracts';
import type { PluginMountApi } from '../host-api';
import { createPmpmCompatRuntimeResourceRegistry } from './pmpmCompatRuntimeResources';
import {
  createRuntimeBridgeHostSession,
  type RuntimeBridgePort,
  type RuntimeBridgeTransportMessage,
} from './runtimeBridgeHostSession';

function createStubApi(options: {
  streamHandle?: {
    streamId: string;
    mode: 'push';
    transport: 'inline-json';
    onData: (cb: (payload: unknown, envelope: Record<string, unknown>) => void) => () => void;
    onEnd: (cb: (reason?: string, envelope?: Record<string, unknown>) => void) => () => void;
    cancel: (reason?: string) => Promise<void>;
    dispose: (reason?: string) => Promise<void>;
  } | null;
} = {}): PluginMountApi {
  return {
    host: {
      getInfo: vi.fn(() => null),
      listPermissions: vi.fn(() => []),
      hasPermission: vi.fn(() => false),
      listCapabilities: vi.fn(async () => [
        { id: 'core.capability-registry', version: '1.0.0' },
        { id: 'host.pmp.navigation', version: '1.0.0' },
      ]),
      invokeCapability: vi.fn(async (capabilityId: string, method: string) => {
        if (capabilityId === 'core.capability-registry' && method === 'list') {
          return [
            { id: 'core.capability-registry', version: '1.0.0' },
            { id: 'host.pmp.navigation', version: '1.0.0' },
          ];
        }
        return { ok: true };
      }),
      openStream: vi.fn(async () => options.streamHandle ?? null),
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
      get: vi.fn(() => ({})),
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
    pluginId: 'sidecar-echo-demo',
    runtimeId: 'sidecar.echo',
    runtimeInstanceId: 'sidecar-instance-1',
    supportedBridgeVersions: ['1.0'],
    runtimeKind: 'sidecar',
    carrier: 'native-process',
    supportsViewMount: false,
    supportedDataPlanes: ['inline-json', 'pipe'],
    ...overrides,
  };
}

function createAck(op: 'runtime.init.ack' | 'runtime.activate.ack'): RuntimeBridgeMessage {
  return {
    bridgeVersion: '1.0',
    op,
    pluginId: 'sidecar-echo-demo',
    runtimeId: 'sidecar.echo',
    runtimeInstanceId: 'sidecar-instance-1',
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

describe('sidecar runtime bridge host session', () => {
  it('completes native-process handshake and routes capability invocation', async () => {
    const api = createStubApi();
    const harness = createPortHarness();
    const onRuntimeEvent = vi.fn();
    const session = createRuntimeBridgeHostSession({
      pluginId: 'sidecar-echo-demo',
      runtimeId: 'sidecar.echo',
      runtimeInstanceId: 'sidecar-instance-1',
      runtimeKind: 'sidecar',
      carrier: 'native-process',
      api,
      permissions: new Set(['api:host', 'api:host-capability']),
      port: harness.port,
      runtimeInit: {
        bridgeVersion: '1.0',
        op: 'runtime.init',
        pluginId: 'sidecar-echo-demo',
        runtimeId: 'sidecar.echo',
        runtimeInstanceId: 'sidecar-instance-1',
        hostId: 'pmp',
        trustLevel: 'sandboxed',
        grantedCapabilities: [
          {
            capabilityId: 'core.capability-registry',
            version: '1.0.0',
            mode: 'required',
          },
        ],
      },
      runtimeActivate: {
        bridgeVersion: '1.0',
        op: 'runtime.activate',
        pluginId: 'sidecar-echo-demo',
        runtimeId: 'sidecar.echo',
        runtimeInstanceId: 'sidecar-instance-1',
        cause: 'command',
        payload: { commandId: 'sidecar-echo-demo.run' },
      },
      onRuntimeEvent,
    });

    const startPromise = session.start();
    harness.emit(createRuntimeHello());
    await flushMessages();
    expect(harness.sent[0]).toMatchObject({ op: 'runtime.init' });

    harness.emit(createAck('runtime.init.ack'));
    await flushMessages();
    expect(harness.sent[1]).toMatchObject({ op: 'runtime.activate' });

    harness.emit(createAck('runtime.activate.ack'));
    await startPromise;

    const invokeRequest: CapabilityInvokeRequest = {
      protocolVersion: '1.0',
      op: 'capability.invoke.request',
      requestId: 'sidecar:list-capabilities',
      capabilityId: 'core.capability-registry',
      method: 'list',
    };
    harness.emit(invokeRequest);
    await flushMessages();

    expect(harness.sent.at(-1)).toMatchObject({
      op: 'capability.invoke.response',
      requestId: 'sidecar:list-capabilities',
      ok: true,
      data: [
        { id: 'core.capability-registry', version: '1.0.0' },
        { id: 'host.pmp.navigation', version: '1.0.0' },
      ],
    });

    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.event',
      pluginId: 'sidecar-echo-demo',
      runtimeId: 'sidecar.echo',
      runtimeInstanceId: 'sidecar-instance-1',
      eventName: 'command.result',
      payload: { ok: true, commandId: 'sidecar-echo-demo.run' },
    });
    await flushMessages();

    expect(onRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'runtime.event',
        eventName: 'command.result',
        payload: { ok: true, commandId: 'sidecar-echo-demo.run' },
      })
    );
  });

  it('cleans up tracked resources when the sidecar reports a fatal runtime error', async () => {
    const streamHandle = {
      streamId: 'sidecar-stream-1',
      mode: 'push' as const,
      transport: 'inline-json' as const,
      onData: vi.fn(() => () => {}),
      onEnd: vi.fn(() => () => {}),
      cancel: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    const api = createStubApi({ streamHandle });
    const harness = createPortHarness();
    const runtimeResources = createPmpmCompatRuntimeResourceRegistry();
    const session = createRuntimeBridgeHostSession({
      pluginId: 'sidecar-echo-demo',
      runtimeId: 'sidecar.echo',
      runtimeInstanceId: 'sidecar-instance-1',
      runtimeKind: 'sidecar',
      carrier: 'native-process',
      api,
      permissions: new Set(['api:host', 'api:host-capability', 'api:audio-visual']),
      port: harness.port,
      runtimeInit: {
        bridgeVersion: '1.0',
        op: 'runtime.init',
        pluginId: 'sidecar-echo-demo',
        runtimeId: 'sidecar.echo',
        runtimeInstanceId: 'sidecar-instance-1',
        hostId: 'pmp',
        trustLevel: 'sandboxed',
        grantedCapabilities: [],
      },
      runtimeActivate: {
        bridgeVersion: '1.0',
        op: 'runtime.activate',
        pluginId: 'sidecar-echo-demo',
        runtimeId: 'sidecar.echo',
        runtimeInstanceId: 'sidecar-instance-1',
        cause: 'command',
        payload: { commandId: 'sidecar-echo-demo.crash' },
      },
      runtimeResources,
    });

    const startPromise = session.start();
    harness.emit(createRuntimeHello());
    await flushMessages();
    harness.emit(createAck('runtime.init.ack'));
    await flushMessages();
    harness.emit(createAck('runtime.activate.ack'));
    await startPromise;

    harness.emit({
      protocolVersion: '1.0',
      op: 'stream.open.request',
      requestId: 'sidecar:stream-open',
      capabilityId: 'host.pmp.audio-engine.analysis',
      method: 'openSpectrumFrameStream',
      payload: { tap: 'pre-dsp', intervalMs: 32 },
    });
    await flushMessages();
    expect(harness.sent.at(-1)).toMatchObject({
      op: 'stream.open.response',
      requestId: 'sidecar:stream-open',
      ok: true,
      streamId: 'sidecar-stream-1',
    });

    harness.emit({
      bridgeVersion: '1.0',
      op: 'runtime.error',
      pluginId: 'sidecar-echo-demo',
      runtimeId: 'sidecar.echo',
      runtimeInstanceId: 'sidecar-instance-1',
      fatal: true,
      message: 'sidecar crash after stream open',
    });
    await flushMessages();

    expect(session.getState()).toBe('crashed');

    await session.dispose('runtime-crash');

    expect(streamHandle.dispose).toHaveBeenCalledWith(
      'runtime-crash:sidecar crash after stream open'
    );
    expect(session.getState()).toBe('terminated');
  });
});
