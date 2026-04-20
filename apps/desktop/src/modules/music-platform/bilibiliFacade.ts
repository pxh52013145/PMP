import { ConnectorScopedLruTtlCache } from './connectorScopedCache';
import {
  normalizePlatformFacadeString,
  resolvePlatformConnectorFacadeCacheScopeKey,
} from './platformConnectorFacadeCore';
import { BILIBILI_CONNECTOR_ID } from './platformConnectorModel';
import {
  listPlatformWorkspaceCollectionResources,
  listPlatformWorkspaceCollections,
  listPlatformWorkspaceQualityOptions,
  listPlatformWorkspaceRecommendedResources,
  preparePlatformWorkspacePlayback,
  resolvePlatformWorkspaceCoverAssetUrl,
  resolvePlatformWorkspaceLyricLocator,
  resolvePlatformWorkspaceResource,
  searchPlatformWorkspaceResources,
  type PlatformWorkspaceCollectionItem,
  type PlatformWorkspaceLyricLocatorResolved,
  type PlatformWorkspacePreparedPlayback,
  type PlatformWorkspaceQualityOption,
  type PlatformWorkspaceResourceItem,
  type PlatformWorkspaceResourcePage,
} from './platformWorkspaceFacade';

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

export type BilibiliPlaybackQualityKey =
  | 'auto'
  | '64k'
  | '132k'
  | '192k'
  | 'dolby'
  | 'hires';

export type BilibiliQualityBadge = 'dolby' | 'hires';

type RuntimePreferenceOptions = {
  preferRuntime?: boolean;
};

const BILIBILI_SEARCH_SOURCE_PREFIX = 'bilibili:search:';
const BILIBILI_BVID_PATTERN = /BV[0-9A-Za-z]{10}/i;
const BILIBILI_PLAYBACK_QUALITY_OPTION_ORDER: BilibiliPlaybackQualityKey[] = [
  'auto',
  '64k',
  '132k',
  '192k',
  'dolby',
  'hires',
];

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
  return resolvePlatformConnectorFacadeCacheScopeKey(
    BILIBILI_CONNECTOR_ID,
    instanceId
  );
}

export function normalizeBilibiliPlaybackQualityKey(
  value: string | null | undefined
): BilibiliPlaybackQualityKey {
  const recognized = readBilibiliPlaybackQualityKey(value);
  return recognized ?? 'auto';
}

function readBilibiliPlaybackQualityKey(
  value: string | null | undefined
): BilibiliPlaybackQualityKey | null {
  const normalized = normalizePlatformFacadeString(value).toLowerCase();
  if (normalized === 'auto') return 'auto';
  if (normalized === '64k') return '64k';
  if (normalized === '132k') return '132k';
  if (normalized === '192k') return '192k';
  if (normalized === 'dolby') return 'dolby';
  if (normalized === 'hires') return 'hires';
  return null;
}

export function createDefaultBilibiliPlaybackQualityOptions(): BilibiliPlaybackQualityOption[] {
  return BILIBILI_PLAYBACK_QUALITY_OPTION_ORDER.map((key) => ({
    key,
    label: key,
    available: key === 'auto',
  }));
}

export function mergeBilibiliPlaybackQualityOptions(
  options: BilibiliPlaybackQualityOption[]
): BilibiliPlaybackQualityOption[] {
  const normalizedEntries = options.flatMap((item) => {
    const key = readBilibiliPlaybackQualityKey(item.key);
    if (!key) return [];
    return [[key, { ...item, key }] as const];
  });

  const lookup = new Map<BilibiliPlaybackQualityKey, BilibiliPlaybackQualityOption>(
    normalizedEntries
  );

  return BILIBILI_PLAYBACK_QUALITY_OPTION_ORDER.map((key) => {
    const matched = lookup.get(key);
    return {
      key,
      label: matched?.label ?? key,
      available: matched?.available ?? key === 'auto',
    };
  });
}

export function extractBilibiliBvid(value: string | null | undefined): string | null {
  const normalized = normalizePlatformFacadeString(value);
  if (!normalized) return null;
  const matched = normalized.match(BILIBILI_BVID_PATTERN);
  if (!matched?.[0]) return null;
  return matched[0].toUpperCase();
}

export function normalizeBilibiliLookupInput(value: string): string | null {
  const trimmed = normalizePlatformFacadeString(value);
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    for (const [name, rawValue] of parsed.searchParams.entries()) {
      if (!name.toLowerCase().includes('bvid')) continue;
      const normalizedBvid = extractBilibiliBvid(rawValue);
      if (normalizedBvid) return normalizedBvid;
    }

    const segments = parsed.pathname
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    for (const segment of segments) {
      const normalizedBvid = extractBilibiliBvid(segment);
      if (normalizedBvid) return normalizedBvid;
    }
  } catch {
    // noop
  }

  return extractBilibiliBvid(trimmed);
}

export function buildBilibiliSearchSourceId(keyword: string): string {
  const normalizedKeyword = normalizePlatformFacadeString(keyword);
  return `${BILIBILI_SEARCH_SOURCE_PREFIX}${normalizedKeyword}`;
}

