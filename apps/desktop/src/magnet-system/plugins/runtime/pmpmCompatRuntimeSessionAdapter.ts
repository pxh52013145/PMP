import type {
  PmpmBridgeIncomingMessage,
  PmpmBridgeOutgoingMessage,
  PmpmSandboxSurface,
} from '@pixel-matrix/plugin-platform-contracts';
import type {
  RuntimeActivate,
  RuntimeBridgeMessage,
  RuntimeHealthRequest,
  RuntimeHealthResponse,
  RuntimeHello,
  RuntimeInit,
  ViewMountRequest,
} from '@pixel-matrix/plugin-platform-contracts';
import type { RuntimeBridgePort, RuntimeBridgeTransportMessage } from './runtimeBridgeHostSession';
import {
  RUNTIME_EVENT_NAMES,
  mapRuntimeEventNameToPmpmCompatEvent,
} from './runtimeEventChannel';

export type PmpmCompatCapabilityRevokeDrillMessage = {
  type: 'pmpm:capabilities-revoke';
  requestId: string;
  capabilityIds: string[];
  reason: string;
  dryRun?: boolean;
  traceId?: string;
};

export type PmpmCompatCapabilityRevokeAckMessage = {
  frameId: string;
  type: 'pmpm:capabilities-revoke-ack';
  requestId: string;
  ok: boolean;
  ignored?: boolean;
  reason?: string;
  traceId?: string;
};

export type PmpmCompatRuntimeIncomingMessage =
  | PmpmBridgeIncomingMessage
  | PmpmCompatCapabilityRevokeAckMessage;

export type PmpmCompatRuntimeOutgoingMessage =
  | Omit<PmpmBridgeOutgoingMessage, 'frameId'>
  | PmpmCompatCapabilityRevokeDrillMessage;

export interface CreatePmpmCompatRuntimeSessionAdapterOptions {
  runtimeHello: RuntimeHello;
  runtimeHealth?: RuntimeHealthResponse;
  viewMountRequest?: ViewMountRequest;
  capabilityRevokeDrill?: PmpmCompatCapabilityRevokeDrillMessage;
  hostLabel: string;
  surface: PmpmSandboxSurface;
  surfaceId?: string | null;
  permissions: string[];
  entryCode: string;
  entryUrl?: string;
  mountContext?: unknown;
  commandArgs?: unknown;
  hostInfo?: unknown;
  initialAudioState?: unknown;
  initialAudioSpectrum?: unknown;
  initialAudioSpectrumFramePre?: unknown;
  initialAudioSpectrumFramePost?: unknown;
  initialNavigation?: unknown;
  initialConfig?: unknown;
  activateAckMode?: 'mounted' | 'immediate';
  postCompatMessage: (message: PmpmCompatRuntimeOutgoingMessage) => void;
}

function asRuntimeMessage(
  message: RuntimeBridgeMessage
): RuntimeBridgeTransportMessage {
  return message;
}

