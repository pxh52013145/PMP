import type {
  CancelRequest,
  CapabilityInvokeRequest,
  CapabilityInvokeResponse,
  CapabilityProtocolMessage,
  DisposeRequest,
  SessionCloseRequest,
  SessionCloseResponse,
  SessionOpenRequest,
  SessionOpenResponse,
  StreamData,
  StreamEnd,
  StreamOpenRequest,
  StreamOpenResponse,
} from '@pixel-matrix/plugin-platform-contracts';
import type {
  PmpmBridgeIncomingMessage,
  PmpmBridgeOutgoingMessage,
} from '@pixel-matrix/plugin-compat-pmpm';
import { PLUGIN_PERMISSIONS, hasPermission, type PluginMountApi } from '../host-api';
import type { PmpmCompatRuntimeResourceRegistry } from './pmpmCompatRuntimeResources';

const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9_.-]{0,127}$/i;
const METHOD_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/i;
const WINDOW_ID_PATTERN = /^[a-z0-9-]{1,48}$/;
const PLAY_MODES = new Set<string>(['sequence', 'loop', 'single-loop', 'shuffle']);

const CORE_CAPABILITY_REGISTRY_ID = 'core.capability-registry';
const AUDIO_PLAYBACK_CAPABILITY_ID = 'host.pmp.audio-engine.playback';
const AUDIO_ANALYSIS_CAPABILITY_ID = 'host.pmp.audio-engine.analysis';
const NAVIGATION_CAPABILITY_ID = 'host.pmp.navigation';
const STORAGE_CONFIG_CAPABILITY_ID = 'host.pmp.storage.config';
const WINDOW_CAPABILITY_ID = 'host.pmp.shell.window';

export const PMPM_COMPAT_CAPABILITY_PROTOCOL_VERSION = '1.0';

type RpcRequest = Extract<PmpmBridgeIncomingMessage, { type: 'pmpm:rpc' }>;
type RpcResultMessage = Extract<PmpmBridgeOutgoingMessage, { type: 'pmpm:rpc-result' }>;

export type PmpmCompatRpcDispatchOptions = {
  runtimeResources?: PmpmCompatRuntimeResourceRegistry;
  emitProtocolMessage?: (message: CapabilityProtocolMessage) => void;
};

export type PmpmCapabilityProtocolRequestMessage =
  | CapabilityInvokeRequest
  | SessionOpenRequest
  | SessionCloseRequest
  | StreamOpenRequest
  | CancelRequest
  | DisposeRequest;

type LegacyResultMode = 'void' | 'data';

type DecodedCapabilityInvokeRequest =
  | {
      source: 'legacy';
      legacyMethod: string;
      legacyResultMode: LegacyResultMode;
      legacyFallbackValue?: unknown;
      request: CapabilityInvokeRequest;
    }
  | {
      source: 'protocol';
      request: CapabilityInvokeRequest;
    };

type LegacyCompatMapping = {
  capabilityId: string;
  method: string;
  buildPayload: (args: unknown[]) => unknown;
  legacyResultMode: LegacyResultMode;
  legacyFallbackValue?: unknown;
};

const LEGACY_COMPAT_METHODS: Record<string, LegacyCompatMapping> = {
  'audio.play': {
    capabilityId: AUDIO_PLAYBACK_CAPABILITY_ID,
    method: 'play',
    buildPayload: () => undefined,
    legacyResultMode: 'void',
  },
  'audio.pause': {
    capabilityId: AUDIO_PLAYBACK_CAPABILITY_ID,
    method: 'pause',
    buildPayload: () => undefined,
    legacyResultMode: 'void',
  },
  'audio.stop': {
    capabilityId: AUDIO_PLAYBACK_CAPABILITY_ID,
    method: 'stop',
    buildPayload: () => undefined,
    legacyResultMode: 'void',
  },
  'audio.seek': {
    capabilityId: AUDIO_PLAYBACK_CAPABILITY_ID,
    method: 'seek',
    buildPayload: (args) => ({ time: args[0] }),
    legacyResultMode: 'void',
  },
  'audio.setVolume': {
    capabilityId: AUDIO_PLAYBACK_CAPABILITY_ID,
    method: 'setVolume',
    buildPayload: (args) => ({ volume: args[0] }),
    legacyResultMode: 'void',
  },
  'audio.toggleMute': {
    capabilityId: AUDIO_PLAYBACK_CAPABILITY_ID,
    method: 'toggleMute',
    buildPayload: () => undefined,
    legacyResultMode: 'void',
  },
  'audio.playNext': {
    capabilityId: AUDIO_PLAYBACK_CAPABILITY_ID,
    method: 'playNext',
    buildPayload: () => undefined,
    legacyResultMode: 'void',
  },
  'audio.playPrevious': {
    capabilityId: AUDIO_PLAYBACK_CAPABILITY_ID,
    method: 'playPrevious',
    buildPayload: () => undefined,
    legacyResultMode: 'void',
  },
  'audio.playTrackAtIndex': {
    capabilityId: AUDIO_PLAYBACK_CAPABILITY_ID,
    method: 'playTrackAtIndex',
    buildPayload: (args) => ({ index: args[0] }),
    legacyResultMode: 'void',
  },
  'audio.setPlayMode': {
    capabilityId: AUDIO_PLAYBACK_CAPABILITY_ID,
    method: 'setPlayMode',
    buildPayload: (args) => ({ mode: args[0] }),
    legacyResultMode: 'void',
  },
  'audio.getCover': {
    capabilityId: AUDIO_PLAYBACK_CAPABILITY_ID,
    method: 'getCover',
    buildPayload: () => undefined,
    legacyResultMode: 'data',
    legacyFallbackValue: null,
  },
  'navigation.navigateTo': {
    capabilityId: NAVIGATION_CAPABILITY_ID,
    method: 'navigateTo',
    buildPayload: (args) => ({ page: args[0], params: args[1] }),
    legacyResultMode: 'void',
  },
  'navigation.goBack': {
    capabilityId: NAVIGATION_CAPABILITY_ID,
    method: 'goBack',
    buildPayload: () => undefined,
    legacyResultMode: 'void',
  },
  'config.set': {
    capabilityId: STORAGE_CONFIG_CAPABILITY_ID,
    method: 'set',
    buildPayload: (args) => ({ value: args[0] }),
    legacyResultMode: 'void',
  },
  'config.patch': {
    capabilityId: STORAGE_CONFIG_CAPABILITY_ID,
    method: 'patch',
    buildPayload: (args) => ({ value: args[0] }),
    legacyResultMode: 'void',
  },
  'config.reset': {
    capabilityId: STORAGE_CONFIG_CAPABILITY_ID,
    method: 'reset',
    buildPayload: () => undefined,
    legacyResultMode: 'void',
  },
  'window.open': {
    capabilityId: WINDOW_CAPABILITY_ID,
    method: 'open',
    buildPayload: (args) => ({ windowId: args[0], options: args[1] }),
    legacyResultMode: 'void',
  },
  'window.close': {
    capabilityId: WINDOW_CAPABILITY_ID,
    method: 'close',
    buildPayload: (args) => ({ windowId: args[0] }),
    legacyResultMode: 'void',
  },
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asNonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : null;
}

