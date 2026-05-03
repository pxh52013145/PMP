import {
  clearNativeLibraryPlaylistItems,
  deleteNativeLibraryPlaylist,
  listNativeLibraryPlaylistItems,
  listNativeLibraryPlaylists,
  prependNativeLibraryPlaylistItem,
  queryNativeLibraryPlaylistTracksPage,
  queryNativeLibraryTracks,
  removeNativeLibraryPlaylistItemAt,
  replaceNativeLibraryPlaylistItems,
  touchNativeLibraryPlaylistOpened,
  upsertNativeLibraryPlaylist,
  type NativeLibraryPlaylistItemRecord,
  type NativeLibraryPlaylistRecord,
  type NativeLibraryTrackRecord,
} from '../../modules/music-library';
import { resolvePlaylistTrackIndexes } from '../../modules/playlists/runtimeProjection';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { getTelemetryLogger } from '../telemetry/TelemetryService';
import {
  serializeTrackForPlaylist,
  toPlaylistItemUpserts,
} from './recentSmartPlaylist';
import { prependTrackWithDedup } from './trackIdentity';
import { compactTrackForPlaylistState } from './trackStateProjection';
import type {
  Playlist,
  PlaylistCreateOptions,
  PlaylistTrackPageResult,
  PlaylistTrackSortDirection,
  PlaylistTrackSortField,
  Track,
} from './types';

const PLAYLIST_OWNER_UID = 'local:default';
const PLAYLIST_KIND_MANUAL = 'manual';
const PLAYLIST_KIND_SMART = 'smart';
const PLAYLIST_KIND_PLATFORM = 'platform';
const PLAYLIST_QUERY_LIMIT = 1000;
const PLAYLIST_QUEUE_PAGE_SIZE = 120;
const SMART_PLAYLIST_RECENT_ID = 'smart-recently-played';
const SMART_PLAYLIST_RECENT_NAME = 'Recently Played';
const SMART_PLAYLIST_RECENT_LIMIT = 1000;

function readTelemetryErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function sanitizePlaylistCoverUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;

  const lower = normalized.toLowerCase();
  if (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('pmp://cover/') ||
    lower.startsWith('pmp://localhost/cover/')
  ) {
    return normalized;
  }

  return undefined;
}

function isReadonlyPlaylist(playlist: Playlist | null | undefined): boolean {
  if (!playlist) return false;
  if (playlist.readonly === true) return true;
  return playlist.kind === PLAYLIST_KIND_SMART;
}

function createPlaylistSummaryFromRecord(record: NativeLibraryPlaylistRecord): Playlist {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    coverUrl: sanitizePlaylistCoverUrl(record.coverUrl),
    tracks: [],
    kind: record.kind,
    readonly: record.isReadonly,
    sourceConnectorId: record.sourceConnectorId,
    sourcePlaylistId: record.sourcePlaylistId,
    smartRuleJson: record.smartRuleJson,
    createdAt: record.createdAtMs,
    updatedAt: record.updatedAtMs,
    trackCount: Math.max(0, Math.floor(record.trackCount)),
    totalDuration: Math.max(0, record.totalDuration),
    tracksHydrated: false,
  };
}

function createHydratedPlaylist(
  playlist: Playlist,
  tracks: Track[],
  options?: { trackCount?: number; totalDuration?: number }
): Playlist {
  const computedTotalDuration = tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0);
  return {
    ...playlist,
    tracks,
    trackCount:
      typeof options?.trackCount === 'number' && Number.isFinite(options.trackCount)
        ? Math.max(0, Math.floor(options.trackCount))
        : tracks.length,
    totalDuration:
      typeof options?.totalDuration === 'number' && Number.isFinite(options.totalDuration)
        ? Math.max(0, options.totalDuration)
        : computedTotalDuration,
    tracksHydrated: true,
  };
}

function createPlaylistSummaryReference(playlist: Playlist | null | undefined): Playlist | null {
  if (!playlist) return null;

  return {
    ...playlist,
    tracks: [],
    trackCount:
      typeof playlist.trackCount === 'number' && Number.isFinite(playlist.trackCount)
        ? Math.max(0, Math.floor(playlist.trackCount))
        : playlist.tracks.length,
    totalDuration:
      typeof playlist.totalDuration === 'number' && Number.isFinite(playlist.totalDuration)
        ? Math.max(0, playlist.totalDuration)
        : playlist.tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0),
    tracksHydrated: false,
  };
}

function createPlaylistFromNativeRecord(
  record: NativeLibraryPlaylistRecord,
  options?: { tracks?: Track[]; tracksHydrated?: boolean }
): Playlist {
  const summary = createPlaylistSummaryFromRecord(record);
  const tracksHydrated = options?.tracksHydrated === true;
  return {
    ...summary,
    tracks: tracksHydrated ? [...(options?.tracks ?? [])] : [],
    tracksHydrated,
  };
}

export interface AudioPlaylistShellHost {
  getState(): { playlists: Playlist[]; currentPlaylist: Playlist | null };
  getPlaylists(): Playlist[];
  getPlaylist(playlistId: string): Playlist | null;
  replacePlaylists(playlists: Playlist[], currentPlaylist?: Playlist | null): void;
}

