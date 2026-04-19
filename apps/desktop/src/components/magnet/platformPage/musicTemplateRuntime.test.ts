import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getMusicTemplatePlaybackQualityState,
  listMusicTemplateRecommendations,
  prepareMusicTemplatePlayback,
  setMusicTemplatePlaybackQualityPreference,
  type MusicTemplateResourceItem,
} from './musicTemplateRuntime';
import {
  listPlatformWorkspaceQualityState,
  listPlatformWorkspaceRecommendedCollections,
  listPlatformWorkspaceRecommendedResources,
  preparePlatformWorkspacePlayback,
  setPlatformWorkspaceQualityPreference,
} from '../../../modules/music-platform';

vi.mock('../../../modules/music-platform', () => ({
  listPlatformWorkspaceCollectionResources: vi.fn(),
  listPlatformWorkspaceCollections: vi.fn(),
  listPlatformWorkspaceQualityState: vi.fn(),
  listPlatformWorkspaceRecommendedCollections: vi.fn(),
  listPlatformWorkspaceRecommendedResources: vi.fn(),
  preparePlatformWorkspacePlayback: vi.fn(),
  searchPlatformWorkspaceResources: vi.fn(),
  setPlatformWorkspaceQualityPreference: vi.fn(),
}));

const listRecommendedCollectionsMock = vi.mocked(
  listPlatformWorkspaceRecommendedCollections
);
const listRecommendedResourcesMock = vi.mocked(
  listPlatformWorkspaceRecommendedResources
);
const listQualityStateMock = vi.mocked(listPlatformWorkspaceQualityState);
const preparePlaybackMock = vi.mocked(preparePlatformWorkspacePlayback);
const setQualityPreferenceMock = vi.mocked(
  setPlatformWorkspaceQualityPreference
);

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
