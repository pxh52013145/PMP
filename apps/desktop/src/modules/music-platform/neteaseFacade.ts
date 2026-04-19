import { ConnectorScopedLruTtlCache } from './connectorScopedCache';
import {
  asPlatformFacadeRecord,
  createPlatformConnectorFacadeCaller,
  normalizePlatformFacadePositiveInt,
  normalizePlatformFacadeString,
  readPlatformFacadeFiniteNumber,
  resolvePlatformConnectorFacadeCacheScopeKey,
} from './platformConnectorFacadeCore';
import {
  PLATFORM_LIBRARY_BINDING_ID,
  PLATFORM_RECOMMENDATIONS_BINDING_ID,
  PLATFORM_SEARCH_BINDING_ID,
} from './platformInstanceApiBinding';
import { NETEASE_CONNECTOR_ID } from './platformConnectorModel';

export interface NeteaseUserPlaylistItem {
  playlistId: string;
  title: string;
  trackCount: number;
  coverUrl?: string;
  updatedAtMs?: number;
}

export interface NeteaseRecommendedPlaylistItem {
  playlistId: string;
  title: string;
  trackCount: number;
  coverUrl?: string;
}

export interface NeteaseSongItem {
  songId: string;
  title: string;
  artistNames: string;
  albumName?: string;
  durationSeconds?: number;
  coverUrl?: string;
  sourceLocator: string;
  webUrl: string;
}

export interface NeteaseSongPage {
  sourceKind: string;
  sourceId: string;
  pageNum: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  items: NeteaseSongItem[];
}

export interface NeteasePreparedPlayback {
  sourceLocator: string;
  streamUrl: string;
  cachePath: string;
  mimeType?: string;
  durationSeconds?: number;
  songId: string;
  selectedQualityKey?: string;
  selectedQualityLabel?: string;
}

type RuntimePreferenceOptions = {
  preferRuntime?: boolean;
};

const NETEASE_DISPLAY_NAME = 'Netease Cloud Music';

const NETEASE_USER_PLAYLISTS_CACHE =
  new ConnectorScopedLruTtlCache<NeteaseUserPlaylistItem[]>({
    maxEntriesPerConnector: 4,
    defaultTtlMs: 2 * 60 * 1000,
  });
const NETEASE_RECOMMENDED_PLAYLISTS_CACHE =
  new ConnectorScopedLruTtlCache<NeteaseRecommendedPlaylistItem[]>({
    maxEntriesPerConnector: 4,
    defaultTtlMs: 2 * 60 * 1000,
  });
const NETEASE_SONG_PAGE_CACHE = new ConnectorScopedLruTtlCache<NeteaseSongPage | null>({
  maxEntriesPerConnector: 64,
  defaultTtlMs: 75 * 1000,
});
const callNeteaseBinding = createPlatformConnectorFacadeCaller({
  connectorId: NETEASE_CONNECTOR_ID,
  displayName: NETEASE_DISPLAY_NAME,
});

function resolveNeteaseCacheScopeKey(instanceId?: string | null): string {
  return resolvePlatformConnectorFacadeCacheScopeKey(
    NETEASE_CONNECTOR_ID,
    instanceId
  );
}

function cloneSongPage(page: NeteaseSongPage | null): NeteaseSongPage | null {
  if (!page) return null;
  return {
    sourceKind: page.sourceKind,
    sourceId: page.sourceId,
    pageNum: page.pageNum,
    pageSize: page.pageSize,
    total: page.total,
    hasMore: page.hasMore,
    items: page.items.map((item) => ({
      songId: item.songId,
      title: item.title,
      artistNames: item.artistNames,
      albumName: item.albumName,
      durationSeconds: item.durationSeconds,
      coverUrl: item.coverUrl,
      sourceLocator: item.sourceLocator,
      webUrl: item.webUrl,
    })),
  };
}

function cloneUserPlaylists(items: NeteaseUserPlaylistItem[]): NeteaseUserPlaylistItem[] {
  return items.map((item) => ({
    playlistId: item.playlistId,
    title: item.title,
    trackCount: item.trackCount,
    coverUrl: item.coverUrl,
    updatedAtMs: item.updatedAtMs,
  }));
}

