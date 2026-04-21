import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PlatformCompatContractFile,
  PlatformCompatRuntimeApi,
} from '@pixel-matrix/plugin-platform-contracts';
import type { PlatformConnectorDefinition } from './connectorAuth';
import type { InstalledPlatformPackRecord } from './installedPlatformPacks';
import type {
  BuiltinPlatformPackAssetDefinition,
  PlatformPackReadinessDiagnostic,
  BuiltinPlatformPackStoreInspection,
  PlatformPackRegistrationRecord,
  PlatformPackStartupHealth,
} from './platformPackRegistry';
import type { PlatformRuntimeDescriptor } from './platformRuntimeDescriptor';

const {
  telemetryLoggerMock,
  tauriRuntimeMock,
  listPlatformConnectorDefinitionsMock,
  loadInstalledPlatformPackRecordsMock,
  areInstalledPlatformPackArtifactsPresentMock,
  getPlatformPackStartupHealthMock,
  inspectBuiltinPlatformPackStoreStateMock,
  listBuiltinPlatformPackAssetsMock,
  listPlatformPackReadinessDiagnosticsMock,
  listPlatformPackRegistrationsMock,
  listPlatformRuntimeDescriptorsMock,
} = vi.hoisted(() => ({
  telemetryLoggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  tauriRuntimeMock: vi.fn(() => true),
  listPlatformConnectorDefinitionsMock: vi.fn((): PlatformConnectorDefinition[] => []),
  loadInstalledPlatformPackRecordsMock: vi.fn((): InstalledPlatformPackRecord[] => []),
  areInstalledPlatformPackArtifactsPresentMock: vi.fn(
    async (_record: InstalledPlatformPackRecord): Promise<boolean> => true
  ),
  getPlatformPackStartupHealthMock: vi.fn((): PlatformPackStartupHealth => ({
    state: 'ready',
    currentStage: 'completed',
    bootScheduled: false,
    bootStartedAtMs: 1,
    bootFinishedAtMs: 2,
    lastUpdatedAtMs: 2,
    durationMs: 1,
    backgroundReconcileScheduled: false,
    backgroundReconcileRunning: false,
    storeBootstrapFailed: false,
    storeIndexAvailable: true,
    storeReadyWithoutIndex: false,
    storeAlreadyCurrent: true,
    registeredBuiltinCount: 1,
    expectedBuiltinCount: 1,
    staleConnectorIds: [],
    relaxedDevConnectorIds: [],
    lastError: null,
    recentStages: [],
  })),
  inspectBuiltinPlatformPackStoreStateMock: vi.fn(
    async (): Promise<BuiltinPlatformPackStoreInspection> => ({
      indexAvailable: true,
      current: true,
      storeReadyWithoutIndex: false,
      staleConnectorIds: [],
      relaxedDevConnectorIds: [],
      entries: [],
    })
  ),
  listBuiltinPlatformPackAssetsMock: vi.fn((): BuiltinPlatformPackAssetDefinition[] => []),
  listPlatformPackReadinessDiagnosticsMock: vi.fn(
    (): PlatformPackReadinessDiagnostic[] => []
  ),
  listPlatformPackRegistrationsMock: vi.fn((): PlatformPackRegistrationRecord[] => []),
  listPlatformRuntimeDescriptorsMock: vi.fn((): PlatformRuntimeDescriptor[] => []),
}));

vi.mock('../../utils/tauriRuntime', () => ({
  isTauriRuntime: tauriRuntimeMock,
}));

vi.mock('../../services/telemetry/TelemetryService', () => ({
  getTelemetryLogger: () => telemetryLoggerMock,
}));

vi.mock('./connectorAuth', () => ({
  listPlatformConnectorDefinitions: listPlatformConnectorDefinitionsMock,
}));

vi.mock('./installedPlatformPacks', () => ({
  loadInstalledPlatformPackRecords: loadInstalledPlatformPackRecordsMock,
  areInstalledPlatformPackArtifactsPresent: areInstalledPlatformPackArtifactsPresentMock,
}));

vi.mock('./platformPackRegistry', () => ({
  getPlatformPackStartupHealth: getPlatformPackStartupHealthMock,
  inspectBuiltinPlatformPackStoreState: inspectBuiltinPlatformPackStoreStateMock,
  listBuiltinPlatformPackAssets: listBuiltinPlatformPackAssetsMock,
  listPlatformPackReadinessDiagnostics: listPlatformPackReadinessDiagnosticsMock,
  listPlatformPackRegistrations: listPlatformPackRegistrationsMock,
}));

