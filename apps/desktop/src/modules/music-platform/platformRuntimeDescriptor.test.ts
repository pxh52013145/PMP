import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PlatformCompatContractFile,
  PlatformCompatRuntimeApi,
  PlatformInstanceRecord,
} from '@pixel-matrix/plugin-platform-contracts';
import type { InstalledPlatformPackRecord } from './installedPlatformPacks';
import type { PlatformImportedInstanceRecord } from './platformImportedInstanceRegistry';
import type { PlatformPackWorkspaceSurfaceRecord } from './platformWorkspaceSurface';

type ConnectorDefinitionState = Array<Record<string, unknown>>;
type PackRegistrationState = Array<Record<string, unknown>>;
type CompatRecordState = Array<Record<string, unknown>>;

const state = vi.hoisted(() => ({
  connectorDefinitions: [] as ConnectorDefinitionState,
  packRegistrations: [] as PackRegistrationState,
  compatRecords: [] as CompatRecordState,
  instances: [] as PlatformInstanceRecord[],
  importedInstances: [] as PlatformImportedInstanceRecord[],
  installedRecords: [] as InstalledPlatformPackRecord[],
  workspaceSurfacesByInstallationId: {} as Record<string, PlatformPackWorkspaceSurfaceRecord>,
  activeCurrentInstanceId: null as string | null,
  activeConnectorInstanceIds: {} as Record<string, string>,
  workspaceOwnershipModes: {} as Record<string, 'legacy' | 'pack' | 'auto'>,
  packWorkspaceReadyConnectorIds: [] as string[],
  packWorkspaceReadyInstallationIds: [] as string[],
}));

vi.mock('./connectorAuth', () => ({
  listPlatformConnectorDefinitions: () => state.connectorDefinitions,
}));

vi.mock('./platformPackRegistry', () => ({
  listPlatformPackRegistrations: () => state.packRegistrations,
  resolvePlatformPackRegistrationForInstallation: (installationId: string) =>
    state.packRegistrations.find(
      (record) => (record as { installationId?: unknown }).installationId === installationId
    ) ?? null,
  resolvePlatformPackWorkspaceSurface: (connectorId: string) => {
    const installedRecord = state.installedRecords.find(
      (record) => record.connectorId === connectorId
    );
    if (!installedRecord) {
      return null;
    }
    return createWorkspaceSurfaceFromInstalledRecord(installedRecord);
  },
  resolvePlatformPackWorkspaceSurfaceForInstallation: (installationId: string) => {
    const installedRecord =
      state.installedRecords.find((record) => record.installationId === installationId) ??
      null;
    return installedRecord
      ? createWorkspaceSurfaceFromInstalledRecord(installedRecord)
      : state.workspaceSurfacesByInstallationId[installationId] ?? null;
  },
  inspectPlatformPackWorkspaceReadiness: (connectorId: string) => {
    const ready = state.packWorkspaceReadyConnectorIds.includes(connectorId);
    return {
      connectorId,
      packId: 'test-pack',
      packVersion: '1.0.0',
      source: 'test',
      ready,
      hostRouterReady: true,
      registrationPresent: true,
      contractPresent: true,
      runtimePresent: true,
      workspaceOwnershipDeclared: ready,
      mountSurfaceDeclared: ready,
      diagnostics: ready
        ? []
        : [
            {
              code: 'workspace.pack-root.missing',
              severity: 'error',
              message: 'Pack workspace root is missing.',
            },
        ],
    };
  },
  inspectPlatformPackWorkspaceReadinessForInstallation: (installationId: string) => {
    const ready = state.packWorkspaceReadyInstallationIds.includes(installationId);
    return {
      connectorId: 'connector.platform.bilibili',
      packId: 'test-pack',
      packVersion: '1.0.0',
      source: `installed-pack:test-pack:${installationId}`,
      ready,
      hostRouterReady: true,
      registrationPresent: true,
      contractPresent: true,
      runtimePresent: true,
      workspaceOwnershipDeclared: ready,
      mountSurfaceDeclared: ready,
      diagnostics: ready
        ? []
        : [
            {
              code: 'workspace.installation-registration.missing',
              severity: 'error',
              message: 'Installation-scoped pack workspace is missing.',
            },
          ],
    };
  },
}));

vi.mock('./globalSettings', () => ({
  resolveMusicPlatformWorkspaceOwnershipMode: (connectorId: string) =>
    state.workspaceOwnershipModes[connectorId] ?? 'legacy',
}));

