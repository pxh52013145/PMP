import { ConnectorScopedLruTtlCache } from './connectorScopedCache';
import {
  asPlatformFacadeRecord,
  createPlatformConnectorFacadeCaller,
  normalizePlatformFacadeAssetUrl,
  normalizePlatformFacadePositiveInt,
  normalizePlatformFacadeString,
  readPlatformFacadeFiniteNumber,
  resolvePlatformConnectorFacadeCacheScopeKey,
} from './platformConnectorFacadeCore';
import {
  PLATFORM_LIBRARY_BINDING_ID,
  PLATFORM_QUALITY_BINDING_ID,
  PLATFORM_RECOMMENDATIONS_BINDING_ID,
  PLATFORM_SEARCH_BINDING_ID,
} from './platformInstanceApiBinding';
import { BILIBILI_CONNECTOR_ID } from './platformConnectorModel';

export interface BilibiliFavoriteFolderItem {
  folderId: string;
  title: string;
  mediaCount: number;
  coverUrl?: string;
  updatedAtMs?: number;
}

export interface BilibiliFavoriteResourceItem {
  resourceId: string;
  title: string;
  ownerName?: string;
  durationSeconds?: number;
  coverUrl?: string;
  sourceLocator: string;
  lyricLocator?: string;
  bvid?: string;
  cid?: string;
  contentKind: string;
}

export interface BilibiliFavoriteResourcePage {
  folderId: string;
  pageNum: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  items: BilibiliFavoriteResourceItem[];
}

export interface BilibiliLyricLocatorResolved {
  locator: string;
  format: string;
  lang?: string;
  sourceKind: string;
}

export interface BilibiliPreparedPlayback {
  sourceLocator: string;
  streamUrl: string;
  cachePath: string;
  mimeType?: string;
  durationSeconds?: number;
  contentKind: string;
  selectedQualityKey: string;
  selectedQualityLabel: string;
}

export interface BilibiliPlaybackQualityOption {
  key: string;
  label: string;
  available: boolean;
}

type RuntimePreferenceOptions = {
  preferRuntime?: boolean;
};

const BILIBILI_DISPLAY_NAME = 'Bilibili';

const BILIBILI_RESOURCE_BY_BVID_CACHE =
  new ConnectorScopedLruTtlCache<BilibiliFavoriteResourceItem>({
    maxEntriesPerConnector: 160,
    defaultTtlMs: 3 * 60 * 1000,
  });
const BILIBILI_PLAYBACK_QUALITY_CACHE =
  new ConnectorScopedLruTtlCache<BilibiliPlaybackQualityOption[]>({
    maxEntriesPerConnector: 240,
    defaultTtlMs: 90 * 1000,
  });
const BILIBILI_COVER_ASSET_CACHE = new ConnectorScopedLruTtlCache<string>({
  maxEntriesPerConnector: 360,
  defaultTtlMs: 10 * 60 * 1000,
});
const callBilibiliBinding = createPlatformConnectorFacadeCaller({
  connectorId: BILIBILI_CONNECTOR_ID,
  displayName: BILIBILI_DISPLAY_NAME,
});

function resolveBilibiliCacheScopeKey(instanceId?: string | null): string {
  return resolvePlatformConnectorFacadeCacheScopeKey(
    BILIBILI_CONNECTOR_ID,
    instanceId
  );
}

function cloneResourceItem(item: BilibiliFavoriteResourceItem): BilibiliFavoriteResourceItem {
  return {
    resourceId: item.resourceId,
    title: item.title,
    ownerName: item.ownerName,
    durationSeconds: item.durationSeconds,
    coverUrl: item.coverUrl,
    sourceLocator: item.sourceLocator,
    lyricLocator: item.lyricLocator,
    bvid: item.bvid,
    cid: item.cid,
    contentKind: item.contentKind,
  };
}

