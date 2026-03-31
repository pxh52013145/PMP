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

export async function listNeteaseRecommendedPlaylists(): Promise<NeteaseRecommendedPlaylistItem[]> {
  const items = await listNativeNeteaseRecommendedPlaylists();
  return items.map((item) => ({
    playlistId: item.playlistId,
    title: item.title,
    trackCount: normalizePositiveInt(item.trackCount),
    coverUrl: normalizeString(item.coverUrl) || undefined,
  }));
}

export async function listNeteaseRecommendedSongs(): Promise<NeteaseSongPage | null> {
  const page = await listNativeNeteaseRecommendedSongs();
  if (!page) return null;

  return {
    sourceKind: page.sourceKind,
    sourceId: page.sourceId,
    pageNum: normalizePositiveInt(page.pageNum) || 1,
    pageSize: normalizePositiveInt(page.pageSize) || 1,
    total: normalizePositiveInt(page.total),
    hasMore: page.hasMore,
    items: page.items.map(mapSongItem),
  };
}

export async function listNeteaseUserPlaylists(): Promise<NeteaseUserPlaylistItem[]> {
  const items = await listNativeNeteaseUserPlaylists();
  return items.map((item) => ({
    playlistId: item.playlistId,
    title: item.title,
    trackCount: normalizePositiveInt(item.trackCount),
    coverUrl: normalizeString(item.coverUrl) || undefined,
    updatedAtMs: item.updatedAtMs,
  }));
}

export async function listNeteasePlaylistTracks(
  playlistId: string
): Promise<NeteaseSongPage | null> {
  const normalizedPlaylistId = normalizeString(playlistId);
  if (!normalizedPlaylistId) return null;

  const page = await listNativeNeteasePlaylistTracks(normalizedPlaylistId);
  if (!page) return null;

  return {
    sourceKind: page.sourceKind,
    sourceId: page.sourceId,
    pageNum: normalizePositiveInt(page.pageNum) || 1,
    pageSize: normalizePositiveInt(page.pageSize) || 1,
    total: normalizePositiveInt(page.total),
    hasMore: page.hasMore,
    items: page.items.map(mapSongItem),
  };
}

export async function searchNeteaseSongs(options: {
  keyword: string;
  pageNum?: number;
  pageSize?: number;
}): Promise<NeteaseSongPage | null> {
  const keyword = normalizeString(options.keyword);
  if (!keyword) return null;

  const page = await searchNativeNeteaseSongs({
    keyword,
    pageNum: options.pageNum,
    pageSize: options.pageSize,
  });
  if (!page) return null;

  return {
    sourceKind: page.sourceKind,
    sourceId: page.sourceId,
    pageNum: normalizePositiveInt(page.pageNum) || 1,
    pageSize: normalizePositiveInt(page.pageSize) || 1,
    total: normalizePositiveInt(page.total),
    hasMore: page.hasMore,
    items: page.items.map(mapSongItem),
  };
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
