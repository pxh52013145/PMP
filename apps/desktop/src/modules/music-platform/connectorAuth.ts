import {
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
import { clearNeteaseFacadeCaches } from './neteaseFacade';

export type PlatformConnectorId = `connector.platform.${string}`;

export type PlatformConnectorAuthState =
  | 'unauthorized'
  | 'pending'
  | 'authorized'
  | 'expired'
  | 'revoked'
  | 'error';

export type PlatformConnectorAvailability = 'available' | 'degraded' | 'unavailable';
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
  enabled: boolean;
  authFlow: 'qr' | 'none';
  workspaceKind: PlatformConnectorWorkspaceKind;
  workspaceMode: PlatformConnectorWorkspaceMode;
  sortOrder: number;
}

export interface PlatformConnectorAdapter {
  definition: PlatformConnectorDefinition;
  getAuthSnapshot: () => Promise<PlatformConnectorAuthSnapshot | null>;
  refreshAndEmitAuthSnapshot: () => Promise<PlatformConnectorAuthSnapshot | null>;
  beginQrLogin?: () => Promise<PlatformQrLoginSession | null>;
  pollQrLogin?: (sessionId: string) => Promise<PlatformQrLoginPollResult | null>;
  logout?: () => Promise<PlatformConnectorAuthSnapshot | null>;
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
    enabled: true,
    authFlow: 'qr',
    workspaceKind: 'bilibili',
    workspaceMode: 'dedicated',
    sortOrder: 10,
  },
  {
    connectorId: NETEASE_CONNECTOR_ID,
    displayName: 'Netease',
    labelKey: 'magnet.platform-login.platform.netease',
    iconKey: 'netease',
    enabled: true,
    authFlow: 'qr',
    workspaceKind: 'netease',
    workspaceMode: 'dedicated',
    sortOrder: 20,
  },
  {
    connectorId: QQMUSIC_CONNECTOR_ID,
    displayName: 'QQ Music',
    labelKey: 'magnet.platform-login.platform.qqmusic',
    iconKey: 'qqmusic',
    enabled: false,
    authFlow: 'none',
    workspaceKind: 'qqmusic',
    workspaceMode: 'dedicated',
    sortOrder: 30,
  },
];

const platformConnectorAdapterRegistry = new Map<PlatformConnectorId, PlatformConnectorAdapter>();

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
  };
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
  platformConnectorAdapterRegistry.set(adapter.definition.connectorId, adapter);
}

export function listPlatformConnectorDefinitions(): PlatformConnectorDefinition[] {
  registerBuiltinPlatformConnectorAdapters();
  const definitions = Array.from(platformConnectorAdapterRegistry.values()).map((item) => item.definition);
  return definitions.slice().sort(sortByConnectorDefinition);
}

export function getPlatformConnectorDefinition(
  connectorId: string
): PlatformConnectorDefinition | null {
  const normalizedConnectorId = normalizeConnectorId(connectorId);
  if (!normalizedConnectorId) return null;
  const adapter = platformConnectorAdapterRegistry.get(normalizedConnectorId);
  return adapter?.definition ?? null;
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
