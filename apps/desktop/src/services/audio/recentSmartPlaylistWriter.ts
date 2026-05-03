import {
  listNativeLibraryPlaylistItems,
  replaceNativeLibraryPlaylistItems,
  type NativeLibraryPlaylistItemRecord,
  type NativeLibraryPlaylistItemUpsertInput,
} from '../../modules/music-library';
import {
  recordRecentPlaylistWriteFlushed,
  recordRecentPlaylistWriteScheduled,
} from './audioPerformanceTelemetry';
import {
  applyRecentSmartPlaylistSnapshotToState,
  compactTrackForRecentPlaylist,
  mergeRecentSmartPlaylistTracks,
  toPlaylistItemUpserts,
  type RecentSmartPlaylistWriteEntry,
} from './recentSmartPlaylist';
import type { Playlist, Track } from './types';

export interface RecentSmartPlaylistWriterOptions {
  playlistId: string;
  playlistName: string;
  playlistLimit: number;
  debounceMs: number;
  maxBufferedEvents: number;
  isRuntime: () => boolean;
  getPlaylists: () => Playlist[];
  getCurrentPlaylist: () => Playlist | null;
  updateState: (partial: { playlists: Playlist[]; currentPlaylist: Playlist | null }) => void;
  ensureBuiltinSmartPlaylistsInLibraryDb: () => Promise<void>;
  parseTracksFromPlaylistItems: (
    playlistId: string,
    items: NativeLibraryPlaylistItemRecord[]
  ) => Track[];
  listPlaylistItems?: (
    playlistId: string
  ) => Promise<NativeLibraryPlaylistItemRecord[]>;
  replacePlaylistItems?: (
    playlistId: string,
    items: NativeLibraryPlaylistItemUpsertInput[]
  ) => Promise<unknown>;
  setTimer?: (callback: () => void, delayMs: number) => number | null;
  clearTimer?: (timerId: number) => void;
  now?: () => number;
  onFlushFailed?: (error: unknown, bufferedEntryCount: number) => void;
}

export interface RecentSmartPlaylistWriterSnapshot {
  bufferedEntryCount: number;
  hasTimer: boolean;
}

export class RecentSmartPlaylistWriter {
  private writeQueue: Promise<void> = Promise.resolve();
  private writeBuffer: RecentSmartPlaylistWriteEntry[] = [];
  private writeTimer: number | null = null;

  constructor(private readonly options: RecentSmartPlaylistWriterOptions) {}

  collectSnapshot(): RecentSmartPlaylistWriterSnapshot {
    return {
      bufferedEntryCount: this.writeBuffer.length,
      hasTimer: this.writeTimer !== null,
    };
  }

  enqueueTrackBestEffort(track: Track, playedAtMs: number): void {
    if (!this.options.isRuntime()) return;
    if (!track || typeof track !== 'object') return;

    const recentTrack = compactTrackForRecentPlaylist({
      ...track,
      lastPlayed: playedAtMs,
      playCount:
        typeof track.playCount === 'number' && Number.isFinite(track.playCount)
          ? Math.max(1, Math.floor(track.playCount) + 1)
          : 1,
    });

    this.writeBuffer.push({
      track: recentTrack,
      playedAtMs,
    });
    recordRecentPlaylistWriteScheduled();

    if (this.writeBuffer.length >= this.options.maxBufferedEvents) {
      this.clearWriteTimer();
      this.flushBufferBestEffort();
      return;
    }

    this.scheduleFlush();
  }

  flushBufferBestEffort(): void {
    if (!this.options.isRuntime()) {
      this.writeBuffer = [];
      return;
    }

    if (this.writeBuffer.length === 0) return;
    const bufferedEntries = this.writeBuffer.splice(0);

    this.writeQueue = this.writeQueue
      .then(async () => {
        await this.flushBatch(bufferedEntries);
      })
      .catch((error) => {
        this.options.onFlushFailed?.(error, bufferedEntries.length);
      })
      .finally(() => {
        if (this.writeBuffer.length > 0 && this.writeTimer === null) {
          this.scheduleFlush();
        }
      });
  }

