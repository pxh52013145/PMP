import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PlatformCompatContractFile,
  PlatformCompatRuntimeApi,
  PlatformInstanceRecord,
} from '@pixel-matrix/plugin-platform-contracts';
import type { PlatformConnectorDefinition } from './connectorAuth';
import type { InstalledPlatformPackRecord } from './installedPlatformPacks';
import type { PlatformImportedInstanceRecord } from './platformImportedInstanceRegistry';
import type {
  BuiltinPlatformPackAssetDefinition,
  PlatformPackReadinessDiagnostic,
  BuiltinPlatformPackStoreInspection,
  PlatformPackRegistrationRecord,
  PlatformPackWorkspaceReadiness,
  PlatformPackStartupHealth,
} from './platformPackRegistry';
import type {
  PlatformRuntimeDescriptor,
  PlatformRuntimeWorkspaceRouting,
} from './platformRuntimeDescriptor';
import type { PlatformPackWorkspaceSurfaceRecord } from './platformWorkspaceSurface';

const {
  telemetryLoggerMock,
  tauriRuntimeMock,
  listPlatformConnectorDefinitionsMock,
  loadInstalledPlatformPackRecordsMock,
  areInstalledPlatformPackArtifactsPresentMock,
  createInstalledPlatformPackEntryUrlMock,
  listPlatformInstancesMock,
  listPlatformImportedInstanceRecordsMock,
  getPlatformPackStartupHealthMock,
  inspectBuiltinPlatformPackStoreStateMock,
  inspectPlatformPackWorkspaceReadinessForInstallationMock,
  listBuiltinPlatformPackAssetsMock,
  listPlatformPackReadinessDiagnosticsMock,
  listPlatformPackRegistrationsMock,
  listPlatformRuntimeDescriptorsMock,
  resolvePlatformPackWorkspaceSurfaceForInstallationMock,
  resolvePlatformRuntimeDescriptorByInstanceIdMock,
  resolvePlatformWorkspaceRoutingForConnectorMock,
  resolvePlatformWorkspaceRoutingForInstanceIdMock,
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
  createInstalledPlatformPackEntryUrlMock: vi.fn(async (path: string): Promise<string> => `asset://${path}`),
  listPlatformInstancesMock: vi.fn((): PlatformInstanceRecord[] => []),
  listPlatformImportedInstanceRecordsMock: vi.fn(
    (): PlatformImportedInstanceRecord[] => []
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
  inspectPlatformPackWorkspaceReadinessForInstallationMock: vi.fn(
    (installationId: string): PlatformPackWorkspaceReadiness => ({
      connectorId: 'connector.platform.netease',
      packId: 'test-pack',
      packVersion: '1.0.0',
      source: `installed-pack:test-pack:${installationId}`,
      ready: true,
      hostRouterReady: true,
      registrationPresent: true,
      contractPresent: true,
      runtimePresent: true,
      workspaceOwnershipDeclared: true,
      mountSurfaceDeclared: true,
      diagnostics: [],
    })
  ),
  listPlatformPackReadinessDiagnosticsMock: vi.fn(
    (): PlatformPackReadinessDiagnostic[] => []
  ),
  listPlatformPackRegistrationsMock: vi.fn((): PlatformPackRegistrationRecord[] => []),
  listPlatformRuntimeDescriptorsMock: vi.fn((): PlatformRuntimeDescriptor[] => []),
  resolvePlatformPackWorkspaceSurfaceForInstallationMock: vi.fn(
    (installationId: string): PlatformPackWorkspaceSurfaceRecord | null => ({
      connectorId: 'connector.platform.netease',
      platformId: 'netease',
      displayName: 'Netease',
      packId: 'builtin-netease',
      packVersion: '1.0.0',
      source: `installed-pack:test-pack:${installationId}`,
      runtimeCode: 'export {}',
      runtimeImportUrl: `asset://runtime/${installationId}`,
      workspace: {
        ownership: 'pack',
        root: {
          viewId: 'workspace.root',
          viewType: 'music-platform.workspace-root',
        },
      },
      root: {
        viewId: 'workspace.root',
        viewType: 'music-platform.workspace-root',
      },
      requiredRuntimeCarrier: 'webview-frame',
    })
  ),
  resolvePlatformRuntimeDescriptorByInstanceIdMock: vi.fn(
    (instanceId: string): PlatformRuntimeDescriptor => ({
      connectorId: 'connector.platform.netease',
      platformId: 'netease',
      displayName: instanceId,
      enabled: true,
      authState: 'authorized',
      availability: 'available',
      workspaceKind: 'netease',
      workspaceMode: 'dedicated',
      platformTemplate: 'music',
      sortOrder: 10,
      sourceKind: 'pack',
      connectorDefinition: null,
      packRegistration: null,
      compatRegistryRecord: null,
      instanceRecord: {
        instanceId,
        platformId: 'netease',
        instanceLabel: instanceId,
        displayName: instanceId,
        staticIcon: 'icon.svg',
        account: {},
        auth: {
          status: 'authorized',
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
        registrations: {
          navigationIds: [],
          settingsIds: [],
          pageIds: [],
        },
        availability: 'available',
        metadata: {
          connectorId: 'connector.platform.netease',
        },
      },
      runtime: null,
      workspaceRouting: {
        ownershipMode: 'legacy',
        path: 'legacy',
        status: 'active',
        usesLegacyHostWorkspace: true,
        packWorkspaceReady: false,
        fallbackReasonCode: null,
        fallbackReasonMessage: null,
        diagnostics: [],
        packReadiness: {
          connectorId: 'connector.platform.netease',
          packId: null,
          packVersion: null,
          source: null,
          ready: false,
          hostRouterReady: false,
          registrationPresent: false,
          contractPresent: false,
          runtimePresent: false,
          workspaceOwnershipDeclared: false,
          mountSurfaceDeclared: false,
          diagnostics: [],
        },
      },
    })
  ),
  resolvePlatformWorkspaceRoutingForConnectorMock: vi.fn(
    (connectorId: string): PlatformRuntimeWorkspaceRouting => ({
      ownershipMode: 'legacy',
      path: 'legacy',
      status: 'active',
      usesLegacyHostWorkspace: true,
      packWorkspaceReady: false,
      fallbackReasonCode: null,
      fallbackReasonMessage: null,
      diagnostics: [],
      packReadiness: {
        connectorId: connectorId as PlatformConnectorDefinition['connectorId'],
        packId: null,
        packVersion: null,
        source: null,
        ready: false,
        hostRouterReady: false,
        registrationPresent: false,
        contractPresent: false,
        runtimePresent: false,
        workspaceOwnershipDeclared: false,
        mountSurfaceDeclared: false,
        diagnostics: [],
      },
    })
  ),
  resolvePlatformWorkspaceRoutingForInstanceIdMock: vi.fn(
    (instanceId: string): PlatformRuntimeWorkspaceRouting | null => ({
      ownershipMode: 'legacy',
      path: 'legacy',
      status: 'active',
      usesLegacyHostWorkspace: true,
      packWorkspaceReady: false,
      fallbackReasonCode: null,
      fallbackReasonMessage: null,
      diagnostics: [],
      packReadiness: {
        connectorId: 'connector.platform.netease',
        packId: 'test-pack',
        packVersion: '1.0.0',
        source: `installed-pack:test-pack:${instanceId}`,
        ready: false,
        hostRouterReady: true,
        registrationPresent: true,
        contractPresent: true,
        runtimePresent: true,
        workspaceOwnershipDeclared: false,
        mountSurfaceDeclared: false,
        diagnostics: [],
      },
    })
  ),
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
  createInstalledPlatformPackEntryUrl: createInstalledPlatformPackEntryUrlMock,
}));

