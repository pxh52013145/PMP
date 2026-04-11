export type ExtensionTrustLevel = 'sandboxed' | 'trusted' | 'official';

export type ExtensionExecutionEnvironment =
  | 'extension-host'
  | 'webview'
  | 'worker'
  | 'wasm'
  | 'sidecar';

export type ExtensionLifecycleState =
  | 'installed'
  | 'resolved'
  | 'activating'
  | 'active'
  | 'suspended'
  | 'disabled'
  | 'crashed'
  | 'quarantined';

export interface ExtensionEntrypointDescriptor {
  kind: ExtensionExecutionEnvironment;
  path: string;
}

export interface ExtensionSidecarEntrypointDescriptor extends ExtensionEntrypointDescriptor {
  kind: 'sidecar';
  platform?: string;
  arch?: string;
}

export type {
  CapabilityRevoke,
  CapabilityRevokeAck,
  RuntimeActivate,
  RuntimeActivateAck,
  RuntimeBridgeEnvelope,
  RuntimeBridgeMessage,
  RuntimeCarrier,
  RuntimeErrorEvent,
  RuntimeEvent,
  RuntimeHealthRequest,
  RuntimeHealthResponse,
  RuntimeHello,
  RuntimeInit,
  RuntimeInitAck,
  RuntimeKind,
  RuntimePing,
  RuntimePong,
  RuntimeState,
  ViewMountAck,
  ViewMountRequest,
  ViewUnmountAck,
  ViewUnmountRequest,
  ViewUpdate,
} from './runtime-bridge';
