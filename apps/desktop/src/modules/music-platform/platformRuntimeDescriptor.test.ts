import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PlatformCompatContractFile,
  PlatformCompatRuntimeApi,
  PlatformInstanceRecord,
} from '@pixel-matrix/plugin-platform-contracts';

type ConnectorDefinitionState = Array<Record<string, unknown>>;
type PackRegistrationState = Array<Record<string, unknown>>;
type CompatRecordState = Array<Record<string, unknown>>;

const state = vi.hoisted(() => ({
  connectorDefinitions: [] as ConnectorDefinitionState,
  packRegistrations: [] as PackRegistrationState,
  compatRecords: [] as CompatRecordState,
  instances: [] as PlatformInstanceRecord[],
  importedInstances: [] as Array<Record<string, unknown>>,
  workspaceOwnershipModes: {} as Record<string, 'legacy' | 'pack' | 'auto'>,
  packWorkspaceReadyConnectorIds: [] as string[],
  packWorkspaceReadyInstallationIds: [] as string[],
}));

vi.mock('./connectorAuth', () => ({
  listPlatformConnectorDefinitions: () => state.connectorDefinitions,
}));

vi.mock('./platformPackRegistry', () => ({
  listPlatformPackRegistrations: () => state.packRegistrations,
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
  getPlatformImportedInstanceRecord: (instanceId: string) =>
    state.importedInstances.find((instance) => instance.instanceId === instanceId) ?? null,
}));

function createRuntime(): PlatformCompatRuntimeApi {
  return {
    metadata: {
      source: 'test',
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

describe('platformRuntimeDescriptor', () => {
  beforeEach(() => {
    vi.resetModules();
    state.connectorDefinitions = [];
    state.packRegistrations = [];
    state.compatRecords = [];
    state.instances = [];
    state.importedInstances = [];
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
    expect(descriptor?.workspaceRouting.ownershipMode).toBe('auto');
    expect(descriptor?.workspaceRouting.path).toBe('legacy');
    expect(descriptor?.workspaceRouting.status).toBe('fallback');
    expect(descriptor?.workspaceRouting.fallbackReasonCode).toBe('workspace.pack-root.missing');
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
    state.workspaceOwnershipModes['connector.platform.bilibili'] = 'legacy';
    state.packWorkspaceReadyInstallationIds = ['installation-bilibili-1'];

    const runtimeDescriptor = await import('./platformRuntimeDescriptor');
    const descriptor =
      runtimeDescriptor.resolvePlatformRuntimeDescriptorByInstanceId('bilibili:custom');

    expect(descriptor?.instanceRecord?.instanceId).toBe('bilibili:custom');
    expect(descriptor?.platformId).toBe('bilibili');
    expect(descriptor?.connectorId).toBe('connector.platform.bilibili');
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
    expect(descriptor?.workspaceRouting.packReadiness.source).toBe(
      'installed-pack:test-pack:installation-bilibili-a'
    );
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
