import { beforeEach, describe, expect, it, vi } from 'vitest';

const musicLibraryMocks = vi.hoisted(() => ({
  listNativeLibraryConnectors: vi.fn(),
  listNativeLibrarySources: vi.fn(),
  queryNativeLibraryTracks: vi.fn(),
}));

const connectorAuthMocks = vi.hoisted(() => ({
  listBuiltinPlatformCompatContractRegistrations: vi.fn(),
}));

vi.mock('../../modules/music-library', () => ({
  listNativeLibraryConnectors: musicLibraryMocks.listNativeLibraryConnectors,
  listNativeLibrarySources: musicLibraryMocks.listNativeLibrarySources,
  queryNativeLibraryTracks: musicLibraryMocks.queryNativeLibraryTracks,
}));

vi.mock('../../modules/music-platform/connectorAuth', () => ({
  listBuiltinPlatformCompatContractRegistrations:
    connectorAuthMocks.listBuiltinPlatformCompatContractRegistrations,
}));

import { listMusicSourceFacadeItems } from './musicSourceFacade';

describe('musicSourceFacade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    musicLibraryMocks.listNativeLibrarySources.mockResolvedValue([]);
    musicLibraryMocks.queryNativeLibraryTracks.mockResolvedValue([]);
  });

  it('derives platform capabilities from compat contracts instead of driver names', async () => {
    musicLibraryMocks.listNativeLibraryConnectors.mockResolvedValue([
      {
        id: 'connector.platform.videohub',
        kind: 'platform',
        driver: 'custom-pack-runtime',
        displayName: 'VideoHub',
        status: 'active',
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]);
    connectorAuthMocks.listBuiltinPlatformCompatContractRegistrations.mockReturnValue([
      {
        connectorId: 'connector.platform.videohub',
        enabled: true,
        contract: {
          contractVersion: '1.0',
          platform: {
            platformId: 'videohub',
            displayName: 'VideoHub',
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
            playlists: false,
            favorites: true,
            dailyRecommendations: false,
            search: true,
            quality: false,
            navigation: false,
            settings: false,
            pages: false,
          },
          apiBindings: {
            auth: 'host.pmp.connector-auth',
            library: 'host.pmp.platform-instance.library',
            search: 'host.pmp.platform-instance.search',
          },
        },
      },
    ]);

    const items = await listMusicSourceFacadeItems();

    expect(items).toEqual([
      expect.objectContaining({
        sourceId: 'virtual::connector.platform.videohub',
        connectorId: 'connector.platform.videohub',
        kind: 'platform',
        driver: 'custom-pack-runtime',
        capabilities: {
          canSearchTracks: true,
          canSearchAlbums: true,
          canListPlaylists: true,
          canEditPlaylists: false,
          canFetchLyrics: true,
          canFetchCovers: true,
          canResolveStream: true,
          canRunIncrementalSync: false,
        },
      }),
    ]);
  });

  it('keeps a generic platform fallback when compat contracts are unavailable', async () => {
    musicLibraryMocks.listNativeLibraryConnectors.mockResolvedValue([
      {
        id: 'connector.platform.unknown',
        kind: 'platform',
        driver: 'opaque-runtime',
        displayName: 'Opaque Runtime',
        status: 'active',
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]);
    connectorAuthMocks.listBuiltinPlatformCompatContractRegistrations.mockImplementation(() => {
      throw new Error('registry not ready');
    });

    const items = await listMusicSourceFacadeItems();

    expect(items).toEqual([
      expect.objectContaining({
        sourceId: 'virtual::connector.platform.unknown',
        connectorId: 'connector.platform.unknown',
        capabilities: {
          canSearchTracks: true,
          canSearchAlbums: true,
          canListPlaylists: true,
          canEditPlaylists: true,
          canFetchLyrics: true,
          canFetchCovers: true,
          canResolveStream: true,
          canRunIncrementalSync: false,
        },
      }),
    ]);
  });
});