export function parseBilibiliSearchSourceId(sourceId: string): string | null {
  const normalizedSourceId = normalizePlatformFacadeString(sourceId);
  if (!normalizedSourceId.startsWith(BILIBILI_SEARCH_SOURCE_PREFIX)) return null;
  const keyword = normalizedSourceId.slice(BILIBILI_SEARCH_SOURCE_PREFIX.length).trim();
  return keyword.length > 0 ? keyword : null;
}

export function isBilibiliVideoSourceLocator(sourceLocator: string): boolean {
  const normalized = normalizePlatformFacadeString(sourceLocator).toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes('bilibili://video/') ||
    normalized.includes('bilibili.com/video/') ||
    normalized.includes('bvid=')
  );
}

export function buildBilibiliResourceIdentity(
  item: Pick<
    BilibiliFavoriteResourceItem,
    'resourceId' | 'bvid' | 'cid' | 'sourceLocator' | 'title' | 'ownerName' | 'durationSeconds'
  >
): string {
  const resourceId = normalizePlatformFacadeString(item.resourceId);
  if (resourceId) {
    return `rid:${resourceId}`;
  }

  const bvid = normalizePlatformFacadeString(item.bvid).toUpperCase();
  const cid = normalizePlatformFacadeString(item.cid);
  if (bvid && cid) {
    return `bvid:${bvid}::cid:${cid}`;
  }
  if (bvid) {
    return `bvid:${bvid}`;
  }

  const sourceLocator = normalizePlatformFacadeString(item.sourceLocator);
  if (sourceLocator) {
    return `locator:${sourceLocator}`;
  }

  const fallbackSeed = `${item.title || 'unknown'}::${item.ownerName || ''}::${
    item.durationSeconds || 0
  }`;
  return `meta:${normalizePlatformFacadeString(fallbackSeed) || 'unknown'}`;
}

export function buildBilibiliPreparedResourceKey(
  item: Pick<
    BilibiliFavoriteResourceItem,
    'resourceId' | 'bvid' | 'cid' | 'sourceLocator' | 'title' | 'ownerName' | 'durationSeconds'
  >,
  qualityKey: string
): string {
  return `${buildBilibiliResourceIdentity(item)}::${normalizeBilibiliPlaybackQualityKey(
    qualityKey
  )}`;
}

export function resolveBilibiliWebUrl(
  item: Pick<BilibiliFavoriteResourceItem, 'bvid' | 'sourceLocator'>
): string | null {
  const normalizedBvid = extractBilibiliBvid(item.bvid);
  if (normalizedBvid) {
    return `https://www.bilibili.com/video/${normalizedBvid}`;
  }

  const sourceLocator = normalizePlatformFacadeString(item.sourceLocator);
  if (!sourceLocator) return null;
  if (sourceLocator.startsWith('https://') || sourceLocator.startsWith('http://')) {
    return sourceLocator;
  }

  const sourceBvid = extractBilibiliBvid(sourceLocator);
  if (!sourceBvid) return null;
  return `https://www.bilibili.com/video/${sourceBvid}`;
}

