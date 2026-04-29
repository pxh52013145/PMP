import type {
  PlatformCompatContractFile,
  PlatformCompatRuntimeApi,
} from '@pixel-matrix/plugin-platform-contracts';

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

export const BILIBILI_CONNECTOR_ID: PlatformConnectorId = 'connector.platform.bilibili';
export const NETEASE_CONNECTOR_ID: PlatformConnectorId = 'connector.platform.netease';

export function normalizePlatformConnectorId(value: unknown): PlatformConnectorId | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized.startsWith('connector.platform.')) return null;
  return normalized as PlatformConnectorId;
}

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