function asWindowId(value: unknown): string | null {
  const normalized = asNonEmptyString(value);
  if (!normalized) return null;
  return WINDOW_ID_PATTERN.test(normalized) ? normalized : null;
}

function buildResponseBase(
  request: CapabilityInvokeRequest
): Omit<CapabilityInvokeResponse, 'op' | 'ok' | 'data' | 'error'> {
  return {
    protocolVersion: request.protocolVersion || PMPM_COMPAT_CAPABILITY_PROTOCOL_VERSION,
    requestId: request.requestId,
    capabilityId: request.capabilityId,
    handleId: request.handleId,
    pluginId: request.pluginId,
    runtimeId: request.runtimeId,
    sessionId: request.sessionId,
    streamId: request.streamId,
    traceId: request.traceId,
  };
}

function responseOk(request: CapabilityInvokeRequest, data: unknown): CapabilityInvokeResponse {
  return {
    ...buildResponseBase(request),
    op: 'capability.invoke.response',
    ok: true,
    data,
  };
}

function responseError(
  request: CapabilityInvokeRequest,
  code: string,
  message: string,
  options?: { retryable?: boolean; details?: unknown }
): CapabilityInvokeResponse {
  return {
    ...buildResponseBase(request),
    op: 'capability.invoke.response',
    ok: false,
    error: {
      code,
      message,
      retryable: options?.retryable,
      details: options?.details,
    },
  };
}

function buildSessionResponseBase(
  request: SessionOpenRequest | SessionCloseRequest
): {
  protocolVersion: string;
  requestId: string;
  capabilityId?: string;
  handleId?: string;
  pluginId?: string;
  runtimeId?: string;
  sessionId?: string;
  streamId?: string;
  traceId?: string;
} {
  return {
    protocolVersion: request.protocolVersion || PMPM_COMPAT_CAPABILITY_PROTOCOL_VERSION,
    requestId: request.requestId,
    capabilityId: request.capabilityId,
    handleId: request.handleId,
    pluginId: request.pluginId,
    runtimeId: request.runtimeId,
    sessionId: request.sessionId,
    streamId: request.streamId,
    traceId: request.traceId,
  };
}

function buildStreamResponseBase(
  request: StreamOpenRequest
): {
  protocolVersion: string;
  requestId: string;
  capabilityId?: string;
  handleId?: string;
  pluginId?: string;
  runtimeId?: string;
  sessionId?: string;
  streamId?: string;
  traceId?: string;
} {
  return {
    protocolVersion: request.protocolVersion || PMPM_COMPAT_CAPABILITY_PROTOCOL_VERSION,
    requestId: request.requestId,
    capabilityId: request.capabilityId,
    handleId: request.handleId,
    pluginId: request.pluginId,
    runtimeId: request.runtimeId,
    sessionId: request.sessionId,
    streamId: request.streamId,
    traceId: request.traceId,
  };
}

function buildStreamMessageBase(
  request: StreamOpenRequest,
  streamId: string
): {
  protocolVersion: string;
  requestId: string;
  capabilityId?: string;
  handleId?: string;
  pluginId?: string;
  runtimeId?: string;
  sessionId?: string;
  streamId: string;
  traceId?: string;
} {
  return {
    protocolVersion: request.protocolVersion || PMPM_COMPAT_CAPABILITY_PROTOCOL_VERSION,
    requestId: request.requestId,
    capabilityId: request.capabilityId,
    handleId: request.handleId,
    pluginId: request.pluginId,
    runtimeId: request.runtimeId,
    sessionId: request.sessionId,
    streamId,
    traceId: request.traceId,
  };
}

function sessionOpenResponseOk(
  request: SessionOpenRequest,
  payload: { sessionId: string; providerSessionId?: string; metadata?: unknown }
): SessionOpenResponse {
  return {
    ...buildSessionResponseBase(request),
    op: 'session.open.response',
    ok: true,
    sessionId: payload.sessionId,
    providerSessionId: payload.providerSessionId,
    metadata: payload.metadata,
  };
}

function sessionOpenResponseError(
  request: SessionOpenRequest,
  code: string,
  message: string,
  options?: { retryable?: boolean; details?: unknown }
): SessionOpenResponse {
  return {
    ...buildSessionResponseBase(request),
    op: 'session.open.response',
    ok: false,
    error: {
      code,
      message,
      retryable: options?.retryable,
      details: options?.details,
    },
  };
}

function sessionCloseResponseOk(request: SessionCloseRequest): SessionCloseResponse {
  return {
    ...buildSessionResponseBase(request),
    op: 'session.close.response',
    ok: true,
  };
}

function sessionCloseResponseError(
  request: SessionCloseRequest,
  code: string,
  message: string,
  options?: { retryable?: boolean; details?: unknown }
): SessionCloseResponse {
  return {
    ...buildSessionResponseBase(request),
    op: 'session.close.response',
    ok: false,
    error: {
      code,
      message,
      retryable: options?.retryable,
      details: options?.details,
    },
  };
}

function streamOpenResponseOk(
  request: StreamOpenRequest,
  payload: {
    streamId: string;
    mode: 'push' | 'pull';
    transport: 'inline-json' | 'shared-memory' | 'pipe' | 'local-socket';
  }
): StreamOpenResponse {
  return {
    ...buildStreamResponseBase(request),
    op: 'stream.open.response',
    ok: true,
    streamId: payload.streamId,
    mode: payload.mode,
    transport: payload.transport,
  };
}

function streamOpenResponseError(
  request: StreamOpenRequest,
  code: string,
  message: string,
  options?: { retryable?: boolean; details?: unknown }
): StreamOpenResponse {
  return {
    ...buildStreamResponseBase(request),
    op: 'stream.open.response',
    ok: false,
    error: {
      code,
      message,
      retryable: options?.retryable,
      details: options?.details,
    },
  };
}

