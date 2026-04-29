import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMusicTemplateWorkspaceFallbackModel,
  getMusicTemplatePlaybackQualityState,
  getMusicTemplateWorkspaceModel,
  listMusicTemplateRecommendations,
  mergeMusicTemplateResourcePages,
  normalizeMusicTemplateQualityKey,
  prepareMusicTemplatePlayback,
  resolveMusicTemplateQualityLabelKey,
  resolveMusicTemplateQualityProbeSourceLocator,
  resolveMusicTemplateWorkspaceCapabilities,
  setMusicTemplatePlaybackQualityPreference,
  type MusicTemplateResourceItem,
} from './musicTemplateRuntime';
import {
  listPlatformWorkspaceQualityState,
  getPlatformWorkspacePageModel,
  listPlatformWorkspaceRecommendedCollections,
  listPlatformWorkspaceRecommendedResources,
  preparePlatformWorkspacePlayback,
  setPlatformWorkspaceQualityPreference,
  type PlatformCompatRegistryRecord,
} from '../../../modules/music-platform';

vi.mock('../../../modules/music-platform', async () => {
  const actual = await vi.importActual<typeof import('../../../modules/music-platform')>(
    '../../../modules/music-platform'
  );
  return {
    ...actual,
    listPlatformWorkspaceCollectionResources: vi.fn(),
    listPlatformWorkspaceCollections: vi.fn(),
    getPlatformWorkspacePageModel: vi.fn(),
    listPlatformWorkspaceQualityState: vi.fn(),
    listPlatformWorkspaceRecommendedCollections: vi.fn(),
    listPlatformWorkspaceRecommendedResources: vi.fn(),
    preparePlatformWorkspacePlayback: vi.fn(),
    searchPlatformWorkspaceResources: vi.fn(),
    setPlatformWorkspaceQualityPreference: vi.fn(),
  };
});

const listRecommendedCollectionsMock = vi.mocked(
  listPlatformWorkspaceRecommendedCollections
);
const listRecommendedResourcesMock = vi.mocked(
  listPlatformWorkspaceRecommendedResources
);
const listQualityStateMock = vi.mocked(listPlatformWorkspaceQualityState);
const getWorkspacePageModelMock = vi.mocked(getPlatformWorkspacePageModel);
const preparePlaybackMock = vi.mocked(preparePlatformWorkspacePlayback);
const setQualityPreferenceMock = vi.mocked(
  setPlatformWorkspaceQualityPreference
);

function createContractRecord(capabilities: {
  playlists: boolean;
  dailyRecommendations: boolean;
  search: boolean;
  quality: boolean;
  pages: boolean;
}): PlatformCompatRegistryRecord {
  return {
    platformId: 'test-platform',
    contract: {
      contractVersion: '1.0',
      platform: {
        platformId: 'test-platform',
        displayName: 'Test Platform',
        staticIcon: 'test',
        supportsMultiInstance: false,
      },
      auth: {
        loginMode: 'cookie',
        requiresCookie: true,
        requiresAccountId: false,
        supportsRefresh: true,
      },
      capabilities: {
        playlists: capabilities.playlists,
        favorites: false,
        dailyRecommendations: capabilities.dailyRecommendations,
        search: capabilities.search,
        quality: capabilities.quality,
        navigation: false,
        settings: false,
        pages: capabilities.pages,
      },
      apiBindings: {
        auth: 'host.pmp.connector-auth',
      },
    },
    runtime: {},
    source: 'test',
    registeredAtMs: 0,
  };
}

