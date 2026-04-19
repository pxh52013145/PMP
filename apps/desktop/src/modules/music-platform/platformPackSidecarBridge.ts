import { listen } from '@tauri-apps/api/event';
import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';
import { isTauriRuntime } from '../../utils/tauriRuntime';

const SIDECAR_BRIDGE_MESSAGE_EVENT = 'plugin-sidecar-bridge-message';
const READY_TIMEOUT_MS = 10_000;
const INVOKE_TIMEOUT_MS = 30_000;

type SidecarBridgeEventPayload = {
  runtimeInstanceId?: string;
  message?: unknown;
};

type SidecarErrorShape = {
  code?: string;
  message?: string;
  details?: unknown;
};

type SidecarReadyMessage = {
  op: 'ready';
  connectorId?: string;
};

type SidecarInvokeResponseMessage = {
  op: 'response';
  requestId?: string;
  ok?: boolean;
  data?: unknown;
  error?: SidecarErrorShape;
};

type SidecarRuntimeErrorMessage = {
  op: 'runtime.error';
  message?: string;
  details?: unknown;
};

type PlatformPackSidecarChannel = 'auth' | 'api';

type PlatformPackSidecarInvokeRequest = {
  channel: PlatformPackSidecarChannel;
  method: string;
  bindingId?: string;
  instanceId?: string;
  payload?: Record<string, unknown>;
};

type OpenSidecarBridgeResponse = {
  sessionId: string;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readSidecarErrorMessage(error: unknown, fallback = 'Platform pack sidecar request failed'): string {
  const record = asRecord(error);
  const message = normalizeString(record?.message);
  if (message) return message;
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return fallback;
}

export function isExpectedPlatformPackSidecarLifecycleError(error: unknown): boolean {
  const message = readSidecarErrorMessage(error, '').toLowerCase();
  return (
    message.includes('session disposed') ||
    message.includes('session not found') ||
    message.includes('session is closed') ||
    message.includes('session is not ready')
  );
}

function shouldRetryPlatformPackSidecarRequest(error: unknown): boolean {
  return isExpectedPlatformPackSidecarLifecycleError(error);
}

function isReadyMessage(value: unknown): value is SidecarReadyMessage {
  return normalizeString(asRecord(value)?.op) === 'ready';
}

function isInvokeResponseMessage(value: unknown): value is SidecarInvokeResponseMessage {
  return normalizeString(asRecord(value)?.op) === 'response';
}

function isRuntimeErrorMessage(value: unknown): value is SidecarRuntimeErrorMessage {
  return normalizeString(asRecord(value)?.op) === 'runtime.error';
}

class PlatformPackSidecarClient {
  private readonly runtimeInstanceId: string;
  private readonly pluginId: string;
  private readonly runtimeId = 'platform.pack.sidecar';
  private readonly commandId: string;
  private readonly entryPath: string;
  private readonly pending = new Map<string, PendingRequest>();
  private sessionId = '';
  private unlisten: (() => void) | null = null;
  private closed = false;
  private readyResolver: ((value: void) => void) | null = null;
  private readyRejecter: ((error: Error) => void) | null = null;
  private readonly readyPromise: Promise<void>;

  constructor(connectorId: string, entryPath: string) {
    this.entryPath = entryPath;
    this.runtimeInstanceId = `platform-pack:${connectorId}`;
    this.pluginId = `platform-pack:${connectorId}`;
    this.commandId = `platform-pack:${connectorId}.sidecar`;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolver = resolve;
      this.readyRejecter = reject;
    });
  }

  async open(): Promise<void> {
    if (!isTauriRuntime()) {
      throw new Error('Platform pack sidecar runtime is only available in Tauri runtime');
    }

    this.unlisten = await listen<SidecarBridgeEventPayload>(SIDECAR_BRIDGE_MESSAGE_EVENT, (event) => {
      const payload = asRecord(event.payload) as SidecarBridgeEventPayload | null;
      if (!payload || payload.runtimeInstanceId !== this.runtimeInstanceId) {
        return;
      }

      const message = payload.message;
      if (isReadyMessage(message)) {
        this.readyResolver?.();
        this.readyResolver = null;
        this.readyRejecter = null;
        return;
      }

      if (isInvokeResponseMessage(message)) {
        const requestId = normalizeString(message.requestId);
        if (!requestId) {
          return;
        }
        const pending = this.pending.get(requestId);
        if (!pending) {
          return;
        }
        clearTimeout(pending.timeoutId);
        this.pending.delete(requestId);
        if (message.ok) {
          pending.resolve(message.data);
        } else {
          pending.reject(
            new Error(
              readSidecarErrorMessage(message.error, 'Platform pack sidecar request failed')
            )
          );
        }
        return;
      }

      if (isRuntimeErrorMessage(message)) {
        this.rejectAllPending(
          new Error(
            readSidecarErrorMessage(message, 'Platform pack sidecar runtime crashed')
          )
        );
      }
    });

    try {
      const response = await invokeWithTelemetry<OpenSidecarBridgeResponse>(
        'plugin_sidecar_bridge_open',
        {
          pluginId: this.pluginId,
          runtimeId: this.runtimeId,
          runtimeInstanceId: this.runtimeInstanceId,
          entryPath: this.entryPath,
          commandId: this.commandId,
          timeoutMs: READY_TIMEOUT_MS,
        },
        {
          moduleId: 'music-platform',
          component: 'platformPackSidecarBridge',
          event: 'music-platform.sidecar.open',
        }
      );
      this.sessionId = response.sessionId;
    } catch (error) {
      await this.dispose();
      throw error;
    }

    const readyTimeoutId = setTimeout(() => {
      this.readyRejecter?.(new Error('Platform pack sidecar startup timed out'));
      this.readyResolver = null;
      this.readyRejecter = null;
    }, READY_TIMEOUT_MS);

    try {
      await this.readyPromise;
    } catch (error) {
      await this.dispose();
      throw error;
    } finally {
      clearTimeout(readyTimeoutId);
    }
  }

  async invoke(request: PlatformPackSidecarInvokeRequest): Promise<unknown> {
    if (this.closed) {
      throw new Error('Platform pack sidecar session is closed');
    }
    if (!this.sessionId) {
      throw new Error('Platform pack sidecar session is not ready');
    }

    const requestId = `${this.runtimeInstanceId}:${Date.now()}:${Math.random()
      .toString(16)
      .slice(2)}`;
    const responsePromise = new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('Platform pack sidecar request timed out'));
      }, INVOKE_TIMEOUT_MS);
      this.pending.set(requestId, {
        resolve,
        reject,
        timeoutId,
      });
    });

    try {
      await invokeWithTelemetry(
        'plugin_sidecar_bridge_send',
        {
          sessionId: this.sessionId,
          message: {
            op: 'invoke',
            requestId,
            channel: request.channel,
            method: request.method,
            bindingId: request.bindingId,
            instanceId: request.instanceId,
            payload: request.payload,
          },
        },
        {
          moduleId: 'music-platform',
          component: 'platformPackSidecarBridge',
          event: 'music-platform.sidecar.send',
        }
      );
    } catch (error) {
      const pending = this.pending.get(requestId);
      if (pending) {
        clearTimeout(pending.timeoutId);
        this.pending.delete(requestId);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }

    return await responsePromise;
  }

  async dispose(reason = 'platform-pack-dispose'): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.rejectAllPending(new Error(`Platform pack sidecar session disposed: ${reason}`));
    this.readyRejecter?.(new Error(`Platform pack sidecar session disposed: ${reason}`));
    this.readyResolver = null;
    this.readyRejecter = null;

    const sessionId = this.sessionId;
    this.sessionId = '';

    try {
      if (sessionId) {
        await invokeWithTelemetry(
          'plugin_sidecar_bridge_close',
          {
            sessionId,
            reason,
          },
          {
            moduleId: 'music-platform',
            component: 'platformPackSidecarBridge',
            event: 'music-platform.sidecar.close',
            failureLevel: 'warn',
          }
        ).catch(() => undefined);
      }
    } finally {
      await Promise.resolve(this.unlisten?.());
      this.unlisten = null;
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [requestId, pending] of this.pending.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
      this.pending.delete(requestId);
    }
  }
}

