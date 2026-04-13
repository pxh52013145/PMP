import { listen } from '@tauri-apps/api/event';
import { invokeWithTelemetry } from '../../../services/telemetry/tauriInvokeTelemetry';
import { isTauriRuntime } from '../../../utils/tauriRuntime';
import {
  createPluginSidecarTelemetryContext,
  reportPluginSidecarBridgeOpened,
  reportPluginSidecarProcessForcedTeardown,
} from '../pluginLifecycleTelemetry';
import type { RuntimeBridgeTransportMessage } from './runtimeBridgeHostSession';
import type {
  CreateRuntimeSidecarPortControllerOptions,
  RuntimeSidecarPortController,
} from './runtimeSidecarPort';

const SIDECAR_BRIDGE_MESSAGE_EVENT = 'plugin-sidecar-bridge-message';

type SidecarBridgeEventPayload = {
  sessionId?: string;
  runtimeInstanceId?: string;
  message?: unknown;
};

type OpenSidecarBridgeResponse = {
  sessionId: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isRuntimeBridgeTransportMessage(value: unknown): value is RuntimeBridgeTransportMessage {
  return typeof asObject(value)?.op === 'string';
}

export async function createTauriRuntimeSidecarPortController(
  options: CreateRuntimeSidecarPortControllerOptions
): Promise<RuntimeSidecarPortController> {
  if (!isTauriRuntime()) {
    throw new Error('Native sidecar runtime bridge is only available in Tauri runtime');
  }

  const telemetryContext = createPluginSidecarTelemetryContext({
    pluginId: options.pluginId,
    sourceKind: options.telemetry?.sourceKind ?? 'extv2',
    hostLabel: options.telemetry?.hostLabel,
    runtimeId: options.runtimeId,
    runtimeInstanceId: options.runtimeInstanceId,
    surfaceKind: options.telemetry?.surfaceKind,
    surfaceId: options.telemetry?.surfaceId,
    cause: options.telemetry?.cause,
  });
  const listeners = new Set<(message: RuntimeBridgeTransportMessage) => void>();
  const buffered: RuntimeBridgeTransportMessage[] = [];
  let sessionId = '';
  let closed = false;
  let closePromise: Promise<void> | null = null;

  const unlisten = await listen<SidecarBridgeEventPayload>(SIDECAR_BRIDGE_MESSAGE_EVENT, (event) => {
    const payload = asObject(event.payload) as SidecarBridgeEventPayload | null;
    if (!payload || payload.runtimeInstanceId !== options.runtimeInstanceId) {
      return;
    }

    if (!isRuntimeBridgeTransportMessage(payload.message)) {
      return;
    }

    if (listeners.size === 0) {
      buffered.push(payload.message);
      return;
    }

    for (const listener of Array.from(listeners)) {
      listener(payload.message);
    }
  });

  try {
    const response = await invokeWithTelemetry<OpenSidecarBridgeResponse>(
      'plugin_sidecar_bridge_open',
      {
        pluginId: options.pluginId,
        runtimeId: options.runtimeId,
        runtimeInstanceId: options.runtimeInstanceId,
        entryPath: options.entryPath,
        commandId: options.commandId,
        args: options.args,
        timeoutMs: options.timeoutMs,
      },
      {
        moduleId: 'plugins',
        component: 'sidecar.bridge.open',
        event: 'plugin.sidecar.invoke.open',
      }
    );
    sessionId = response.sessionId;
    reportPluginSidecarBridgeOpened(telemetryContext, {
      extraFields: {
        sidecarSessionId: sessionId,
        timeoutMs: options.timeoutMs,
      },
    });
  } catch (error) {
    await Promise.resolve(unlisten());
    throw error;
  }

  const close = async (reason = 'runtime-command-finished'): Promise<void> => {
    if (closePromise) {
      return await closePromise;
    }

    closed = true;
    closePromise = (async () => {
      try {
        listeners.clear();
        buffered.length = 0;
        if (reason === 'runtime-unresponsive' || reason.startsWith('runtime-crash')) {
          reportPluginSidecarProcessForcedTeardown(telemetryContext, {
            extraFields: {
              sidecarSessionId: sessionId || null,
              teardownReason: reason,
              timeoutMs: options.timeoutMs,
            },
          });
        }
        if (sessionId) {
          await invokeWithTelemetry('plugin_sidecar_bridge_close', { sessionId, reason }, {
            moduleId: 'plugins',
            component: 'sidecar.bridge.close',
            event: 'plugin.sidecar.invoke.close',
            failureLevel: 'warn',
          }).catch(() => undefined);
        }
      } finally {
        await Promise.resolve(unlisten());
      }
    })();

    return await closePromise;
  };

  return {
    port: {
      postMessage: async (message) => {
        if (closed) {
          throw new Error('Native sidecar runtime bridge session is closed');
        }
        if (!sessionId) {
          throw new Error('Native sidecar runtime bridge session is not ready');
        }

        await invokeWithTelemetry(
          'plugin_sidecar_bridge_send',
          {
            sessionId,
            message,
          },
          {
            moduleId: 'plugins',
            component: 'sidecar.bridge.send',
            event: 'plugin.sidecar.invoke.send',
          }
        );
      },
      onMessage: (listener) => {
        listeners.add(listener);

        if (buffered.length > 0) {
          const pending = buffered.splice(0, buffered.length);
          for (const message of pending) {
            listener(message);
          }
        }

        return () => {
          listeners.delete(listener);
        };
      },
    },
    dispose: close,
  };
}
