import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PlatformCompatContractFile,
  PlatformCompatRuntimeApi,
} from '@pixel-matrix/plugin-platform-contracts';

type CompatListener = (records: unknown[]) => void;
type ImportedInstanceListener = () => void;
type InstalledPackListener = () => void;

const compatListeners = new Set<CompatListener>();
const importedInstanceListeners = new Set<ImportedInstanceListener>();
const installedPackListeners = new Set<InstalledPackListener>();
let compatRecords: Array<{
  platformId: string;
  contract: PlatformCompatContractFile;
  runtime: PlatformCompatRuntimeApi;
  source: string;
  registeredAtMs: number;
  metadata: Record<string, unknown>;
}> = [];
let importedInstanceRecords: Array<Record<string, unknown>> = [];

const listPlatformCompatRegistryRecordsMock = vi.fn(() => compatRecords);
const getPlatformCompatRegistryRecordMock = vi.fn((platformId: string) => {
  return compatRecords.find((record) => record.platformId === platformId) ?? null;
});
const getPlatformCompatRuntimeApiMock = vi.fn((platformId: string) => {
  return compatRecords.find((record) => record.platformId === platformId)?.runtime ?? null;
});
const subscribePlatformCompatRegistryMock = vi.fn((listener: CompatListener) => {
  compatListeners.add(listener);
  return () => {
    compatListeners.delete(listener);
  };
});
const listPlatformImportedInstanceRecordsMock = vi.fn(() => importedInstanceRecords);
const subscribePlatformImportedInstanceRecordsMock = vi.fn(
  (listener: ImportedInstanceListener) => {
    importedInstanceListeners.add(listener);
    return async () => {
      importedInstanceListeners.delete(listener);
    };
  }
);
const getInstalledPlatformPackRecordMock = vi.fn((_installationId: string) => null);
const subscribeInstalledPlatformPackRecordsMock = vi.fn(
  (listener: InstalledPackListener) => {
    installedPackListeners.add(listener);
    return async () => {
      installedPackListeners.delete(listener);
    };
  }
);

type RuntimeRefreshSnapshot = NonNullable<
  NonNullable<PlatformCompatRuntimeApi['auth']>['refreshSnapshot']
>;
type RuntimeGetSnapshot = NonNullable<
  NonNullable<PlatformCompatRuntimeApi['auth']>['getSnapshot']
>;

vi.mock('./contractRegistry', () => ({
  getPlatformCompatRegistryRecord: (platformId: string) =>
    getPlatformCompatRegistryRecordMock(platformId),
  getPlatformCompatRuntimeApi: (platformId: string) => getPlatformCompatRuntimeApiMock(platformId),
  listPlatformCompatRegistryRecords: () => listPlatformCompatRegistryRecordsMock(),
  subscribePlatformCompatRegistry: (listener: CompatListener) =>
    subscribePlatformCompatRegistryMock(listener),
}));

vi.mock('./platformImportedInstanceRegistry', () => ({
  listPlatformImportedInstanceRecords: () => listPlatformImportedInstanceRecordsMock(),
  subscribePlatformImportedInstanceRecords: async (listener: ImportedInstanceListener) =>
    subscribePlatformImportedInstanceRecordsMock(listener),
}));

vi.mock('./installedPlatformPacks', () => ({
  getInstalledPlatformPackRecord: (installationId: string) =>
    getInstalledPlatformPackRecordMock(installationId),
  subscribeInstalledPlatformPackRecords: async (listener: InstalledPackListener) =>
    subscribeInstalledPlatformPackRecordsMock(listener),
}));