function cloneRecommendedPlaylists(
  items: NeteaseRecommendedPlaylistItem[]
): NeteaseRecommendedPlaylistItem[] {
  return items.map((item) => ({
    playlistId: item.playlistId,
    title: item.title,
    trackCount: item.trackCount,
    coverUrl: item.coverUrl,
  }));
}

function mapRuntimePlaylistItem(
  value: unknown
): NeteaseUserPlaylistItem | NeteaseRecommendedPlaylistItem | null {
  const record = asPlatformFacadeRecord(value);
  if (!record) return null;

  const playlistId =
    normalizePlatformFacadeString(record.playlistId) ||
    normalizePlatformFacadeString(record.collectionId);
  const title = normalizePlatformFacadeString(record.title);
  if (!playlistId || !title) return null;

  return {
    playlistId,
    title,
    trackCount: normalizePlatformFacadePositiveInt(record.trackCount),
    coverUrl: normalizePlatformFacadeString(record.coverUrl) || undefined,
    updatedAtMs: readPlatformFacadeFiniteNumber(record.updatedAtMs),
  };
}

function mapRuntimeSongItem(value: unknown): NeteaseSongItem | null {
  const record = asPlatformFacadeRecord(value);
  if (!record) return null;

  const songId =
    normalizePlatformFacadeString(record.songId) ||
    normalizePlatformFacadeString(record.resourceId);
  const title = normalizePlatformFacadeString(record.title);
  const sourceLocator = normalizePlatformFacadeString(record.sourceLocator);
  const webUrl = normalizePlatformFacadeString(record.webUrl) || sourceLocator;
  if (!songId || !title || !sourceLocator || !webUrl) return null;

  return {
    songId,
    title,
    artistNames: normalizePlatformFacadeString(record.artistNames),
    albumName: normalizePlatformFacadeString(record.albumName) || undefined,
    durationSeconds: readPlatformFacadeFiniteNumber(record.durationSeconds),
    coverUrl: normalizePlatformFacadeString(record.coverUrl) || undefined,
    sourceLocator,
    webUrl,
  };
}

function mapRuntimeSongPage(value: unknown): NeteaseSongPage | null | undefined {
  if (value === null) return null;

  const record = asPlatformFacadeRecord(value);
  if (!record || !Array.isArray(record.items)) return undefined;

  const items = record.items
    .map(mapRuntimeSongItem)
    .filter((item): item is NeteaseSongItem => Boolean(item));

  return {
    sourceKind: normalizePlatformFacadeString(record.sourceKind) || 'unknown',
    sourceId: normalizePlatformFacadeString(record.sourceId) || 'unknown',
    pageNum: normalizePlatformFacadePositiveInt(record.pageNum) || 1,
    pageSize:
      normalizePlatformFacadePositiveInt(record.pageSize) ||
      Math.max(
        1,
        items.length || normalizePlatformFacadePositiveInt(record.total)
      ),
    total: normalizePlatformFacadePositiveInt(record.total),
    hasMore: record.hasMore === true,
    items,
  };
}

function mapRuntimePreparedPlayback(value: unknown): NeteasePreparedPlayback | null | undefined {
  if (value === null) return null;

  const record = asPlatformFacadeRecord(value);
  if (!record) return undefined;

  const sourceLocator = normalizePlatformFacadeString(record.sourceLocator);
  const streamUrl = normalizePlatformFacadeString(record.streamUrl);
  const cachePath = normalizePlatformFacadeString(record.cachePath);
  const songId =
    normalizePlatformFacadeString(record.resourceId) ||
    normalizePlatformFacadeString(record.songId);
  if (!sourceLocator || !streamUrl || !cachePath || !songId) return undefined;

  return {
    sourceLocator,
    streamUrl,
    cachePath,
    mimeType: normalizePlatformFacadeString(record.mimeType) || undefined,
    durationSeconds: readPlatformFacadeFiniteNumber(record.durationSeconds),
    songId,
    selectedQualityKey:
      normalizePlatformFacadeString(record.selectedQualityKey) || undefined,
    selectedQualityLabel:
      normalizePlatformFacadeString(record.selectedQualityLabel) || undefined,
  };
}

export function clearNeteaseFacadeCaches(instanceId?: string | null): void {
  const scopeKey = resolveNeteaseCacheScopeKey(instanceId);
  NETEASE_USER_PLAYLISTS_CACHE.clearConnector(scopeKey);
  NETEASE_RECOMMENDED_PLAYLISTS_CACHE.clearConnector(scopeKey);
  NETEASE_SONG_PAGE_CACHE.clearConnector(scopeKey);
}

