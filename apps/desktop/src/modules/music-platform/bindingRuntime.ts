import type {
  PlatformApiResult,
  PlatformCompatAvailability,
  PlatformCompatContractFile,
  PlatformCompatRuntimeApi,
  PlatformCompatRuntimeAuthState,
} from '@pixel-matrix/plugin-platform-contracts';

import type {
  PlatformConnectorAdapter,
  PlatformConnectorAuthSnapshot,
  PlatformConnectorDefinition,
  PlatformConnectorId,
  PlatformQrLoginPollResult,
} from './connectorAuth';
import { invokePlatformInstanceAuthBinding } from './platformInstanceAuthBinding';
import { invokePlatformInstanceApiBinding } from './platformInstanceApiBinding';

const CONNECTOR_PLATFORM_PREFIX = 'connector.platform.';
const CONNECTOR_AUTH_BINDING_ID = 'host.pmp.connector-auth';

type BindingInvokeOptions = {
  bindingId: string;
  connectorId: PlatformConnectorId;
  displayName: string;
  method: string;
  payload?: Record<string, unknown>;
};

type RuntimeAuthSnapshotData = {
  authState: PlatformCompatRuntimeAuthState;
  accountId?: string;
  accountName?: string;
  updatedAtMs?: number;
  expiresAtMs?: number;
  availability?: PlatformCompatAvailability;
  availabilityMessage?: string;
  metadata?: Record<string, unknown>;
};

type RuntimeQrSessionData = {
  sessionId: string;
  qrcodeKey: string;
  qrUrl: string;
  qrImageDataUrl: string;
  generatedAtMs: number;
  expiresAtMs: number;
};

type RuntimeQrPollData = {
  sessionId: string;
  state: string;
  stateCode: number;
  stateMessage: string;
  authState: PlatformCompatRuntimeAuthState;
  accountId?: string;
  expiresAtMs?: number;
  metadata?: Record<string, unknown>;
};

function ok<T>(data: T): PlatformApiResult<T> {
  return { ok: true, data };
}

function err(code: string, message: string, details?: unknown): PlatformApiResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      details,
    },
  };
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolvePlatformIdFromConnectorId(connectorId: string): string {
  const normalizedConnectorId = normalizeString(connectorId).toLowerCase();
  if (!normalizedConnectorId.startsWith(CONNECTOR_PLATFORM_PREFIX)) return '';
  return normalizedConnectorId.slice(CONNECTOR_PLATFORM_PREFIX.length);
}

function toDefaultInstanceIdForPlatform(platformId: string): string | undefined {
  const normalizedPlatformId = normalizeString(platformId).toLowerCase();
  return normalizedPlatformId ? `${normalizedPlatformId}:builtin` : undefined;
}

function toDefaultInstanceIdForConnector(connectorId: string): string | undefined {
  return toDefaultInstanceIdForPlatform(resolvePlatformIdFromConnectorId(connectorId));
}

function resolveBindingInstanceId(options: BindingInvokeOptions): string | undefined {
  return (
    normalizeString(options.payload?.instanceId) ||
    toDefaultInstanceIdForConnector(options.connectorId)
  );
}

function normalizePositiveInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeAuthState(
  value: unknown
): PlatformConnectorAuthSnapshot['authState'] {
  const authState = normalizeString(value);
  return authState === 'pending' ||
    authState === 'authorized' ||
    authState === 'expired' ||
    authState === 'revoked' ||
    authState === 'error'
    ? authState
    : 'unauthorized';
}

function normalizeAvailability(
  value: unknown
): PlatformConnectorAuthSnapshot['availability'] | undefined {
  return value === 'available' || value === 'degraded' || value === 'unavailable'
    ? value
    : undefined;
}