function createCompatRecord(
  platformId: string,
  connectorId: string,
  options: {
    getSnapshot?: RuntimeGetSnapshot;
    refreshSnapshot?: RuntimeRefreshSnapshot;
  }
) {
  return {
    platformId,
    contract: {
      contractVersion: '1.0',
      platform: {
        platformId,
        displayName: platformId,
        staticIcon: '',
        supportsMultiInstance: false,
      },
      auth: {
        loginMode: 'cookie',
        requiresCookie: true,
        requiresAccountId: false,
        supportsRefresh: true,
      },
      capabilities: {
        playlists: false,
        favorites: false,
        dailyRecommendations: false,
        search: false,
        quality: false,
        navigation: false,
        settings: false,
        pages: false,
      },
      apiBindings: {
        auth: 'auth.binding',
      },
    } satisfies PlatformCompatContractFile,
    runtime: {
      auth: {
        ...(options.getSnapshot ? { getSnapshot: options.getSnapshot } : {}),
        ...(options.refreshSnapshot ? { refreshSnapshot: options.refreshSnapshot } : {}),
      },
    } satisfies PlatformCompatRuntimeApi,
    source: 'platform-pack',
    registeredAtMs: 1,
    metadata: {
      autoCreateDefaultInstance: true,
      connectorId,
      enabled: true,
    },
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('instanceRegistry auth hydration', () => {
  beforeEach(() => {
    vi.resetModules();
    compatListeners.clear();
    importedInstanceListeners.clear();
    installedPackListeners.clear();
    compatRecords = [];
    importedInstanceRecords = [];
    listPlatformCompatRegistryRecordsMock.mockClear();
    getPlatformCompatRegistryRecordMock.mockClear();
    getPlatformCompatRuntimeApiMock.mockClear();
    subscribePlatformCompatRegistryMock.mockClear();
    listPlatformImportedInstanceRecordsMock.mockClear();
    subscribePlatformImportedInstanceRecordsMock.mockClear();
    getInstalledPlatformPackRecordMock.mockClear();
    subscribeInstalledPlatformPackRecordsMock.mockClear();

    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    });

    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      writable: true,
      value: (callback: (deadline: { didTimeout: boolean; timeRemaining(): number }) => void) => {
        callback({
          didTimeout: false,
          timeRemaining: () => 50,
        });
        return 1;
      },
    });
  });

  it('hydrates auth state for auto-managed instances during initial bootstrap', async () => {
    const getSnapshot = vi.fn(async (_input: { instanceId: string }) => ({
      ok: true as const,
      data: {
        authState: 'authorized' as const,
        accountId: 'user-1',
        updatedAtMs: 1710000000000,
      },
    }));
    const refreshSnapshot = vi.fn(async (_input: { instanceId: string }) => ({
      ok: true as const,
      data: {
        authState: 'authorized' as const,
        accountId: 'user-1-refresh',
        updatedAtMs: 1710000001000,
      },
    }));

    compatRecords = [
      createCompatRecord('platform.bilibili', 'connector.platform.bilibili', {
        getSnapshot,
        refreshSnapshot,
      }),
    ];

    const registry = await import('./instanceRegistry');

    expect(registry.listPlatformInstances()[0]?.auth.status).toBe('empty');

    await vi.waitFor(() => {
      expect(getSnapshot).toHaveBeenCalledTimes(1);
      expect(refreshSnapshot).not.toHaveBeenCalled();
      expect(registry.getPlatformInstance('platform.bilibili:builtin')?.auth.status).toBe('authorized');
    });
  });

  it('hydrates auth state when compat registrations arrive after registry initialization', async () => {
    const registry = await import('./instanceRegistry');

    expect(registry.listPlatformInstances()).toEqual([]);

    const getSnapshot = vi.fn(async (_input: { instanceId: string }) => ({
      ok: true as const,
      data: {
        authState: 'authorized' as const,
        accountId: 'user-2',
      },
    }));
    const refreshSnapshot = vi.fn(async (_input: { instanceId: string }) => ({
      ok: true as const,
      data: {
        authState: 'authorized' as const,
        accountId: 'user-2-refresh',
      },
    }));

    compatRecords = [
      createCompatRecord('platform.netease', 'connector.platform.netease', {
        getSnapshot,
        refreshSnapshot,
      }),
    ];
    compatListeners.forEach((listener) => {
      listener(compatRecords);
    });

    await flushAsyncWork();

    await vi.waitFor(() => {
      expect(getSnapshot).toHaveBeenCalledTimes(1);
      expect(refreshSnapshot).not.toHaveBeenCalled();
      expect(registry.getPlatformInstance('platform.netease:builtin')?.auth.status).toBe('authorized');
    });
  });

  it('uses refreshSnapshot for explicit instance refreshes after bootstrap hydration', async () => {
    const getSnapshot = vi.fn(async (_input: { instanceId: string }) => ({
      ok: true as const,
      data: {
        authState: 'authorized' as const,
        accountId: 'user-3',
      },
    }));
    const refreshSnapshot = vi.fn(async (_input: { instanceId: string }) => ({
      ok: true as const,
      data: {
        authState: 'authorized' as const,
        accountId: 'user-3-refresh',
      },
    }));

    compatRecords = [
      createCompatRecord('platform.netease', 'connector.platform.netease', {
        getSnapshot,
        refreshSnapshot,
      }),
    ];

    const registry = await import('./instanceRegistry');
    registry.listPlatformInstances();

    await vi.waitFor(() => {
      expect(getSnapshot).toHaveBeenCalledTimes(1);
    });

    await registry.refreshPlatformInstance('platform.netease:builtin');

    expect(refreshSnapshot).toHaveBeenCalledTimes(1);
    expect(
      registry.getPlatformInstance('platform.netease:builtin')?.account.accountId
    ).toBe('user-3-refresh');
  });
});
