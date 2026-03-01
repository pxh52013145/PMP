import {
  getNativeBilibiliPlaybackCacheSettings,
  listNativeBilibiliFavoriteFolders,
  listNativeBilibiliFavoriteResources,
  listNativeBilibiliRecommendedResources,
  listNativeBilibiliSearchResources,
  listNativeBilibiliPlaybackQualities,
  prepareNativeBilibiliCoverCache,
  prepareNativeBilibiliCachedPlayback,
  resolveNativeBilibiliLyricLocator,
  setNativeBilibiliPlaybackCacheSettings,
  searchNativeBilibiliResourceByBvid,
} from '../music-library';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { ConnectorScopedLruTtlCache } from './connectorScopedCache';

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

export interface BilibiliPlaybackCacheSettings {
  customRootPath?: string;
  effectiveRootPath: string;
  defaultRootPath: string;
}

const BILIBILI_CONNECTOR_ID = 'connector.platform.bilibili';
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

export async function pickBilibiliCacheDirectory(): Promise<string | null> {
  if (!isTauriRuntime()) return null;

  try {
    const dialog = await import('@tauri-apps/api/dialog');
    const selected = await dialog.open({ directory: true, multiple: false });
    if (typeof selected === 'string' && selected.trim().length > 0) {
      return selected.trim();
    }
  } catch {
    // user cancel or dialog unavailable
  }

  return null;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export async function listBilibiliFavoriteFolders(): Promise<BilibiliFavoriteFolderItem[]> {
  const folders = await listNativeBilibiliFavoriteFolders();
  return folders.map((item) => ({
    folderId: item.folderId,
    title: item.title,
    mediaCount: normalizePositiveInt(item.mediaCount),
    coverUrl: normalizeString(item.coverUrl) || undefined,
    updatedAtMs: item.updatedAtMs,
  }));
}

export async function listBilibiliFavoriteResources(options: {
  folderId: string;
  pageNum?: number;
  pageSize?: number;
}): Promise<BilibiliFavoriteResourcePage | null> {
  const folderId = normalizeString(options.folderId);
  if (!folderId) return null;

  const page = await listNativeBilibiliFavoriteResources({
    folderId,
    pageNum: options.pageNum,
    pageSize: options.pageSize,
  });
  if (!page) return null;

  return {
    folderId: page.folderId,
    pageNum: normalizePositiveInt(page.pageNum) || 1,
    pageSize: normalizePositiveInt(page.pageSize) || 1,
    total: normalizePositiveInt(page.total),
    hasMore: page.hasMore,
    items: page.items.map((item) => ({
      resourceId: item.resourceId,
      title: item.title,
      ownerName: normalizeString(item.ownerName) || undefined,
      durationSeconds: item.durationSeconds,
      coverUrl: normalizeString(item.coverUrl) || undefined,
      sourceLocator: item.sourceLocator,
      lyricLocator: normalizeString(item.lyricLocator) || undefined,
      bvid: normalizeString(item.bvid) || undefined,
      cid: normalizeString(item.cid) || undefined,
      contentKind: normalizeString(item.contentKind) || 'unknown',
    })),
  };
}

export async function listBilibiliRecommendedResources(): Promise<BilibiliFavoriteResourcePage | null> {
  const page = await listNativeBilibiliRecommendedResources();
  if (!page) return null;

  return {
    folderId: page.folderId,
    pageNum: normalizePositiveInt(page.pageNum) || 1,
    pageSize: normalizePositiveInt(page.pageSize) || 1,
    total: normalizePositiveInt(page.total),
    hasMore: page.hasMore,
    items: page.items.map((item) => ({
      resourceId: item.resourceId,
      title: item.title,
      ownerName: normalizeString(item.ownerName) || undefined,
      durationSeconds: item.durationSeconds,
      coverUrl: normalizeString(item.coverUrl) || undefined,
      sourceLocator: item.sourceLocator,
      lyricLocator: normalizeString(item.lyricLocator) || undefined,
      bvid: normalizeString(item.bvid) || undefined,
      cid: normalizeString(item.cid) || undefined,
      contentKind: normalizeString(item.contentKind) || 'unknown',
    })),
  };
}

export async function searchBilibiliResources(options: {
  keyword: string;
  pageNum?: number;
  pageSize?: number;
}): Promise<BilibiliFavoriteResourcePage | null> {
  const keyword = normalizeString(options.keyword);
  if (!keyword) return null;

  const page = await listNativeBilibiliSearchResources({
    keyword,
    pageNum: options.pageNum,
    pageSize: options.pageSize,
  });
  if (!page) return null;

  return {
    folderId: page.folderId,
    pageNum: normalizePositiveInt(page.pageNum) || 1,
    pageSize: normalizePositiveInt(page.pageSize) || 1,
    total: normalizePositiveInt(page.total),
    hasMore: page.hasMore,
    items: page.items.map((item) => ({
      resourceId: item.resourceId,
      title: item.title,
      ownerName: normalizeString(item.ownerName) || undefined,
      durationSeconds: item.durationSeconds,
      coverUrl: normalizeString(item.coverUrl) || undefined,
      sourceLocator: item.sourceLocator,
      lyricLocator: normalizeString(item.lyricLocator) || undefined,
      bvid: normalizeString(item.bvid) || undefined,
      cid: normalizeString(item.cid) || undefined,
      contentKind: normalizeString(item.contentKind) || 'unknown',
    })),
  };
}

export async function searchBilibiliResourceByBvid(
  bvid: string
): Promise<BilibiliFavoriteResourceItem | null> {
  const normalizedBvid = normalizeString(bvid);
  if (!normalizedBvid) return null;

  const cacheKey = normalizedBvid.toUpperCase();
  const cachedItem = BILIBILI_RESOURCE_BY_BVID_CACHE.get(BILIBILI_CONNECTOR_ID, cacheKey);
  if (cachedItem) {
    return cloneResourceItem(cachedItem);
  }

  const item = await searchNativeBilibiliResourceByBvid(normalizedBvid);
  if (!item) return null;

  const mapped: BilibiliFavoriteResourceItem = {
    resourceId: item.resourceId,
    title: item.title,
    ownerName: normalizeString(item.ownerName) || undefined,
    durationSeconds: item.durationSeconds,
    coverUrl: normalizeString(item.coverUrl) || undefined,
    sourceLocator: item.sourceLocator,
    lyricLocator: normalizeString(item.lyricLocator) || undefined,
    bvid: normalizeString(item.bvid) || undefined,
    cid: normalizeString(item.cid) || undefined,
    contentKind: normalizeString(item.contentKind) || 'unknown',
  };

  BILIBILI_RESOURCE_BY_BVID_CACHE.set(BILIBILI_CONNECTOR_ID, cacheKey, mapped);
  return cloneResourceItem(mapped);
}

export async function prepareBilibiliCachedPlayback(
  sourceLocator: string,
  qualityHint?: string
): Promise<BilibiliPreparedPlayback | null> {
  const normalizedSourceLocator = normalizeString(sourceLocator);
  if (!normalizedSourceLocator) return null;

  const normalizedQualityHint = normalizeString(qualityHint);

  const prepared = await prepareNativeBilibiliCachedPlayback(
    normalizedSourceLocator,
    normalizedQualityHint || undefined
  );
  if (!prepared) return null;

  return {
    sourceLocator: prepared.sourceLocator,
    streamUrl: prepared.streamUrl,
    cachePath: prepared.cachePath,
    mimeType: normalizeString(prepared.mimeType) || undefined,
    durationSeconds: prepared.durationSeconds,
    contentKind: prepared.contentKind,
    selectedQualityKey: prepared.selectedQualityKey,
    selectedQualityLabel: prepared.selectedQualityLabel,
  };
}

export async function listBilibiliPlaybackQualities(
  sourceLocator: string
): Promise<BilibiliPlaybackQualityOption[]> {
  const normalizedSourceLocator = normalizeString(sourceLocator);
  if (!normalizedSourceLocator) return [];

  const cached = BILIBILI_PLAYBACK_QUALITY_CACHE.get(
    BILIBILI_CONNECTOR_ID,
    normalizedSourceLocator
  );
  if (cached) {
    return clonePlaybackQualityOptions(cached);
  }

  const rawOptions = await listNativeBilibiliPlaybackQualities(normalizedSourceLocator);
  const normalizedOptions = rawOptions.map((item) => ({
    key: normalizeString(item.key),
    label: normalizeString(item.label),
    available: item.available,
  }));

  BILIBILI_PLAYBACK_QUALITY_CACHE.set(
    BILIBILI_CONNECTOR_ID,
    normalizedSourceLocator,
    normalizedOptions
  );
  return clonePlaybackQualityOptions(normalizedOptions);
}

export async function resolveBilibiliLyricLocator(
  lyricLocator: string
): Promise<BilibiliLyricLocatorResolved | null> {
  const normalizedLocator = normalizeString(lyricLocator);
  if (!normalizedLocator) return null;

  const resolved = await resolveNativeBilibiliLyricLocator(normalizedLocator);
  if (!resolved) return null;

  return {
    locator: resolved.locator,
    format: resolved.format,
    lang: normalizeString(resolved.lang) || undefined,
    sourceKind: resolved.sourceKind,
  };
}

export async function resolveBilibiliCoverAssetUrl(
  coverUrl: string | undefined
): Promise<string | undefined> {
  const normalizedCoverUrl = normalizeString(coverUrl);
  if (!normalizedCoverUrl) return undefined;

  const cached = BILIBILI_COVER_ASSET_CACHE.get(BILIBILI_CONNECTOR_ID, normalizedCoverUrl);
  if (cached) return cached;

  if (!isTauriRuntime()) {
    BILIBILI_COVER_ASSET_CACHE.set(BILIBILI_CONNECTOR_ID, normalizedCoverUrl, normalizedCoverUrl);
    return normalizedCoverUrl;
  }

  try {
    const cachePath = await prepareNativeBilibiliCoverCache(normalizedCoverUrl);
    if (!cachePath) {
      BILIBILI_COVER_ASSET_CACHE.set(BILIBILI_CONNECTOR_ID, normalizedCoverUrl, normalizedCoverUrl);
      return normalizedCoverUrl;
    }

    const tauriApi = await import('@tauri-apps/api/tauri');
    if (typeof tauriApi.convertFileSrc === 'function') {
      const converted = tauriApi.convertFileSrc(cachePath);
      BILIBILI_COVER_ASSET_CACHE.set(BILIBILI_CONNECTOR_ID, normalizedCoverUrl, converted);
      return converted;
    }

    BILIBILI_COVER_ASSET_CACHE.set(BILIBILI_CONNECTOR_ID, normalizedCoverUrl, normalizedCoverUrl);
    return normalizedCoverUrl;
  } catch {
    BILIBILI_COVER_ASSET_CACHE.set(BILIBILI_CONNECTOR_ID, normalizedCoverUrl, normalizedCoverUrl);
    return normalizedCoverUrl;
  }
}

export async function getBilibiliPlaybackCacheSettings(): Promise<BilibiliPlaybackCacheSettings | null> {
  const settings = await getNativeBilibiliPlaybackCacheSettings();
  if (!settings) return null;

  return {
    customRootPath: normalizeString(settings.customRootPath) || undefined,
    effectiveRootPath: normalizeString(settings.effectiveRootPath),
    defaultRootPath: normalizeString(settings.defaultRootPath),
  };
}

export async function setBilibiliPlaybackCacheSettings(
  customRootPath?: string | null
): Promise<BilibiliPlaybackCacheSettings | null> {
  const normalizedCustomRootPath = normalizeString(customRootPath);
  const settings = await setNativeBilibiliPlaybackCacheSettings(normalizedCustomRootPath || undefined);
  if (!settings) return null;

  return {
    customRootPath: normalizeString(settings.customRootPath) || undefined,
    effectiveRootPath: normalizeString(settings.effectiveRootPath),
    defaultRootPath: normalizeString(settings.defaultRootPath),
  };
}
