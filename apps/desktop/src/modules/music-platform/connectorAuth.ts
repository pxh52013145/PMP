import {
  clearNativeBilibiliAuthCookies,
  clearNativeNeteaseAuthCookies,
  generateNativeBilibiliQrCodeSession,
  getNativeBilibiliAuthStatus,
  generateNativeNeteaseQrCodeSession,
  getNativeNeteaseAuthStatus,
  logoutNativeBilibili,
  logoutNativeNetease,
  pollNativeBilibiliQrCodeSession,
  pollNativeNeteaseQrCodeSession,
  type NativeBilibiliAuthStatus,
  type NativeBilibiliQrCodeSession,
  type NativeBilibiliQrPollResult,
  type NativeNeteaseAuthStatus,
  type NativeNeteaseQrCodeSession,
  type NativeNeteaseQrPollResult,
} from '../music-library';
import type {
  PlatformApiResult,
  PlatformCompatContractFile,
  PlatformCompatRuntimeApi,
} from '@pixel-matrix/plugin-platform-contracts';
import { clearNeteaseFacadeCaches } from './neteaseFacade';
import {
  getBuiltinPlatformCompatContractRegistration,
  listBuiltinPlatformCompatContractRegistrations,
} from './builtinPlatformCompatContracts';

export type PlatformConnectorId = `connector.platform.${string}`;

export type PlatformConnectorAuthState =
  | 'unauthorized'
  | 'pending'
  | 'authorized'
  | 'expired'
  | 'revoked'
  | 'error';

export type PlatformConnectorAvailability = 'available' | 'degraded' | 'unavailable';
export type PlatformConnectorTemplate = 'music' | 'video' | 'generic';
export type PlatformConnectorWorkspaceKind = string;
export type PlatformConnectorWorkspaceMode = 'generic-only' | 'dedicated';

export interface PlatformConnectorAuthSnapshot {
  connectorId: PlatformConnectorId;
  displayName: string;
  authState: PlatformConnectorAuthState;
  accountUid?: string;
  updatedAtMs?: number;
  expiresAtMs?: number;
  availability?: PlatformConnectorAvailability;
  availabilityMessage?: string;
}

export interface PlatformQrLoginSession {
  connectorId: PlatformConnectorId;
  sessionId: string;
  qrcodeKey: string;
  qrUrl: string;
  qrImageDataUrl: string;
  generatedAtMs: number;
  expiresAtMs: number;
}

export interface PlatformQrLoginPollResult {
  connectorId: PlatformConnectorId;
  sessionId: string;
  state: string;
  stateCode: number;
  stateMessage: string;
  authState: PlatformConnectorAuthState;
  accountUid?: string;
  expiresAtMs?: number;
}

export type BilibiliQrLoginSession = PlatformQrLoginSession;
export type BilibiliQrLoginPollResult = PlatformQrLoginPollResult;
export type NeteaseQrLoginSession = PlatformQrLoginSession;
export type NeteaseQrLoginPollResult = PlatformQrLoginPollResult;

export interface PlatformConnectorDefinition {
  connectorId: PlatformConnectorId;
  displayName: string;
  labelKey: string;
  iconKey: string;
  iconAssetUrl?: string;
  accentColor?: string;
  platformTemplate?: PlatformConnectorTemplate;
  enabled: boolean;
  authFlow: 'qr' | 'none';
  workspaceKind: PlatformConnectorWorkspaceKind;
  workspaceMode: PlatformConnectorWorkspaceMode;
  sortOrder: number;
  source?: 'builtin' | 'pack' | 'runtime';
  sourceId?: string;
}

export interface PlatformConnectorAdapter {
  definition: PlatformConnectorDefinition;
  getAuthSnapshot: () => Promise<PlatformConnectorAuthSnapshot | null>;
  refreshAndEmitAuthSnapshot: () => Promise<PlatformConnectorAuthSnapshot | null>;
  beginQrLogin?: () => Promise<PlatformQrLoginSession | null>;
  pollQrLogin?: (sessionId: string) => Promise<PlatformQrLoginPollResult | null>;
  logout?: () => Promise<PlatformConnectorAuthSnapshot | null>;
  clearAuthCookies?: () => Promise<PlatformConnectorAuthSnapshot | null>;
}

export interface BuiltinPlatformCompatRegistration {
  platformId: string;
  connectorId: PlatformConnectorId;
  enabled: boolean;
  contract: PlatformCompatContractFile;
  runtime: PlatformCompatRuntimeApi;
  source?: 'builtin' | 'pack' | 'runtime';
  metadata?: Record<string, unknown>;
}