export async function listNeteaseRecommendedPlaylists(options?: {
  forceRefresh?: boolean;
  instanceId?: string | null;
  preferRuntime?: boolean;
}): Promise<NeteaseRecommendedPlaylistItem[]> {
  void options?.preferRuntime;
  const scopeKey = resolveNeteaseCacheScopeKey(options?.instanceId);
  if (!options?.forceRefresh) {
    const cached = NETEASE_RECOMMENDED_PLAYLISTS_CACHE.get(scopeKey, 'recommended-playlists');
    if (cached) return cloneRecommendedPlaylists(cached);
  }

  const playlists = await callNeteaseBinding<NeteaseRecommendedPlaylistItem[]>({
    instanceId: options?.instanceId,
    bindingId: PLATFORM_RECOMMENDATIONS_BINDING_ID,
    method: 'listDaily',
    payload: {
      forceRefresh: options?.forceRefresh === true,
    },
    runtimeBucket: 'recommendations',
    map: (value) => {
      const record = asPlatformFacadeRecord(value);
      if (!record || !Array.isArray(record.collections)) return undefined;
      return record.collections
        .map(mapRuntimePlaylistItem)
        .filter((item): item is NeteaseRecommendedPlaylistItem => Boolean(item));
    },
  });

  NETEASE_RECOMMENDED_PLAYLISTS_CACHE.set(scopeKey, 'recommended-playlists', playlists);
  return cloneRecommendedPlaylists(playlists);
}

export async function listNeteaseRecommendedSongs(options?: {
  forceRefresh?: boolean;
  instanceId?: string | null;
  preferRuntime?: boolean;
}): Promise<NeteaseSongPage | null> {
  void options?.preferRuntime;
  const scopeKey = resolveNeteaseCacheScopeKey(options?.instanceId);
  if (!options?.forceRefresh) {
    const cached = NETEASE_SONG_PAGE_CACHE.get(scopeKey, 'recommended-songs');
    if (cached !== undefined) return cloneSongPage(cached);
  }

  const page = await callNeteaseBinding<NeteaseSongPage | null>({
    instanceId: options?.instanceId,
    bindingId: PLATFORM_RECOMMENDATIONS_BINDING_ID,
    method: 'listDaily',
    payload: {
      forceRefresh: options?.forceRefresh === true,
    },
    runtimeBucket: 'recommendations',
    map: (value) => {
      if (value === null) return null;
      const record = asPlatformFacadeRecord(value);
      if (!record) return undefined;
      return mapRuntimeSongPage({
        sourceKind: normalizePlatformFacadeString(record.sourceKind) || 'recommended',
        sourceId: normalizePlatformFacadeString(record.sourceId) || 'recommended',
        pageNum: normalizePlatformFacadePositiveInt(record.pageNum) || 1,
        pageSize:
          normalizePlatformFacadePositiveInt(record.pageSize) ||
          Math.max(1, Array.isArray(record.items) ? record.items.length : 0),
        total: normalizePlatformFacadePositiveInt(record.total),
        hasMore: record.hasMore === true,
        items: Array.isArray(record.items) ? record.items : [],
      });
    },
  });

  NETEASE_SONG_PAGE_CACHE.set(scopeKey, 'recommended-songs', page);
  return cloneSongPage(page);
}

export async function listNeteaseUserPlaylists(options?: {
  forceRefresh?: boolean;
  instanceId?: string | null;
  preferRuntime?: boolean;
}): Promise<NeteaseUserPlaylistItem[]> {
  void options?.preferRuntime;
  const scopeKey = resolveNeteaseCacheScopeKey(options?.instanceId);
  if (!options?.forceRefresh) {
    const cached = NETEASE_USER_PLAYLISTS_CACHE.get(scopeKey, 'user-playlists');
    if (cached) return cloneUserPlaylists(cached);
  }

  const playlists = await callNeteaseBinding<NeteaseUserPlaylistItem[]>({
    instanceId: options?.instanceId,
    bindingId: PLATFORM_LIBRARY_BINDING_ID,
    method: 'listCollections',
    payload: {
      forceRefresh: options?.forceRefresh === true,
    },
    runtimeBucket: 'library',
    map: (value) => {
      const record = asPlatformFacadeRecord(value);
      if (!record || !Array.isArray(record.items)) return undefined;
      return record.items
        .map(mapRuntimePlaylistItem)
        .filter((item): item is NeteaseUserPlaylistItem => Boolean(item));
    },
  });

  NETEASE_USER_PLAYLISTS_CACHE.set(scopeKey, 'user-playlists', playlists);
  return cloneUserPlaylists(playlists);
}

