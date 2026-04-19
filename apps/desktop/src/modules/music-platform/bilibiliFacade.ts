import { ConnectorScopedLruTtlCache } from './connectorScopedCache';
import {
  callPlatformFacadeBinding,
  type PlatformFacadeRuntimeBucket,
} from './platformFacadeBindingClient';
import {
  PLATFORM_LIBRARY_BINDING_ID,
  PLATFORM_QUALITY_BINDING_ID,
  PLATFORM_RECOMMENDATIONS_BINDING_ID,
  PLATFORM_SEARCH_BINDING_ID,
} from './platformInstanceApiBinding';
import { BILIBILI_CONNECTOR_ID } from './platformConnectorModel';
import { isTauriRuntime } from '../../utils/tauriRuntime';

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

function resolveBilibiliCacheScopeKey(instanceId?: string | null): string {
  const normalizedInstanceId = normalizeString(instanceId);
  return normalizedInstanceId || BILIBILI_CONNECTOR_ID;
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

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function normalizeBilibiliCoverAssetResult(value: unknown): Promise<string | undefined> {
  const normalized = normalizeString(value);
  if (!normalized) return undefined;

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(normalized) && !/^[a-zA-Z]:[\\/]/.test(normalized)) {
    return normalized;
  }

  if (/^[a-zA-Z]:[\\/]/.test(normalized) || normalized.startsWith('/')) {
    if (isTauriRuntime()) {
      const tauriApi = await import('@tauri-apps/api/tauri');
      if (typeof tauriApi.convertFileSrc === 'function') {
        return tauriApi.convertFileSrc(normalized);
      }
    }
  }

  return normalized;
}

function normalizePositiveInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function mapRuntimeFavoriteFolderItem(value: unknown): BilibiliFavoriteFolderItem | null {
  const record = asRecord(value);
  if (!record) return null;

  const folderId =
    normalizeString(record.collectionId) || normalizeString(record.folderId);
  const title = normalizeString(record.title);
  if (!folderId || !title) return null;

  return {
    folderId,
    title,
    mediaCount: normalizePositiveInt(record.trackCount ?? record.mediaCount),
    coverUrl: normalizeString(record.coverUrl) || undefined,
    updatedAtMs: readFiniteNumber(record.updatedAtMs),
  };
}

function mapRuntimeFavoriteResourceItem(value: unknown): BilibiliFavoriteResourceItem | null {
  const record = asRecord(value);
  if (!record) return null;

  const resourceId =
    normalizeString(record.resourceId) || normalizeString(record.songId);
  const title = normalizeString(record.title);
  const sourceLocator = normalizeString(record.sourceLocator);
  if (!resourceId || !title || !sourceLocator) return null;

  return {
    resourceId,
    title,
    ownerName: normalizeString(record.ownerName ?? record.artistNames) || undefined,
    durationSeconds: readFiniteNumber(record.durationSeconds),
    coverUrl: normalizeString(record.coverUrl) || undefined,
    sourceLocator,
    lyricLocator: normalizeString(record.lyricLocator) || undefined,
    bvid: normalizeString(record.bvid) || undefined,
    cid: normalizeString(record.cid) || undefined,
    contentKind: normalizeString(record.contentKind) || 'unknown',
  };
}

function mapRuntimeFavoriteResourcePage(value: unknown): BilibiliFavoriteResourcePage | null | undefined {
  if (value === null) return null;

  const record = asRecord(value);
  if (!record) return undefined;
  if (!Array.isArray(record.items)) return undefined;

  const items = record.items
    .map(mapRuntimeFavoriteResourceItem)
    .filter((item): item is BilibiliFavoriteResourceItem => Boolean(item));

  const pageNum = normalizePositiveInt(record.pageNum) || 1;
  const pageSize =
    normalizePositiveInt(record.pageSize) || Math.max(1, items.length || normalizePositiveInt(record.total));
  const total = normalizePositiveInt(record.total);
  const folderId =
    normalizeString(record.folderId) ||
    normalizeString(record.sourceId) ||
    normalizeString(record.collectionId) ||
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

  const record = asRecord(value);
  if (!record) return undefined;

  const sourceLocator = normalizeString(record.sourceLocator);
  const streamUrl = normalizeString(record.streamUrl);
  const cachePath = normalizeString(record.cachePath);
  const selectedQualityKey = normalizeString(record.selectedQualityKey);
  const selectedQualityLabel = normalizeString(record.selectedQualityLabel);
  if (!sourceLocator || !streamUrl || !cachePath || !selectedQualityKey || !selectedQualityLabel) {
    return undefined;
  }

  return {
    sourceLocator,
    streamUrl,
    cachePath,
    mimeType: normalizeString(record.mimeType) || undefined,
    durationSeconds: readFiniteNumber(record.durationSeconds),
    contentKind: normalizeString(record.contentKind) || 'unknown',
    selectedQualityKey,
    selectedQualityLabel,
  };
}