vi.mock('./contractRegistry', () => ({
  listPlatformCompatRegistryRecords: () => state.compatRecords,
  getPlatformCompatRegistryRecord: (platformId: string) =>
    state.compatRecords.find((record) => record.platformId === platformId) ?? null,
}));

vi.mock('./instanceRegistry', () => ({
  listPlatformInstances: () => state.instances,
  getPlatformInstance: (instanceId: string) =>
    state.instances.find((instance) => instance.instanceId === instanceId) ?? null,
}));

vi.mock('./platformImportedInstanceRegistry', () => ({
  listPlatformImportedInstanceRecords: () => state.importedInstances,
  getPlatformImportedInstanceRecord: (instanceId: string) =>
    state.importedInstances.find((instance) => instance.instanceId === instanceId) ?? null,
}));

vi.mock('./installedPlatformPacks', () => ({
  listInstalledPlatformPackRecords: () => state.installedRecords,
  getInstalledPlatformPackRecord: (installationId: string) =>
    state.installedRecords.find((record) => record.installationId === installationId) ?? null,
}));

vi.mock('./activeInstanceRegistry', () => ({
  getActiveMusicPlatformInstanceId: (options?: { connectorId?: string | null }) => {
    const connectorId = options?.connectorId?.trim();
    if (connectorId) {
      return state.activeConnectorInstanceIds[connectorId] ?? null;
    }
    return state.activeCurrentInstanceId;
  },
}));

function createRuntime(source = 'test'): PlatformCompatRuntimeApi {
  return {
    metadata: {
      source,
    },
  };
}