export const PLATFORM_CONNECTOR_AUTH_CHANGED_EVENT =
  'pmp-platform-connector-auth-changed' as const;

type PlatformConnectorAuthChangedEvent = CustomEvent<PlatformConnectorAuthSnapshot>;

const BILIBILI_CONNECTOR_ID: PlatformConnectorId = 'connector.platform.bilibili';
const NETEASE_CONNECTOR_ID: PlatformConnectorId = 'connector.platform.netease';
const QQMUSIC_CONNECTOR_ID: PlatformConnectorId = 'connector.platform.qqmusic';

const BUILTIN_CONNECTOR_DEFINITIONS: PlatformConnectorDefinition[] = [
  {
    connectorId: BILIBILI_CONNECTOR_ID,
    displayName: 'Bilibili',
    labelKey: 'magnet.platform-login.platform.bilibili',
    iconKey: 'bilibili',
    accentColor: '#67c7ff',
    platformTemplate: 'video',
    enabled: true,
    authFlow: 'qr',
    workspaceKind: 'bilibili',
    workspaceMode: 'dedicated',
    sortOrder: 10,
    source: 'builtin',
    sourceId: 'builtin:bilibili',
  },
  {
    connectorId: NETEASE_CONNECTOR_ID,
    displayName: 'Netease',
    labelKey: 'magnet.platform-login.platform.netease',
    iconKey: 'netease',
    accentColor: '#ff6b87',
    platformTemplate: 'music',
    enabled: true,
    authFlow: 'qr',
    workspaceKind: 'netease',
    workspaceMode: 'dedicated',
    sortOrder: 20,
    source: 'builtin',
    sourceId: 'builtin:netease',
  },
  {
    connectorId: QQMUSIC_CONNECTOR_ID,
    displayName: 'QQ Music',
    labelKey: 'magnet.platform-login.platform.qqmusic',
    iconKey: 'qqmusic',
    accentColor: '#56db8d',
    platformTemplate: 'music',
    enabled: false,
    authFlow: 'none',
    workspaceKind: 'qqmusic',
    workspaceMode: 'dedicated',
    sortOrder: 30,
    source: 'builtin',
    sourceId: 'builtin:qqmusic',
  },
];

export function resolvePlatformConnectorTemplate(
  definition: Pick<PlatformConnectorDefinition, 'platformTemplate' | 'workspaceKind'>
): PlatformConnectorTemplate {
  if (
    definition.platformTemplate === 'music' ||
    definition.platformTemplate === 'video' ||
    definition.platformTemplate === 'generic'
  ) {
    return definition.platformTemplate;
  }

  const normalizedWorkspaceKind = definition.workspaceKind.trim().toLowerCase();
  if (!normalizedWorkspaceKind || normalizedWorkspaceKind === 'generic') {
    return 'generic';
  }
  if (normalizedWorkspaceKind === 'bilibili') {
    return 'video';
  }
  return 'music';
}

const platformConnectorAdapterRegistry = new Map<PlatformConnectorId, PlatformConnectorAdapter>();
let builtinPlatformCompatRegistrations: BuiltinPlatformCompatRegistration[] | null = null;
const dynamicPlatformCompatRegistrations = new Map<
  PlatformConnectorId,
  BuiltinPlatformCompatRegistration
>();

type PlatformConnectorDefinitionsListener = (definitions: PlatformConnectorDefinition[]) => void;
type PlatformConnectorCompatRegistrationsListener = (
  registrations: BuiltinPlatformCompatRegistration[]
) => void;

const platformConnectorDefinitionsListeners = new Set<PlatformConnectorDefinitionsListener>();
const platformConnectorCompatRegistrationsListeners = new Set<
  PlatformConnectorCompatRegistrationsListener
>();

function normalizeConnectorId(value: unknown): PlatformConnectorId | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized.startsWith('connector.platform.')) return null;
  return normalized as PlatformConnectorId;
}

function normalizeAvailability(value: string | undefined):
  | PlatformConnectorAvailability
  | undefined {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized) return undefined;
  if (normalized === 'available' || normalized === 'degraded' || normalized === 'unavailable') {
    return normalized;
  }
  return undefined;
}

function normalizeAuthState(value: string | undefined): PlatformConnectorAuthState {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized) return 'unauthorized';
  if (
    normalized === 'unauthorized' ||
    normalized === 'pending' ||
    normalized === 'authorized' ||
    normalized === 'expired' ||
    normalized === 'revoked' ||
    normalized === 'error'
  ) {
    return normalized;
  }
  return 'error';
}

