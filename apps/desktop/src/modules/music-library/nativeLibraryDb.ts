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
  trackCount: number;
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
  sourceId?: string;
  quickFingerprint?: string;
  filePath?: string;
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
  playCount: number;
  lastPlayedAtMs?: number;
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

export interface NativeLibrarySourceHealthQuery {
  sourceId?: string;
}

export interface NativeLibrarySourceHealthRecord {
  sourceId: string;
  sourcePath: string;
  sourceDisplayName?: string;
  totalTracks: number;
  availableTracks: number;
  missingTracks: number;
  totalArtists: number;
  totalAlbums: number;
  totalSize: number;
  sourceUpdatedAtMs: number;
  lastTrackUpdatedAtMs?: number;
}

export interface NativeLibraryUserEntryUpsertInput {
  id: string;
  ownerUid: string;
  trackId?: string;
  quickFingerprint?: string;
  cloudContentId?: string;
  displayTitle?: string;
  displayArtist?: string;
  rating?: number;
  tagsJson?: string;
  inCloud?: boolean;
  isMissing?: boolean;
  createdAtMs?: number;
  updatedAtMs?: number;
}

export interface NativeLibraryUserEntryQuery {
  ownerUid?: string;
  limit?: number;
  offset?: number;
  inCloudOnly?: boolean;
  includeMissing?: boolean;
  searchQuery?: string;
}

