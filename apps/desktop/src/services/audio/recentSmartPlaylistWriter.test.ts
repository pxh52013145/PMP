import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  NativeLibraryPlaylistItemRecord,
  NativeLibraryPlaylistItemUpsertInput,
} from '../../modules/music-library';
import {
  getAudioPerformanceTelemetrySnapshot,
  resetAudioPerformanceTelemetryForTests,
} from './audioPerformanceTelemetry';
import { RecentSmartPlaylistWriter } from './recentSmartPlaylistWriter';
import type { Playlist, Track } from './types';

const RECENT_PLAYLIST_ID = 'smart-recently-played';
const RECENT_PLAYLIST_NAME = 'Recently Played';

const TRACK_A: Track = {
  id: 'track-a',
  title: 'Track A',
  artist: 'Artist A',
  duration: 10,
  path: 'C:\\music\\a.flac',
  playCount: 2,
};

const TRACK_B: Track = {
  id: 'track-b',
  title: 'Track B',
  artist: 'Artist B',
  duration: 20,
  path: 'C:\\music\\b.flac',
};

function createRecentPlaylist(tracks: Track[] = []): Playlist {
  return {
    id: RECENT_PLAYLIST_ID,
    name: RECENT_PLAYLIST_NAME,
    tracks,
    kind: 'smart',
    readonly: true,
    createdAt: 1,
    updatedAt: 1,
    trackCount: tracks.length,
    totalDuration: tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0),
    tracksHydrated: true,
  };
}

function createPlaylistItem(track: Track, position: number): NativeLibraryPlaylistItemRecord {
  return {
    id: `item-${position}`,
    playlistId: RECENT_PLAYLIST_ID,
    position,
    trackPayloadJson: JSON.stringify(track),
    snapshotTitle: track.title,
    snapshotArtist: track.artist,
    snapshotAlbum: track.album,
    snapshotDurationSeconds: track.duration,
    createdAtMs: 1,
  };
}

function parseTracksFromPlaylistItems(
  _playlistId: string,
  items: NativeLibraryPlaylistItemRecord[]
): Track[] {
  return items.flatMap((item) => {
    if (!item.trackPayloadJson) return [];
    return [JSON.parse(item.trackPayloadJson) as Track];
  });
}

function createWriter(options?: {
  runtime?: boolean;
  playlists?: Playlist[];
  currentPlaylist?: Playlist | null;
  maxBufferedEvents?: number;
  listItems?: NativeLibraryPlaylistItemRecord[];
  replaceRejects?: boolean;
}) {
  let runtime = options?.runtime ?? true;
  let playlists = options?.playlists ?? [createRecentPlaylist()];
  let currentPlaylist = options?.currentPlaylist ?? null;
  const ensureBuiltinSmartPlaylistsInLibraryDb = vi.fn(() => Promise.resolve());
  const listPlaylistItems = vi.fn(() => Promise.resolve(options?.listItems ?? []));
  const replacePlaylistItems = vi.fn(
    (_playlistId: string, _items: NativeLibraryPlaylistItemUpsertInput[]) =>
      options?.replaceRejects ? Promise.reject(new Error('write failed')) : Promise.resolve()
  );
  const onFlushFailed = vi.fn();

  const writer = new RecentSmartPlaylistWriter({
    playlistId: RECENT_PLAYLIST_ID,
    playlistName: RECENT_PLAYLIST_NAME,
    playlistLimit: 1000,
    debounceMs: 500,
    maxBufferedEvents: options?.maxBufferedEvents ?? 64,
    isRuntime: () => runtime,
    getPlaylists: () => playlists,
    getCurrentPlaylist: () => currentPlaylist,
    updateState: (partial) => {
      playlists = partial.playlists;
      currentPlaylist = partial.currentPlaylist;
    },
    ensureBuiltinSmartPlaylistsInLibraryDb,
    parseTracksFromPlaylistItems,
    listPlaylistItems,
    replacePlaylistItems,
    onFlushFailed,
  });

  return {
    writer,
    getPlaylists: () => playlists,
    getCurrentPlaylist: () => currentPlaylist,
    setRuntime: (nextRuntime: boolean) => {
      runtime = nextRuntime;
    },
    ensureBuiltinSmartPlaylistsInLibraryDb,
    listPlaylistItems,
    replacePlaylistItems,
    onFlushFailed,
  };
}

