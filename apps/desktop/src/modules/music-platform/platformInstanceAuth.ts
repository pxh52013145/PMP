import type {
  PlatformApiResult,
  PlatformCompatAvailability,
  PlatformCompatRuntimeAuthState,
  PlatformCompatRuntimeApi,
} from '@pixel-matrix/plugin-platform-contracts';

import {
  getPlatformCompatRuntimeApi,
} from './contractRegistry';
import { getPlatformInstance, listPlatformInstances, refreshPlatformInstance } from './instanceRegistry';
import {
  resolveDefaultPlatformInstanceIdForConnector,
  resolvePlatformRuntimeDescriptorByInstanceId,
} from './platformRuntimeDescriptor';
import { getActiveMusicPlatformInstanceId } from './activeInstanceRegistry';
export interface PlatformInstanceAuthSnapshot {
  instanceId: string;
  platformId: string;
  connectorId?: string;
  displayName: string;
  authState: PlatformCompatRuntimeAuthState;
  accountUid?: string;
  updatedAtMs?: number;
  expiresAtMs?: number;
  availability?: PlatformCompatAvailability;
  availabilityMessage?: string;
}

export interface PlatformInstanceQrLoginSession {
  instanceId: string;
  platformId: string;
  connectorId?: string;
  sessionId: string;
  qrcodeKey: string;
  qrUrl: string;
  qrImageDataUrl: string;
  generatedAtMs: number;
  expiresAtMs: number;
}

