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
}));

vi.mock('./connectorAuth', () => ({
  listPlatformConnectorDefinitions: () => state.connectorDefinitions,
}));

vi.mock('./platformPackRegistry', () => ({
  listPlatformPackRegistrations: () => state.packRegistrations,
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

    const runtimeDescriptor = await import('./platformRuntimeDescriptor');
    const descriptor =
      runtimeDescriptor.resolvePreferredPlatformRuntimeDescriptorForConnector(
        'connector.platform.netease'
      );

    expect(descriptor?.instanceRecord?.instanceId).toBe('netease:builtin');
    expect(descriptor?.authState).toBe('authorized');
    expect(descriptor?.sourceKind).toBe('pack');
    expect(descriptor?.runtime).toBeTruthy();
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
      }),
    ];

    const runtimeDescriptor = await import('./platformRuntimeDescriptor');
    const descriptor =
      runtimeDescriptor.resolvePlatformRuntimeDescriptorByInstanceId('bilibili:custom');

    expect(descriptor?.instanceRecord?.instanceId).toBe('bilibili:custom');
    expect(descriptor?.platformId).toBe('bilibili');
    expect(descriptor?.connectorId).toBe('connector.platform.bilibili');
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
});