export function parseTrackFromPlaylistPayload(
  payloadJson?: string,
  fallback?: {
    id?: string;
    title?: string;
    artist?: string;
    album?: string;
    duration?: number;
  }
): Track | null {
  let record: Record<string, unknown> | null = null;
  if (typeof payloadJson === 'string' && payloadJson.trim().length > 0) {
    try {
      const parsed = JSON.parse(payloadJson) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        record = parsed as Record<string, unknown>;
      }
    } catch {
      record = null;
    }
  }

  const asString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  const asNumber = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;

  const id = asString(record?.id) ?? fallback?.id?.trim();
  const title = asString(record?.title) ?? fallback?.title?.trim();
  if (!id || !title) return null;

  return compactTrackForPlaylistState({
    id,
    title,
    artist: asString(record?.artist) ?? fallback?.artist,
    album: asString(record?.album) ?? fallback?.album,
    albumArtist: asString(record?.albumArtist),
    duration: asNumber(record?.duration) ?? fallback?.duration,
    path: asString(record?.path),
    filePath: asString(record?.filePath),
    originalPath: asString(record?.originalPath),
    libraryPathId: asString(record?.libraryPathId),
    mtimeMs: asNumber(record?.mtimeMs),
    quickFingerprint: asString(record?.quickFingerprint),
    coverKey: asString(record?.coverKey),
    coverUrl: asString(record?.coverUrl),
    year: asNumber(record?.year),
    genre: asString(record?.genre),
    trackNumber: asNumber(record?.trackNumber),
    discNumber: asNumber(record?.discNumber),
    composer: asString(record?.composer),
    bitrate: asNumber(record?.bitrate),
    sampleRate: asNumber(record?.sampleRate),
    replayGainTrackGainDb: asNumber(record?.replayGainTrackGainDb),
    replayGainAlbumGainDb: asNumber(record?.replayGainAlbumGainDb),
    format: asString(record?.format),
    codecName: asString(record?.codecName),
    fileSize: asNumber(record?.fileSize),
    dateAdded: asNumber(record?.dateAdded),
    lastPlayed: asNumber(record?.lastPlayed),
    playCount: asNumber(record?.playCount),
    rating: asNumber(record?.rating),
    favorite: typeof record?.favorite === 'boolean' ? (record.favorite as boolean) : undefined,
    tags: Array.isArray(record?.tags)
      ? (record.tags as unknown[])
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .map((value) => value.trim())
      : undefined,
    lyrics: asString(record?.lyrics),
    comment: asString(record?.comment),
    mimeType: asString(record?.mimeType),
  });
}

export function parseTracksFromPlaylistItems(
  playlistId: string,
  items: NativeLibraryPlaylistItemRecord[]
): Track[] {
  const tracks: Track[] = [];
  for (const item of items) {
    const fallbackId = item.localTrackId || item.entryId || `${playlistId}::${item.position}`;
    const track = parseTrackFromPlaylistPayload(item.trackPayloadJson, {
      id: fallbackId,
      title: item.snapshotTitle,
      artist: item.snapshotArtist,
      album: item.snapshotAlbum,
      duration: item.snapshotDurationSeconds,
    });
    if (!track) continue;
    tracks.push(track);
  }
  return tracks;
}

function queryPlaylistTrackPageFromTracks(
  tracks: Track[],
  options?: {
    searchQuery?: string;
    sortField?: PlaylistTrackSortField;
    sortDirection?: PlaylistTrackSortDirection;
    limit?: number;
    offset?: number;
  }
): PlaylistTrackPageResult {
  const indexes = resolvePlaylistTrackIndexes({
    tracks,
    searchQuery: options?.searchQuery ?? '',
    sortField: options?.sortField ?? 'default',
    sortDirection: options?.sortDirection ?? 'asc',
  });
  const limit =
    typeof options?.limit === 'number' && Number.isFinite(options.limit)
      ? Math.max(1, Math.min(2000, Math.floor(options.limit)))
      : indexes.length;
  const offset =
    typeof options?.offset === 'number' && Number.isFinite(options.offset)
      ? Math.max(0, Math.floor(options.offset))
      : 0;

  return {
    total: indexes.length,
    items: indexes
      .slice(offset, offset + limit)
      .map((playlistIndex) => {
        const track = tracks[playlistIndex];
        return track ? { playlistIndex, track } : null;
      })
      .filter((item): item is { playlistIndex: number; track: Track } => item != null),
  };
}

function buildPersistablePlaylistFromTracks(
  playlist: Playlist,
  tracks: Track[],
  updatedAtMs: number = Date.now()
): Playlist {
  return {
    ...playlist,
    tracks,
    trackCount: tracks.length,
    totalDuration: tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0),
    updatedAt: updatedAtMs,
    tracksHydrated: true,
  };
}

function mapNativeTrackRecordToTrack(record: NativeLibraryTrackRecord): Track {
  const fileName = record.filePath.split(/[/\\]/).pop();
  const fallbackTitle = (fileName && fileName.trim()) || record.id;

  return {
    id: record.id,
    title: (record.title && record.title.trim()) || fallbackTitle,
    artist: record.artist,
    album: record.album,
    duration: record.durationSeconds,
    filePath: record.filePath,
    path: record.filePath,
    quickFingerprint: record.quickFingerprint,
    genre: record.genre,
    sampleRate: record.sampleRate,
    fileSize: record.fileSize,
    mtimeMs: record.mtimeMs,
    playCount: record.playCount,
    lastPlayed: record.lastPlayedAtMs,
  };
}

function resolveRecentSmartPlaylistLimit(ruleJson?: string): number {
  if (typeof ruleJson !== 'string' || ruleJson.trim().length === 0) {
    return SMART_PLAYLIST_RECENT_LIMIT;
  }
  try {
    const parsed = JSON.parse(ruleJson) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return SMART_PLAYLIST_RECENT_LIMIT;
    }
    const record = parsed as Record<string, unknown>;
    if (record.type !== 'recently_played') return SMART_PLAYLIST_RECENT_LIMIT;
    const limit = record.limit;
    if (typeof limit !== 'number' || !Number.isFinite(limit)) return SMART_PLAYLIST_RECENT_LIMIT;
    return Math.max(1, Math.min(5000, Math.floor(limit)));
  } catch {
    return SMART_PLAYLIST_RECENT_LIMIT;
  }
}

function isPlaylistCoverResolutionAbsolutePath(value: string | null | undefined): boolean {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return false;
  if (normalized.startsWith('/') || normalized.startsWith('\\\\')) return true;
  return /^[A-Za-z]:[\\/]/.test(normalized);
}

function isAssetLocalhostHttpUrl(value: string | null | undefined): boolean {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return false;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return parsed.hostname.toLowerCase() === 'asset.localhost';
  } catch {
    return false;
  }
}