function clonePlaybackQualityOptions(
  options: BilibiliPlaybackQualityOption[]
): BilibiliPlaybackQualityOption[] {
  return options.map((item) => ({
    key: item.key,
    label: item.label,
    available: item.available,
  }));
}

function mapRuntimeFavoriteFolderItem(value: unknown): BilibiliFavoriteFolderItem | null {
  const record = asPlatformFacadeRecord(value);
  if (!record) return null;

  const folderId =
    normalizePlatformFacadeString(record.collectionId) ||
    normalizePlatformFacadeString(record.folderId);
  const title = normalizePlatformFacadeString(record.title);
  if (!folderId || !title) return null;

  return {
    folderId,
    title,
    mediaCount: normalizePlatformFacadePositiveInt(record.trackCount ?? record.mediaCount),
    coverUrl: normalizePlatformFacadeString(record.coverUrl) || undefined,
    updatedAtMs: readPlatformFacadeFiniteNumber(record.updatedAtMs),
  };
}

function mapRuntimeFavoriteResourceItem(value: unknown): BilibiliFavoriteResourceItem | null {
  const record = asPlatformFacadeRecord(value);
  if (!record) return null;

  const resourceId =
    normalizePlatformFacadeString(record.resourceId) ||
    normalizePlatformFacadeString(record.songId);
  const title = normalizePlatformFacadeString(record.title);
  const sourceLocator = normalizePlatformFacadeString(record.sourceLocator);
  if (!resourceId || !title || !sourceLocator) return null;

  return {
    resourceId,
    title,
    ownerName:
      normalizePlatformFacadeString(record.ownerName ?? record.artistNames) || undefined,
    durationSeconds: readPlatformFacadeFiniteNumber(record.durationSeconds),
    coverUrl: normalizePlatformFacadeString(record.coverUrl) || undefined,
    sourceLocator,
    lyricLocator: normalizePlatformFacadeString(record.lyricLocator) || undefined,
    bvid: normalizePlatformFacadeString(record.bvid) || undefined,
    cid: normalizePlatformFacadeString(record.cid) || undefined,
    contentKind: normalizePlatformFacadeString(record.contentKind) || 'unknown',
  };
}

function mapRuntimeFavoriteResourcePage(value: unknown): BilibiliFavoriteResourcePage | null | undefined {
  if (value === null) return null;

  const record = asPlatformFacadeRecord(value);
  if (!record) return undefined;
  if (!Array.isArray(record.items)) return undefined;

  const items = record.items
    .map(mapRuntimeFavoriteResourceItem)
    .filter((item): item is BilibiliFavoriteResourceItem => Boolean(item));

  const pageNum = normalizePlatformFacadePositiveInt(record.pageNum) || 1;
  const pageSize =
    normalizePlatformFacadePositiveInt(record.pageSize) ||
    Math.max(
      1,
      items.length || normalizePlatformFacadePositiveInt(record.total)
    );
  const total = normalizePlatformFacadePositiveInt(record.total);
  const folderId =
    normalizePlatformFacadeString(record.folderId) ||
    normalizePlatformFacadeString(record.sourceId) ||
    normalizePlatformFacadeString(record.collectionId) ||
    'default';

  return {
    folderId,
    pageNum,
    pageSize,
    total,
    hasMore: record.hasMore === true,
    items,
  };
}

function mapRuntimePlayback(value: unknown): BilibiliPreparedPlayback | null | undefined {
  if (value === null) return null;

  const record = asPlatformFacadeRecord(value);
  if (!record) return undefined;

  const sourceLocator = normalizePlatformFacadeString(record.sourceLocator);
  const streamUrl = normalizePlatformFacadeString(record.streamUrl);
  const cachePath = normalizePlatformFacadeString(record.cachePath);
  const selectedQualityKey = normalizePlatformFacadeString(record.selectedQualityKey);
  const selectedQualityLabel = normalizePlatformFacadeString(record.selectedQualityLabel);
  if (!sourceLocator || !streamUrl || !cachePath || !selectedQualityKey || !selectedQualityLabel) {
    return undefined;
  }

  return {
    sourceLocator,
    streamUrl,
    cachePath,
    mimeType: normalizePlatformFacadeString(record.mimeType) || undefined,
    durationSeconds: readPlatformFacadeFiniteNumber(record.durationSeconds),
    contentKind: normalizePlatformFacadeString(record.contentKind) || 'unknown',
    selectedQualityKey,
    selectedQualityLabel,
  };
}