vi.mock('./platformRuntimeDescriptor', () => ({
  listPlatformRuntimeDescriptors: listPlatformRuntimeDescriptorsMock,
}));

import { inspectPlatformPackDoctor } from './platformPackDoctor';

function createContract(): PlatformCompatContractFile {
  return {
    contractVersion: '1.0',
    platform: {
      platformId: 'netease',
      displayName: 'Netease',
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
      favorites: false,
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
      recommendations: 'host.pmp.platform-instance.recommendations',
      search: 'host.pmp.platform-instance.search',
      quality: 'host.pmp.platform-instance.quality',
      pages: 'host.pmp.platform-instance.pages',
    },
    extension: {
      connectorId: 'connector.platform.netease',
      workspaceKind: 'netease',
      workspaceMode: 'dedicated',
    },
  };
}

function createRuntime(
  overrides: Partial<PlatformCompatRuntimeApi> = {}
): PlatformCompatRuntimeApi {
  return {
    auth: {
      getSnapshot: vi.fn(),
      refreshSnapshot: vi.fn(),
      beginQrLogin: vi.fn(),
      pollQrLogin: vi.fn(),
      logout: vi.fn(),
      clearAuthCookies: vi.fn(),
    },
    library: {
      listCollections: vi.fn(),
      listResources: vi.fn(),
      listPlaylistTracks: vi.fn(),
      createPlaylist: vi.fn(),
      deletePlaylist: vi.fn(),
      addTrackToPlaylist: vi.fn(),
      removeTrackFromPlaylist: vi.fn(),
      preparePlayback: vi.fn(),
      resolveLyricLocator: vi.fn(),
      resolveCoverAssetUrl: vi.fn(),
    },
    recommendations: {
      listDaily: vi.fn(),
      listRecommendedSongs: vi.fn(),
      listRecommendedPlaylists: vi.fn(),
    },
    search: {
      query: vi.fn(),
      resolveLocator: vi.fn(),
      preparePlayback: vi.fn(),
    },
    quality: {
      listOptions: vi.fn(),
      getCurrent: vi.fn(),
      setPreferred: vi.fn(),
    },
    pages: {
      getWorkspaceModel: vi.fn(),
      listPages: vi.fn(),
    },
    ...overrides,
  };
}

function createRegistration(runtime: PlatformCompatRuntimeApi): PlatformPackRegistrationRecord {
  const contract = createContract();
  return {
    packId: 'builtin-netease',
    packVersion: '1.0.0',
    connectorId: 'connector.platform.netease',
    platformId: 'netease',
    source: 'builtin-pack:netease',
    installedAtMs: 123,
    definition: {
      connectorId: 'connector.platform.netease',
      displayName: 'Netease',
      labelKey: 'platform.netease',
      iconKey: 'netease',
      platformTemplate: 'music',
      enabled: true,
      authFlow: 'qr',
      workspaceKind: 'netease',
      workspaceMode: 'dedicated',
      sortOrder: 10,
    },
    compat: {
      platformId: 'netease',
      connectorId: 'connector.platform.netease',
      enabled: true,
      contract,
      runtime,
      source: 'pack',
      metadata: {
        connectorId: 'connector.platform.netease',
      },
    },
  };
}

function createDescriptor(runtime: PlatformCompatRuntimeApi): PlatformRuntimeDescriptor {
  const contract = createContract();
  return {
    connectorId: 'connector.platform.netease',
    platformId: 'netease',
    displayName: 'Netease',
    enabled: true,
    authState: 'authorized',
    availability: 'available',
    availabilityMessage: undefined,
    workspaceKind: 'netease',
    workspaceMode: 'dedicated',
    platformTemplate: 'music',
    sortOrder: 10,
    sourceKind: 'pack',
    connectorDefinition: createRegistration(runtime).definition,
    packRegistration: createRegistration(runtime),
    compatRegistryRecord: {
      platformId: 'netease',
      contract,
      runtime,
      source: 'platform-pack',
      registeredAtMs: 100,
      metadata: {
        connectorId: 'connector.platform.netease',
      },
    },
    instanceRecord: null,
    runtime,
  };
}