export function resolveBilibiliQualityBadges(
  options: Array<Pick<BilibiliPlaybackQualityOption, 'key' | 'available'>>
): BilibiliQualityBadge[] {
  const available = new Set(
    options
      .filter((item) => item.available)
      .map((item) => normalizeBilibiliPlaybackQualityKey(item.key))
  );

  const badges: BilibiliQualityBadge[] = [];
  if (available.has('hires')) badges.push('hires');
  if (available.has('dolby')) badges.push('dolby');
  return badges;
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

function mapWorkspaceCollectionToBilibili(
  item: PlatformWorkspaceCollectionItem
): BilibiliFavoriteFolderItem {
  return {
    folderId: item.collectionId,
    title: item.title,
    mediaCount: item.trackCount,
    coverUrl: item.coverUrl,
    updatedAtMs: item.updatedAtMs,
  };
}

function mapWorkspaceResourceToBilibili(
  item: PlatformWorkspaceResourceItem
): BilibiliFavoriteResourceItem {
  return {
    resourceId: item.resourceId,
    title: item.title,
    ownerName: item.ownerName || item.artistNames,
    durationSeconds: item.durationSeconds,
    coverUrl: item.coverUrl,
    sourceLocator: item.sourceLocator,
    lyricLocator: item.lyricLocator,
    bvid: item.bvid,
    cid: item.cid,
    contentKind: item.contentKind || 'unknown',
  };
}

function mapWorkspacePageToBilibili(
  page: PlatformWorkspaceResourcePage | null,
  fallbackFolderId = 'default'
): BilibiliFavoriteResourcePage | null {
  if (!page) return null;

  const sourceId =
    normalizePlatformFacadeString(page.sourceId) &&
    page.sourceId !== 'unknown'
      ? page.sourceId
      : fallbackFolderId;

  return {
    folderId: sourceId || fallbackFolderId,
    pageNum: page.pageNum,
    pageSize: page.pageSize,
    total: page.total,
    hasMore: page.hasMore,
    items: page.items.map(mapWorkspaceResourceToBilibili),
  };
}

function mapWorkspacePlaybackToBilibili(
  prepared: PlatformWorkspacePreparedPlayback | null
): BilibiliPreparedPlayback | null {
  if (!prepared) return null;

  const selectedQualityKey = normalizeBilibiliPlaybackQualityKey(prepared.selectedQualityKey);
  return {
    sourceLocator: prepared.sourceLocator,
    streamUrl: prepared.streamUrl,
    cachePath: prepared.cachePath,
    mimeType: prepared.mimeType,
    durationSeconds: prepared.durationSeconds,
    contentKind: prepared.contentKind || 'unknown',
    selectedQualityKey,
    selectedQualityLabel: prepared.selectedQualityLabel || selectedQualityKey,
  };
}

function mapWorkspaceQualityOptionsToBilibili(
  options: PlatformWorkspaceQualityOption[]
): BilibiliPlaybackQualityOption[] {
  return options.map((item) => ({
    key: item.key,
    label: item.label,
    available: item.available,
  }));
}

function mapWorkspaceLyricToBilibili(
  resolved: PlatformWorkspaceLyricLocatorResolved | null
): BilibiliLyricLocatorResolved | null {
  if (!resolved) return null;
  return {
    locator: resolved.locator,
    format: resolved.format,
    lang: resolved.lang,
    sourceKind: resolved.sourceKind,
  };
}

export async function listBilibiliFavoriteFolders(
  instanceId?: string | null,
  runtimeOptions?: RuntimePreferenceOptions
): Promise<BilibiliFavoriteFolderItem[]> {
  void runtimeOptions;
  const items = await listPlatformWorkspaceCollections({
    connectorId: BILIBILI_CONNECTOR_ID,
    instanceId,
  });
  return items.map(mapWorkspaceCollectionToBilibili);
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

  const page = await listPlatformWorkspaceCollectionResources({
    connectorId: BILIBILI_CONNECTOR_ID,
    collectionId: folderId,
    pageNum: options.pageNum,
    pageSize: options.pageSize,
    instanceId: options.instanceId,
  });
  return mapWorkspacePageToBilibili(page, folderId);
}

export async function listBilibiliRecommendedResources(
  instanceId?: string | null,
  runtimeOptions?: RuntimePreferenceOptions
): Promise<BilibiliFavoriteResourcePage | null> {
  void runtimeOptions;
  const page = await listPlatformWorkspaceRecommendedResources({
    connectorId: BILIBILI_CONNECTOR_ID,
    instanceId,
  });
  return mapWorkspacePageToBilibili(page, 'recommended');
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

  const page = await searchPlatformWorkspaceResources({
    connectorId: BILIBILI_CONNECTOR_ID,
    keyword,
    pageNum: options.pageNum,
    pageSize: options.pageSize,
    instanceId: options.instanceId,
  });
  return mapWorkspacePageToBilibili(page, buildBilibiliSearchSourceId(keyword));
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

  const item = await resolvePlatformWorkspaceResource({
    connectorId: BILIBILI_CONNECTOR_ID,
    query: normalizedBvid,
    instanceId,
  });
  if (!item) return null;

  const mapped = mapWorkspaceResourceToBilibili(item);
  BILIBILI_RESOURCE_BY_BVID_CACHE.set(scopeKey, cacheKey, mapped);
  return cloneResourceItem(mapped);
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

  const prepared = await preparePlatformWorkspacePlayback({
    connectorId: BILIBILI_CONNECTOR_ID,
    sourceLocator: normalizedSourceLocator,
    qualityHint,
    instanceId,
  });
  return mapWorkspacePlaybackToBilibili(prepared);
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

  const options = await listPlatformWorkspaceQualityOptions({
    connectorId: BILIBILI_CONNECTOR_ID,
    sourceLocator: normalizedSourceLocator,
    instanceId,
  });
  const mapped = mapWorkspaceQualityOptionsToBilibili(options);

  BILIBILI_PLAYBACK_QUALITY_CACHE.set(scopeKey, normalizedSourceLocator, mapped);
  return clonePlaybackQualityOptions(mapped);
}

export async function resolveBilibiliLyricLocator(
  lyricLocator: string,
  instanceId?: string | null
): Promise<BilibiliLyricLocatorResolved | null> {
  const normalizedLocator = normalizePlatformFacadeString(lyricLocator);
  if (!normalizedLocator) return null;

  const resolved = await resolvePlatformWorkspaceLyricLocator({
    connectorId: BILIBILI_CONNECTOR_ID,
    lyricLocator: normalizedLocator,
    instanceId,
  });
  return mapWorkspaceLyricToBilibili(resolved);
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

  const resolved = await resolvePlatformWorkspaceCoverAssetUrl({
    connectorId: BILIBILI_CONNECTOR_ID,
    coverUrl: normalizedCoverUrl,
    instanceId,
  });

  if (resolved) {
    BILIBILI_COVER_ASSET_CACHE.set(cacheScopeKey, normalizedCoverUrl, resolved);
  }
  return resolved;
}