function canRenderPmpPlaylistCoverDirectly(): boolean {
  if (typeof window === 'undefined') return true;
  const protocol = String(window.location?.protocol || '').toLowerCase();
  return protocol !== 'http:' && protocol !== 'https:';
}

function buildContiguousPlaylistIndexRanges(
  indexes: readonly number[]
): Array<{ offset: number; limit: number }> {
  if (indexes.length === 0) return [];

  const ranges: Array<{ offset: number; limit: number }> = [];
  let start = indexes[0] ?? 0;
  let previous = start;

  for (let index = 1; index < indexes.length; index += 1) {
    const current = indexes[index] ?? previous;
    if (current === previous + 1) {
      previous = current;
      continue;
    }

    ranges.push({ offset: start, limit: previous - start + 1 });
    start = current;
    previous = current;
  }

  ranges.push({ offset: start, limit: previous - start + 1 });
  return ranges;
}

export class AudioPlaylistShell {
  private readonly telemetry = getTelemetryLogger('audio', 'AudioPlaylistShell');
  private playlistsRestored = false;
  private playlistsRestorePromise: Promise<void> | null = null;
  private builtinSmartPlaylistsReady = false;
  private builtinSmartPlaylistsInitPromise: Promise<void> | null = null;
  private playlistHydrationPromises = new Map<string, Promise<Playlist | null>>();

  constructor(private readonly shell: AudioPlaylistShellHost) {}

  getPlaylists(): Playlist[] {
    void this.ensurePlaylistsRestored();
    return this.shell.getPlaylists();
  }

  getPlaylist(playlistId: string): Playlist | null {
    void this.ensurePlaylistsRestored();
    return this.shell.getPlaylist(playlistId);
  }

  async restorePlaylistSummaries(): Promise<void> {
    await this.ensurePlaylistsRestored();
  }

