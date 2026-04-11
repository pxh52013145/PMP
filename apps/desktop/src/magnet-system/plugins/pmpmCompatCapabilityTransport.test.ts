import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginMountApi } from './host-api';
import {
  decodePmpmCompatCapabilityInvokeRequest,
  dispatchPmpmCompatRpcRequest,
} from './runtime/pmpmCompatCapabilityTransport';
import { createPmpmCompatRuntimeResourceRegistry } from './runtime/pmpmCompatRuntimeResources';
import {
  setGlobalTelemetryService,
  type TelemetryService,
  type TelemetrySnapshot,
} from '../../services/telemetry';
import {
  DEFAULT_TELEMETRY_POLICY,
  type TelemetryRecord,
} from '../../contracts/telemetry';
import { createRuntimeProtocolTraceContext } from './runtime/runtimeProtocolTracer';

type TelemetryCall = {
  level: string;
  event: string;
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
    policy: {
      ...DEFAULT_TELEMETRY_POLICY,
      frontendMinLevel: 'debug',
      backendMinLevel: 'warn',
      retention: {
        ...DEFAULT_TELEMETRY_POLICY.retention,
      },
      modules: {},
    },
    status: {
      enabled: true,
      currentSessionId: 'session-1',
      queuedRecords: 0,
      flushedRecords: 0,
      droppedRecords: 0,
      currentFileBytes: 0,
      currentFilePath: null,
      frontendMinLevel: 'debug',
      backendMinLevel: 'warn',
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

  return {
    calls,
    service: {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      refreshRuntime: async () => snapshot,
      clearSession: async () => {},
      flushNow: async () => {},
      getLogger: () => ({
        log: (level, event, options) => {
          calls.push({
            level,
            event,
            traceId: options?.traceId ?? null,
            spanId: options?.spanId ?? null,
            fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined,
          });
        },
        trace: (event, options) =>
          calls.push({
            level: 'trace',
            event,
            traceId: options?.traceId ?? null,
            spanId: options?.spanId ?? null,
            fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined,
          }),
        debug: (event, options) =>
          calls.push({
            level: 'debug',
            event,
            traceId: options?.traceId ?? null,
            spanId: options?.spanId ?? null,
            fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined,
          }),
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {},
        metric: () => {},
        startSpan: () => ({ end: () => {} }),
      }),
      ingest: () => {},
      destroy: () => {},
    },
  };
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

function createStubApi(options: { streamHandle?: Awaited<ReturnType<typeof createStreamController>>['handle'] } = {}): PluginMountApi {
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

afterEach(() => {
  setGlobalTelemetryService(null);
  vi.clearAllMocks();
});

describe('pmpm compat capability transport', () => {
  it('maps legacy compat RPC methods into capability.invoke requests', () => {
    const decoded = decodePmpmCompatCapabilityInvokeRequest({
      frameId: 'frame-1',
      type: 'pmpm:rpc',
      id: 'rpc-1',
      method: 'audio.playTrackAtIndex',
      args: [3],
    });

    expect(decoded).toMatchObject({
      source: 'legacy',
      legacyMethod: 'audio.playTrackAtIndex',
      request: {
        op: 'capability.invoke.request',
        capabilityId: 'host.pmp.audio-engine.playback',
        method: 'playTrackAtIndex',
        payload: { index: 3 },
      },
    });
  });

  it('returns protocol envelopes for capability.invoke requests', async () => {
    const api = createStubApi();

    const result = await dispatchPmpmCompatRpcRequest(
      api,
      new Set(['api:audio-control']),
      {
        frameId: 'frame-1',
        type: 'pmpm:rpc',
        id: 'rpc-2',
        method: 'capability.invoke.request',
        args: [
          {
            protocolVersion: '1.0',
            op: 'capability.invoke.request',
            requestId: 'cap-1',
            capabilityId: 'host.pmp.audio-engine.playback',
            method: 'play',
          },
        ],
      }
    );

    expect(result).toEqual({
      type: 'pmpm:rpc-result',
      id: 'rpc-2',
      ok: true,
      result: {
        protocolVersion: '1.0',
        op: 'capability.invoke.response',
        requestId: 'cap-1',
        capabilityId: 'host.pmp.audio-engine.playback',
        handleId: undefined,
        pluginId: undefined,
        runtimeId: undefined,
        sessionId: undefined,
        streamId: undefined,
        traceId: undefined,
        ok: true,
        data: { played: true },
      },
    });
    expect(api.audio.play).toHaveBeenCalledTimes(1);
  });

  it('surfaces protocol permission errors without crashing the carrier', async () => {
    const api = createStubApi();

    const result = await dispatchPmpmCompatRpcRequest(
      api,
      new Set<string>(),
      {
        frameId: 'frame-1',
        type: 'pmpm:rpc',
        id: 'rpc-3',
        method: 'capability.invoke.request',
        args: [
          {
            protocolVersion: '1.0',
            op: 'capability.invoke.request',
            requestId: 'cap-2',
            capabilityId: 'host.pmp.audio-engine.playback',
            method: 'play',
          },
        ],
      }
    );

    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({
      op: 'capability.invoke.response',
      ok: false,
      error: {
        code: 'FORBIDDEN',
      },
    });
    expect(api.audio.play).not.toHaveBeenCalled();
  });

  it('keeps legacy compat methods returning raw values', async () => {
    const api = createStubApi();

    const result = await dispatchPmpmCompatRpcRequest(
      api,
      new Set(['api:audio-cover']),
      {
        frameId: 'frame-1',
        type: 'pmpm:rpc',
        id: 'rpc-4',
        method: 'audio.getCover',
        args: [],
      }
    );

    expect(result).toEqual({
      type: 'pmpm:rpc-result',
      id: 'rpc-4',
      ok: true,
      result: { url: 'cover://demo', colors: { accent: '#fff' } },
    });
  });

  it('returns session envelopes for protocol session requests', async () => {
    const api = createStubApi();

    const openResult = await dispatchPmpmCompatRpcRequest(
      api,
      new Set(['api:host', 'api:host-capability', 'api:audio-input-adapter']),
      {
        frameId: 'frame-1',
        type: 'pmpm:rpc',
        id: 'rpc-5',
        method: 'session.open.request',
        args: [
          {
            protocolVersion: '1.0',
            op: 'session.open.request',
            requestId: 'session-open-1',
            capabilityId: 'host.pmp.audio-engine.input',
            method: 'openSession',
            payload: {
              path: 'D:/music/demo.flac',
            },
          },
        ],
      }
    );

    expect(openResult).toEqual({
      type: 'pmpm:rpc-result',
      id: 'rpc-5',
      ok: true,
      result: {
        protocolVersion: '1.0',
        op: 'session.open.response',
        requestId: 'session-open-1',
        capabilityId: 'host.pmp.audio-engine.input',
        handleId: undefined,
        pluginId: undefined,
        runtimeId: undefined,
        sessionId: 'audio-input-session-1',
        streamId: undefined,
        traceId: undefined,
        ok: true,
        providerSessionId: 'provider-session-1',
        metadata: { selectedInputId: 'symphonia' },
      },
    });

    const closeResult = await dispatchPmpmCompatRpcRequest(
      api,
      new Set(['api:host', 'api:host-capability', 'api:audio-input-adapter']),
      {
        frameId: 'frame-1',
        type: 'pmpm:rpc',
        id: 'rpc-6',
        method: 'session.close.request',
        args: [
          {
            protocolVersion: '1.0',
            op: 'session.close.request',
            requestId: 'session-close-1',
            capabilityId: 'host.pmp.audio-engine.input',
            sessionId: 'audio-input-session-1',
            reason: 'done',
          },
        ],
      }
    );

    expect(closeResult).toEqual({
      type: 'pmpm:rpc-result',
      id: 'rpc-6',
      ok: true,
      result: {
        protocolVersion: '1.0',
        op: 'session.close.response',
        requestId: 'session-close-1',
        capabilityId: 'host.pmp.audio-engine.input',
        handleId: undefined,
        pluginId: undefined,
        runtimeId: undefined,
        sessionId: 'audio-input-session-1',
        streamId: undefined,
        traceId: undefined,
        ok: true,
      },
    });

    expect(api.host.openSession).toHaveBeenCalledWith(
      'host.pmp.audio-engine.input',
      'openSession',
      { path: 'D:/music/demo.flac' }
    );
    expect(api.host.closeSession).toHaveBeenCalledWith(
      'host.pmp.audio-engine.input',
      'audio-input-session-1',
      'done'
    );
  });

  it('bridges stream.open / cancel over protocol messages', async () => {
    const controller = createStreamController();
    const api = createStubApi({ streamHandle: controller.handle });
    const runtimeResources = createPmpmCompatRuntimeResourceRegistry();
    const emitted: unknown[] = [];

    const openResult = await dispatchPmpmCompatRpcRequest(
      api,
      new Set(['api:host', 'api:host-capability', 'api:audio-visual']),
      {
        frameId: 'frame-1',
        type: 'pmpm:rpc',
        id: 'rpc-7',
        method: 'stream.open.request',
        args: [
          {
            protocolVersion: '1.0',
            op: 'stream.open.request',
            requestId: 'stream-open-1',
            capabilityId: 'host.pmp.audio-engine.analysis',
            method: 'openSpectrumFrameStream',
            payload: {
              tap: 'pre-dsp',
              intervalMs: 32,
            },
          },
        ],
      },
      {
        runtimeResources,
        emitProtocolMessage: (message) => emitted.push(message),
      }
    );

    expect(openResult).toEqual({
      type: 'pmpm:rpc-result',
      id: 'rpc-7',
      ok: true,
      result: {
        protocolVersion: '1.0',
        op: 'stream.open.response',
        requestId: 'stream-open-1',
        capabilityId: 'host.pmp.audio-engine.analysis',
        handleId: undefined,
        pluginId: undefined,
        runtimeId: undefined,
        sessionId: undefined,
        streamId: 'analysis-stream-1',
        traceId: undefined,
        ok: true,
        mode: 'push',
        transport: 'inline-json',
      },
    });

    controller.emitData({ tap: 'pre-dsp', bins: [1, 2, 3] }, 0);
    expect(emitted).toContainEqual({
      protocolVersion: '1.0',
      op: 'stream.data',
      requestId: 'stream-open-1',
      capabilityId: 'host.pmp.audio-engine.analysis',
      handleId: undefined,
      pluginId: undefined,
      runtimeId: undefined,
      sessionId: undefined,
      streamId: 'analysis-stream-1',
      traceId: undefined,
      sequence: 0,
      payload: { tap: 'pre-dsp', bins: [1, 2, 3] },
      handles: undefined,
    });

    const cancelResult = await dispatchPmpmCompatRpcRequest(
      api,
      new Set(['api:host', 'api:host-capability', 'api:audio-visual']),
      {
        frameId: 'frame-1',
        type: 'pmpm:rpc',
        id: 'rpc-8',
        method: 'cancel.request',
        args: [
          {
            protocolVersion: '1.0',
            op: 'cancel.request',
            requestId: 'stream-cancel-1',
            streamId: 'analysis-stream-1',
            reason: 'done',
          },
        ],
      },
      {
        runtimeResources,
        emitProtocolMessage: (message) => emitted.push(message),
      }
    );

    expect(cancelResult).toEqual({
      type: 'pmpm:rpc-result',
      id: 'rpc-8',
      ok: true,
      result: null,
    });
    expect(controller.handle.cancel).toHaveBeenCalledWith('done');
    expect(emitted).toContainEqual({
      protocolVersion: '1.0',
      op: 'stream.end',
      requestId: 'stream-open-1',
      capabilityId: 'host.pmp.audio-engine.analysis',
      handleId: undefined,
      pluginId: undefined,
      runtimeId: undefined,
      sessionId: undefined,
      streamId: 'analysis-stream-1',
      traceId: undefined,
      reason: 'done',
    });
  });

  it('records data-plane protocol telemetry for stream/open data and cancel cleanup', async () => {
    const telemetry = createTelemetryServiceSpy();
    setGlobalTelemetryService(telemetry.service);
    const controller = createStreamController();
    const api = createStubApi({ streamHandle: controller.handle });
    const runtimeResources = createPmpmCompatRuntimeResourceRegistry();

    const protocolTraceContext = createRuntimeProtocolTraceContext({
      pluginId: 'demo-plugin',
      runtimeId: 'compat.pmpm.main',
      runtimeInstanceId: 'runtime-instance-1',
      runtimeKind: 'extension-host',
      carrier: 'webview-frame',
      sourceKind: 'pmpm',
      hostLabel: 'CompatTransportTest',
      launcherId: 'compat.pmpm.webview-sandbox',
    });

    await dispatchPmpmCompatRpcRequest(
      api,
      new Set(['api:host', 'api:host-capability', 'api:audio-visual']),
      {
        frameId: 'frame-1',
        type: 'pmpm:rpc',
        id: 'rpc-trace-open',
        method: 'stream.open.request',
        args: [
          {
            protocolVersion: '1.0',
            op: 'stream.open.request',
            requestId: 'stream-open-trace',
            capabilityId: 'host.pmp.audio-engine.analysis',
            method: 'openSpectrumFrameStream',
          },
        ],
      },
      {
        runtimeResources,
        emitProtocolMessage: () => {},
        protocolTraceContext,
      }
    );

    controller.emitData({ bins: [1, 2, 3] }, 7);

    await dispatchPmpmCompatRpcRequest(
      api,
      new Set(['api:host', 'api:host-capability', 'api:audio-visual']),
      {
        frameId: 'frame-1',
        type: 'pmpm:rpc',
        id: 'rpc-trace-cancel',
        method: 'cancel.request',
        args: [
          {
            protocolVersion: '1.0',
            op: 'cancel.request',
            requestId: 'stream-cancel-trace',
            streamId: 'analysis-stream-1',
            reason: 'done',
          },
        ],
      },
      {
        runtimeResources,
        emitProtocolMessage: () => {},
        protocolTraceContext,
      }
    );

    expect(telemetry.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'plugin.capability.data.stream-open.responded',
          traceId: protocolTraceContext.sessionTraceId,
          fields: expect.objectContaining({
            channel: 'data',
            protocolOp: 'stream.open.response',
            requestId: 'stream-open-trace',
            streamId: 'analysis-stream-1',
            transport: 'inline-json',
          }),
        }),
        expect.objectContaining({
          event: 'plugin.capability.data.stream-data.sent',
          traceId: protocolTraceContext.sessionTraceId,
          fields: expect.objectContaining({
            channel: 'data',
            protocolOp: 'stream.data',
            requestId: 'stream-open-trace',
            streamId: 'analysis-stream-1',
            sequence: 7,
          }),
        }),
        expect.objectContaining({
          event: 'plugin.capability.data.cancel.requested',
          traceId: protocolTraceContext.sessionTraceId,
          fields: expect.objectContaining({
            channel: 'data',
            protocolOp: 'cancel.request',
            requestId: 'stream-cancel-trace',
            streamId: 'analysis-stream-1',
            reason: 'done',
          }),
        }),
        expect.objectContaining({
          event: 'plugin.capability.data.stream-end.sent',
          traceId: protocolTraceContext.sessionTraceId,
          fields: expect.objectContaining({
            channel: 'data',
            protocolOp: 'stream.end',
            requestId: 'stream-open-trace',
            streamId: 'analysis-stream-1',
            reason: 'done',
          }),
        }),
      ])
    );
  });

  it('supports dispose.request for tracked streams', async () => {
    const controller = createStreamController();
    const api = createStubApi({ streamHandle: controller.handle });
    const runtimeResources = createPmpmCompatRuntimeResourceRegistry();

    await dispatchPmpmCompatRpcRequest(
      api,
      new Set(['api:host', 'api:host-capability', 'api:audio-visual']),
      {
        frameId: 'frame-1',
        type: 'pmpm:rpc',
        id: 'rpc-9',
        method: 'stream.open.request',
        args: [
          {
            protocolVersion: '1.0',
            op: 'stream.open.request',
            requestId: 'stream-open-2',
            capabilityId: 'host.pmp.audio-engine.analysis',
            method: 'openSpectrumFrameStream',
          },
        ],
      },
      {
        runtimeResources,
        emitProtocolMessage: () => {},
      }
    );

    const disposeResult = await dispatchPmpmCompatRpcRequest(
      api,
      new Set(['api:host', 'api:host-capability', 'api:audio-visual']),
      {
        frameId: 'frame-1',
        type: 'pmpm:rpc',
        id: 'rpc-10',
        method: 'dispose.request',
        args: [
          {
            protocolVersion: '1.0',
            op: 'dispose.request',
            requestId: 'stream-dispose-1',
            streamId: 'analysis-stream-1',
            reason: 'cleanup',
          },
        ],
      },
      {
        runtimeResources,
        emitProtocolMessage: () => {},
      }
    );

    expect(disposeResult).toEqual({
      type: 'pmpm:rpc-result',
      id: 'rpc-10',
      ok: true,
      result: null,
    });
    expect(controller.handle.dispose).toHaveBeenCalledWith('cleanup');
  });

  it('cleans up tracked sessions when runtime resources are disposed', async () => {
    const api = createStubApi();
    const runtimeResources = createPmpmCompatRuntimeResourceRegistry();

    await dispatchPmpmCompatRpcRequest(
      api,
      new Set(['api:host', 'api:host-capability', 'api:audio-input-adapter']),
      {
        frameId: 'frame-1',
        type: 'pmpm:rpc',
        id: 'rpc-11',
        method: 'session.open.request',
        args: [
          {
            protocolVersion: '1.0',
            op: 'session.open.request',
            requestId: 'session-open-2',
            capabilityId: 'host.pmp.audio-engine.input',
            method: 'openSession',
            payload: { path: 'D:/music/demo.flac' },
          },
        ],
      },
      {
        runtimeResources,
      }
    );

    await runtimeResources.cleanup('runtime-dispose');

    expect(api.host.closeSession).toHaveBeenCalledWith(
      'host.pmp.audio-engine.input',
      'audio-input-session-1',
      'runtime-dispose'
    );
  });
});