function mapBilibiliAuthStatus(
  status: NativeBilibiliAuthStatus | null
): PlatformConnectorAuthSnapshot | null {
  if (!status) return null;
  const connectorId = normalizeConnectorId(status.connectorId) ?? BILIBILI_CONNECTOR_ID;

  return {
    connectorId,
    displayName: 'Bilibili',
    authState: normalizeAuthState(status.authState),
    accountUid: status.accountUid,
    updatedAtMs: status.updatedAtMs,
    expiresAtMs: status.expiresAtMs,
    availability: normalizeAvailability(status.availability),
    availabilityMessage: status.availabilityMessage,
  };
}

function mapBilibiliQrSession(
  session: NativeBilibiliQrCodeSession | null
): PlatformQrLoginSession | null {
  if (!session) return null;
  return {
    connectorId: normalizeConnectorId(session.connectorId) ?? BILIBILI_CONNECTOR_ID,
    sessionId: session.sessionId,
    qrcodeKey: session.qrcodeKey,
    qrUrl: session.qrUrl,
    qrImageDataUrl: session.qrImageDataUrl,
    generatedAtMs: session.generatedAtMs,
    expiresAtMs: session.expiresAtMs,
  };
}

function mapBilibiliQrPollResult(
  result: NativeBilibiliQrPollResult | null
): PlatformQrLoginPollResult | null {
  if (!result) return null;
  return {
    connectorId: normalizeConnectorId(result.connectorId) ?? BILIBILI_CONNECTOR_ID,
    sessionId: result.sessionId,
    state: result.state,
    stateCode: result.stateCode,
    stateMessage: result.stateMessage,
    authState: normalizeAuthState(result.authState),
    accountUid: result.accountUid,
    expiresAtMs: result.expiresAtMs,
  };
}

function mapNeteaseAuthStatus(
  status: NativeNeteaseAuthStatus | null
): PlatformConnectorAuthSnapshot | null {
  if (!status) return null;
  const connectorId = normalizeConnectorId(status.connectorId) ?? NETEASE_CONNECTOR_ID;

  return {
    connectorId,
    displayName: 'Netease',
    authState: normalizeAuthState(status.authState),
    accountUid: status.accountUid,
    updatedAtMs: status.updatedAtMs,
    expiresAtMs: status.expiresAtMs,
    availability: normalizeAvailability(status.availability),
    availabilityMessage: status.availabilityMessage,
  };
}

function mapNeteaseQrSession(
  session: NativeNeteaseQrCodeSession | null
): PlatformQrLoginSession | null {
  if (!session) return null;
  return {
    connectorId: normalizeConnectorId(session.connectorId) ?? NETEASE_CONNECTOR_ID,
    sessionId: session.sessionId,
    qrcodeKey: session.qrKey,
    qrUrl: session.qrUrl,
    qrImageDataUrl: session.qrImageDataUrl,
    generatedAtMs: session.generatedAtMs,
    expiresAtMs: session.expiresAtMs,
  };
}

function mapNeteaseQrPollResult(
  result: NativeNeteaseQrPollResult | null
): PlatformQrLoginPollResult | null {
  if (!result) return null;
  return {
    connectorId: normalizeConnectorId(result.connectorId) ?? NETEASE_CONNECTOR_ID,
    sessionId: result.sessionId,
    state: result.state,
    stateCode: result.stateCode,
    stateMessage: result.stateMessage,
    authState: normalizeAuthState(result.authState),
    accountUid: result.accountUid,
    expiresAtMs: result.expiresAtMs,
  };
}

function createUnsupportedSnapshot(
  definition: PlatformConnectorDefinition
): PlatformConnectorAuthSnapshot {
  return {
    connectorId: definition.connectorId,
    displayName: definition.displayName,
    authState: 'unauthorized',
    availability: definition.enabled ? 'available' : 'unavailable',
    availabilityMessage: definition.enabled ? undefined : 'connector not integrated yet',
  };
}

function createPlatformApiOkResult<T>(data: T): PlatformApiResult<T> {
  return {
    ok: true,
    data,
  };
}

function createPlatformApiErrorResult(
  code: string,
  message: string,
  retryable?: boolean,
  details?: unknown
): PlatformApiResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable,
      details,
    },
  };
}

