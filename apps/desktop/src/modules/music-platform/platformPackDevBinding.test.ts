import type { PlatformInstanceRecord } from '@pixel-matrix/plugin-platform-contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformPackDevSource } from './platformPackDevSource';

type LoginRegistryEntry = {
  instanceId: string;
  connectorId: string;
  enabled: boolean;
  addedAtMs: number;
};

const mocks = vi.hoisted(() => {
  const instances = new Map<string, PlatformInstanceRecord>();
  return {
    instances,
    loginRecords: [] as LoginRegistryEntry[],
    registerPlatformPackDevSource: vi.fn(async () => undefined),
    removePlatformPackDevRegistration: vi.fn(() => true),
    removePlatformInstance: vi.fn((instanceId: string): boolean => {
      return instances.delete(instanceId);
    }),
    setPlatformRenderSelectionMounted: vi.fn(),
    removePlatformRenderSelection: vi.fn(() => true),
    readPlatformPackDevSourceFromPath: vi.fn(),
    setActiveMusicPlatformInstance: vi.fn(async () => undefined),
    broadcastSignal: vi.fn(async () => undefined),
    setupTauriListenerWithPayload: vi.fn(async () => () => undefined),
  };
});

vi.mock('../../utils/windowCommunication', () => ({
  STORAGE_KEYS: {
    PLATFORM_PACK_DEV_BINDINGS_V1: 'pixel-matrix-platform-pack-dev-bindings-v1',
  },
  TAURI_EVENTS: {
    PLATFORM_PACK_DEV_BINDINGS_UPDATED: 'platform-pack-dev-bindings-updated',
  },
  broadcastSignal: mocks.broadcastSignal,
  setupTauriListenerWithPayload: mocks.setupTauriListenerWithPayload,
}));

vi.mock('./instanceRegistry', () => ({
  getPlatformInstance: (instanceId: string) => mocks.instances.get(instanceId) ?? null,
  listPlatformInstances: () => Array.from(mocks.instances.values()),
  removePlatformInstance: mocks.removePlatformInstance,
  upsertPlatformInstance: (record: PlatformInstanceRecord) => {
    mocks.instances.set(record.instanceId, record);
  },
}));

vi.mock('./connectorAuth', () => ({
  listPlatformConnectorDefinitions: () => [
    {
      connectorId: 'connector.platform.demo',
      platformId: 'demo',
      displayName: 'Demo',
    },
  ],
}));

vi.mock('./platformLoginRegistry', () => ({
  readPlatformLoginRegistry: () => mocks.loginRecords.slice(),
  persistPlatformLoginRegistry: async (entries: LoginRegistryEntry[]) => {
    mocks.loginRecords = entries.map((entry) => ({ ...entry }));
  },
  removePlatformLoginRegistryEntry: (
    entries: LoginRegistryEntry[],
    instanceId: string
  ) => entries.filter((entry) => entry.instanceId !== instanceId),
  upsertPlatformLoginRegistryEntry: (
    entries: LoginRegistryEntry[],
    entry: Pick<LoginRegistryEntry, 'instanceId' | 'connectorId'>,
    enabled: boolean
  ) => {
    const index = entries.findIndex((item) => item.instanceId === entry.instanceId);
    if (index < 0) {
      return [...entries, { ...entry, enabled, addedAtMs: Date.now() }];
    }
    const next = entries.slice();
    next[index] = { ...next[index], connectorId: entry.connectorId, enabled };
    return next;
  },
}));

vi.mock('./renderSelectionRegistry', () => ({
  setPlatformRenderSelectionMounted: mocks.setPlatformRenderSelectionMounted,
  removePlatformRenderSelection: mocks.removePlatformRenderSelection,
}));

vi.mock('./platformPackRegistry', () => ({
  registerPlatformPackDevSource: mocks.registerPlatformPackDevSource,
  removePlatformPackDevRegistration: mocks.removePlatformPackDevRegistration,
}));

vi.mock('./platformPackDevSource', () => ({
  readPlatformPackDevSourceFromPath: mocks.readPlatformPackDevSourceFromPath,
}));

vi.mock('./activeInstanceRegistry', () => ({
  setActiveMusicPlatformInstance: mocks.setActiveMusicPlatformInstance,
}));

function createReadyDevSource(
  overrides: Partial<PlatformPackDevSource> = {}
): PlatformPackDevSource {
  return {
    rootDir: 'D:/packs/demo',
    manifestPath: 'D:/packs/demo/manifest.json',
    manifest: {
      formatVersion: '1.0',
      type: 'platform-pack',
      metadata: {
        id: 'demo-pack',
        name: 'Demo Pack',
        version: '0.1.0',
      },
      connector: {
        connectorId: 'connector.platform.demo',
        workspaceKind: 'demo',
        workspaceMode: 'dedicated',
      },
      entry: {
        contract: 'contract.json',
        runtime: 'runtime.js',
        icon: 'icon.svg',
      },
    },
    contractPath: 'D:/packs/demo/contract.json',
    contract: {
      contractVersion: '1.0',
      platform: {
        platformId: 'demo',
        displayName: 'Demo',
        staticIcon: 'demo',
        supportsMultiInstance: false,
      },
      auth: {
        loginMode: 'none',
        requiresCookie: false,
        requiresAccountId: false,
        supportsRefresh: false,
      },
      capabilities: {
        playlists: false,
        favorites: false,
        dailyRecommendations: false,
        search: false,
        quality: false,
        navigation: false,
        settings: false,
        pages: true,
      },
      apiBindings: {
        auth: 'auth',
      },
      workspace: {
        ownership: 'pack',
        requiredRuntimeCarrier: 'webview-frame',
        root: {
          viewId: 'demo.workspace.root',
          viewType: 'music-platform.workspace-root',
        },
      },
      extension: {
        connectorId: 'connector.platform.demo',
        workspaceKind: 'demo',
        workspaceMode: 'dedicated',
      },
    },
    runtimePath: 'D:/packs/demo/runtime.js',
    runtimeRaw: 'export function mountPage() { return () => {}; }',
    runtimeExists: true,
    iconPath: 'D:/packs/demo/icon.svg',
    iconRawBase64: 'PHN2Zz48L3N2Zz4=',
    iconExists: true,
    sidecarPath: null,
    sidecarExists: null,
    status: 'ready',
    diagnostics: [],
    ...overrides,
  };
}