function normalizeProtocolRequest(rpcRequest: RpcRequest): CapabilityInvokeRequest {
  const args = Array.isArray(rpcRequest.args) ? rpcRequest.args : [];
  const rawRequest = asObject(args[0]);
  if (!rawRequest) {
    throw new Error('capability.invoke.request requires a request envelope');
  }

  const capabilityId = asNonEmptyString(rawRequest.capabilityId);
  const method = asNonEmptyString(rawRequest.method);
  const requestId = asNonEmptyString(rawRequest.requestId) ?? rpcRequest.id;
  const protocolVersion =
    asNonEmptyString(rawRequest.protocolVersion) ?? PMPM_COMPAT_CAPABILITY_PROTOCOL_VERSION;

  if (!capabilityId || !CAPABILITY_ID_PATTERN.test(capabilityId)) {
    throw new Error('capability.invoke.request requires a valid capabilityId');
  }
  if (!method || !METHOD_PATTERN.test(method)) {
    throw new Error('capability.invoke.request requires a valid method');
  }

  return {
    protocolVersion,
    op: 'capability.invoke.request',
    requestId,
    capabilityId,
    method,
    payload: rawRequest.payload,
    handleId: asNonEmptyString(rawRequest.handleId) ?? undefined,
    pluginId: asNonEmptyString(rawRequest.pluginId) ?? undefined,
    runtimeId: asNonEmptyString(rawRequest.runtimeId) ?? undefined,
    sessionId: asNonEmptyString(rawRequest.sessionId) ?? undefined,
    streamId: asNonEmptyString(rawRequest.streamId) ?? undefined,
    traceId: asNonEmptyString(rawRequest.traceId) ?? undefined,
  };
}

function normalizeDirectCompatCapabilityInvokeRequest(rpcRequest: RpcRequest): CapabilityInvokeRequest {
  const args = Array.isArray(rpcRequest.args) ? rpcRequest.args : [];
  const capabilityId = asNonEmptyString(args[0]);
  const method = asNonEmptyString(args[1]);

  if (!capabilityId || !CAPABILITY_ID_PATTERN.test(capabilityId)) {
    throw new Error('host.invokeCapability requires a valid capabilityId');
  }
  if (!method || !METHOD_PATTERN.test(method)) {
    throw new Error('host.invokeCapability requires a valid method');
  }

  return {
    protocolVersion: PMPM_COMPAT_CAPABILITY_PROTOCOL_VERSION,
    op: 'capability.invoke.request',
    requestId: `compat-host-capability:${rpcRequest.id}`,
    capabilityId,
    method,
    payload: args[2],
  };
}

function normalizeSessionOpenRequest(rpcRequest: RpcRequest): SessionOpenRequest {
  const args = Array.isArray(rpcRequest.args) ? rpcRequest.args : [];
  const rawRequest = asObject(args[0]);
  if (!rawRequest) {
    throw new Error('session.open.request requires a request envelope');
  }

  const capabilityId = asNonEmptyString(rawRequest.capabilityId);
  const method = asNonEmptyString(rawRequest.method);
  const requestId = asNonEmptyString(rawRequest.requestId) ?? rpcRequest.id;
  const protocolVersion =
    asNonEmptyString(rawRequest.protocolVersion) ?? PMPM_COMPAT_CAPABILITY_PROTOCOL_VERSION;

  if (!capabilityId || !CAPABILITY_ID_PATTERN.test(capabilityId)) {
    throw new Error('session.open.request requires a valid capabilityId');
  }
  if (!method || !METHOD_PATTERN.test(method)) {
    throw new Error('session.open.request requires a valid method');
  }

  return {
    protocolVersion,
    op: 'session.open.request',
    requestId,
    capabilityId,
    method,
    payload: rawRequest.payload,
    handleId: asNonEmptyString(rawRequest.handleId) ?? undefined,
    pluginId: asNonEmptyString(rawRequest.pluginId) ?? undefined,
    runtimeId: asNonEmptyString(rawRequest.runtimeId) ?? undefined,
    sessionId: asNonEmptyString(rawRequest.sessionId) ?? undefined,
    streamId: asNonEmptyString(rawRequest.streamId) ?? undefined,
    traceId: asNonEmptyString(rawRequest.traceId) ?? undefined,
  };
}

function normalizeSessionCloseRequest(rpcRequest: RpcRequest): SessionCloseRequest {
  const args = Array.isArray(rpcRequest.args) ? rpcRequest.args : [];
  const rawRequest = asObject(args[0]);
  if (!rawRequest) {
    throw new Error('session.close.request requires a request envelope');
  }

  const capabilityId = asNonEmptyString(rawRequest.capabilityId);
  const sessionId = asNonEmptyString(rawRequest.sessionId);
  const requestId = asNonEmptyString(rawRequest.requestId) ?? rpcRequest.id;
  const protocolVersion =
    asNonEmptyString(rawRequest.protocolVersion) ?? PMPM_COMPAT_CAPABILITY_PROTOCOL_VERSION;

  if (!capabilityId || !CAPABILITY_ID_PATTERN.test(capabilityId)) {
    throw new Error('session.close.request requires a valid capabilityId');
  }
  if (!sessionId) {
    throw new Error('session.close.request requires sessionId');
  }

  return {
    protocolVersion,
    op: 'session.close.request',
    requestId,
    capabilityId,
    sessionId,
    reason: asNonEmptyString(rawRequest.reason) ?? undefined,
    handleId: asNonEmptyString(rawRequest.handleId) ?? undefined,
    pluginId: asNonEmptyString(rawRequest.pluginId) ?? undefined,
    runtimeId: asNonEmptyString(rawRequest.runtimeId) ?? undefined,
    streamId: asNonEmptyString(rawRequest.streamId) ?? undefined,
    traceId: asNonEmptyString(rawRequest.traceId) ?? undefined,
  };
}