function createContract(platformId: string, displayName: string): PlatformCompatContractFile {
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

function createInstanceRecord(input: {
  instanceId: string;
  platformId: string;
  connectorId: string;
  displayName: string;
  authStatus: PlatformInstanceRecord['auth']['status'];
  updatedAtMs?: number;
  installationId?: string;
}): PlatformInstanceRecord {
  return {
    instanceId: input.instanceId,
    platformId: input.platformId,
    instanceLabel: input.displayName,
    displayName: input.displayName,
    staticIcon: 'icon.svg',
    account: {},
    auth: {
      status: input.authStatus,
      cookieUpdatedAtMs: input.updatedAtMs,
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
    registrations: {
      navigationIds: [],
      settingsIds: [],
      pageIds: [],
    },
    availability: 'available',
    metadata: {
      connectorId: input.connectorId,
      ...(input.installationId ? { installationId: input.installationId } : {}),
    },
  };
}

function createInstalledRecord(input: {
  installationId: string;
  connectorId: string;
  platformId: string;
  packId?: string;
  packVersion?: string;
  sourceType?: 'builtin' | 'external';
  source?: string;
  runtimePath?: string;
  iconPath?: string;
  artifactRootPath?: string;
  installedAtMs?: number;
}): InstalledPlatformPackRecord {
  return {
    installationId: input.installationId,
    packId: input.packId ?? `${input.platformId}-pack`,
    packVersion: input.packVersion ?? '1.0.0',
    packageDigest: `${input.installationId}-digest`,
    connectorId: input.connectorId as InstalledPlatformPackRecord['connectorId'],
    platformId: input.platformId,
    sourceType: input.sourceType ?? 'external',
    source:
      input.source ??
      `installed-pack:${input.packId ?? `${input.platformId}-pack`}:${input.installationId}`,
    installedAtMs: input.installedAtMs ?? 100,
    manifest: {
      formatVersion: '1.0',
      type: 'platform-pack',
      metadata: {
        id: input.packId ?? `${input.platformId}-pack`,
        name: input.platformId,
        version: input.packVersion ?? '1.0.0',
      },
      connector: {
        connectorId: input.connectorId,
        displayName: input.platformId,
        workspaceKind: input.platformId,
      },
      entry: {
        contract: 'contract.json',
        runtime: 'runtime.js',
        icon: 'icon.svg',
      },
    },
    contract: createContract(input.platformId, input.platformId),
    artifactRootPath:
      input.artifactRootPath ?? `D:/packs/${input.installationId}`,
    manifestPath: `D:/packs/${input.installationId}/manifest.json`,
    contractPath: `D:/packs/${input.installationId}/contract.json`,
    runtimePath: input.runtimePath ?? `D:/packs/${input.installationId}/runtime.js`,
    iconPath: input.iconPath ?? `D:/packs/${input.installationId}/icon.svg`,
  };
}

function createWorkspaceSurfaceFromInstalledRecord(
  record: InstalledPlatformPackRecord
): PlatformPackWorkspaceSurfaceRecord {
  return {
    connectorId: record.connectorId,
    platformId: record.platformId,
    displayName: record.platformId,
    packId: record.packId,
    packVersion: record.packVersion,
    source:
      record.source ??
      `installed-pack:${record.packId}:${record.installationId}`,
    runtimeCode: 'export {}',
    runtimeImportUrl: `asset://${record.runtimePath}`,
    workspace: {
      ownership: 'pack',
      root: {
        viewId: `${record.platformId}.workspace.root`,
        viewType: 'music-platform.workspace-root',
      },
    },
    root: {
      viewId: `${record.platformId}.workspace.root`,
      viewType: 'music-platform.workspace-root',
    },
    requiredRuntimeCarrier: 'webview-frame',
  };
}

function createImportedInstanceRecord(input: {
  instanceId: string;
  installationId: string;
  connectorId: string;
  platformId: string;
}): PlatformImportedInstanceRecord {
  return {
    instanceId: input.instanceId,
    installationId: input.installationId,
    connectorId: input.connectorId as PlatformImportedInstanceRecord['connectorId'],
    platformId: input.platformId,
    instanceLabel: input.instanceId,
    displayName: input.instanceId,
    createdAtMs: 100,
  };
}

describe('platformRuntimeDescriptor', () => {
  beforeEach(() => {
    vi.resetModules();
    state.connectorDefinitions = [];
    state.packRegistrations = [];
    state.compatRecords = [];
    state.instances = [];
    state.importedInstances = [];
    state.installedRecords = [];
    state.workspaceSurfacesByInstallationId = {};
    state.activeCurrentInstanceId = null;
    state.activeConnectorInstanceIds = {};
    state.workspaceOwnershipModes = {};
    state.packWorkspaceReadyConnectorIds = [];
    state.packWorkspaceReadyInstallationIds = [];
  });

  it('prefers the authorized builtin instance for connector descriptor resolution', async () => {
    state.connectorDefinitions = [
      {
        connectorId: 'connector.platform.netease',
        displayName: 'Netease',
        labelKey: 'netease',
        iconKey: 'netease',
        enabled: true,
        authFlow: 'qr',
        workspaceKind: 'netease',
        workspaceMode: 'dedicated',
        sortOrder: 20,
        source: 'pack',
      },
    ];
    state.packRegistrations = [
      {
        connectorId: 'connector.platform.netease',
        platformId: 'netease',
        definition: state.connectorDefinitions[0],
      },
    ];
    state.compatRecords = [
      {
        platformId: 'netease',
        contract: createContract('netease', 'Netease'),
        runtime: createRuntime(),
        source: 'platform-pack',
        registeredAtMs: 1,
        metadata: {
          connectorId: 'connector.platform.netease',
        },
      },
    ];
    state.instances = [
      createInstanceRecord({
        instanceId: 'netease:custom',
        platformId: 'netease',
        connectorId: 'connector.platform.netease',
        displayName: 'Netease Custom',
        authStatus: 'empty',
        updatedAtMs: 10,
      }),
      createInstanceRecord({
        instanceId: 'netease:builtin',
        platformId: 'netease',
        connectorId: 'connector.platform.netease',
        displayName: 'Netease Builtin',
        authStatus: 'authorized',
        updatedAtMs: 5,
      }),
    ];
    state.installedRecords = [
      createInstalledRecord({
        installationId: 'installation-netease-builtin',
        connectorId: 'connector.platform.netease',
        platformId: 'netease',
        packId: 'builtin-netease',
        sourceType: 'builtin',
        source: 'builtin-pack:netease',
      }),
    ];
    state.workspaceOwnershipModes['connector.platform.netease'] = 'auto';

    const runtimeDescriptor = await import('./platformRuntimeDescriptor');
    const descriptor =
      runtimeDescriptor.resolvePreferredPlatformRuntimeDescriptorForConnector(
        'connector.platform.netease'
      );

    expect(descriptor?.instanceRecord?.instanceId).toBe('netease:builtin');
    expect(descriptor?.authState).toBe('authorized');
    expect(descriptor?.sourceKind).toBe('pack');
    expect(descriptor?.runtime).toBeTruthy();
    expect(descriptor?.workspaceMount.installationId).toBe(
      'installation-netease-builtin'
    );
    expect(descriptor?.workspaceMount.resolutionSource).toBe('builtin-installation');
    expect(descriptor?.workspaceRouting.ownershipMode).toBe('auto');
    expect(descriptor?.workspaceRouting.path).toBe('legacy');
    expect(descriptor?.workspaceRouting.status).toBe('fallback');
    expect(descriptor?.workspaceRouting.fallbackReasonCode).toBe(
      'workspace.installation-registration.missing'
    );
  });

  it('resolves exact instance descriptors by instance id', async () => {
    state.connectorDefinitions = [
      {
        connectorId: 'connector.platform.bilibili',
        displayName: 'Bilibili',
        labelKey: 'bilibili',
        iconKey: 'bilibili',
        enabled: true,
        authFlow: 'qr',
        workspaceKind: 'bilibili',
        workspaceMode: 'dedicated',
        sortOrder: 10,
        source: 'pack',
      },
    ];
    state.compatRecords = [
      {
        platformId: 'bilibili',
        contract: createContract('bilibili', 'Bilibili'),
        runtime: createRuntime(),
        source: 'platform-pack',
        registeredAtMs: 1,
        metadata: {
          connectorId: 'connector.platform.bilibili',
        },
      },
    ];
    state.instances = [
      createInstanceRecord({
        instanceId: 'bilibili:custom',
        platformId: 'bilibili',
        connectorId: 'connector.platform.bilibili',
        displayName: 'Bilibili Custom',
        authStatus: 'authorized',
        installationId: 'installation-bilibili-1',
      }),
    ];
    state.installedRecords = [
      createInstalledRecord({
        installationId: 'installation-bilibili-1',
        connectorId: 'connector.platform.bilibili',
        platformId: 'bilibili',
      }),
    ];
    state.workspaceOwnershipModes['connector.platform.bilibili'] = 'legacy';
    state.packWorkspaceReadyInstallationIds = ['installation-bilibili-1'];

    const runtimeDescriptor = await import('./platformRuntimeDescriptor');
    const descriptor =
      runtimeDescriptor.resolvePlatformRuntimeDescriptorByInstanceId('bilibili:custom');

    expect(descriptor?.instanceRecord?.instanceId).toBe('bilibili:custom');
    expect(descriptor?.platformId).toBe('bilibili');
    expect(descriptor?.connectorId).toBe('connector.platform.bilibili');
    expect(descriptor?.workspaceMount.installationId).toBe('installation-bilibili-1');
    expect(descriptor?.workspaceMount.runtimeImportUrl).toBe(
      'asset://D:/packs/installation-bilibili-1/runtime.js'
    );
    expect(descriptor?.workspaceRouting.path).toBe('legacy');
    expect(descriptor?.workspaceRouting.status).toBe('active');
  });

  it('uses installation-scoped workspace readiness for imported instances', async () => {
    state.connectorDefinitions = [
      {
        connectorId: 'connector.platform.bilibili',
        displayName: 'Bilibili',
        labelKey: 'bilibili',
        iconKey: 'bilibili',
        enabled: true,
        authFlow: 'qr',
        workspaceKind: 'bilibili',
        workspaceMode: 'dedicated',
        sortOrder: 10,
        source: 'pack',
      },
    ];
    state.compatRecords = [
      {
        platformId: 'bilibili',
        contract: createContract('bilibili', 'Bilibili'),
        runtime: createRuntime(),
        source: 'platform-pack',
        registeredAtMs: 1,
        metadata: {
          connectorId: 'connector.platform.bilibili',
        },
      },
    ];
    state.instances = [
      createInstanceRecord({
        instanceId: 'bilibili:imported-a',
        platformId: 'bilibili',
        connectorId: 'connector.platform.bilibili',
        displayName: 'Bilibili Import A',
        authStatus: 'authorized',
        installationId: 'installation-bilibili-a',
      }),
    ];
    state.importedInstances = [
      createImportedInstanceRecord({
        instanceId: 'bilibili:imported-a',
        installationId: 'installation-bilibili-a',
        connectorId: 'connector.platform.bilibili',
        platformId: 'bilibili',
      }),
    ];
    state.installedRecords = [
      createInstalledRecord({
        installationId: 'installation-bilibili-a',
        connectorId: 'connector.platform.bilibili',
        platformId: 'bilibili',
      }),
    ];
    state.workspaceOwnershipModes['connector.platform.bilibili'] = 'auto';
    state.packWorkspaceReadyConnectorIds = [];
    state.packWorkspaceReadyInstallationIds = ['installation-bilibili-a'];

    const runtimeDescriptor = await import('./platformRuntimeDescriptor');
    const descriptor =
      runtimeDescriptor.resolvePlatformRuntimeDescriptorByInstanceId(
        'bilibili:imported-a'
      );

    expect(descriptor?.workspaceRouting.path).toBe('pack');
    expect(descriptor?.workspaceRouting.status).toBe('active');
    expect(descriptor?.workspaceMount.installationId).toBe('installation-bilibili-a');
    expect(descriptor?.workspaceMount.resolutionSource).toBe('imported-instance');
    expect(descriptor?.workspaceRouting.packReadiness.source).toBe(
      'installed-pack:test-pack:installation-bilibili-a'
    );
  });

  it('pins builtin instances to builtin installations even when same-connector external installs exist', async () => {
    state.connectorDefinitions = [
      {
        connectorId: 'connector.platform.netease',
        displayName: 'Netease',
        labelKey: 'netease',
        iconKey: 'netease',
        enabled: true,
        authFlow: 'qr',
        workspaceKind: 'netease',
        workspaceMode: 'dedicated',
        sortOrder: 20,
        source: 'pack',
      },
    ];
    state.compatRecords = [
      {
        platformId: 'netease',
        contract: createContract('netease', 'Netease'),
        runtime: createRuntime(),
        source: 'platform-pack',
        registeredAtMs: 1,
        metadata: {
          connectorId: 'connector.platform.netease',
        },
      },
    ];
    state.instances = [
      createInstanceRecord({
        instanceId: 'netease:builtin',
        platformId: 'netease',
        connectorId: 'connector.platform.netease',
        displayName: 'Netease Builtin',
        authStatus: 'authorized',
        updatedAtMs: 20,
      }),
      createInstanceRecord({
        instanceId: 'netease:imported-a',
        platformId: 'netease',
        connectorId: 'connector.platform.netease',
        displayName: 'Netease Imported',
        authStatus: 'authorized',
        updatedAtMs: 10,
        installationId: 'installation-netease-external',
      }),
    ];
    state.importedInstances = [
      createImportedInstanceRecord({
        instanceId: 'netease:imported-a',
        installationId: 'installation-netease-external',
        connectorId: 'connector.platform.netease',
        platformId: 'netease',
      }),
    ];
    state.installedRecords = [
      createInstalledRecord({
        installationId: 'installation-netease-builtin',
        connectorId: 'connector.platform.netease',
        platformId: 'netease',
        packId: 'builtin-netease',
        sourceType: 'builtin',
        source: 'builtin-pack:netease',
        installedAtMs: 100,
      }),
      createInstalledRecord({
        installationId: 'installation-netease-external',
        connectorId: 'connector.platform.netease',
        platformId: 'netease',
        packId: 'external-netease',
        sourceType: 'external',
        source: 'file:netease.pmpp',
        installedAtMs: 200,
      }),
    ];

    const runtimeDescriptor = await import('./platformRuntimeDescriptor');
    const descriptor =
      runtimeDescriptor.resolvePreferredPlatformRuntimeDescriptorForConnector(
        'connector.platform.netease'
      );

    expect(descriptor?.instanceRecord?.instanceId).toBe('netease:builtin');
    expect(descriptor?.workspaceMount.installationId).toBe(
      'installation-netease-builtin'
    );
    expect(descriptor?.workspaceMount.sourceType).toBe('builtin');
    expect(descriptor?.workspaceMount.resolutionSource).toBe('builtin-installation');
  });

  it('prefers installation-scoped runtime over connector-level compat singleton for imported instances', async () => {
    state.connectorDefinitions = [
      {
        connectorId: 'connector.platform.netease',
        displayName: 'Netease',
        labelKey: 'netease',
        iconKey: 'netease',
        enabled: true,
        authFlow: 'qr',
        workspaceKind: 'netease',
        workspaceMode: 'dedicated',
        sortOrder: 20,
        source: 'pack',
      },
    ];
    state.compatRecords = [
      {
        platformId: 'netease',
        contract: createContract('netease', 'Netease'),
        runtime: createRuntime('compat-singleton'),
        source: 'platform-pack',
        registeredAtMs: 1,
        metadata: {
          connectorId: 'connector.platform.netease',
        },
      },
    ];
    state.packRegistrations = [
      {
        connectorId: 'connector.platform.netease',
        installationId: 'installation-netease-a',
        platformId: 'netease',
        definition: state.connectorDefinitions[0],
        compat: {
          runtime: createRuntime('installation-a-runtime'),
        },
      },
      {
        connectorId: 'connector.platform.netease',
        installationId: 'installation-netease-b',
        platformId: 'netease',
        definition: state.connectorDefinitions[0],
        compat: {
          runtime: createRuntime('installation-b-runtime'),
        },
      },
    ];
    state.instances = [
      createInstanceRecord({
        instanceId: 'netease:imported-a',
        platformId: 'netease',
        connectorId: 'connector.platform.netease',
        displayName: 'Netease Imported A',
        authStatus: 'authorized',
        installationId: 'installation-netease-a',
      }),
    ];
    state.importedInstances = [
      createImportedInstanceRecord({
        instanceId: 'netease:imported-a',
        installationId: 'installation-netease-a',
        connectorId: 'connector.platform.netease',
        platformId: 'netease',
      }),
    ];
    state.installedRecords = [
      createInstalledRecord({
        installationId: 'installation-netease-a',
        connectorId: 'connector.platform.netease',
        platformId: 'netease',
        installedAtMs: 100,
      }),
      createInstalledRecord({
        installationId: 'installation-netease-b',
        connectorId: 'connector.platform.netease',
        platformId: 'netease',
        installedAtMs: 200,
      }),
    ];

    const runtimeDescriptor = await import('./platformRuntimeDescriptor');
    const descriptor =
      runtimeDescriptor.resolvePlatformRuntimeDescriptorByInstanceId(
        'netease:imported-a'
      );

    expect((descriptor?.runtime as { metadata?: { source?: string } } | null)?.metadata?.source).toBe(
      'installation-a-runtime'
    );
    expect(descriptor?.workspaceMount.installationId).toBe('installation-netease-a');
  });

  it('routes development platform pack instances through installation-scoped workspace surfaces without installed records', async () => {
    const devInstallationId = 'dev-demo-abc123';
    const connectorId = 'connector.platform.demo';
    const definition = {
      connectorId,
      displayName: 'Demo Dev',
      labelKey: 'demo',
      iconKey: 'demo',
      enabled: true,
      authFlow: 'none',
      workspaceKind: 'demo',
      workspaceMode: 'dedicated',
      sortOrder: 50,
      source: 'pack',
    };
    state.connectorDefinitions = [definition];
    state.packRegistrations = [
      {
        connectorId,
        installationId: devInstallationId,
        packId: 'demo-pack',
        packVersion: '0.1.0',
        platformId: 'demo',
        source: 'platform-pack-dev:demo-pack:connector.platform.demo:abc123:r2',
        definition,
        compat: {
          contract: createContract('demo', 'Demo Dev'),
          runtime: createRuntime('dev-runtime'),
        },
      },
    ];
    state.workspaceSurfacesByInstallationId[devInstallationId] = {
      connectorId: connectorId as PlatformPackWorkspaceSurfaceRecord['connectorId'],
      platformId: 'demo',
      displayName: 'Demo Dev',
      packId: 'demo-pack',
      packVersion: '0.1.0',
      source: 'platform-pack-dev:demo-pack:connector.platform.demo:abc123:r2',
      runtimeCode: 'export function mountPage() { return () => {}; }',
      workspace: {
        ownership: 'pack',
        root: {
          viewId: 'demo.workspace.root',
          viewType: 'music-platform.workspace-root',
        },
      },
      root: {
        viewId: 'demo.workspace.root',
        viewType: 'music-platform.workspace-root',
      },
      requiredRuntimeCarrier: 'webview-frame',
    };
    state.instances = [
      createInstanceRecord({
        instanceId: 'demo:dev-abc123',
        platformId: 'demo',
        connectorId,
        displayName: 'Demo Dev',
        authStatus: 'authorized',
        installationId: devInstallationId,
      }),
    ];
    state.workspaceOwnershipModes[connectorId] = 'pack';
    state.packWorkspaceReadyInstallationIds = [devInstallationId];

    const runtimeDescriptor = await import('./platformRuntimeDescriptor');
    const descriptor =
      runtimeDescriptor.resolvePlatformRuntimeDescriptorByInstanceId('demo:dev-abc123');

    expect((descriptor?.runtime as { metadata?: { source?: string } } | null)?.metadata?.source).toBe(
      'dev-runtime'
    );
    expect(descriptor?.workspaceMount).toMatchObject({
      installationId: devInstallationId,
      resolutionSource: 'instance-metadata',
      sourceType: null,
      source: 'platform-pack-dev:demo-pack:connector.platform.demo:abc123:r2',
      packId: 'demo-pack',
      packVersion: '0.1.0',
      runtimeImportUrl: null,
    });
    expect(descriptor?.workspaceMount.workspaceSurface?.runtimeCode).toContain('mountPage');
    expect(descriptor?.workspaceRouting.path).toBe('pack');
    expect(descriptor?.workspaceRouting.status).toBe('active');
  });

  it('prefers the connector-scoped active instance before generic preferred-instance fallback', async () => {
    state.connectorDefinitions = [
      {
        connectorId: 'connector.platform.netease',
        displayName: 'Netease',
        labelKey: 'netease',
        iconKey: 'netease',
        enabled: true,
        authFlow: 'qr',
        workspaceKind: 'netease',
        workspaceMode: 'dedicated',
        sortOrder: 20,
        source: 'pack',
      },
    ];
    state.compatRecords = [
      {
        platformId: 'netease',
        contract: createContract('netease', 'Netease'),
        runtime: createRuntime('compat-singleton'),
        source: 'platform-pack',
        registeredAtMs: 1,
        metadata: {
          connectorId: 'connector.platform.netease',
        },
      },
    ];
    state.instances = [
      createInstanceRecord({
        instanceId: 'netease:builtin',
        platformId: 'netease',
        connectorId: 'connector.platform.netease',
        displayName: 'Netease Builtin',
        authStatus: 'authorized',
        updatedAtMs: 100,
      }),
      createInstanceRecord({
        instanceId: 'netease:imported-a',
        platformId: 'netease',
        connectorId: 'connector.platform.netease',
        displayName: 'Netease Imported A',
        authStatus: 'empty',
        updatedAtMs: 10,
        installationId: 'installation-netease-imported-a',
      }),
    ];
    state.importedInstances = [
      createImportedInstanceRecord({
        instanceId: 'netease:imported-a',
        installationId: 'installation-netease-imported-a',
        connectorId: 'connector.platform.netease',
        platformId: 'netease',
      }),
    ];
    state.installedRecords = [
      createInstalledRecord({
        installationId: 'installation-netease-builtin',
        connectorId: 'connector.platform.netease',
        platformId: 'netease',
        packId: 'builtin-netease',
        sourceType: 'builtin',
        source: 'builtin-pack:netease',
        installedAtMs: 100,
      }),
      createInstalledRecord({
        installationId: 'installation-netease-imported-a',
        connectorId: 'connector.platform.netease',
        platformId: 'netease',
        packId: 'external-netease',
        sourceType: 'external',
        source: 'file:netease-imported.pmpp',
        installedAtMs: 200,
      }),
    ];
    state.activeCurrentInstanceId = 'netease:imported-a';
    state.activeConnectorInstanceIds['connector.platform.netease'] = 'netease:imported-a';

    const runtimeDescriptor = await import('./platformRuntimeDescriptor');
    const descriptor =
      runtimeDescriptor.resolvePreferredPlatformRuntimeDescriptorForConnector(
        'connector.platform.netease'
      );

    expect(descriptor?.instanceRecord?.instanceId).toBe('netease:imported-a');
    expect(descriptor?.workspaceMount.installationId).toBe('installation-netease-imported-a');
    expect(descriptor?.workspaceMount.resolutionSource).toBe('imported-instance');
  });

  it('falls back to builtin instance id when compat runtime exists but no instance is created yet', async () => {
    state.compatRecords = [
      {
        platformId: 'netease',
        contract: createContract('netease', 'Netease'),
        runtime: createRuntime(),
        source: 'platform-pack',
        registeredAtMs: 1,
        metadata: {
          connectorId: 'connector.platform.netease',
        },
      },
    ];

    const runtimeDescriptor = await import('./platformRuntimeDescriptor');

    expect(
      runtimeDescriptor.resolveDefaultPlatformInstanceIdForConnector(
        'connector.platform.netease'
      )
    ).toBe('netease:builtin');
  });

  it('prefers the pack workspace path in auto mode once netease workspace readiness is green', async () => {
    state.connectorDefinitions = [
      {
        connectorId: 'connector.platform.netease',
        displayName: 'Netease',
        labelKey: 'netease',
        iconKey: 'netease',
        enabled: true,
        authFlow: 'qr',
        workspaceKind: 'netease',
        workspaceMode: 'dedicated',
        sortOrder: 20,
        source: 'pack',
      },
    ];
    state.packRegistrations = [
      {
        connectorId: 'connector.platform.netease',
        platformId: 'netease',
        definition: state.connectorDefinitions[0],
      },
    ];
    state.compatRecords = [
      {
        platformId: 'netease',
        contract: createContract('netease', 'Netease'),
        runtime: createRuntime(),
        source: 'platform-pack',
        registeredAtMs: 1,
        metadata: {
          connectorId: 'connector.platform.netease',
        },
      },
    ];
    state.instances = [
      createInstanceRecord({
        instanceId: 'netease:builtin',
        platformId: 'netease',
        connectorId: 'connector.platform.netease',
        displayName: 'Netease Builtin',
        authStatus: 'authorized',
        updatedAtMs: 5,
      }),
    ];
    state.workspaceOwnershipModes['connector.platform.netease'] = 'auto';
    state.packWorkspaceReadyConnectorIds = ['connector.platform.netease'];

    const runtimeDescriptor = await import('./platformRuntimeDescriptor');
    const descriptor =
      runtimeDescriptor.resolvePreferredPlatformRuntimeDescriptorForConnector(
        'connector.platform.netease'
      );

    expect(descriptor?.workspaceRouting.ownershipMode).toBe('auto');
    expect(descriptor?.workspaceRouting.path).toBe('pack');
    expect(descriptor?.workspaceRouting.status).toBe('active');
    expect(descriptor?.workspaceRouting.usesLegacyHostWorkspace).toBe(false);
    expect(descriptor?.workspaceRouting.packWorkspaceReady).toBe(true);
    expect(descriptor?.workspaceRouting.fallbackReasonCode).toBeNull();
  });

  it('blocks pack mode when pack-owned workspace is not ready', async () => {
    state.connectorDefinitions = [
      {
        connectorId: 'connector.platform.netease',
        displayName: 'Netease',
        labelKey: 'netease',
        iconKey: 'netease',
        enabled: true,
        authFlow: 'qr',
        workspaceKind: 'netease',
        workspaceMode: 'dedicated',
        sortOrder: 20,
        source: 'pack',
      },
    ];
    state.packRegistrations = [
      {
        connectorId: 'connector.platform.netease',
        platformId: 'netease',
        definition: state.connectorDefinitions[0],
      },
    ];
    state.workspaceOwnershipModes['connector.platform.netease'] = 'pack';

    const runtimeDescriptor = await import('./platformRuntimeDescriptor');
    const routing =
      runtimeDescriptor.resolvePlatformWorkspaceRoutingForConnector(
        'connector.platform.netease'
      );

    expect(routing?.ownershipMode).toBe('pack');
    expect(routing?.path).toBe('none');
    expect(routing?.status).toBe('blocked');
    expect(routing?.fallbackReasonCode).toBe('workspace.pack-root.missing');
  });

  it('keeps pack mode active instead of blocking once pack-owned workspace readiness is green', async () => {
    state.connectorDefinitions = [
      {
        connectorId: 'connector.platform.netease',
        displayName: 'Netease',
        labelKey: 'netease',
        iconKey: 'netease',
        enabled: true,
        authFlow: 'qr',
        workspaceKind: 'netease',
        workspaceMode: 'dedicated',
        sortOrder: 20,
        source: 'pack',
      },
    ];
    state.packRegistrations = [
      {
        connectorId: 'connector.platform.netease',
        platformId: 'netease',
        definition: state.connectorDefinitions[0],
      },
    ];
    state.workspaceOwnershipModes['connector.platform.netease'] = 'pack';
    state.packWorkspaceReadyConnectorIds = ['connector.platform.netease'];

    const runtimeDescriptor = await import('./platformRuntimeDescriptor');
    const routing =
      runtimeDescriptor.resolvePlatformWorkspaceRoutingForConnector(
        'connector.platform.netease'
      );

    expect(routing?.ownershipMode).toBe('pack');
    expect(routing?.path).toBe('pack');
    expect(routing?.status).toBe('active');
    expect(routing?.usesLegacyHostWorkspace).toBe(false);
    expect(routing?.packWorkspaceReady).toBe(true);
    expect(routing?.fallbackReasonCode).toBeNull();
  });
});
