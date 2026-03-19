import type {
  NativeLibraryPlaylistItemUpsertInput,
} from '../../modules/music-library';
import { prependTrackWithDedup } from './trackIdentity';
import { compactTrackForState } from './trackStateProjection';
import type { Playlist, Track } from './types';

export type RecentSmartPlaylistWriteEntry = {
  track: Track;
  playedAtMs: number;
};

export function compactTrackForRecentPlaylist(track: Track): Track {
  const compacted = compactTrackForState(track);
  return {
    id: compacted.id,
    title: compacted.title,
    artist: compacted.artist,
    album: compacted.album,
    albumArtist: compacted.albumArtist,
    duration: compacted.duration,
    path: compacted.path,
    filePath: compacted.filePath,
    originalPath: compacted.originalPath,
    quickFingerprint: compacted.quickFingerprint,
    coverKey: compacted.coverKey,
    coverUrl: compacted.coverUrl,
    genre: compacted.genre,
    sampleRate: compacted.sampleRate,
    fileSize: compacted.fileSize,
    mtimeMs: compacted.mtimeMs,
    comment: compacted.comment,
    mimeType: compacted.mimeType,
    lastPlayed: compacted.lastPlayed,
    playCount: compacted.playCount,
    replayGainTrackGainDb: compacted.replayGainTrackGainDb,
    replayGainAlbumGainDb: compacted.replayGainAlbumGainDb,
    codecName: compacted.codecName,
    format: compacted.format,
  };
}

export function serializeTrackForPlaylist(track: Track): string | undefined {
  const compacted = compactTrackForState(track);
  const id = typeof compacted.id === 'string' ? compacted.id.trim() : '';
  const title = typeof compacted.title === 'string' ? compacted.title.trim() : '';
  if (!id || !title) return undefined;

  const payload: Partial<Track> = {
    id,
    title,
    artist: compacted.artist,
    album: compacted.album,
    albumArtist: compacted.albumArtist,
    duration: compacted.duration,
    path: compacted.path,
    filePath: compacted.filePath,
    originalPath: compacted.originalPath,
    libraryPathId: compacted.libraryPathId,
    mtimeMs: compacted.mtimeMs,
    quickFingerprint: compacted.quickFingerprint,
    coverKey: compacted.coverKey,
    coverUrl: compacted.coverUrl,
    year: compacted.year,
    genre: compacted.genre,
    trackNumber: compacted.trackNumber,
    discNumber: compacted.discNumber,
    composer: compacted.composer,
    bitrate: compacted.bitrate,
    sampleRate: compacted.sampleRate,
    replayGainTrackGainDb: compacted.replayGainTrackGainDb,
    replayGainAlbumGainDb: compacted.replayGainAlbumGainDb,
    format: compacted.format,
    codecName: compacted.codecName,
    fileSize: compacted.fileSize,
    dateAdded: compacted.dateAdded,
    lastPlayed: compacted.lastPlayed,
    playCount: compacted.playCount,
    rating: compacted.rating,
    favorite: compacted.favorite,
    comment: compacted.comment,
    mimeType: compacted.mimeType,
  };

  try {
    return JSON.stringify(payload);
  } catch {
    return undefined;
  }
}

function createPlaylistSummarySnapshot(playlist: Playlist | null | undefined): Playlist | null {
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
        : playlist.tracks.reduce((sum, item) => sum + (item.duration ?? 0), 0),
    tracksHydrated: false,
  };
}

export function toPlaylistItemUpserts(playlist: Playlist): NativeLibraryPlaylistItemUpsertInput[] {
  const items: NativeLibraryPlaylistItemUpsertInput[] = [];
  for (const track of playlist.tracks) {
    const trackPayloadJson = serializeTrackForPlaylist(track);
    if (!trackPayloadJson) continue;
    items.push({
      position: items.length,
      trackPayloadJson,
      snapshotTitle: track.title,
      snapshotArtist: track.artist,
      snapshotAlbum: track.album,
      snapshotDurationSeconds:
        typeof track.duration === 'number' && Number.isFinite(track.duration)
          ? Math.max(0, track.duration)
          : undefined,
    });
  }
  return items;
}

export function mergeRecentSmartPlaylistTracks(options: {
  existingTracks: Track[];
  bufferedEntries: RecentSmartPlaylistWriteEntry[];
  limit: number;
}): { tracks: Track[]; latestPlayedAtMs: number } {
  let mergedTracks = options.existingTracks.map((item) =>
    compactTrackForRecentPlaylist(item)
  );
  let latestPlayedAtMs = 0;

  const orderedEntries = [...options.bufferedEntries].sort(
    (left, right) => left.playedAtMs - right.playedAtMs
  );
  for (const entry of orderedEntries) {
    latestPlayedAtMs = Math.max(latestPlayedAtMs, entry.playedAtMs);
    mergedTracks = prependTrackWithDedup(mergedTracks, entry.track).slice(0, options.limit);
  }

  return {
    tracks: mergedTracks,
    latestPlayedAtMs,
  };
}

export function applyRecentSmartPlaylistSnapshotToState(options: {
  playlists: Playlist[];
  currentPlaylist: Playlist | null;
  tracks: Track[];
  updatedAtMs: number;
  recentPlaylistId: string;
  recentPlaylistName: string;
  recentPlaylistLimit: number;
}): { playlists: Playlist[]; currentPlaylist: Playlist | null } {
  const totalDuration = options.tracks.reduce((sum, item) => sum + (item.duration ?? 0), 0);
  let hasRecentPlaylist = false;

  const nextPlaylists = options.playlists.map((playlist) => {
    if (playlist.id !== options.recentPlaylistId) {
      return playlist;
    }

    hasRecentPlaylist = true;
    const materializeTracks = playlist.tracksHydrated !== false;
    return {
      ...playlist,
      name: playlist.name || options.recentPlaylistName,
      tracks: materializeTracks ? options.tracks : [],
      kind: 'smart' as const,
      readonly: true,
      smartRuleJson:
        playlist.smartRuleJson ||
        JSON.stringify({
          type: 'recently_played',
          limit: options.recentPlaylistLimit,
        }),
      updatedAt: Math.max(options.updatedAtMs, playlist.updatedAt || 0),
      trackCount: options.tracks.length,
      totalDuration,
      tracksHydrated: materializeTracks,
    };
  });

  if (!hasRecentPlaylist) {
    nextPlaylists.push({
      id: options.recentPlaylistId,
      name: options.recentPlaylistName,
      tracks: [],
      kind: 'smart',
      readonly: true,
      smartRuleJson: JSON.stringify({
        type: 'recently_played',
        limit: options.recentPlaylistLimit,
      }),
      createdAt: options.updatedAtMs,
      updatedAt: options.updatedAtMs,
      trackCount: options.tracks.length,
      totalDuration,
      tracksHydrated: false,
    });
  }

  const currentPlaylist =
    options.currentPlaylist?.id === options.recentPlaylistId
      ? createPlaylistSummarySnapshot(
          nextPlaylists.find((item) => item.id === options.recentPlaylistId) ?? null
        )
      : options.currentPlaylist;

  return {
    playlists: nextPlaylists,
    currentPlaylist,
  };
}
