import type {
  PlatformInstanceApiBindingProvider,
} from './platformInstanceApiBinding';
import type {
  PlatformInstanceAuthBindingProvider,
  PlatformInstanceAuthBindingInvokeOptions,
  RuntimeAuthSnapshotData,
  RuntimeQrPollData,
  RuntimeQrSessionData,
} from './platformInstanceAuthBinding';
import {
  createPlatformInstanceAuthAdapter,
  type PlatformInstanceAuthAdapter,
} from './platformInstanceAuthAdapter';
import type { PlatformPackHostRuntimeSupport } from './platformPackRegistry';
import type { InstalledPlatformPackRecord } from './installedPlatformPacks';
import { invokePlatformPackSidecar } from './platformPackSidecarBridge';

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function createBaseAuthInvokeOptions(
  connectorId: InstalledPlatformPackRecord['connectorId'],
  displayName: string
): Omit<PlatformInstanceAuthBindingInvokeOptions, 'method'> {
  return {
    bindingId: 'host.pmp.connector-auth',
    connectorId,
    displayName,
  };
}

function createSidecarAuthBindingProvider(
  connectorId: InstalledPlatformPackRecord['connectorId'],
  sidecarPath: string
): PlatformInstanceAuthBindingProvider {
  const invokeAuth = async (
    method: string,
    instanceId: string,
    payload?: Record<string, unknown>
  ): Promise<unknown> =>
    await invokePlatformPackSidecar(connectorId, sidecarPath, {
      channel: 'auth',
      method,
      instanceId,
      payload,
    });

  return {
    connectorId,
    getSnapshot: async ({ instanceId }): Promise<RuntimeAuthSnapshotData | null> =>
      (await invokeAuth('getSnapshot', instanceId)) as RuntimeAuthSnapshotData | null,
    refreshSnapshot: async ({ instanceId }): Promise<RuntimeAuthSnapshotData | null> =>
      (await invokeAuth('refreshSnapshot', instanceId)) as RuntimeAuthSnapshotData | null,
    beginQrLogin: async ({ instanceId }): Promise<RuntimeQrSessionData | null> =>
      (await invokeAuth('beginQrLogin', instanceId)) as RuntimeQrSessionData | null,
    pollQrLogin: async ({ instanceId, sessionId }): Promise<RuntimeQrPollData | null> =>
      (await invokeAuth('pollQrLogin', instanceId, {
        sessionId,
      })) as RuntimeQrPollData | null,
    logout: async ({ instanceId }): Promise<RuntimeAuthSnapshotData | null> =>
      (await invokeAuth('logout', instanceId)) as RuntimeAuthSnapshotData | null,
    clearAuthCookies: async ({ instanceId }): Promise<RuntimeAuthSnapshotData | null> =>
      (await invokeAuth('clearAuthCookies', instanceId)) as RuntimeAuthSnapshotData | null,
  };
}

