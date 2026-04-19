import type {
  PlatformApiResult,
  PlatformCompatAvailability,
  PlatformCompatRuntimeAuthState,
} from '@pixel-matrix/plugin-platform-contracts';
import {
  getPlatformInstanceAuthAdapter,
  listPlatformInstanceAuthAdapters,
  type PlatformInstanceAuthAdapter,
  type PlatformInstanceAuthAdapterQrPollResult,
  type PlatformInstanceAuthAdapterQrSession,
  type PlatformInstanceAuthAdapterSnapshot,
} from './platformInstanceAuthAdapter';
import {
  normalizePlatformConnectorId,
  type PlatformConnectorId,
} from './platformConnectorModel';
import {
  listPlatformPackInstanceAuthBindingProviders,
  resolvePlatformPackInstanceAuthBindingProvider,
} from './platformPackRegistry';
import { isExpectedPlatformPackSidecarLifecycleError } from './platformPackSidecarBridge';

export type PlatformInstanceAuthBindingInvokeOptions = {
  bindingId: string;
  connectorId: PlatformConnectorId;
  displayName: string;
  method: string;
  payload?: Record<string, unknown>;
};

export type BuiltinConnectorAuthBindingInvokeOptions = PlatformInstanceAuthBindingInvokeOptions;

export type RuntimeAuthSnapshotData = {
  authState: PlatformCompatRuntimeAuthState;
  accountId?: string;
  accountName?: string;
  updatedAtMs?: number;
  expiresAtMs?: number;
  availability?: PlatformCompatAvailability;
  availabilityMessage?: string;
  metadata?: Record<string, unknown>;
};

export type RuntimeQrSessionData = {
  sessionId: string;
  qrcodeKey: string;
  qrUrl: string;
  qrImageDataUrl: string;
  generatedAtMs: number;
  expiresAtMs: number;
};

export type RuntimeQrPollData = {
  sessionId: string;
  state: string;
  stateCode: number;
  stateMessage: string;
  authState: PlatformCompatRuntimeAuthState;
  accountId?: string;
  expiresAtMs?: number;
  metadata?: Record<string, unknown>;
};

export type PlatformInstanceAuthBindingContext = {
  instanceId: string;
  options: PlatformInstanceAuthBindingInvokeOptions;
};

export type PlatformInstanceAuthBindingPollContext = PlatformInstanceAuthBindingContext & {
  sessionId: string;
};

export interface PlatformInstanceAuthBindingProvider {
  connectorId: PlatformConnectorId;
  getSnapshot: (
    context: PlatformInstanceAuthBindingContext
  ) => Promise<RuntimeAuthSnapshotData | null>;
  refreshSnapshot?: (
    context: PlatformInstanceAuthBindingContext
  ) => Promise<RuntimeAuthSnapshotData | null>;
  beginQrLogin?: (
    context: PlatformInstanceAuthBindingContext
  ) => Promise<RuntimeQrSessionData | null>;
  pollQrLogin?: (
    context: PlatformInstanceAuthBindingPollContext
  ) => Promise<RuntimeQrPollData | null>;
  logout?: (
    context: PlatformInstanceAuthBindingContext
  ) => Promise<RuntimeAuthSnapshotData | null>;
  clearAuthCookies?: (
    context: PlatformInstanceAuthBindingContext
  ) => Promise<RuntimeAuthSnapshotData | null>;
}

export type CreateDefaultPlatformInstanceAuthBindingProviderOptions = {
  connectorId: PlatformConnectorId;
  qrcodeKeyField?: 'qrcodeKey' | 'qrKey';
  invalidateConnectorCachesOnTerminalAuthState?: boolean;
  invalidateConnectorCachesOnLogout?: boolean;
  invalidateConnectorCachesOnClearAuthCookies?: boolean;
};

const dynamicPlatformInstanceAuthBindingProviders = new Map<
  PlatformConnectorId,
  PlatformInstanceAuthBindingProvider
>();

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

