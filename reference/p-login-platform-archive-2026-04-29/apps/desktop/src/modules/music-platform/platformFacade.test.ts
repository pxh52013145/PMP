import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  activeCurrentInstanceId: null as string | null,
  activeConnectorInstanceIds: {} as Record<string, string>,
  authSnapshots: [] as Array<Record<string, unknown>>,
  sourceItems: [] as Array<Record<string, unknown>>,
  descriptors: [] as Array<{
    connectorId: string;
    instanceRecord?: { instanceId?: string; [key: string]: unknown } | null;
    [key: string]: unknown;
  }>,
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

vi.mock('./platformInstanceAuth', () => ({
  listPlatformInstanceAuthSnapshots: async () => state.authSnapshots,
}));

vi.mock('../../services/audio/musicSourceFacade', () => ({
  listMusicSourceFacadeItems: async () => state.sourceItems,
  searchMusicSourceTracks: async () => [],
}));

vi.mock('./connectorAuth', () => ({
  listPlatformConnectorDefinitions: () => [],
}));

vi.mock('./bindingRuntime', () => ({
  invokePlatformRuntimeBinding: vi.fn(),
}));

vi.mock('./platformInstanceApiBinding', () => ({
  PLATFORM_LIBRARY_BINDING_ID: 'host.pmp.platform-instance.library',
  PLATFORM_SEARCH_BINDING_ID: 'host.pmp.platform-instance.search',
}));

vi.mock('./platformRuntimeDescriptor', () => ({
  listPlatformRuntimeDescriptors: () => state.descriptors,
  resolvePreferredPlatformRuntimeDescriptorForConnector: (connectorId: string) =>
    state.descriptors.find((descriptor) => descriptor.connectorId === connectorId) ?? null,
  resolvePlatformRuntimeDescriptorByInstanceId: (instanceId: string) =>
    state.descriptors.find(
      (descriptor) => descriptor.instanceRecord?.instanceId === instanceId
    ) ?? null,
}));

describe('platformFacade', () => {
  beforeEach(() => {
    vi.resetModules();
    state.activeCurrentInstanceId = null;
    state.activeConnectorInstanceIds = {};
    state.authSnapshots = [];
    state.sourceItems = [];
    state.descriptors = [];
  });

  it('keeps connector facade auth/account state pinned to the active instance for same-connector multi-instance setups', async () => {
    state.activeCurrentInstanceId = 'netease:imported-a';
    state.activeConnectorInstanceIds['connector.platform.netease'] = 'netease:imported-a';
    state.authSnapshots = [
      {
        instanceId: 'netease:builtin',
        platformId: 'netease',
        connectorId: 'connector.platform.netease',
        displayName: 'Netease Builtin',
        authState: 'authorized',
        accountUid: 'builtin-user',
        updatedAtMs: 200,
      },
      {
        instanceId: 'netease:imported-a',
        platformId: 'netease',
        connectorId: 'connector.platform.netease',
        displayName: 'Netease Imported A',
        authState: 'unauthorized',
        accountUid: 'imported-user',
        updatedAtMs: 100,
      },
    ];
    state.sourceItems = [
      {
        kind: 'platform',
        connectorId: 'connector.platform.netease',
        sourceId: 'platform.netease.library',
        displayName: 'Netease Source',
        capabilities: {
          canSearchTracks: true,
          canSearchAlbums: false,
          canListPlaylists: true,
          canEditPlaylists: false,
          canFetchLyrics: false,
          canFetchCovers: true,
          canResolveStream: true,
          canRunIncrementalSync: false,
        },
      },
    ];
    state.descriptors = [
      {
        connectorId: 'connector.platform.netease',
        platformId: 'netease',
        displayName: 'Netease Builtin',
        authState: 'authorized',
        availability: 'available',
        availabilityMessage: undefined,
        instanceRecord: {
          instanceId: 'netease:builtin',
          account: {
            accountId: 'builtin-user',
          },
          auth: {
            cookieUpdatedAtMs: 200,
          },
          metadata: {},
        },
      },
    ];

    const facade = await import('./platformFacade');
    const views = await facade.listPlatformConnectorFacadeItems();

    expect(views).toHaveLength(1);
    expect(views[0]).toEqual(
      expect.objectContaining({
        connectorId: 'connector.platform.netease',
        instanceId: 'netease:imported-a',
        displayName: 'Netease Imported A',
        authState: 'unauthorized',
        accountUid: 'imported-user',
        sourceIds: ['platform.netease.library'],
      })
    );
    expect(views[0]?.accountUid).not.toBe('builtin-user');
  });
});