function mapRuntimeAuthToSnapshot(
  connectorId: PlatformConnectorId,
  displayName: string,
  data: Partial<RuntimeAuthSnapshotData> | null | undefined
): PlatformConnectorAuthSnapshot {
  return {
    connectorId,
    displayName,
    authState: normalizeAuthState(data?.authState),
    accountUid: normalizeString(data?.accountId) || undefined,
    updatedAtMs:
      typeof data?.updatedAtMs === 'number' && Number.isFinite(data.updatedAtMs)
        ? data.updatedAtMs
        : Date.now(),
    expiresAtMs:
      typeof data?.expiresAtMs === 'number' && Number.isFinite(data.expiresAtMs)
        ? data.expiresAtMs
        : undefined,
    availability: normalizeAvailability(data?.availability),
    availabilityMessage: normalizeString(data?.availabilityMessage) || undefined,
  };
}

function mapRuntimeAuthData(value: unknown): RuntimeAuthSnapshotData | null {
  const record = asRecord(value);
  if (!record) return null;

  const metadata = asRecord(record.metadata);
  return {
    authState: normalizeAuthState(record.authState),
    accountId: normalizeString(record.accountId) || undefined,
    accountName: normalizeString(record.accountName) || undefined,
    updatedAtMs:
      typeof record.updatedAtMs === 'number' && Number.isFinite(record.updatedAtMs)
        ? record.updatedAtMs
        : undefined,
    expiresAtMs:
      typeof record.expiresAtMs === 'number' && Number.isFinite(record.expiresAtMs)
        ? record.expiresAtMs
        : undefined,
    availability: normalizeAvailability(record.availability),
    availabilityMessage: normalizeString(record.availabilityMessage) || undefined,
    metadata: metadata ?? undefined,
  };
}

function mapRuntimeQrSessionData(value: unknown): RuntimeQrSessionData | null {
  const record = asRecord(value);
  if (!record) return null;

  const sessionId = normalizeString(record.sessionId);
  const qrcodeKey = normalizeString(record.qrcodeKey);
  const qrUrl = normalizeString(record.qrUrl);
  const qrImageDataUrl = normalizeString(record.qrImageDataUrl);
  const generatedAtMs = normalizePositiveInt(record.generatedAtMs);
  const expiresAtMs = normalizePositiveInt(record.expiresAtMs);

  if (
    !sessionId ||
    !qrcodeKey ||
    !qrUrl ||
    !qrImageDataUrl ||
    generatedAtMs < 1 ||
    expiresAtMs < 1
  ) {
    return null;
  }

  return {
    sessionId,
    qrcodeKey,
    qrUrl,
    qrImageDataUrl,
    generatedAtMs,
    expiresAtMs,
  };
}

function mapRuntimeQrPollData(value: unknown): RuntimeQrPollData | null {
  const record = asRecord(value);
  if (!record) return null;

  const sessionId = normalizeString(record.sessionId);
  if (!sessionId) return null;

  const metadata = asRecord(record.metadata);
  return {
    sessionId,
    state: normalizeString(record.state) || 'unknown',
    stateCode:
      typeof record.stateCode === 'number' && Number.isFinite(record.stateCode)
        ? record.stateCode
        : 0,
    stateMessage: normalizeString(record.stateMessage),
    authState: normalizeAuthState(record.authState),
    accountId: normalizeString(record.accountId) || undefined,
    expiresAtMs:
      typeof record.expiresAtMs === 'number' && Number.isFinite(record.expiresAtMs)
        ? record.expiresAtMs
        : undefined,
    metadata: metadata ?? undefined,
  };
}

async function invokeConnectorAuthBinding(
  options: BindingInvokeOptions
): Promise<PlatformApiResult<unknown>> {
  const instanceId = resolveBindingInstanceId(options);
  if (!instanceId) {
    return err('INVALID_PAYLOAD', 'payload.instanceId is required');
  }
  return invokePlatformInstanceAuthBinding(options, instanceId);
}

async function invokePlatformApiBinding(
  options: BindingInvokeOptions
): Promise<PlatformApiResult<unknown>> {
  const instanceId = resolveBindingInstanceId(options);
  if (!instanceId) {
    return err('INVALID_PAYLOAD', 'payload.instanceId is required');
  }
  return invokePlatformInstanceApiBinding(options, instanceId);
}