export interface PlatformInstanceQrLoginPollResult {
  instanceId: string;
  platformId: string;
  connectorId?: string;
  sessionId: string;
  state: string;
  stateCode: number;
  stateMessage: string;
  authState: PlatformCompatRuntimeAuthState;
  accountUid?: string;
  expiresAtMs?: number;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAuthState(value: unknown): PlatformCompatRuntimeAuthState {
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

function mapInstanceAuthStatusToConnectorAuthState(value: unknown): PlatformCompatRuntimeAuthState {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'authorized') return 'authorized';
  if (normalized === 'authorizing') return 'pending';
  if (normalized === 'expired') return 'expired';
  if (normalized === 'error') return 'error';
  return 'unauthorized';
}

function mapRecordToSnapshot(
  record: NonNullable<ReturnType<typeof getPlatformInstance>>
): PlatformInstanceAuthSnapshot {
  return {
    instanceId: record.instanceId,
    platformId: record.platformId,
    connectorId:
      typeof record.metadata?.connectorId === 'string' ? record.metadata.connectorId : undefined,
    displayName: record.displayName,
    authState: mapInstanceAuthStatusToConnectorAuthState(record.auth.status),
    accountUid: record.account.accountId,
    updatedAtMs: record.auth.cookieUpdatedAtMs,
    expiresAtMs:
      typeof record.metadata?.authExpiresAtMs === 'number' &&
      Number.isFinite(record.metadata.authExpiresAtMs)
        ? record.metadata.authExpiresAtMs
        : undefined,
    availability: record.availability,
    availabilityMessage: record.availabilityMessage,
  };
}

function resolveRuntimeForInstance(
  instanceId: string
): {
  instanceId: string;
  platformId: string;
  connectorId?: string;
  displayName: string;
  runtime: PlatformCompatRuntimeApi | null;
} | null {
  const descriptor = resolvePlatformRuntimeDescriptorByInstanceId(instanceId);
  const record = descriptor?.instanceRecord ?? null;
  if (!descriptor || !record) return null;
  return {
    instanceId: record.instanceId,
    platformId: record.platformId,
    connectorId:
      typeof record.metadata?.connectorId === 'string' ? record.metadata.connectorId : undefined,
    displayName: record.displayName,
    runtime: descriptor.runtime ?? getPlatformCompatRuntimeApi(record.platformId),
  };
}

async function callInstanceAuthMethod<T>(
  instanceId: string,
  method: keyof NonNullable<PlatformCompatRuntimeApi['auth']>,
  payload: Record<string, unknown> = {}
): Promise<T | null> {
  const runtimeContext = resolveRuntimeForInstance(instanceId);
  const fn = runtimeContext?.runtime?.auth?.[method] as
    | ((input: Record<string, unknown>) => Promise<PlatformApiResult<T>>)
    | undefined;
  if (!runtimeContext || typeof fn !== 'function') return null;

  const result = await fn({
    instanceId: runtimeContext.instanceId,
    ...payload,
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data as T;
}

export function resolvePlatformInstanceId(options: {
  instanceId?: string | null;
  connectorId?: string | null;
}): string | null {
  const explicitInstanceId = normalizeString(options.instanceId);
  if (explicitInstanceId) return explicitInstanceId;
  const connectorId = normalizeString(options.connectorId);
  return (
    getActiveMusicPlatformInstanceId({ connectorId }) ??
    resolveDefaultPlatformInstanceIdForConnector(connectorId)
  );
}

export function getPlatformInstanceAuthSnapshot(
  instanceId: string
): PlatformInstanceAuthSnapshot | null {
  const record = getPlatformInstance(instanceId);
  return record ? mapRecordToSnapshot(record) : null;
}

export async function refreshPlatformInstanceAuthSnapshot(
  instanceId: string
): Promise<PlatformInstanceAuthSnapshot | null> {
  const record = await refreshPlatformInstance(instanceId);
  return record ? mapRecordToSnapshot(record) : null;
}

export async function listPlatformInstanceAuthSnapshots(options?: {
  refresh?: boolean;
}): Promise<PlatformInstanceAuthSnapshot[]> {
  if (options?.refresh) {
    const refreshed = await Promise.all(
      listPlatformInstances().map((instance) => refreshPlatformInstance(instance.instanceId))
    );
    return refreshed
      .filter(
        (
          instance
        ): instance is NonNullable<typeof instance> => Boolean(instance)
      )
      .map(mapRecordToSnapshot);
  }

  return listPlatformInstances().map(mapRecordToSnapshot);
}

export async function beginPlatformInstanceQrLogin(
  instanceId: string
): Promise<PlatformInstanceQrLoginSession | null> {
  const runtimeContext = resolveRuntimeForInstance(instanceId);
  if (!runtimeContext) return null;

  const session = await callInstanceAuthMethod<{
    sessionId: string;
    qrcodeKey: string;
    qrUrl: string;
    qrImageDataUrl: string;
    generatedAtMs: number;
    expiresAtMs: number;
  }>(instanceId, 'beginQrLogin');
  if (!session) return null;

  return {
    instanceId: runtimeContext.instanceId,
    platformId: runtimeContext.platformId,
    connectorId: runtimeContext.connectorId,
    sessionId: normalizeString(session.sessionId),
    qrcodeKey: normalizeString(session.qrcodeKey),
    qrUrl: normalizeString(session.qrUrl),
    qrImageDataUrl: normalizeString(session.qrImageDataUrl),
    generatedAtMs: session.generatedAtMs,
    expiresAtMs: session.expiresAtMs,
  };
}

export async function pollPlatformInstanceQrLogin(
  instanceId: string,
  sessionId: string
): Promise<PlatformInstanceQrLoginPollResult | null> {
  const runtimeContext = resolveRuntimeForInstance(instanceId);
  if (!runtimeContext) return null;

  const result = await callInstanceAuthMethod<{
    sessionId: string;
    state: string;
    stateCode: number;
    stateMessage: string;
    authState: string;
    accountId?: string;
    expiresAtMs?: number;
  }>(instanceId, 'pollQrLogin', {
    sessionId,
  });
  if (!result) return null;

  await refreshPlatformInstance(instanceId);

  return {
    instanceId: runtimeContext.instanceId,
    platformId: runtimeContext.platformId,
    connectorId: runtimeContext.connectorId,
    sessionId: normalizeString(result.sessionId),
    state: normalizeString(result.state),
    stateCode:
      typeof result.stateCode === 'number' && Number.isFinite(result.stateCode)
        ? result.stateCode
        : 0,
    stateMessage: normalizeString(result.stateMessage),
    authState: normalizeAuthState(result.authState),
    accountUid: normalizeString(result.accountId) || undefined,
    expiresAtMs:
      typeof result.expiresAtMs === 'number' && Number.isFinite(result.expiresAtMs)
        ? result.expiresAtMs
        : undefined,
  };
}

export async function logoutPlatformInstance(
  instanceId: string
): Promise<PlatformInstanceAuthSnapshot | null> {
  const result = await callInstanceAuthMethod<{
    authState: string;
    accountId?: string;
    updatedAtMs?: number;
    expiresAtMs?: number;
    availability?: PlatformCompatAvailability;
    availabilityMessage?: string;
  }>(instanceId, 'logout');
  if (!result) return null;
  return refreshPlatformInstanceAuthSnapshot(instanceId);
}

export async function clearPlatformInstanceAuthCookies(
  instanceId: string
): Promise<PlatformInstanceAuthSnapshot | null> {
  const result = await callInstanceAuthMethod<{
    authState: string;
    accountId?: string;
    updatedAtMs?: number;
    expiresAtMs?: number;
    availability?: PlatformCompatAvailability;
    availabilityMessage?: string;
  }>(instanceId, 'clearAuthCookies');
  if (!result) return null;
  return refreshPlatformInstanceAuthSnapshot(instanceId);
}