const sidecarClientPromises = new Map<string, Promise<PlatformPackSidecarClient>>();

async function getOrCreatePlatformPackSidecarClient(
  connectorId: string,
  entryPath: string
): Promise<PlatformPackSidecarClient> {
  const key = `${connectorId}::${entryPath}`;
  const existing = sidecarClientPromises.get(key);
  if (existing) {
    return await existing;
  }

  const pending = (async () => {
    const client = new PlatformPackSidecarClient(connectorId, entryPath);
    try {
      await client.open();
      return client;
    } catch (error) {
      sidecarClientPromises.delete(key);
      throw error;
    }
  })();
  sidecarClientPromises.set(key, pending);
  return await pending;
}

export async function invokePlatformPackSidecar(
  connectorId: string,
  entryPath: string,
  request: PlatformPackSidecarInvokeRequest,
  attempt = 0
): Promise<unknown> {
  try {
    const client = await getOrCreatePlatformPackSidecarClient(connectorId, entryPath);
    return await client.invoke(request);
  } catch (error) {
    if (attempt < 1 && shouldRetryPlatformPackSidecarRequest(error)) {
      await disposePlatformPackSidecar(
        connectorId,
        entryPath,
        'platform-pack-sidecar-retry'
      );
      return await invokePlatformPackSidecar(connectorId, entryPath, request, attempt + 1);
    }
    throw error;
  }
}

export async function disposePlatformPackSidecar(
  connectorId: string,
  entryPath: string,
  reason?: string
): Promise<void> {
  const key = `${connectorId}::${entryPath}`;
  const clientPromise = sidecarClientPromises.get(key);
  sidecarClientPromises.delete(key);
  if (!clientPromise) {
    return;
  }
  const client = await clientPromise.catch(() => null);
  await client?.dispose(reason);
}