function readStoredBindings(): Array<Record<string, unknown>> {
  return JSON.parse(
    localStorage.getItem('pixel-matrix-platform-pack-dev-bindings-v1') ?? '[]'
  ) as Array<Record<string, unknown>>;
}

describe('platform pack dev binding', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    mocks.instances.clear();
    mocks.loginRecords = [];
    mocks.registerPlatformPackDevSource.mockClear();
    mocks.removePlatformPackDevRegistration.mockClear();
    mocks.removePlatformInstance.mockClear();
    mocks.setPlatformRenderSelectionMounted.mockClear();
    mocks.removePlatformRenderSelection.mockClear();
    mocks.readPlatformPackDevSourceFromPath.mockReset();
    mocks.setActiveMusicPlatformInstance.mockClear();
    mocks.broadcastSignal.mockClear();
    mocks.setupTauriListenerWithPayload.mockClear();
  });

  it('binds a ready dev source through the normal platform instance state', async () => {
    const source = createReadyDevSource();
    const binding = await import('./platformPackDevBinding');

    const result = await binding.bindPlatformPackDevInstance(source);

    expect(result.record).toMatchObject({
      connectorId: 'connector.platform.demo',
      platformId: 'demo',
      packId: 'demo-pack',
      packVersion: '0.1.0',
      revision: 1,
      status: 'ready',
      reloadHistory: [],
    });
    expect(result.record.installationId).toMatch(/^dev-demo-pack-/);
    expect(result.record.instanceId).toMatch(/^demo:dev-/);
    expect(mocks.registerPlatformPackDevSource).toHaveBeenCalledWith(
      source,
      expect.objectContaining({
        installationId: result.record.installationId,
        source: expect.stringContaining(':r1'),
      })
    );
    expect(mocks.instances.get(result.record.instanceId)).toMatchObject({
      instanceId: result.record.instanceId,
      platformId: 'demo',
      metadata: expect.objectContaining({
        devPlatformPack: true,
        sourceType: 'dev',
        installationId: result.record.installationId,
        packId: 'demo-pack',
      }),
    });
    expect(mocks.loginRecords).toEqual([
      expect.objectContaining({
        instanceId: result.record.instanceId,
        connectorId: 'connector.platform.demo',
        enabled: true,
      }),
    ]);
    expect(mocks.setPlatformRenderSelectionMounted).toHaveBeenCalledWith(
      result.record.instanceId,
      true
    );
    expect(mocks.setActiveMusicPlatformInstance).toHaveBeenCalledWith({
      instanceId: result.record.instanceId,
      connectorId: 'connector.platform.demo',
    });
    expect(readStoredBindings()).toEqual([
      expect.objectContaining({
        instanceId: result.record.instanceId,
        installationId: result.record.installationId,
      }),
    ]);
  });

  it('reloads a bound source by re-reading the same project root and bumping revision', async () => {
    const source = createReadyDevSource();
    const reloadedSource = createReadyDevSource({
      manifest: {
        ...source.manifest!,
        metadata: {
          ...source.manifest!.metadata,
          version: '0.2.0',
        },
      },
    });
    mocks.readPlatformPackDevSourceFromPath.mockResolvedValue(reloadedSource);
    const binding = await import('./platformPackDevBinding');

    const bound = await binding.bindPlatformPackDevInstance(source);
    const reloaded = await binding.reloadPlatformPackDevInstanceBinding(bound.record);

    expect(mocks.readPlatformPackDevSourceFromPath).toHaveBeenCalledWith(source.rootDir);
    expect(reloaded.record.instanceId).toBe(bound.record.instanceId);
    expect(reloaded.record.revision).toBe(2);
    expect(reloaded.record.packVersion).toBe('0.2.0');
    expect(reloaded.record.reloadHistory[0]).toMatchObject({
      status: 'success',
      revision: 2,
      message: null,
    });
    expect(mocks.registerPlatformPackDevSource).toHaveBeenLastCalledWith(
      reloadedSource,
      expect.objectContaining({
        installationId: bound.record.installationId,
        source: expect.stringContaining(':r2'),
      })
    );
  });

  it('detaches the dev instance and clears host-managed state', async () => {
    const binding = await import('./platformPackDevBinding');
    const bound = await binding.bindPlatformPackDevInstance(createReadyDevSource());

    await expect(
      binding.detachPlatformPackDevInstanceBinding(bound.record.instanceId)
    ).resolves.toBe(true);

    expect(mocks.removePlatformPackDevRegistration).toHaveBeenCalledWith(
      bound.record.installationId
    );
    expect(mocks.removePlatformInstance).toHaveBeenCalledWith(bound.record.instanceId);
    expect(mocks.instances.has(bound.record.instanceId)).toBe(false);
    expect(mocks.removePlatformRenderSelection).toHaveBeenCalledWith(
      bound.record.instanceId
    );
    expect(mocks.loginRecords).toEqual([]);
    expect(readStoredBindings()).toEqual([]);
  });
});
