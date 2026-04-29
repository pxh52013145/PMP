import {
  beginPlatformInstanceQrLogin,
  clearPlatformInstanceAuthCookies,
  getPlatformInstanceAuthSnapshot,
  logoutPlatformInstance,
  pollPlatformInstanceQrLogin,
  refreshPlatformInstanceAuthSnapshot,
  resolvePlatformInstanceId,
} from './platformInstanceAuth';
import type {
  PlatformConnectorAuthSnapshot,
  PlatformConnectorAuthState,
  PlatformConnectorAvailability,
  PlatformConnectorDefinition,
  PlatformQrLoginPollResult,
  PlatformQrLoginSession,
} from './platformConnectorModel';

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAuthState(value: unknown): PlatformConnectorAuthState {
  const normalized = normalizeString(value).toLowerCase();
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
  return 'unauthorized';
}

function normalizeAvailability(value: unknown): PlatformConnectorAvailability | undefined {
  const normalized = normalizeString(value).toLowerCase();
  if (
    normalized === 'available' ||
    normalized === 'degraded' ||
    normalized === 'unavailable'
  ) {
    return normalized;
  }
  return undefined;
}

function resolveConnectorInstanceId(connectorId: string): string | null {
  return resolvePlatformInstanceId({
    connectorId,
  });
}

function mapInstanceSnapshotToConnectorSnapshot(
  definition: PlatformConnectorDefinition,
  snapshot:
    | Awaited<ReturnType<typeof getPlatformInstanceAuthSnapshot>>
    | Awaited<ReturnType<typeof refreshPlatformInstanceAuthSnapshot>>
): PlatformConnectorAuthSnapshot | null {
  if (!snapshot) return null;

  return {
    connectorId: definition.connectorId,
    displayName: normalizeString(snapshot.displayName) || definition.displayName,
    authState: normalizeAuthState(snapshot.authState),
    accountUid: normalizeString(snapshot.accountUid) || undefined,
    updatedAtMs: snapshot.updatedAtMs,
    expiresAtMs: snapshot.expiresAtMs,
    availability: normalizeAvailability(snapshot.availability),
    availabilityMessage: normalizeString(snapshot.availabilityMessage) || undefined,
  };
}

function mapInstanceQrSessionToConnectorSession(
  definition: PlatformConnectorDefinition,
  session: Awaited<ReturnType<typeof beginPlatformInstanceQrLogin>>
): PlatformQrLoginSession | null {
  if (!session) return null;
  return {
    connectorId: definition.connectorId,
    sessionId: normalizeString(session.sessionId),
    qrcodeKey: normalizeString(session.qrcodeKey),
    qrUrl: normalizeString(session.qrUrl),
    qrImageDataUrl: normalizeString(session.qrImageDataUrl),
    generatedAtMs: session.generatedAtMs,
    expiresAtMs: session.expiresAtMs,
  };
}

function mapInstanceQrPollToConnectorPollResult(
  definition: PlatformConnectorDefinition,
  result: Awaited<ReturnType<typeof pollPlatformInstanceQrLogin>>
): PlatformQrLoginPollResult | null {
  if (!result) return null;
  return {
    connectorId: definition.connectorId,
    sessionId: normalizeString(result.sessionId),
    state: normalizeString(result.state),
    stateCode: result.stateCode,
    stateMessage: normalizeString(result.stateMessage),
    authState: normalizeAuthState(result.authState),
    accountUid: normalizeString(result.accountUid) || undefined,
    expiresAtMs: result.expiresAtMs,
  };
}

export async function getConnectorAuthSnapshotFromInstanceAuth(
  definition: PlatformConnectorDefinition
) : Promise<PlatformConnectorAuthSnapshot | null> {
  const instanceId = resolveConnectorInstanceId(definition.connectorId);
  if (!instanceId) return null;
  const snapshot =
    getPlatformInstanceAuthSnapshot(instanceId) ??
    (await refreshPlatformInstanceAuthSnapshot(instanceId));
  return mapInstanceSnapshotToConnectorSnapshot(definition, snapshot);
}

export async function refreshConnectorAuthSnapshotFromInstanceAuth(
  definition: PlatformConnectorDefinition
): Promise<PlatformConnectorAuthSnapshot | null> {
  const instanceId = resolveConnectorInstanceId(definition.connectorId);
  if (!instanceId) return null;
  const snapshot =
    (await refreshPlatformInstanceAuthSnapshot(instanceId)) ??
    getPlatformInstanceAuthSnapshot(instanceId);
  return mapInstanceSnapshotToConnectorSnapshot(definition, snapshot);
}

export async function beginConnectorQrLoginFromInstanceAuth(
  definition: PlatformConnectorDefinition
): Promise<PlatformQrLoginSession | null> {
  const instanceId = resolveConnectorInstanceId(definition.connectorId);
  if (!instanceId) return null;
  return mapInstanceQrSessionToConnectorSession(
    definition,
    await beginPlatformInstanceQrLogin(instanceId)
  );
}

export async function pollConnectorQrLoginFromInstanceAuth(
  definition: PlatformConnectorDefinition,
  sessionId: string
): Promise<PlatformQrLoginPollResult | null> {
  const instanceId = resolveConnectorInstanceId(definition.connectorId);
  if (!instanceId) return null;
  return mapInstanceQrPollToConnectorPollResult(
    definition,
    await pollPlatformInstanceQrLogin(instanceId, sessionId)
  );
}

export async function logoutConnectorFromInstanceAuth(
  definition: PlatformConnectorDefinition
): Promise<PlatformConnectorAuthSnapshot | null> {
  const instanceId = resolveConnectorInstanceId(definition.connectorId);
  if (!instanceId) return null;
  return mapInstanceSnapshotToConnectorSnapshot(
    definition,
    await logoutPlatformInstance(instanceId)
  );
}

export async function clearConnectorAuthCookiesFromInstanceAuth(
  definition: PlatformConnectorDefinition
): Promise<PlatformConnectorAuthSnapshot | null> {
  const instanceId = resolveConnectorInstanceId(definition.connectorId);
  if (!instanceId) return null;
  return mapInstanceSnapshotToConnectorSnapshot(
    definition,
    await clearPlatformInstanceAuthCookies(instanceId)
  );
}