export async function listNeteasePlaylistTracks(
  playlistId: string,
  options?: {
    forceRefresh?: boolean;
    instanceId?: string | null;
    preferRuntime?: boolean;
  }
): Promise<NeteaseSongPage | null> {
  void options?.preferRuntime;
  const normalizedPlaylistId = normalizePlatformFacadeString(playlistId);
  if (!normalizedPlaylistId) return null;
  const scopeKey = resolveNeteaseCacheScopeKey(options?.instanceId);

  const cacheKey = `playlist:${normalizedPlaylistId}`;
  if (!options?.forceRefresh) {
    const cached = NETEASE_SONG_PAGE_CACHE.get(scopeKey, cacheKey);
    if (cached !== undefined) return cloneSongPage(cached);
  }

  const page = await callNeteaseBinding<NeteaseSongPage | null>({
    instanceId: options?.instanceId,
    bindingId: PLATFORM_LIBRARY_BINDING_ID,
    method: 'listPlaylistTracks',
    payload: {
      collectionId: normalizedPlaylistId,
      playlistId: normalizedPlaylistId,
      forceRefresh: options?.forceRefresh === true,
    },
    runtimeBucket: 'library',
    runtimeMethods: ['listPlaylistTracks', 'listResources'],
    map: mapRuntimeSongPage,
  });

  NETEASE_SONG_PAGE_CACHE.set(scopeKey, cacheKey, page, 90 * 1000);
  return cloneSongPage(page);
}

export async function searchNeteaseSongs(options: {
  keyword: string;
  pageNum?: number;
  pageSize?: number;
  forceRefresh?: boolean;
  instanceId?: string | null;
  preferRuntime?: boolean;
}): Promise<NeteaseSongPage | null> {
  void options.preferRuntime;
  const keyword = normalizePlatformFacadeString(options.keyword);
  if (!keyword) return null;
  const scopeKey = resolveNeteaseCacheScopeKey(options.instanceId);

  const pageNum =
    normalizePlatformFacadePositiveInt(options.pageNum ?? 1) || 1;
  const pageSize =
    normalizePlatformFacadePositiveInt(options.pageSize ?? 40) || 40;
  const cacheKey = `search:${keyword.toLowerCase()}|page=${pageNum}|size=${pageSize}`;
  if (!options.forceRefresh) {
    const cached = NETEASE_SONG_PAGE_CACHE.get(scopeKey, cacheKey);
    if (cached !== undefined) return cloneSongPage(cached);
  }

  const page = await callNeteaseBinding<NeteaseSongPage | null>({
    instanceId: options.instanceId,
    bindingId: PLATFORM_SEARCH_BINDING_ID,
    method: 'query',
    payload: {
      keyword,
      query: keyword,
      pageNum,
      pageSize,
      forceRefresh: options.forceRefresh === true,
    },
    runtimeBucket: 'search',
    map: mapRuntimeSongPage,
  });

  NETEASE_SONG_PAGE_CACHE.set(scopeKey, cacheKey, page, 30 * 1000);
  return cloneSongPage(page);
}

export async function prepareNeteaseCachedPlayback(
  sourceLocator: string,
  qualityHint?: string,
  instanceId?: string | null,
  runtimeOptions?: RuntimePreferenceOptions
): Promise<NeteasePreparedPlayback | null> {
  void runtimeOptions;
  const normalizedSourceLocator = normalizePlatformFacadeString(sourceLocator);
  if (!normalizedSourceLocator) return null;
  const normalizedQualityHint =
    normalizePlatformFacadeString(qualityHint) || undefined;

  return callNeteaseBinding<NeteasePreparedPlayback | null>({
    instanceId,
    bindingId: PLATFORM_LIBRARY_BINDING_ID,
    method: 'preparePlayback',
    payload: {
      sourceLocator: normalizedSourceLocator,
      qualityHint: normalizedQualityHint,
    },
    runtimeBucket: 'library',
    map: mapRuntimePreparedPlayback,
  });
}
