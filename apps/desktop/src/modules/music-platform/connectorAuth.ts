import {
  generateNativeBilibiliQrCodeSession,
  getNativeBilibiliAuthStatus,
  logoutNativeBilibili,
  pollNativeBilibiliQrCodeSession,
  type NativeBilibiliAuthStatus,
  type NativeBilibiliQrCodeSession,
  type NativeBilibiliQrPollResult,
} from '../music-library';

export type PlatformConnectorId = 'connector.platform.bilibili';

export type PlatformConnectorAuthState =
  | 'unauthorized'
  | 'pending'
  | 'authorized'
  | 'expired'
  | 'revoked'
  | 'error';

export interface PlatformConnectorAuthSnapshot {
  connectorId: PlatformConnectorId;
  displayName: string;
  authState: PlatformConnectorAuthState;
  accountUid?: string;
  updatedAtMs?: number;
  expiresAtMs?: number;
  availability?: 'available' | 'degraded' | 'unavailable';
  availabilityMessage?: string;
}

export interface BilibiliQrLoginSession {
  connectorId: PlatformConnectorId;
  sessionId: string;
  qrcodeKey: string;
  qrUrl: string;
  qrImageDataUrl: string;
  generatedAtMs: number;
  expiresAtMs: number;
}

export interface BilibiliQrLoginPollResult {
  connectorId: PlatformConnectorId;
  sessionId: string;
  state: string;
  stateCode: number;
  stateMessage: string;
  authState: PlatformConnectorAuthState;
  accountUid?: string;
  expiresAtMs?: number;
}

export const PLATFORM_CONNECTOR_AUTH_CHANGED_EVENT =
  'pmp-platform-connector-auth-changed' as const;

type PlatformConnectorAuthChangedEvent = CustomEvent<PlatformConnectorAuthSnapshot>;

const BILIBILI_CONNECTOR_ID: PlatformConnectorId = 'connector.platform.bilibili';

function normalizeAvailability(value: string | undefined):
  | 'available'
  | 'degraded'
  | 'unavailable'
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
  const connectorId =
    status.connectorId === BILIBILI_CONNECTOR_ID ? BILIBILI_CONNECTOR_ID : BILIBILI_CONNECTOR_ID;

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
): BilibiliQrLoginSession | null {
  if (!session) return null;
  return {
    connectorId: BILIBILI_CONNECTOR_ID,
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
): BilibiliQrLoginPollResult | null {
  if (!result) return null;
  return {
    connectorId: BILIBILI_CONNECTOR_ID,
    sessionId: result.sessionId,
    state: result.state,
    stateCode: result.stateCode,
    stateMessage: result.stateMessage,
    authState: normalizeAuthState(result.authState),
    accountUid: result.accountUid,
    expiresAtMs: result.expiresAtMs,
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

export async function getBilibiliConnectorAuthSnapshot(): Promise<PlatformConnectorAuthSnapshot | null> {
  return mapBilibiliAuthStatus(await getNativeBilibiliAuthStatus());
}

export async function refreshAndEmitBilibiliConnectorAuthSnapshot(): Promise<PlatformConnectorAuthSnapshot | null> {
  const snapshot = await getBilibiliConnectorAuthSnapshot();
  if (snapshot) {
    emitPlatformConnectorAuthChanged(snapshot);
  }
  return snapshot;
}

export async function beginBilibiliQrLogin(): Promise<BilibiliQrLoginSession | null> {
  return mapBilibiliQrSession(await generateNativeBilibiliQrCodeSession());
}

export async function pollBilibiliQrLogin(
  sessionId: string
): Promise<BilibiliQrLoginPollResult | null> {
  const result = mapBilibiliQrPollResult(await pollNativeBilibiliQrCodeSession(sessionId));
  if (!result) return null;

  if (
    result.authState === 'authorized' ||
    result.authState === 'expired' ||
    result.authState === 'revoked' ||
    result.authState === 'error'
  ) {
    await refreshAndEmitBilibiliConnectorAuthSnapshot();
  }

  return result;
}

export async function logoutBilibiliConnector(): Promise<PlatformConnectorAuthSnapshot | null> {
  const status = mapBilibiliAuthStatus(await logoutNativeBilibili());
  if (status) {
    emitPlatformConnectorAuthChanged(status);
  }
  return status;
}

export async function listPlatformConnectorAuthSnapshots(): Promise<PlatformConnectorAuthSnapshot[]> {
  const bilibili = await getBilibiliConnectorAuthSnapshot();
  return bilibili ? [bilibili] : [];
}