function mapRuntimePlaybackQualityOptions(
  value: unknown
): BilibiliPlaybackQualityOption[] | undefined {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.options)) return undefined;

  return record.options
    .map((item) => {
      const optionRecord = asRecord(item);
      if (!optionRecord) return null;
      const key = normalizeString(optionRecord.key);
      const label = normalizeString(optionRecord.label) || key;
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
  const direct = normalizeString(value);
  if (direct) return direct;

  const record = asRecord(value);
  if (!record) return undefined;

  return (
    normalizeString(record.assetUrl) ||
    normalizeString(record.cachePath) ||
    normalizeString(record.path) ||
    normalizeString(record.url) ||
    undefined
  );
}

async function callBilibiliBinding<T>(options: {
  instanceId?: string | null;
  bindingId: string;
  method: string;
  payload?: Record<string, unknown>;
  runtimeBucket: PlatformFacadeRuntimeBucket;
  runtimeMethods?: string[];
  map: (value: unknown) => T | undefined;
}): Promise<T> {
  return callPlatformFacadeBinding<T>({
    connectorId: BILIBILI_CONNECTOR_ID,
    displayName: BILIBILI_DISPLAY_NAME,
    instanceId: options.instanceId,
    bindingId: options.bindingId,
    method: options.method,
    payload: options.payload,
    runtimeBucket: options.runtimeBucket,
    runtimeMethods: options.runtimeMethods,
    map: options.map,
  });
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
      const record = asRecord(value);
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
  const folderId = normalizeString(options.folderId);
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
      const record = asRecord(value);
      const page = mapRuntimeFavoriteResourcePage(
        record
          ? {
              folderId: 'recommended',
              pageNum: normalizePositiveInt(record.pageNum) || 1,
              pageSize:
                normalizePositiveInt(record.pageSize) ||
                Math.max(1, Array.isArray(record.items) ? record.items.length : 0),
              total: normalizePositiveInt(record.total),
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
  const keyword = normalizeString(options.keyword);
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
  const normalizedBvid = normalizeString(bvid);
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
      const record = asRecord(value);
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
  const normalizedSourceLocator = normalizeString(sourceLocator);
  if (!normalizedSourceLocator) return null;

  const normalizedQualityHint = normalizeString(qualityHint) || undefined;
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
  const normalizedSourceLocator = normalizeString(sourceLocator);
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
  const normalizedLocator = normalizeString(lyricLocator);
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
      const record = asRecord(value);
      if (!record) return undefined;

      const locator = normalizeString(record.locator);
      const format = normalizeString(record.format);
      const sourceKind = normalizeString(record.sourceKind);
      if (!locator || !format || !sourceKind) return undefined;

      return {
        locator,
        format,
        lang: normalizeString(record.lang) || undefined,
        sourceKind,
      };
    },
  });
}

export async function resolveBilibiliCoverAssetUrl(
  coverUrl: string | undefined,
  instanceId?: string | null
): Promise<string | undefined> {
  const normalizedCoverUrl = normalizeString(coverUrl);
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
    (await normalizeBilibiliCoverAssetResult(resolved)) ?? normalizedCoverUrl;

  BILIBILI_COVER_ASSET_CACHE.set(cacheScopeKey, normalizedCoverUrl, normalizedResolved);
  return normalizedResolved;
}
