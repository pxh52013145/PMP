import type { PmpHostManifestContributionDescriptor } from './host';

export type LocalizedTextValue = string | number | boolean | null;

export interface LocalizedTextReference {
  key: string;
  fallback?: string;
  args?: Record<string, LocalizedTextValue>;
}

export type LocalizedTextDescriptor = string | LocalizedTextReference;

export type ProtocolVersion = string;
export type CapabilityId = string;
export type RequestId = string;
export type SessionId = string;
export type StreamId = string;
export type HandleId = string;
export type LeaseId = string;

export type DataPlaneKind = 'inline-json' | 'shared-memory' | 'pipe' | 'local-socket';

export interface ProtocolError {
  code: string;
  message: string;
  retryable?: boolean;
  details?: unknown;
}

export interface CapabilityRequirement {
  capabilityId: string;
  versionRange?: string;
  reasons?: string[];
}

export interface CapabilityProvision {
  capabilityId: string;
  version: string;
  runtimeId?: string;
  visibility?: 'host-only' | 'workspace' | 'public';
}

export interface PxpEnvelopeBase {
  protocolVersion: string;
  op: string;
  requestId?: string;
  capabilityId?: string;
  sessionId?: string;
  streamId?: string;
  handleId?: string;
  runtimeId?: string;
  traceId?: string;
  pluginId?: string;
}

export interface CapabilityInvokeRequest extends PxpEnvelopeBase {
  op: 'capability.invoke.request';
  requestId: string;
  capabilityId: string;
  method: string;
  payload?: unknown;
}

export interface CapabilityInvokeResponseOk extends PxpEnvelopeBase {
  op: 'capability.invoke.response';
  requestId: string;
  ok: true;
  data: unknown;
}

export interface CapabilityInvokeResponseError extends PxpEnvelopeBase {
  op: 'capability.invoke.response';
  requestId: string;
  ok: false;
  error: ProtocolError;
}

export type CapabilityInvokeResponse = CapabilityInvokeResponseOk | CapabilityInvokeResponseError;

export interface SessionOpenRequest extends PxpEnvelopeBase {
  op: 'session.open.request';
  requestId: string;
  capabilityId: string;
  method: string;
  payload?: unknown;
}

export interface SessionOpenResponseOk extends PxpEnvelopeBase {
  op: 'session.open.response';
  requestId: string;
  ok: true;
  sessionId: string;
  providerSessionId?: string;
  metadata?: unknown;
}

export interface SessionOpenResponseError extends PxpEnvelopeBase {
  op: 'session.open.response';
  requestId: string;
  ok: false;
  error: ProtocolError;
}

export type SessionOpenResponse = SessionOpenResponseOk | SessionOpenResponseError;

export interface SessionCloseRequest extends PxpEnvelopeBase {
  op: 'session.close.request';
  requestId: string;
  capabilityId: string;
  sessionId: string;
  reason?: string;
}

export interface SessionCloseResponseOk extends PxpEnvelopeBase {
  op: 'session.close.response';
  requestId: string;
  ok: true;
}

export interface SessionCloseResponseError extends PxpEnvelopeBase {
  op: 'session.close.response';
  requestId: string;
  ok: false;
  error: ProtocolError;
}

export type SessionCloseResponse = SessionCloseResponseOk | SessionCloseResponseError;

export interface ResourceHandleDescriptor {
  handleId: string;
  kind: 'file' | 'blob' | 'shared-memory' | 'pipe' | 'local-socket';
  access: 'read' | 'write' | 'readwrite';
  leaseMs?: number;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
}

export interface StreamOpenRequest extends PxpEnvelopeBase {
  op: 'stream.open.request';
  requestId: string;
  capabilityId: string;
  method: string;
  payload?: unknown;
}

export interface StreamOpenResponseOk extends PxpEnvelopeBase {
  op: 'stream.open.response';
  requestId: string;
  ok: true;
  streamId: string;
  mode: 'push' | 'pull';
  transport: DataPlaneKind;
}

export interface StreamOpenResponseError extends PxpEnvelopeBase {
  op: 'stream.open.response';
  requestId: string;
  ok: false;
  error: ProtocolError;
}

export type StreamOpenResponse = StreamOpenResponseOk | StreamOpenResponseError;

export interface StreamData extends PxpEnvelopeBase {
  op: 'stream.data';
  streamId: string;
  sequence: number;
  payload?: unknown;
  handles?: ResourceHandleDescriptor[];
}

export interface StreamCredit extends PxpEnvelopeBase {
  op: 'stream.credit';
  streamId: string;
  credit: number;
}

export interface StreamEnd extends PxpEnvelopeBase {
  op: 'stream.end';
  streamId: string;
  reason?: string;
}

export interface CancelRequest extends PxpEnvelopeBase {
  op: 'cancel.request';
  requestId: string;
  targetRequestId?: string;
  streamId?: string;
  sessionId?: string;
  reason?: string;
}