function normalizeStreamOpenRequest(rpcRequest: RpcRequest): StreamOpenRequest {
  const args = Array.isArray(rpcRequest.args) ? rpcRequest.args : [];
  const rawRequest = asObject(args[0]);
  if (!rawRequest) {
    throw new Error('stream.open.request requires a request envelope');
  }

  const capabilityId = asNonEmptyString(rawRequest.capabilityId);
  const method = asNonEmptyString(rawRequest.method);
  const requestId = asNonEmptyString(rawRequest.requestId) ?? rpcRequest.id;
  const protocolVersion =
    asNonEmptyString(rawRequest.protocolVersion) ?? PMPM_COMPAT_CAPABILITY_PROTOCOL_VERSION;

  if (!capabilityId || !CAPABILITY_ID_PATTERN.test(capabilityId)) {
    throw new Error('stream.open.request requires a valid capabilityId');
  }
  if (!method || !METHOD_PATTERN.test(method)) {
    throw new Error('stream.open.request requires a valid method');
  }

  return {
    protocolVersion,
    op: 'stream.open.request',
    requestId,
    capabilityId,
    method,
    payload: rawRequest.payload,
    handleId: asNonEmptyString(rawRequest.handleId) ?? undefined,
    pluginId: asNonEmptyString(rawRequest.pluginId) ?? undefined,
    runtimeId: asNonEmptyString(rawRequest.runtimeId) ?? undefined,
    sessionId: asNonEmptyString(rawRequest.sessionId) ?? undefined,
    streamId: asNonEmptyString(rawRequest.streamId) ?? undefined,
    traceId: asNonEmptyString(rawRequest.traceId) ?? undefined,
  };
}

function normalizeCancelRequest(rpcRequest: RpcRequest): CancelRequest {
  const args = Array.isArray(rpcRequest.args) ? rpcRequest.args : [];
  const rawRequest = asObject(args[0]);
  if (!rawRequest) {
    throw new Error('cancel.request requires a request envelope');
  }

  const requestId = asNonEmptyString(rawRequest.requestId) ?? rpcRequest.id;
  const protocolVersion =
    asNonEmptyString(rawRequest.protocolVersion) ?? PMPM_COMPAT_CAPABILITY_PROTOCOL_VERSION;
  const streamId = asNonEmptyString(rawRequest.streamId) ?? undefined;
  const sessionId = asNonEmptyString(rawRequest.sessionId) ?? undefined;

  if (!streamId && !sessionId && !asNonEmptyString(rawRequest.targetRequestId)) {
    throw new Error('cancel.request requires streamId, sessionId, or targetRequestId');
  }

  return {
    protocolVersion,
    op: 'cancel.request',
    requestId,
    targetRequestId: asNonEmptyString(rawRequest.targetRequestId) ?? undefined,
    capabilityId: asNonEmptyString(rawRequest.capabilityId) ?? undefined,
    handleId: asNonEmptyString(rawRequest.handleId) ?? undefined,
    pluginId: asNonEmptyString(rawRequest.pluginId) ?? undefined,
    runtimeId: asNonEmptyString(rawRequest.runtimeId) ?? undefined,
    streamId,
    sessionId,
    traceId: asNonEmptyString(rawRequest.traceId) ?? undefined,
    reason: asNonEmptyString(rawRequest.reason) ?? undefined,
  };
}

function normalizeDisposeRequest(rpcRequest: RpcRequest): DisposeRequest {
  const args = Array.isArray(rpcRequest.args) ? rpcRequest.args : [];
  const rawRequest = asObject(args[0]);
  if (!rawRequest) {
    throw new Error('dispose.request requires a request envelope');
  }

  const requestId = asNonEmptyString(rawRequest.requestId) ?? rpcRequest.id;
  const protocolVersion =
    asNonEmptyString(rawRequest.protocolVersion) ?? PMPM_COMPAT_CAPABILITY_PROTOCOL_VERSION;
  const streamId = asNonEmptyString(rawRequest.streamId) ?? undefined;
  const sessionId = asNonEmptyString(rawRequest.sessionId) ?? undefined;
  const handleId = asNonEmptyString(rawRequest.handleId) ?? undefined;

  if (!streamId && !sessionId && !handleId) {
    throw new Error('dispose.request requires streamId, sessionId, or handleId');
  }

  return {
    protocolVersion,
    op: 'dispose.request',
    requestId,
    capabilityId: asNonEmptyString(rawRequest.capabilityId) ?? undefined,
    handleId,
    pluginId: asNonEmptyString(rawRequest.pluginId) ?? undefined,
    runtimeId: asNonEmptyString(rawRequest.runtimeId) ?? undefined,
    streamId,
    sessionId,
    traceId: asNonEmptyString(rawRequest.traceId) ?? undefined,
    reason: asNonEmptyString(rawRequest.reason) ?? undefined,
  };
}

export function decodePmpmCompatCapabilityInvokeRequest(
  rpcRequest: RpcRequest
): DecodedCapabilityInvokeRequest | null {
  if (rpcRequest.method === 'capability.invoke.request') {
    return {
      source: 'protocol',
      request: normalizeProtocolRequest(rpcRequest),
    };
  }

  const mapping = LEGACY_COMPAT_METHODS[rpcRequest.method];
  if (!mapping) return null;

  const args = Array.isArray(rpcRequest.args) ? rpcRequest.args : [];
  return {
    source: 'legacy',
    legacyMethod: rpcRequest.method,
    legacyResultMode: mapping.legacyResultMode,
    legacyFallbackValue: mapping.legacyFallbackValue,
    request: {
      protocolVersion: PMPM_COMPAT_CAPABILITY_PROTOCOL_VERSION,
      op: 'capability.invoke.request',
      requestId: `compat:${rpcRequest.id}`,
      capabilityId: mapping.capabilityId,
      method: mapping.method,
      payload: mapping.buildPayload(args),
    },
  };
}

async function dispatchRegistryCapability(
  api: PluginMountApi,
  permissions: ReadonlySet<string>,
  request: CapabilityInvokeRequest
): Promise<CapabilityInvokeResponse> {
  if (!hasPermission(permissions, PLUGIN_PERMISSIONS.host)) {
    return responseError(request, 'FORBIDDEN', `Permission denied: ${PLUGIN_PERMISSIONS.host}`);
  }

  const visibleCapabilities = await api.host.listCapabilities();

  switch (request.method) {
    case 'describe':
      return responseOk(request, {
        capabilityId: CORE_CAPABILITY_REGISTRY_ID,
        methods: ['describe', 'list', 'get', 'has'],
        visibility: 'host-scoped',
      });
    case 'list':
      return responseOk(request, visibleCapabilities);
    case 'get': {
      const payload = asObject(request.payload);
      const capabilityId = asNonEmptyString(payload?.id);
      if (!capabilityId) {
        return responseError(request, 'INVALID_PAYLOAD', 'payload.id is required');
      }
      const capability = visibleCapabilities.find((entry) => entry.id === capabilityId) ?? null;
      if (!capability) {
        return responseError(request, 'NOT_FOUND', `Unknown capability: ${capabilityId}`);
      }
      return responseOk(request, capability);
    }
    case 'has': {
      const payload = asObject(request.payload);
      const capabilityId = asNonEmptyString(payload?.id);
      if (!capabilityId) {
        return responseError(request, 'INVALID_PAYLOAD', 'payload.id is required');
      }
      return responseOk(request, {
        id: capabilityId,
        visible: visibleCapabilities.some((entry) => entry.id === capabilityId),
      });
    }
    default:
      return responseError(
        request,
        'METHOD_NOT_SUPPORTED',
        `Unsupported registry method: ${request.method}`
      );
  }
}