function mapAuthSnapshotToPlatformCompatAuthData(snapshot: PlatformConnectorAuthSnapshot) {
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

function mapQrSessionToPlatformCompatData(session: PlatformQrLoginSession) {
  return {
    sessionId: session.sessionId,
    qrcodeKey: session.qrcodeKey,
    qrUrl: session.qrUrl,
    qrImageDataUrl: session.qrImageDataUrl,
    generatedAtMs: session.generatedAtMs,
    expiresAtMs: session.expiresAtMs,
  };
}

function mapQrPollResultToPlatformCompatData(result: PlatformQrLoginPollResult) {
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

function createBuiltinPlatformCompatRuntime(
  definition: PlatformConnectorDefinition,
  adapter: PlatformConnectorAdapter
): PlatformCompatRuntimeApi {
  return {
    auth: {
      getSnapshot: async () => {
        const snapshot = await adapter.getAuthSnapshot();
        if (!snapshot) {
          return createPlatformApiErrorResult(
            'API_UNAVAILABLE',
            `${definition.displayName} auth snapshot is unavailable`
          );
        }
        return createPlatformApiOkResult(mapAuthSnapshotToPlatformCompatAuthData(snapshot));
      },
      refreshSnapshot: async () => {
        const snapshot = await adapter.refreshAndEmitAuthSnapshot();
        if (!snapshot) {
          return createPlatformApiErrorResult(
            'API_UNAVAILABLE',
            `${definition.displayName} auth snapshot refresh is unavailable`
          );
        }
        return createPlatformApiOkResult(mapAuthSnapshotToPlatformCompatAuthData(snapshot));
      },
      beginQrLogin: async () => {
        if (definition.authFlow !== 'qr' || typeof adapter.beginQrLogin !== 'function') {
          return createPlatformApiErrorResult(
            'UNSUPPORTED_CAPABILITY',
            `${definition.displayName} does not support QR login`
          );
        }

        const session = await adapter.beginQrLogin();
        if (!session) {
          return createPlatformApiErrorResult(
            'API_UNAVAILABLE',
            `${definition.displayName} QR login session is unavailable`
          );
        }

        return createPlatformApiOkResult(mapQrSessionToPlatformCompatData(session));
      },
      pollQrLogin: async ({ sessionId }) => {
        if (definition.authFlow !== 'qr' || typeof adapter.pollQrLogin !== 'function') {
          return createPlatformApiErrorResult(
            'UNSUPPORTED_CAPABILITY',
            `${definition.displayName} does not support QR login polling`
          );
        }

        const result = await adapter.pollQrLogin(sessionId);
        if (!result) {
          return createPlatformApiErrorResult(
            'API_UNAVAILABLE',
            `${definition.displayName} QR login poll result is unavailable`
          );
        }

        return createPlatformApiOkResult(mapQrPollResultToPlatformCompatData(result));
      },
      logout: async () => {
        if (typeof adapter.logout !== 'function') {
          return createPlatformApiErrorResult(
            'UNSUPPORTED_CAPABILITY',
            `${definition.displayName} does not support logout`
          );
        }

        const snapshot = await adapter.logout();
        if (!snapshot) {
          return createPlatformApiErrorResult(
            'API_UNAVAILABLE',
            `${definition.displayName} logout snapshot is unavailable`
          );
        }

        return createPlatformApiOkResult(mapAuthSnapshotToPlatformCompatAuthData(snapshot));
      },
      clearAuthCookies: async () => {
        if (typeof adapter.clearAuthCookies !== 'function') {
          return createPlatformApiErrorResult(
            'UNSUPPORTED_CAPABILITY',
            `${definition.displayName} does not support auth cookie clearing`
          );
        }

        const snapshot = await adapter.clearAuthCookies();
        if (!snapshot) {
          return createPlatformApiErrorResult(
            'API_UNAVAILABLE',
            `${definition.displayName} auth cookie clearing is unavailable`
          );
        }

        return createPlatformApiOkResult(mapAuthSnapshotToPlatformCompatAuthData(snapshot));
      },
    },
    metadata: {
      connectorId: definition.connectorId,
      workspaceKind: definition.workspaceKind,
      workspaceMode: definition.workspaceMode,
    },
  };
}

export function createPlatformCompatRuntimeFromConnectorAdapter(
  definition: PlatformConnectorDefinition,
  adapter: PlatformConnectorAdapter
): PlatformCompatRuntimeApi {
  return createBuiltinPlatformCompatRuntime(definition, adapter);
}

function createPassiveAdapter(definition: PlatformConnectorDefinition): PlatformConnectorAdapter {
  return {
    definition,
    getAuthSnapshot: async () => createUnsupportedSnapshot(definition),
    refreshAndEmitAuthSnapshot: async () => {
      const snapshot = createUnsupportedSnapshot(definition);
      emitPlatformConnectorAuthChanged(snapshot);
      return snapshot;
    },
    beginQrLogin: async () => null,
    pollQrLogin: async () => null,
    logout: async () => createUnsupportedSnapshot(definition),
    clearAuthCookies: async () => createUnsupportedSnapshot(definition),
  };
}

export function createPassivePlatformConnectorAdapter(
  definition: PlatformConnectorDefinition
): PlatformConnectorAdapter {
  return createPassiveAdapter(definition);
}

function createBilibiliAdapter(): PlatformConnectorAdapter {
  const definition = BUILTIN_CONNECTOR_DEFINITIONS[0];
  return {
    definition,
    getAuthSnapshot: async () => mapBilibiliAuthStatus(await getNativeBilibiliAuthStatus()),
    refreshAndEmitAuthSnapshot: async () => {
      const snapshot = mapBilibiliAuthStatus(await getNativeBilibiliAuthStatus());
      if (snapshot) {
        emitPlatformConnectorAuthChanged(snapshot);
      }
      return snapshot;
    },
    beginQrLogin: async () => mapBilibiliQrSession(await generateNativeBilibiliQrCodeSession()),
    pollQrLogin: async (sessionId: string) => {
      const result = mapBilibiliQrPollResult(await pollNativeBilibiliQrCodeSession(sessionId));
      if (!result) return null;

      if (
        result.authState === 'authorized' ||
        result.authState === 'expired' ||
        result.authState === 'revoked' ||
        result.authState === 'error'
      ) {
        const snapshot = mapBilibiliAuthStatus(await getNativeBilibiliAuthStatus());
        if (snapshot) {
          emitPlatformConnectorAuthChanged(snapshot);
        }
      }

      return result;
    },
    logout: async () => {
      const snapshot = mapBilibiliAuthStatus(await logoutNativeBilibili());
      if (snapshot) {
        emitPlatformConnectorAuthChanged(snapshot);
      }
      return snapshot;
    },
    clearAuthCookies: async () => {
      const snapshot = mapBilibiliAuthStatus(await clearNativeBilibiliAuthCookies());
      if (snapshot) {
        emitPlatformConnectorAuthChanged(snapshot);
      }
      return snapshot;
    },
  };
}

function createNeteaseAdapter(): PlatformConnectorAdapter {
  const definition = BUILTIN_CONNECTOR_DEFINITIONS[1];
  return {
    definition,
    getAuthSnapshot: async () => mapNeteaseAuthStatus(await getNativeNeteaseAuthStatus()),
    refreshAndEmitAuthSnapshot: async () => {
      const snapshot = mapNeteaseAuthStatus(await getNativeNeteaseAuthStatus());
      if (snapshot) {
        emitPlatformConnectorAuthChanged(snapshot);
      }
      return snapshot;
    },
    beginQrLogin: async () => mapNeteaseQrSession(await generateNativeNeteaseQrCodeSession()),
    pollQrLogin: async (sessionId: string) => {
      const result = mapNeteaseQrPollResult(await pollNativeNeteaseQrCodeSession(sessionId));
      if (!result) return null;

      if (
        result.authState === 'authorized' ||
        result.authState === 'expired' ||
        result.authState === 'revoked' ||
        result.authState === 'error'
      ) {
        clearNeteaseFacadeCaches();
        const snapshot = mapNeteaseAuthStatus(await getNativeNeteaseAuthStatus());
        if (snapshot) {
          emitPlatformConnectorAuthChanged(snapshot);
        }
      }

      return result;
    },
    logout: async () => {
      clearNeteaseFacadeCaches();
      const snapshot = mapNeteaseAuthStatus(await logoutNativeNetease());
      if (snapshot) {
        emitPlatformConnectorAuthChanged(snapshot);
      }
      return snapshot;
    },
    clearAuthCookies: async () => {
      clearNeteaseFacadeCaches();
      const snapshot = mapNeteaseAuthStatus(await clearNativeNeteaseAuthCookies());
      if (snapshot) {
        emitPlatformConnectorAuthChanged(snapshot);
      }
      return snapshot;
    },
  };
}

function registerBuiltinPlatformConnectorAdapters(): void {
  if (platformConnectorAdapterRegistry.size > 0) return;

  const bilibili = createBilibiliAdapter();
  platformConnectorAdapterRegistry.set(bilibili.definition.connectorId, bilibili);
  const netease = createNeteaseAdapter();
  platformConnectorAdapterRegistry.set(netease.definition.connectorId, netease);

  for (const definition of BUILTIN_CONNECTOR_DEFINITIONS) {
    if (platformConnectorAdapterRegistry.has(definition.connectorId)) continue;
    platformConnectorAdapterRegistry.set(definition.connectorId, createPassiveAdapter(definition));
  }
}

registerBuiltinPlatformConnectorAdapters();

function cloneConnectorDefinition(definition: PlatformConnectorDefinition): PlatformConnectorDefinition {
  return { ...definition };
}

function cloneBuiltinPlatformCompatRegistration(
  registration: BuiltinPlatformCompatRegistration
): BuiltinPlatformCompatRegistration {
  return {
    ...registration,
    contract: {
      ...registration.contract,
      platform: { ...registration.contract.platform },
      auth: { ...registration.contract.auth },
      capabilities: { ...registration.contract.capabilities },
      apiBindings: { ...registration.contract.apiBindings },
      extension: registration.contract.extension ? { ...registration.contract.extension } : undefined,
    },
    metadata: registration.metadata ? { ...registration.metadata } : undefined,
  };
}

function emitPlatformConnectorDefinitionsChanged(): void {
  if (platformConnectorDefinitionsListeners.size === 0) return;
  const snapshot = listPlatformConnectorDefinitions();
  for (const listener of platformConnectorDefinitionsListeners) {
    listener(snapshot.map(cloneConnectorDefinition));
  }
}

function emitPlatformConnectorCompatRegistrationsChanged(): void {
  if (platformConnectorCompatRegistrationsListeners.size === 0) return;
  const snapshot = listBuiltinPlatformCompatRegistrations();
  for (const listener of platformConnectorCompatRegistrationsListeners) {
    listener(snapshot.map(cloneBuiltinPlatformCompatRegistration));
  }
}

function buildBuiltinPlatformCompatRegistrations(): BuiltinPlatformCompatRegistration[] {
  registerBuiltinPlatformConnectorAdapters();

  return listBuiltinPlatformCompatContractRegistrations().flatMap((builtinContractRegistration) => {
    const definition =
      BUILTIN_CONNECTOR_DEFINITIONS.find(
        (item) => item.connectorId === builtinContractRegistration.connectorId
      ) ?? null;
    if (!definition) {
      return [];
    }

    const adapter =
      platformConnectorAdapterRegistry.get(definition.connectorId) ?? createPassiveAdapter(definition);
    const contract = builtinContractRegistration.contract;
    return {
      platformId: contract.platform.platformId,
      connectorId: definition.connectorId,
      enabled: builtinContractRegistration.enabled,
      contract,
      runtime: createBuiltinPlatformCompatRuntime(definition, adapter),
      source: 'builtin',
      metadata: {
        connectorId: definition.connectorId,
        runtimeAdapter: 'connectorAuth',
      },
    };
  });
}

export {
  getBuiltinPlatformCompatContractRegistration,
  listBuiltinPlatformCompatContractRegistrations,
};

function listDynamicPlatformCompatRegistrations(): BuiltinPlatformCompatRegistration[] {
  return Array.from(dynamicPlatformCompatRegistrations.values()).map(
    cloneBuiltinPlatformCompatRegistration
  );
}

function listMergedPlatformCompatRegistrations(): BuiltinPlatformCompatRegistration[] {
  if (!builtinPlatformCompatRegistrations) {
    builtinPlatformCompatRegistrations = buildBuiltinPlatformCompatRegistrations();
  }

  const merged = new Map<PlatformConnectorId, BuiltinPlatformCompatRegistration>();
  for (const item of builtinPlatformCompatRegistrations) {
    merged.set(item.connectorId, cloneBuiltinPlatformCompatRegistration(item));
  }
  for (const item of listDynamicPlatformCompatRegistrations()) {
    merged.set(item.connectorId, cloneBuiltinPlatformCompatRegistration(item));
  }

  return Array.from(merged.values()).sort((left, right) => {
    const leftDefinition = getPlatformConnectorDefinition(left.connectorId);
    const rightDefinition = getPlatformConnectorDefinition(right.connectorId);
    if (leftDefinition && rightDefinition) {
      return sortByConnectorDefinition(leftDefinition, rightDefinition);
    }
    return left.platformId.localeCompare(right.platformId, 'zh-CN');
  });
}

export function listBuiltinPlatformCompatRegistrations(): BuiltinPlatformCompatRegistration[] {
  return listMergedPlatformCompatRegistrations().map(cloneBuiltinPlatformCompatRegistration);
}

function sortByConnectorDefinition(
  left: PlatformConnectorDefinition,
  right: PlatformConnectorDefinition
): number {
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }
  return left.displayName.localeCompare(right.displayName, 'zh-CN');
}

export function registerPlatformConnectorAdapter(adapter: PlatformConnectorAdapter): void {
  registerBuiltinPlatformConnectorAdapters();
  builtinPlatformCompatRegistrations = null;
  platformConnectorAdapterRegistry.set(adapter.definition.connectorId, adapter);
  emitPlatformConnectorDefinitionsChanged();
  emitPlatformConnectorCompatRegistrationsChanged();
}

export function unregisterPlatformConnectorAdapter(connectorId: string): boolean {
  registerBuiltinPlatformConnectorAdapters();
  const normalizedConnectorId = normalizeConnectorId(connectorId);
  if (!normalizedConnectorId) return false;
  if (BUILTIN_CONNECTOR_DEFINITIONS.some((item) => item.connectorId === normalizedConnectorId)) {
    return false;
  }
  const deleted = platformConnectorAdapterRegistry.delete(normalizedConnectorId);
  if (!deleted) return false;
  dynamicPlatformCompatRegistrations.delete(normalizedConnectorId);
  builtinPlatformCompatRegistrations = null;
  emitPlatformConnectorDefinitionsChanged();
  emitPlatformConnectorCompatRegistrationsChanged();
  return true;
}

export function registerPlatformCompatRegistrationForConnector(
  registration: BuiltinPlatformCompatRegistration
): void {
  registerBuiltinPlatformConnectorAdapters();
  dynamicPlatformCompatRegistrations.set(
    registration.connectorId,
    cloneBuiltinPlatformCompatRegistration({
      ...registration,
      source: registration.source ?? 'runtime',
    })
  );
  emitPlatformConnectorCompatRegistrationsChanged();
}

export function unregisterPlatformCompatRegistrationForConnector(connectorId: string): boolean {
  const normalizedConnectorId = normalizeConnectorId(connectorId);
  if (!normalizedConnectorId) return false;
  const deleted = dynamicPlatformCompatRegistrations.delete(normalizedConnectorId);
  if (deleted) {
    emitPlatformConnectorCompatRegistrationsChanged();
  }
  return deleted;
}

export function listPlatformConnectorDefinitions(): PlatformConnectorDefinition[] {
  registerBuiltinPlatformConnectorAdapters();
  const definitions = Array.from(platformConnectorAdapterRegistry.values()).map((item) => item.definition);
  return definitions.map(cloneConnectorDefinition).sort(sortByConnectorDefinition);
}

export function getPlatformConnectorDefinition(
  connectorId: string
): PlatformConnectorDefinition | null {
  const normalizedConnectorId = normalizeConnectorId(connectorId);
  if (!normalizedConnectorId) return null;
  const adapter = platformConnectorAdapterRegistry.get(normalizedConnectorId);
  return adapter?.definition ? cloneConnectorDefinition(adapter.definition) : null;
}

function getPlatformConnectorAdapter(connectorId: string): PlatformConnectorAdapter | null {
  const normalizedConnectorId = normalizeConnectorId(connectorId);
  if (!normalizedConnectorId) return null;
  return platformConnectorAdapterRegistry.get(normalizedConnectorId) ?? null;
}

export function listPlatformConnectorAdapters(): PlatformConnectorAdapter[] {
  return listPlatformConnectorDefinitions()
    .map((definition) => platformConnectorAdapterRegistry.get(definition.connectorId))
    .filter((adapter): adapter is PlatformConnectorAdapter => Boolean(adapter));
}

export function subscribePlatformConnectorDefinitions(
  listener: PlatformConnectorDefinitionsListener
): () => void {
  platformConnectorDefinitionsListeners.add(listener);
  return () => {
    platformConnectorDefinitionsListeners.delete(listener);
  };
}

export function subscribePlatformConnectorCompatRegistrations(
  listener: PlatformConnectorCompatRegistrationsListener
): () => void {
  platformConnectorCompatRegistrationsListeners.add(listener);
  return () => {
    platformConnectorCompatRegistrationsListeners.delete(listener);
  };
}

export function emitPlatformConnectorAuthChanged(snapshot: PlatformConnectorAuthSnapshot): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<PlatformConnectorAuthSnapshot>(PLATFORM_CONNECTOR_AUTH_CHANGED_EVENT, {
      detail: snapshot,
    })
  );
}