function createInstalledRecord(
  overrides: Partial<InstalledPlatformPackRecord> = {}
): InstalledPlatformPackRecord {
  const contract = createContract();
  return {
    packId: 'builtin-netease',
    packVersion: '1.0.0',
    packageDigest: 'digest-1',
    connectorId: 'connector.platform.netease',
    platformId: 'netease',
    sourceType: 'builtin',
    source: 'builtin-pack:netease',
    installedAtMs: 123,
    manifest: {
      formatVersion: '1.0',
      type: 'platform-pack',
      metadata: {
        id: 'builtin-netease',
        name: 'Netease',
        version: '1.0.0',
      },
      connector: {
        connectorId: 'connector.platform.netease',
        displayName: 'Netease',
        workspaceKind: 'netease',
      },
      entry: {
        contract: 'contract.json',
        runtime: 'runtime.js',
        icon: 'icon.svg',
      },
    },
    contract,
    artifactRootPath: 'D:/app/netease',
    manifestPath: 'D:/app/netease/manifest.json',
    contractPath: 'D:/app/netease/contract.json',
    runtimePath: 'D:/app/netease/runtime.js',
    iconPath: 'D:/app/netease/icon.svg',
    ...overrides,
  };
}

describe('platformPackDoctor', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    listBuiltinPlatformPackAssetsMock.mockReturnValue([
      {
        source: 'builtin-pack:netease',
        connectorId: 'connector.platform.netease',
        packAssetUrl: '/resource/music-platform/packs/dist/builtin-netease.pmpp',
      },
    ]);
    listPlatformConnectorDefinitionsMock.mockReturnValue([
      {
        connectorId: 'connector.platform.netease',
        displayName: 'Netease',
        labelKey: 'platform.netease',
        iconKey: 'netease',
        platformTemplate: 'music',
        enabled: true,
        authFlow: 'qr',
        workspaceKind: 'netease',
        workspaceMode: 'dedicated',
        sortOrder: 10,
      },
    ]);
    loadInstalledPlatformPackRecordsMock.mockReturnValue([createInstalledRecord()]);
    areInstalledPlatformPackArtifactsPresentMock.mockResolvedValue(true);
    listPlatformPackReadinessDiagnosticsMock.mockReturnValue([]);
    inspectBuiltinPlatformPackStoreStateMock.mockResolvedValue({
      indexAvailable: true,
      current: true,
      storeReadyWithoutIndex: false,
      staleConnectorIds: [],
      relaxedDevConnectorIds: [],
      entries: [
        {
          connectorId: 'connector.platform.netease',
          storedRecordFound: true,
          artifactsPresent: true,
          storedSourceType: 'builtin',
          storedPackId: 'builtin-netease',
          storedPackVersion: '1.0.0',
          storedPackageDigest: 'digest-1',
          indexEntryPresent: true,
          indexPackId: 'builtin-netease',
          indexPackVersion: '1.0.0',
          indexPackageDigest: 'digest-1',
          indexPackAssetUrl: '/resource/music-platform/packs/dist/builtin-netease.pmpp',
          expectedPackAssetUrl: '/resource/music-platform/packs/dist/builtin-netease.pmpp',
          strictReasonCodes: [],
          effectiveReasonCodes: [],
          relaxedDevReasonCodes: [],
        },
      ],
    });
  });

  it('reports degraded recommendation parity when runtime methods are missing', async () => {
    const runtime = createRuntime({
      recommendations: {
        listDaily: vi.fn(),
      },
    });
    listPlatformPackRegistrationsMock.mockReturnValue([createRegistration(runtime)]);
    listPlatformRuntimeDescriptorsMock.mockReturnValue([createDescriptor(runtime)]);

    const report = await inspectPlatformPackDoctor();
    const connector = report.connectors[0];

    expect(report.status).toBe('degraded');
    expect(connector?.requiredFlows.recommendations).toBe('degraded');
    expect(connector?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'runtime.methods-missing',
          severity: 'warn',
          fields: expect.objectContaining({
            bucket: 'recommendations',
          }),
        }),
      ])
    );
    expect(telemetryLoggerMock.warn).toHaveBeenCalledWith(
      'music-platform.pack.doctor.completed',
      expect.objectContaining({
        fields: expect.objectContaining({
          status: 'degraded',
        }),
      })
    );
  });

  it('reports ready when builtin runtime mirrors the standard binding bridge coverage', async () => {
    const runtime = createRuntime();
    listPlatformPackRegistrationsMock.mockReturnValue([createRegistration(runtime)]);
    listPlatformRuntimeDescriptorsMock.mockReturnValue([createDescriptor(runtime)]);

    const report = await inspectPlatformPackDoctor();
    const connector = report.connectors[0];

    expect(report.status).toBe('ready');
    expect(connector?.status).toBe('ready');
    expect(connector?.requiredFlows).toEqual({
      recommendations: 'ready',
      quality: 'ready',
      pages: 'ready',
    });
    expect(connector?.issues).toHaveLength(0);
    expect(telemetryLoggerMock.info).toHaveBeenCalledWith(
      'music-platform.pack.doctor.completed',
      expect.objectContaining({
        fields: expect.objectContaining({
          status: 'ready',
        }),
      })
    );
  });

  it('surfaces external-pack hydrate failures and unsupported bindings as structured issues', async () => {
    const externalRecord = createInstalledRecord({
      packId: 'external-qqmusic',
      connectorId: 'connector.platform.qqmusic',
      platformId: 'qqmusic',
      sourceType: 'external',
      source: 'file:qqmusic.pmpp',
      manifest: {
        formatVersion: '1.0',
        type: 'platform-pack',
        metadata: {
          id: 'external-qqmusic',
          name: 'Qqmusic',
          version: '1.0.0',
        },
        connector: {
          connectorId: 'connector.platform.qqmusic',
          displayName: 'Qqmusic',
          workspaceKind: 'qqmusic',
        },
        entry: {
          contract: 'contract.json',
          runtime: 'runtime.js',
          icon: 'icon.svg',
        },
      },
      contract: {
        ...createContract(),
        platform: {
          ...createContract().platform,
          platformId: 'qqmusic',
          displayName: 'Qqmusic',
        },
        extension: {
          connectorId: 'connector.platform.qqmusic',
          workspaceKind: 'qqmusic',
          workspaceMode: 'dedicated',
        },
        apiBindings: {
          ...createContract().apiBindings,
          library: 'host.pmp.custom.library',
        },
      },
      artifactRootPath: 'D:/app/qqmusic',
      manifestPath: 'D:/app/qqmusic/manifest.json',
      contractPath: 'D:/app/qqmusic/contract.json',
      runtimePath: 'D:/app/qqmusic/runtime.js',
      iconPath: 'D:/app/qqmusic/icon.svg',
    });

    listBuiltinPlatformPackAssetsMock.mockReturnValue([]);
    listPlatformConnectorDefinitionsMock.mockReturnValue([]);
    loadInstalledPlatformPackRecordsMock.mockReturnValue([externalRecord]);
    areInstalledPlatformPackArtifactsPresentMock.mockResolvedValue(false);
    listPlatformPackRegistrationsMock.mockReturnValue([]);
    listPlatformRuntimeDescriptorsMock.mockReturnValue([]);
    listPlatformPackReadinessDiagnosticsMock.mockReturnValue([
      {
        ts: 1,
        code: 'hydrate.registration-failed',
        severity: 'error',
        phase: 'hydrate',
        connectorId: 'connector.platform.qqmusic',
        packId: 'external-qqmusic',
        packVersion: '1.0.0',
        sourceType: 'external',
        source: 'file:qqmusic.pmpp',
        message: 'provider bucket missing',
        fields: {
          runtimePath: 'D:/app/qqmusic/runtime.js',
        },
      },
    ]);

    const report = await inspectPlatformPackDoctor();
    const connector = report.connectors[0];

    expect(report.status).toBe('error');
    expect(connector?.connectorId).toBe('connector.platform.qqmusic');
    expect(connector?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'hydrate.registration-failed',
          severity: 'error',
          fields: expect.objectContaining({
            phase: 'hydrate',
            sourceType: 'external',
          }),
        }),
        expect.objectContaining({
          code: 'registration.missing',
          severity: 'error',
          fields: expect.objectContaining({
            expectedBuiltin: false,
          }),
        }),
        expect.objectContaining({
          code: 'contract.binding-unsupported',
          severity: 'warn',
          fields: expect.objectContaining({
            bucket: 'library',
            bindingId: 'host.pmp.custom.library',
          }),
        }),
      ])
    );
  });
});