function mapRuntimePlaybackQualityOptions(
  value: unknown
): BilibiliPlaybackQualityOption[] | undefined {
  const record = asPlatformFacadeRecord(value);
  if (!record || !Array.isArray(record.options)) return undefined;

  return record.options
    .map((item) => {
      const optionRecord = asPlatformFacadeRecord(item);
      if (!optionRecord) return null;
      const key = normalizePlatformFacadeString(optionRecord.key);
      const label = normalizePlatformFacadeString(optionRecord.label) || key;
      if (!key) return null;
      return {
        key,
        label,
        available: optionRecord.available !== false,
      };
    })
    .filter((item): item is BilibiliPlaybackQualityOption => Boolean(item));
}

function mapRuntimeCoverAssetUrl(value: unknown): string | undefined {
  const direct = normalizePlatformFacadeString(value);
  if (direct) return direct;

  const record = asPlatformFacadeRecord(value);
  if (!record) return undefined;

  return (
    normalizePlatformFacadeString(record.assetUrl) ||
    normalizePlatformFacadeString(record.cachePath) ||
    normalizePlatformFacadeString(record.path) ||
    normalizePlatformFacadeString(record.url) ||
    undefined
  );
}

export async function listBilibiliFavoriteFolders(
  instanceId?: string | null,
  runtimeOptions?: RuntimePreferenceOptions
): Promise<BilibiliFavoriteFolderItem[]> {
  void runtimeOptions;
  return callBilibiliBinding<BilibiliFavoriteFolderItem[]>({
    instanceId,
    bindingId: PLATFORM_LIBRARY_BINDING_ID,
    method: 'listCollections',
    runtimeBucket: 'library',
    map: (value) => {
      const record = asPlatformFacadeRecord(value);
      if (!record || !Array.isArray(record.items)) return undefined;
      return record.items
        .map(mapRuntimeFavoriteFolderItem)
        .filter((item): item is BilibiliFavoriteFolderItem => Boolean(item));
    },
  });
}

export async function listBilibiliFavoriteResources(options: {
  folderId: string;
  pageNum?: number;
  pageSize?: number;
  instanceId?: string | null;
  preferRuntime?: boolean;
}): Promise<BilibiliFavoriteResourcePage | null> {
  void options.preferRuntime;
  const folderId = normalizePlatformFacadeString(options.folderId);
  if (!folderId) return null;

  return callBilibiliBinding<BilibiliFavoriteResourcePage | null>({
    instanceId: options.instanceId,
    bindingId: PLATFORM_LIBRARY_BINDING_ID,
    method: 'listPlaylistTracks',
    payload: {
      collectionId: folderId,
      playlistId: folderId,
      folderId,
      pageNum: options.pageNum,
      pageSize: options.pageSize,
    },
    runtimeBucket: 'library',
    runtimeMethods: ['listPlaylistTracks', 'listResources'],
    map: mapRuntimeFavoriteResourcePage,
  });
}