  createPlaylist(name: string, description?: string, options?: PlaylistCreateOptions): Playlist {
    const kind =
      options?.kind === PLAYLIST_KIND_SMART
        ? PLAYLIST_KIND_SMART
        : options?.kind === PLAYLIST_KIND_PLATFORM
          ? PLAYLIST_KIND_PLATFORM
          : PLAYLIST_KIND_MANUAL;
    const now = Date.now();
    const playlist: Playlist = {
      id: `playlist-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      description,
      tracks: [],
      kind,
      readonly: options?.readonly === true || kind === PLAYLIST_KIND_SMART,
      sourceConnectorId: options?.sourceConnectorId,
      sourcePlaylistId: options?.sourcePlaylistId,
      smartRuleJson: options?.smartRuleJson,
      createdAt: now,
      updatedAt: now,
      trackCount: 0,
      totalDuration: 0,
      tracksHydrated: true,
    };

    this.replacePlaylists([...this.shell.getState().playlists, playlist]);
    this.upsertPlaylistMetadataBestEffort(playlist);
    return playlist;
  }

  deletePlaylist(playlistId: string): void {
    const target = this.shell.getPlaylist(playlistId);
    if (isReadonlyPlaylist(target)) return;

    this.playlistHydrationPromises.delete(playlistId);
    const state = this.shell.getState();
    const playlists = state.playlists.filter((playlist) => playlist.id !== playlistId);
    const currentPlaylist = state.currentPlaylist?.id === playlistId ? null : state.currentPlaylist;
    this.replacePlaylists(playlists, currentPlaylist);
    this.deletePlaylistBestEffort(playlistId);
  }

  renamePlaylist(playlistId: string, newName: string): void {
    const target = this.shell.getPlaylist(playlistId);
    if (isReadonlyPlaylist(target)) return;

    const playlists = this.shell.getState().playlists.map((playlist) =>
      playlist.id === playlistId ? { ...playlist, name: newName, updatedAt: Date.now() } : playlist
    );
    this.replacePlaylists(playlists);
    const updated = playlists.find((playlist) => playlist.id === playlistId);
    if (updated) this.upsertPlaylistMetadataBestEffort(updated);
  }

  async queryPlaylistTracksPage(
    playlistId: string,
    options?: {
      searchQuery?: string;
      sortField?: PlaylistTrackSortField;
      sortDirection?: PlaylistTrackSortDirection;
      limit?: number;
      offset?: number;
    }
  ): Promise<PlaylistTrackPageResult | null> {
    const normalizedPlaylistId = String(playlistId || '').trim();
    if (!normalizedPlaylistId) return null;

    await this.ensurePlaylistsRestored();
    const playlist = this.shell.getPlaylist(normalizedPlaylistId);
    if (!playlist) return null;

    if (!isTauriRuntime()) {
      return queryPlaylistTrackPageFromTracks(playlist.tracks, options);
    }

    try {
      const page = await queryNativeLibraryPlaylistTracksPage({
        playlistId: normalizedPlaylistId,
        searchQuery: options?.searchQuery,
        sortField: options?.sortField,
        sortDirection: options?.sortDirection,
        limit: options?.limit,
        offset: options?.offset,
      });
      return {
        total: page.total,
        items: page.items
          .map((item) => {
            const fallbackId =
              item.localTrackId || item.entryId || `${normalizedPlaylistId}::${item.position}`;
            const track = parseTrackFromPlaylistPayload(item.trackPayloadJson, {
              id: fallbackId,
              title: item.snapshotTitle,
              artist: item.snapshotArtist,
              album: item.snapshotAlbum,
              duration: item.snapshotDurationSeconds,
            });
            return track ? { playlistIndex: item.position, track } : null;
          })
          .filter((item): item is { playlistIndex: number; track: Track } => item != null),
      };
    } catch (error) {
      this.telemetry.warn('audio.playlist.query-page.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          playlistId: normalizedPlaylistId,
          searchQueryLength: options?.searchQuery?.trim().length ?? 0,
          sortField: options?.sortField ?? 'default',
          sortDirection: options?.sortDirection ?? 'asc',
        },
      });
    }

    if (playlist.kind === PLAYLIST_KIND_SMART && normalizedPlaylistId === SMART_PLAYLIST_RECENT_ID) {
      const limitHint =
        typeof options?.limit === 'number' && Number.isFinite(options.limit)
          ? Math.max(1, Math.min(2000, Math.floor(options.limit)))
          : resolveRecentSmartPlaylistLimit(playlist.smartRuleJson);
      const recentTracks = await this.buildRecentSmartPlaylistTracks(limitHint);
      return queryPlaylistTrackPageFromTracks(recentTracks, options);
    }

    return { items: [], total: 0 };
  }

  async hydratePlaylistTracks(playlistId: string): Promise<Playlist | null> {
    const normalizedPlaylistId = String(playlistId || '').trim();
    if (!normalizedPlaylistId) return null;

    await this.ensurePlaylistsRestored();
    const existingPlaylist = this.shell.getPlaylist(normalizedPlaylistId);
    if (!existingPlaylist) return null;
    if (existingPlaylist.tracksHydrated !== false) return existingPlaylist;

    const pending = this.playlistHydrationPromises.get(normalizedPlaylistId);
    if (pending) return pending;

    const hydrationPromise = this.loadPlaylistTracksFromLibraryDb(existingPlaylist)
      .then((tracks) => {
        const latestPlaylist = this.shell.getPlaylist(normalizedPlaylistId);
        if (!latestPlaylist) return null;

        const hydrated = createHydratedPlaylist(latestPlaylist, tracks, {
          trackCount:
            typeof latestPlaylist.trackCount === 'number' && latestPlaylist.trackCount > 0
              ? latestPlaylist.trackCount
              : tracks.length,
          totalDuration:
            typeof latestPlaylist.totalDuration === 'number' && latestPlaylist.totalDuration > 0
              ? latestPlaylist.totalDuration
              : undefined,
        });
        const playlists = this.shell.getState().playlists.map((playlist) =>
          playlist.id === normalizedPlaylistId ? hydrated : playlist
        );
        const currentPlaylist =
          this.shell.getState().currentPlaylist?.id === normalizedPlaylistId
            ? createPlaylistSummaryReference(hydrated)
            : undefined;
        this.replacePlaylists(playlists, currentPlaylist);
        return hydrated;
      })
      .catch((error) => {
        this.telemetry.warn('audio.playlist.hydrate.failed', {
          message: readTelemetryErrorMessage(error),
          fields: {
            playlistId: normalizedPlaylistId,
            trackCountHint: existingPlaylist.trackCount ?? existingPlaylist.tracks.length,
            kind: existingPlaylist.kind ?? null,
          },
        });
        return null;
      })
      .finally(() => {
        this.playlistHydrationPromises.delete(normalizedPlaylistId);
      });

    this.playlistHydrationPromises.set(normalizedPlaylistId, hydrationPromise);
    return hydrationPromise;
  }

  releasePlaylistTracks(playlistId?: string): void {
    const normalizedPlaylistId = String(playlistId || '').trim();
    const shouldReleaseAll = normalizedPlaylistId.length === 0;
    let changed = false;

    const playlists = this.shell.getState().playlists.map((playlist) => {
      const targetMatch = shouldReleaseAll || playlist.id === normalizedPlaylistId;
      if (!targetMatch || playlist.tracksHydrated === false || playlist.tracks.length === 0) {
        return playlist;
      }

      changed = true;
      this.playlistHydrationPromises.delete(playlist.id);
      return {
        ...playlist,
        tracks: [],
        trackCount:
          typeof playlist.trackCount === 'number' && Number.isFinite(playlist.trackCount)
            ? playlist.trackCount
            : 0,
        totalDuration:
          typeof playlist.totalDuration === 'number' && Number.isFinite(playlist.totalDuration)
            ? playlist.totalDuration
            : 0,
        tracksHydrated: false,
      };
    });

    if (!changed) return;

    const state = this.shell.getState();
    const currentPlaylist =
      state.currentPlaylist && (shouldReleaseAll || state.currentPlaylist.id === normalizedPlaylistId)
        ? createPlaylistSummaryReference(
            playlists.find((playlist) => playlist.id === state.currentPlaylist?.id) ?? null
          )
        : undefined;
    this.replacePlaylists(playlists, currentPlaylist);
  }

  addTrackToPlaylist(playlistId: string, track: Track): void {
    const target = this.shell.getPlaylist(playlistId);
    if (isReadonlyPlaylist(target) || !target) return;

    const stateTrack = compactTrackForPlaylistState(track);
    if (target.tracksHydrated === false) {
      this.addTrackToSummaryPlaylist(target, stateTrack);
      return;
    }

    const nextTracks = prependTrackWithDedup(target.tracks, stateTrack);
    const previous = target;
    const optimistic = buildPersistablePlaylistFromTracks(target, nextTracks);
    this.replacePlaylistState(optimistic);

    if (!isTauriRuntime()) return;

    const trackPayloadJson = serializeTrackForPlaylist(stateTrack);
    const normalizedPlaylistId = String(playlistId || '').trim();
    if (!normalizedPlaylistId || !trackPayloadJson) {
      this.replacePlaylistState(previous);
      return;
    }

    void prependNativeLibraryPlaylistItem(normalizedPlaylistId, {
      trackPayloadJson,
      snapshotTitle: stateTrack.title,
      snapshotArtist: stateTrack.artist,
      snapshotAlbum: stateTrack.album,
      snapshotDurationSeconds:
        typeof stateTrack.duration === 'number' && Number.isFinite(stateTrack.duration)
          ? Math.max(0, stateTrack.duration)
          : undefined,
      createdAtMs: Date.now(),
    })
      .then((saved) => {
        if (!saved) {
          this.replacePlaylistState(previous);
          return;
        }
        this.replacePlaylistState(createPlaylistFromNativeRecord(saved, { tracks: nextTracks, tracksHydrated: true }));
      })
      .catch((error) => {
        this.replacePlaylistState(previous);
        this.telemetry.warn('audio.playlist.add-track.failed', {
          message: readTelemetryErrorMessage(error),
          fields: { playlistId: normalizedPlaylistId, trackId: stateTrack.id },
        });
      });
  }

  removeTrackFromPlaylist(playlistId: string, trackIndex: number): void {
    const target = this.shell.getPlaylist(playlistId);
    if (isReadonlyPlaylist(target) || !target) return;

    const normalizedIndex = Number.isInteger(trackIndex) && trackIndex >= 0 ? trackIndex : -1;
    if (normalizedIndex < 0) return;

    if (target.tracksHydrated === false) {
      this.removeTrackFromSummaryPlaylist(target, normalizedIndex);
      return;
    }
    if (normalizedIndex >= target.tracks.length) return;

    const previous = target;
    const nextTracks = [...target.tracks];
    nextTracks.splice(normalizedIndex, 1);
    this.replacePlaylistState(buildPersistablePlaylistFromTracks(target, nextTracks));

    if (!isTauriRuntime()) return;
    const normalizedPlaylistId = String(playlistId || '').trim();
    if (!normalizedPlaylistId) {
      this.replacePlaylistState(previous);
      return;
    }

    void removeNativeLibraryPlaylistItemAt(normalizedPlaylistId, normalizedIndex)
      .then((saved) => {
        if (!saved) {
          this.replacePlaylistState(previous);
          return;
        }
        this.replacePlaylistState(createPlaylistFromNativeRecord(saved, { tracks: nextTracks, tracksHydrated: true }));
      })
      .catch((error) => {
        this.replacePlaylistState(previous);
        this.telemetry.warn('audio.playlist.remove-track.failed', {
          message: readTelemetryErrorMessage(error),
          fields: { playlistId: normalizedPlaylistId, trackIndex: normalizedIndex },
        });
      });
  }

  clearPlaylist(playlistId: string): void {
    const target = this.shell.getPlaylist(playlistId);
    if (isReadonlyPlaylist(target) || !target) return;

    if (target.tracksHydrated === false) {
      this.clearSummaryPlaylist(target);
      return;
    }

    const previous = target;
    this.replacePlaylistState(buildPersistablePlaylistFromTracks(target, []));

    if (!isTauriRuntime()) return;
    const normalizedPlaylistId = String(playlistId || '').trim();
    if (!normalizedPlaylistId) {
      this.replacePlaylistState(previous);
      return;
    }

    void clearNativeLibraryPlaylistItems(normalizedPlaylistId)
      .then((saved) => {
        if (!saved) {
          this.replacePlaylistState(previous);
          return;
        }
        this.replacePlaylistState(createPlaylistFromNativeRecord(saved, { tracks: [], tracksHydrated: true }));
      })
      .catch((error) => {
        this.replacePlaylistState(previous);
        this.telemetry.warn('audio.playlist.clear.failed', {
          message: readTelemetryErrorMessage(error),
          fields: { playlistId: normalizedPlaylistId },
        });
      });
  }

  async resolvePlaylistTracksForQueue(playlistId: string): Promise<{
    playlist: Playlist;
    tracks: Track[];
  } | null> {
    const normalizedPlaylistId = String(playlistId || '').trim();
    if (!normalizedPlaylistId) return null;

    await this.ensurePlaylistsRestored();
    const playlist = this.shell.getPlaylist(normalizedPlaylistId);
    if (!playlist) return null;
    if (playlist.tracksHydrated !== false) return { playlist, tracks: playlist.tracks };

    if (!isTauriRuntime()) {
      const hydrated = await this.hydratePlaylistTracks(normalizedPlaylistId);
      return hydrated ? { playlist: hydrated, tracks: hydrated.tracks } : null;
    }

    const tracks: Track[] = [];
    let offset = 0;
    let total =
      typeof playlist.trackCount === 'number' && Number.isFinite(playlist.trackCount)
        ? Math.max(0, Math.floor(playlist.trackCount))
        : 0;

    while (offset === 0 || offset < total) {
      const page = await this.queryPlaylistTracksPage(normalizedPlaylistId, {
        sortField: 'default',
        sortDirection: 'asc',
        limit: PLAYLIST_QUEUE_PAGE_SIZE,
        offset,
      });
      const items = page?.items ?? [];
      if (typeof page?.total === 'number' && Number.isFinite(page.total)) {
        total = Math.max(0, Math.floor(page.total));
      }
      if (items.length === 0) break;
      tracks.push(...items.map((item) => item.track));
      offset += items.length;
      if (items.length < PLAYLIST_QUEUE_PAGE_SIZE) break;
    }

    return { playlist, tracks };
  }

  async resolvePlaylistTrackSelectionForQueue(
    playlistId: string,
    trackIndexes: readonly number[]
  ): Promise<{ playlist: Playlist; normalizedIndexes: number[]; tracks: Track[] } | null> {
    const normalizedPlaylistId = String(playlistId || '').trim();
    if (!normalizedPlaylistId) return null;

    await this.ensurePlaylistsRestored();
    const playlist = this.shell.getPlaylist(normalizedPlaylistId);
    if (!playlist) return null;

    const normalizedIndexes = this.normalizePlaylistTrackIndexes(playlist, trackIndexes);
    if (normalizedIndexes.length === 0) {
      return { playlist, normalizedIndexes, tracks: [] };
    }

    if (playlist.tracksHydrated !== false) {
      return {
        playlist,
        normalizedIndexes,
        tracks: normalizedIndexes
          .map((index) => playlist.tracks[index])
          .filter((track): track is Track => Boolean(track)),
      };
    }

    if (!isTauriRuntime()) {
      const hydrated = await this.hydratePlaylistTracks(normalizedPlaylistId);
      if (!hydrated) return null;
      return {
        playlist: hydrated,
        normalizedIndexes,
        tracks: normalizedIndexes
          .map((index) => hydrated.tracks[index])
          .filter((track): track is Track => Boolean(track)),
      };
    }

    const selectedTrackMap = new Map<number, Track>();
    for (const range of buildContiguousPlaylistIndexRanges(normalizedIndexes)) {
      let rangeOffset = range.offset;
      let remaining = range.limit;
      while (remaining > 0) {
        const pageLimit = Math.min(PLAYLIST_QUEUE_PAGE_SIZE, remaining);
        const page = await this.queryPlaylistTracksPage(normalizedPlaylistId, {
          sortField: 'default',
          sortDirection: 'asc',
          limit: pageLimit,
          offset: rangeOffset,
        });
        const items = page?.items ?? [];
        if (items.length === 0) break;
        for (const item of items) {
          selectedTrackMap.set(item.playlistIndex, item.track);
        }
        rangeOffset += items.length;
        remaining -= items.length;
        if (items.length < pageLimit) break;
      }
    }

    return {
      playlist,
      normalizedIndexes,
      tracks: normalizedIndexes
        .map((index) => selectedTrackMap.get(index))
        .filter((track): track is Track => Boolean(track)),
    };
  }

  async resolvePlaylistCoverPreview(
    playlistId: string,
    options?: { coverSizeHint?: 'small' | 'medium' | 'large'; preferCompactPreview?: boolean }
  ): Promise<string | undefined> {
    const normalizedPlaylistId = String(playlistId || '').trim();
    if (!normalizedPlaylistId) return undefined;

    await this.ensurePlaylistsRestored();
    const playlist = this.shell.getPlaylist(normalizedPlaylistId);
    if (!playlist) return undefined;

    const explicitPlaylistCover = sanitizePlaylistCoverUrl(playlist.coverUrl);
    const preferCompactPreview = options?.preferCompactPreview === true;
    const explicitPlaylistCoverLower =
      typeof explicitPlaylistCover === 'string' ? explicitPlaylistCover.toLowerCase() : '';
    const isManagedPmpPlaylistCover =
      explicitPlaylistCoverLower.startsWith('pmp://cover/') ||
      explicitPlaylistCoverLower.startsWith('pmp://localhost/cover/');
    const isAssetLocalhostPlaylistCover = isAssetLocalhostHttpUrl(explicitPlaylistCover);
    if (
      explicitPlaylistCover &&
      !preferCompactPreview &&
      !isManagedPmpPlaylistCover &&
      !isAssetLocalhostPlaylistCover
    ) {
      return explicitPlaylistCover;
    }

    const scanLimit = 5;
    const trackCandidates =
      playlist.tracksHydrated !== false && playlist.tracks.length > 0
        ? playlist.tracks.slice(0, scanLimit)
        : await this.loadPlaylistCoverPreviewTracks(playlist, scanLimit);

    for (const candidate of trackCandidates) {
      const embeddedCoverUrl =
        typeof candidate.coverUrl === 'string' ? candidate.coverUrl.trim() : '';
      const shouldIgnoreEmbeddedTrackCover =
        isPlaylistCoverResolutionAbsolutePath(candidate.filePath || candidate.path) ||
        embeddedCoverUrl.toLowerCase().startsWith('pmp://cover/') ||
        embeddedCoverUrl.toLowerCase().startsWith('pmp://localhost/cover/');
      const resolutionCandidate = shouldIgnoreEmbeddedTrackCover
        ? { ...candidate, coverUrl: undefined }
        : candidate;

      try {
        const { getMusicLibraryService } = await import('./MusicLibraryService');
        const resolvedUrl = await getMusicLibraryService().getCoverUrlForTrack(resolutionCandidate, {
          coverSizeHint: options?.coverSizeHint ?? 'small',
          bypassRuntimePolicy: true,
        });
        const normalizedResolvedUrl = typeof resolvedUrl === 'string' ? resolvedUrl.trim() : '';
        if (normalizedResolvedUrl) return normalizedResolvedUrl;
      } catch {
        // best-effort cover resolution
      }

      if (embeddedCoverUrl && !shouldIgnoreEmbeddedTrackCover) return embeddedCoverUrl;
    }

    if (explicitPlaylistCover && (canRenderPmpPlaylistCoverDirectly() || !isManagedPmpPlaylistCover)) {
      return explicitPlaylistCover;
    }

    return undefined;
  }

  touchPlaylistOpened(playlistId: string): void {
    if (!isTauriRuntime()) return;
    const normalizedPlaylistId = String(playlistId || '').trim();
    if (!normalizedPlaylistId) return;

    void touchNativeLibraryPlaylistOpened(normalizedPlaylistId, {
      openedAtMs: Date.now(),
    }).catch((error) => {
      this.telemetry.warn('audio.playlist.touch-opened.failed', {
        message: readTelemetryErrorMessage(error),
        fields: { playlistId: normalizedPlaylistId },
      });
    });
  }

  dispose(): void {
    this.playlistHydrationPromises.clear();
  }

  setCurrentPlaylist(playlist: Playlist | null): void {
    const state = this.shell.getState();
    this.shell.replacePlaylists(state.playlists, createPlaylistSummaryReference(playlist));
  }

  private async ensurePlaylistsRestored(): Promise<void> {
    if (this.playlistsRestored) return;
    if (this.playlistsRestorePromise) return this.playlistsRestorePromise;

    this.playlistsRestorePromise = (async () => {
      if (!isTauriRuntime()) {
        this.playlistsRestored = true;
        return;
      }

      await this.ensureBuiltinSmartPlaylists();
      const records = await listNativeLibraryPlaylists({
        ownerUid: PLAYLIST_OWNER_UID,
        limit: PLAYLIST_QUERY_LIMIT,
      });
      this.replacePlaylists(records.map(createPlaylistSummaryFromRecord));
      this.playlistsRestored = true;
    })()
      .catch((error) => {
        this.playlistsRestored = true;
        this.telemetry.warn('audio.playlists.restore.failed', {
          message: readTelemetryErrorMessage(error),
        });
      })
      .finally(() => {
        this.playlistsRestorePromise = null;
      });

    return this.playlistsRestorePromise;
  }

  private async ensureBuiltinSmartPlaylists(): Promise<void> {
    if (this.builtinSmartPlaylistsReady) return;
    if (this.builtinSmartPlaylistsInitPromise) {
      await this.builtinSmartPlaylistsInitPromise;
      return;
    }

    this.builtinSmartPlaylistsInitPromise = (async () => {
      const records = await listNativeLibraryPlaylists({
        ownerUid: PLAYLIST_OWNER_UID,
        kind: PLAYLIST_KIND_SMART,
        limit: PLAYLIST_QUERY_LIMIT,
      });
      const recentRecord = records.find((item) => item.id === SMART_PLAYLIST_RECENT_ID) ?? null;
      const now = Date.now();

      await upsertNativeLibraryPlaylist({
        id: SMART_PLAYLIST_RECENT_ID,
        ownerUid: PLAYLIST_OWNER_UID,
        name: SMART_PLAYLIST_RECENT_NAME,
        kind: PLAYLIST_KIND_SMART,
        smartRuleJson: JSON.stringify({
          type: 'recently_played',
          limit: SMART_PLAYLIST_RECENT_LIMIT,
        }),
        isReadonly: true,
        createdAtMs: recentRecord?.createdAtMs ?? now,
        updatedAtMs: now,
        lastOpenedAtMs: recentRecord?.lastOpenedAtMs,
      });

      this.builtinSmartPlaylistsReady = true;
    })().finally(() => {
      this.builtinSmartPlaylistsInitPromise = null;
    });

    await this.builtinSmartPlaylistsInitPromise;
  }

  private replacePlaylists(playlists: Playlist[], currentPlaylist?: Playlist | null): void {
    this.shell.replacePlaylists(playlists, currentPlaylist);
  }

  private replacePlaylistState(playlist: Playlist): void {
    const state = this.shell.getState();
    const playlists = state.playlists.map((item) => (item.id === playlist.id ? playlist : item));
    const currentPlaylist =
      state.currentPlaylist?.id === playlist.id
        ? createPlaylistSummaryReference(playlist)
        : undefined;
    this.replacePlaylists(playlists, currentPlaylist);
  }

  private replacePlaylistSummaryState(playlist: Playlist): void {
    this.replacePlaylistState(createPlaylistSummaryReference(playlist) ?? playlist);
  }

  private async loadPlaylistTracksFromLibraryDb(playlist: Playlist): Promise<Track[]> {
    const playlistId = String(playlist.id || '').trim();
    if (!playlistId) return [];

    if (playlist.kind === PLAYLIST_KIND_SMART) {
      const limit = resolveRecentSmartPlaylistLimit(playlist.smartRuleJson);
      let tracks = parseTracksFromPlaylistItems(
        playlistId,
        await listNativeLibraryPlaylistItems(playlistId, { limit })
      ).slice(0, limit);

      if (tracks.length === 0 && playlistId === SMART_PLAYLIST_RECENT_ID) {
        tracks = await this.buildRecentSmartPlaylistTracks(limit);
        if (tracks.length > 0) {
          const now = Date.now();
          void replaceNativeLibraryPlaylistItems(
            playlistId,
            toPlaylistItemUpserts({
              id: playlistId,
              name: playlist.name,
              description: playlist.description,
              tracks,
              kind: PLAYLIST_KIND_SMART,
              readonly: true,
              smartRuleJson: playlist.smartRuleJson,
              createdAt: playlist.createdAt,
              updatedAt: Math.max(playlist.updatedAt, now),
              trackCount: tracks.length,
              totalDuration: tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0),
              tracksHydrated: true,
            })
          ).catch((error) => {
            this.telemetry.warn('audio.recent-playlist.backfill.failed', {
              message: readTelemetryErrorMessage(error),
              fields: { playlistId, trackCount: tracks.length },
            });
          });
        }
      }

      return tracks;
    }

    return parseTracksFromPlaylistItems(
      playlistId,
      await listNativeLibraryPlaylistItems(playlistId)
    );
  }

  private async buildRecentSmartPlaylistTracks(limit: number): Promise<Track[]> {
    const rows = await queryNativeLibraryTracks({
      limit: Math.max(1, Math.min(2000, limit * 3)),
      includeMissing: false,
      visibleOnly: true,
      filters: [{ field: 'playCount', operator: 'gte', value: '1' }],
      sort: [
        { field: 'lastPlayedAtMs', order: 'desc' },
        { field: 'updatedAtMs', order: 'desc' },
      ],
    });

    const tracks: Track[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row.id || seen.has(row.id)) continue;
      if (typeof row.lastPlayedAtMs !== 'number' || !Number.isFinite(row.lastPlayedAtMs)) continue;
      tracks.push(mapNativeTrackRecordToTrack(row));
      seen.add(row.id);
      if (tracks.length >= limit) break;
    }
    return tracks;
  }

  private async loadPlaylistCoverPreviewTracks(playlist: Playlist, limit: number): Promise<Track[]> {
    const playlistId = String(playlist.id || '').trim();
    if (!playlistId) return [];

    const normalizedLimit = Math.max(1, Math.min(8, Math.floor(limit)));
    let tracks = parseTracksFromPlaylistItems(
      playlistId,
      await listNativeLibraryPlaylistItems(playlistId, { limit: normalizedLimit })
    ).slice(0, normalizedLimit);

    if (
      tracks.length === 0 &&
      playlist.kind === PLAYLIST_KIND_SMART &&
      playlistId === SMART_PLAYLIST_RECENT_ID
    ) {
      tracks = (await this.buildRecentSmartPlaylistTracks(normalizedLimit)).slice(
        0,
        normalizedLimit
      );
    }

    return tracks;
  }

  private upsertPlaylistMetadataBestEffort(playlist: Playlist): void {
    if (!isTauriRuntime()) return;

    const playlistId = String(playlist.id || '').trim();
    const playlistName = String(playlist.name || '').trim();
    if (!playlistId || !playlistName) return;

    const kind =
      playlist.kind === PLAYLIST_KIND_SMART
        ? PLAYLIST_KIND_SMART
        : playlist.kind === PLAYLIST_KIND_PLATFORM
          ? PLAYLIST_KIND_PLATFORM
          : PLAYLIST_KIND_MANUAL;
    if (kind === PLAYLIST_KIND_SMART) return;

    const now = Date.now();
    void upsertNativeLibraryPlaylist({
      id: playlistId,
      ownerUid: PLAYLIST_OWNER_UID,
      name: playlistName,
      description: typeof playlist.description === 'string' ? playlist.description.trim() : undefined,
      coverUrl: sanitizePlaylistCoverUrl(playlist.coverUrl),
      kind,
      sourceConnectorId: playlist.sourceConnectorId,
      sourcePlaylistId: playlist.sourcePlaylistId,
      smartRuleJson: playlist.smartRuleJson,
      isReadonly: playlist.readonly === true,
      createdAtMs:
        typeof playlist.createdAt === 'number' && Number.isFinite(playlist.createdAt)
          ? Math.max(0, Math.floor(playlist.createdAt))
          : now,
      updatedAtMs:
        typeof playlist.updatedAt === 'number' && Number.isFinite(playlist.updatedAt)
          ? Math.max(0, Math.floor(playlist.updatedAt))
          : now,
    }).catch((error) => {
      this.telemetry.warn('audio.playlist.metadata-upsert.failed', {
        message: readTelemetryErrorMessage(error),
        fields: { playlistId },
      });
    });
  }

  private deletePlaylistBestEffort(playlistId: string): void {
    if (!isTauriRuntime()) return;
    const normalizedPlaylistId = String(playlistId || '').trim();
    if (!normalizedPlaylistId) return;

    void deleteNativeLibraryPlaylist(normalizedPlaylistId).catch((error) => {
      this.telemetry.warn('audio.playlist.delete.failed', {
        message: readTelemetryErrorMessage(error),
        fields: { playlistId: normalizedPlaylistId },
      });
    });
  }

  private addTrackToSummaryPlaylist(target: Playlist, stateTrack: Track): void {
    const normalizedPlaylistId = String(target.id || '').trim();
    if (!normalizedPlaylistId) return;

    void (async () => {
      const trackPayloadJson = serializeTrackForPlaylist(stateTrack);
      if (trackPayloadJson && isTauriRuntime()) {
        const saved = await prependNativeLibraryPlaylistItem(normalizedPlaylistId, {
          trackPayloadJson,
          snapshotTitle: stateTrack.title,
          snapshotArtist: stateTrack.artist,
          snapshotAlbum: stateTrack.album,
          snapshotDurationSeconds:
            typeof stateTrack.duration === 'number' && Number.isFinite(stateTrack.duration)
              ? Math.max(0, stateTrack.duration)
              : undefined,
          createdAtMs: Date.now(),
        });
        if (saved) {
          this.replacePlaylistState(createPlaylistFromNativeRecord(saved));
          return;
        }
      }
      if (!isTauriRuntime()) {
        const nextTracks = prependTrackWithDedup(target.tracks, stateTrack);
        this.replacePlaylistSummaryState(buildPersistablePlaylistFromTracks(target, nextTracks));
      }
    })().catch((error) => {
      this.telemetry.warn('audio.playlist.add-track.summary-update.failed', {
        message: readTelemetryErrorMessage(error),
        fields: { playlistId: normalizedPlaylistId, trackId: stateTrack.id },
      });
    });
  }

  private removeTrackFromSummaryPlaylist(target: Playlist, trackIndex: number): void {
    const normalizedPlaylistId = String(target.id || '').trim();
    if (!normalizedPlaylistId) return;

    void (async () => {
      if (isTauriRuntime()) {
        const saved = await removeNativeLibraryPlaylistItemAt(normalizedPlaylistId, trackIndex);
        if (saved) {
          this.replacePlaylistState(createPlaylistFromNativeRecord(saved));
          return;
        }
      }
      if (!isTauriRuntime()) {
        const nextTracks = [...target.tracks];
        if (trackIndex >= nextTracks.length) return;
        nextTracks.splice(trackIndex, 1);
        this.replacePlaylistSummaryState(buildPersistablePlaylistFromTracks(target, nextTracks));
      }
    })().catch((error) => {
      this.telemetry.warn('audio.playlist.remove-track.summary-update.failed', {
        message: readTelemetryErrorMessage(error),
        fields: { playlistId: normalizedPlaylistId, trackIndex },
      });
    });
  }

  private clearSummaryPlaylist(target: Playlist): void {
    const normalizedPlaylistId = String(target.id || '').trim();
    if (!normalizedPlaylistId) return;

    void (async () => {
      if (isTauriRuntime()) {
        const saved = await clearNativeLibraryPlaylistItems(normalizedPlaylistId);
        if (saved) {
          this.replacePlaylistState(createPlaylistFromNativeRecord(saved));
          return;
        }
      }
      if (!isTauriRuntime()) {
        this.replacePlaylistSummaryState(buildPersistablePlaylistFromTracks(target, []));
      }
    })().catch((error) => {
      this.telemetry.warn('audio.playlist.clear.summary-update.failed', {
        message: readTelemetryErrorMessage(error),
        fields: { playlistId: normalizedPlaylistId },
      });
    });
  }

  private normalizePlaylistTrackIndexes(
    playlist: Playlist,
    trackIndexes: readonly number[]
  ): number[] {
    const total =
      typeof playlist.trackCount === 'number' && Number.isFinite(playlist.trackCount)
        ? Math.max(playlist.tracks.length, Math.floor(playlist.trackCount))
        : playlist.tracks.length;
    if (total === 0 || trackIndexes.length === 0) return [];

    const normalized: number[] = [];
    const seen = new Set<number>();
    for (const index of trackIndexes) {
      if (!Number.isInteger(index)) continue;
      if (index < 0 || index >= total) continue;
      if (seen.has(index)) continue;
      seen.add(index);
      normalized.push(index);
    }
    return normalized;
  }
}