async function dispatchDirectHostCapabilityInvokeRequest(
  api: PluginMountApi,
  permissions: ReadonlySet<string>,
  request: CapabilityInvokeRequest
): Promise<CapabilityInvokeResponse> {
  if (!hasPermission(permissions, PLUGIN_PERMISSIONS.host)) {
    return responseError(request, 'FORBIDDEN', `Permission denied: ${PLUGIN_PERMISSIONS.host}`);
  }
  if (!hasPermission(permissions, PLUGIN_PERMISSIONS.hostCapabilityInvoke)) {
    return responseError(
      request,
      'FORBIDDEN',
      `Permission denied: ${PLUGIN_PERMISSIONS.hostCapabilityInvoke}`
    );
  }

  try {
    return responseOk(
      request,
      await api.host.invokeCapability(request.capabilityId, request.method, request.payload)
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return responseError(
      request,
      message.startsWith('Permission denied:') ? 'FORBIDDEN' : 'INVOKE_FAILED',
      message
    );
  }
}

async function dispatchDirectHostSessionOpenRequest(
  api: PluginMountApi,
  permissions: ReadonlySet<string>,
  request: SessionOpenRequest
): Promise<SessionOpenResponse> {
  if (!hasPermission(permissions, PLUGIN_PERMISSIONS.host)) {
    return sessionOpenResponseError(
      request,
      'FORBIDDEN',
      `Permission denied: ${PLUGIN_PERMISSIONS.host}`
    );
  }
  if (!hasPermission(permissions, PLUGIN_PERMISSIONS.hostCapabilityInvoke)) {
    return sessionOpenResponseError(
      request,
      'FORBIDDEN',
      `Permission denied: ${PLUGIN_PERMISSIONS.hostCapabilityInvoke}`
    );
  }

  try {
    const opened = await api.host.openSession(request.capabilityId, request.method, request.payload);
    if (!opened) {
      return sessionOpenResponseError(
        request,
        'NOT_AVAILABLE',
        'Host session API is not available'
      );
    }

    return sessionOpenResponseOk(request, opened);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return sessionOpenResponseError(
      request,
      message.startsWith('Permission denied:') ? 'FORBIDDEN' : 'OPEN_SESSION_FAILED',
      message
    );
  }
}

async function dispatchDirectHostSessionCloseRequest(
  api: PluginMountApi,
  permissions: ReadonlySet<string>,
  request: SessionCloseRequest
): Promise<SessionCloseResponse> {
  if (!hasPermission(permissions, PLUGIN_PERMISSIONS.host)) {
    return sessionCloseResponseError(
      request,
      'FORBIDDEN',
      `Permission denied: ${PLUGIN_PERMISSIONS.host}`
    );
  }
  if (!hasPermission(permissions, PLUGIN_PERMISSIONS.hostCapabilityInvoke)) {
    return sessionCloseResponseError(
      request,
      'FORBIDDEN',
      `Permission denied: ${PLUGIN_PERMISSIONS.hostCapabilityInvoke}`
    );
  }

  try {
    await api.host.closeSession(request.capabilityId, request.sessionId, request.reason);
    return sessionCloseResponseOk(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return sessionCloseResponseError(
      request,
      message.startsWith('Permission denied:') ? 'FORBIDDEN' : 'CLOSE_SESSION_FAILED',
      message
    );
  }
}

async function dispatchDirectHostStreamOpenRequest(
  api: PluginMountApi,
  permissions: ReadonlySet<string>,
  request: StreamOpenRequest,
  options?: PmpmCompatRpcDispatchOptions
): Promise<StreamOpenResponse> {
  if (!hasPermission(permissions, PLUGIN_PERMISSIONS.host)) {
    return streamOpenResponseError(
      request,
      'FORBIDDEN',
      `Permission denied: ${PLUGIN_PERMISSIONS.host}`
    );
  }
  if (!hasPermission(permissions, PLUGIN_PERMISSIONS.hostCapabilityInvoke)) {
    return streamOpenResponseError(
      request,
      'FORBIDDEN',
      `Permission denied: ${PLUGIN_PERMISSIONS.hostCapabilityInvoke}`
    );
  }
  if (!options?.runtimeResources || !options.emitProtocolMessage) {
    return streamOpenResponseError(
      request,
      'NOT_AVAILABLE',
      'Compat runtime resources are not available for stream transport'
    );
  }

  try {
    const opened = await api.host.openStream(request.capabilityId, request.method, request.payload);
    if (!opened) {
      return streamOpenResponseError(
        request,
        'NOT_AVAILABLE',
        'Host stream API is not available'
      );
    }

    let released = false;
    let unlistenData: (() => void) | null = null;
    let unlistenEnd: (() => void) | null = null;

    const release = () => {
      if (released) return;
      released = true;
      try {
        unlistenData?.();
      } catch {
        // ignore
      }
      try {
        unlistenEnd?.();
      } catch {
        // ignore
      }
      unlistenData = null;
      unlistenEnd = null;
    };

    unlistenData = opened.onData((payload, envelope) => {
      const message: StreamData = {
        ...buildStreamMessageBase(request, opened.streamId),
        op: 'stream.data',
        sequence: envelope.sequence,
        payload,
        handles: envelope.handles,
      };
      options.emitProtocolMessage?.(message);
    });

    unlistenEnd = opened.onEnd((reason) => {
      options.runtimeResources?.releaseStream(opened.streamId);
      const message: StreamEnd = {
        ...buildStreamMessageBase(request, opened.streamId),
        op: 'stream.end',
        reason,
      };
      options.emitProtocolMessage?.(message);
      release();
    });

    options.runtimeResources.trackStream({
      capabilityId: request.capabilityId,
      streamId: opened.streamId,
      cancel: opened.cancel,
      dispose: opened.dispose,
      release,
    });

    return streamOpenResponseOk(request, {
      streamId: opened.streamId,
      mode: opened.mode,
      transport: opened.transport,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return streamOpenResponseError(
      request,
      message.startsWith('Permission denied:') ? 'FORBIDDEN' : 'OPEN_STREAM_FAILED',
      message
    );
  }
}

async function dispatchCancelRequest(
  request: CancelRequest,
  options?: PmpmCompatRpcDispatchOptions
): Promise<void> {
  if (request.streamId) {
    const cancelled = await options?.runtimeResources?.cancelStream(
      request.streamId,
      request.reason ?? 'cancelled'
    );
    if (cancelled) return;
    throw new Error(`Unknown stream: ${request.streamId}`);
  }

  if (request.sessionId) {
    const disposed = await options?.runtimeResources?.disposeSession(
      request.sessionId,
      request.reason ?? 'cancelled',
      request.capabilityId
    );
    if (disposed) return;
    throw new Error(`Unknown session: ${request.sessionId}`);
  }

  throw new Error('cancel.request target is not supported by the compat carrier');
}

async function dispatchDisposeRequest(
  request: DisposeRequest,
  options?: PmpmCompatRpcDispatchOptions
): Promise<void> {
  if (request.streamId) {
    const disposed = await options?.runtimeResources?.disposeStream(
      request.streamId,
      request.reason ?? 'disposed'
    );
    if (disposed) return;
    throw new Error(`Unknown stream: ${request.streamId}`);
  }

  if (request.sessionId) {
    const disposed = await options?.runtimeResources?.disposeSession(
      request.sessionId,
      request.reason ?? 'disposed',
      request.capabilityId
    );
    if (disposed) return;
    throw new Error(`Unknown session: ${request.sessionId}`);
  }

  if (request.handleId) {
    throw new Error(`Compat carrier does not support handle disposal: ${request.handleId}`);
  }

  throw new Error('dispose.request target is not supported by the compat carrier');
}

async function dispatchAudioPlaybackCapability(
  api: PluginMountApi,
  permissions: ReadonlySet<string>,
  request: CapabilityInvokeRequest
): Promise<CapabilityInvokeResponse> {
  switch (request.method) {
    case 'describe':
      return responseOk(request, {
        capabilityId: AUDIO_PLAYBACK_CAPABILITY_ID,
        methods: [
          'describe',
          'getState',
          'getPlayMode',
          'getCover',
          'play',
          'pause',
          'stop',
          'seek',
          'setVolume',
          'toggleMute',
          'playNext',
          'playPrevious',
          'playTrackAtIndex',
          'setPlayMode',
        ],
      });
    case 'getState':
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.audioState)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.audioState}`
        );
      }
      return responseOk(request, api.audio.getState());
    case 'getPlayMode':
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.audioState)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.audioState}`
        );
      }
      return responseOk(request, api.audio.getPlayMode());
    case 'getCover':
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.audioCover)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.audioCover}`
        );
      }
      return responseOk(request, await api.audio.getCover());
    case 'play':
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.audioControl)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.audioControl}`
        );
      }
      await api.audio.play();
      return responseOk(request, { played: true });
    case 'pause':
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.audioControl)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.audioControl}`
        );
      }
      await api.audio.pause();
      return responseOk(request, { paused: true });
    case 'stop':
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.audioControl)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.audioControl}`
        );
      }
      api.audio.stop();
      return responseOk(request, { stopped: true });
    case 'seek': {
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.audioControl)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.audioControl}`
        );
      }
      const payload = asObject(request.payload);
      const time = asFiniteNumber(payload?.time);
      if (time === null || time < 0) {
        return responseError(request, 'INVALID_PAYLOAD', 'payload.time must be a non-negative number');
      }
      api.audio.seek(time);
      return responseOk(request, { time });
    }
    case 'setVolume': {
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.audioControl)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.audioControl}`
        );
      }
      const payload = asObject(request.payload);
      const volume = asFiniteNumber(payload?.volume);
      if (volume === null) {
        return responseError(request, 'INVALID_PAYLOAD', 'payload.volume must be a number');
      }
      api.audio.setVolume(volume);
      return responseOk(request, { volume });
    }
    case 'toggleMute':
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.audioControl)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.audioControl}`
        );
      }
      api.audio.toggleMute();
      return responseOk(request, { toggled: true });
    case 'playNext':
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.audioControl)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.audioControl}`
        );
      }
      await api.audio.playNext();
      return responseOk(request, { playedNext: true });
    case 'playPrevious':
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.audioControl)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.audioControl}`
        );
      }
      await api.audio.playPrevious();
      return responseOk(request, { playedPrevious: true });
    case 'playTrackAtIndex': {
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.audioControl)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.audioControl}`
        );
      }
      const payload = asObject(request.payload);
      const index = asNonNegativeInt(payload?.index);
      if (index === null) {
        return responseError(
          request,
          'INVALID_PAYLOAD',
          'payload.index must be a non-negative integer'
        );
      }
      await api.audio.playTrackAtIndex(index);
      return responseOk(request, { index });
    }
    case 'setPlayMode': {
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.audioControl)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.audioControl}`
        );
      }
      const payload = asObject(request.payload);
      const mode = asNonEmptyString(payload?.mode);
      if (!mode) {
        return responseError(request, 'INVALID_PAYLOAD', 'payload.mode is required');
      }
      if (!PLAY_MODES.has(mode)) {
        return responseError(
          request,
          'INVALID_PAYLOAD',
          `payload.mode must be one of: ${Array.from(PLAY_MODES).join(', ')}`
        );
      }
      api.audio.setPlayMode(mode);
      return responseOk(request, { mode });
    }
    default:
      return responseError(
        request,
        'METHOD_NOT_SUPPORTED',
        `Unsupported audio-engine.playback method: ${request.method}`
      );
  }
}

async function dispatchAudioAnalysisCapability(
  api: PluginMountApi,
  permissions: ReadonlySet<string>,
  request: CapabilityInvokeRequest
): Promise<CapabilityInvokeResponse> {
  switch (request.method) {
    case 'describe':
      return responseOk(request, {
        capabilityId: AUDIO_ANALYSIS_CAPABILITY_ID,
        methods: ['describe', 'getSpectrum', 'getSpectrumFrame'],
        streamMethods: ['openSpectrumFrameStream'],
      });
    case 'getSpectrum':
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.audioVisual)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.audioVisual}`
        );
      }
      return responseOk(request, api.visualizer.getSpectrum());
    case 'getSpectrumFrame':
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.audioVisual)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.audioVisual}`
        );
      }
      return responseOk(
        request,
        api.visualizer.getSpectrumFrame({
          tap: asObject(request.payload)?.tap === 'pre-dsp' ? 'pre-dsp' : 'post-dsp',
        })
      );
    default:
      return responseError(
        request,
        'METHOD_NOT_SUPPORTED',
        `Unsupported audio-engine.analysis method: ${request.method}`
      );
  }
}

async function dispatchNavigationCapability(
  api: PluginMountApi,
  permissions: ReadonlySet<string>,
  request: CapabilityInvokeRequest
): Promise<CapabilityInvokeResponse> {
  switch (request.method) {
    case 'describe':
      return responseOk(request, {
        capabilityId: NAVIGATION_CAPABILITY_ID,
        methods: ['describe', 'getSnapshot', 'canGoBack', 'navigateTo', 'goBack'],
      });
    case 'getSnapshot':
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.navigation)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.navigation}`
        );
      }
      return responseOk(request, api.navigation.getSnapshot());
    case 'canGoBack': {
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.navigation)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.navigation}`
        );
      }
      const snapshot = api.navigation.getSnapshot();
      const canGoBack = Boolean(
        snapshot &&
          typeof snapshot === 'object' &&
          typeof snapshot.currentIndex === 'number' &&
          snapshot.currentIndex > 0
      );
      return responseOk(request, { canGoBack });
    }
    case 'navigateTo': {
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.navigation)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.navigation}`
        );
      }
      const payload = asObject(request.payload);
      const page = asNonEmptyString(payload?.page);
      if (!page) {
        return responseError(request, 'INVALID_PAYLOAD', 'payload.page is required');
      }
      if (
        typeof payload?.params !== 'undefined' &&
        payload.params !== null &&
        !asObject(payload.params)
      ) {
        return responseError(request, 'INVALID_PAYLOAD', 'payload.params must be an object');
      }
      api.navigation.navigateTo(page as never, (asObject(payload?.params) ?? undefined) as never);
      return responseOk(request, {
        page,
        navigated: true,
      });
    }
    case 'goBack':
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.navigation)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.navigation}`
        );
      }
      api.navigation.goBack();
      return responseOk(request, { wentBack: true });
    default:
      return responseError(
        request,
        'METHOD_NOT_SUPPORTED',
        `Unsupported navigation method: ${request.method}`
      );
  }
}

async function dispatchStorageConfigCapability(
  api: PluginMountApi,
  permissions: ReadonlySet<string>,
  request: CapabilityInvokeRequest
): Promise<CapabilityInvokeResponse> {
  switch (request.method) {
    case 'describe':
      return responseOk(request, {
        capabilityId: STORAGE_CONFIG_CAPABILITY_ID,
        methods: ['describe', 'get', 'set', 'patch', 'reset'],
      });
    case 'get':
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.configLocal)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.configLocal}`
        );
      }
      return responseOk(request, api.config.get());
    case 'set': {
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.configLocal)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.configLocal}`
        );
      }
      const payload = asObject(request.payload);
      const nextValue = asObject(payload?.value) ?? payload;
      if (!nextValue || Array.isArray(nextValue)) {
        return responseError(request, 'INVALID_PAYLOAD', 'payload must be an object');
      }
      api.config.set(nextValue);
      return responseOk(request, api.config.get());
    }
    case 'patch': {
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.configLocal)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.configLocal}`
        );
      }
      const payload = asObject(request.payload);
      const patchValue = asObject(payload?.value) ?? payload;
      if (!patchValue || Array.isArray(patchValue)) {
        return responseError(request, 'INVALID_PAYLOAD', 'payload must be an object');
      }
      api.config.patch(patchValue);
      return responseOk(request, api.config.get());
    }
    case 'reset':
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.configLocal)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.configLocal}`
        );
      }
      api.config.reset();
      return responseOk(request, api.config.get());
    default:
      return responseError(
        request,
        'METHOD_NOT_SUPPORTED',
        `Unsupported storage.config method: ${request.method}`
      );
  }
}

async function dispatchWindowCapability(
  api: PluginMountApi,
  permissions: ReadonlySet<string>,
  request: CapabilityInvokeRequest
): Promise<CapabilityInvokeResponse> {
  switch (request.method) {
    case 'describe':
      return responseOk(request, {
        capabilityId: WINDOW_CAPABILITY_ID,
        methods: ['describe', 'open', 'close'],
      });
    case 'open': {
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.window)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.window}`
        );
      }
      const payload = asObject(request.payload);
      const windowId = asWindowId(payload?.windowId);
      if (!windowId) {
        return responseError(request, 'INVALID_PAYLOAD', 'payload.windowId is required');
      }
      if (
        typeof payload?.options !== 'undefined' &&
        payload.options !== null &&
        !asObject(payload.options)
      ) {
        return responseError(request, 'INVALID_PAYLOAD', 'payload.options must be an object');
      }
      await api.window.open(windowId, (asObject(payload?.options) ?? undefined) as never);
      return responseOk(request, {
        opened: true,
        windowId,
      });
    }
    case 'close': {
      if (!hasPermission(permissions, PLUGIN_PERMISSIONS.window)) {
        return responseError(
          request,
          'FORBIDDEN',
          `Permission denied: ${PLUGIN_PERMISSIONS.window}`
        );
      }
      const payload = asObject(request.payload);
      const windowId = asWindowId(payload?.windowId);
      if (!windowId) {
        return responseError(request, 'INVALID_PAYLOAD', 'payload.windowId is required');
      }
      await api.window.close(windowId);
      return responseOk(request, {
        closed: true,
        windowId,
      });
    }
    default:
      return responseError(
        request,
        'METHOD_NOT_SUPPORTED',
        `Unsupported shell.window method: ${request.method}`
      );
  }
}