export async function invokePlatformRuntimeBinding(
  options: BindingInvokeOptions
): Promise<PlatformApiResult<unknown>> {
  if (options.bindingId === CONNECTOR_AUTH_BINDING_ID) {
    return invokeConnectorAuthBinding(options);
  }
  return invokePlatformApiBinding(options);
}

export function createPlatformCompatRuntimeFromBindingContract(
  definition: PlatformConnectorDefinition,
  contract: PlatformCompatContractFile
): PlatformCompatRuntimeApi {
  const invokeBinding = (
    bindingId: string | undefined,
    method: string,
    payload: Record<string, unknown> = {}
  ) => {
    if (!bindingId || bindingId.trim().length < 1) {
      return Promise.resolve(
        err(
          'UNSUPPORTED_CAPABILITY',
          `${definition.displayName} runtime binding for ${method} is not configured`
        )
      );
    }

    return invokePlatformRuntimeBinding({
      bindingId,
      connectorId: definition.connectorId,
      displayName: definition.displayName,
      method,
      payload,
    });
  };

  const invokeTypedAuthBinding = async <T>(
    method: string,
    payload: Record<string, unknown>,
    mapData: (value: unknown) => T | null
  ): Promise<PlatformApiResult<T>> => {
    const result = await invokeBinding(contract.apiBindings.auth, method, payload);
    if (!result.ok) {
      return result;
    }

    const normalized = mapData(result.data);
    if (!normalized) {
      return err(
        'INVALID_RESPONSE',
        `${definition.displayName} auth binding ${method} returned invalid data`
      );
    }

    return ok(normalized);
  };

  return {
    auth: {
      getSnapshot: async (input) =>
        invokeTypedAuthBinding('getSnapshot', input, mapRuntimeAuthData),
      refreshSnapshot: async (input) =>
        invokeTypedAuthBinding('refreshSnapshot', input, mapRuntimeAuthData),
      beginQrLogin: async (input) =>
        invokeTypedAuthBinding('beginQrLogin', input, mapRuntimeQrSessionData),
      pollQrLogin: async (input) =>
        invokeTypedAuthBinding('pollQrLogin', input, mapRuntimeQrPollData),
      logout: async (input) => invokeTypedAuthBinding('logout', input, mapRuntimeAuthData),
      clearAuthCookies: async (input) =>
        invokeTypedAuthBinding('clearAuthCookies', input, mapRuntimeAuthData),
    },
    library: contract.apiBindings.library
      ? {
          listCollections: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.library, 'listCollections', input),
          listResources: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.library, 'listResources', input),
          listPlaylistTracks: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.library, 'listPlaylistTracks', input),
          createPlaylist: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.library, 'createPlaylist', input),
          deletePlaylist: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.library, 'deletePlaylist', input),
          addTrackToPlaylist: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.library, 'addTrackToPlaylist', input),
          removeTrackFromPlaylist: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.library, 'removeTrackFromPlaylist', input),
          preparePlayback: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.library, 'preparePlayback', input),
        }
      : undefined,
    recommendations: contract.apiBindings.recommendations
      ? {
          listDaily: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.recommendations, 'listDaily', input),
          listRecommendedSongs: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.recommendations, 'listRecommendedSongs', input),
          listRecommendedPlaylists: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.recommendations, 'listRecommendedPlaylists', input),
        }
      : undefined,
    search: contract.apiBindings.search
      ? {
          query: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.search, 'query', input),
          resolveLocator: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.search, 'resolveLocator', input),
          preparePlayback: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.search, 'preparePlayback', input),
        }
      : undefined,
    quality: contract.apiBindings.quality
      ? {
          listOptions: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.quality, 'listOptions', input),
          getCurrent: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.quality, 'getCurrent', input),
          setPreferred: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.quality, 'setPreferred', input),
        }
      : undefined,
    settings: contract.apiBindings.settings
      ? {
          get: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.settings, 'get', input),
          set: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.settings, 'set', input),
          reset: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.settings, 'reset', input),
        }
      : undefined,
    pages: contract.apiBindings.pages
      ? {
          getWorkspaceModel: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.pages, 'getWorkspaceModel', input),
          listPages: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.pages, 'listPages', input),
        }
      : undefined,
    metadata: {
      connectorId: definition.connectorId,
      displayName: definition.displayName,
      source: 'binding-contract-runtime',
    },
  };
}