function createSidecarAuthAdapter(
  connectorId: InstalledPlatformPackRecord['connectorId'],
  displayName: string,
  provider: PlatformInstanceAuthBindingProvider
): PlatformInstanceAuthAdapter {
  const defaultInstanceId = `${connectorId.replace('connector.platform.', '')}:builtin`;
  const sessionInstanceIds = new Map<string, string>();

  return createPlatformInstanceAuthAdapter({
    connectorId: connectorId as PlatformInstanceAuthAdapter['connectorId'],
    getSnapshot: async (instanceId) =>
      (await provider.getSnapshot({
        instanceId,
        options: {
          ...createBaseAuthInvokeOptions(connectorId, displayName),
          method: 'getSnapshot',
        },
      })) ?? null,
    refreshSnapshot: async (instanceId) =>
      (await (provider.refreshSnapshot ?? provider.getSnapshot)({
        instanceId,
        options: {
          ...createBaseAuthInvokeOptions(connectorId, displayName),
          method: 'refreshSnapshot',
        },
      })) ?? null,
    beginQrLogin: provider.beginQrLogin
      ? async (instanceId) =>
          {
            const session =
              (await provider.beginQrLogin?.({
                instanceId,
                options: {
                  ...createBaseAuthInvokeOptions(connectorId, displayName),
                  method: 'beginQrLogin',
                },
              })) ?? null;
            const sessionId = normalizeString(session?.sessionId);
            if (sessionId) {
              sessionInstanceIds.set(sessionId, instanceId);
            }
            return session;
          }
      : undefined,
    pollQrLogin: provider.pollQrLogin
      ? async (sessionId) => {
          const normalizedSessionId = normalizeString(sessionId);
          const boundInstanceId =
            sessionInstanceIds.get(normalizedSessionId) ?? defaultInstanceId;
          const result =
            (await provider.pollQrLogin?.({
              instanceId: boundInstanceId,
              sessionId: normalizedSessionId,
              options: {
                ...createBaseAuthInvokeOptions(connectorId, displayName),
                method: 'pollQrLogin',
                payload: {
                  sessionId: normalizedSessionId,
                },
              },
            })) ?? null;
          const authState = normalizeString(result?.authState).toLowerCase();
          if (
            authState === 'authorized' ||
            authState === 'expired' ||
            authState === 'revoked' ||
            authState === 'error'
          ) {
            sessionInstanceIds.delete(normalizedSessionId);
          }
          return result;
        }
      : undefined,
    logout: provider.logout
      ? async (instanceId) =>
          (await provider.logout?.({
            instanceId,
            options: {
              ...createBaseAuthInvokeOptions(connectorId, displayName),
              method: 'logout',
            },
          })) ?? null
      : undefined,
    clearAuthCookies: provider.clearAuthCookies
      ? async (instanceId) =>
          (await provider.clearAuthCookies?.({
            instanceId,
            options: {
              ...createBaseAuthInvokeOptions(connectorId, displayName),
              method: 'clearAuthCookies',
            },
          })) ?? null
      : undefined,
  });
}

function createSidecarApiBucket(
  connectorId: InstalledPlatformPackRecord['connectorId'],
  sidecarPath: string,
  bindingId: string
) {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== 'string' || property.length < 1) {
          return undefined;
        }
        return async ({
          instanceId,
          options,
        }: {
          instanceId: string;
          options: {
            payload?: Record<string, unknown>;
          };
        }) =>
          await invokePlatformPackSidecar(connectorId, sidecarPath, {
            channel: 'api',
            bindingId,
            method: property,
            instanceId,
            payload: options.payload,
          });
      },
    }
  );
}

function createSidecarApiBindingProvider(
  connectorId: InstalledPlatformPackRecord['connectorId'],
  sidecarPath: string
): PlatformInstanceApiBindingProvider {
  const createBucket = (bindingId: string) =>
    createSidecarApiBucket(connectorId, sidecarPath, bindingId);

  return {
    connectorId: connectorId as PlatformInstanceApiBindingProvider['connectorId'],
    library: createBucket('host.pmp.platform-instance.library'),
    recommendations: createBucket('host.pmp.platform-instance.recommendations'),
    search: createBucket('host.pmp.platform-instance.search'),
    quality: createBucket('host.pmp.platform-instance.quality'),
    pages: createBucket('host.pmp.platform-instance.pages'),
  } as PlatformInstanceApiBindingProvider;
}

export function createPlatformPackSidecarHostRuntimeSupport(
  record: InstalledPlatformPackRecord
): PlatformPackHostRuntimeSupport | null {
  const sidecarPath = normalizeString(record.sidecarPath);
  if (!sidecarPath) {
    return null;
  }

  const connectorId = record.connectorId;
  const displayName =
    normalizeString(record.manifest.connector.displayName) ||
    normalizeString(record.contract.platform.displayName) ||
    connectorId.replace('connector.platform.', '');
  const authBindingProvider = createSidecarAuthBindingProvider(
    connectorId,
    sidecarPath
  );
  const apiBindingProvider = createSidecarApiBindingProvider(
    connectorId,
    sidecarPath
  );

  return {
    connectorId,
    authAdapter: createSidecarAuthAdapter(connectorId, displayName, authBindingProvider),
    authBindingProvider,
    apiBindingProvider,
  };
}
