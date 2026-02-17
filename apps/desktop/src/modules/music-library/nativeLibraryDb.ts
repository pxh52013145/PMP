import { invoke } from '@tauri-apps/api/tauri';
import { isTauriRuntime } from '../../utils/tauriRuntime';

export interface NativeLibrarySourceUpsertInput {
  id: string;
  path: string;
  displayName?: string;
  category?: string;
  isVisible?: boolean;
  isScanned?: boolean;
  addedAtMs?: number;
  lastScannedAtMs?: number;
}

export interface NativeLibrarySourceRecord {
  id: string;
  path: string;
  displayName?: string;
  category: string;
  isVisible: boolean;
  isScanned: boolean;
  addedAtMs: number;
  lastScannedAtMs?: number;
  updatedAtMs: number;
}

export interface NativeLibraryTrackUpsertInput {
  id: string;
  filePath: string;
  quickFingerprint?: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  duration?: number;
  sampleRate?: number;
  bitDepth?: number;
  fileSize?: number;
  mtimeMs?: number;
  replayGainTrackDb?: number;
  replayGainAlbumDb?: number;
}

export interface NativeLibraryTrackSyncResult {
  upserted: number;
  markedMissing: number;
}

export interface NativeLibraryTrackQuery {
  limit?: number;
  offset?: number;
  includeMissing?: boolean;
  visibleOnly?: boolean;
  searchQuery?: string;
  artist?: string;
  album?: string;
  trackId?: string;
}

export interface NativeLibraryTrackRecord {
  id: string;
  sourceId: string;
  filePath: string;
  quickFingerprint?: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  durationSeconds?: number;
  sampleRate?: number;
  bitDepth?: number;
  fileSize?: number;
  mtimeMs?: number;
  replayGainTrackDb?: number;
  replayGainAlbumDb?: number;
  status: string;
  updatedAtMs: number;
}

export interface NativeLibraryFacetQuery {
  includeMissing?: boolean;
  visibleOnly?: boolean;
}

export interface NativeLibraryAlbumRecord {
  album: string;
  artist: string;
  coverTrackId: string;
  coverTrackPath: string;
}

