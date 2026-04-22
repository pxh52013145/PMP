import type { DataPlaneKind } from './core';
import type {
  MusicPlatformWorkspaceCapabilityFamilies,
  MusicPlatformWorkspaceContextDescriptor,
  MusicPlatformWorkspaceDescriptor,
  MusicPlatformWorkspaceRootDescriptor,
  MusicPlatformWorkspaceShellSlotDescriptor,
} from './musicPlatformWorkspace';

export type RuntimeKind = 'extension-host' | 'webview' | 'sidecar';

export type RuntimeCarrier =
  | 'same-process'
  | 'dedicated-worker'
  | 'webview-frame'
  | 'native-process';

export type RuntimeState =
  | 'resolved'
  | 'spawning'
  | 'ready'
  | 'initialized'
  | 'active'
  | 'suspended'
  | 'disposing'
  | 'terminated'
  | 'crashed'
  | 'quarantined';

export interface RuntimeBridgeEnvelope {
  bridgeVersion: string;
  op: string;
  pluginId: string;
  runtimeId: string;
  runtimeInstanceId: string;
  requestId?: string;
  traceId?: string;
}

export interface RuntimeHello extends RuntimeBridgeEnvelope {
  op: 'runtime.hello';
  supportedBridgeVersions: string[];
  runtimeKind: RuntimeKind;
  carrier: RuntimeCarrier;
  supportsViewMount: boolean;
  supportedDataPlanes?: DataPlaneKind[];
}

export interface RuntimeInit extends RuntimeBridgeEnvelope {
  op: 'runtime.init';
  hostId: string;
  hostVersion?: string;
  trustLevel: string;
  grantedCapabilities: Array<{
    capabilityId: string;
    version: string;
    mode?: 'required' | 'optional';
  }>;
  runtimePolicy?: {
    startupTimeoutMs?: number;
    heartbeatIntervalMs?: number;
    unresponsiveTimeoutMs?: number;
  };
  locale?: {
    active: string;
    fallback?: string;
  };
}

export interface RuntimeInitAck extends RuntimeBridgeEnvelope {
  op: 'runtime.init.ack';
}

export interface RuntimeActivate extends RuntimeBridgeEnvelope {
  op: 'runtime.activate';
  cause:
    | 'startup'
    | 'command'
    | 'view'
    | 'capability'
    | 'host-event'
    | 'file'
    | 'manual'
    | 'recovery';
  payload?: unknown;
}

export interface RuntimeActivateAck extends RuntimeBridgeEnvelope {
  op: 'runtime.activate.ack';
}

export interface ViewMountRequest extends RuntimeBridgeEnvelope {
  op: 'view.mount.request';
  requestId: string;
  viewInstanceId: string;
  viewId: string;
  viewType: string;
  surfaceSlot: string;
  props?: unknown;
  mountMetadata?: {
    scope?: 'generic' | 'music-platform-workspace';
    connectorId?: string;
    platformId?: string;
    instanceId?: string;
    workspace?: Pick<
      MusicPlatformWorkspaceDescriptor,
      'ownership' | 'requiredRuntimeCarrier'
    >;
    root?: MusicPlatformWorkspaceRootDescriptor;
    shellSlot?: MusicPlatformWorkspaceShellSlotDescriptor;
    capabilityFamilies?: MusicPlatformWorkspaceCapabilityFamilies;
    context?: MusicPlatformWorkspaceContextDescriptor;
  };
}

export interface ViewMountAck extends RuntimeBridgeEnvelope {
  op: 'view.mount.ack';
  requestId: string;
  viewInstanceId: string;
}

export interface ViewUpdate extends RuntimeBridgeEnvelope {
  op: 'view.update';
  viewInstanceId: string;
  props?: unknown;
}

export interface ViewUnmountRequest extends RuntimeBridgeEnvelope {
  op: 'view.unmount.request';
  requestId: string;
  viewInstanceId: string;
  reason?: string;
}

export interface ViewUnmountAck extends RuntimeBridgeEnvelope {
  op: 'view.unmount.ack';
  requestId: string;
  viewInstanceId: string;
}

export interface CapabilityRevoke extends RuntimeBridgeEnvelope {
  op: 'runtime.capabilities.revoke';
  requestId: string;
  capabilityIds: string[];
  reason: string;
}

export interface CapabilityRevokeAck extends RuntimeBridgeEnvelope {
  op: 'runtime.capabilities.revoke.ack';
  requestId: string;
  ok: boolean;
  ignored?: boolean;
  reason?: string;
}

export interface RuntimeHealthRequest extends RuntimeBridgeEnvelope {
  op: 'runtime.health.request';
  requestId: string;
}

export interface RuntimeHealthResponse extends RuntimeBridgeEnvelope {
  op: 'runtime.health.response';
  requestId: string;
  ready: boolean;
  status: 'healthy' | 'degraded' | 'unresponsive' | 'crashed' | 'quarantined';
  message?: string;
}

export interface RuntimePing extends RuntimeBridgeEnvelope {
  op: 'runtime.ping';
  requestId?: string;
}

export interface RuntimePong extends RuntimeBridgeEnvelope {
  op: 'runtime.pong';
  requestId?: string;
}

export interface RuntimeErrorEvent extends RuntimeBridgeEnvelope {
  op: 'runtime.error';
  fatal?: boolean;
  message: string;
  details?: unknown;
}

export interface RuntimeEvent<TPayload = unknown> extends RuntimeBridgeEnvelope {
  op: 'runtime.event';
  eventName: string;
  payload?: TPayload;
  sequence?: number;
  emittedAt?: number;
}

export type RuntimeBridgeMessage =
  | RuntimeHello
  | RuntimeInit
  | RuntimeInitAck
  | RuntimeActivate
  | RuntimeActivateAck
  | ViewMountRequest
  | ViewMountAck
  | ViewUpdate
  | ViewUnmountRequest
  | ViewUnmountAck
  | CapabilityRevoke
  | CapabilityRevokeAck
  | RuntimeHealthRequest
  | RuntimeHealthResponse
  | RuntimePing
  | RuntimePong
  | RuntimeErrorEvent
  | RuntimeEvent;