  dispose(options?: { flush?: boolean }): void {
    this.clearWriteTimer();
    if (options?.flush === false) {
      this.writeBuffer = [];
      return;
    }
    this.flushBufferBestEffort();
  }

  async waitForIdle(): Promise<void> {
    await this.writeQueue;
  }

  private clearWriteTimer(): void {
    if (this.writeTimer === null) return;
    const clearTimer = this.options.clearTimer ?? defaultClearTimer;
    clearTimer(this.writeTimer);
    this.writeTimer = null;
  }

  private scheduleFlush(): void {
    const setTimer = this.options.setTimer ?? defaultSetTimer;
    if (!setTimer) {
      this.flushBufferBestEffort();
      return;
    }

    this.clearWriteTimer();
    this.writeTimer = setTimer(() => {
      this.writeTimer = null;
      this.flushBufferBestEffort();
    }, this.options.debounceMs);
  }

  private async flushBatch(
    bufferedEntries: RecentSmartPlaylistWriteEntry[]
  ): Promise<void> {
    if (bufferedEntries.length === 0) return;

    await this.options.ensureBuiltinSmartPlaylistsInLibraryDb();

    const existingTracksFromState =
      this.options.getPlaylists().find((item) => item.id === this.options.playlistId)?.tracks ??
      [];
    const existingTracks =
      existingTracksFromState.length > 0
        ? existingTracksFromState
        : this.options.parseTracksFromPlaylistItems(
            this.options.playlistId,
            await this.listPlaylistItems(this.options.playlistId)
          );

    const { tracks: mergedTracks, latestPlayedAtMs } = mergeRecentSmartPlaylistTracks({
      existingTracks,
      bufferedEntries,
      limit: this.options.playlistLimit,
    });

    const updatedAtMs = latestPlayedAtMs > 0 ? latestPlayedAtMs : this.options.now?.() ?? Date.now();
    const nextRecentSnapshot = applyRecentSmartPlaylistSnapshotToState({
      playlists: this.options.getPlaylists(),
      currentPlaylist: this.options.getCurrentPlaylist(),
      tracks: mergedTracks,
      updatedAtMs,
      recentPlaylistId: this.options.playlistId,
      recentPlaylistName: this.options.playlistName,
      recentPlaylistLimit: this.options.playlistLimit,
    });
    this.options.updateState(nextRecentSnapshot);

    const payloadPlaylist: Playlist = {
      id: this.options.playlistId,
      name: this.options.playlistName,
      tracks: mergedTracks,
      kind: 'smart',
      readonly: true,
      createdAt: updatedAtMs,
      updatedAt: updatedAtMs,
      trackCount: mergedTracks.length,
      totalDuration: mergedTracks.reduce((sum, item) => sum + (item.duration ?? 0), 0),
    };

    const playlistItems = toPlaylistItemUpserts(payloadPlaylist);
    await this.replacePlaylistItems(this.options.playlistId, playlistItems);

    const payloadBytes = playlistItems.reduce((total, item) => {
      const jsonLength = typeof item.trackPayloadJson === 'string' ? item.trackPayloadJson.length : 0;
      return total + jsonLength;
    }, 0);
    recordRecentPlaylistWriteFlushed({
      eventCount: bufferedEntries.length,
      trackCount: mergedTracks.length,
      payloadBytes,
    });
  }

  private async listPlaylistItems(
    playlistId: string
  ): Promise<NativeLibraryPlaylistItemRecord[]> {
    const listPlaylistItems =
      this.options.listPlaylistItems ?? listNativeLibraryPlaylistItems;
    return listPlaylistItems(playlistId);
  }

  private async replacePlaylistItems(
    playlistId: string,
    items: NativeLibraryPlaylistItemUpsertInput[]
  ): Promise<unknown> {
    const replacePlaylistItems =
      this.options.replacePlaylistItems ?? replaceNativeLibraryPlaylistItems;
    return replacePlaylistItems(playlistId, items);
  }
}

function defaultSetTimer(callback: () => void, delayMs: number): number | null {
  if (typeof window === 'undefined') return null;
  return window.setTimeout(callback, delayMs);
}

function defaultClearTimer(timerId: number): void {
  if (typeof window === 'undefined') return;
  window.clearTimeout(timerId);
}