describe('RecentSmartPlaylistWriter', () => {
  beforeEach(() => {
    resetAudioPerformanceTelemetryForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops enqueue requests outside the Tauri runtime', () => {
    const { writer, replacePlaylistItems } = createWriter({ runtime: false });

    writer.enqueueTrackBestEffort(TRACK_A, 1_000);

    expect(writer.collectSnapshot()).toEqual({
      bufferedEntryCount: 0,
      hasTimer: false,
    });
    expect(replacePlaylistItems).not.toHaveBeenCalled();
    expect(getAudioPerformanceTelemetrySnapshot().recentPlaylistWriteScheduledCount).toBe(0);
  });

  it('debounces recent playlist writes', async () => {
    vi.useFakeTimers();
    const { writer, replacePlaylistItems, getPlaylists } = createWriter();

    writer.enqueueTrackBestEffort(TRACK_A, 1_000);

    expect(writer.collectSnapshot()).toEqual({
      bufferedEntryCount: 1,
      hasTimer: true,
    });
    vi.advanceTimersByTime(499);
    expect(replacePlaylistItems).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await writer.waitForIdle();

    expect(replacePlaylistItems).toHaveBeenCalledTimes(1);
    expect(getPlaylists()[0]?.tracks.map((track) => track.id)).toEqual(['track-a']);
    expect(getAudioPerformanceTelemetrySnapshot()).toMatchObject({
      recentPlaylistWriteScheduledCount: 1,
      recentPlaylistWriteFlushCount: 1,
      recentPlaylistWriteEventCount: 1,
      recentPlaylistWriteTrackCount: 1,
    });
  });

  it('flushes immediately when the buffered event limit is reached', async () => {
    const { writer, replacePlaylistItems, getPlaylists } = createWriter({
      maxBufferedEvents: 2,
    });

    writer.enqueueTrackBestEffort(TRACK_A, 1_000);
    writer.enqueueTrackBestEffort(TRACK_B, 2_000);
    await writer.waitForIdle();

    expect(writer.collectSnapshot()).toEqual({
      bufferedEntryCount: 0,
      hasTimer: false,
    });
    expect(replacePlaylistItems).toHaveBeenCalledTimes(1);
    expect(getPlaylists()[0]?.tracks.map((track) => track.id)).toEqual([
      'track-b',
      'track-a',
    ]);
  });

  it('merges DB-backed existing tracks and applies a recent playlist state snapshot', async () => {
    const currentPlaylist = createRecentPlaylist([]);
    const { writer, getPlaylists, getCurrentPlaylist, listPlaylistItems, replacePlaylistItems } =
      createWriter({
        playlists: [createRecentPlaylist([])],
        currentPlaylist,
        listItems: [createPlaylistItem(TRACK_A, 0)],
      });

    writer.enqueueTrackBestEffort(TRACK_B, 2_000);
    writer.flushBufferBestEffort();
    await writer.waitForIdle();

    expect(listPlaylistItems).toHaveBeenCalledWith(RECENT_PLAYLIST_ID);
    expect(getPlaylists()[0]?.tracks.map((track) => track.id)).toEqual([
      'track-b',
      'track-a',
    ]);
    expect(getCurrentPlaylist()).toMatchObject({
      id: RECENT_PLAYLIST_ID,
      tracks: [],
      tracksHydrated: false,
      trackCount: 2,
    });
    expect(replacePlaylistItems).toHaveBeenCalledWith(
      RECENT_PLAYLIST_ID,
      expect.arrayContaining([
        expect.objectContaining({
          position: 0,
          snapshotTitle: 'Track B',
        }),
        expect.objectContaining({
          position: 1,
          snapshotTitle: 'Track A',
        }),
      ])
    );
  });

  it('reports failed flushes without throwing', async () => {
    const { writer, onFlushFailed } = createWriter({ replaceRejects: true });

    writer.enqueueTrackBestEffort(TRACK_A, 1_000);
    writer.flushBufferBestEffort();

    await expect(writer.waitForIdle()).resolves.toBeUndefined();
    expect(onFlushFailed).toHaveBeenCalledWith(expect.any(Error), 1);
  });
});