export function subscribePlatformConnectorAuthChanged(
  listener: (snapshot: PlatformConnectorAuthSnapshot) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = (event: Event) => {
    const payload = (event as PlatformConnectorAuthChangedEvent).detail;
    if (!payload) return;
    listener(payload);
  };

  window.addEventListener(PLATFORM_CONNECTOR_AUTH_CHANGED_EVENT, handler as EventListener);
  return () => {
    window.removeEventListener(PLATFORM_CONNECTOR_AUTH_CHANGED_EVENT, handler as EventListener);
  };
}

export async function getPlatformConnectorAuthSnapshot(
  connectorId: string
): Promise<PlatformConnectorAuthSnapshot | null> {
  const adapter = getPlatformConnectorAdapter(connectorId);
  if (!adapter) return null;
  const snapshot = await adapter.getAuthSnapshot();
  return snapshot ?? createUnsupportedSnapshot(adapter.definition);
}

export async function refreshAndEmitPlatformConnectorAuthSnapshot(
  connectorId: string
): Promise<PlatformConnectorAuthSnapshot | null> {
  const adapter = getPlatformConnectorAdapter(connectorId);
  if (!adapter) return null;
  const snapshot = await adapter.refreshAndEmitAuthSnapshot();
  return snapshot ?? createUnsupportedSnapshot(adapter.definition);
}