export async function dispatchPmpmCompatCapabilityInvokeRequest(
  api: PluginMountApi,
  permissions: ReadonlySet<string>,
  request: CapabilityInvokeRequest
): Promise<CapabilityInvokeResponse> {
  switch (request.capabilityId) {
    case CORE_CAPABILITY_REGISTRY_ID:
      return await dispatchRegistryCapability(api, permissions, request);
    case AUDIO_PLAYBACK_CAPABILITY_ID:
      return await dispatchAudioPlaybackCapability(api, permissions, request);
    case AUDIO_ANALYSIS_CAPABILITY_ID:
      return await dispatchAudioAnalysisCapability(api, permissions, request);
    case NAVIGATION_CAPABILITY_ID:
      return await dispatchNavigationCapability(api, permissions, request);
    case STORAGE_CONFIG_CAPABILITY_ID:
      return await dispatchStorageConfigCapability(api, permissions, request);
    case WINDOW_CAPABILITY_ID:
      return await dispatchWindowCapability(api, permissions, request);
    default:
      return responseError(
        request,
        'CAPABILITY_NOT_SUPPORTED',
        `Compat capability transport does not expose: ${request.capabilityId}`
      );
  }
}

export async function dispatchPmpmCapabilityProtocolRequest(
  api: PluginMountApi,
  permissions: ReadonlySet<string>,
  request: PmpmCapabilityProtocolRequestMessage,
  options?: PmpmCompatRpcDispatchOptions
): Promise<
  CapabilityInvokeResponse | SessionOpenResponse | SessionCloseResponse | StreamOpenResponse | null