export function createPlatformConnectorAdapterFromBindingContract(
  definition: PlatformConnectorDefinition,
  contract: PlatformCompatContractFile
): PlatformConnectorAdapter {
  const runtime = createPlatformCompatRuntimeFromBindingContract(definition, contract);
  const defaultInstanceId =
    toDefaultInstanceIdForPlatform(contract.platform.platformId) ??
    toDefaultInstanceIdForConnector(definition.connectorId);
  if (!defaultInstanceId) {
    throw new Error(
      `Platform connector ${definition.connectorId} requires a stable default instance id`
    );
  }

  const readSnapshot = async (
    method: 'getSnapshot' | 'refreshSnapshot' | 'logout' | 'clearAuthCookies'
  ): Promise<PlatformConnectorAuthSnapshot> => {
    const bucket = runtime.auth?.[method];
    if (typeof bucket !== 'function') {
      return mapRuntimeAuthToSnapshot(definition.connectorId, definition.displayName, {
        authState: 'unauthorized',
        availability: 'unavailable',
        availabilityMessage: `${definition.displayName} auth runtime is unavailable`,
      });
    }
    const result = await bucket({ instanceId: defaultInstanceId });
    if (!result.ok) {
      return mapRuntimeAuthToSnapshot(definition.connectorId, definition.displayName, {
        authState: 'error',
        availability: 'unavailable',
        availabilityMessage: result.error.message,
      });
    }
    return mapRuntimeAuthToSnapshot(definition.connectorId, definition.displayName, result.data);
  };

  return {
    definition,
    getAuthSnapshot: async () => readSnapshot('getSnapshot'),
    refreshAndEmitAuthSnapshot: async () => readSnapshot('refreshSnapshot'),
    beginQrLogin: async () => {
      const begin = runtime.auth?.beginQrLogin;
      if (typeof begin !== 'function') return null;
      const result = await begin({ instanceId: defaultInstanceId });
      if (!result.ok) return null;
      return {
        connectorId: definition.connectorId,
        sessionId: normalizeString(result.data.sessionId),
        qrcodeKey: normalizeString(result.data.qrcodeKey),
        qrUrl: normalizeString(result.data.qrUrl),
        qrImageDataUrl: normalizeString(result.data.qrImageDataUrl),
        generatedAtMs: normalizePositiveInt(result.data.generatedAtMs),
        expiresAtMs: normalizePositiveInt(result.data.expiresAtMs),
      };
    },
    pollQrLogin: async (sessionId: string) => {
      const poll = runtime.auth?.pollQrLogin;
      if (typeof poll !== 'function') return null;
      const result = await poll({
        instanceId: defaultInstanceId,
        sessionId,
      });
      if (!result.ok) return null;
      return {
        connectorId: definition.connectorId,
        sessionId: normalizeString(result.data.sessionId),
        state: normalizeString(result.data.state),
        stateCode: normalizePositiveInt(result.data.stateCode),
        stateMessage: normalizeString(result.data.stateMessage),
        authState:
          normalizeString(result.data.authState) === 'pending' ||
          normalizeString(result.data.authState) === 'authorized' ||
          normalizeString(result.data.authState) === 'expired' ||
          normalizeString(result.data.authState) === 'revoked' ||
          normalizeString(result.data.authState) === 'error'
            ? (normalizeString(result.data.authState) as PlatformQrLoginPollResult['authState'])
            : 'unauthorized',
        accountUid: normalizeString(result.data.accountId) || undefined,
        expiresAtMs: normalizePositiveInt(result.data.expiresAtMs) || undefined,
      };
    },
    logout: async () => readSnapshot('logout'),
    clearAuthCookies: async () => readSnapshot('clearAuthCookies'),
  };
}