export async function beginPlatformQrLogin(
  connectorId: string
): Promise<PlatformQrLoginSession | null> {
  const adapter = getPlatformConnectorAdapter(connectorId);
  if (!adapter || typeof adapter.beginQrLogin !== 'function') return null;
  return adapter.beginQrLogin();
}

export async function pollPlatformQrLogin(
  connectorId: string,
  sessionId: string
): Promise<PlatformQrLoginPollResult | null> {
  const adapter = getPlatformConnectorAdapter(connectorId);
  if (!adapter || typeof adapter.pollQrLogin !== 'function') return null;
  return adapter.pollQrLogin(sessionId);
}

export async function logoutPlatformConnector(
  connectorId: string
): Promise<PlatformConnectorAuthSnapshot | null> {
  const adapter = getPlatformConnectorAdapter(connectorId);
  if (!adapter || typeof adapter.logout !== 'function') return null;
  const snapshot = await adapter.logout();
  return snapshot ?? createUnsupportedSnapshot(adapter.definition);
}

export async function clearPlatformConnectorCookies(
  connectorId: string
): Promise<PlatformConnectorAuthSnapshot | null> {
  const adapter = getPlatformConnectorAdapter(connectorId);
  if (!adapter || typeof adapter.clearAuthCookies !== 'function') return null;
  const snapshot = await adapter.clearAuthCookies();
  return snapshot ?? createUnsupportedSnapshot(adapter.definition);
}