> {
  switch (request.op) {
    case 'capability.invoke.request':
      return await dispatchPmpmCompatCapabilityInvokeRequest(api, permissions, request);
    case 'session.open.request': {
      const response = await dispatchDirectHostSessionOpenRequest(api, permissions, request);

      if (response.ok) {
        options?.runtimeResources?.trackSession({
          capabilityId: request.capabilityId,
          sessionId: response.sessionId,
          close: (reason) => api.host.closeSession(request.capabilityId, response.sessionId, reason),
        });
      }

      return response;
    }
    case 'session.close.request': {
      const response = await dispatchDirectHostSessionCloseRequest(api, permissions, request);

      if (response.ok) {
        options?.runtimeResources?.releaseSession(request.sessionId, request.capabilityId);
      }

      return response;
    }
    case 'stream.open.request':
      return await dispatchDirectHostStreamOpenRequest(api, permissions, request, options);
    case 'cancel.request':
      await dispatchCancelRequest(request, options);
      return null;
    case 'dispose.request':
      await dispatchDisposeRequest(request, options);
      return null;
  }
}

function encodeLegacyRpcResult(
  rpcRequest: RpcRequest,
  decoded: Extract<DecodedCapabilityInvokeRequest, { source: 'legacy' }>,
  response: CapabilityInvokeResponse
): Omit<RpcResultMessage, 'frameId'> {
  if (decoded.legacyResultMode === 'data' && response.ok) {
    return {
      type: 'pmpm:rpc-result',
      id: rpcRequest.id,
      ok: true,
      result: response.data,
    };
  }

  return {
    type: 'pmpm:rpc-result',
    id: rpcRequest.id,
    ok: true,
    result: response.ok ? undefined : decoded.legacyFallbackValue,
  };
}

