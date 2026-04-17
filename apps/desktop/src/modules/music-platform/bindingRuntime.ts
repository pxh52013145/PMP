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
  PlatformQrLoginSession,
} from './connectorAuth';
import {
  beginPlatformQrLogin,
  clearPlatformConnectorCookies,
  getPlatformConnectorAuthSnapshot,
  logoutPlatformConnector,
  pollPlatformQrLogin,
  refreshAndEmitPlatformConnectorAuthSnapshot,
} from './connectorAuth';
import { readString, writeString } from '../storage';
import {
  listNeteasePlaylistTracks,
  listNeteaseRecommendedPlaylists,
  listNeteaseRecommendedSongs,
  listNeteaseUserPlaylists,
  prepareNeteaseCachedPlayback,
  searchNeteaseSongs,
} from './neteaseFacade';

const CONNECTOR_AUTH_BINDING_ID = 'host.pmp.connector-auth';
const NETEASE_LIBRARY_BINDING_ID = 'host.pmp.music-platform.netease.library';
const NETEASE_RECOMMENDATIONS_BINDING_ID = 'host.pmp.music-platform.netease.recommendations';
const NETEASE_SEARCH_BINDING_ID = 'host.pmp.music-platform.netease.search';
const NETEASE_QUALITY_BINDING_ID = 'host.pmp.music-platform.netease.quality';
const NETEASE_PLAYBACK_QUALITY_PREFERENCE_KEY =
  'music-platform.netease.playback-quality-preference';

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
type NeteasePlaybackQualityKey = 'auto' | 'standard' | 'higher' | 'exhigh' | 'lossless';

const NETEASE_PLAYBACK_QUALITY_KEYS: NeteasePlaybackQualityKey[] = [
  'auto',
  'standard',
  'higher',
  'exhigh',
  'lossless',
];

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

function normalizePositiveInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeNeteaseQualityKey(value: unknown): NeteasePlaybackQualityKey {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'standard' || normalized === '128k') return 'standard';
  if (normalized === 'higher' || normalized === '192k') return 'higher';
  if (normalized === 'exhigh' || normalized === '320k') return 'exhigh';
  if (normalized === 'lossless' || normalized === '999k') return 'lossless';
  return 'auto';
}

function readNeteasePreferredQualityKey(): NeteasePlaybackQualityKey {
  return normalizeNeteaseQualityKey(readString(NETEASE_PLAYBACK_QUALITY_PREFERENCE_KEY));
}

function writeNeteasePreferredQualityKey(qualityKey: NeteasePlaybackQualityKey): void {
  writeString(NETEASE_PLAYBACK_QUALITY_PREFERENCE_KEY, qualityKey);
}

function toNeteasePlaybackQualityOption(qualityKey: NeteasePlaybackQualityKey) {
  return {
    key: qualityKey,
    label: qualityKey,
    available: true,
  };
}

