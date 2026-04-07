import type {
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
  dispatchPmpmCapabilityProtocolRequest,
  type PmpmCapabilityProtocolRequestMessage,
} from './pmpmCompatCapabilityTransport';
import {
  createPmpmCompatRuntimeResourceRegistry,
  type PmpmCompatRuntimeResourceRegistry,
} from './pmpmCompatRuntimeResources';

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
  runtimeResources?: PmpmCompatRuntimeResourceRegistry;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  onRuntimeEvent?: (message: RuntimeEvent) => void | Promise<void>;
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

const DEFAULT_STARTUP_TIMEOUT_MS = 3_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isRuntimeMessage(message: RuntimeBridgeTransportMessage): message is RuntimeBridgeMessage {
  return typeof message.op === 'string' && message.op.startsWith('runtime.');
}

function isCapabilityRequestMessage(
  message: RuntimeBridgeTransportMessage
): message is PmpmCapabilityProtocolRequestMessage {
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
  const runtimeResources =
    options.runtimeResources ?? createPmpmCompatRuntimeResourceRegistry();
  const startupTimeoutMs = Math.max(1, Math.floor(options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS));
  const requestTimeoutMs = Math.max(1, Math.floor(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS));

  let state: RuntimeState = 'resolved';
  let disposed = false;
  let unsubscribe: (() => void) | null = null;
  let startPromise: Promise<void> | null = null;
  let helloPending: PendingResolver<RuntimeHello> | null = null;
  let initAckPending: PendingResolver<void> | null = null;
  let activateAckPending: PendingResolver<void> | null = null;
  const healthPending = new Map<string, PendingResolver<RuntimeHealthResponse>>();
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
    rejectQueuedRuntimeEvents(error);
  };

  const handleCrash = (error: Error): void => {
    if (disposed) return;
    state = error.message.includes('timeout') ? 'quarantined' : 'crashed';
    rejectAllPending(error);
    const currentUnsubscribe = unsubscribe;
    unsubscribe = null;
    try {
      currentUnsubscribe?.();
    } finally {
      void runtimeResources.cleanup(`runtime-crash:${error.message}`);
    }
  };

  const handleRuntimeMessage = async (message: RuntimeBridgeMessage): Promise<void> => {
    assertMatchingRuntimeIdentity(message, options);

    switch (message.op) {
      case 'runtime.hello':
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
      case 'runtime.error':
        if (message.fatal) {
          throw new Error(message.message);
        }
        return;
      case 'runtime.event':
        await Promise.resolve(options.onRuntimeEvent?.(message));
        return;
      default:
        return;
    }
  };

  const handleCapabilityRequest = async (
    message: PmpmCapabilityProtocolRequestMessage
  ): Promise<void> => {
    const response = await dispatchPmpmCapabilityProtocolRequest(
      options.api,
      options.permissions,
      message,
      {
        runtimeResources,
        emitProtocolMessage: (nextMessage) => {
          void sendMessage(nextMessage);
        },
      }
    );

    if (response) {
      await sendMessage(response);
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

      ensureSubscribed();
      state = 'spawning';

      startPromise = (async () => {
        const helloState = createPending<RuntimeHello>('runtime.hello', startupTimeoutMs);
        helloPending = helloState.pending;
        await helloState.promise;

        state = 'ready';
        const initState = createPending<void>('runtime.init.ack', startupTimeoutMs);
        initAckPending = initState.pending;
        await sendMessage(options.runtimeInit);
        await initState.promise;

        state = 'initialized';
        const activateState = createPending<void>('runtime.activate.ack', startupTimeoutMs);
        activateAckPending = activateState.pending;
        await sendMessage(options.runtimeActivate);
        await activateState.promise;

        state = 'active';
        await flushRuntimeEvents();
      })();

      try {
        await startPromise;
      } catch (error) {
        startPromise = null;
        throw error;
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
      const pendingState = createPending<RuntimeHealthResponse>('runtime.health.response', requestTimeoutMs);
      healthPending.set(requestId, pendingState.pending);

      const request: RuntimeHealthRequest = {
        bridgeVersion: options.runtimeInit.bridgeVersion,
        op: 'runtime.health.request',
        pluginId: options.pluginId,
        runtimeId: options.runtimeId,
        runtimeInstanceId: options.runtimeInstanceId,
        requestId,
      };

      try {
        await sendMessage(request);
        return await pendingState.promise;
      } finally {
        const pending = healthPending.get(requestId);
        if (pending === pendingState.pending) {
          clearPending(pending);
          healthPending.delete(requestId);
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
      rejectAllPending(new Error(`Runtime bridge session disposed: ${reason}`));

      const currentUnsubscribe = unsubscribe;
      unsubscribe = null;
      try {
        currentUnsubscribe?.();
      } finally {
        await runtimeResources.cleanup(reason);
        state = 'terminated';
      }
    },
    getState: () => state,
  };
}