export interface NativeLibraryUserEntryRecord {
  id: string;
  ownerUid: string;
  trackId?: string;
  quickFingerprint?: string;
  cloudContentId?: string;
  displayTitle?: string;
  displayArtist?: string;
  rating?: number;
  tagsJson?: string;
  inCloud: boolean;
  isMissing: boolean;
  playCount: number;
  lastPlayedAtMs?: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface NativeLibraryFallbackTaskUpsertInput {
  id?: string;
  ownerUid: string;
  entryId: string;
  cloudContentId?: string;
  trackId?: string;
  quickFingerprint?: string;
  reason?: string;
  requestedAtMs?: number;
}

export interface NativeLibraryFallbackTaskQuery {
  ownerUid?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface NativeLibraryFallbackTaskRecord {
  id: string;
  ownerUid: string;
  entryId: string;
  cloudContentId?: string;
  trackId?: string;
  quickFingerprint?: string;
  reason: string;
  status: string;
  enqueueCount: number;
  requestedAtMs: number;
  lastRequestedAtMs: number;
  updatedAtMs: number;
  lastError?: string;
}

export interface NativeLibraryCloudHashJobUpsertInput {
  id?: string;
  ownerUid: string;
  entryId: string;
  trackId?: string;
  quickFingerprint?: string;
  status?: string;
  cloudFullHash?: string;
  lastError?: string;
  requestedAtMs?: number;
}

export interface NativeLibraryCloudHashJobQuery {
  ownerUid?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface NativeLibraryCloudHashJobRecord {
  id: string;
  ownerUid: string;
  entryId: string;
  trackId?: string;
  quickFingerprint?: string;
  status: string;
  cloudFullHash?: string;
  lastError?: string;
  attemptCount: number;
  requestedAtMs: number;
  updatedAtMs: number;
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

function normalizeQuickFingerprint(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return undefined;
  const normalized = raw.replace(/^qf2:/, '');
  if (!/^[0-9a-f]{16,128}$/.test(normalized)) return undefined;
  return `qf2:${normalized}`;
}

function ensureSourceRecord(value: unknown): NativeLibrarySourceRecord | null {
  if (!isRecord(value)) return null;

  const id = asTrimmedString(value.id);
  const path = asTrimmedString(value.path);
  const category = asTrimmedString(value.category) || 'music';
  const isVisible = asBool(value.isVisible);
  const isScanned = asBool(value.isScanned);
  const trackCount = asNumber(value.trackCount);
  const addedAtMs = asNumber(value.addedAtMs);
  const updatedAtMs = asNumber(value.updatedAtMs);

  if (!id || !path || isVisible === undefined || isScanned === undefined) return null;
  if (addedAtMs === undefined || updatedAtMs === undefined) return null;

  return {
    id,
    path,
    displayName: asOptionalString(value.displayName),
    category,
    trackCount: trackCount === undefined ? 0 : Math.max(0, Math.floor(trackCount)),
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
  const playCount = asNumber(value.playCount);
  if (
    !id ||
    !sourceId ||
    !filePath ||
    !status ||
    updatedAtMs === undefined ||
    playCount === undefined
  ) {
    return null;
  }

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
    playCount: Math.max(0, Math.floor(playCount)),
    lastPlayedAtMs: asNumber(value.lastPlayedAtMs),
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

function ensureSourceHealthRecord(value: unknown): NativeLibrarySourceHealthRecord | null {
  if (!isRecord(value)) return null;

  const sourceId = asTrimmedString(value.sourceId);
  const sourcePath = asTrimmedString(value.sourcePath);
  const totalTracks = asNumber(value.totalTracks);
  const availableTracks = asNumber(value.availableTracks);
  const missingTracks = asNumber(value.missingTracks);
  const totalArtists = asNumber(value.totalArtists);
  const totalAlbums = asNumber(value.totalAlbums);
  const totalSize = asNumber(value.totalSize);
  const sourceUpdatedAtMs = asNumber(value.sourceUpdatedAtMs);

  if (!sourceId || !sourcePath) return null;
  if (
    totalTracks === undefined ||
    availableTracks === undefined ||
    missingTracks === undefined ||
    totalArtists === undefined ||
    totalAlbums === undefined ||
    totalSize === undefined ||
    sourceUpdatedAtMs === undefined
  ) {
    return null;
  }

  return {
    sourceId,
    sourcePath,
    sourceDisplayName: asOptionalString(value.sourceDisplayName),
    totalTracks: Math.max(0, Math.floor(totalTracks)),
    availableTracks: Math.max(0, Math.floor(availableTracks)),
    missingTracks: Math.max(0, Math.floor(missingTracks)),
    totalArtists: Math.max(0, Math.floor(totalArtists)),
    totalAlbums: Math.max(0, Math.floor(totalAlbums)),
    totalSize: Math.max(0, Math.floor(totalSize)),
    sourceUpdatedAtMs,
    lastTrackUpdatedAtMs: asNumber(value.lastTrackUpdatedAtMs),
  };
}

function ensureUserEntryRecord(value: unknown): NativeLibraryUserEntryRecord | null {
  if (!isRecord(value)) return null;

  const id = asTrimmedString(value.id);
  const ownerUid = asTrimmedString(value.ownerUid);
  const inCloud = asBool(value.inCloud);
  const isMissing = asBool(value.isMissing);
  const playCount = asNumber(value.playCount);
  const createdAtMs = asNumber(value.createdAtMs);
  const updatedAtMs = asNumber(value.updatedAtMs);
  if (
    !id ||
    !ownerUid ||
    inCloud === undefined ||
    isMissing === undefined ||
    playCount === undefined ||
    createdAtMs === undefined ||
    updatedAtMs === undefined
  ) {
    return null;
  }

  return {
    id,
    ownerUid,
    trackId: asOptionalString(value.trackId),
    quickFingerprint: normalizeQuickFingerprint(value.quickFingerprint),
    cloudContentId: asOptionalString(value.cloudContentId),
    displayTitle: asOptionalString(value.displayTitle),
    displayArtist: asOptionalString(value.displayArtist),
    rating: asNumber(value.rating),
    tagsJson: asOptionalString(value.tagsJson),
    inCloud,
    isMissing,
    playCount: Math.max(0, Math.floor(playCount)),
    lastPlayedAtMs: asNumber(value.lastPlayedAtMs),
    createdAtMs,
    updatedAtMs,
  };
}

function ensureFallbackTaskRecord(value: unknown): NativeLibraryFallbackTaskRecord | null {
  if (!isRecord(value)) return null;

  const id = asTrimmedString(value.id);
  const ownerUid = asTrimmedString(value.ownerUid);
  const entryId = asTrimmedString(value.entryId);
  const reason = asTrimmedString(value.reason);
  const status = asTrimmedString(value.status);
  const enqueueCount = asNumber(value.enqueueCount);
  const requestedAtMs = asNumber(value.requestedAtMs);
  const lastRequestedAtMs = asNumber(value.lastRequestedAtMs);
  const updatedAtMs = asNumber(value.updatedAtMs);
  if (
    !id ||
    !ownerUid ||
    !entryId ||
    !reason ||
    !status ||
    enqueueCount === undefined ||
    requestedAtMs === undefined ||
    lastRequestedAtMs === undefined ||
    updatedAtMs === undefined
  ) {
    return null;
  }

  return {
    id,
    ownerUid,
    entryId,
    cloudContentId: asOptionalString(value.cloudContentId),
    trackId: asOptionalString(value.trackId),
    quickFingerprint: normalizeQuickFingerprint(value.quickFingerprint),
    reason,
    status,
    enqueueCount: Math.max(0, Math.floor(enqueueCount)),
    requestedAtMs,
    lastRequestedAtMs,
    updatedAtMs,
    lastError: asOptionalString(value.lastError),
  };
}

function ensureCloudHashJobRecord(value: unknown): NativeLibraryCloudHashJobRecord | null {
  if (!isRecord(value)) return null;

  const id = asTrimmedString(value.id);
  const ownerUid = asTrimmedString(value.ownerUid);
  const entryId = asTrimmedString(value.entryId);
  const status = asTrimmedString(value.status);
  const attemptCount = asNumber(value.attemptCount);
  const requestedAtMs = asNumber(value.requestedAtMs);
  const updatedAtMs = asNumber(value.updatedAtMs);
  if (
    !id ||
    !ownerUid ||
    !entryId ||
    !status ||
    attemptCount === undefined ||
    requestedAtMs === undefined ||
    updatedAtMs === undefined
  ) {
    return null;
  }

  return {
    id,
    ownerUid,
    entryId,
    trackId: asOptionalString(value.trackId),
    quickFingerprint: normalizeQuickFingerprint(value.quickFingerprint),
    status,
    cloudFullHash: asOptionalString(value.cloudFullHash),
    lastError: asOptionalString(value.lastError),
    attemptCount: Math.max(0, Math.floor(attemptCount)),
    requestedAtMs,
    updatedAtMs,
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

export async function clearNativeLibraryTracks(): Promise<number> {
  if (!isTauriRuntime()) return 0;
  const raw = await invoke<unknown>('music_library_db_clear_tracks').catch(() => null);
  const parsed = asNumber(raw);
  if (parsed === undefined) return 0;
  return Math.max(0, Math.floor(parsed));
}

export async function deleteNativeLibraryTracks(trackIds: string[]): Promise<number> {
  if (!isTauriRuntime()) return 0;

  const normalizedIds = trackIds
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter((id) => id.length > 0);

  if (normalizedIds.length === 0) return 0;

  const raw = await invoke<unknown>('music_library_db_delete_tracks', {
    trackIds: normalizedIds,
  }).catch(() => null);

  const parsed = asNumber(raw);
  if (parsed === undefined) return 0;
  return Math.max(0, Math.floor(parsed));
}

export async function markNativeLibraryTrackPlayed(
  trackId: string,
  options?: { playedAtMs?: number }
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const normalizedTrackId = trackId.trim();
  if (!normalizedTrackId) return false;

  const playedAtMs =
    typeof options?.playedAtMs === 'number' && Number.isFinite(options.playedAtMs)
      ? Math.max(0, Math.floor(options.playedAtMs))
      : undefined;

  const raw = await invoke<unknown>('music_library_db_mark_track_played', {
    trackId: normalizedTrackId,
    playedAtMs,
  }).catch(() => null);

  return raw === true;
}

export async function listNativeLibrarySourceHealth(
  query?: NativeLibrarySourceHealthQuery
): Promise<NativeLibrarySourceHealthRecord[]> {
  if (!isTauriRuntime()) return [];

  const sourceId =
    typeof query?.sourceId === 'string' && query.sourceId.trim().length > 0
      ? query.sourceId.trim()
      : undefined;

  const raw = await invoke<unknown>('music_library_db_list_source_health', {
    query: {
      sourceId,
    },
  }).catch(() => null);

  if (!Array.isArray(raw)) return [];

  const result: NativeLibrarySourceHealthRecord[] = [];
  for (const item of raw) {
    const parsed = ensureSourceHealthRecord(item);
    if (!parsed) continue;
    result.push(parsed);
  }
  return result;
}

export async function cleanupNativeLibrarySourceTracks(
  sourceId: string,
  options?: { missingOnly?: boolean }
): Promise<number> {
  if (!isTauriRuntime()) return 0;
  const normalizedSourceId = sourceId.trim();
  if (!normalizedSourceId) return 0;

  const raw = await invoke<unknown>('music_library_db_cleanup_source_tracks', {
    sourceId: normalizedSourceId,
    missingOnly: options?.missingOnly !== false,
  }).catch(() => null);

  const parsed = asNumber(raw);
  if (parsed === undefined) return 0;
  return Math.max(0, Math.floor(parsed));
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
    sourceId:
      typeof query?.sourceId === 'string' && query.sourceId.trim().length > 0
        ? query.sourceId.trim()
        : undefined,
    quickFingerprint: normalizeQuickFingerprint(query?.quickFingerprint),
    filePath:
      typeof query?.filePath === 'string' && query.filePath.trim().length > 0
        ? query.filePath.trim()
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

export async function upsertNativeLibraryUserEntry(
  entry: NativeLibraryUserEntryUpsertInput
): Promise<NativeLibraryUserEntryRecord | null> {
  if (!isTauriRuntime()) return null;

  const payload: NativeLibraryUserEntryUpsertInput = {
    ...entry,
    id: asTrimmedString(entry.id),
    ownerUid: asTrimmedString(entry.ownerUid),
    trackId: asOptionalString(entry.trackId),
    quickFingerprint: normalizeQuickFingerprint(entry.quickFingerprint),
    cloudContentId: asOptionalString(entry.cloudContentId),
    displayTitle: asOptionalString(entry.displayTitle),
    displayArtist: asOptionalString(entry.displayArtist),
    rating:
      typeof entry.rating === 'number' && Number.isFinite(entry.rating)
        ? Math.max(0, Math.min(100, Math.floor(entry.rating)))
        : undefined,
    tagsJson: asOptionalString(entry.tagsJson),
    inCloud: entry.inCloud === true,
    isMissing: entry.isMissing === true,
    createdAtMs:
      typeof entry.createdAtMs === 'number' && Number.isFinite(entry.createdAtMs)
        ? Math.max(0, Math.floor(entry.createdAtMs))
        : undefined,
    updatedAtMs:
      typeof entry.updatedAtMs === 'number' && Number.isFinite(entry.updatedAtMs)
        ? Math.max(0, Math.floor(entry.updatedAtMs))
        : undefined,
  };

  if (!payload.id || !payload.ownerUid) return null;

  const raw = await invoke<unknown>('music_library_db_upsert_user_entry', {
    entry: payload,
  }).catch(() => null);
  return ensureUserEntryRecord(raw);
}

export async function listNativeLibraryUserEntries(
  query?: NativeLibraryUserEntryQuery
): Promise<NativeLibraryUserEntryRecord[]> {
  if (!isTauriRuntime()) return [];

  const payload: NativeLibraryUserEntryQuery = {
    ownerUid:
      typeof query?.ownerUid === 'string' && query.ownerUid.trim().length > 0
        ? query.ownerUid.trim()
        : undefined,
    limit:
      typeof query?.limit === 'number' && Number.isFinite(query.limit)
        ? Math.max(1, Math.min(2000, Math.floor(query.limit)))
        : undefined,
    offset:
      typeof query?.offset === 'number' && Number.isFinite(query.offset)
        ? Math.max(0, Math.floor(query.offset))
        : undefined,
    inCloudOnly: query?.inCloudOnly === true,
    includeMissing: query?.includeMissing !== false,
    searchQuery:
      typeof query?.searchQuery === 'string' && query.searchQuery.trim().length > 0
        ? query.searchQuery.trim()
        : undefined,
  };

  const raw = await invoke<unknown>('music_library_db_list_user_entries', {
    query: payload,
  }).catch(() => null);
  if (!Array.isArray(raw)) return [];

  const entries: NativeLibraryUserEntryRecord[] = [];
  for (const item of raw) {
    const parsed = ensureUserEntryRecord(item);
    if (!parsed) continue;
    entries.push(parsed);
  }
  return entries;
}

export async function deleteNativeLibraryUserEntry(entryId: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const normalizedEntryId = entryId.trim();
  if (!normalizedEntryId) return false;

  const raw = await invoke<unknown>('music_library_db_delete_user_entry', {
    entryId: normalizedEntryId,
  }).catch(() => null);
  return raw === true;
}

export async function markNativeLibraryUserEntryPlayed(
  entryId: string,
  options?: { playedAtMs?: number }
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const normalizedEntryId = entryId.trim();
  if (!normalizedEntryId) return false;

  const playedAtMs =
    typeof options?.playedAtMs === 'number' && Number.isFinite(options.playedAtMs)
      ? Math.max(0, Math.floor(options.playedAtMs))
      : undefined;

  const raw = await invoke<unknown>('music_library_db_mark_user_entry_played', {
    entryId: normalizedEntryId,
    playedAtMs,
  }).catch(() => null);
  return raw === true;
}

export async function upsertNativeLibraryFallbackTask(
  task: NativeLibraryFallbackTaskUpsertInput
): Promise<NativeLibraryFallbackTaskRecord | null> {
  if (!isTauriRuntime()) return null;

  const payload: NativeLibraryFallbackTaskUpsertInput = {
    ...task,
    id: asOptionalString(task.id),
    ownerUid: asTrimmedString(task.ownerUid),
    entryId: asTrimmedString(task.entryId),
    cloudContentId: asOptionalString(task.cloudContentId),
    trackId: asOptionalString(task.trackId),
    quickFingerprint: normalizeQuickFingerprint(task.quickFingerprint),
    reason: asOptionalString(task.reason),
    requestedAtMs:
      typeof task.requestedAtMs === 'number' && Number.isFinite(task.requestedAtMs)
        ? Math.max(0, Math.floor(task.requestedAtMs))
        : undefined,
  };

  if (!payload.ownerUid || !payload.entryId) return null;

  const raw = await invoke<unknown>('music_library_db_upsert_fallback_task', {
    task: payload,
  }).catch(() => null);
  return ensureFallbackTaskRecord(raw);
}

export async function listNativeLibraryFallbackTasks(
  query?: NativeLibraryFallbackTaskQuery
): Promise<NativeLibraryFallbackTaskRecord[]> {
  if (!isTauriRuntime()) return [];

  const payload: NativeLibraryFallbackTaskQuery = {
    ownerUid:
      typeof query?.ownerUid === 'string' && query.ownerUid.trim().length > 0
        ? query.ownerUid.trim()
        : undefined,
    status:
      typeof query?.status === 'string' && query.status.trim().length > 0
        ? query.status.trim()
        : undefined,
    limit:
      typeof query?.limit === 'number' && Number.isFinite(query.limit)
        ? Math.max(1, Math.min(2000, Math.floor(query.limit)))
        : undefined,
    offset:
      typeof query?.offset === 'number' && Number.isFinite(query.offset)
        ? Math.max(0, Math.floor(query.offset))
        : undefined,
  };

  const raw = await invoke<unknown>('music_library_db_list_fallback_tasks', {
    query: payload,
  }).catch(() => null);
  if (!Array.isArray(raw)) return [];

  const tasks: NativeLibraryFallbackTaskRecord[] = [];
  for (const item of raw) {
    const parsed = ensureFallbackTaskRecord(item);
    if (!parsed) continue;
    tasks.push(parsed);
  }
  return tasks;
}

export async function updateNativeLibraryFallbackTaskStatus(
  taskId: string,
  status: string,
  options?: { lastError?: string }
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const normalizedTaskId = taskId.trim();
  const normalizedStatus = status.trim();
  if (!normalizedTaskId || !normalizedStatus) return false;

  const raw = await invoke<unknown>('music_library_db_update_fallback_task_status', {
    taskId: normalizedTaskId,
    status: normalizedStatus,
    lastError: asOptionalString(options?.lastError),
  }).catch(() => null);
  return raw === true;
}

export async function upsertNativeLibraryCloudHashJob(
  job: NativeLibraryCloudHashJobUpsertInput
): Promise<NativeLibraryCloudHashJobRecord | null> {
  if (!isTauriRuntime()) return null;

  const payload: NativeLibraryCloudHashJobUpsertInput = {
    ...job,
    id: asOptionalString(job.id),
    ownerUid: asTrimmedString(job.ownerUid),
    entryId: asTrimmedString(job.entryId),
    trackId: asOptionalString(job.trackId),
    quickFingerprint: normalizeQuickFingerprint(job.quickFingerprint),
    status: asOptionalString(job.status),
    cloudFullHash: asOptionalString(job.cloudFullHash),
    lastError: asOptionalString(job.lastError),
    requestedAtMs:
      typeof job.requestedAtMs === 'number' && Number.isFinite(job.requestedAtMs)
        ? Math.max(0, Math.floor(job.requestedAtMs))
        : undefined,
  };

  if (!payload.ownerUid || !payload.entryId) return null;

  const raw = await invoke<unknown>('music_library_db_upsert_cloud_hash_job', {
    job: payload,
  }).catch(() => null);
  return ensureCloudHashJobRecord(raw);
}

export async function listNativeLibraryCloudHashJobs(
  query?: NativeLibraryCloudHashJobQuery
): Promise<NativeLibraryCloudHashJobRecord[]> {
  if (!isTauriRuntime()) return [];

  const payload: NativeLibraryCloudHashJobQuery = {
    ownerUid:
      typeof query?.ownerUid === 'string' && query.ownerUid.trim().length > 0
        ? query.ownerUid.trim()
        : undefined,
    status:
      typeof query?.status === 'string' && query.status.trim().length > 0
        ? query.status.trim()
        : undefined,
    limit:
      typeof query?.limit === 'number' && Number.isFinite(query.limit)
        ? Math.max(1, Math.min(2000, Math.floor(query.limit)))
        : undefined,
    offset:
      typeof query?.offset === 'number' && Number.isFinite(query.offset)
        ? Math.max(0, Math.floor(query.offset))
        : undefined,
  };

  const raw = await invoke<unknown>('music_library_db_list_cloud_hash_jobs', {
    query: payload,
  }).catch(() => null);
  if (!Array.isArray(raw)) return [];

  const jobs: NativeLibraryCloudHashJobRecord[] = [];
  for (const item of raw) {
    const parsed = ensureCloudHashJobRecord(item);
    if (!parsed) continue;
    jobs.push(parsed);
  }
  return jobs;
}

export async function updateNativeLibraryCloudHashJobStatus(
  jobId: string,
  status: string,
  options?: { cloudFullHash?: string; lastError?: string }
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const normalizedJobId = jobId.trim();
  const normalizedStatus = status.trim();
  if (!normalizedJobId || !normalizedStatus) return false;

  const raw = await invoke<unknown>('music_library_db_update_cloud_hash_job_status', {
    jobId: normalizedJobId,
    status: normalizedStatus,
    cloudFullHash: asOptionalString(options?.cloudFullHash),
    lastError: asOptionalString(options?.lastError),
  }).catch(() => null);
  return raw === true;
}