describe('musicTemplateRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps recommendation page and collection data from workspace facade', async () => {
    const target = {
      connectorId: 'connector.platform.netease',
      displayName: 'NetEase',
      instanceId: 'netease:default',
    };

    listRecommendedResourcesMock.mockResolvedValue({
      sourceKind: 'recommended',
      sourceId: 'daily',
      pageNum: 1,
      pageSize: 20,
      total: 1,
      hasMore: false,
      items: [
        {
          resourceId: 'song-1',
          title: 'Song One',
          sourceLocator: 'netease://song/1',
          artistNames: 'Artist A',
          albumName: 'Album A',
          durationSeconds: 123,
          coverUrl: 'https://example.test/cover.jpg',
          webUrl: 'https://example.test/song-1',
          qualityKey: 'exhigh',
          qualityLabel: '320K',
          vipRequired: true,
          vipLabel: 'VIP',
          tagLabels: ['热门', 'HQ'],
        },
      ],
    });
    listRecommendedCollectionsMock.mockResolvedValue([
      {
        collectionId: 'playlist-1',
        title: 'Daily Mix',
        trackCount: 12,
        coverUrl: 'https://example.test/playlist-cover.jpg',
        updatedAtMs: 1710000000000,
      },
    ]);

    const result = await listMusicTemplateRecommendations(target, {
      forceRefresh: true,
    });

    expect(listRecommendedResourcesMock).toHaveBeenCalledWith({
      connectorId: 'connector.platform.netease',
      instanceId: 'netease:default',
      forceRefresh: true,
    });
    expect(listRecommendedCollectionsMock).toHaveBeenCalledWith({
      connectorId: 'connector.platform.netease',
      instanceId: 'netease:default',
      forceRefresh: true,
    });
    expect(result.page?.items[0]).toMatchObject({
      resourceId: 'song-1',
      title: 'Song One',
      artistNames: 'Artist A',
      albumName: 'Album A',
      sourceLocator: 'netease://song/1',
      webUrl: 'https://example.test/song-1',
      qualityKey: 'exhigh',
      qualityLabel: '320K',
      vipRequired: true,
      vipLabel: 'VIP',
      tagLabels: ['热门', 'HQ'],
    });
    expect(result.collections[0]).toMatchObject({
      collectionId: 'playlist-1',
      title: 'Daily Mix',
      trackCount: 12,
    });
  });

  it('prefers workspace page model features and falls back to contract capabilities', async () => {
    const target = {
      connectorId: 'connector.platform.netease',
      displayName: 'NetEase',
      instanceId: 'netease:default',
    };

    getWorkspacePageModelMock.mockResolvedValueOnce({
      features: {
        collections: true,
        recommendations: false,
        search: true,
        quality: false,
      },
      defaultPageId: 'search',
      pages: [
        {
          pageId: 'search',
          kind: 'search',
          title: 'Search',
          enabled: true,
        },
      ],
    });

    const fromPageModel = await getMusicTemplateWorkspaceModel(target, {
      contractRecord: createContractRecord({
        playlists: false,
        dailyRecommendations: true,
        search: false,
        quality: true,
        pages: true,
      }),
    });

    getWorkspacePageModelMock.mockRejectedValueOnce(new Error('pages unavailable'));

    const fromFallback = await getMusicTemplateWorkspaceModel(target, {
      contractRecord: createContractRecord({
        playlists: true,
        dailyRecommendations: true,
        search: false,
        quality: true,
        pages: false,
      }),
    });

    expect(fromPageModel.features).toEqual({
      collections: true,
      recommendations: false,
      search: true,
      quality: false,
    });
    expect(fromPageModel.defaultPageId).toBe('search');
    expect(fromFallback).toEqual(
      createMusicTemplateWorkspaceFallbackModel(
        createContractRecord({
          playlists: true,
          dailyRecommendations: true,
          search: false,
          quality: true,
          pages: false,
        })
      )
    );
  });

  it('derives controller-facing workspace capabilities and helper labels from page model data', () => {
    const capabilities = resolveMusicTemplateWorkspaceCapabilities({
      features: {
        collections: false,
        recommendations: false,
        search: false,
        quality: false,
      },
      defaultPageId: 'search',
      pages: [
        {
          pageId: 'library',
          kind: 'playlist',
          title: 'Library',
          enabled: true,
        },
        {
          pageId: 'discover',
          kind: 'daily',
          title: 'Daily',
          enabled: true,
        },
        {
          pageId: 'search',
          kind: 'search',
          title: 'Search',
          enabled: true,
        },
        {
          pageId: 'quality',
          kind: 'quality',
          title: 'Quality',
          enabled: false,
        },
      ],
    });

    expect(capabilities).toEqual({
      collections: true,
      recommendations: true,
      search: true,
      quality: false,
      defaultPageId: 'search',
      enabledPageIds: ['library', 'discover', 'search'],
      enabledPageKinds: ['playlist', 'daily', 'search'],
    });
    expect(normalizeMusicTemplateQualityKey(' 320K ')).toBe('exhigh');
    expect(normalizeMusicTemplateQualityKey('  hi-res-flac  ')).toBe('hi-res-flac');
    expect(resolveMusicTemplateQualityLabelKey('lossless')).toBe(
      'magnet.platform.music-template.quality.option.lossless'
    );
    expect(resolveMusicTemplateQualityLabelKey('hi-res-flac')).toBeNull();
    expect(
      resolveMusicTemplateQualityProbeSourceLocator({
        sourceKind: 'search',
        sourceId: 'hello',
        pageNum: 1,
        pageSize: 20,
        total: 2,
        hasMore: false,
        items: [
          {
            resourceId: 'song-empty',
            title: 'Empty Locator',
            sourceLocator: '   ',
          },
          {
            resourceId: 'song-2',
            title: 'Track 2',
            sourceLocator: 'netease://song/2',
          },
        ],
      })
    ).toBe('netease://song/2');
  });

  it('merges resource pages without duplicating items for the same source bucket', () => {
    const merged = mergeMusicTemplateResourcePages(
      {
        sourceKind: 'search',
        sourceId: 'hello',
        pageNum: 1,
        pageSize: 20,
        total: 3,
        hasMore: true,
        items: [
          {
            resourceId: 'song-1',
            title: 'Track 1',
            sourceLocator: 'netease://song/1',
          },
        ],
      },
      {
        sourceKind: 'search',
        sourceId: 'hello',
        pageNum: 2,
        pageSize: 20,
        total: 3,
        hasMore: false,
        items: [
          {
            resourceId: 'song-1',
            title: 'Track 1 duplicate',
            sourceLocator: 'netease://song/1',
          },
          {
            resourceId: 'song-2',
            title: 'Track 2',
            sourceLocator: 'netease://song/2',
          },
        ],
      }
    );

    expect(merged.items.map((item) => item.resourceId)).toEqual(['song-1', 'song-2']);
    expect(merged.pageNum).toBe(2);
    expect(merged.hasMore).toBe(false);
  });

  it('maps playback quality state and applies quality preference through workspace facade', async () => {
    const target = {
      connectorId: 'connector.platform.qqmusic',
      displayName: 'QQ Music',
      instanceId: 'qqmusic:main',
    };

    listQualityStateMock.mockResolvedValue({
      options: [{ key: 'lossless', label: 'Lossless', available: true }],
      currentKey: '',
      currentLabel: '',
    });
    setQualityPreferenceMock.mockResolvedValue({
      options: [
        { key: 'auto', label: 'Auto', available: true },
        { key: 'exhigh', label: '320K', available: true },
      ],
      currentKey: 'exhigh',
      currentLabel: '320K',
    });

    const qualityState = await getMusicTemplatePlaybackQualityState(target, {
      sourceLocator: ' qq://song/1 ',
      forceRefresh: true,
    });
    const nextState = await setMusicTemplatePlaybackQualityPreference(
      target,
      'exhigh',
      {
        sourceLocator: ' qq://song/1 ',
      }
    );

    expect(listQualityStateMock).toHaveBeenCalledWith({
      connectorId: 'connector.platform.qqmusic',
      sourceLocator: 'qq://song/1',
      instanceId: 'qqmusic:main',
      forceRefresh: true,
    });
    expect(setQualityPreferenceMock).toHaveBeenCalledWith({
      connectorId: 'connector.platform.qqmusic',
      qualityKey: 'exhigh',
      sourceLocator: 'qq://song/1',
      instanceId: 'qqmusic:main',
    });
    expect(qualityState).toEqual({
      options: [{ key: 'lossless', label: 'Lossless', available: true }],
      currentKey: 'lossless',
      currentLabel: undefined,
    });
    expect(nextState).toEqual({
      options: [
        { key: 'auto', label: 'Auto', available: true },
        { key: 'exhigh', label: '320K', available: true },
      ],
      currentKey: 'exhigh',
      currentLabel: '320K',
    });
  });

  it('preserves runtime-defined quality keys instead of collapsing them to host presets', async () => {
    const target = {
      connectorId: 'connector.platform.qqmusic',
      displayName: 'QQ Music',
      instanceId: 'qqmusic:main',
    };

    setQualityPreferenceMock.mockResolvedValue({
      options: [{ key: 'hi-res-flac', label: 'Hi-Res FLAC', available: true }],
      currentKey: 'hi-res-flac',
      currentLabel: 'Hi-Res FLAC',
    });

    const nextState = await setMusicTemplatePlaybackQualityPreference(target, ' hi-res-flac ', {
      sourceLocator: ' qq://song/1 ',
    });

    expect(setQualityPreferenceMock).toHaveBeenCalledWith({
      connectorId: 'connector.platform.qqmusic',
      qualityKey: 'hi-res-flac',
      sourceLocator: 'qq://song/1',
      instanceId: 'qqmusic:main',
    });
    expect(nextState).toEqual({
      options: [{ key: 'hi-res-flac', label: 'Hi-Res FLAC', available: true }],
      currentKey: 'hi-res-flac',
      currentLabel: 'Hi-Res FLAC',
    });
  });

  it('prepares playback via workspace facade with normalized connector and payload', async () => {
    const target = {
      connectorId: '  Connector.Platform.AppleMusic  ',
      displayName: 'Apple Music',
      instanceId: 'apple:default',
    };
    const item: MusicTemplateResourceItem = {
      resourceId: 'song-88',
      title: 'Track 88',
      artistNames: 'Artist 88',
      sourceLocator: 'apple://song/88',
      webUrl: 'https://music.apple.com/track/88',
    };

    preparePlaybackMock.mockResolvedValue({
      sourceLocator: 'apple://song/88',
      streamUrl: 'https://cdn.example.test/stream.m4a',
      cachePath: 'C:/cache/song-88.m4a',
      mimeType: 'audio/mp4',
      durationSeconds: 248,
      resourceId: 'song-88',
      selectedQualityKey: 'lossless',
      selectedQualityLabel: 'Lossless',
    });

    const prepared = await prepareMusicTemplatePlayback(target, item, {
      qualityHint: ' lossless ',
    });

    expect(preparePlaybackMock).toHaveBeenCalledWith({
      connectorId: 'connector.platform.applemusic',
      sourceLocator: 'apple://song/88',
      qualityHint: 'lossless',
      resourceId: 'song-88',
      webUrl: 'https://music.apple.com/track/88',
      instanceId: 'apple:default',
    });
    expect(prepared).toEqual({
      sourceLocator: 'apple://song/88',
      streamUrl: 'https://cdn.example.test/stream.m4a',
      cachePath: 'C:/cache/song-88.m4a',
      mimeType: 'audio/mp4',
      durationSeconds: 248,
      resourceId: 'song-88',
      selectedQualityKey: 'lossless',
      selectedQualityLabel: 'Lossless',
    });
  });
});