export async function dispatchPmpmCompatRpcRequest(
  api: PluginMountApi,
  permissions: ReadonlySet<string>,
  rpcRequest: RpcRequest,
  options?: PmpmCompatRpcDispatchOptions
): Promise<Omit<RpcResultMessage, 'frameId'>> {
  try {
    if (rpcRequest.method === 'host.listCapabilities') {
      const response = await dispatchRegistryCapability(api, permissions, {
        protocolVersion: PMPM_COMPAT_CAPABILITY_PROTOCOL_VERSION,
        op: 'capability.invoke.request',
        requestId: `compat-host-list:${rpcRequest.id}`,
        capabilityId: CORE_CAPABILITY_REGISTRY_ID,
        method: 'list',
      });

      if (!response.ok) {
        throw new Error(response.error.message);
      }

      return {
        type: 'pmpm:rpc-result',
        id: rpcRequest.id,
        ok: true,
        result: response.data,
      };
    }

    if (rpcRequest.method === 'host.invokeCapability') {
      const request = normalizeDirectCompatCapabilityInvokeRequest(rpcRequest);
      const response = await dispatchDirectHostCapabilityInvokeRequest(api, permissions, request);

      if (!response.ok) {
        throw new Error(response.error.message);
      }

      return {
        type: 'pmpm:rpc-result',
        id: rpcRequest.id,
        ok: true,
        result: response.data,
      };
    }

    if (rpcRequest.method === 'session.open.request') {
      const request = normalizeSessionOpenRequest(rpcRequest);
      const response = await dispatchPmpmCapabilityProtocolRequest(api, permissions, request, options);

      return {
        type: 'pmpm:rpc-result',
        id: rpcRequest.id,
        ok: true,
        result: response,
      };
    }

    if (rpcRequest.method === 'session.close.request') {
      const request = normalizeSessionCloseRequest(rpcRequest);
      const response = await dispatchPmpmCapabilityProtocolRequest(api, permissions, request, options);

      return {
        type: 'pmpm:rpc-result',
        id: rpcRequest.id,
        ok: true,
        result: response,
      };
    }

    if (rpcRequest.method === 'stream.open.request') {
      const request = normalizeStreamOpenRequest(rpcRequest);
      const response = await dispatchPmpmCapabilityProtocolRequest(api, permissions, request, options);

      return {
        type: 'pmpm:rpc-result',
        id: rpcRequest.id,
        ok: true,
        result: response,
      };
    }

    if (rpcRequest.method === 'cancel.request') {
      const request = normalizeCancelRequest(rpcRequest);
      await dispatchPmpmCapabilityProtocolRequest(api, permissions, request, options);
      return {
        type: 'pmpm:rpc-result',
        id: rpcRequest.id,
        ok: true,
        result: null,
      };
    }

    if (rpcRequest.method === 'dispose.request') {
      const request = normalizeDisposeRequest(rpcRequest);
      await dispatchPmpmCapabilityProtocolRequest(api, permissions, request, options);

      return {
        type: 'pmpm:rpc-result',
        id: rpcRequest.id,
        ok: true,
        result: null,
      };
    }

    const decoded = decodePmpmCompatCapabilityInvokeRequest(rpcRequest);
    if (!decoded) {
      throw new Error(`Unsupported RPC method: ${rpcRequest.method}`);
    }

    const response = await dispatchPmpmCompatCapabilityInvokeRequest(
      api,
      permissions,
      decoded.request
    );

    if (decoded.source === 'legacy') {
      return encodeLegacyRpcResult(rpcRequest, decoded, response);
    }

    return {
      type: 'pmpm:rpc-result',
      id: rpcRequest.id,
      ok: true,
      result: response,
    };
  } catch (error) {
    return {
      type: 'pmpm:rpc-result',
      id: rpcRequest.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
