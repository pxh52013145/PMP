import {
  generateNativeNeteaseQrCodeSession,
  getNativeNeteaseAuthStatus,
  listNativeNeteasePlaylistTracks,
  listNativeNeteaseRecommendedPlaylists,
  listNativeNeteaseRecommendedSongs,
  listNativeNeteaseUserPlaylists,
  logoutNativeNetease,
  pollNativeNeteaseQrCodeSession,
  prepareNativeNeteaseCachedPlayback,
  searchNativeNeteaseSongs,
} from '../music-library';
import { ConnectorScopedLruTtlCache } from './connectorScopedCache';

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
}

const NETEASE_CONNECTOR_ID = 'connector.platform.netease';
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

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function mapSongItem(item: {
  songId: string;
  title: string;
  artistNames: string;
  albumName?: string;
  durationSeconds?: number;
  coverUrl?: string;
  sourceLocator: string;
  webUrl: string;
}): NeteaseSongItem {
  return {
    songId: item.songId,
    title: item.title,
    artistNames: item.artistNames,
    albumName: normalizeString(item.albumName) || undefined,
    durationSeconds: item.durationSeconds,
    coverUrl: normalizeString(item.coverUrl) || undefined,
    sourceLocator: item.sourceLocator,
    webUrl: item.webUrl,
  };
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

export function clearNeteaseFacadeCaches(): void {
  NETEASE_USER_PLAYLISTS_CACHE.clearConnector(NETEASE_CONNECTOR_ID);
  NETEASE_RECOMMENDED_PLAYLISTS_CACHE.clearConnector(NETEASE_CONNECTOR_ID);
  NETEASE_SONG_PAGE_CACHE.clearConnector(NETEASE_CONNECTOR_ID);
}

export async function listNeteaseRecommendedPlaylists(options?: {
  forceRefresh?: boolean;
}): Promise<NeteaseRecommendedPlaylistItem[]> {
  if (!options?.forceRefresh) {
    const cached = NETEASE_RECOMMENDED_PLAYLISTS_CACHE.get(
      NETEASE_CONNECTOR_ID,
      'recommended-playlists'
    );
    if (cached) return cloneRecommendedPlaylists(cached);
  }

  const items = await listNativeNeteaseRecommendedPlaylists();
  const mapped = items.map((item) => ({
    playlistId: item.playlistId,
    title: item.title,
    trackCount: normalizePositiveInt(item.trackCount),
    coverUrl: normalizeString(item.coverUrl) || undefined,
  }));
  NETEASE_RECOMMENDED_PLAYLISTS_CACHE.set(
    NETEASE_CONNECTOR_ID,
    'recommended-playlists',
    mapped
  );
  return cloneRecommendedPlaylists(mapped);
}

export async function listNeteaseRecommendedSongs(options?: {
  forceRefresh?: boolean;
}): Promise<NeteaseSongPage | null> {
  if (!options?.forceRefresh) {
    const cached = NETEASE_SONG_PAGE_CACHE.get(NETEASE_CONNECTOR_ID, 'recommended-songs');
    if (cached !== undefined) return cloneSongPage(cached);
  }

  const page = await listNativeNeteaseRecommendedSongs();
  if (!page) {
    NETEASE_SONG_PAGE_CACHE.set(NETEASE_CONNECTOR_ID, 'recommended-songs', null, 20 * 1000);
    return null;
  }

  const mapped = {
    sourceKind: page.sourceKind,
    sourceId: page.sourceId,
    pageNum: normalizePositiveInt(page.pageNum) || 1,
    pageSize: normalizePositiveInt(page.pageSize) || 1,
    total: normalizePositiveInt(page.total),
    hasMore: page.hasMore,
    items: page.items.map(mapSongItem),
  };
  NETEASE_SONG_PAGE_CACHE.set(NETEASE_CONNECTOR_ID, 'recommended-songs', mapped);
  return cloneSongPage(mapped);
}

export async function listNeteaseUserPlaylists(options?: {
  forceRefresh?: boolean;
}): Promise<NeteaseUserPlaylistItem[]> {
  if (!options?.forceRefresh) {
    const cached = NETEASE_USER_PLAYLISTS_CACHE.get(NETEASE_CONNECTOR_ID, 'user-playlists');
    if (cached) return cloneUserPlaylists(cached);
  }

  const items = await listNativeNeteaseUserPlaylists();
  const mapped = items.map((item) => ({
    playlistId: item.playlistId,
    title: item.title,
    trackCount: normalizePositiveInt(item.trackCount),
    coverUrl: normalizeString(item.coverUrl) || undefined,
    updatedAtMs: item.updatedAtMs,
  }));
  NETEASE_USER_PLAYLISTS_CACHE.set(NETEASE_CONNECTOR_ID, 'user-playlists', mapped);
  return cloneUserPlaylists(mapped);
}

export async function listNeteasePlaylistTracks(
  playlistId: string,
  options?: {
    forceRefresh?: boolean;
  }
): Promise<NeteaseSongPage | null> {
  const normalizedPlaylistId = normalizeString(playlistId);
  if (!normalizedPlaylistId) return null;

  const cacheKey = `playlist:${normalizedPlaylistId}`;
  if (!options?.forceRefresh) {
    const cached = NETEASE_SONG_PAGE_CACHE.get(NETEASE_CONNECTOR_ID, cacheKey);
    if (cached !== undefined) return cloneSongPage(cached);
  }

  const page = await listNativeNeteasePlaylistTracks(normalizedPlaylistId);
  if (!page) {
    NETEASE_SONG_PAGE_CACHE.set(NETEASE_CONNECTOR_ID, cacheKey, null, 20 * 1000);
    return null;
  }

  const mapped = {
    sourceKind: page.sourceKind,
    sourceId: page.sourceId,
    pageNum: normalizePositiveInt(page.pageNum) || 1,
    pageSize: normalizePositiveInt(page.pageSize) || 1,
    total: normalizePositiveInt(page.total),
    hasMore: page.hasMore,
    items: page.items.map(mapSongItem),
  };
  NETEASE_SONG_PAGE_CACHE.set(NETEASE_CONNECTOR_ID, cacheKey, mapped, 90 * 1000);
  return cloneSongPage(mapped);
}

export async function searchNeteaseSongs(options: {
  keyword: string;
  pageNum?: number;
  pageSize?: number;
  forceRefresh?: boolean;
}): Promise<NeteaseSongPage | null> {
  const keyword = normalizeString(options.keyword);
  if (!keyword) return null;

  const pageNum = normalizePositiveInt(options.pageNum ?? 1) || 1;
  const pageSize = normalizePositiveInt(options.pageSize ?? 40) || 40;
  const cacheKey = `search:${keyword.toLowerCase()}|page=${pageNum}|size=${pageSize}`;
  if (!options.forceRefresh) {
    const cached = NETEASE_SONG_PAGE_CACHE.get(NETEASE_CONNECTOR_ID, cacheKey);
    if (cached !== undefined) return cloneSongPage(cached);
  }

  const page = await searchNativeNeteaseSongs({
    keyword,
    pageNum,
    pageSize,
  });
  if (!page) {
    NETEASE_SONG_PAGE_CACHE.set(NETEASE_CONNECTOR_ID, cacheKey, null, 15 * 1000);
    return null;
  }

  const mapped = {
    sourceKind: page.sourceKind,
    sourceId: page.sourceId,
    pageNum: normalizePositiveInt(page.pageNum) || 1,
    pageSize: normalizePositiveInt(page.pageSize) || 1,
    total: normalizePositiveInt(page.total),
    hasMore: page.hasMore,
    items: page.items.map(mapSongItem),
  };
  NETEASE_SONG_PAGE_CACHE.set(NETEASE_CONNECTOR_ID, cacheKey, mapped, 30 * 1000);
  return cloneSongPage(mapped);
}

export async function prepareNeteaseCachedPlayback(
  sourceLocator: string
): Promise<NeteasePreparedPlayback | null> {
  const normalizedSourceLocator = normalizeString(sourceLocator);
  if (!normalizedSourceLocator) return null;

  const prepared = await prepareNativeNeteaseCachedPlayback(normalizedSourceLocator);
  if (!prepared) return null;

  return {
    sourceLocator: prepared.sourceLocator,
    streamUrl: prepared.streamUrl,
    cachePath: prepared.cachePath,
    mimeType: normalizeString(prepared.mimeType) || undefined,
    durationSeconds: prepared.durationSeconds,
    songId: prepared.songId,
  };
}

export {
  generateNativeNeteaseQrCodeSession,
  getNativeNeteaseAuthStatus,
  logoutNativeNetease,
  pollNativeNeteaseQrCodeSession,
};
