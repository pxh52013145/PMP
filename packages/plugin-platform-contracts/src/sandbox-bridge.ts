import type { CapabilityPermission, CapabilityRequirement } from './capabilities';
import type {
  RuntimeActivate,
  RuntimeHealthResponse,
  RuntimeHello,
  RuntimeInit,
  ViewMountRequest,
} from './runtime-bridge';

export const EXTENSION_BRIDGE_VERSION = 'pxp.runtime.bridge.v1' as const;
export const DEFAULT_EXTENSION_RUNTIME_ID = 'pxp.runtime.main' as const;
export const DEFAULT_EXTENSION_BRIDGE_ID = 'pxp.runtime.bridge' as const;
export const DEFAULT_SIDECAR_BRIDGE_ID = 'pxp.runtime.bridge.v1' as const;

export type SandboxSurface =
  | 'magnet'
  | 'settings'
  | 'page'
  | 'visualizer'
  | 'window'
  | 'overlay'
  | 'desktop-widget'
  | 'command';

export type SandboxBridgeOutgoingMessage =
  | {
      frameId: string;
      type: 'sandbox:init';
      pluginId: string;
      hostLabel: string;
      runtimeHello?: RuntimeHello;
      runtimeInit?: RuntimeInit;
      runtimeActivate?: RuntimeActivate;
      runtimeHealth?: RuntimeHealthResponse;
      viewMountRequest?: ViewMountRequest;
      hostInfo?: unknown;
      surface: SandboxSurface;
      surfaceId?: string | null;
      permissions: string[];
      entryCode?: string;
      entryUrl?: string;
      mountContext?: unknown;
      commandArgs?: unknown;
      initialAudioState?: unknown;
      initialAudioSpectrum?: unknown;
      initialAudioSpectrumFramePre?: unknown;
      initialAudioSpectrumFramePost?: unknown;
      initialNavigation?: unknown;
      initialConfig?: unknown;
    }
  | {
      frameId: string;
      type: 'sandbox:dispose';
    }
  | {
      frameId: string;
      type: 'sandbox:ping';
      pingId: number;
    }
  | {
      frameId: string;
      type: 'sandbox:event';
      name: string;
      payload: unknown;
    }
  | {
      frameId: string;
      type: 'sandbox:rpc-result';
      id: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    }
  | {
      frameId: string;
      type: 'sandbox:capabilities-revoke';
      requestId: string;
      capabilityIds: string[];
      reason: string;
      dryRun?: boolean;
      traceId?: string;
    };

export type SandboxBridgeIncomingMessage =
  | {
      frameId: string;
      type:
        | 'sandbox:iframe-ready'
        | 'sandbox:worker-ready'
        | 'sandbox:mounted'
        | 'sandbox:disposed';
    }
  | {
      frameId: string;
      type: 'sandbox:pong';
      pingId: number;
    }
  | {
      frameId: string;
      type: 'sandbox:error';
      message: string;
    }
  | {
      frameId: string;
      type: 'sandbox:permission-denied';
      pluginId: string;
      hostLabel: string;
      capability: string;
      action: string;
    }
  | {
      frameId: string;
      type: 'sandbox:rpc';
      id: string;
      method: string;
      args: unknown[];
    }
  | {
      frameId: string;
      type: 'sandbox:command-finished';
      ok: boolean;
    }
  | {
      frameId: string;
      type: 'sandbox:capabilities-revoke-ack';
      requestId: string;
      ok: boolean;
      ignored?: boolean;
      reason?: string;
      traceId?: string;
    }
  | {
      frameId: string;
      type: 'sandbox:content-size';
      height: number;
    };

export type SandboxBridgeMessage = SandboxBridgeOutgoingMessage | SandboxBridgeIncomingMessage;

export const SANDBOX_BRIDGE_EVENT_TO_RUNTIME_OP = {
  'sandbox:init': 'runtime.init',
  'sandbox:iframe-ready': 'runtime.hello',
  'sandbox:worker-ready': 'runtime.hello',
  'sandbox:mounted': 'view.mount.ack',
  'sandbox:disposed': 'runtime.terminated',
  'sandbox:rpc': 'capability.invoke.request',
  'sandbox:rpc-result': 'capability.invoke.response',
  'sandbox:ping': 'runtime.ping',
  'sandbox:pong': 'runtime.pong',
  'sandbox:error': 'runtime.error',
  'sandbox:event': 'stream.data',
  'sandbox:permission-denied': 'runtime.capabilities.revoke',
  'sandbox:capabilities-revoke': 'runtime.capabilities.revoke',
  'sandbox:capabilities-revoke-ack': 'runtime.capabilities.revoke.ack',
  'sandbox:command-finished': 'runtime.activate.ack',
  'sandbox:dispose': 'dispose.request',
} as const;

export type SandboxRuntimeBridgeEventType = keyof typeof SANDBOX_BRIDGE_EVENT_TO_RUNTIME_OP;

const PERMISSION_CAPABILITY_MAP: Record<string, string> = {
  'api:host': 'core.capability-registry',
  'api:host-capability': 'core.capability-registry',
  'api:audio-state': 'host.pmp.audio-engine.playback',
  'api:audio-control': 'host.pmp.audio-engine.playback',
  'api:audio-visual': 'host.pmp.audio-engine.analysis',
  'api:audio-cover': 'host.pmp.audio-engine.playback',
  'api:navigation': 'host.pmp.navigation',
  'api:window': 'host.pmp.shell.window',
  'api:connector-auth': 'host.pmp.connector-auth',
  'api:magnets-catalog': 'host.pmp.magnets.catalog',
  'api:magnets-layout': 'host.pmp.magnets.layout',
  'api:music-platform-catalog': 'host.pmp.music-platform.catalog',
  'api:music-platform-search': 'host.pmp.music-platform.search',
  'api:music-platform-prepare': 'host.pmp.music-platform.prepare',
  'storage:local': 'host.pmp.storage.config',
  'storage:durable-text': 'host.pmp.storage.durable-text',
};

function normalizeCapabilityId(permission: string): string {
  const normalized = permission
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `pxp.permission.${normalized || 'unknown'}`;
}

export function mapSandboxBridgeEventToRuntimeOp(type: SandboxRuntimeBridgeEventType): string {
  return SANDBOX_BRIDGE_EVENT_TO_RUNTIME_OP[type];
}

export function mapPermissionToCapabilityId(permission: CapabilityPermission): string {
  return PERMISSION_CAPABILITY_MAP[permission] ?? normalizeCapabilityId(permission);
}

export function mapPermissionToCapabilityRequirement(
  permission: CapabilityPermission
): CapabilityRequirement {
  return {
    capabilityId: mapPermissionToCapabilityId(permission),
    reasons: [`permission:${permission}`],
  };
}