export async function listPlatformConnectorAuthSnapshots(): Promise<PlatformConnectorAuthSnapshot[]> {
  const adapters = listPlatformConnectorAdapters();
  const snapshots = await Promise.all(adapters.map((adapter) => adapter.getAuthSnapshot()));
  return adapters
    .map((adapter, index) => snapshots[index] ?? createUnsupportedSnapshot(adapter.definition))
    .sort((left, right) => {
      const leftDefinition = getPlatformConnectorDefinition(left.connectorId);
      const rightDefinition = getPlatformConnectorDefinition(right.connectorId);
      if (leftDefinition && rightDefinition) {
        return sortByConnectorDefinition(leftDefinition, rightDefinition);
      }
      return left.displayName.localeCompare(right.displayName, 'zh-CN');
    });
}

export async function getBilibiliConnectorAuthSnapshot(): Promise<PlatformConnectorAuthSnapshot | null> {
  return getPlatformConnectorAuthSnapshot(BILIBILI_CONNECTOR_ID);
}

export async function refreshAndEmitBilibiliConnectorAuthSnapshot(): Promise<PlatformConnectorAuthSnapshot | null> {
  return refreshAndEmitPlatformConnectorAuthSnapshot(BILIBILI_CONNECTOR_ID);
}

export async function beginBilibiliQrLogin(): Promise<BilibiliQrLoginSession | null> {
  return beginPlatformQrLogin(BILIBILI_CONNECTOR_ID);
}

export async function pollBilibiliQrLogin(
  sessionId: string
): Promise<BilibiliQrLoginPollResult | null> {
  return pollPlatformQrLogin(BILIBILI_CONNECTOR_ID, sessionId);
}

export async function logoutBilibiliConnector(): Promise<PlatformConnectorAuthSnapshot | null> {
  return logoutPlatformConnector(BILIBILI_CONNECTOR_ID);
}
