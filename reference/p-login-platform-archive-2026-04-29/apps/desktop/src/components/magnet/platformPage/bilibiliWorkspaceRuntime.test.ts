import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  listBilibiliWorkspaceFolders,
  listBilibiliWorkspacePlaybackQualities,
  listBilibiliWorkspaceRecommendedResources,
  prepareBilibiliWorkspacePlayback,
  resolveBilibiliWorkspaceCoverAssetUrl,
  resolveBilibiliWorkspaceLyricLocator,
  searchBilibiliWorkspaceResourceByBvid,
  searchBilibiliWorkspaceResources,
} from './bilibiliWorkspaceRuntime';
import {
  listPlatformWorkspaceCollections,
  listPlatformWorkspaceQualityOptions,
  listPlatformWorkspaceRecommendedResources,
  preparePlatformWorkspacePlayback,
  resolvePlatformWorkspaceCoverAssetUrl,
  resolvePlatformWorkspaceLyricLocator,
  resolvePlatformWorkspaceResource,
  searchPlatformWorkspaceResources,
} from '../../../modules/music-platform';

vi.mock('../../../modules/music-platform', async () => {
  const actual = await vi.importActual<typeof import('../../../modules/music-platform')>(
    '../../../modules/music-platform'
  );
  return {
    ...actual,
    listPlatformWorkspaceCollections: vi.fn(),
    listPlatformWorkspaceQualityOptions: vi.fn(),
    listPlatformWorkspaceRecommendedResources: vi.fn(),
    preparePlatformWorkspacePlayback: vi.fn(),
    resolvePlatformWorkspaceCoverAssetUrl: vi.fn(),
    resolvePlatformWorkspaceLyricLocator: vi.fn(),
    resolvePlatformWorkspaceResource: vi.fn(),
    searchPlatformWorkspaceResources: vi.fn(),
  };
});

const listCollectionsMock = vi.mocked(listPlatformWorkspaceCollections);
const listRecommendedResourcesMock = vi.mocked(listPlatformWorkspaceRecommendedResources);
const searchResourcesMock = vi.mocked(searchPlatformWorkspaceResources);
const resolveResourceMock = vi.mocked(resolvePlatformWorkspaceResource);
const preparePlaybackMock = vi.mocked(preparePlatformWorkspacePlayback);
const listQualityOptionsMock = vi.mocked(listPlatformWorkspaceQualityOptions);
const resolveLyricMock = vi.mocked(resolvePlatformWorkspaceLyricLocator);
const resolveCoverAssetUrlMock = vi.mocked(resolvePlatformWorkspaceCoverAssetUrl);

const target = {
  connectorId: ' Connector.Platform.Bilibili ',
  displayName: 'Bilibili',
  instanceId: 'bilibili:main',
};