export async function listBilibiliRecommendedResources(
  instanceId?: string | null,
  runtimeOptions?: RuntimePreferenceOptions
): Promise<BilibiliFavoriteResourcePage | null> {
  void runtimeOptions;
  return callBilibiliBinding<BilibiliFavoriteResourcePage | null>({
    instanceId,
    bindingId: PLATFORM_RECOMMENDATIONS_BINDING_ID,
    method: 'listDaily',
    runtimeBucket: 'recommendations',
    map: (value) => {
      if (value === null) return null;
      const record = asPlatformFacadeRecord(value);
      const page = mapRuntimeFavoriteResourcePage(
        record
          ? {
              folderId: 'recommended',
              pageNum: normalizePlatformFacadePositiveInt(record.pageNum) || 1,
              pageSize:
                normalizePlatformFacadePositiveInt(record.pageSize) ||
                Math.max(1, Array.isArray(record.items) ? record.items.length : 0),
              total: normalizePlatformFacadePositiveInt(record.total),
              hasMore: record.hasMore === true,
              items: Array.isArray(record.items) ? record.items : [],
            }
          : value
      );
      if (!page) return page;
      return {
        ...page,
        folderId: page.folderId || 'recommended',
      };
    },
  });
}

export async function searchBilibiliResources(options: {
  keyword: string;
  pageNum?: number;
  pageSize?: number;
  instanceId?: string | null;
  preferRuntime?: boolean;
}): Promise<BilibiliFavoriteResourcePage | null> {
  void options.preferRuntime;
  const keyword = normalizePlatformFacadeString(options.keyword);
  if (!keyword) return null;

  return callBilibiliBinding<BilibiliFavoriteResourcePage | null>({
    instanceId: options.instanceId,
    bindingId: PLATFORM_SEARCH_BINDING_ID,
    method: 'query',
    payload: {
      keyword,
      query: keyword,
      pageNum: options.pageNum,
      pageSize: options.pageSize,
    },
    runtimeBucket: 'search',
    map: mapRuntimeFavoriteResourcePage,
  });
}

export async function searchBilibiliResourceByBvid(
  bvid: string,
  instanceId?: string | null,
  runtimeOptions?: RuntimePreferenceOptions
): Promise<BilibiliFavoriteResourceItem | null> {
  void runtimeOptions;
  const normalizedBvid = normalizePlatformFacadeString(bvid);
  if (!normalizedBvid) return null;
  const scopeKey = resolveBilibiliCacheScopeKey(instanceId);

  const cacheKey = normalizedBvid.toUpperCase();
  const cachedItem = BILIBILI_RESOURCE_BY_BVID_CACHE.get(scopeKey, cacheKey);
  if (cachedItem) {
    return cloneResourceItem(cachedItem);
  }

  const item = await callBilibiliBinding<BilibiliFavoriteResourceItem | null>({
    instanceId,
    bindingId: PLATFORM_SEARCH_BINDING_ID,
    method: 'resolveLocator',
    payload: {
      bvid: normalizedBvid,
      resourceId: normalizedBvid,
      query: normalizedBvid,
      keyword: normalizedBvid,
    },
    runtimeBucket: 'search',
    map: (value) => {
      if (value === null) return null;
      const record = asPlatformFacadeRecord(value);
      if (!record) return undefined;
      if (record.item === null) return null;
      return mapRuntimeFavoriteResourceItem(record.item) ?? undefined;
    },
  });
  if (!item) return null;

  BILIBILI_RESOURCE_BY_BVID_CACHE.set(scopeKey, cacheKey, item);
  return cloneResourceItem(item);
}

export async function prepareBilibiliCachedPlayback(
  sourceLocator: string,
  qualityHint?: string,
  instanceId?: string | null,
  runtimeOptions?: RuntimePreferenceOptions
): Promise<BilibiliPreparedPlayback | null> {
  void runtimeOptions;
  const normalizedSourceLocator = normalizePlatformFacadeString(sourceLocator);
  if (!normalizedSourceLocator) return null;

  const normalizedQualityHint =
    normalizePlatformFacadeString(qualityHint) || undefined;
  return callBilibiliBinding<BilibiliPreparedPlayback | null>({
    instanceId,
    bindingId: PLATFORM_LIBRARY_BINDING_ID,
    method: 'preparePlayback',
    payload: {
      sourceLocator: normalizedSourceLocator,
      qualityHint: normalizedQualityHint,
    },
    runtimeBucket: 'library',
    runtimeMethods: ['preparePlayback'],
    map: mapRuntimePlayback,
  });
}

