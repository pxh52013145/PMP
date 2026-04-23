import type {
  CapabilityRevoke,
  CapabilityRevokeAck,
  CapabilityProtocolMessage,
  RuntimeActivate,
  RuntimeEvent,
  RuntimeBridgeMessage,
  RuntimeCarrier,
  RuntimeHealthRequest,
  RuntimeHealthResponse,
  RuntimeHello,
  RuntimeInit,
  RuntimeState,
} from '@pixel-matrix/plugin-platform-contracts';
import type { PluginMountApi } from '../pluginHostApi';
import {
  dispatchSandboxCapabilityProtocolRequest,
  type SandboxCapabilityProtocolRequestMessage,
} from './sandboxCapabilityTransport';
import {
  createRuntimeResourceRegistry,
  type RuntimeResourceRegistry,
} from './runtimeResourceRegistry';
import {
  completePluginGovernanceCleanup,
  completePluginGovernanceRevoke,
  completePluginRuntimeActivate,
  failPluginGovernanceCleanup,
  failPluginGovernanceRevoke,
  createPluginRuntimeTelemetryContext,
  startPluginGovernanceCleanup,
  startPluginGovernanceRevoke,
  timeoutPluginGovernanceRevoke,
  failPluginRuntimeActivate,
  startPluginRuntimeActivate,
  type PluginLifecycleSourceKind,
  type PluginLifecycleTelemetryContext,
  type PluginLifecycleTelemetryHandle,
} from '../pluginLifecycleTelemetry';
import {
  completeRuntimeProtocolSpan,
  createRuntimeProtocolTraceContext,
  failRuntimeProtocolSpan,
  startRuntimeProtocolSpan,
  traceRuntimeProtocolStep,
  type RuntimeProtocolTraceContext,
} from './runtimeProtocolTracer';

export type RuntimeBridgeTransportMessage = RuntimeBridgeMessage | CapabilityProtocolMessage;

export interface RuntimeBridgePort {
  postMessage: (message: RuntimeBridgeTransportMessage) => void | Promise<void>;
  onMessage: (listener: (message: RuntimeBridgeTransportMessage) => void) => () => void;
}

export interface RuntimeBridgeHostSessionOptions {
  pluginId: string;
  runtimeId: string;
  runtimeInstanceId: string;
  runtimeKind: RuntimeHello['runtimeKind'];
  carrier: RuntimeCarrier;
  api: PluginMountApi;
  permissions: ReadonlySet<string>;
  port: RuntimeBridgePort;
  runtimeInit: RuntimeInit;
  runtimeActivate: RuntimeActivate;
  runtimeResources?: RuntimeResourceRegistry;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  onRuntimeEvent?: (message: RuntimeEvent) => void | Promise<void>;
  onRuntimeCrash?: (error: Error) => void | Promise<void>;
  telemetry?: {
    sourceKind: PluginLifecycleSourceKind;
    launcherId?: string | null;
    hostLabel?: string | null;
  };
}

export interface RuntimeBridgeEventDispatchOptions {
  requestId?: string;
  traceId?: string;
  sequence?: number;
  emittedAt?: number;
}

export interface RuntimeBridgeHostSession {
  start: () => Promise<void>;
  requestHealth: () => Promise<RuntimeHealthResponse>;
  revokeCapabilities: (
    capabilityIds?: string[],
    reason?: string,
    options?: { requestId?: string; timeoutMs?: number; traceId?: string }
  ) => Promise<void>;
  emitRuntimeEvent: (
    eventName: string,
    payload?: unknown,
    options?: RuntimeBridgeEventDispatchOptions
  ) => Promise<void>;
  dispose: (reason?: string) => Promise<void>;
  getState: () => RuntimeState;
}