export interface NativeLibraryStatsRecord {
  totalTracks: number;
  totalArtists: number;
  totalAlbums: number;
  totalSize: number;
  totalDuration: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asOptionalString(value: unknown): string | undefined {
  const normalized = asTrimmedString(value);
  return normalized || undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function ensureSourceRecord(value: unknown): NativeLibrarySourceRecord | null {
  if (!isRecord(value)) return null;

  const id = asTrimmedString(value.id);
  const path = asTrimmedString(value.path);
  const category = asTrimmedString(value.category) || 'music';
  const isVisible = asBool(value.isVisible);
  const isScanned = asBool(value.isScanned);
  const addedAtMs = asNumber(value.addedAtMs);
  const updatedAtMs = asNumber(value.updatedAtMs);

  if (!id || !path || isVisible === undefined || isScanned === undefined) return null;
  if (addedAtMs === undefined || updatedAtMs === undefined) return null;

  return {
    id,
    path,
    displayName: asOptionalString(value.displayName),
    category,
    isVisible,
    isScanned,
    addedAtMs,
    lastScannedAtMs: asNumber(value.lastScannedAtMs),
    updatedAtMs,
  };
}

function ensureTrackSyncResult(value: unknown): NativeLibraryTrackSyncResult | null {
  if (!isRecord(value)) return null;
  const upserted = asNumber(value.upserted);
  const markedMissing = asNumber(value.markedMissing);
  if (upserted === undefined || markedMissing === undefined) return null;
  return {
    upserted,
    markedMissing,
  };
}

function ensureTrackRecord(value: unknown): NativeLibraryTrackRecord | null {
  if (!isRecord(value)) return null;
  const id = asTrimmedString(value.id);
  const sourceId = asTrimmedString(value.sourceId);
  const filePath = asTrimmedString(value.filePath);
  const status = asTrimmedString(value.status);
  const updatedAtMs = asNumber(value.updatedAtMs);
  if (!id || !sourceId || !filePath || !status || updatedAtMs === undefined) return null;

  return {
    id,
    sourceId,
    filePath,
    quickFingerprint: asOptionalString(value.quickFingerprint),
    title: asOptionalString(value.title),
    artist: asOptionalString(value.artist),
    album: asOptionalString(value.album),
    genre: asOptionalString(value.genre),
    durationSeconds: asNumber(value.durationSeconds),
    sampleRate: asNumber(value.sampleRate),
    bitDepth: asNumber(value.bitDepth),
    fileSize: asNumber(value.fileSize),
    mtimeMs: asNumber(value.mtimeMs),
    replayGainTrackDb: asNumber(value.replayGainTrackDb),
    replayGainAlbumDb: asNumber(value.replayGainAlbumDb),
    status,
    updatedAtMs,
  };
}

function normalizeFacetQuery(query?: NativeLibraryFacetQuery): NativeLibraryFacetQuery {
  return {
    includeMissing: query?.includeMissing === true,
    visibleOnly: query?.visibleOnly !== false,
  };
}

function ensureAlbumRecord(value: unknown): NativeLibraryAlbumRecord | null {
  if (!isRecord(value)) return null;

  const album = asTrimmedString(value.album);
  const artist = asTrimmedString(value.artist);
  const coverTrackId = asTrimmedString(value.coverTrackId);
  const coverTrackPath = asTrimmedString(value.coverTrackPath);
  if (!album || !artist || !coverTrackId || !coverTrackPath) return null;

  return {
    album,
    artist,
    coverTrackId,
    coverTrackPath,
  };
}

function ensureStatsRecord(value: unknown): NativeLibraryStatsRecord | null {
  if (!isRecord(value)) return null;

  const totalTracks = asNumber(value.totalTracks);
  const totalArtists = asNumber(value.totalArtists);
  const totalAlbums = asNumber(value.totalAlbums);
  const totalSize = asNumber(value.totalSize);
  const totalDuration = asNumber(value.totalDuration);
  if (
    totalTracks === undefined ||
    totalArtists === undefined ||
    totalAlbums === undefined ||
    totalSize === undefined ||
    totalDuration === undefined
  ) {
    return null;
  }

  return {
    totalTracks,
    totalArtists,
    totalAlbums,
    totalSize,
    totalDuration,
  };
}

export async function upsertNativeLibrarySource(
  source: NativeLibrarySourceUpsertInput
): Promise<NativeLibrarySourceRecord | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invoke<unknown>('music_library_db_upsert_source', { source }).catch(() => null);
  return ensureSourceRecord(raw);
}

export async function listNativeLibrarySources(): Promise<NativeLibrarySourceRecord[]> {
  if (!isTauriRuntime()) return [];
  const raw = await invoke<unknown>('music_library_db_list_sources').catch(() => null);
  if (!Array.isArray(raw)) return [];

  const result: NativeLibrarySourceRecord[] = [];
  for (const item of raw) {
    const parsed = ensureSourceRecord(item);
    if (!parsed) continue;
    result.push(parsed);
  }
  return result;
}

export async function removeNativeLibrarySource(sourceId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  const normalized = sourceId.trim();
  if (!normalized) return;
  await invoke('music_library_db_remove_source', { sourceId: normalized });
}

export async function syncNativeLibraryTracks(
  sourceId: string,
  upserts: NativeLibraryTrackUpsertInput[],
  missingTrackIds: string[]
): Promise<NativeLibraryTrackSyncResult | null> {
  if (!isTauriRuntime()) return null;
  const normalizedSourceId = sourceId.trim();
  if (!normalizedSourceId) return null;

  const raw = await invoke<unknown>('music_library_db_sync_tracks', {
    sourceId: normalizedSourceId,
    upserts,
    missingTrackIds,
  }).catch(() => null);

  return ensureTrackSyncResult(raw);
}

export async function queryNativeLibraryTracks(
  query?: NativeLibraryTrackQuery
): Promise<NativeLibraryTrackRecord[]> {
  if (!isTauriRuntime()) return [];

  const payload: NativeLibraryTrackQuery = {
    limit:
      typeof query?.limit === 'number' && Number.isFinite(query.limit)
        ? Math.max(1, Math.min(2000, Math.floor(query.limit)))
        : undefined,
    offset:
      typeof query?.offset === 'number' && Number.isFinite(query.offset)
        ? Math.max(0, Math.floor(query.offset))
        : undefined,
    includeMissing: query?.includeMissing === true,
    visibleOnly: query?.visibleOnly !== false,
    searchQuery:
      typeof query?.searchQuery === 'string' && query.searchQuery.trim().length > 0
        ? query.searchQuery.trim()
        : undefined,
    artist:
      typeof query?.artist === 'string' && query.artist.trim().length > 0
        ? query.artist.trim()
        : undefined,
    album:
      typeof query?.album === 'string' && query.album.trim().length > 0
        ? query.album.trim()
        : undefined,
    trackId:
      typeof query?.trackId === 'string' && query.trackId.trim().length > 0
        ? query.trackId.trim()
        : undefined,
  };

  const raw = await invoke<unknown>('music_library_db_query_tracks', { query: payload }).catch(
    () => null
  );
  if (!Array.isArray(raw)) return [];

  const tracks: NativeLibraryTrackRecord[] = [];
  for (const item of raw) {
    const parsed = ensureTrackRecord(item);
    if (!parsed) continue;
    tracks.push(parsed);
  }
  return tracks;
}

export async function listNativeLibraryArtists(query?: NativeLibraryFacetQuery): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  const raw = await invoke<unknown>('music_library_db_list_artists', {
    query: normalizeFacetQuery(query),
  }).catch(() => null);

  if (!Array.isArray(raw)) return [];
  const artists: string[] = [];
  for (const item of raw) {
    const normalized = asTrimmedString(item);
    if (!normalized) continue;
    artists.push(normalized);
  }
  return artists;
}

export async function listNativeLibraryGenres(query?: NativeLibraryFacetQuery): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  const raw = await invoke<unknown>('music_library_db_list_genres', {
    query: normalizeFacetQuery(query),
  }).catch(() => null);

  if (!Array.isArray(raw)) return [];
  const genres: string[] = [];
  for (const item of raw) {
    const normalized = asTrimmedString(item);
    if (!normalized) continue;
    genres.push(normalized);
  }
  return genres;
}

export async function listNativeLibraryAlbums(
  query?: NativeLibraryFacetQuery
): Promise<NativeLibraryAlbumRecord[]> {
  if (!isTauriRuntime()) return [];
  const raw = await invoke<unknown>('music_library_db_list_albums', {
    query: normalizeFacetQuery(query),
  }).catch(() => null);

  if (!Array.isArray(raw)) return [];
  const albums: NativeLibraryAlbumRecord[] = [];
  for (const item of raw) {
    const parsed = ensureAlbumRecord(item);
    if (!parsed) continue;
    albums.push(parsed);
  }
  return albums;
}

export async function getNativeLibraryStats(
  query?: NativeLibraryFacetQuery
): Promise<NativeLibraryStatsRecord | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invoke<unknown>('music_library_db_get_stats', {
    query: normalizeFacetQuery(query),
  }).catch(() => null);
  return ensureStatsRecord(raw);
}
