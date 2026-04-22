import type {
  PlatformCompatContractFile,
  PlatformCompatRuntimeApi,
} from '@pixel-matrix/plugin-platform-contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectorAuthState = vi.hoisted(() => ({
  registrations: [] as Array<unknown>,
  listeners: [] as Array<() => void>,
}));

const ensureBuiltinPlatformPackRegistrationsInitializedMock = vi.hoisted(() => vi.fn());

vi.mock('./connectorAuth', () => ({
  listBuiltinPlatformCompatRegistrations: vi.fn(() => connectorAuthState.registrations),
  listPlatformConnectorDefinitions: vi.fn(() => []),
  subscribePlatformConnectorCompatRegistrations: vi.fn((listener: () => void) => {
    connectorAuthState.listeners.push(listener);
    return () => {
      const index = connectorAuthState.listeners.indexOf(listener);
      if (index >= 0) {
        connectorAuthState.listeners.splice(index, 1);
      }
    };
  }),
}));

vi.mock('./platformLoginRegistry', () => ({
  readPlatformLoginRegistry: vi.fn(() => []),
  subscribePlatformLoginRegistry: vi.fn(async () => () => undefined),
}));

vi.mock('./platformPackRegistry', () => ({
  ensureBuiltinPlatformPackRegistrationsInitialized:
    ensureBuiltinPlatformPackRegistrationsInitializedMock,
}));

function createRuntime(label = 'runtime'): PlatformCompatRuntimeApi {
  return {
    metadata: {
      label,
    },
  } as PlatformCompatRuntimeApi;
}

function createContract(
  platformId: string,
  displayName: string
): PlatformCompatContractFile {
  return {
    contractVersion: '1.0',
    platform: {
      platformId,
      displayName,
      staticIcon: 'icon.svg',
      supportsMultiInstance: false,
    },
    auth: {
      loginMode: 'qr',
      requiresCookie: false,
      requiresAccountId: false,
      supportsRefresh: true,
    },
    capabilities: {
      playlists: true,
      favorites: true,
      dailyRecommendations: true,
      search: true,
      quality: true,
      navigation: false,
      settings: false,
      pages: true,
    },
    apiBindings: {
      auth: 'host.pmp.connector-auth',
      library: 'host.pmp.platform-instance.library',
    },
    extension: {
      connectorId: `connector.platform.${platformId}`,
    },
  };
}

describe('contractRegistry', () => {
  beforeEach(() => {
    vi.resetModules();
    connectorAuthState.registrations.length = 0;
    connectorAuthState.listeners.length = 0;
    ensureBuiltinPlatformPackRegistrationsInitializedMock.mockReset();
  });

  it('skips no-op compat re-registration so registry listeners only see material changes', async () => {
    const registry = await import('./contractRegistry');
    const runtime = createRuntime('same');
    const contract = createContract('netease', 'Netease');
    const listener = vi.fn();
    const metadata = {
      connectorId: 'connector.platform.netease',
      autoCreateDefaultInstance: true,
      runtimeAdapter: 'platformPackRuntime',
    };

    const unsubscribe = registry.subscribePlatformCompatRegistry(listener);

    registry.registerPlatformCompatContract({
      contract,
      runtime,
      source: 'platform-pack',
      metadata,
    });
    registry.registerPlatformCompatContract({
      contract,
      runtime,
      source: 'platform-pack',
      metadata,
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.listPlatformCompatRegistryRecords()).toHaveLength(1);

    registry.registerPlatformCompatContract({
      contract: {
        ...contract,
        capabilities: {
          ...contract.capabilities,
          settings: true,
        },
      },
      runtime,
      source: 'platform-pack',
      metadata,
    });

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