type PendingResolver<T> = {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type PendingRuntimeEvent = {
  message: RuntimeEvent;
  resolve: () => void;
  reject: (error: Error) => void;
};

type RevokeRequestOptions = {
  requestId?: string;
  timeoutMs?: number;
  traceId?: string;
};

const DEFAULT_STARTUP_TIMEOUT_MS = 3_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function supportsCapabilityRevoke(runtimeKind: RuntimeHello['runtimeKind'], carrier: RuntimeCarrier): boolean {
  if (carrier === 'native-process') {
    return false;
  }
  if (runtimeKind === 'sidecar') {
    return false;
  }
  return carrier === 'dedicated-worker' || carrier === 'webview-frame';
}

function normalizeCapabilityIds(
  capabilityIds: string[] | undefined,
  runtimeInit: RuntimeInit
): string[] {
  const explicit = Array.isArray(capabilityIds) ? capabilityIds : null;
  const source =
    explicit && explicit.length > 0
      ? explicit
      : runtimeInit.grantedCapabilities.map((capability) => capability.capabilityId);

  return Array.from(
    new Set(
      source
        .filter((capabilityId): capabilityId is string => typeof capabilityId === 'string')
        .map((capabilityId) => capabilityId.trim())
        .filter((capabilityId) => capabilityId.length > 0)
    )
  ).sort((left, right) => left.localeCompare(right));
}

function isRuntimeMessage(message: RuntimeBridgeTransportMessage): message is RuntimeBridgeMessage {
  return typeof message.op === 'string' && message.op.startsWith('runtime.');
}

function isCapabilityRequestMessage(
  message: RuntimeBridgeTransportMessage
): message is SandboxCapabilityProtocolRequestMessage {
  switch (message.op) {
    case 'capability.invoke.request':
    case 'session.open.request':
    case 'session.close.request':
    case 'stream.open.request':
    case 'cancel.request':
    case 'dispose.request':
      return true;
    default:
      return false;
  }
}

function assertMatchingRuntimeIdentity(
  message: RuntimeBridgeMessage,
  options: Pick<
    RuntimeBridgeHostSessionOptions,
    'pluginId' | 'runtimeId' | 'runtimeInstanceId' | 'runtimeKind' | 'carrier'
  >
): void {
  if (message.pluginId !== options.pluginId) {
    throw new Error(
      `Runtime bridge plugin mismatch: expected ${options.pluginId}, received ${message.pluginId}`
    );
  }
  if (message.runtimeId !== options.runtimeId) {
    throw new Error(
      `Runtime bridge runtime mismatch: expected ${options.runtimeId}, received ${message.runtimeId}`
    );
  }
  if (message.runtimeInstanceId !== options.runtimeInstanceId) {
    throw new Error(
      `Runtime bridge instance mismatch: expected ${options.runtimeInstanceId}, received ${message.runtimeInstanceId}`
    );
  }
  if (message.op !== 'runtime.hello') {
    return;
  }
  if (message.runtimeKind !== options.runtimeKind) {
    throw new Error(
      `Runtime bridge kind mismatch: expected ${options.runtimeKind}, received ${message.runtimeKind}`
    );
  }
  if (message.carrier !== options.carrier) {
    throw new Error(
      `Runtime bridge carrier mismatch: expected ${options.carrier}, received ${message.carrier}`
    );
  }
}

export function createRuntimeBridgeHostSession(
  options: RuntimeBridgeHostSessionOptions
): RuntimeBridgeHostSession {
  const runtimeResources = options.runtimeResources ?? createRuntimeResourceRegistry();
  const startupTimeoutMs = Math.max(1, Math.floor(options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS));
  const requestTimeoutMs = Math.max(1, Math.floor(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS));
  const runtimeTelemetryContext: PluginLifecycleTelemetryContext | null = options.telemetry
    ? createPluginRuntimeTelemetryContext({
        pluginId: options.pluginId,
        sourceKind: options.telemetry.sourceKind,
        hostLabel: options.telemetry.hostLabel,
        launcherId: options.telemetry.launcherId,
        runtimeId: options.runtimeId,
        runtimeInstanceId: options.runtimeInstanceId,
        runtimeKind: options.runtimeKind,
        carrier: options.carrier,
        runtimeActivate: options.runtimeActivate,
      })
    : null;
  const traceContext: RuntimeProtocolTraceContext | null = options.telemetry
    ? createRuntimeProtocolTraceContext({
        pluginId: options.pluginId,
        runtimeId: options.runtimeId,
        runtimeInstanceId: options.runtimeInstanceId,
        runtimeKind: options.runtimeKind,
        carrier: options.carrier,
        sourceKind: options.telemetry.sourceKind,
        hostLabel: options.telemetry.hostLabel,
        launcherId: options.telemetry.launcherId,
      })
    : null;

  let state: RuntimeState = 'resolved';
  let disposed = false;
  let unsubscribe: (() => void) | null = null;
  let startPromise: Promise<void> | null = null;
  let activationTelemetry: PluginLifecycleTelemetryHandle | null = null;
  let helloPending: PendingResolver<RuntimeHello> | null = null;
  let initAckPending: PendingResolver<void> | null = null;
  let activateAckPending: PendingResolver<void> | null = null;
  const healthPending = new Map<string, PendingResolver<RuntimeHealthResponse>>();
  const revokePending = new Map<string, PendingResolver<CapabilityRevokeAck>>();
  const pendingRuntimeEvents: PendingRuntimeEvent[] = [];

  const clearPending = <T>(pending: PendingResolver<T> | null): void => {
    if (!pending) return;
    clearTimeout(pending.timer);
  };

  const failPending = <T>(pending: PendingResolver<T> | null, error: Error): void => {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.reject(error);
  };

  const sendMessage = async (message: RuntimeBridgeTransportMessage): Promise<void> => {
    await Promise.resolve(options.port.postMessage(message));
  };

  const traceStep = (
    event: string,
    options: {
      traceId?: string;
      spanId?: string;
      direction?: 'host->runtime' | 'runtime->host' | 'host';
      requestId?: string | null;
      protocolOp?: string | null;
      status?: string | null;
      extraFields?: Record<string, unknown>;
    } = {}
  ): void => {
    if (!traceContext) return;
    traceRuntimeProtocolStep(traceContext, event, options);
  };

  const traceEnvelope = (
    event: string,
    message: { op: string; requestId?: string; traceId?: string },
    direction: 'host->runtime' | 'runtime->host',
    extraFields?: Record<string, unknown>
  ): void => {
    traceStep(event, {
      direction,
      requestId: message.requestId ?? null,
      traceId: message.traceId,
      protocolOp: message.op,
      extraFields,
    });
  };

  const buildRuntimeEnvelope = <T extends RuntimeBridgeMessage>(
    message: T,
    overrides: Partial<Pick<RuntimeBridgeMessage, 'requestId' | 'traceId'>> = {}
  ): T => {
    return {
      ...message,
      requestId: overrides.requestId ?? message.requestId,
      traceId: overrides.traceId ?? message.traceId,
    };
  };

  const flushRuntimeEvents = async (): Promise<void> => {
    if (pendingRuntimeEvents.length === 0) {
      return;
    }

    const queued = pendingRuntimeEvents.splice(0, pendingRuntimeEvents.length);
    for (const pendingEvent of queued) {
      try {
        await sendMessage(pendingEvent.message);
        pendingEvent.resolve();
      } catch (error) {
        const runtimeError = asError(error);
        pendingEvent.reject(runtimeError);
        throw runtimeError;
      }
    }
  };

  const rejectQueuedRuntimeEvents = (error: Error): void => {
    const queued = pendingRuntimeEvents.splice(0, pendingRuntimeEvents.length);
    for (const pendingEvent of queued) {
      pendingEvent.reject(error);
    }
  };

  const createPending = <T>(
    label: string,
    timeoutMs: number
  ): { pending: PendingResolver<T>; promise: Promise<T> } => {
    let resolvePromise!: (value: T) => void;
    let rejectPromise!: (error: Error) => void;

    const promise = new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const timer = setTimeout(() => {
      rejectPromise(new Error(`Runtime bridge timeout waiting for ${label}`));
    }, timeoutMs);

    return {
      pending: {
        resolve: (value) => {
          clearTimeout(timer);
          resolvePromise(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectPromise(error);
        },
        timer,
      },
      promise,
    };
  };

  const rejectAllPending = (error: Error): void => {
    failPending(helloPending, error);
    failPending(initAckPending, error);
    failPending(activateAckPending, error);
    helloPending = null;
    initAckPending = null;
    activateAckPending = null;

    for (const pending of healthPending.values()) {
      failPending(pending, error);
    }
    healthPending.clear();
    for (const pending of revokePending.values()) {
      failPending(pending, error);
    }
    revokePending.clear();
    rejectQueuedRuntimeEvents(error);
  };

  const handleCrash = (error: Error): void => {
    if (disposed) return;
    state = error.message.includes('timeout') ? 'quarantined' : 'crashed';
    const cleanupReason = `runtime-crash:${error.message}`;
    const forcedTeardownTrace = traceContext
      ? startRuntimeProtocolSpan(traceContext, 'plugin.governance.control.forced-teardown', {
          direction: 'host',
          protocolOp: 'runtime.cleanup.forced',
          extraFields: {
            failureKind: state === 'quarantined' ? 'unresponsive' : 'crash',
            reason: cleanupReason,
          },
        })
      : null;
    traceStep('plugin.runtime.control.error.received', {
      direction: 'runtime->host',
      protocolOp: 'runtime.error',
      status: state,
      extraFields: {
        message: error.message,
      },
    });
    rejectAllPending(error);
    try {
      const crashResult = options.onRuntimeCrash?.(error);
      if (crashResult && typeof (crashResult as Promise<void>).then === 'function') {
        void (crashResult as Promise<void>).catch(() => undefined);
      }
    } catch {
      // Crash handlers are best-effort and must not block teardown.
    }
    const currentUnsubscribe = unsubscribe;
    unsubscribe = null;
    try {
      currentUnsubscribe?.();
    } finally {
      void runtimeResources
        .cleanup(cleanupReason)
        .then(() => {
          if (!forcedTeardownTrace) return;
          completeRuntimeProtocolSpan(forcedTeardownTrace, {
            direction: 'host',
            protocolOp: 'runtime.cleanup.forced',
            status: 'forced-teardown',
            extraFields: {
              failureKind: state === 'quarantined' ? 'unresponsive' : 'crash',
              reason: cleanupReason,
              state,
            },
          });
        })
        .catch((cleanupError) => {
          if (!forcedTeardownTrace) return;
          failRuntimeProtocolSpan(forcedTeardownTrace, {
            direction: 'host',
            protocolOp: 'runtime.cleanup.forced',
            extraFields: {
              failureKind: state === 'quarantined' ? 'unresponsive' : 'crash',
              reason: cleanupReason,
              state,
              message: readErrorMessage(cleanupError),
            },
          });
        });
    }
  };

  const handleRuntimeMessage = async (message: RuntimeBridgeMessage): Promise<void> => {
    assertMatchingRuntimeIdentity(message, options);

    switch (message.op) {
      case 'runtime.hello':
        traceEnvelope('plugin.runtime.control.hello.received', message, 'runtime->host');
        if (!helloPending) {
          throw new Error('Received runtime.hello without an active startup handshake');
        }
        helloPending.resolve(message);
        helloPending = null;
        return;
      case 'runtime.init.ack':
        if (!initAckPending) {
          throw new Error('Received runtime.init.ack without a pending init');
        }
        initAckPending.resolve();
        initAckPending = null;
        return;
      case 'runtime.activate.ack':
        if (!activateAckPending) {
          throw new Error('Received runtime.activate.ack without a pending activate');
        }
        activateAckPending.resolve();
        activateAckPending = null;
        return;
      case 'runtime.health.response': {
        traceEnvelope('plugin.runtime.control.health.responded', message, 'runtime->host', {
          ready: message.ready,
          healthStatus: message.status,
        });
        const requestId = message.requestId;
        if (!requestId) {
          throw new Error('runtime.health.response is missing requestId');
        }
        const pending = healthPending.get(requestId);
        if (!pending) {
          throw new Error(`Received unexpected runtime.health.response: ${requestId}`);
        }
        healthPending.delete(requestId);
        pending.resolve(message);
        return;
      }
      case 'runtime.capabilities.revoke.ack': {
        traceEnvelope('plugin.governance.control.revoke.ack', message, 'runtime->host', {
          ok: message.ok,
          ignored: message.ignored ?? null,
          reason: message.reason ?? null,
        });
        const requestId = message.requestId;
        if (!requestId) {
          throw new Error('runtime.capabilities.revoke.ack is missing requestId');
        }
        const pending = revokePending.get(requestId);
        if (!pending) {
          traceStep('plugin.governance.control.revoke.ack.ignored', {
            direction: 'runtime->host',
            requestId,
            traceId: message.traceId,
            protocolOp: message.op,
            status: 'ignored',
            extraFields: {
              ok: message.ok,
              ignored: message.ignored ?? null,
              reason: message.reason ?? null,
              state,
            },
          });
          return;
        }
        revokePending.delete(requestId);
        pending.resolve(message);
        return;
      }
      case 'runtime.error':
        if (message.fatal) {
          throw new Error(message.message);
        }
        return;
      case 'runtime.event':
        traceEnvelope('plugin.runtime.control.event.received', message, 'runtime->host', {
          eventName: message.eventName,
          sequence: message.sequence ?? null,
        });
        await Promise.resolve(options.onRuntimeEvent?.(message));
        return;
      default:
        return;
    }
  };

  const handleCapabilityRequest = async (
    message: SandboxCapabilityProtocolRequestMessage
  ): Promise<void> => {
    const capabilityTrace = traceContext
      ? startRuntimeProtocolSpan(traceContext, `plugin.capability.protocol.${message.op.replace(/\./g, '-')}`, {
          traceId: message.traceId,
          requestId: message.requestId,
          direction: 'runtime->host',
          protocolOp: message.op,
          extraFields: {
            capabilityId: 'capabilityId' in message ? message.capabilityId ?? null : null,
            method: 'method' in message ? message.method ?? null : null,
          },
        })
      : null;
    const response = await dispatchSandboxCapabilityProtocolRequest(
      options.api,
      options.permissions,
      message,
      {
        runtimeResources,
        emitProtocolMessage: (nextMessage) => {
          void sendMessage(nextMessage);
        },
        protocolTraceContext: traceContext,
      }
    );

    if (response) {
      if (capabilityTrace) {
        completeRuntimeProtocolSpan(capabilityTrace, {
          direction: 'host->runtime',
          requestId: response.requestId ?? message.requestId,
          protocolOp: response.op,
          status: 'completed',
          extraFields: {
            ok: 'ok' in response ? response.ok : null,
          },
        });
      }
      await sendMessage(response);
      traceEnvelope(
        `plugin.capability.protocol.${response.op.replace(/\./g, '-')}.sent`,
        {
          op: response.op,
          requestId: response.requestId,
          traceId: 'traceId' in response ? response.traceId : undefined,
        },
        'host->runtime',
        {
          ok: 'ok' in response ? response.ok : null,
        }
      );
      return;
    }

    if (capabilityTrace) {
      completeRuntimeProtocolSpan(capabilityTrace, {
        direction: 'host',
        requestId: message.requestId,
        protocolOp: message.op,
      });
    }
  };

  const onMessage = (message: RuntimeBridgeTransportMessage) => {
    if (disposed) return;

    void (async () => {
      if (isRuntimeMessage(message)) {
        await handleRuntimeMessage(message);
        return;
      }

      if (isCapabilityRequestMessage(message)) {
        await handleCapabilityRequest(message);
      }
    })().catch((error) => {
      handleCrash(asError(error));
    });
  };

  const ensureSubscribed = (): void => {
    if (unsubscribe) return;
    unsubscribe = options.port.onMessage(onMessage);
  };

  return {
    start: async () => {
      if (disposed) {
        throw new Error('Runtime bridge session is disposed');
      }
      if (state === 'active') return;
      if (startPromise) return await startPromise;

      state = 'spawning';
      const startupTrace = traceContext
        ? startRuntimeProtocolSpan(traceContext, 'plugin.runtime.control.startup', {
            direction: 'host',
            protocolOp: 'runtime.start',
            extraFields: {
              startupTimeoutMs,
              requestTimeoutMs,
            },
          })
        : null;
      activationTelemetry = runtimeTelemetryContext
        ? startPluginRuntimeActivate(runtimeTelemetryContext, {
            extraFields: {
              startupTimeoutMs,
              requestTimeoutMs,
            },
          })
        : null;

      startPromise = (async () => {
        const helloState = createPending<RuntimeHello>('runtime.hello', startupTimeoutMs);
        helloPending = helloState.pending;
        ensureSubscribed();
        await helloState.promise;

        state = 'ready';
        const initState = createPending<void>('runtime.init.ack', startupTimeoutMs);
        initAckPending = initState.pending;
        const runtimeInitEnvelope = buildRuntimeEnvelope(options.runtimeInit, {
          traceId: traceContext?.sessionTraceId,
        });
        traceEnvelope('plugin.runtime.control.init.sent', runtimeInitEnvelope, 'host->runtime');
        await sendMessage(runtimeInitEnvelope);
        await initState.promise;
        traceStep('plugin.runtime.control.init.ack', {
          direction: 'runtime->host',
          protocolOp: 'runtime.init.ack',
          status: 'completed',
        });

        state = 'initialized';
        const activateState = createPending<void>('runtime.activate.ack', startupTimeoutMs);
        activateAckPending = activateState.pending;
        const runtimeActivateEnvelope = buildRuntimeEnvelope(options.runtimeActivate, {
          traceId: traceContext?.sessionTraceId,
        });
        traceEnvelope('plugin.runtime.control.activate.sent', runtimeActivateEnvelope, 'host->runtime');
        await sendMessage(runtimeActivateEnvelope);
        await activateState.promise;
        traceStep('plugin.runtime.control.activate.ack', {
          direction: 'runtime->host',
          protocolOp: 'runtime.activate.ack',
          status: 'completed',
        });

        state = 'active';
        await flushRuntimeEvents();
      })();

      try {
        await startPromise;
        if (startupTrace) {
          completeRuntimeProtocolSpan(startupTrace, {
            direction: 'host',
            protocolOp: 'runtime.start',
            status: state,
          });
        }
        if (activationTelemetry) {
          completePluginRuntimeActivate(activationTelemetry, {
            extraFields: {
              startupTimeoutMs,
              requestTimeoutMs,
              state,
            },
          });
        }
      } catch (error) {
        startPromise = null;
        if (startupTrace) {
          failRuntimeProtocolSpan(startupTrace, {
            direction: 'host',
            protocolOp: 'runtime.start',
            extraFields: {
              state,
              message: readErrorMessage(error),
            },
          });
        }
        if (activationTelemetry) {
          failPluginRuntimeActivate(activationTelemetry, error, {
            extraFields: {
              startupTimeoutMs,
              requestTimeoutMs,
              state,
            },
          });
        }
        throw error;
      } finally {
        activationTelemetry = null;
      }
    },
    requestHealth: async () => {
      if (disposed) {
        throw new Error('Runtime bridge session is disposed');
      }
      if (state === 'resolved' || state === 'spawning') {
        throw new Error(`Runtime bridge session is not active: ${state}`);
      }

      const requestId = `runtime-health:${options.runtimeInstanceId}:${Date.now()}:${Math.random()
        .toString(16)
        .slice(2)}`;
      const traceId = traceContext?.sessionTraceId;
      const healthTrace = traceContext
        ? startRuntimeProtocolSpan(traceContext, 'plugin.runtime.control.health', {
            traceId,
            requestId,
            direction: 'host->runtime',
            protocolOp: 'runtime.health.request',
          })
        : null;
      const pendingState = createPending<RuntimeHealthResponse>('runtime.health.response', requestTimeoutMs);
      healthPending.set(requestId, pendingState.pending);

      const request: RuntimeHealthRequest = {
        bridgeVersion: options.runtimeInit.bridgeVersion,
        op: 'runtime.health.request',
        pluginId: options.pluginId,
        runtimeId: options.runtimeId,
        runtimeInstanceId: options.runtimeInstanceId,
        requestId,
        traceId,
      };

      try {
        traceEnvelope('plugin.runtime.control.health.requested', request, 'host->runtime');
        await sendMessage(request);
        const response = await pendingState.promise;
        if (healthTrace) {
          completeRuntimeProtocolSpan(healthTrace, {
            direction: 'runtime->host',
            requestId,
            protocolOp: response.op,
            status: response.status,
            extraFields: {
              ready: response.ready,
            },
          });
        }
        return response;
      } catch (error) {
        if (healthTrace) {
          failRuntimeProtocolSpan(healthTrace, {
            eventSuffix: readErrorMessage(error).includes('timeout') ? 'timeout' : 'failed',
            direction: 'host',
            requestId,
            protocolOp: 'runtime.health.request',
            extraFields: {
              message: readErrorMessage(error),
            },
          });
        }
        throw error;
      } finally {
        const pending = healthPending.get(requestId);
        if (pending === pendingState.pending) {
          clearPending(pending);
          healthPending.delete(requestId);
        }
      }
    },
    revokeCapabilities: async (
      capabilityIds,
      reason = 'runtime-cleanup',
      revokeOptions: RevokeRequestOptions = {}
    ) => {
      if (disposed) {
        throw new Error('Runtime bridge session is disposed');
      }
      if (!supportsCapabilityRevoke(options.runtimeKind, options.carrier)) {
        return;
      }

      const normalizedCapabilityIds = normalizeCapabilityIds(capabilityIds, options.runtimeInit);
      if (normalizedCapabilityIds.length === 0) {
        return;
      }

      const revokeTimeoutMs = Math.max(
        1,
        Math.floor(revokeOptions.timeoutMs ?? requestTimeoutMs)
      );
      const requestId =
        revokeOptions.requestId ??
        `runtime-revoke:${options.runtimeInstanceId}:${Date.now()}:${Math.random()
          .toString(16)
          .slice(2)}`;
      const traceId = revokeOptions.traceId ?? traceContext?.sessionTraceId;
      const revokeTrace = traceContext
        ? startRuntimeProtocolSpan(traceContext, 'plugin.governance.control.revoke', {
            traceId,
            requestId,
            direction: 'host->runtime',
            protocolOp: 'runtime.capabilities.revoke',
            extraFields: {
              capabilityIds: normalizedCapabilityIds,
              reason,
              revokeTimeoutMs,
            },
          })
        : null;
      const revokeTelemetry = runtimeTelemetryContext
        ? startPluginGovernanceRevoke(runtimeTelemetryContext, {
            extraFields: {
              capabilityIds: normalizedCapabilityIds,
              reason,
              requestId,
              revokeTimeoutMs,
            },
          })
        : null;
      const pendingState = createPending<CapabilityRevokeAck>(
        'runtime.capabilities.revoke.ack',
        revokeTimeoutMs
      );
      revokePending.set(requestId, pendingState.pending);
      const request: CapabilityRevoke = {
        bridgeVersion: options.runtimeInit.bridgeVersion,
        op: 'runtime.capabilities.revoke',
        pluginId: options.pluginId,
        runtimeId: options.runtimeId,
        runtimeInstanceId: options.runtimeInstanceId,
        requestId,
        traceId,
        capabilityIds: normalizedCapabilityIds,
        reason,
      };

      try {
        traceEnvelope('plugin.governance.control.revoke.requested', request, 'host->runtime', {
          capabilityIds: normalizedCapabilityIds,
          reason,
        });
        await sendMessage(request);
        const ack = await pendingState.promise;
        if (ack.ok !== true) {
          throw new Error(ack.reason || 'Runtime capability revoke rejected');
        }
        if (revokeTrace) {
          completeRuntimeProtocolSpan(revokeTrace, {
            direction: 'runtime->host',
            requestId,
            protocolOp: ack.op,
            status: ack.ignored ? 'ignored' : 'completed',
            extraFields: {
              ignored: ack.ignored ?? false,
              reason: ack.reason ?? null,
            },
          });
        }
        if (revokeTelemetry) {
          completePluginGovernanceRevoke(revokeTelemetry, {
            extraFields: {
              capabilityIds: normalizedCapabilityIds,
              reason,
              requestId,
              ignored: ack.ignored ?? false,
            },
          });
        }
      } catch (error) {
        const errorMessage = readErrorMessage(error);
        const isTimeout = errorMessage.includes('timeout');
        if (revokeTrace) {
          failRuntimeProtocolSpan(revokeTrace, {
            eventSuffix: isTimeout ? 'timeout' : 'failed',
            direction: 'host',
            requestId,
            protocolOp: 'runtime.capabilities.revoke',
            extraFields: {
              capabilityIds: normalizedCapabilityIds,
              reason,
              message: errorMessage,
            },
          });
        }
        if (revokeTelemetry) {
          if (isTimeout) {
            timeoutPluginGovernanceRevoke(revokeTelemetry, error, {
              extraFields: {
                capabilityIds: normalizedCapabilityIds,
                reason,
                requestId,
                revokeTimeoutMs,
              },
            });
          } else {
            failPluginGovernanceRevoke(revokeTelemetry, error, {
              extraFields: {
                capabilityIds: normalizedCapabilityIds,
                reason,
                requestId,
                revokeTimeoutMs,
              },
            });
          }
        }
        throw error;
      } finally {
        const pending = revokePending.get(requestId);
        if (pending === pendingState.pending) {
          clearPending(pending);
          revokePending.delete(requestId);
        }
      }
    },
    emitRuntimeEvent: async (eventName, payload, dispatchOptions = {}) => {
      if (disposed) {
        throw new Error('Runtime bridge session is disposed');
      }

      const message: RuntimeEvent = {
        bridgeVersion: options.runtimeInit.bridgeVersion,
        op: 'runtime.event',
        pluginId: options.pluginId,
        runtimeId: options.runtimeId,
        runtimeInstanceId: options.runtimeInstanceId,
        eventName,
        payload,
        requestId: dispatchOptions.requestId,
        traceId: dispatchOptions.traceId,
        sequence: dispatchOptions.sequence,
        emittedAt: dispatchOptions.emittedAt ?? Date.now(),
      };
      traceEnvelope('plugin.runtime.control.event.sent', message, 'host->runtime', {
        eventName,
        sequence: message.sequence ?? null,
      });

      if (state === 'active') {
        await sendMessage(message);
        return;
      }

      await new Promise<void>((resolve, reject) => {
        pendingRuntimeEvents.push({
          message,
          resolve,
          reject,
        });
      });
    },
    dispose: async (reason = 'runtime-dispose') => {
      if (disposed) return;
      disposed = true;
      state = 'disposing';
      startPromise = null;
      const cleanupTrace = traceContext
        ? startRuntimeProtocolSpan(traceContext, 'plugin.governance.control.cleanup', {
            direction: 'host',
            protocolOp: 'runtime.dispose',
            extraFields: {
              reason,
            },
          })
        : null;
      const cleanupTelemetry = runtimeTelemetryContext
        ? startPluginGovernanceCleanup(runtimeTelemetryContext, {
            extraFields: {
              reason,
            },
          })
        : null;
      rejectAllPending(new Error(`Runtime bridge session disposed: ${reason}`));

      const currentUnsubscribe = unsubscribe;
      unsubscribe = null;
      try {
        currentUnsubscribe?.();
        await runtimeResources.cleanup(reason);
        state = 'terminated';
        if (cleanupTrace) {
          completeRuntimeProtocolSpan(cleanupTrace, {
            direction: 'host',
            protocolOp: 'runtime.dispose',
            status: state,
            extraFields: {
              reason,
            },
          });
        }
        if (cleanupTelemetry) {
          completePluginGovernanceCleanup(cleanupTelemetry, {
            extraFields: {
              reason,
              state,
            },
          });
        }
      } catch (error) {
        if (cleanupTrace) {
          failRuntimeProtocolSpan(cleanupTrace, {
            direction: 'host',
            protocolOp: 'runtime.dispose',
            extraFields: {
              reason,
              message: readErrorMessage(error),
            },
          });
        }
        if (cleanupTelemetry) {
          failPluginGovernanceCleanup(cleanupTelemetry, error, {
            extraFields: {
              reason,
              state,
            },
          });
        }
        throw error;
      }
    },
    getState: () => state,
  };
}