export function createPmpmCompatRuntimeSessionAdapter(
  options: CreatePmpmCompatRuntimeSessionAdapterOptions
): {
  port: RuntimeBridgePort;
  handleCompatMessage: (message: PmpmCompatRuntimeIncomingMessage) => boolean;
  primeRuntimeHello: () => void;
} {
  const listeners = new Set<(message: RuntimeBridgeTransportMessage) => void>();
  const bufferedMessages: RuntimeBridgeTransportMessage[] = [];
  let runtimeHelloSent = false;
  let activateAckSent = false;
  let runtimeInitSnapshot: RuntimeInit | null = null;
  let runtimeActivateSnapshot: RuntimeActivate | null = null;

  const emitRuntimeMessage = (message: RuntimeBridgeMessage): void => {
    const transportMessage = asRuntimeMessage(message);
    if (listeners.size === 0) {
      bufferedMessages.push(transportMessage);
      return;
    }
    for (const listener of Array.from(listeners)) {
      listener(transportMessage);
    }
  };

  const emitRuntimeHello = (): void => {
    if (runtimeHelloSent) {
      return;
    }
    runtimeHelloSent = true;
    emitRuntimeMessage(options.runtimeHello);
  };

  const emitRuntimeActivateAck = (): void => {
    if (activateAckSent || !runtimeActivateSnapshot) {
      return;
    }
    activateAckSent = true;
    emitRuntimeMessage({
      bridgeVersion: runtimeActivateSnapshot.bridgeVersion,
      op: 'runtime.activate.ack',
      pluginId: runtimeActivateSnapshot.pluginId,
      runtimeId: runtimeActivateSnapshot.runtimeId,
      runtimeInstanceId: runtimeActivateSnapshot.runtimeInstanceId,
    });
  };

  return {
    port: {
      postMessage: (message) => {
        switch (message.op) {
          case 'runtime.init':
            runtimeInitSnapshot = message;
            emitRuntimeMessage({
              bridgeVersion: message.bridgeVersion,
              op: 'runtime.init.ack',
              pluginId: message.pluginId,
              runtimeId: message.runtimeId,
              runtimeInstanceId: message.runtimeInstanceId,
            });
            return;
          case 'runtime.activate':
            runtimeActivateSnapshot = message;
            if (!runtimeInitSnapshot) {
              throw new Error('runtime.activate received before runtime.init');
            }
            options.postCompatMessage({
              type: 'pmpm:init',
              pluginId: options.runtimeHello.pluginId,
              hostLabel: options.hostLabel,
              runtimeHello: options.runtimeHello,
              runtimeInit: runtimeInitSnapshot,
              runtimeActivate: message,
              runtimeHealth: options.runtimeHealth,
              viewMountRequest: options.viewMountRequest,
              hostInfo: options.hostInfo,
              surface: options.surface,
              surfaceId: options.surfaceId,
              permissions: [...options.permissions],
              entryCode: options.entryCode,
              entryUrl: options.entryUrl,
              mountContext: options.mountContext,
              commandArgs: options.commandArgs,
              initialAudioState: options.initialAudioState,
              initialAudioSpectrum: options.initialAudioSpectrum,
              initialAudioSpectrumFramePre: options.initialAudioSpectrumFramePre,
              initialAudioSpectrumFramePost: options.initialAudioSpectrumFramePost,
              initialNavigation: options.initialNavigation,
              initialConfig: options.initialConfig,
            } as Extract<PmpmBridgeOutgoingMessage, { type: 'pmpm:init' }>);
            if (options.capabilityRevokeDrill) {
              options.postCompatMessage(options.capabilityRevokeDrill);
            }
            if ((options.activateAckMode ?? 'mounted') === 'immediate') {
              emitRuntimeActivateAck();
            }
            return;
          case 'runtime.event': {
            const compatEventName = mapRuntimeEventNameToPmpmCompatEvent(message.eventName);
            if (!compatEventName) {
              return;
            }
            options.postCompatMessage({
              type: 'pmpm:event',
              name: compatEventName,
              payload: message.payload,
            } as Extract<PmpmBridgeOutgoingMessage, { type: 'pmpm:event' }>);
            return;
          }
          case 'runtime.health.request': {
            const healthRequest = message as RuntimeHealthRequest;
            const baseHealth = options.runtimeHealth;
            const response: RuntimeHealthResponse = {
              bridgeVersion: baseHealth?.bridgeVersion ?? options.runtimeHello.bridgeVersion,
              op: 'runtime.health.response',
              pluginId: options.runtimeHello.pluginId,
              runtimeId: options.runtimeHello.runtimeId,
              runtimeInstanceId: options.runtimeHello.runtimeInstanceId,
              requestId: healthRequest.requestId,
              traceId: healthRequest.traceId,
              ready: baseHealth?.ready ?? activateAckSent,
              status: baseHealth?.status ?? (activateAckSent ? 'healthy' : 'degraded'),
              message: baseHealth?.message,
            };
            emitRuntimeMessage(response);
            return;
          }
          case 'runtime.capabilities.revoke':
            options.postCompatMessage({
              type: 'pmpm:capabilities-revoke',
              requestId: message.requestId,
              capabilityIds: [...message.capabilityIds],
              reason: message.reason,
              traceId: message.traceId,
            });
            return;
          case 'runtime.ping':
          case 'runtime.pong':
          case 'runtime.error':
          case 'view.mount.request':
          case 'view.mount.ack':
          case 'view.update':
          case 'view.unmount.request':
          case 'view.unmount.ack':
            return;
          default:
            return;
        }
      },
      onMessage: (listener) => {
        listeners.add(listener);
        if (bufferedMessages.length > 0) {
          const pending = bufferedMessages.splice(0, bufferedMessages.length);
          for (const message of pending) {
            listener(message);
          }
        }
        return () => {
          listeners.delete(listener);
        };
      },
    },
    handleCompatMessage: (message) => {
      switch (message.type) {
        case 'pmpm:iframe-ready':
        case 'pmpm:worker-ready':
          emitRuntimeHello();
          return true;
        case 'pmpm:mounted':
          emitRuntimeActivateAck();
          return true;
        case 'pmpm:permission-denied':
          emitRuntimeMessage({
            bridgeVersion: options.runtimeHello.bridgeVersion,
            op: 'runtime.event',
            pluginId: options.runtimeHello.pluginId,
            runtimeId: options.runtimeHello.runtimeId,
            runtimeInstanceId: options.runtimeHello.runtimeInstanceId,
            eventName: RUNTIME_EVENT_NAMES.permissionDenied,
            payload: {
              capability: message.capability,
              action: message.action,
            },
            emittedAt: Date.now(),
          });
          return true;
        case 'pmpm:command-finished':
          emitRuntimeMessage({
            bridgeVersion: options.runtimeHello.bridgeVersion,
            op: 'runtime.event',
            pluginId: options.runtimeHello.pluginId,
            runtimeId: options.runtimeHello.runtimeId,
            runtimeInstanceId: options.runtimeHello.runtimeInstanceId,
            eventName: RUNTIME_EVENT_NAMES.commandResult,
            payload: {
              ok: message.ok,
            },
            emittedAt: Date.now(),
          });
          return true;
        case 'pmpm:error':
          emitRuntimeMessage({
            bridgeVersion: options.runtimeHello.bridgeVersion,
            op: 'runtime.error',
            pluginId: options.runtimeHello.pluginId,
            runtimeId: options.runtimeHello.runtimeId,
            runtimeInstanceId: options.runtimeHello.runtimeInstanceId,
            fatal: true,
            message: message.message,
          });
          return true;
        case 'pmpm:pong':
        case 'pmpm:disposed':
        case 'pmpm:rpc':
          return false;
        case 'pmpm:capabilities-revoke-ack':
          emitRuntimeMessage({
            bridgeVersion: options.runtimeHello.bridgeVersion,
            op: 'runtime.capabilities.revoke.ack',
            pluginId: options.runtimeHello.pluginId,
            runtimeId: options.runtimeHello.runtimeId,
            runtimeInstanceId: options.runtimeHello.runtimeInstanceId,
            requestId: message.requestId,
            traceId: message.traceId,
            ok: message.ok,
            ignored: message.ignored,
            reason: message.reason,
          });
          return false;
      }
    },
    primeRuntimeHello: emitRuntimeHello,
  };
}
