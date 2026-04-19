import { ConnectorScopedLruTtlCache } from './connectorScopedCache';
import {
  normalizePlatformFacadeString,
  resolvePlatformConnectorFacadeCacheScopeKey,
} from './platformConnectorFacadeCore';
import { NETEASE_CONNECTOR_ID } from './platformConnectorModel';
import {
  listPlatformWorkspaceCollectionResources,
  listPlatformWorkspaceCollections,
  listPlatformWorkspaceRecommendedCollections,
  listPlatformWorkspaceRecommendedResources,
  preparePlatformWorkspacePlayback,
  searchPlatformWorkspaceResources,
  type PlatformWorkspaceCollectionItem,
  type PlatformWorkspacePreparedPlayback,
  type PlatformWorkspaceResourceItem,
  type PlatformWorkspaceResourcePage,
} from './platformWorkspaceFacade';

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

function mapWorkspaceCollectionToUserPlaylist(
  item: PlatformWorkspaceCollectionItem
): NeteaseUserPlaylistItem {
  return {
    playlistId: item.collectionId,
    title: item.title,
    trackCount: item.trackCount,
    coverUrl: item.coverUrl,
    updatedAtMs: item.updatedAtMs,
  };
}

function mapWorkspaceCollectionToRecommendedPlaylist(
  item: PlatformWorkspaceCollectionItem
): NeteaseRecommendedPlaylistItem {
  return {
    playlistId: item.collectionId,
    title: item.title,
    trackCount: item.trackCount,
    coverUrl: item.coverUrl,
  };
}

function mapWorkspaceResourceToSong(item: PlatformWorkspaceResourceItem): NeteaseSongItem {
  return {
    songId: item.resourceId,
    title: item.title,
    artistNames: item.artistNames || item.ownerName || '',
    albumName: item.albumName,
    durationSeconds: item.durationSeconds,
    coverUrl: item.coverUrl,
    sourceLocator: item.sourceLocator,
    webUrl: item.webUrl || item.sourceLocator,
  };
}

function mapWorkspacePageToSongPage(
  page: PlatformWorkspaceResourcePage | null,
  fallbackSourceId = 'unknown',
  fallbackSourceKind = 'unknown'
): NeteaseSongPage | null {
  if (!page) return null;

  const sourceId =
    normalizePlatformFacadeString(page.sourceId) &&
    page.sourceId !== 'unknown'
      ? page.sourceId
      : fallbackSourceId;
  const sourceKind =
    normalizePlatformFacadeString(page.sourceKind) &&
    page.sourceKind !== 'unknown'
      ? page.sourceKind
      : fallbackSourceKind;

  return {
    sourceKind: sourceKind || fallbackSourceKind,
    sourceId: sourceId || fallbackSourceId,
    pageNum: page.pageNum,
    pageSize: page.pageSize,
    total: page.total,
    hasMore: page.hasMore,
    items: page.items.map(mapWorkspaceResourceToSong),
  };
}

function mapWorkspacePreparedPlaybackToNetease(
  prepared: PlatformWorkspacePreparedPlayback | null
): NeteasePreparedPlayback | null {
  if (!prepared || !prepared.resourceId) return null;

  return {
    sourceLocator: prepared.sourceLocator,
    streamUrl: prepared.streamUrl,
    cachePath: prepared.cachePath,
    mimeType: prepared.mimeType,
    durationSeconds: prepared.durationSeconds,
    songId: prepared.resourceId,
    selectedQualityKey: prepared.selectedQualityKey,
    selectedQualityLabel: prepared.selectedQualityLabel,
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

  const collections = await listPlatformWorkspaceRecommendedCollections({
    connectorId: NETEASE_CONNECTOR_ID,
    instanceId: options?.instanceId,
    forceRefresh: options?.forceRefresh === true,
  });
  const playlists = collections.map(mapWorkspaceCollectionToRecommendedPlaylist);

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

  const page = await listPlatformWorkspaceRecommendedResources({
    connectorId: NETEASE_CONNECTOR_ID,
    instanceId: options?.instanceId,
    forceRefresh: options?.forceRefresh === true,
  });
  const mapped = mapWorkspacePageToSongPage(page, 'recommended', 'recommended');

  NETEASE_SONG_PAGE_CACHE.set(scopeKey, 'recommended-songs', mapped);
  return cloneSongPage(mapped);
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

  const collections = await listPlatformWorkspaceCollections({
    connectorId: NETEASE_CONNECTOR_ID,
    instanceId: options?.instanceId,
    forceRefresh: options?.forceRefresh === true,
  });
  const playlists = collections.map(mapWorkspaceCollectionToUserPlaylist);

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

  const page = await listPlatformWorkspaceCollectionResources({
    connectorId: NETEASE_CONNECTOR_ID,
    collectionId: normalizedPlaylistId,
    instanceId: options?.instanceId,
    forceRefresh: options?.forceRefresh === true,
  });
  const mapped = mapWorkspacePageToSongPage(page, normalizedPlaylistId, 'playlist');

  NETEASE_SONG_PAGE_CACHE.set(scopeKey, cacheKey, mapped, 90 * 1000);
  return cloneSongPage(mapped);
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

  const pageNum = options.pageNum && Number.isFinite(options.pageNum) ? options.pageNum : 1;
  const pageSize = options.pageSize && Number.isFinite(options.pageSize) ? options.pageSize : 40;
  const cacheKey = `search:${keyword.toLowerCase()}|page=${pageNum}|size=${pageSize}`;
  if (!options.forceRefresh) {
    const cached = NETEASE_SONG_PAGE_CACHE.get(scopeKey, cacheKey);
    if (cached !== undefined) return cloneSongPage(cached);
  }

  const page = await searchPlatformWorkspaceResources({
    connectorId: NETEASE_CONNECTOR_ID,
    keyword,
    pageNum,
    pageSize,
    instanceId: options.instanceId,
    forceRefresh: options.forceRefresh === true,
  });
  const mapped = mapWorkspacePageToSongPage(page, keyword, 'search');

  NETEASE_SONG_PAGE_CACHE.set(scopeKey, cacheKey, mapped, 30 * 1000);
  return cloneSongPage(mapped);
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

  const prepared = await preparePlatformWorkspacePlayback({
    connectorId: NETEASE_CONNECTOR_ID,
    sourceLocator: normalizedSourceLocator,
    qualityHint,
    instanceId,
  });
  return mapWorkspacePreparedPlaybackToNetease(prepared);
}