export interface DisposeRequest extends PxpEnvelopeBase {
  op: 'dispose.request';
  requestId: string;
  handleId?: string;
  streamId?: string;
  sessionId?: string;
  reason?: string;
}

export type CapabilityProtocolMessage =
  | CapabilityInvokeRequest
  | CapabilityInvokeResponse
  | SessionOpenRequest
  | SessionOpenResponse
  | SessionCloseRequest
  | SessionCloseResponse
  | StreamOpenRequest
  | StreamOpenResponse
  | StreamData
  | StreamCredit
  | StreamEnd
  | CancelRequest
  | DisposeRequest;

export type ResourceDurabilityScope = 'config' | 'data' | 'cache' | 'temp';

export interface CoreContributionBase {
  id: string;
  title?: LocalizedTextDescriptor;
  description?: LocalizedTextDescriptor;
  metadata?: Record<string, unknown>;
}

export interface CoreCommandContributionDescriptor extends CoreContributionBase {
  kind: 'command';
  category?: string;
}

export interface CoreKeybindingContributionDescriptor {
  kind: 'keybinding';
  id: string;
  key: string;
  command: string;
  when?: string;
  args?: unknown;
  weight?: number;
  metadata?: Record<string, unknown>;
}

export interface CoreViewContributionDescriptor extends CoreContributionBase {
  kind: 'view';
  viewType: string;
  defaultSurfaceSlot?: string;
}

export interface CoreMenuContributionDescriptor extends CoreContributionBase {
  kind: 'menu';
  command: string;
  menuId?: string;
  group?: string;
  order?: number;
  when?: string;
}

export interface CoreProviderContributionDescriptor extends CoreContributionBase {
  kind: 'provider';
  capabilityId: string;
  version?: string;
}

export interface CoreTaskContributionDescriptor extends CoreContributionBase {
  kind: 'task';
  taskType: string;
}

export interface CoreThemeContributionDescriptor extends CoreContributionBase {
  kind: 'theme';
  themeId: string;
}

export interface CoreAnalyzerContributionDescriptor extends CoreContributionBase {
  kind: 'analyzer';
  analyzerId: string;
}

export interface CoreConnectorContributionDescriptor extends CoreContributionBase {
  kind: 'connector';
  connectorId: string;
}

export interface CoreFilesystemContributionDescriptor extends CoreContributionBase {
  kind: 'filesystem';
  scheme: string;
}

export interface CoreProtocolHandlerContributionDescriptor extends CoreContributionBase {
  kind: 'protocol-handler';
  protocol: string;
}

export interface CoreBackgroundServiceContributionDescriptor extends CoreContributionBase {
  kind: 'background-service';
  serviceId: string;
}

export type CoreContributionDescriptor =
  | CoreCommandContributionDescriptor
  | CoreKeybindingContributionDescriptor
  | CoreViewContributionDescriptor
  | CoreMenuContributionDescriptor
  | CoreProviderContributionDescriptor
  | CoreTaskContributionDescriptor
  | CoreThemeContributionDescriptor
  | CoreAnalyzerContributionDescriptor
  | CoreConnectorContributionDescriptor
  | CoreFilesystemContributionDescriptor
  | CoreProtocolHandlerContributionDescriptor
  | CoreBackgroundServiceContributionDescriptor;

export interface CoreContributionBuckets {
  commands?: CoreCommandContributionDescriptor[];
  keybindings?: CoreKeybindingContributionDescriptor[];
  views?: CoreViewContributionDescriptor[];
  menus?: CoreMenuContributionDescriptor[];
  providers?: CoreProviderContributionDescriptor[];
  tasks?: CoreTaskContributionDescriptor[];
  themes?: CoreThemeContributionDescriptor[];
  analyzers?: CoreAnalyzerContributionDescriptor[];
  connectors?: CoreConnectorContributionDescriptor[];
  filesystems?: CoreFilesystemContributionDescriptor[];
  protocolHandlers?: CoreProtocolHandlerContributionDescriptor[];
  backgroundServices?: CoreBackgroundServiceContributionDescriptor[];
}

export interface HostTargetDescriptor {
  hostId: string;
  versionRange?: string;
  required?: boolean;
  conditions?: Record<string, unknown>;
}

export interface RuntimeEntryDescriptor {
  runtimeId: string;
  kind: 'extension-host' | 'webview' | 'sidecar';
  entry: string;
  platform?: string[];
  arch?: string[];
  priority?: number;
  sandbox?: 'strict' | 'host-supervised' | 'native';
  bridge?: string;
  provides?: string[];
  dataPlane?: {
    kinds: DataPlaneKind[];
  };
}