describe('bilibiliWorkspaceRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps folder and recommended resource data through generic workspace facade', async () => {
    listCollectionsMock.mockResolvedValue([
      {
        collectionId: 'folder-1',
        title: 'Favorites',
        trackCount: 42,
        coverUrl: 'https://example.test/folder-cover.jpg',
        updatedAtMs: 1710000000000,
      },
    ]);
    listRecommendedResourcesMock.mockResolvedValue({
      sourceKind: 'recommended',
      sourceId: 'unknown',
      pageNum: 1,
      pageSize: 20,
      total: 1,
      hasMore: false,
      items: [
        {
          resourceId: 'video-1',
          title: 'Video One',
          sourceLocator: 'bilibili://video/BV1xx411c7mD',
          ownerName: 'Uploader A',
          durationSeconds: 128,
          coverUrl: 'https://example.test/video-cover.jpg',
          lyricLocator: 'bili://lyric/1',
          bvid: 'BV1xx411c7mD',
          cid: '100',
          contentKind: 'video',
          webUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
        },
      ],
    });

    const folders = await listBilibiliWorkspaceFolders(target, {
      forceRefresh: true,
    });
    const page = await listBilibiliWorkspaceRecommendedResources(target, {
      forceRefresh: true,
    });

    expect(listCollectionsMock).toHaveBeenCalledWith({
      connectorId: 'connector.platform.bilibili',
      instanceId: 'bilibili:main',
      forceRefresh: true,
    });
    expect(listRecommendedResourcesMock).toHaveBeenCalledWith({
      connectorId: 'connector.platform.bilibili',
      instanceId: 'bilibili:main',
      forceRefresh: true,
    });
    expect(folders).toEqual([
      {
        folderId: 'folder-1',
        title: 'Favorites',
        mediaCount: 42,
        coverUrl: 'https://example.test/folder-cover.jpg',
        updatedAtMs: 1710000000000,
      },
    ]);
    expect(page).toMatchObject({
      folderId: 'recommended',
      pageNum: 1,
      pageSize: 20,
      total: 1,
      hasMore: false,
    });
    expect(page?.items[0]).toMatchObject({
      resourceId: 'video-1',
      title: 'Video One',
      ownerName: 'Uploader A',
      sourceLocator: 'bilibili://video/BV1xx411c7mD',
      webUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
      contentKind: 'video',
    });
  });

  it('maps search and lookup flows without relying on bilibili-specific facade methods', async () => {
    searchResourcesMock.mockResolvedValue({
      sourceKind: 'search',
      sourceId: 'unknown',
      pageNum: 1,
      pageSize: 40,
      total: 1,
      hasMore: false,
      items: [
        {
          resourceId: 'video-2',
          title: 'Lo-fi Mix',
          sourceLocator: 'bilibili://video/BV17x411c7mD',
          artistNames: 'Uploader B',
          contentKind: 'video',
        },
      ],
    });
    resolveResourceMock.mockResolvedValue({
      resourceId: 'video-3',
      title: 'Direct Match',
      sourceLocator: 'bilibili://video/BV18x411c7mD',
      ownerName: 'Uploader C',
      bvid: 'BV18x411c7mD',
      cid: '200',
      contentKind: 'video',
      webUrl: 'https://www.bilibili.com/video/BV18x411c7mD',
    });

    const searchPage = await searchBilibiliWorkspaceResources(target, {
      keyword: ' lo-fi ',
      pageNum: 1,
      pageSize: 40,
      forceRefresh: true,
    });
    const matched = await searchBilibiliWorkspaceResourceByBvid(target, ' BV18x411c7mD ');

    expect(searchResourcesMock).toHaveBeenCalledWith({
      connectorId: 'connector.platform.bilibili',
      keyword: 'lo-fi',
      pageNum: 1,
      pageSize: 40,
      instanceId: 'bilibili:main',
      forceRefresh: true,
    });
    expect(resolveResourceMock).toHaveBeenCalledWith({
      connectorId: 'connector.platform.bilibili',
      query: 'BV18x411c7mD',
      instanceId: 'bilibili:main',
    });
    expect(searchPage?.folderId).toBe('bilibili:search:lo-fi');
    expect(searchPage?.items[0]).toMatchObject({
      resourceId: 'video-2',
      ownerName: 'Uploader B',
      contentKind: 'video',
    });
    expect(matched).toMatchObject({
      resourceId: 'video-3',
      bvid: 'BV18x411c7mD',
      cid: '200',
      webUrl: 'https://www.bilibili.com/video/BV18x411c7mD',
    });
  });

  it('maps playback preparation, quality, lyric and cover resolution through generic workspace operations', async () => {
    preparePlaybackMock.mockResolvedValue({
      sourceLocator: 'bilibili://video/BV19x411c7mD',
      streamUrl: 'https://cdn.example.test/video.flac',
      cachePath: 'C:/cache/video.flac',
      mimeType: 'audio/flac',
      durationSeconds: 321,
      selectedQualityKey: ' Dolby ',
      selectedQualityLabel: 'Dolby Atmos',
      contentKind: 'video',
    });
    listQualityOptionsMock.mockResolvedValue([
      { key: '192k', label: '192K', available: true },
      { key: 'dolby', label: 'Dolby Atmos', available: true },
    ]);
    resolveLyricMock.mockResolvedValue({
      locator: 'file:///lyrics/1.lrc',
      format: 'lrc',
      lang: 'zh-CN',
      sourceKind: 'remote',
    });
    resolveCoverAssetUrlMock.mockResolvedValue('asset://cover/1');

    const prepared = await prepareBilibiliWorkspacePlayback(
      target,
      {
        sourceLocator: 'bilibili://video/BV19x411c7mD',
        resourceId: 'video-19',
        webUrl: 'https://www.bilibili.com/video/BV19x411c7mD',
      },
      {
        qualityHint: ' dolby ',
      }
    );
    const qualities = await listBilibiliWorkspacePlaybackQualities(
      target,
      ' bili://source/19 '
    );
    const lyric = await resolveBilibiliWorkspaceLyricLocator(target, ' bili://lyric/19 ');
    const coverUrl = await resolveBilibiliWorkspaceCoverAssetUrl(
      target,
      ' https://example.test/cover.jpg '
    );

    expect(preparePlaybackMock).toHaveBeenCalledWith({
      connectorId: 'connector.platform.bilibili',
      sourceLocator: 'bilibili://video/BV19x411c7mD',
      qualityHint: 'dolby',
      resourceId: 'video-19',
      webUrl: 'https://www.bilibili.com/video/BV19x411c7mD',
      instanceId: 'bilibili:main',
    });
    expect(listQualityOptionsMock).toHaveBeenCalledWith({
      connectorId: 'connector.platform.bilibili',
      sourceLocator: 'bili://source/19',
      instanceId: 'bilibili:main',
    });
    expect(resolveLyricMock).toHaveBeenCalledWith({
      connectorId: 'connector.platform.bilibili',
      lyricLocator: 'bili://lyric/19',
      instanceId: 'bilibili:main',
    });
    expect(resolveCoverAssetUrlMock).toHaveBeenCalledWith({
      connectorId: 'connector.platform.bilibili',
      coverUrl: 'https://example.test/cover.jpg',
      instanceId: 'bilibili:main',
    });
    expect(prepared).toEqual({
      sourceLocator: 'bilibili://video/BV19x411c7mD',
      streamUrl: 'https://cdn.example.test/video.flac',
      cachePath: 'C:/cache/video.flac',
      mimeType: 'audio/flac',
      durationSeconds: 321,
      contentKind: 'video',
      selectedQualityKey: 'dolby',
      selectedQualityLabel: 'Dolby Atmos',
    });
    expect(qualities).toEqual([
      { key: '192k', label: '192K', available: true },
      { key: 'dolby', label: 'Dolby Atmos', available: true },
    ]);
    expect(lyric).toEqual({
      locator: 'file:///lyrics/1.lrc',
      format: 'lrc',
      lang: 'zh-CN',
      sourceKind: 'remote',
    });
    expect(coverUrl).toBe('asset://cover/1');
  });
});