export async function listBilibiliPlaybackQualities(
  sourceLocator: string,
  instanceId?: string | null,
  runtimeOptions?: RuntimePreferenceOptions
): Promise<BilibiliPlaybackQualityOption[]> {
  void runtimeOptions;
  const normalizedSourceLocator = normalizePlatformFacadeString(sourceLocator);
  if (!normalizedSourceLocator) return [];
  const scopeKey = resolveBilibiliCacheScopeKey(instanceId);

  const cached = BILIBILI_PLAYBACK_QUALITY_CACHE.get(scopeKey, normalizedSourceLocator);
  if (cached) {
    return clonePlaybackQualityOptions(cached);
  }

  const options = await callBilibiliBinding<BilibiliPlaybackQualityOption[]>({
    instanceId,
    bindingId: PLATFORM_QUALITY_BINDING_ID,
    method: 'listOptions',
    payload: {
      sourceLocator: normalizedSourceLocator,
    },
    runtimeBucket: 'quality',
    map: mapRuntimePlaybackQualityOptions,
  });

  BILIBILI_PLAYBACK_QUALITY_CACHE.set(scopeKey, normalizedSourceLocator, options);
  return clonePlaybackQualityOptions(options);
}

export async function resolveBilibiliLyricLocator(
  lyricLocator: string,
  instanceId?: string | null
): Promise<BilibiliLyricLocatorResolved | null> {
  const normalizedLocator = normalizePlatformFacadeString(lyricLocator);
  if (!normalizedLocator) return null;

  return callBilibiliBinding<BilibiliLyricLocatorResolved | null>({
    instanceId,
    bindingId: PLATFORM_LIBRARY_BINDING_ID,
    method: 'resolveLyricLocator',
    payload: {
      lyricLocator: normalizedLocator,
    },
    runtimeBucket: 'library',
    map: (value) => {
      if (value === null) return null;
      const record = asPlatformFacadeRecord(value);
      if (!record) return undefined;

      const locator = normalizePlatformFacadeString(record.locator);
      const format = normalizePlatformFacadeString(record.format);
      const sourceKind = normalizePlatformFacadeString(record.sourceKind);
      if (!locator || !format || !sourceKind) return undefined;

      return {
        locator,
        format,
        lang: normalizePlatformFacadeString(record.lang) || undefined,
        sourceKind,
      };
    },
  });
}

export async function resolveBilibiliCoverAssetUrl(
  coverUrl: string | undefined,
  instanceId?: string | null
): Promise<string | undefined> {
  const normalizedCoverUrl = normalizePlatformFacadeString(coverUrl);
  if (!normalizedCoverUrl) return undefined;
  const cacheScopeKey = resolveBilibiliCacheScopeKey(instanceId);

  const cached = BILIBILI_COVER_ASSET_CACHE.get(cacheScopeKey, normalizedCoverUrl);
  if (cached) return cached;

  const resolved = await callBilibiliBinding<string>({
    instanceId,
    bindingId: PLATFORM_LIBRARY_BINDING_ID,
    method: 'resolveCoverAssetUrl',
    runtimeMethods: ['resolveCoverAssetUrl', 'prepareCoverCache'],
    payload: {
      coverUrl: normalizedCoverUrl,
    },
    runtimeBucket: 'library',
    map: (value) => mapRuntimeCoverAssetUrl(value) ?? normalizedCoverUrl,
  });

  const normalizedResolved =
    (await normalizePlatformFacadeAssetUrl(resolved)) ?? normalizedCoverUrl;

  BILIBILI_COVER_ASSET_CACHE.set(cacheScopeKey, normalizedCoverUrl, normalizedResolved);
  return normalizedResolved;
}