export type ActivationEventDescriptor =
  | 'onStartup'
  | `onCommand:${string}`
  | `onView:${string}`
  | `onCapability:${string}`
  | `onHost:${string}`
  | `onFile:${string}`
  | {
      kind: string;
      value?: string;
      metadata?: Record<string, unknown>;
    };

export interface DependencyDescriptor {
  id: string;
  kind: 'plugin' | 'host-pack' | 'resource-pack' | 'compat-layer';
  versionRange?: string;
  optional?: boolean;
}

export interface ResourceBundleDescriptor {
  kind: string;
  path: string;
  runtimeId?: string;
  locale?: string;
  metadata?: Record<string, unknown>;
}

export interface ConfigMigrationDescriptor {
  from: string;
  to: string;
  strategy: string;
}

export interface ConfigContributionDescriptor {
  schema: Record<string, unknown>;
  defaults?: Record<string, unknown>;
  migrations?: ConfigMigrationDescriptor[];
  persistenceScope?: 'workspace' | 'profile' | 'device' | 'temp';
  syncScope?: 'none' | 'same-host-windows' | 'same-profile' | 'cloud';
}

export interface LocaleBundleDescriptor {
  locale: string;
  path: string;
  fallback?: boolean;
}

export interface ManifestContributionDescriptor {
  core?: CoreContributionBuckets;
  host?: {
    pmp?: PmpHostManifestContributionDescriptor;
    [hostId: string]: unknown;
  };
}

export interface IntegrityDescriptor {
  manifestDigest?: string;
  artifactDigests?: Array<{
    path: string;
    sha256: string;
  }>;
  signature?: {
    format: string;
    path: string;
  };
}

export interface TrustHintsDescriptor {
  requiresNativeSidecar?: boolean;
  requiresHighFrequencyDataPlane?: boolean;
  requiresNetwork?: boolean;
  preferredTrustLevel?: string;
  notes?: string[];
}

export interface CompatDescriptor {
  compatLayerId: string;
  metadata?: Record<string, unknown>;
}

export interface PxpManifestV2 {
  schemaVersion: '2.0';
  kind: 'extension';
  identity: {
    id: string;
    publisher: string;
    version: string;
    name: string;
    displayName?: string;
    description?: string;
    license?: string;
    homepage?: string;
    repository?: string;
    keywords?: string[];
    categories?: string[];
    icon?: string;
  };
  hostTargets: HostTargetDescriptor[];
  runtimes: RuntimeEntryDescriptor[];
  activationEvents?: ActivationEventDescriptor[];
  requiresCapabilities?: CapabilityRequirement[];
  optionalCapabilities?: CapabilityRequirement[];
  providesCapabilities?: CapabilityProvision[];
  dependencies?: DependencyDescriptor[];
  resourceBundles?: ResourceBundleDescriptor[];
  config?: ConfigContributionDescriptor;
  locales?: LocaleBundleDescriptor[];
  contributes?: ManifestContributionDescriptor;
  integrity?: IntegrityDescriptor;
  trustHints?: TrustHintsDescriptor;
  compat?: CompatDescriptor[];
}

export interface InstalledExtensionRecord<TManifest = PxpManifestV2> {
  manifest: TManifest;
  installedAt: number;
  packageDigest?: string;
  resolvedArtifacts?: Array<{
    runtimeId: string;
    path: string;
    sha256?: string;
  }>;
  signature?: {
    verified: boolean;
    keyId?: string;
    summary?: string;
  };
  enabled: boolean;
  disabledReason?: 'manual' | 'crash' | 'policy';
  deniedCapabilities?: string[];
  lastError?: string;
  lastErrorAt?: number;
}

export interface TelemetryIdentityDescriptor {
  loggerId: string;
  runtimeId?: string;
  pluginId?: string;
  hostId?: string;
  trustLevel?: string;
}

export interface TelemetryEventDescriptor extends TelemetryIdentityDescriptor {
  kind: 'event';
  name: string;
  attributes?: Record<string, unknown>;
}

export interface TelemetryMetricDescriptor extends TelemetryIdentityDescriptor {
  kind: 'metric';
  name: string;
  value: number;
  unit?: string;
  attributes?: Record<string, unknown>;
}

export interface TelemetrySpanDescriptor extends TelemetryIdentityDescriptor {
  kind: 'span';
  name: string;
  spanId?: string;
  parentSpanId?: string;
  startedAt?: number;
  endedAt?: number;
  attributes?: Record<string, unknown>;
}

export type TelemetryDescriptor =
  | TelemetryEventDescriptor
  | TelemetryMetricDescriptor
  | TelemetrySpanDescriptor;

export type LifecycleState =
  | 'install'
  | 'resolved'
  | 'activate'
  | 'suspend'
  | 'disable'
  | 'crash'
  | 'quarantine'
  | 'terminate';

export interface LifecycleOwnershipDescriptor {
  runtime?: string;
  process?: string;
  sessions?: string[];
  resourceHandles?: string[];
  viewIds?: string[];
}