vi.mock('./instanceRegistry', () => ({
  listPlatformInstances: listPlatformInstancesMock,
}));

vi.mock('./platformImportedInstanceRegistry', () => ({
  listPlatformImportedInstanceRecords: listPlatformImportedInstanceRecordsMock,
}));

vi.mock('./platformPackRegistry', () => ({
  getPlatformPackStartupHealth: getPlatformPackStartupHealthMock,
  inspectBuiltinPlatformPackStoreState: inspectBuiltinPlatformPackStoreStateMock,
  inspectPlatformPackWorkspaceReadinessForInstallation:
    inspectPlatformPackWorkspaceReadinessForInstallationMock,
  listBuiltinPlatformPackAssets: listBuiltinPlatformPackAssetsMock,
  listPlatformPackReadinessDiagnostics: listPlatformPackReadinessDiagnosticsMock,
  listPlatformPackRegistrations: listPlatformPackRegistrationsMock,
  resolvePlatformPackWorkspaceSurfaceForInstallation:
    resolvePlatformPackWorkspaceSurfaceForInstallationMock,
}));

vi.mock('./platformRuntimeDescriptor', () => ({
  listPlatformRuntimeDescriptors: listPlatformRuntimeDescriptorsMock,
  resolvePlatformRuntimeDescriptorByInstanceId:
    resolvePlatformRuntimeDescriptorByInstanceIdMock,
  resolvePlatformWorkspaceRoutingForConnector:
    resolvePlatformWorkspaceRoutingForConnectorMock,
  resolvePlatformWorkspaceRoutingForInstanceId:
    resolvePlatformWorkspaceRoutingForInstanceIdMock,
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
    workspaceRouting: {
      ownershipMode: 'legacy',
      path: 'legacy',
      status: 'active',
      usesLegacyHostWorkspace: true,
      packWorkspaceReady: false,
      fallbackReasonCode: null,
      fallbackReasonMessage: null,
      diagnostics: [],
      packReadiness: {
        connectorId: 'connector.platform.netease',
        packId: 'builtin-netease',
        packVersion: '1.0.0',
        source: 'builtin-pack:netease',
        ready: false,
        hostRouterReady: false,
        registrationPresent: true,
        contractPresent: true,
        runtimePresent: true,
        workspaceOwnershipDeclared: false,
        mountSurfaceDeclared: false,
        diagnostics: [],
      },
    },
  };
}

function createInstalledRecord(
  overrides: Partial<InstalledPlatformPackRecord> = {}
): InstalledPlatformPackRecord {
  const contract = createContract();
  return {
    installationId: overrides.installationId ?? 'installation-netease-1',
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

function createImportedInstanceRecord(
  overrides: Partial<PlatformImportedInstanceRecord> = {}
): PlatformImportedInstanceRecord {
  return {
    instanceId: overrides.instanceId ?? 'netease:imported-1',
    installationId: overrides.installationId ?? 'installation-netease-1',
    connectorId: overrides.connectorId ?? 'connector.platform.netease',
    platformId: overrides.platformId ?? 'netease',
    instanceLabel: overrides.instanceLabel ?? 'Netease Import',
    displayName: overrides.displayName ?? 'Netease Import',
    createdAtMs: overrides.createdAtMs ?? 123,
  };
}

function createPlatformInstanceRecord(
  overrides: Partial<PlatformInstanceRecord> = {}
): PlatformInstanceRecord {
  return {
    instanceId: overrides.instanceId ?? 'netease:imported-1',
    platformId: overrides.platformId ?? 'netease',
    instanceLabel: overrides.instanceLabel ?? 'Netease Import',
    displayName: overrides.displayName ?? 'Netease Import',
    staticIcon: 'icon.svg',
    account: overrides.account ?? {},
    auth: overrides.auth ?? {
      status: 'authorized',
    },
    capabilities: overrides.capabilities ?? {
      playlists: true,
      favorites: false,
      dailyRecommendations: true,
      search: true,
      quality: true,
      navigation: false,
      settings: false,
      pages: true,
    },
    registrations: overrides.registrations ?? {
      navigationIds: [],
      settingsIds: [],
      pageIds: [],
    },
    availability: overrides.availability ?? 'available',
    availabilityMessage: overrides.availabilityMessage,
    metadata: overrides.metadata ?? {
      connectorId: 'connector.platform.netease',
      installationId: 'installation-netease-1',
      imported: true,
      sourceType: 'external',
      source: 'file:netease.pmpp',
    },
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
    createInstalledPlatformPackEntryUrlMock.mockImplementation(async (path: string) => `asset://${path}`);
    listPlatformInstancesMock.mockReturnValue([]);
    listPlatformImportedInstanceRecordsMock.mockReturnValue([]);
    inspectPlatformPackWorkspaceReadinessForInstallationMock.mockImplementation(
      (installationId: string) => ({
        connectorId: 'connector.platform.netease',
        packId: 'builtin-netease',
        packVersion: '1.0.0',
        source: `installed-pack:test-pack:${installationId}`,
        ready: true,
        hostRouterReady: true,
        registrationPresent: true,
        contractPresent: true,
        runtimePresent: true,
        workspaceOwnershipDeclared: true,
        mountSurfaceDeclared: true,
        diagnostics: [],
      })
    );
    resolvePlatformPackWorkspaceSurfaceForInstallationMock.mockImplementation(
      (installationId: string) => ({
        connectorId: 'connector.platform.netease',
        platformId: 'netease',
        displayName: 'Netease',
        packId: 'builtin-netease',
        packVersion: '1.0.0',
        source: `installed-pack:test-pack:${installationId}`,
        runtimeCode: 'export {}',
        runtimeImportUrl: `asset://runtime/${installationId}`,
        workspace: {
          ownership: 'pack',
          root: {
            viewId: 'workspace.root',
            viewType: 'music-platform.workspace-root',
          },
        },
        root: {
          viewId: 'workspace.root',
          viewType: 'music-platform.workspace-root',
        },
        requiredRuntimeCarrier: 'webview-frame',
      })
    );
    resolvePlatformRuntimeDescriptorByInstanceIdMock.mockImplementation((instanceId: string) => ({
      ...createDescriptor(createRuntime()),
      instanceRecord: createPlatformInstanceRecord({
        instanceId,
      }),
    }) as PlatformRuntimeDescriptor);
    resolvePlatformWorkspaceRoutingForInstanceIdMock.mockImplementation(
      (instanceId: string): PlatformRuntimeWorkspaceRouting => ({
        ownershipMode: 'legacy',
        path: 'legacy',
        status: 'active',
        usesLegacyHostWorkspace: true,
        packWorkspaceReady: false,
        fallbackReasonCode: null,
        fallbackReasonMessage: null,
        diagnostics: [],
        packReadiness: {
          connectorId: 'connector.platform.netease',
          packId: 'builtin-netease',
          packVersion: '1.0.0',
          source: `installed-pack:test-pack:${instanceId}`,
          ready: false,
          hostRouterReady: true,
          registrationPresent: true,
          contractPresent: true,
          runtimePresent: true,
          workspaceOwnershipDeclared: false,
          mountSurfaceDeclared: false,
          diagnostics: [],
        },
      })
    );
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

  it('marks auto mode fallback as degraded and exposes workspace routing details', async () => {
    const runtime = createRuntime();
    const descriptor = createDescriptor(runtime);
    descriptor.workspaceRouting = {
      ...descriptor.workspaceRouting,
      ownershipMode: 'auto',
      path: 'legacy',
      status: 'fallback',
      fallbackReasonCode: 'workspace.host-router.unavailable',
      fallbackReasonMessage: 'Host pack workspace router is unavailable.',
      diagnostics: [
        {
          code: 'workspace.host-router.unavailable',
          severity: 'error',
          message: 'Host pack workspace router is unavailable.',
        },
      ],
    };

    listPlatformPackRegistrationsMock.mockReturnValue([createRegistration(runtime)]);
    listPlatformRuntimeDescriptorsMock.mockReturnValue([descriptor]);

    const report = await inspectPlatformPackDoctor();
    const connector = report.connectors[0];

    expect(report.status).toBe('degraded');
    expect(connector?.status).toBe('degraded');
    expect(connector?.workspaceRouting.status).toBe('fallback');
    expect(connector?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'workspace.fallback-to-legacy',
          severity: 'warn',
          fields: expect.objectContaining({
            ownershipMode: 'auto',
            reasonCode: 'workspace.host-router.unavailable',
          }),
        }),
      ])
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

  it('keeps same-connector installations and imported instances distinct in doctor output', async () => {
    const runtime = createRuntime();
    const firstInstall = createInstalledRecord({
      installationId: 'installation-qqmusic-a',
      packId: 'external-qqmusic',
      connectorId: 'connector.platform.qqmusic',
      platformId: 'qqmusic',
      sourceType: 'external',
      source: 'file:qqmusic-a.pmpp',
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
      },
      artifactRootPath: 'D:/app/qqmusic/a',
      manifestPath: 'D:/app/qqmusic/a/manifest.json',
      contractPath: 'D:/app/qqmusic/a/contract.json',
      runtimePath: 'D:/app/qqmusic/a/runtime.js',
      iconPath: 'D:/app/qqmusic/a/icon.svg',
    });
    const secondInstall = createInstalledRecord({
      ...firstInstall,
      installationId: 'installation-qqmusic-b',
      source: 'file:qqmusic-b.pmpp',
      artifactRootPath: 'D:/app/qqmusic/b',
      manifestPath: 'D:/app/qqmusic/b/manifest.json',
      contractPath: 'D:/app/qqmusic/b/contract.json',
      runtimePath: 'D:/app/qqmusic/b/runtime.js',
      iconPath: 'D:/app/qqmusic/b/icon.svg',
      installedAtMs: 456,
    });
    const descriptor = createDescriptor(runtime);
    descriptor.connectorId = 'connector.platform.qqmusic';
    descriptor.platformId = 'qqmusic';
    descriptor.displayName = 'Qqmusic';
    descriptor.workspaceKind = 'qqmusic';
    descriptor.connectorDefinition = {
      ...createRegistration(runtime).definition,
      connectorId: 'connector.platform.qqmusic',
      displayName: 'Qqmusic',
      workspaceKind: 'qqmusic',
    };
    descriptor.packRegistration = {
      ...createRegistration(runtime),
      connectorId: 'connector.platform.qqmusic',
      platformId: 'qqmusic',
      source: 'installed-pack:external-qqmusic:installation-qqmusic-b',
      definition: {
        ...createRegistration(runtime).definition,
        connectorId: 'connector.platform.qqmusic',
        displayName: 'Qqmusic',
        workspaceKind: 'qqmusic',
      },
    };
    descriptor.compatRegistryRecord = {
      ...descriptor.compatRegistryRecord!,
      platformId: 'qqmusic',
      metadata: {
        connectorId: 'connector.platform.qqmusic',
      },
    };
    descriptor.workspaceRouting = {
      ...descriptor.workspaceRouting,
      ownershipMode: 'auto',
      path: 'legacy',
      status: 'fallback',
      fallbackReasonCode: 'workspace.installation-registration.missing',
      fallbackReasonMessage: 'Latest install is not ready.',
    };

    listBuiltinPlatformPackAssetsMock.mockReturnValue([]);
    listPlatformConnectorDefinitionsMock.mockReturnValue([
      {
        connectorId: 'connector.platform.qqmusic',
        displayName: 'Qqmusic',
        labelKey: 'platform.qqmusic',
        iconKey: 'qqmusic',
        platformTemplate: 'music',
        enabled: true,
        authFlow: 'qr',
        workspaceKind: 'qqmusic',
        workspaceMode: 'dedicated',
        sortOrder: 10,
      },
    ]);
    loadInstalledPlatformPackRecordsMock.mockReturnValue([firstInstall, secondInstall]);
    listPlatformPackRegistrationsMock.mockReturnValue([
      {
        ...createRegistration(runtime),
        connectorId: 'connector.platform.qqmusic',
        platformId: 'qqmusic',
        source: 'installed-pack:external-qqmusic:installation-qqmusic-b',
        definition: {
          ...createRegistration(runtime).definition,
          connectorId: 'connector.platform.qqmusic',
          displayName: 'Qqmusic',
          workspaceKind: 'qqmusic',
        },
      },
    ]);
    listPlatformRuntimeDescriptorsMock.mockReturnValue([descriptor]);
    listPlatformImportedInstanceRecordsMock.mockReturnValue([
      createImportedInstanceRecord({
        instanceId: 'qqmusic:imported-a',
        installationId: 'installation-qqmusic-a',
        connectorId: 'connector.platform.qqmusic',
        platformId: 'qqmusic',
        displayName: 'Qqmusic Import A',
        instanceLabel: 'Qqmusic A',
      }),
      createImportedInstanceRecord({
        instanceId: 'qqmusic:imported-b',
        installationId: 'installation-qqmusic-b',
        connectorId: 'connector.platform.qqmusic',
        platformId: 'qqmusic',
        displayName: 'Qqmusic Import B',
        instanceLabel: 'Qqmusic B',
      }),
    ]);
    listPlatformInstancesMock.mockReturnValue([
      createPlatformInstanceRecord({
        instanceId: 'qqmusic:imported-a',
        platformId: 'qqmusic',
        displayName: 'Qqmusic Import A',
        instanceLabel: 'Qqmusic A',
        metadata: {
          connectorId: 'connector.platform.qqmusic',
          installationId: 'installation-qqmusic-a',
          imported: true,
          sourceType: 'external',
          source: 'file:qqmusic-a.pmpp',
        },
      }),
      createPlatformInstanceRecord({
        instanceId: 'qqmusic:imported-b',
        platformId: 'qqmusic',
        displayName: 'Qqmusic Import B',
        instanceLabel: 'Qqmusic B',
        metadata: {
          connectorId: 'connector.platform.qqmusic',
          installationId: 'installation-qqmusic-b',
          imported: true,
          sourceType: 'external',
          source: 'file:qqmusic-b.pmpp',
        },
      }),
    ]);
    inspectPlatformPackWorkspaceReadinessForInstallationMock.mockImplementation(
      (installationId: string): PlatformPackWorkspaceReadiness => ({
        connectorId: 'connector.platform.qqmusic',
        packId: 'external-qqmusic',
        packVersion: '1.0.0',
        source: `installed-pack:external-qqmusic:${installationId}`,
        ready: installationId === 'installation-qqmusic-a',
        hostRouterReady: true,
        registrationPresent: installationId === 'installation-qqmusic-a',
        contractPresent: true,
        runtimePresent: true,
        workspaceOwnershipDeclared: installationId === 'installation-qqmusic-a',
        mountSurfaceDeclared: installationId === 'installation-qqmusic-a',
        diagnostics:
          installationId === 'installation-qqmusic-a'
            ? []
            : [
                {
                  code: 'workspace.installation-registration.missing',
                  severity: 'error',
                  message: 'Installation-scoped workspace registration is missing.',
                },
              ],
      })
    );
    resolvePlatformPackWorkspaceSurfaceForInstallationMock.mockImplementation(
      (installationId: string): PlatformPackWorkspaceSurfaceRecord | null =>
        installationId === 'installation-qqmusic-a'
          ? {
              connectorId: 'connector.platform.qqmusic',
              platformId: 'qqmusic',
              displayName: 'Qqmusic',
              packId: 'external-qqmusic',
              packVersion: '1.0.0',
              source: `installed-pack:external-qqmusic:${installationId}`,
              runtimeCode: 'export {}',
              runtimeImportUrl: `asset://runtime/${installationId}`,
              workspace: {
                ownership: 'pack',
                root: {
                  viewId: 'qqmusic.workspace.root',
                  viewType: 'music-platform.workspace-root',
                },
              },
              root: {
                viewId: 'qqmusic.workspace.root',
                viewType: 'music-platform.workspace-root',
              },
              requiredRuntimeCarrier: 'webview-frame',
            }
          : null
    );
    resolvePlatformRuntimeDescriptorByInstanceIdMock.mockImplementation((instanceId: string) => ({
      ...descriptor,
      instanceRecord: createPlatformInstanceRecord({
        instanceId,
        platformId: 'qqmusic',
        displayName: instanceId === 'qqmusic:imported-a' ? 'Qqmusic Import A' : 'Qqmusic Import B',
        instanceLabel: instanceId === 'qqmusic:imported-a' ? 'Qqmusic A' : 'Qqmusic B',
        metadata: {
          connectorId: 'connector.platform.qqmusic',
          installationId:
            instanceId === 'qqmusic:imported-a'
              ? 'installation-qqmusic-a'
              : 'installation-qqmusic-b',
          imported: true,
          sourceType: 'external',
          source:
            instanceId === 'qqmusic:imported-a'
              ? 'file:qqmusic-a.pmpp'
              : 'file:qqmusic-b.pmpp',
        },
      }),
      workspaceRouting:
        instanceId === 'qqmusic:imported-a'
          ? {
              ownershipMode: 'auto',
              path: 'pack',
              status: 'active',
              usesLegacyHostWorkspace: false,
              packWorkspaceReady: true,
              fallbackReasonCode: null,
              fallbackReasonMessage: null,
              diagnostics: [],
              packReadiness: {
                connectorId: 'connector.platform.qqmusic',
                packId: 'external-qqmusic',
                packVersion: '1.0.0',
                source: 'installed-pack:external-qqmusic:installation-qqmusic-a',
                ready: true,
                hostRouterReady: true,
                registrationPresent: true,
                contractPresent: true,
                runtimePresent: true,
                workspaceOwnershipDeclared: true,
                mountSurfaceDeclared: true,
                diagnostics: [],
              },
            }
          : {
              ownershipMode: 'auto',
              path: 'legacy',
              status: 'fallback',
              usesLegacyHostWorkspace: true,
              packWorkspaceReady: false,
              fallbackReasonCode: 'workspace.installation-registration.missing',
              fallbackReasonMessage: 'Latest install is not ready.',
              diagnostics: [
                {
                  code: 'workspace.installation-registration.missing',
                  severity: 'error',
                  message: 'Latest install is not ready.',
                },
              ],
              packReadiness: {
                connectorId: 'connector.platform.qqmusic',
                packId: 'external-qqmusic',
                packVersion: '1.0.0',
                source: 'installed-pack:external-qqmusic:installation-qqmusic-b',
                ready: false,
                hostRouterReady: true,
                registrationPresent: false,
                contractPresent: true,
                runtimePresent: true,
                workspaceOwnershipDeclared: false,
                mountSurfaceDeclared: false,
                diagnostics: [
                  {
                    code: 'workspace.installation-registration.missing',
                    severity: 'error',
                    message: 'Latest install is not ready.',
                  },
                ],
              },
            },
    }) as PlatformRuntimeDescriptor);
    resolvePlatformWorkspaceRoutingForInstanceIdMock.mockImplementation(
      (instanceId: string): PlatformRuntimeWorkspaceRouting | null =>
        resolvePlatformRuntimeDescriptorByInstanceIdMock(instanceId)?.workspaceRouting ?? null
    );

    const report = await inspectPlatformPackDoctor();
    const connector = report.connectors[0];

    expect(report.installationCount).toBe(2);
    expect(report.instanceCount).toBe(2);
    expect(connector?.installations.map((installation) => installation.installationId)).toEqual([
      'installation-qqmusic-a',
      'installation-qqmusic-b',
    ]);
    expect(connector?.instances.map((instance) => instance.instanceId)).toEqual([
      'qqmusic:imported-a',
      'qqmusic:imported-b',
    ]);
    expect(connector?.instances[0]?.workspaceRouting.path).toBe('pack');
    expect(connector?.instances[1]?.workspaceRouting.status).toBe('fallback');
    expect(connector?.installations[0]?.workspaceSurface.resolved).toBe(true);
    expect(connector?.installations[1]?.workspaceSurface.resolved).toBe(false);
  });
});