function toNeteasePlaybackQualityState(
  qualityKey: NeteasePlaybackQualityKey = readNeteasePreferredQualityKey()
) {
  return {
    current: toNeteasePlaybackQualityOption(qualityKey),
    options: NETEASE_PLAYBACK_QUALITY_KEYS.map(toNeteasePlaybackQualityOption),
  };
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

function mapAuthSnapshotToRuntimeData(
  snapshot: PlatformConnectorAuthSnapshot
): RuntimeAuthSnapshotData {
  return {
    authState: snapshot.authState,
    accountId: snapshot.accountUid,
    updatedAtMs: snapshot.updatedAtMs,
    expiresAtMs: snapshot.expiresAtMs,
    availability: snapshot.availability,
    availabilityMessage: snapshot.availabilityMessage,
    metadata: {
      connectorId: snapshot.connectorId,
      displayName: snapshot.displayName,
    },
  };
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

function mapQrSessionToRuntimeData(session: PlatformQrLoginSession): RuntimeQrSessionData {
  return {
    sessionId: session.sessionId,
    qrcodeKey: session.qrcodeKey,
    qrUrl: session.qrUrl,
    qrImageDataUrl: session.qrImageDataUrl,
    generatedAtMs: session.generatedAtMs,
    expiresAtMs: session.expiresAtMs,
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

  if (!sessionId || !qrcodeKey || !qrUrl || !qrImageDataUrl || generatedAtMs < 1 || expiresAtMs < 1) {
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

function mapQrPollResultToRuntimeData(result: PlatformQrLoginPollResult): RuntimeQrPollData {
  return {
    sessionId: result.sessionId,
    state: result.state,
    stateCode: result.stateCode,
    stateMessage: result.stateMessage,
    authState: result.authState,
    accountId: result.accountUid,
    expiresAtMs: result.expiresAtMs,
    metadata: {
      connectorId: result.connectorId,
    },
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

function mapNeteaseCollection(item: {
  playlistId: string;
  title: string;
  trackCount: number;
  coverUrl?: string;
  updatedAtMs?: number;
}) {
  return {
    collectionId: item.playlistId,
    title: item.title,
    trackCount: item.trackCount,
    coverUrl: item.coverUrl,
    updatedAtMs: item.updatedAtMs,
  };
}

function mapNeteasePage(
  page: {
    sourceKind: string;
    sourceId: string;
    pageNum: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
    items: Array<{
      songId: string;
      title: string;
      artistNames: string;
      albumName?: string;
      durationSeconds?: number;
      coverUrl?: string;
      sourceLocator: string;
      webUrl: string;
    }>;
  } | null
) {
  if (!page) return null;
  return {
    sourceKind: page.sourceKind,
    sourceId: page.sourceId,
    pageNum: page.pageNum,
    pageSize: page.pageSize,
    total: page.total,
    hasMore: page.hasMore,
    items: page.items.map((item) => ({
      resourceId: item.songId,
      title: item.title,
      artistNames: item.artistNames,
      albumName: item.albumName,
      durationSeconds: item.durationSeconds,
      coverUrl: item.coverUrl,
      sourceLocator: item.sourceLocator,
      webUrl: item.webUrl,
    })),
  };
}

async function invokeConnectorAuthBinding(
  options: BindingInvokeOptions
): Promise<PlatformApiResult<unknown>> {
  switch (options.method) {
    case 'getSnapshot': {
      const snapshot = await getPlatformConnectorAuthSnapshot(options.connectorId);
      if (!snapshot) {
        return err('API_UNAVAILABLE', `${options.displayName} auth snapshot is unavailable`);
      }
      return ok(mapAuthSnapshotToRuntimeData(snapshot));
    }
    case 'refreshSnapshot': {
      const snapshot = await refreshAndEmitPlatformConnectorAuthSnapshot(options.connectorId);
      if (!snapshot) {
        return err('API_UNAVAILABLE', `${options.displayName} auth snapshot refresh is unavailable`);
      }
      return ok(mapAuthSnapshotToRuntimeData(snapshot));
    }
    case 'beginQrLogin': {
      const session = await beginPlatformQrLogin(options.connectorId);
      if (!session) {
        return err('API_UNAVAILABLE', `${options.displayName} QR login session is unavailable`);
      }
      return ok(mapQrSessionToRuntimeData(session));
    }
    case 'pollQrLogin': {
      const sessionId = normalizeString(options.payload?.sessionId);
      if (!sessionId) {
        return err('INVALID_PAYLOAD', 'payload.sessionId is required');
      }
      const result = await pollPlatformQrLogin(options.connectorId, sessionId);
      if (!result) {
        return err('API_UNAVAILABLE', `${options.displayName} QR login poll result is unavailable`);
      }
      return ok(mapQrPollResultToRuntimeData(result));
    }
    case 'logout': {
      const snapshot = await logoutPlatformConnector(options.connectorId);
      if (!snapshot) {
        return err('API_UNAVAILABLE', `${options.displayName} logout snapshot is unavailable`);
      }
      return ok(mapAuthSnapshotToRuntimeData(snapshot));
    }
    case 'clearAuthCookies': {
      const snapshot = await clearPlatformConnectorCookies(options.connectorId);
      if (!snapshot) {
        return err('API_UNAVAILABLE', `${options.displayName} auth cookie clearing is unavailable`);
      }
      return ok(mapAuthSnapshotToRuntimeData(snapshot));
    }
    default:
      return err(
        'UNSUPPORTED_CAPABILITY',
        `${options.displayName} runtime binding ${options.bindingId}.${options.method} is not implemented`
      );
  }
}

async function invokeNeteaseLibraryBinding(
  options: BindingInvokeOptions
): Promise<PlatformApiResult<unknown>> {
  const instanceId = normalizeString(options.payload?.instanceId) || undefined;
  switch (options.method) {
    case 'listCollections': {
      const items = await listNeteaseUserPlaylists({
        forceRefresh: readBoolean(options.payload?.forceRefresh),
        instanceId,
      });
      return ok({
        items: items.map(mapNeteaseCollection),
      });
    }
    case 'listPlaylistTracks':
    case 'listResources': {
      const collectionId =
        normalizeString(options.payload?.collectionId) ||
        normalizeString(options.payload?.playlistId);
      if (!collectionId) {
        return err('INVALID_PAYLOAD', 'payload.collectionId or payload.playlistId is required');
      }
      const page = await listNeteasePlaylistTracks(collectionId, {
        forceRefresh: readBoolean(options.payload?.forceRefresh),
        instanceId,
      });
      return ok(page ? mapNeteasePage(page) : null);
    }
    default:
      return err(
        'UNSUPPORTED_CAPABILITY',
        `${options.displayName} runtime binding ${options.bindingId}.${options.method} is not implemented`
      );
  }
}

async function invokeNeteaseRecommendationsBinding(
  options: BindingInvokeOptions
): Promise<PlatformApiResult<unknown>> {
  const instanceId = normalizeString(options.payload?.instanceId) || undefined;
  switch (options.method) {
    case 'listDaily': {
      const [collections, page] = await Promise.all([
        listNeteaseRecommendedPlaylists({
          forceRefresh: readBoolean(options.payload?.forceRefresh),
          instanceId,
        }),
        listNeteaseRecommendedSongs({
          forceRefresh: readBoolean(options.payload?.forceRefresh),
          instanceId,
        }),
      ]);
      const normalizedPage = mapNeteasePage(page);
      return ok({
        collections: collections.map(mapNeteaseCollection),
        items: normalizedPage?.items ?? [],
        total: normalizedPage?.total ?? 0,
        hasMore: normalizedPage?.hasMore ?? false,
        pageNum: normalizedPage?.pageNum ?? 1,
        pageSize: normalizedPage?.pageSize ?? Math.max(1, normalizedPage?.items.length ?? 0),
        sourceKind: normalizedPage?.sourceKind ?? 'recommended',
        sourceId: normalizedPage?.sourceId ?? 'recommended',
      });
    }
    default:
      return err(
        'UNSUPPORTED_CAPABILITY',
        `${options.displayName} runtime binding ${options.bindingId}.${options.method} is not implemented`
      );
  }
}

async function invokeNeteaseSearchBinding(
  options: BindingInvokeOptions
): Promise<PlatformApiResult<unknown>> {
  const instanceId = normalizeString(options.payload?.instanceId) || undefined;
  switch (options.method) {
    case 'query': {
      const keyword =
        normalizeString(options.payload?.keyword) || normalizeString(options.payload?.query);
      if (!keyword) {
        return err('INVALID_PAYLOAD', 'payload.keyword or payload.query is required');
      }
      const page = await searchNeteaseSongs({
        keyword,
        pageNum: normalizePositiveInt(options.payload?.pageNum) || 1,
        pageSize: normalizePositiveInt(options.payload?.pageSize) || 40,
        forceRefresh: readBoolean(options.payload?.forceRefresh),
        instanceId,
      });
      return ok(page ? mapNeteasePage(page) : null);
    }
    case 'resolveLocator':
      return ok({ item: null });
    default:
      return err(
        'UNSUPPORTED_CAPABILITY',
        `${options.displayName} runtime binding ${options.bindingId}.${options.method} is not implemented`
      );
  }
}

async function invokeNeteaseQualityBinding(
  options: BindingInvokeOptions
): Promise<PlatformApiResult<unknown>> {
  switch (options.method) {
    case 'listOptions':
      return ok(toNeteasePlaybackQualityState());
    case 'getCurrent':
      return ok(toNeteasePlaybackQualityState().current);
    case 'setPreferred': {
      const qualityKey = normalizeNeteaseQualityKey(
        options.payload?.qualityKey ?? options.payload?.key ?? options.payload?.qualityHint
      );
      writeNeteasePreferredQualityKey(qualityKey);
      return ok({
        saved: true,
        ...toNeteasePlaybackQualityState(qualityKey),
      });
    }
    default:
      return err(
        'UNSUPPORTED_CAPABILITY',
        `${options.displayName} runtime binding ${options.bindingId}.${options.method} is not implemented`
      );
  }
}

function createPreparePlaybackInvoker(connectorId: string, displayName: string) {
  return async (input: Record<string, unknown>) => {
    const sourceLocator = normalizeString(input.sourceLocator);
    if (!sourceLocator) {
      return err('INVALID_PAYLOAD', 'payload.sourceLocator is required');
    }

    if (connectorId === 'connector.platform.netease') {
      const qualityHint =
        normalizeString(input.qualityHint) || readNeteasePreferredQualityKey();
      const instanceId = normalizeString(input.instanceId) || undefined;
      const prepared = await prepareNeteaseCachedPlayback(sourceLocator, qualityHint, instanceId);
      if (!prepared) {
        return err('API_UNAVAILABLE', `${displayName} playback preparation is unavailable`);
      }
      return ok({
        sourceLocator: prepared.sourceLocator,
        streamUrl: prepared.streamUrl,
        cachePath: prepared.cachePath,
        mimeType: prepared.mimeType,
        durationSeconds: prepared.durationSeconds,
        resourceId: prepared.songId,
        selectedQualityKey: normalizeString(prepared.selectedQualityKey) || undefined,
        selectedQualityLabel: normalizeString(prepared.selectedQualityLabel) || undefined,
      });
    }

    return err(
      'UNSUPPORTED_CAPABILITY',
      `${displayName} playback preparation is not implemented for ${connectorId}`
    );
  };
}

export async function invokePlatformRuntimeBinding(
  options: BindingInvokeOptions
): Promise<PlatformApiResult<unknown>> {
  switch (options.bindingId) {
    case CONNECTOR_AUTH_BINDING_ID:
      return invokeConnectorAuthBinding(options);
    case NETEASE_LIBRARY_BINDING_ID:
      return invokeNeteaseLibraryBinding(options);
    case NETEASE_RECOMMENDATIONS_BINDING_ID:
      return invokeNeteaseRecommendationsBinding(options);
    case NETEASE_SEARCH_BINDING_ID:
      return invokeNeteaseSearchBinding(options);
    case NETEASE_QUALITY_BINDING_ID:
      return invokeNeteaseQualityBinding(options);
    default:
      return err(
        'UNSUPPORTED_CAPABILITY',
        `${options.displayName} runtime binding ${options.bindingId}.${options.method} is not registered`
      );
  }
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

  const preparePlayback = createPreparePlaybackInvoker(
    definition.connectorId,
    definition.displayName
  );

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
          preparePlayback,
        }
      : undefined,
    recommendations: contract.apiBindings.recommendations
      ? {
          listDaily: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.recommendations, 'listDaily', input),
        }
      : undefined,
    search: contract.apiBindings.search
      ? {
          query: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.search, 'query', input),
          resolveLocator: async (input: Record<string, unknown>) =>
            invokeBinding(contract.apiBindings.search, 'resolveLocator', input),
          preparePlayback,
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
    const result = await bucket({ instanceId: definition.connectorId });
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
      const result = await begin({ instanceId: definition.connectorId });
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
        instanceId: definition.connectorId,
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
