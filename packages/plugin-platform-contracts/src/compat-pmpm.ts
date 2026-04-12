import type { CapabilityPermission, CapabilityRequirement } from './capabilities';
import type {
  RuntimeActivate,
  RuntimeHealthResponse,
  RuntimeHello,
  RuntimeInit,
  ViewMountRequest,
} from './runtime-bridge';
import { PMP_FOUNDATION_CAPABILITY_COMPAT_MAP } from './host';

export const PMPM_COMPAT_LAYER_ID = 'compat.pmpm' as const;
export const PMPM_MANIFEST_FORMAT_VERSION = '1.0' as const;
export const PMPM_MANIFEST_TYPE = 'magnet-plugin' as const;
export const PMPM_DEFAULT_RUNTIME_ID = 'compat.pmpm.main' as const;
export const PMPM_DEFAULT_BRIDGE_ID = 'compat.pmpm.bridge' as const;
export const PMPM_DEFAULT_SIDECAR_BRIDGE_ID = 'pxp.runtime.bridge.v1' as const;
export const PMPM_BRIDGE_VERSION = 'compat.pmpm.bridge.v1' as const;

export type PmpmSandboxSurface =
  | 'magnet'
  | 'settings'
  | 'page'
  | 'visualizer'
  | 'window'
  | 'overlay'
  | 'desktop-widget'
  | 'command';

export type PmpmBridgeOutgoingMessage =
  | {
      frameId: string;
      type: 'pmpm:init';
      pluginId: string;
      hostLabel: string;
      runtimeHello?: RuntimeHello;
      runtimeInit?: RuntimeInit;
      runtimeActivate?: RuntimeActivate;
      runtimeHealth?: RuntimeHealthResponse;
      viewMountRequest?: ViewMountRequest;
      hostInfo?: unknown;
      surface: PmpmSandboxSurface;
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
      type: 'pmpm:dispose';
    }
  | {
      frameId: string;
      type: 'pmpm:ping';
      pingId: number;
    }
  | {
      frameId: string;
      type: 'pmpm:event';
      name: string;
      payload: unknown;
    }
  | {
      frameId: string;
      type: 'pmpm:rpc-result';
      id: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    };

export type PmpmBridgeIncomingMessage =
  | {
      frameId: string;
      type: 'pmpm:iframe-ready' | 'pmpm:worker-ready' | 'pmpm:mounted' | 'pmpm:disposed';
    }
  | {
      frameId: string;
      type: 'pmpm:pong';
      pingId: number;
    }
  | {
      frameId: string;
      type: 'pmpm:error';
      message: string;
    }
  | {
      frameId: string;
      type: 'pmpm:permission-denied';
      pluginId: string;
      hostLabel: string;
      capability: string;
      action: string;
    }
  | {
      frameId: string;
      type: 'pmpm:rpc';
      id: string;
      method: string;
      args: unknown[];
    }
  | {
      frameId: string;
      type: 'pmpm:command-finished';
      ok: boolean;
    };

export type PmpmBridgeMessage = PmpmBridgeOutgoingMessage | PmpmBridgeIncomingMessage;

export const PMPM_BRIDGE_EVENT_TO_RUNTIME_OP = {
  'pmpm:init': 'runtime.init',
  'pmpm:iframe-ready': 'runtime.hello',
  'pmpm:worker-ready': 'runtime.hello',
  'pmpm:mounted': 'view.mount.ack',
  'pmpm:disposed': 'runtime.terminated',
  'pmpm:rpc': 'capability.invoke.request',
  'pmpm:rpc-result': 'capability.invoke.response',
  'pmpm:ping': 'runtime.ping',
  'pmpm:pong': 'runtime.pong',
  'pmpm:error': 'runtime.error',
  'pmpm:event': 'stream.data',
  'pmpm:permission-denied': 'runtime.capabilities.revoke',
  'pmpm:command-finished': 'runtime.activate.ack',
  'pmpm:dispose': 'dispose.request',
} as const;

export type PmpmRuntimeBridgeEventType = keyof typeof PMPM_BRIDGE_EVENT_TO_RUNTIME_OP;

const COMPAT_PERMISSION_CAPABILITY_MAP: Record<string, string> = {
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

function normalizeCompatCapabilityId(permission: string): string {
  const normalized = permission
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `compat.pmpm.permission.${normalized || 'unknown'}`;
}

export function mapPmpmBridgeEventToRuntimeOp(type: PmpmRuntimeBridgeEventType): string {
  return PMPM_BRIDGE_EVENT_TO_RUNTIME_OP[type];
}

export function mapPmpmPermissionToCapabilityId(permission: CapabilityPermission): string {
  const mapped = COMPAT_PERMISSION_CAPABILITY_MAP[permission];
  if (mapped) return mapped;
  return normalizeCompatCapabilityId(permission);
}

export function mapLegacyFoundationCapabilityId(capabilityId: string): string {
  const mapped =
    PMP_FOUNDATION_CAPABILITY_COMPAT_MAP[
      capabilityId as keyof typeof PMP_FOUNDATION_CAPABILITY_COMPAT_MAP
    ];
  return mapped ?? capabilityId;
}

export function mapPmpmPermissionToCapabilityRequirement(
  permission: CapabilityPermission
): CapabilityRequirement {
  return {
    capabilityId: mapPmpmPermissionToCapabilityId(permission),
    reasons: [`compat-from-permission:${permission}`],
  };
}
