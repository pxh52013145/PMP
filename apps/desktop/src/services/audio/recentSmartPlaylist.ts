import type {
  NativeLibraryPlaylistItemUpsertInput,
} from '../../modules/music-library';
import { prependTrackWithDedup } from './trackIdentity';
import type { Playlist, Track } from './types';

export type RecentSmartPlaylistWriteEntry = {
  track: Track;
  playedAtMs: number;
};

export function compactTrackForRecentPlaylist(track: Track): Track {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    duration: track.duration,
    path: track.path,
    filePath: track.filePath,
    originalPath: track.originalPath,
    quickFingerprint: track.quickFingerprint,
    coverKey: track.coverKey,
    coverUrl: track.coverUrl,
    genre: track.genre,
    sampleRate: track.sampleRate,
    fileSize: track.fileSize,
    mtimeMs: track.mtimeMs,
    comment: track.comment,
    mimeType: track.mimeType,
    lastPlayed: track.lastPlayed,
    playCount: track.playCount,
    replayGainTrackGainDb: track.replayGainTrackGainDb,
    replayGainAlbumGainDb: track.replayGainAlbumGainDb,
    codecName: track.codecName,
    format: track.format,
  };
}

export function serializeTrackForPlaylist(track: Track): string | undefined {
  const id = typeof track?.id === 'string' ? track.id.trim() : '';
  const title = typeof track?.title === 'string' ? track.title.trim() : '';
  if (!id || !title) return undefined;

  const payload: Partial<Track> = {
    id,
    title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    duration: track.duration,
    path: track.path,
    filePath: track.filePath,
    originalPath: track.originalPath,
    libraryPathId: track.libraryPathId,
    mtimeMs: track.mtimeMs,
    quickFingerprint: track.quickFingerprint,
    coverKey: track.coverKey,
    coverUrl: track.coverUrl,
    year: track.year,
    genre: track.genre,
    trackNumber: track.trackNumber,
    discNumber: track.discNumber,
    composer: track.composer,
    bitrate: track.bitrate,
    sampleRate: track.sampleRate,
    replayGainTrackGainDb: track.replayGainTrackGainDb,
    replayGainAlbumGainDb: track.replayGainAlbumGainDb,
    format: track.format,
    codecName: track.codecName,
    fileSize: track.fileSize,
    dateAdded: track.dateAdded,
    lastPlayed: track.lastPlayed,
    playCount: track.playCount,
    rating: track.rating,
    favorite: track.favorite,
    tags: track.tags,
    lyrics: track.lyrics,
    comment: track.comment,
    mimeType: track.mimeType,
  };

  try {
    return JSON.stringify(payload);
  } catch {
    return undefined;
  }
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
    return {
      ...playlist,
      name: playlist.name || options.recentPlaylistName,
      tracks: options.tracks,
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
    };
  });

  if (!hasRecentPlaylist) {
    nextPlaylists.push({
      id: options.recentPlaylistId,
      name: options.recentPlaylistName,
      tracks: options.tracks,
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
    });
  }

  const currentPlaylist =
    options.currentPlaylist?.id === options.recentPlaylistId
      ? (nextPlaylists.find((item) => item.id === options.recentPlaylistId) ?? null)
      : options.currentPlaylist;

  return {
    playlists: nextPlaylists,
    currentPlaylist,
  };
}
