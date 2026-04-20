import { beforeEach, describe, expect, it, vi } from 'vitest';

const { callerMock, createCallerMock } = vi.hoisted(() => {
  const callerMock = vi.fn();
  return {
    callerMock,
    createCallerMock: vi.fn(() => callerMock),
  };
});

vi.mock('./connectorAuth', async () => {
  const actual = await vi.importActual<typeof import('./connectorAuth')>('./connectorAuth');
  return {
    ...actual,
    getPlatformConnectorDefinition: vi.fn(() => ({
      displayName: 'Netease Cloud Music',
    })),
  };
});

vi.mock('./platformConnectorFacadeCore', async () => {
  const actual =
    await vi.importActual<typeof import('./platformConnectorFacadeCore')>(
      './platformConnectorFacadeCore'
    );
  return {
    ...actual,
    createPlatformConnectorFacadeCaller: createCallerMock,
  };
});

import {
  getPlatformWorkspacePageModel,
  listPlatformWorkspaceCollectionResources,
  listPlatformWorkspaceQualityState,
  listPlatformWorkspaceRecommendedCollections,
} from './platformWorkspaceFacade';

type FacadeCall = {
  bindingId: string;
  method: string;
  runtimeBucket: string;
  map: (value: unknown) => unknown;
};

describe('platformWorkspaceFacade', () => {
  beforeEach(() => {
    callerMock.mockReset();
    createCallerMock.mockClear();
  });

  it('requests recommended playlists instead of daily resources for recommendation channels', async () => {
    callerMock.mockImplementation(async (options: FacadeCall) => {
      expect(options.bindingId).toBe('host.pmp.platform-instance.recommendations');
      expect(options.method).toBe('listRecommendedPlaylists');
      expect(options.runtimeBucket).toBe('recommendations');

      return options.map({
        items: [
          {
            playlistId: 'daily-mix',
            title: 'Daily Mix',
            trackCount: 12,
            coverUrl: 'https://example.test/cover.jpg',
          },
        ],
      });
    });

    const result = await listPlatformWorkspaceRecommendedCollections({
      connectorId: 'connector.platform.netease',
      instanceId: 'netease:builtin',
      forceRefresh: true,
    });

    expect(createCallerMock).toHaveBeenCalledWith({
      connectorId: 'connector.platform.netease',
      displayName: 'Netease Cloud Music',
    });
    expect(result).toEqual([
      {
        collectionId: 'daily-mix',
        title: 'Daily Mix',
        trackCount: 12,
        coverUrl: 'https://example.test/cover.jpg',
        updatedAtMs: undefined,
      },
    ]);
  });

  it('normalizes provider-shaped resource pages, quality state, and page model', async () => {
    callerMock.mockImplementation(async (options: FacadeCall) => {
      if (options.method === 'listPlaylistTracks') {
        return options.map({
          data: {
            songs: [
              {
                id: 'song-1',
                name: 'Song One',
                locator: 'netease://song/1',
                artists: [{ name: 'Artist A' }, { name: 'Artist B' }],
                albumTitle: 'Album A',
                cover: 'https://example.test/cover.jpg',
                durationMs: 90000,
                pageUrl: 'https://example.test/song/1',
                quality: { key: 'lossless', label: 'Lossless' },
                tags: [{ name: '热门' }, { label: 'HQ' }, { label: 'HQ' }],
                membersOnly: 1,
                kind: 'song',
              },
            ],
            playlistId: 'playlist-1',
            kind: 'playlist',
            pageNum: 2,
            pageSize: 20,
            totalCount: 25,
            hasNext: 1,
          },
        });
      }
      if (options.method === 'listOptions') {
        return options.map({
          data: {
            qualities: [{ code: 'lossless', name: 'Lossless', available: 1 }],
            preferredKey: 'lossless',
            selectedQualityLabel: 'Lossless',
          },
        });
      }
      if (options.method === 'getWorkspaceModel') {
        return options.map({
          capabilities: {
            playlists: true,
            dailyRecommendations: 'true',
            search: 1,
            quality: 0,
          },
          pages: [
            {
              id: 'home',
              type: 'home',
              name: 'Home',
              visible: 1,
            },
          ],
          initialPageId: 'home',
        });
      }
      return undefined;
    });

    const [resourcePage, qualityState, pageModel] = await Promise.all([
      listPlatformWorkspaceCollectionResources({
        connectorId: 'connector.platform.netease',
        collectionId: 'playlist-1',
        instanceId: 'netease:builtin',
      }),
      listPlatformWorkspaceQualityState({
        connectorId: 'connector.platform.netease',
        sourceLocator: 'netease://song/1',
        instanceId: 'netease:builtin',
      }),
      getPlatformWorkspacePageModel({
        connectorId: 'connector.platform.netease',
        instanceId: 'netease:builtin',
      }),
    ]);

    expect(resourcePage).toEqual({
      sourceKind: 'playlist',
      sourceId: 'playlist-1',
      pageNum: 2,
      pageSize: 20,
      total: 25,
      hasMore: true,
      items: [
        {
          resourceId: 'song-1',
          title: 'Song One',
          sourceLocator: 'netease://song/1',
          durationSeconds: 90,
          coverUrl: 'https://example.test/cover.jpg',
          lyricLocator: undefined,
          ownerName: undefined,
          artistNames: 'Artist A / Artist B',
          albumName: 'Album A',
          webUrl: 'https://example.test/song/1',
          vipRequired: true,
          vipLabel: undefined,
          qualityKey: 'lossless',
          qualityLabel: 'Lossless',
          tagLabels: ['热门', 'HQ'],
          bvid: undefined,
          cid: undefined,
          contentKind: 'song',
        },
      ],
    });
    expect(qualityState).toEqual({
      options: [{ key: 'lossless', label: 'Lossless', available: true }],
      currentKey: 'lossless',
      currentLabel: 'Lossless',
    });
    expect(pageModel).toEqual({
      features: {
        collections: true,
        recommendations: true,
        search: true,
        quality: false,
      },
      defaultPageId: 'home',
      pages: [
        {
          pageId: 'home',
          kind: 'home',
          title: 'Home',
          enabled: true,
          subtitle: undefined,
          badgeLabel: undefined,
          iconKey: undefined,
        },
      ],
    });
  });
});