function normalizeAvailability(value: unknown): PlatformCompatAvailability | undefined {
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

function normalizePositiveInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function isTerminalAuthState(authState: PlatformCompatRuntimeAuthState): boolean {
  return (
    authState === 'authorized' ||
    authState === 'expired' ||
    authState === 'revoked' ||
    authState === 'error'
  );
}

function mapAdapterSnapshotToRuntimeData(
  context: PlatformInstanceAuthBindingContext,
  status: PlatformInstanceAuthAdapterSnapshot | null
): RuntimeAuthSnapshotData | null {
  if (!status) return null;

  return {
    authState: normalizeAuthState(status.authState),
    accountId: normalizeString(status.accountUid) || undefined,
    updatedAtMs:
      typeof status.updatedAtMs === 'number' && Number.isFinite(status.updatedAtMs)
        ? status.updatedAtMs
        : undefined,
    expiresAtMs:
      typeof status.expiresAtMs === 'number' && Number.isFinite(status.expiresAtMs)
        ? status.expiresAtMs
        : undefined,
    availability: normalizeAvailability(status.availability),
    availabilityMessage: normalizeString(status.availabilityMessage) || undefined,
    metadata: {
      connectorId: context.options.connectorId,
      displayName: context.options.displayName,
      instanceId: context.instanceId,
    },
  };
}

function mapAdapterQrSessionToRuntimeData(
  session: PlatformInstanceAuthAdapterQrSession | null,
  qrcodeKeyField: 'qrcodeKey' | 'qrKey'
): RuntimeQrSessionData | null {
  if (!session) return null;

  const sessionId = normalizeString(session.sessionId);
  const preferredQrcodeKey =
    qrcodeKeyField === 'qrKey'
      ? normalizeString(session.qrKey)
      : normalizeString(session.qrcodeKey);
  const fallbackQrcodeKey =
    qrcodeKeyField === 'qrKey'
      ? normalizeString(session.qrcodeKey)
      : normalizeString(session.qrKey);
  const qrcodeKey = preferredQrcodeKey || fallbackQrcodeKey;
  const qrUrl = normalizeString(session.qrUrl);
  const qrImageDataUrl = normalizeString(session.qrImageDataUrl);
  const generatedAtMs = normalizePositiveInt(session.generatedAtMs);
  const expiresAtMs = normalizePositiveInt(session.expiresAtMs);

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

function mapAdapterQrPollToRuntimeData(
  context: PlatformInstanceAuthBindingPollContext,
  result: PlatformInstanceAuthAdapterQrPollResult | null
): RuntimeQrPollData | null {
  if (!result) return null;

  const sessionId = normalizeString(result.sessionId);
  if (!sessionId) return null;

  return {
    sessionId,
    state: normalizeString(result.state) || 'unknown',
    stateCode: normalizePositiveInt(result.stateCode),
    stateMessage: normalizeString(result.stateMessage),
    authState: normalizeAuthState(result.authState),
    accountId: normalizeString(result.accountUid) || undefined,
    expiresAtMs:
      typeof result.expiresAtMs === 'number' && Number.isFinite(result.expiresAtMs)
        ? result.expiresAtMs
        : undefined,
    metadata: {
      connectorId: context.options.connectorId,
      instanceId: context.instanceId,
    },
  };
}

function createUnavailableProvider(
  connectorId: PlatformConnectorId
): PlatformInstanceAuthBindingProvider {
  return {
    connectorId,
    getSnapshot: async () => null,
    refreshSnapshot: async () => null,
    beginQrLogin: async () => null,
    pollQrLogin: async () => null,
    logout: async () => null,
    clearAuthCookies: async () => null,
  };
}

function createPlatformInstanceAuthBindingProviderFromAdapter(
  adapter: PlatformInstanceAuthAdapter,
  options: Omit<CreateDefaultPlatformInstanceAuthBindingProviderOptions, 'connectorId'> = {}
): PlatformInstanceAuthBindingProvider {
  const qrcodeKeyField = options.qrcodeKeyField ?? 'qrcodeKey';
  const invalidateConnectorCachesOnTerminalAuthState =
    options.invalidateConnectorCachesOnTerminalAuthState ??
    Boolean(adapter.invalidateConnectorCaches);
  const invalidateConnectorCachesOnLogout =
    options.invalidateConnectorCachesOnLogout ?? Boolean(adapter.invalidateConnectorCaches);
  const invalidateConnectorCachesOnClearAuthCookies =
    options.invalidateConnectorCachesOnClearAuthCookies ??
    Boolean(adapter.invalidateConnectorCaches);
  const beginQrLogin = adapter.beginQrLogin;
  const pollQrLogin = adapter.pollQrLogin;
  const logout = adapter.logout;
  const clearAuthCookies = adapter.clearAuthCookies;

  return {
    connectorId: adapter.connectorId,
    getSnapshot: async (context) =>
      mapAdapterSnapshotToRuntimeData(
        context,
        await adapter.getSnapshot(context.instanceId)
      ),
    refreshSnapshot: async (context) =>
      mapAdapterSnapshotToRuntimeData(
        context,
        await (adapter.refreshSnapshot ?? adapter.getSnapshot)(context.instanceId)
      ),
    beginQrLogin: beginQrLogin
      ? async (context) =>
          mapAdapterQrSessionToRuntimeData(
            await beginQrLogin(context.instanceId),
            qrcodeKeyField
          )
      : undefined,
    pollQrLogin: pollQrLogin
      ? async (context) => {
          const result = mapAdapterQrPollToRuntimeData(
            context,
            await pollQrLogin(context.sessionId)
          );
          if (
            result &&
            invalidateConnectorCachesOnTerminalAuthState &&
            isTerminalAuthState(result.authState)
          ) {
            await adapter.invalidateConnectorCaches?.(context.instanceId);
          }
          return result;
        }
      : undefined,
    logout: logout
      ? async (context) => {
          const snapshot = mapAdapterSnapshotToRuntimeData(
            context,
            await logout(context.instanceId)
          );
          if (invalidateConnectorCachesOnLogout) {
            await adapter.invalidateConnectorCaches?.(context.instanceId);
          }
          return snapshot;
        }
      : undefined,
    clearAuthCookies: clearAuthCookies
      ? async (context) => {
          const snapshot = mapAdapterSnapshotToRuntimeData(
            context,
            await clearAuthCookies(context.instanceId)
          );
          if (invalidateConnectorCachesOnClearAuthCookies) {
            await adapter.invalidateConnectorCaches?.(context.instanceId);
          }
          return snapshot;
        }
      : undefined,
  };
}

function getPlatformInstanceAuthBindingProvider(
  connectorId: string
): PlatformInstanceAuthBindingProvider | null {
  const normalizedConnectorId = normalizePlatformConnectorId(connectorId);
  if (!normalizedConnectorId) return null;

  return (
    dynamicPlatformInstanceAuthBindingProviders.get(normalizedConnectorId) ??
    resolvePlatformPackInstanceAuthBindingProvider(normalizedConnectorId) ??
    null
  );
}

function createUnavailableAuthBindingResult(
  options: PlatformInstanceAuthBindingInvokeOptions,
  method: string
): PlatformApiResult<never> {
  switch (method) {
    case 'beginQrLogin':
      return err(
        'UNSUPPORTED_CAPABILITY',
        `${options.displayName} QR login session is unavailable`
      );
    case 'pollQrLogin':
      return err(
        'UNSUPPORTED_CAPABILITY',
        `${options.displayName} QR login poll result is unavailable`
      );
    case 'logout':
      return err('API_UNAVAILABLE', `${options.displayName} logout snapshot is unavailable`);
    case 'clearAuthCookies':
      return err(
        'API_UNAVAILABLE',
        `${options.displayName} auth cookie clearing is unavailable`
      );
    case 'refreshSnapshot':
      return err(
        'API_UNAVAILABLE',
        `${options.displayName} auth snapshot refresh is unavailable`
      );
    case 'getSnapshot':
    default:
      return err('API_UNAVAILABLE', `${options.displayName} auth snapshot is unavailable`);
  }
}

export function createDefaultPlatformInstanceAuthBindingProvider(
  options: CreateDefaultPlatformInstanceAuthBindingProviderOptions
): PlatformInstanceAuthBindingProvider | null {
  const adapter = getPlatformInstanceAuthAdapter(options.connectorId);
  if (!adapter) return null;
  return createPlatformInstanceAuthBindingProviderFromAdapter(adapter, {
    qrcodeKeyField: options.qrcodeKeyField,
    invalidateConnectorCachesOnTerminalAuthState:
      options.invalidateConnectorCachesOnTerminalAuthState,
    invalidateConnectorCachesOnLogout: options.invalidateConnectorCachesOnLogout,
    invalidateConnectorCachesOnClearAuthCookies:
      options.invalidateConnectorCachesOnClearAuthCookies,
  });
}

export function registerPlatformInstanceAuthBindingProvider(
  provider: PlatformInstanceAuthBindingProvider
): void {
  dynamicPlatformInstanceAuthBindingProviders.set(provider.connectorId, provider);
}

export function unregisterPlatformInstanceAuthBindingProvider(connectorId: string): boolean {
  const normalizedConnectorId = normalizePlatformConnectorId(connectorId);
  if (!normalizedConnectorId) return false;
  return dynamicPlatformInstanceAuthBindingProviders.delete(normalizedConnectorId);
}

export function listPlatformInstanceAuthBindingProviders(): PlatformInstanceAuthBindingProvider[] {
  const providers = new Map<PlatformConnectorId, PlatformInstanceAuthBindingProvider>();
  for (const provider of listPlatformPackInstanceAuthBindingProviders()) {
    providers.set(provider.connectorId, provider);
  }
  for (const adapter of listPlatformInstanceAuthAdapters()) {
    if (providers.has(adapter.connectorId)) continue;
    const provider = createPlatformInstanceAuthBindingProviderFromAdapter(adapter);
    providers.set(provider.connectorId, provider);
  }
  for (const [connectorId, provider] of dynamicPlatformInstanceAuthBindingProviders.entries()) {
    providers.set(connectorId, provider);
  }
  return Array.from(providers.values());
}

export async function invokePlatformInstanceAuthBinding(
  options: PlatformInstanceAuthBindingInvokeOptions,
  instanceId: string
): Promise<PlatformApiResult<unknown>> {
  const provider =
    getPlatformInstanceAuthBindingProvider(options.connectorId) ??
    createUnavailableProvider(options.connectorId);

  const context: PlatformInstanceAuthBindingContext = {
    instanceId,
    options,
  };

  try {
    switch (options.method) {
      case 'getSnapshot': {
        const snapshot = await provider.getSnapshot(context);
        if (!snapshot) {
          return createUnavailableAuthBindingResult(options, options.method);
        }
        return ok(snapshot);
      }
      case 'refreshSnapshot': {
        const snapshot = await (provider.refreshSnapshot ?? provider.getSnapshot)(context);
        if (!snapshot) {
          return createUnavailableAuthBindingResult(options, options.method);
        }
        return ok(snapshot);
      }
      case 'beginQrLogin': {
        if (typeof provider.beginQrLogin !== 'function') {
          return createUnavailableAuthBindingResult(options, options.method);
        }
        const session = await provider.beginQrLogin(context);
        if (!session) {
          return createUnavailableAuthBindingResult(options, options.method);
        }
        return ok(session);
      }
      case 'pollQrLogin': {
        const sessionId = normalizeString(options.payload?.sessionId);
        if (!sessionId) {
          return err('INVALID_PAYLOAD', 'payload.sessionId is required');
        }
        if (typeof provider.pollQrLogin !== 'function') {
          return createUnavailableAuthBindingResult(options, options.method);
        }
        const result = await provider.pollQrLogin({
          ...context,
          sessionId,
        });
        if (!result) {
          return createUnavailableAuthBindingResult(options, options.method);
        }
        return ok(result);
      }
      case 'logout': {
        if (typeof provider.logout !== 'function') {
          return createUnavailableAuthBindingResult(options, options.method);
        }
        const snapshot = await provider.logout(context);
        if (!snapshot) {
          return createUnavailableAuthBindingResult(options, options.method);
        }
        return ok(snapshot);
      }
      case 'clearAuthCookies': {
        if (typeof provider.clearAuthCookies !== 'function') {
          return createUnavailableAuthBindingResult(options, options.method);
        }
        const snapshot = await provider.clearAuthCookies(context);
        if (!snapshot) {
          return createUnavailableAuthBindingResult(options, options.method);
        }
        return ok(snapshot);
      }
      default:
        return err(
          'UNSUPPORTED_CAPABILITY',
          `${options.displayName} runtime binding ${options.bindingId}.${options.method} is not implemented`
        );
    }
  } catch (error) {
    if (isExpectedPlatformPackSidecarLifecycleError(error)) {
      return err(
        'RUNTIME_RELOADING',
        `${options.displayName} runtime is reloading, please retry in a moment`
      );
    }
    throw error;
  }
}

export const invokeBuiltinConnectorAuthBinding = invokePlatformInstanceAuthBinding;
