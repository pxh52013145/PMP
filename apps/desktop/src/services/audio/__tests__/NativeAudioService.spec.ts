import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { NativeAudioService } from '../NativeAudioService';
import { invoke } from '@tauri-apps/api/tauri';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';
import { listen } from '@tauri-apps/api/event';
import type { Track } from '../types';
import {
  getAudioPerformanceTelemetrySnapshot,
  resetAudioPerformanceTelemetryForTests,
} from '../audioPerformanceTelemetry';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetAudioPerformanceTelemetryForTests();

  const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
  invokeMock.mockResolvedValue(undefined);

  const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
  listenMock.mockResolvedValue(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

async function flushMicrotasks(rounds: number = 3): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

function enableMockTauriRuntime(): () => void {
  const runtimeWindow = window as Window & { __TAURI__?: unknown };
  const previousValue = runtimeWindow.__TAURI__;
  runtimeWindow.__TAURI__ = previousValue ?? {};
  return () => {
    runtimeWindow.__TAURI__ = previousValue;
  };
}

describe('NativeAudioService', () => {
  it('initializes with idle playback state', () => {
    const service = new NativeAudioService();
    expect(service.getState().playbackState).toBe('idle');
    service.destroy();
  });

  it('prepends newly added tracks to playlist order', () => {
    const service = new NativeAudioService();
    const playlist = service.createPlaylist('Order Test');

    service.addTrackToPlaylist(playlist.id, {
      id: 'track-1',
      title: 'Track 1',
      duration: 100,
      filePath: 'C:\\Music\\track-1.mp3',
      path: 'C:\\Music\\track-1.mp3',
    });
    service.addTrackToPlaylist(playlist.id, {
      id: 'track-2',
      title: 'Track 2',
      duration: 120,
      filePath: 'C:\\Music\\track-2.mp3',
      path: 'C:\\Music\\track-2.mp3',
    });

    const updated = service.getPlaylist(playlist.id);
    expect(updated?.tracks.map((track) => track.id)).toEqual(['track-2', 'track-1']);
    expect(updated?.trackCount).toBe(2);
    expect(updated?.totalDuration).toBe(220);

    service.destroy();
  });

  it('deduplicates playlist tracks and keeps latest at top', () => {
    const service = new NativeAudioService();
    const playlist = service.createPlaylist('Dedup Test');

    service.addTrackToPlaylist(playlist.id, {
      id: 'track-dup-1',
      title: 'Track Duplicate Old',
      duration: 100,
      filePath: 'C:\\Music\\duplicate-old.mp3',
      path: 'C:\\Music\\duplicate-old.mp3',
    });
    service.addTrackToPlaylist(playlist.id, {
      id: 'track-dup-1',
      title: 'Track Duplicate New',
      duration: 180,
      filePath: 'C:\\Music\\duplicate-new.mp3',
      path: 'C:\\Music\\duplicate-new.mp3',
    });

    const updated = service.getPlaylist(playlist.id);
    expect(updated?.tracks).toHaveLength(1);
    expect(updated?.tracks[0]?.id).toBe('track-dup-1');
    expect(updated?.tracks[0]?.title).toBe('Track Duplicate New');
    expect(updated?.trackCount).toBe(1);
    expect(updated?.totalDuration).toBe(180);

    service.destroy();
  });

  it('stores queue entries in lightweight projected form', () => {
    const service = new NativeAudioService();

    service.addToQueue({
      id: 'queue-heavy-1',
      title: 'Queue Heavy',
      artist: 'Artist',
      filePath: 'C:\\Music\\queue-heavy.mp3',
      path: 'C:\\Music\\queue-heavy.mp3',
      coverUrl: `data:image/png;base64,${'a'.repeat(4096)}`,
      fileContent: new ArrayBuffer(8 * 1024 * 1024),
      lyrics: 'l'.repeat(32 * 1024),
      tags: ['tag-a', 'tag-b'],
      comment: 'keep me',
    });

    const queueTrack = service.getState().queue[0];
    expect(queueTrack).toMatchObject({
      id: 'queue-heavy-1',
      title: 'Queue Heavy',
    });
    expect(queueTrack?.comment).toBeUndefined();
    expect(queueTrack?.fileContent).toBeUndefined();
    expect(queueTrack?.lyrics).toBeUndefined();
    expect(queueTrack?.tags).toBeUndefined();
    expect(queueTrack?.coverUrl).toBeUndefined();

    service.destroy();
  });

  it('stores manual playlist entries in lightweight projected form', () => {
    const service = new NativeAudioService();
    const playlist = service.createPlaylist('Compact Playlist');

    service.addTrackToPlaylist(playlist.id, {
      id: 'playlist-heavy-1',
      title: 'Playlist Heavy',
      artist: 'Artist',
      filePath: 'C:\\Music\\playlist-heavy.flac',
      path: 'C:\\Music\\playlist-heavy.flac',
      coverUrl: `blob:${'b'.repeat(128)}`,
      fileContent: new ArrayBuffer(4 * 1024 * 1024),
      lyrics: 'x'.repeat(16 * 1024),
      tags: ['tag-a'],
      comment: 'keep locator',
    });

    const playlistTrack = service.getPlaylist(playlist.id)?.tracks[0];
    expect(playlistTrack).toMatchObject({
      id: 'playlist-heavy-1',
      title: 'Playlist Heavy',
    });
    expect(playlistTrack?.comment).toBeUndefined();
    expect(playlistTrack?.fileContent).toBeUndefined();
    expect(playlistTrack?.lyrics).toBeUndefined();
    expect(playlistTrack?.tags).toBeUndefined();
    expect(playlistTrack?.coverUrl).toBeUndefined();

    service.destroy();
  });

  it('restores playlist summaries and hydrates tracks on demand', async () => {
    const restoreRuntime = enableMockTauriRuntime();
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation(async (cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'music_library_db_list_playlists') {
        const query = (payload as { query?: { kind?: string } } | undefined)?.query;
        if (query?.kind === 'smart') {
          return [];
        }
        return [
          {
            id: 'playlist-summary-1',
            ownerUid: 'local:default',
            name: 'Summary Playlist',
            description: null,
            coverUrl: null,
            kind: 'manual',
            sourceConnectorId: null,
            sourcePlaylistId: null,
            smartRuleJson: null,
            isReadonly: false,
            createdAtMs: 1700000000000,
            updatedAtMs: 1700000000000,
            lastOpenedAtMs: null,
            trackCount: 2,
            totalDuration: 300,
          },
        ];
      }
      if (cmd === 'music_library_db_upsert_playlist') {
        return {
          id: 'smart-recently-played',
          ownerUid: 'local:default',
          name: 'Recently Played',
          description: null,
          kind: 'smart',
          sourceConnectorId: null,
          sourcePlaylistId: null,
          smartRuleJson: JSON.stringify({ type: 'recently_played', limit: 1000 }),
          isReadonly: true,
          createdAtMs: 1700000000000,
          updatedAtMs: 1700000000000,
          lastOpenedAtMs: null,
          trackCount: 0,
          totalDuration: 0,
        };
      }
      if (cmd === 'music_library_db_list_playlist_items') {
        return [
          {
            id: 'item-1',
            playlistId: 'playlist-summary-1',
            position: 0,
            trackPayloadJson: JSON.stringify({
              id: 'summary-track-1',
              title: 'Summary Track 1',
              filePath: 'C:\\\\Music\\\\summary-1.mp3',
              path: 'C:\\\\Music\\\\summary-1.mp3',
              duration: 120,
              fileContent: new ArrayBuffer(1024),
            }),
            snapshotTitle: 'Summary Track 1',
            snapshotDurationSeconds: 120,
            createdAtMs: 1700000000000,
          },
          {
            id: 'item-2',
            playlistId: 'playlist-summary-1',
            position: 1,
            trackPayloadJson: JSON.stringify({
              id: 'summary-track-2',
              title: 'Summary Track 2',
              filePath: 'C:\\\\Music\\\\summary-2.mp3',
              path: 'C:\\\\Music\\\\summary-2.mp3',
              duration: 180,
              lyrics: 'heavy',
            }),
            snapshotTitle: 'Summary Track 2',
            snapshotDurationSeconds: 180,
            createdAtMs: 1700000000000,
          },
        ];
      }
      return undefined;
    });

    const service = new NativeAudioService();
    await flushMicrotasks(6);
    await vi.waitFor(() => {
      expect(service.getPlaylist('playlist-summary-1')).not.toBeNull();
    });

    const summaryPlaylist = service.getPlaylist('playlist-summary-1');
    expect(summaryPlaylist).not.toBeNull();
    expect(summaryPlaylist?.tracksHydrated).toBe(false);
    expect(summaryPlaylist?.trackCount).toBe(2);
    expect(summaryPlaylist?.tracks).toHaveLength(0);

    const hydratedPlaylist = await service.hydratePlaylistTracks?.('playlist-summary-1');
    expect(hydratedPlaylist?.tracksHydrated).toBe(true);
    expect(hydratedPlaylist?.tracks).toHaveLength(2);
    expect(hydratedPlaylist?.tracks[0]?.fileContent).toBeUndefined();
    expect(hydratedPlaylist?.tracks[1]?.lyrics).toBeUndefined();

    service.releasePlaylistTracks?.('playlist-summary-1');
    const releasedPlaylist = service.getPlaylist('playlist-summary-1');
    expect(releasedPlaylist?.tracksHydrated).toBe(false);
    expect(releasedPlaylist?.tracks).toHaveLength(0);
    expect(releasedPlaylist?.trackCount).toBe(2);

    service.destroy();
    restoreRuntime();
  });

  it('plays summary-only playlists without materializing tracks back into playlist state', async () => {
    const restoreRuntime = enableMockTauriRuntime();
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation(async (cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'music_library_db_list_playlists') {
        const query = (payload as { query?: { kind?: string } } | undefined)?.query;
        if (query?.kind === 'smart') {
          return [];
        }
        return [
          {
            id: 'playlist-summary-2',
            ownerUid: 'local:default',
            name: 'Queue Playback Summary',
            description: null,
            coverUrl: null,
            kind: 'manual',
            sourceConnectorId: null,
            sourcePlaylistId: null,
            smartRuleJson: null,
            isReadonly: false,
            createdAtMs: 1700000000000,
            updatedAtMs: 1700000000000,
            lastOpenedAtMs: null,
            trackCount: 2,
            totalDuration: 300,
          },
        ];
      }
      if (cmd === 'music_library_db_upsert_playlist') {
        return {
          id: 'smart-recently-played',
          ownerUid: 'local:default',
          name: 'Recently Played',
          description: null,
          kind: 'smart',
          sourceConnectorId: null,
          sourcePlaylistId: null,
          smartRuleJson: JSON.stringify({ type: 'recently_played', limit: 1000 }),
          isReadonly: true,
          createdAtMs: 1700000000000,
          updatedAtMs: 1700000000000,
          lastOpenedAtMs: null,
          trackCount: 0,
          totalDuration: 0,
        };
      }
      if (cmd === 'music_library_db_list_playlist_items') {
        return [
          {
            id: 'item-1',
            playlistId: 'playlist-summary-2',
            position: 0,
            trackPayloadJson: JSON.stringify({
              id: 'summary-queue-track-1',
              title: 'Summary Queue Track 1',
              filePath: 'C:\\\\Music\\\\summary-queue-1.mp3',
              path: 'C:\\\\Music\\\\summary-queue-1.mp3',
              duration: 120,
            }),
            snapshotTitle: 'Summary Queue Track 1',
            snapshotDurationSeconds: 120,
            createdAtMs: 1700000000000,
          },
          {
            id: 'item-2',
            playlistId: 'playlist-summary-2',
            position: 1,
            trackPayloadJson: JSON.stringify({
              id: 'summary-queue-track-2',
              title: 'Summary Queue Track 2',
              filePath: 'C:\\\\Music\\\\summary-queue-2.mp3',
              path: 'C:\\\\Music\\\\summary-queue-2.mp3',
              duration: 180,
            }),
            snapshotTitle: 'Summary Queue Track 2',
            snapshotDurationSeconds: 180,
            createdAtMs: 1700000000000,
          },
        ];
      }
      return undefined;
    });

    const service = new NativeAudioService();
    await flushMicrotasks(6);
    await vi.waitFor(() => {
      expect(service.getPlaylist('playlist-summary-2')).not.toBeNull();
    });

    await service.playPlaylist('playlist-summary-2');

    expect(service.getState().queue).toHaveLength(2);
    expect(service.getState().currentPlaylist?.id).toBe('playlist-summary-2');
    expect(service.getState().currentPlaylist?.tracks).toHaveLength(0);
    expect(service.getPlaylist('playlist-summary-2')?.tracksHydrated).toBe(false);
    expect(service.getPlaylist('playlist-summary-2')?.tracks).toHaveLength(0);

    service.destroy();
    restoreRuntime();
  });

  it('emits a coded error when track has no absolute file path', async () => {
    const service = new NativeAudioService();
    const onError = vi.fn();
    service.onError(onError);

    await service.loadTrack({ id: 't1', title: 'No Path', path: 'folder/song.mp3' });

    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0]?.[0] as { code?: unknown; message?: unknown } | undefined;
    expect(error?.code).toBe('NATIVE_TRACK_PATH_NOT_ABSOLUTE');
    expect(invoke).not.toHaveBeenCalledWith('native_audio_load', expect.anything());
    service.destroy();
  });

  it('falls back to track.path when filePath is empty', async () => {
    const service = new NativeAudioService();

    await service.loadTrack({
      id: 't-path-fallback',
      title: 'Path Fallback',
      filePath: '',
      path: 'C:\\\\Music\\\\path-fallback.mp3',
    });

    expect(invoke).toHaveBeenCalledWith('native_audio_load', {
      path: 'C:\\\\Music\\\\path-fallback.mp3',
    });

    service.destroy();
  });

  it('does not duplicate queue entries when equivalent path format is loaded', async () => {
    const service = new NativeAudioService();
    service.addMultipleToQueue([
      { id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' },
    ]);

    await service.loadTrack({
      id: 't1-variant',
      title: 'A Variant',
      filePath: 'C:/Music/a.mp3',
      path: 'C:/Music/a.mp3',
    });

    const state = service.getState();
    expect(state.queue).toHaveLength(1);
    expect(state.currentIndex).toBe(0);

    service.destroy();
  });

  it('resolves bilibili source locator to cached path before loading', async () => {
    const restoreRuntime = enableMockTauriRuntime();
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'music_library_bilibili_prepare_cached_playback') {
        return {
          sourceLocator: 'bilibili://video/BV1abc123',
          streamUrl: 'https://example.com/stream.m4a',
          cachePath: 'C:\\\\Cache\\\\bilibili\\\\BV1abc123.m4a',
          mimeType: 'audio/mp4',
          durationSeconds: 128,
          contentKind: 'video',
          selectedQualityKey: 'auto',
          selectedQualityLabel: 'Auto',
        };
      }
      return undefined;
    });

    const service = new NativeAudioService();
    await service.loadTrack({
      id: 'bilibili:resource-1',
      title: 'Bili Track',
      originalPath: 'bilibili://video/BV1abc123',
      comment: 'bilibili://video/BV1abc123',
    });

    await vi.waitFor(() => {
      expect(invokeMock.mock.calls.some(([cmd]) => cmd === 'music_library_bilibili_prepare_cached_playback')).toBe(true);
    });

    expect(invoke).toHaveBeenCalledWith('music_library_bilibili_prepare_cached_playback', {
      sourceLocator: 'bilibili://video/BV1abc123',
      qualityHint: undefined,
    });
    expect(invoke).toHaveBeenCalledWith('native_audio_load', {
      path: 'C:\\\\Cache\\\\bilibili\\\\BV1abc123.m4a',
    });

    service.destroy();
    restoreRuntime();
  });

  it('records platform playback into cloud user entry pipeline', async () => {
    const restoreRuntime = enableMockTauriRuntime();
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'music_library_db_upsert_user_entry') {
        return {
          id: 'entry::platform::connector.platform.bilibili::demo',
          ownerUid: 'local:default',
          trackId: null,
          quickFingerprint: null,
          cloudContentId: 'bilibili://video/BV1def456',
          displayTitle: 'Bili Track 2',
          displayArtist: 'UP 主',
          rating: null,
          tagsJson: null,
          inCloud: true,
          isMissing: false,
          playCount: 0,
          lastPlayedAtMs: null,
          createdAtMs: 1700000000000,
          updatedAtMs: 1700000000000,
        };
      }
      if (cmd === 'music_library_db_mark_user_entry_played') {
        return true;
      }
      if (cmd === 'music_library_db_list_playlists') {
        return [];
      }
      if (cmd === 'music_library_db_upsert_playlist') {
        return {
          id: 'smart-recently-played',
          ownerUid: 'local:default',
          name: 'Recently Played',
          description: null,
          kind: 'smart',
          sourceConnectorId: null,
          sourcePlaylistId: null,
          smartRuleJson: JSON.stringify({ type: 'recently_played', limit: 1000 }),
          isReadonly: true,
          createdAtMs: 1700000000000,
          updatedAtMs: 1700000000000,
          lastOpenedAtMs: null,
        };
      }
      if (cmd === 'music_library_db_list_playlist_items') {
        return [];
      }
      if (cmd === 'music_library_db_replace_playlist_items') {
        return true;
      }
      return undefined;
    });

    const service = new NativeAudioService();
    service.addMultipleToQueue([
      {
        id: 'bilibili:resource-2',
        title: 'Bili Track 2',
        artist: 'UP 主',
        filePath: 'C:\\\\Cache\\\\bilibili\\\\BV1def456.m4a',
        path: 'C:\\\\Cache\\\\bilibili\\\\BV1def456.m4a',
        originalPath: 'bilibili://video/BV1def456',
        comment: 'bilibili://video/BV1def456',
      },
    ]);

    await service.playTrackAtIndex(0);
    await flushMicrotasks(4);

    await vi.waitFor(() => {
      expect(
        invokeMock.mock.calls.some(([cmd]) => cmd === 'music_library_db_upsert_user_entry')
      ).toBe(true);
    });

    expect(invoke).toHaveBeenCalledWith(
      'music_library_db_upsert_user_entry',
      expect.objectContaining({
        entry: expect.objectContaining({
          ownerUid: 'local:default',
          inCloud: true,
          cloudContentId: 'bilibili://video/BV1def456',
          displayTitle: 'Bili Track 2',
        }),
      })
    );
    expect(invoke).toHaveBeenCalledWith(
      'music_library_db_mark_user_entry_played',
      expect.objectContaining({
        entryId: 'entry::platform::connector.platform.bilibili::demo',
      })
    );
    expect(invoke).not.toHaveBeenCalledWith(
      'music_library_db_mark_track_played',
      expect.anything()
    );

    service.destroy();
    restoreRuntime();
  });

  it('projects restored playlist payloads into lightweight runtime tracks', () => {
    const service = new NativeAudioService();
    const restoredTrack = (
      service as unknown as {
        parseTrackFromPlaylistPayload: (payloadJson?: string) => Track | null;
      }
    ).parseTrackFromPlaylistPayload(
      JSON.stringify({
        id: 'restore-track-1',
        title: 'Restored Heavy',
        artist: 'Artist',
        filePath: 'C:\\\\Music\\\\restored-heavy.mp3',
        path: 'C:\\\\Music\\\\restored-heavy.mp3',
        coverUrl: `data:image/png;base64,${'z'.repeat(4096)}`,
        lyrics: 'r'.repeat(20 * 1024),
        tags: ['tag-a', 'tag-b'],
      })
    );

    expect(restoredTrack).toMatchObject({
      id: 'restore-track-1',
      title: 'Restored Heavy',
      artist: 'Artist',
    });
    expect(restoredTrack?.lyrics).toBeUndefined();
    expect(restoredTrack?.tags).toBeUndefined();
    expect(restoredTrack?.coverUrl).toBeUndefined();

    service.destroy();
  });

  it('stores compact recent tracks and avoids repeated smart playlist bootstrap queries', async () => {
    vi.useFakeTimers();

    const restoreRuntime = enableMockTauriRuntime();
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'music_library_db_list_playlists') {
        return [];
      }
      if (cmd === 'music_library_db_upsert_playlist') {
        return {
          id: 'smart-recently-played',
          ownerUid: 'local:default',
          name: 'Recently Played',
          description: null,
          kind: 'smart',
          sourceConnectorId: null,
          sourcePlaylistId: null,
          smartRuleJson: JSON.stringify({ type: 'recently_played', limit: 1000 }),
          isReadonly: true,
          createdAtMs: 1700000000000,
          updatedAtMs: 1700000000000,
          lastOpenedAtMs: null,
        };
      }
      if (cmd === 'music_library_db_list_playlist_items') {
        return [];
      }
      if (cmd === 'music_library_db_replace_playlist_items') {
        return true;
      }
      return undefined;
    });

    const service = new NativeAudioService();
    await flushMicrotasks(6);
    service.addMultipleToQueue([
      {
        id: 'local-track-compact-1',
        title: 'Compact Track',
        artist: 'Tester',
        filePath: 'C:\\\\Music\\\\compact-track.mp3',
        path: 'C:\\\\Music\\\\compact-track.mp3',
        fileContent: new ArrayBuffer(1024 * 1024),
      },
    ]);

    await service.playTrackAtIndex(0);
    await vi.advanceTimersByTimeAsync(650);
    await flushMicrotasks(6);

    await vi.waitFor(() => {
      expect(
        invokeMock.mock.calls.some(([cmd]) => cmd === 'music_library_db_replace_playlist_items')
      ).toBe(true);
    });

    const recentPlaylist = service.getPlaylist('smart-recently-played');
    expect(recentPlaylist).not.toBeNull();
    expect(recentPlaylist?.tracksHydrated).toBe(false);
    expect(recentPlaylist?.trackCount).toBe(1);
    expect(recentPlaylist?.tracks).toHaveLength(0);

    const smartBootstrapCalls = invokeMock.mock.calls.filter(
      ([cmd, payload]) =>
        cmd === 'music_library_db_list_playlists' &&
        Boolean(
          (payload as { query?: { kind?: string } } | undefined)?.query?.kind === 'smart'
        )
    );
    expect(smartBootstrapCalls.length).toBeGreaterThanOrEqual(1);
    expect(smartBootstrapCalls.length).toBeLessThanOrEqual(2);

    const telemetry = getAudioPerformanceTelemetrySnapshot();
    expect(telemetry.recentPlaylistWriteScheduledCount).toBeGreaterThanOrEqual(1);
    expect(telemetry.recentPlaylistWriteFlushCount).toBeGreaterThanOrEqual(1);
    expect(telemetry.recentPlaylistWritePayloadBytesLast).toBeGreaterThan(0);

    service.destroy();
    restoreRuntime();
    vi.useRealTimers();
  });

  it('debounces rapid recent smart playlist writes into one database replace', async () => {
    vi.useFakeTimers();

    const restoreRuntime = enableMockTauriRuntime();
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'music_library_db_list_playlists') {
        return [];
      }
      if (cmd === 'music_library_db_upsert_playlist') {
        return {
          id: 'smart-recently-played',
          ownerUid: 'local:default',
          name: 'Recently Played',
          description: null,
          kind: 'smart',
          sourceConnectorId: null,
          sourcePlaylistId: null,
          smartRuleJson: JSON.stringify({ type: 'recently_played', limit: 1000 }),
          isReadonly: true,
          createdAtMs: 1700000000000,
          updatedAtMs: 1700000000000,
          lastOpenedAtMs: null,
        };
      }
      if (cmd === 'music_library_db_list_playlist_items') {
        return [];
      }
      if (cmd === 'music_library_db_replace_playlist_items') {
        return true;
      }
      return undefined;
    });

    const service = new NativeAudioService();
    service.addMultipleToQueue([
      {
        id: 'local-track-debounce-1',
        title: 'Debounce Track 1',
        artist: 'Tester',
        filePath: 'C:\\\\Music\\\\debounce-track-1.mp3',
        path: 'C:\\\\Music\\\\debounce-track-1.mp3',
      },
      {
        id: 'local-track-debounce-2',
        title: 'Debounce Track 2',
        artist: 'Tester',
        filePath: 'C:\\\\Music\\\\debounce-track-2.mp3',
        path: 'C:\\\\Music\\\\debounce-track-2.mp3',
      },
    ]);

    await service.playTrackAtIndex(0);
    await service.playTrackAtIndex(1);
    await vi.advanceTimersByTimeAsync(650);
    await flushMicrotasks(8);

    const replaceCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === 'music_library_db_replace_playlist_items'
    );
    expect(replaceCalls).toHaveLength(1);

    const telemetry = getAudioPerformanceTelemetrySnapshot();
    expect(telemetry.recentPlaylistWriteScheduledCount).toBeGreaterThanOrEqual(2);
    expect(telemetry.recentPlaylistWriteFlushCount).toBe(1);
    expect(telemetry.recentPlaylistWriteEventCount).toBeGreaterThanOrEqual(2);

    service.destroy();
    restoreRuntime();
    vi.useRealTimers();
  });

  it('emits error when receiving native_audio_error event', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    listenMock.mockImplementation(
      async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      if (eventName === 'native_audio_error') {
        handler({ payload: { seq: 1, code: 'NATIVE_AUDIO_STREAM_ERROR', message: 'decoder failed' } });
      }
      return () => {};
    }
    );

    const service = new NativeAudioService();
    const onError = vi.fn();
    service.onError(onError);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0]?.[0] as { code?: unknown; message?: unknown } | undefined;
    expect(error?.code).toBe('NATIVE_AUDIO_STREAM_ERROR');
    expect(String(error?.message)).toContain('decoder failed');
    service.destroy();
  });

  it('restores output backend and audio input from storage', async () => {
    localStorage.setItem(STORAGE_KEYS.NATIVE_AUDIO_OUTPUT_BACKEND, JSON.stringify('rodio-cpal'));
    localStorage.setItem(STORAGE_KEYS.NATIVE_AUDIO_INPUT_ID, JSON.stringify('symphonia'));

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(invoke).toHaveBeenCalledWith('native_audio_select_output_backend', {
      backendId: 'rodio-cpal',
    });
    expect(invoke).toHaveBeenCalledWith('native_audio_select_audio_input', {
      inputId: 'symphonia',
    });

    service.destroy();
  });

  it('applies replaygain (track gain + preamp) before loading a track', async () => {
    localStorage.setItem(
      STORAGE_KEYS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS,
      JSON.stringify({ enabled: true, mode: 'track', preampDb: 2 })
    );

    const service = new NativeAudioService();
    await service.loadTrack({
      id: 't2',
      title: 'RG Track',
      filePath: 'C:\\\\Music\\\\rg.mp3',
      replayGainTrackGainDb: -6,
    });

    expect(invoke).toHaveBeenCalledWith('native_audio_set_replay_gain', { db: -4 });
    expect(invoke).toHaveBeenCalledWith('native_audio_load', { path: 'C:\\\\Music\\\\rg.mp3' });
    service.destroy();
  });

  it('passes replayGainDb=0 when replaygain is disabled', async () => {
    localStorage.setItem(
      STORAGE_KEYS.NATIVE_AUDIO_REPLAYGAIN_SETTINGS,
      JSON.stringify({ enabled: false, mode: 'track', preampDb: 6 })
    );

    const service = new NativeAudioService();
    service.addMultipleToQueue([{ id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' }]);

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockClear();

    await service.playTrackAtIndex(0);

    expect(invoke).toHaveBeenCalledWith('native_audio_load_and_play', {
      path: 'C:\\\\Music\\\\a.mp3',
      replayGainDb: 0,
    });

    service.destroy();
  });

  it('keeps replayGainDb static while dynamic gain is enabled independently', async () => {
    localStorage.setItem(
      STORAGE_KEYS.NATIVE_AUDIO_RUNTIME_CONTROL_SETTINGS,
      JSON.stringify({ dynamicGainEnabled: true, volumeDebounceEnabled: true })
    );

    const service = new NativeAudioService();
    service.addMultipleToQueue([{ id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' }]);

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockClear();

    await service.playTrackAtIndex(0);

    expect(invoke).toHaveBeenCalledWith('native_audio_set_dynamic_gain_enabled', {
      enabled: true,
    });
    expect(invoke).toHaveBeenCalledWith('native_audio_load_and_play', {
      path: 'C:\\\\Music\\\\a.mp3',
      replayGainDb: 0,
    });

    service.destroy();
  });

  it('coalesces rapid setVolume calls into the latest backend command', async () => {
    vi.useFakeTimers();

    const service = new NativeAudioService();
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockClear();

    service.setVolume(0.2);
    service.setVolume(0.45);
    service.setVolume(0.7);

    expect(invoke).not.toHaveBeenCalledWith('native_audio_set_volume', expect.anything());

    await vi.advanceTimersByTimeAsync(30);

    const volumeCalls = invokeMock.mock.calls.filter((call) => call?.[0] === 'native_audio_set_volume');
    expect(volumeCalls).toHaveLength(1);
    expect(volumeCalls[0]).toEqual(['native_audio_set_volume', { volume: 0.7 }]);

    service.destroy();
    vi.useRealTimers();
  });

  it('dispatches volume immediately when volume debounce is disabled', async () => {
    localStorage.setItem(
      STORAGE_KEYS.NATIVE_AUDIO_RUNTIME_CONTROL_SETTINGS,
      JSON.stringify({ dynamicGainEnabled: false, volumeDebounceEnabled: false })
    );

    const service = new NativeAudioService();
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockClear();

    service.setVolume(0.66);

    const volumeCalls = invokeMock.mock.calls.filter((call) => call?.[0] === 'native_audio_set_volume');
    expect(volumeCalls).toHaveLength(1);
    expect(volumeCalls[0]).toEqual(['native_audio_set_volume', { volume: 0.66 }]);

    service.destroy();
  });

  it('accepts legacy dynamicFallbackEnabled as runtime dynamic gain alias', async () => {
    localStorage.setItem(
      STORAGE_KEYS.NATIVE_AUDIO_RUNTIME_CONTROL_SETTINGS,
      JSON.stringify({ dynamicFallbackEnabled: true, volumeDebounceEnabled: true })
    );

    const service = new NativeAudioService();
    service.addMultipleToQueue([{ id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' }]);

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockClear();

    await service.playTrackAtIndex(0);

    expect(invoke).toHaveBeenCalledWith('native_audio_set_dynamic_gain_enabled', {
      enabled: true,
    });

    service.destroy();
  });

  it('loads the current queue track when play() is called without a loaded track', async () => {
    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    service.addMultipleToQueue([
      { id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' },
      { id: 't2', title: 'B', filePath: 'C:\\\\Music\\\\b.mp3' },
    ]);

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockClear();

    await service.play();

    expect(invoke).toHaveBeenCalledWith('native_audio_load_and_play', {
      path: 'C:\\\\Music\\\\a.mp3',
      replayGainDb: 0,
    });
    expect(invoke).toHaveBeenCalledWith(
      'music_library_db_mark_track_played',
      expect.objectContaining({ trackId: 't1' })
    );
    service.destroy();
  });

  it('avoids calling play() when the backend fails to load the selected track', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_load_and_play') {
        return Promise.reject(new Error('load failed'));
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    service.addMultipleToQueue([{ id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' }]);
    invokeMock.mockClear();

    await service.playTrackAtIndex(0);

    expect(invoke).toHaveBeenCalledWith('native_audio_load_and_play', {
      path: 'C:\\\\Music\\\\a.mp3',
      replayGainDb: 0,
    });
    service.destroy();
  });

  it('crossfades to the next track when enabled and switching while playing', async () => {
    localStorage.setItem(
      STORAGE_KEYS.NATIVE_AUDIO_CROSSFADE_SETTINGS,
      JSON.stringify({ enabled: true, durationMs: 1000 })
    );

    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    await service.loadTrack({
      id: 't1',
      title: 'A',
      filePath: 'C:\\\\Music\\\\a.mp3',
    });
    await service.play();

    handlers['native_audio_state']?.({ payload: { playbackState: 'playing', currentTime: 0, duration: 0 } });
    service.addToQueue({
      id: 't2',
      title: 'B',
      filePath: 'C:\\\\Music\\\\b.mp3',
    });

    await service.playTrackAtIndex(1);

    expect(invoke).toHaveBeenCalledWith('native_audio_crossfade_to', {
      path: 'C:\\\\Music\\\\b.mp3',
      durationMs: 1000,
    });
    expect(invoke).toHaveBeenCalledWith(
      'music_library_db_mark_track_played',
      expect.objectContaining({ trackId: 't2' })
    );
    expect(invoke).not.toHaveBeenCalledWith('native_audio_load', { path: 'C:\\\\Music\\\\b.mp3' });
    service.destroy();
  });

  it('clears currentTrack when backend reports ended with null trackPath', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    await service.loadTrack({ id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' });
    expect(service.getState().currentTrack).not.toBeNull();

    handlers.native_audio_state?.({
      payload: { trackPath: null, playbackState: 'stopped', ended: true },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(service.getState().currentTrack).toBeNull();
    service.destroy();
  });

  it('clears currentTrack when backend reports stopped with null trackPath', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    await service.loadTrack({ id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' });
    expect(service.getState().currentTrack).not.toBeNull();

    handlers.native_audio_state?.({
      payload: { trackPath: null, playbackState: 'stopped', currentIndex: -1, queue: [] },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const state = service.getState();
    expect(state.currentTrack).toBeNull();
    expect(state.currentIndex).toBe(-1);
    service.destroy();
  });

  it('resets playback state when removing the last queued track', async () => {
    const service = new NativeAudioService();
    service.addToQueue({ id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' });
    await service.playTrackAtIndex(0);

    service.removeFromQueue(0);

    const state = service.getState();
    expect(state.queue).toHaveLength(0);
    expect(state.currentIndex).toBe(-1);
    expect(state.currentTrack).toBeNull();
    expect(state.playbackState).toBe('stopped');
    expect(state.currentTime).toBe(0);
    service.destroy();
  });

  it('ignores stale trackPath update after queue is cleared', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    await service.loadTrack({ id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' });
    service.clearQueue();

    handlers.native_audio_state?.({
      payload: {
        trackPath: 'C:\\\\Music\\\\a.mp3',
        playbackState: 'stopped',
        currentIndex: -1,
        queue: [],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const state = service.getState();
    expect(state.currentTrack).toBeNull();
    expect(state.currentIndex).toBe(-1);
    expect(state.queue).toHaveLength(0);
    service.destroy();
  });

  it('ignores stale paused trackPath update after queue is cleared locally', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    await service.loadTrack({ id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' });
    service.clearQueue();

    handlers.native_audio_state?.({
      payload: {
        trackPath: 'C:\\\\Music\\\\a.mp3',
        playbackState: 'paused',
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const state = service.getState();
    expect(state.currentTrack).toBeNull();
    expect(state.currentIndex).toBe(-1);
    expect(state.queue).toHaveLength(0);
    service.destroy();
  });

  it('aggressively tears down transient runtime state when queue is cleared', async () => {
    const service = new NativeAudioService();
    const playlist = service.createPlaylist('Runtime Teardown');
    const track: Track = {
      id: 'runtime-track',
      title: 'Runtime Track',
      duration: 123,
      filePath: 'C:\\\\Music\\\\runtime-track.flac',
      path: 'C:\\\\Music\\\\runtime-track.flac',
    };

    service.addTrackToPlaylist(playlist.id, track);
    await service.playPlaylist(playlist.id);

    const record = service as unknown as Record<string, unknown>;
    record.state = {
      ...service.getState(),
      playbackState: 'playing',
      currentTime: 42,
      duration: 123,
      bufferedTime: 18,
      bufferedAhead: 6,
      decodeBufferedAhead: 4,
      outputBufferedAhead: 2,
    };
    record.desiredPlayIndex = 99;
    record.bufferedAheadRollingWindow = [6, 5, 4];
    record.bufferedAheadRollingSum = 15;
    record.bufferedAheadMinSeconds = 4;
    record.rebufferCount = 3;
    record.lastUnderrunEvents = 2;
    record.lastUnderrunFrames = 512;
    record.underrunSpikeTimestampsMs = [Date.now() - 10, Date.now()];
    record.underrunRecoveryUntilMs = Date.now() + 10_000;
    record.protectionWindowUntilMs = Date.now() + 10_000;
    record.protectionWindowRefCount = 1;
    record.protectionWindowReason = 'test-protection';
    record.dynamicSrcHoldUntilMs = Date.now() + 10_000;
    record.dynamicSrcAutoDegradationLevel = 2;
    record.dynamicSrcAutoDegradationReason = 'test-dynamic-src';
    record.dynamicSrcAutoDegradationLastChangedAtMs = Date.now();
    record.sharedStressUntilMs = Date.now() + 10_000;
    record.sharedStressReason = 'test-shared-stress';
    record.sharedStressEscalationCount = 2;
    record.fallbackTicker = window.setInterval(() => {}, 1_000);
    record.spectrumEnabled = true;
    record.spectrumData = new Uint8Array([1, 2, 3]);
    record.spectrumFrames = { 'post-dsp': { levels: [1, 2, 3] } };

    service.clearQueue();
    await flushMicrotasks();

    const state = service.getState();
    expect(state).toMatchObject({
      queue: [],
      currentIndex: -1,
      currentTrack: null,
      currentPlaylist: null,
      playbackState: 'stopped',
      currentTime: 0,
      duration: 0,
      bufferedTime: 0,
      bufferedAhead: 0,
      decodeBufferedAhead: 0,
      outputBufferedAhead: 0,
    });
    expect(record.desiredPlayIndex).toBeNull();
    expect(record.bufferedAheadRollingWindow).toEqual([]);
    expect(record.bufferedAheadRollingSum).toBe(0);
    expect(record.bufferedAheadMinSeconds).toBeNull();
    expect(record.rebufferCount).toBe(0);
    expect(record.lastUnderrunEvents).toBe(0);
    expect(record.lastUnderrunFrames).toBe(0);
    expect(record.underrunSpikeTimestampsMs).toEqual([]);
    expect(record.underrunRecoveryUntilMs).toBe(0);
    expect(record.protectionWindowUntilMs).toBe(0);
    expect(record.protectionWindowRefCount).toBe(0);
    expect(record.protectionWindowReason).toBeNull();
    expect(record.dynamicSrcHoldUntilMs).toBe(0);
    expect(record.dynamicSrcAutoDegradationLevel).toBe(0);
    expect(record.dynamicSrcAutoDegradationReason).toBeNull();
    expect(record.dynamicSrcAutoDegradationLastChangedAtMs).toBeNull();
    expect(record.sharedStressUntilMs).toBe(0);
    expect(record.sharedStressReason).toBeNull();
    expect(record.sharedStressEscalationCount).toBe(0);
    expect(record.fallbackTicker).toBeNull();
    expect(record.spectrumData).toBeNull();
    expect(record.spectrumFrames).toEqual({});
    expect(invoke).toHaveBeenCalledWith('native_audio_set_spectrum_enabled', { enabled: false });

    service.destroy();
  });

  it('schedules process working set trim after clearing the queue', async () => {
    vi.useFakeTimers();
    const restoreRuntime = enableMockTauriRuntime();
    const service = new NativeAudioService();

    service.clearQueue();
    await vi.advanceTimersByTimeAsync(5_200);

    expect(invoke).toHaveBeenCalledWith('debug_trim_process_working_set', {
      target: 'tree',
    });

    service.destroy();
    restoreRuntime();
  });

  it('keeps currentTrack when backend tick payload omits trackPath while playing', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    await service.loadTrack({ id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' });
    const beforeTrack = service.getState().currentTrack;
    expect(beforeTrack).not.toBeNull();

    handlers.native_audio_state?.({ payload: { trackPath: null, playbackState: 'playing' } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(service.getState().currentTrack).toBe(beforeTrack);
    service.destroy();
  });

  it('wraps to last track on playPrevious in loop mode', async () => {
    const service = new NativeAudioService();
    service.addMultipleToQueue([
      { id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' },
      { id: 't2', title: 'B', filePath: 'C:\\\\Music\\\\b.mp3' },
    ]);

    service.setPlayMode('loop');
    await service.playTrackAtIndex(0);
    await service.playPrevious();

    expect(service.getState().currentIndex).toBe(1);
    service.destroy();
  });

  it('moves to next track on playNext in single-loop mode', async () => {
    const service = new NativeAudioService();
    service.addMultipleToQueue([
      { id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' },
      { id: 't2', title: 'B', filePath: 'C:\\\\Music\\\\b.mp3' },
    ]);

    service.setPlayMode('single-loop');
    await service.playTrackAtIndex(0);
    await service.playNext();

    expect(service.getState().currentIndex).toBe(1);
    service.destroy();
  });

  it('replays first track on playPrevious in sequence mode', async () => {
    const service = new NativeAudioService();
    service.addMultipleToQueue([
      { id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' },
      { id: 't2', title: 'B', filePath: 'C:\\\\Music\\\\b.mp3' },
    ]);

    await service.playTrackAtIndex(0);
    vi.clearAllMocks();

    await service.playPrevious();

    expect(invoke).toHaveBeenCalledWith('native_audio_load_and_play', {
      path: 'C:\\\\Music\\\\a.mp3',
      replayGainDb: 0,
    });
    service.destroy();
  });

  it('picks a random track on playPrevious in shuffle mode', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const service = new NativeAudioService();
    service.addMultipleToQueue([
      { id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' },
      { id: 't2', title: 'B', filePath: 'C:\\\\Music\\\\b.mp3' },
    ]);

    service.setPlayMode('shuffle');
    await service.playTrackAtIndex(0);
    await service.playPrevious();

    expect(service.getState().currentIndex).toBe(1);
    random.mockRestore();
    service.destroy();
  });

  it('replays the same track when ended in single-loop mode', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    service.addMultipleToQueue([
      { id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' },
      { id: 't2', title: 'B', filePath: 'C:\\\\Music\\\\b.mp3' },
    ]);
    service.setPlayMode('single-loop');

    await service.playTrackAtIndex(0);

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockClear();

    handlers.native_audio_state?.({ payload: { playbackState: 'stopped', ended: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(invoke).toHaveBeenCalledWith('native_audio_load_and_play', {
      path: 'C:\\\\Music\\\\a.mp3',
      replayGainDb: 0,
    });
    service.destroy();
  });

  it('coalesces rapid seek calls before invoking backend', async () => {
    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockClear();

    (service as unknown as { state: { duration: number } }).state.duration = 100;

    vi.useFakeTimers();
    service.seek(10);
    service.seek(20);
    service.seek(30);

    expect(invoke).not.toHaveBeenCalledWith('native_audio_seek', expect.anything());

    await vi.advanceTimersByTimeAsync(200);

    expect(invoke).toHaveBeenCalledWith(
      'native_audio_seek',
      expect.objectContaining({ time: 30, seekSeq: expect.any(Number) })
    );

    vi.useRealTimers();
    service.destroy();
  });

  it('reports latest seek sequence immediately and ignores marker failure', async () => {
    vi.useFakeTimers();

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_mark_seek_seq') {
        return Promise.reject(new Error('marker failed'));
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    const onError = vi.fn();
    service.onError(onError);

    (service as unknown as { state: { duration: number } }).state.duration = 180;
    invokeMock.mockClear();

    service.seek(64);
    await vi.advanceTimersByTimeAsync(200);

    expect(invoke).toHaveBeenCalledWith(
      'native_audio_mark_seek_seq',
      expect.objectContaining({ seekSeq: expect.any(Number) })
    );
    expect(invoke).toHaveBeenCalledWith(
      'native_audio_seek',
      expect.objectContaining({ time: 64, seekSeq: expect.any(Number) })
    );
    expect(onError).not.toHaveBeenCalled();

    service.destroy();
    vi.useRealTimers();
  });

  it('keeps latest seek sequence marker updated while seek invokes are saturated', async () => {
    vi.useFakeTimers();

    const pendingSeekResolvers: Array<() => void> = [];
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_seek') {
        return new Promise<void>((resolve) => {
          pendingSeekResolvers.push(resolve);
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    (service as unknown as { state: { duration: number } }).state.duration = 300;
    invokeMock.mockClear();

    for (let i = 0; i < 12; i += 1) {
      service.seek(i * 5);
      await vi.advanceTimersByTimeAsync(25);
    }

    await vi.advanceTimersByTimeAsync(300);

    const seekCalls = invokeMock.mock.calls.filter((call) => call[0] === 'native_audio_seek');
    expect(seekCalls).toHaveLength(3);

    const markerCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === 'native_audio_mark_seek_seq'
    );
    expect(markerCalls).toHaveLength(12);

    const lastSeekSeq = Number(
      (seekCalls[seekCalls.length - 1]?.[1] as { seekSeq?: number } | undefined)?.seekSeq
    );
    const lastMarkerSeq = Number(
      (markerCalls[markerCalls.length - 1]?.[1] as { seekSeq?: number } | undefined)?.seekSeq
    );
    expect(lastMarkerSeq).toBeGreaterThan(lastSeekSeq);

    pendingSeekResolvers.forEach((resolve) => resolve());
    await vi.advanceTimersByTimeAsync(0);

    service.destroy();
    vi.useRealTimers();
  });

  it('keeps latest seek target while an earlier seek promise is unresolved', async () => {
    vi.useFakeTimers();

    const firstSeekGate: { release: (() => void) | null } = { release: null };
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_seek') {
        return new Promise<void>((resolve) => {
          if (!firstSeekGate.release) {
            firstSeekGate.release = () => resolve();
          } else {
            resolve();
          }
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    (service as unknown as { state: { duration: number } }).state.duration = 200;

    service.seek(10);
    await vi.advanceTimersByTimeAsync(80);

    expect(invoke).toHaveBeenCalledWith(
      'native_audio_seek',
      expect.objectContaining({ time: 10, seekSeq: expect.any(Number) })
    );

    service.seek(50);
    service.seek(80);
    await vi.advanceTimersByTimeAsync(80);

    const seekCallsBeforeResolve = invokeMock.mock.calls.filter((call) => call[0] === 'native_audio_seek');
    expect(seekCallsBeforeResolve).toHaveLength(2);
    expect(seekCallsBeforeResolve[1]?.[1]).toEqual(
      expect.objectContaining({ time: 80, seekSeq: expect.any(Number) })
    );

    if (firstSeekGate.release) {
      firstSeekGate.release();
    }
    await vi.advanceTimersByTimeAsync(0);

    const seekCallsAfterResolve = invokeMock.mock.calls.filter((call) => call[0] === 'native_audio_seek');
    expect(seekCallsAfterResolve).toHaveLength(2);

    service.destroy();
    vi.useRealTimers();
  });

  it('throttles rapid seek bursts and keeps latest target without event pile-up', async () => {
    vi.useFakeTimers();

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockResolvedValue(undefined);

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    (service as unknown as { state: { duration: number } }).state.duration = 500;
    invokeMock.mockClear();

    for (let i = 0; i < 80; i += 1) {
      service.seek(i * 2);
      await vi.advanceTimersByTimeAsync(5);
    }

    await vi.advanceTimersByTimeAsync(2_000);

    const seekCalls = invokeMock.mock.calls.filter((call) => call[0] === 'native_audio_seek');
    expect(seekCalls.length).toBeLessThanOrEqual(25);

    const lastPayload = seekCalls[seekCalls.length - 1]?.[1] as
      | { time?: number; seekSeq?: number }
      | undefined;
    expect(lastPayload?.time).toBe(158);

    const seqs = seekCalls
      .map((call) => (call[1] as { seekSeq?: number } | undefined)?.seekSeq)
      .filter((value): value is number => typeof value === 'number');
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }

    service.destroy();
    vi.useRealTimers();
  });

  it.each(['sequence', 'loop', 'single-loop', 'shuffle'] as const)(
    'keeps latest seek target stable under rapid bursts in %s mode',
    async (mode) => {
      vi.useFakeTimers();

      const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
      invokeMock.mockResolvedValue(undefined);

      const service = new NativeAudioService();
      await vi.advanceTimersByTimeAsync(0);

      service.setPlayMode(mode);
      (service as unknown as { state: { duration: number } }).state.duration = 220;
      invokeMock.mockClear();

      for (let i = 0; i < 24; i += 1) {
        service.seek(i * 3);
        await vi.advanceTimersByTimeAsync(4);
      }

      await vi.advanceTimersByTimeAsync(1_000);

      const seekCalls = invokeMock.mock.calls.filter((call) => call[0] === 'native_audio_seek');
      expect(seekCalls.length).toBeLessThanOrEqual(24);

      const lastPayload = seekCalls[seekCalls.length - 1]?.[1] as
        | { time?: number; seekSeq?: number }
        | undefined;
      expect(lastPayload?.time).toBe(69);
      expect(typeof lastPayload?.seekSeq).toBe('number');

      service.destroy();
      vi.useRealTimers();
    }
  );

  it('ignores stale native currentTime right after seek until seek settles', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    vi.useFakeTimers();

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    const observed: number[] = [];
    const unsub = service.onTimeUpdate((time) => {
      observed.push(time);
    });

    (service as unknown as { state: { duration: number; currentTime: number } }).state.duration = 240;
    (service as unknown as { state: { duration: number; currentTime: number } }).state.currentTime = 5;

    service.seek(120);

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        currentTime: 22,
      },
    });

    expect(service.getCurrentTime()).toBe(120);
    expect(observed[observed.length - 1]).toBe(120);

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        currentTime: 120,
      },
    });

    expect(service.getCurrentTime()).toBe(120);

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        currentTime: 123,
      },
    });

    expect(service.getCurrentTime()).toBe(123);

    unsub();
    service.destroy();
    vi.useRealTimers();
  });

  it('keeps ignoring stale native currentTime for slow seek settle window', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    vi.useFakeTimers();

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    (service as unknown as { state: { duration: number; currentTime: number } }).state.duration = 240;
    (service as unknown as { state: { duration: number; currentTime: number } }).state.currentTime = 5;

    service.seek(120);
    await vi.advanceTimersByTimeAsync(2_000);

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        currentTime: 24,
      },
    });

    expect(service.getCurrentTime()).toBe(120);

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        currentTime: 120,
      },
    });

    expect(service.getCurrentTime()).toBe(120);

    service.destroy();
    vi.useRealTimers();
  });

  it('releases stale guard after seek command failure so backend clock can recover', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_seek') {
        return Promise.reject(new Error('seek failed'));
      }
      return Promise.resolve(undefined);
    });

    vi.useFakeTimers();

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    (service as unknown as { state: { duration: number; currentTime: number } }).state.duration = 240;
    (service as unknown as { state: { duration: number; currentTime: number } }).state.currentTime = 5;

    service.seek(120);
    await vi.advanceTimersByTimeAsync(100);

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        currentTime: 26,
      },
    });

    expect(service.getCurrentTime()).toBe(26);

    service.destroy();
    vi.useRealTimers();
  });

  it('does not rebuild queue/currentTrack when native state payload is unchanged', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    service.addMultipleToQueue([
      { id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' },
      { id: 't2', title: 'B', filePath: 'C:\\\\Music\\\\b.mp3' },
    ]);

    await service.playTrackAtIndex(0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const before = service.getState();
    const beforeQueueRef = before.queue;
    const beforeTrackRef = before.currentTrack;

    handlers.native_audio_state?.({
      payload: {
        queue: ['C:\\\\Music\\\\a.mp3', 'C:\\\\Music\\\\b.mp3'],
        currentIndex: 0,
        trackPath: 'C:\\\\Music\\\\a.mp3',
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const after = service.getState();
    expect(after.queue).toBe(beforeQueueRef);
    expect(after.currentTrack).toBe(beforeTrackRef);

    service.destroy();
  });

  it('applies temporary streaming recovery settings on underrun spikes', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockClear();

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        underrunEvents: 2,
        currentTime: 1,
        duration: 10,
      },
    });

    expect(invoke).toHaveBeenCalledWith('native_audio_set_streaming_buffer_settings', {
      startOrSeekSeconds: 3.2,
      crossfadeSeconds: 1.4,
      decodeMode: 'streaming',
      interactiveProfile: 'balanced',
    });

    service.destroy();
  });

  it('restores engine policy from storage', async () => {
    localStorage.setItem(
      STORAGE_KEYS.NATIVE_AUDIO_ENGINE_POLICY,
      JSON.stringify({
        transportMode: 'transport-exact',
        srcMode: 'target-rate',
        srcBackend: 'linear-simd',
        srcTargetSampleRate: 96000,
        outputQuantizationMode: 'round',
      })
    );

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(invoke).toHaveBeenCalledWith('native_audio_set_engine_policy', {
      transportMode: 'transport-exact',
      srcMode: 'target-rate',
      srcBackend: 'linear-simd',
      srcTargetSampleRate: 96000,
      outputQuantizationMode: 'round',
    });

    service.destroy();
  });

  it('defaults decodeMode to streaming when legacy buffer settings omit decodeMode', async () => {
    localStorage.setItem(
      STORAGE_KEYS.NATIVE_AUDIO_STREAMING_BUFFER_SETTINGS,
      JSON.stringify({
        startOrSeekSeconds: 1.2,
        crossfadeSeconds: 0.6,
        // decodeMode omitted (legacy payload)
      })
    );

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    const streamSettingCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === 'native_audio_set_streaming_buffer_settings'
    );

    expect(streamSettingCalls.length).toBeGreaterThan(0);
    expect(streamSettingCalls.at(-1)?.[1]).toMatchObject({
      decodeMode: 'streaming',
    });

    service.destroy();
  });

  it('keeps full-track decode mode when recovery policy escalates buffering', async () => {
    localStorage.setItem(
      STORAGE_KEYS.NATIVE_AUDIO_STREAMING_BUFFER_SETTINGS,
      JSON.stringify({
        startOrSeekSeconds: 1.4,
        crossfadeSeconds: 0.7,
        decodeMode: 'full-track',
        userSetDecodeMode: true,
      })
    );

    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockClear();

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        underrunEvents: 2,
        currentTime: 2,
        duration: 12,
      },
    });

    expect(invoke).toHaveBeenCalledWith('native_audio_set_streaming_buffer_settings', {
      startOrSeekSeconds: 3.2,
      crossfadeSeconds: 1.4,
      decodeMode: 'full-track',
      interactiveProfile: 'balanced',
    });

    service.destroy();
  });

  it('auto switches shared backend after repeated underrun spikes', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['wasapi-exclusive', 'rodio-cpal', 'wasapi', 'wasapi-shared-raw']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'rodio-cpal' });
      }
      if (cmd === 'native_audio_select_output_backend') {
        if (payload?.backendId === 'wasapi-shared-raw') {
          return Promise.resolve({ outputBackendId: 'wasapi-shared-raw' });
        }
        return Promise.resolve({ outputBackendId: 'rodio-cpal' });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    invokeMock.mockClear();

    handlers.native_audio_state?.({ payload: { playbackState: 'playing', underrunEvents: 1 } });
    handlers.native_audio_state?.({ payload: { playbackState: 'playing', underrunEvents: 2 } });
    handlers.native_audio_state?.({ payload: { playbackState: 'playing', underrunEvents: 3, underrunFrames: 2048 } });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(invoke).toHaveBeenCalledWith('native_audio_select_output_backend', {
      backendId: 'wasapi-shared-raw',
    });

    service.destroy();
  });

  it('does not treat underrun counter reset as a spike', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['wasapi-exclusive', 'rodio-cpal', 'wasapi']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'rodio-cpal' });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const baseline = service.getRobustnessSnapshot?.();
    expect(baseline?.underrunEvents).toBe(0);

    handlers.native_audio_state?.({ payload: { playbackState: 'playing', underrunEvents: 4 } });
    handlers.native_audio_state?.({ payload: { playbackState: 'playing', underrunEvents: 1 } });

    const afterReset = service.getRobustnessSnapshot?.();
    expect(afterReset?.underrunEvents).toBe(1);

    const backendSwitchCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === 'native_audio_select_output_backend'
    );
    expect(backendSwitchCalls).toHaveLength(0);

    service.destroy();
  });

  it('resets underrun metrics after shared backend switch', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['rodio-cpal', 'wasapi']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'rodio-cpal' });
      }
      if (cmd === 'native_audio_select_output_backend') {
        if (payload?.backendId === 'wasapi') {
          return Promise.resolve({ outputBackendId: 'wasapi' });
        }
        return Promise.resolve({ outputBackendId: 'rodio-cpal' });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    (service as unknown as { handleUnderrunSpike: (events: number, frames?: number) => void }).handleUnderrunSpike(5, 1024);
    let snapshot = service.getRobustnessSnapshot?.();
    expect(snapshot?.underrunEvents).toBe(5);

    await (service as unknown as {
      selectOutputBackendInternal: (
        backendId: string | null,
        options?: { persist?: boolean }
      ) => Promise<boolean>;
    }).selectOutputBackendInternal('wasapi', { persist: false });

    snapshot = service.getRobustnessSnapshot?.();
    expect(snapshot?.outputBackendId).toBe('wasapi');
    expect(snapshot?.underrunEvents).toBe(0);
    expect(snapshot?.underrunFrames).toBe(0);

    service.destroy();
  });

  it('keeps protection window active and then releases after timeout', async () => {
    vi.useFakeTimers();

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['rodio-cpal']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'rodio-cpal' });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    invokeMock.mockClear();
    const release = service.enterProtectionWindow?.({ reason: 'scan', durationMs: 2_000 });
    const during = service.getRobustnessSnapshot?.();
    expect(during?.protectionWindowActive).toBe(true);
    expect(during?.protectionRefCount).toBe(1);
    expect(during?.protectionReason).toBe('scan');

    release?.();

    await vi.advanceTimersByTimeAsync(2_100);
    const after = service.getRobustnessSnapshot?.();
    expect(after?.protectionWindowActive).toBe(false);
    expect(after?.protectionRefCount).toBe(0);

    service.destroy();
    vi.useRealTimers();
  });

  it('hydrates engine policy into robustness snapshot', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['rodio-cpal']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'rodio-cpal' });
      }
      if (cmd === 'native_audio_get_engine_policy') {
        return Promise.resolve({
          transportMode: 'transport-exact',
          hqSrcEnabled: true,
          hqSrcPhaseMode: 'linear',
          srcMode: 'target-rate',
          srcBackend: 'linear-simd',
          srcTargetSampleRate: 96000,
          hqSrcStopbandDb: 140,
          transportExactInt32Container: true,
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshot = service.getRobustnessSnapshot?.();
    expect(snapshot?.transportMode).toBe('transport-exact');
    expect(snapshot?.hqSrcPhaseMode).toBe('linear');
    expect(snapshot?.srcMode).toBe('target-rate');
    expect(snapshot?.srcBackend).toBe('linear-simd');
    expect(snapshot?.srcTargetSampleRate).toBe(96000);
    expect(snapshot?.hqSrcStopbandDb).toBe(140);
    expect(snapshot?.transportExactInt32Container).toBe(true);

    service.destroy();
  });

  it('marks output callback metrics unavailable for non-exclusive backend', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['wasapi', 'rodio-cpal']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'wasapi' });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    handlers.native_audio_state?.({
      payload: {
        outputCallbackMetricsValid: false,
        outputCallbackP99Us: 321,
        outputWaitTimeoutCount: 7,
        outputRenderUnderrunEvents: 3,
        outputRenderUnderrunFrames: 128,
        outputCallbackIntervalJitterP99Us: 456,
        outputCallbackIntervalOverrunCount: 9,
        outputCallbackExpectedIntervalUs: 10000,
      },
    });

    const snapshot = service.getRobustnessSnapshot?.();
    expect(snapshot?.outputCallbackMetricsValid).toBe(false);
    expect(snapshot?.outputCallbackP99Us).toBe(0);
    expect(snapshot?.outputWaitTimeoutCount).toBe(0);
    expect(snapshot?.outputRenderUnderrunEvents).toBe(0);
    expect(snapshot?.outputRenderUnderrunFrames).toBe(0);
    expect(snapshot?.outputCallbackIntervalJitterP99Us).toBe(0);
    expect(snapshot?.outputCallbackIntervalOverrunCount).toBe(0);
    expect(snapshot?.outputCallbackExpectedIntervalUs).toBe(0);

    service.destroy();
  });

  it('updates callback jitter metrics when exclusive metrics are valid', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['wasapi-exclusive']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'wasapi-exclusive' });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    handlers.native_audio_state?.({
      payload: {
        outputCallbackMetricsValid: true,
        outputCallbackP99Us: 120,
        outputWaitTimeoutCount: 2,
        outputRenderUnderrunEvents: 1,
        outputRenderUnderrunFrames: 64,
        outputCallbackIntervalJitterP99Us: 80,
        outputCallbackIntervalOverrunCount: 3,
        outputCallbackExpectedIntervalUs: 10000,
      },
    });

    const snapshot = service.getRobustnessSnapshot?.();
    expect(snapshot?.outputCallbackMetricsValid).toBe(true);
    expect(snapshot?.outputCallbackP99Us).toBe(120);
    expect(snapshot?.outputWaitTimeoutCount).toBe(2);
    expect(snapshot?.outputRenderUnderrunEvents).toBe(1);
    expect(snapshot?.outputRenderUnderrunFrames).toBe(64);
    expect(snapshot?.outputCallbackIntervalJitterP99Us).toBe(80);
    expect(snapshot?.outputCallbackIntervalOverrunCount).toBe(3);
    expect(snapshot?.outputCallbackExpectedIntervalUs).toBe(10000);

    service.destroy();
  });

  it('parses diagnostic timeline payload into robustness snapshot', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    handlers.native_audio_state?.({
      payload: {
        diagnosticTimelineDroppedEvents: 2,
        diagnosticTimeline: [
          {
            seq: 101,
            timestampMs: 1_700_000_000_000,
            kind: 'shared.transfer.render_low_watermark',
            value: 2048,
            aux: 4096,
          },
          {
            seq: 102,
            timestampMs: 1_700_000_000_050,
            kind: 'shared.output.render_underrun',
            value: 64,
            aux: 2,
          },
        ],
      },
    });

    const snapshot = service.getRobustnessSnapshot?.();
    expect(snapshot?.diagnosticTimelineDroppedEvents).toBe(2);
    expect(snapshot?.diagnosticTimeline?.length).toBe(2);
    expect(snapshot?.diagnosticTimeline?.[0]?.seq).toBe(101);
    expect(snapshot?.diagnosticTimeline?.[1]?.kind).toBe('shared.output.render_underrun');

    service.destroy();
  });

  it('tracks split decode/output buffered ahead metrics in robustness snapshot', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        bufferedAhead: 1.4,
        decodeBufferedAhead: 0.9,
        outputBufferedAhead: 0.5,
      },
    });

    const state = service.getState();
    expect(state.bufferedAhead).toBe(1.4);
    expect(state.decodeBufferedAhead).toBe(0.9);
    expect(state.outputBufferedAhead).toBe(0.5);

    const snapshot = service.getRobustnessSnapshot?.();
    expect(snapshot?.bufferedAheadSeconds).toBe(1.4);
    expect(snapshot?.decodeBufferedAheadSeconds).toBe(0.9);
    expect(snapshot?.outputBufferedAheadSeconds).toBe(0.5);

    service.destroy();
  });

  it('applies stronger shared-mode buffer policy when timeline shows sustained pressure', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['wasapi', 'rodio-cpal']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'wasapi' });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    invokeMock.mockClear();

    const now = Date.now();
    const lowWatermarkKinds = [
      'shared.transfer.render_low_watermark',
      'shared.transfer.decode_low_watermark',
      'shared.render_ahead.low_watermark',
    ] as const;

    const diagnosticTimeline = Array.from({ length: 20 }, (_, index) => ({
      seq: 201 + index,
      timestampMs: now - (120 - index),
      kind: lowWatermarkKinds[index % lowWatermarkKinds.length],
      value: 1024 - index * 12,
      aux: 4096,
    }));

    handlers.native_audio_state?.({
      payload: {
        diagnosticTimeline,
      },
    });

    const streamSettingCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === 'native_audio_set_streaming_buffer_settings'
    );

    expect(streamSettingCalls.length).toBeGreaterThan(0);
    expect(streamSettingCalls).toContainEqual([
      'native_audio_set_streaming_buffer_settings',
      {
        startOrSeekSeconds: 3.6,
        crossfadeSeconds: 1.9,
        decodeMode: 'streaming',
        interactiveProfile: 'balanced',
      },
    ]);

    const snapshot = service.getRobustnessSnapshot?.();
    expect(snapshot?.protectionReason).toBe('shared-low-watermark-pressure');

    service.destroy();
  });

  it('temporarily switches SRC to latency profile during seek and restores quality profile after stable window', async () => {
    vi.useFakeTimers();

    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['wasapi']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'wasapi' });
      }
      if (cmd === 'native_audio_get_engine_policy') {
        return Promise.resolve({
          srcMode: 'target-rate',
          srcBackend: 'rubato',
          srcTargetSampleRate: 96000,
        });
      }
      if (cmd === 'native_audio_set_engine_policy') {
        return Promise.resolve({
          srcMode: payload?.srcMode,
          srcBackend: payload?.srcBackend,
          srcTargetSampleRate: payload?.srcTargetSampleRate ?? null,
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    invokeMock.mockClear();
    (service as unknown as { state: { duration: number } }).state.duration = 200;
    service.seek(32);
    await vi.advanceTimersByTimeAsync(100);

    expect(invoke).toHaveBeenCalledWith('native_audio_set_engine_policy', {
      srcMode: 'match-output',
      srcBackend: 'rubato',
      srcTargetSampleRate: null,
    });

    const during = service.getRobustnessSnapshot?.();
    expect(during?.dynamicSrcProfile).toBe('latency');

    handlers.native_audio_state?.({ payload: { playbackState: 'playing', currentTime: 33 } });
    await vi.advanceTimersByTimeAsync(4_200);

    expect(invoke).toHaveBeenCalledWith('native_audio_set_engine_policy', {
      srcMode: 'target-rate',
      srcBackend: 'rubato',
      srcTargetSampleRate: 96000,
    });

    const restored = service.getRobustnessSnapshot?.();
    expect(restored?.dynamicSrcProfile).toBe('quality');

    service.destroy();
    vi.useRealTimers();
  });

  it('defers latency SRC switch until active seek command settles', async () => {
    vi.useFakeTimers();

    const seekGate: { release: (() => void) | null } = { release: null };
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'native_audio_get_engine_policy') {
        return Promise.resolve({
          srcMode: 'target-rate',
          srcBackend: 'rubato',
          srcTargetSampleRate: 96000,
        });
      }
      if (cmd === 'native_audio_set_engine_policy') {
        return Promise.resolve({
          srcMode: payload?.srcMode,
          srcBackend: payload?.srcBackend,
          srcTargetSampleRate: payload?.srcTargetSampleRate ?? null,
        });
      }
      if (cmd === 'native_audio_seek') {
        return new Promise<void>((resolve) => {
          seekGate.release = () => resolve();
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    invokeMock.mockClear();
    (service as unknown as { state: { duration: number } }).state.duration = 200;
    service.seek(48);
    await vi.advanceTimersByTimeAsync(100);

    expect(invoke).toHaveBeenCalledWith(
      'native_audio_seek',
      expect.objectContaining({ time: 48, seekSeq: expect.any(Number) })
    );

    const policyCallsWhileSeekInFlight = invokeMock.mock.calls.filter(
      (call) => call[0] === 'native_audio_set_engine_policy'
    );
    expect(policyCallsWhileSeekInFlight).toHaveLength(0);

    if (seekGate.release) {
      seekGate.release();
    }
    await vi.advanceTimersByTimeAsync(0);

    expect(invoke).toHaveBeenCalledWith('native_audio_set_engine_policy', {
      srcMode: 'match-output',
      srcBackend: 'rubato',
      srcTargetSampleRate: null,
    });

    service.destroy();
    vi.useRealTimers();
  });

  it('deduplicates deferred latency SRC switching during rapid seek bursts', async () => {
    vi.useFakeTimers();

    const pendingPolicyResolvers: Array<() => void> = [];
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'native_audio_get_engine_policy') {
        return Promise.resolve({
          srcMode: 'target-rate',
          srcBackend: 'rubato',
          srcTargetSampleRate: 96000,
        });
      }
      if (cmd === 'native_audio_set_engine_policy') {
        return new Promise((resolve) => {
          pendingPolicyResolvers.push(() =>
            resolve({
              srcMode: payload?.srcMode,
              srcBackend: payload?.srcBackend,
              srcTargetSampleRate: payload?.srcTargetSampleRate ?? null,
            })
          );
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    invokeMock.mockClear();
    (service as unknown as { state: { duration: number } }).state.duration = 300;

    for (let i = 0; i < 10; i += 1) {
      service.seek(12 + i * 8);
      await vi.advanceTimersByTimeAsync(30);
    }

    const latencyPolicyCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === 'native_audio_set_engine_policy'
    );
    expect(latencyPolicyCalls).toHaveLength(1);

    pendingPolicyResolvers.forEach((resolve) => resolve());
    await vi.advanceTimersByTimeAsync(0);

    service.destroy();
    vi.useRealTimers();
  });

  it('does not auto-switch SRC while manual SRC lock is active', async () => {
    vi.useFakeTimers();

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['wasapi']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'wasapi' });
      }
      if (cmd === 'native_audio_get_engine_policy') {
        return Promise.resolve({
          srcMode: 'target-rate',
          srcBackend: 'rubato',
          srcTargetSampleRate: 96000,
        });
      }
      if (cmd === 'native_audio_set_engine_policy') {
        return Promise.resolve({
          srcMode: payload?.srcMode,
          srcBackend: payload?.srcBackend,
          srcTargetSampleRate: payload?.srcTargetSampleRate ?? null,
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    await service.setEnginePolicy?.({
      srcMode: 'target-rate',
      srcBackend: 'rubato',
      srcTargetSampleRate: 96000,
    });

    invokeMock.mockClear();
    (service as unknown as { state: { duration: number } }).state.duration = 180;
    service.seek(18);
    await vi.advanceTimersByTimeAsync(80);

    const autoSrcCallsDuringManualLock = invokeMock.mock.calls.filter(
      (call) => call[0] === 'native_audio_set_engine_policy'
    );
    expect(autoSrcCallsDuringManualLock).toHaveLength(0);

    await service.setDynamicSrcAutoSettings?.({ enabled: true });

    invokeMock.mockClear();
    service.seek(42);
    await vi.advanceTimersByTimeAsync(80);

    expect(invoke).toHaveBeenCalledWith('native_audio_set_engine_policy', {
      srcMode: 'match-output',
      srcBackend: 'rubato',
      srcTargetSampleRate: null,
    });

    service.destroy();
    vi.useRealTimers();
  });

  it('persists engine policy after setEnginePolicy', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'native_audio_set_engine_policy') {
        return Promise.resolve({
          transportMode: payload?.transportMode,
          hqSrcPhaseMode: 'minimum',
          srcMode: payload?.srcMode,
          srcBackend: payload?.srcBackend,
          srcTargetSampleRate: payload?.srcTargetSampleRate ?? null,
          outputQuantizationMode: payload?.outputQuantizationMode,
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await service.setEnginePolicy?.({
      transportMode: 'robust',
      srcMode: 'target-rate',
      srcBackend: 'linear-simd',
      srcTargetSampleRate: 96000,
      outputQuantizationMode: 'tpdf',
    });

    const persistedRaw = localStorage.getItem(STORAGE_KEYS.NATIVE_AUDIO_ENGINE_POLICY);
    expect(persistedRaw).toBeTruthy();
    const persisted = JSON.parse(persistedRaw as string) as Record<string, unknown>;
    expect(persisted).toMatchObject({
      transportMode: 'robust',
      hqSrcPhaseMode: 'minimum',
      srcMode: 'target-rate',
      srcBackend: 'linear-simd',
      srcTargetSampleRate: 96000,
      outputQuantizationMode: 'tpdf',
    });

    service.destroy();
  });

  it('accepts configurable dynamic SRC timing parameters from settings and reflects them in snapshot', async () => {
    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await service.setDynamicSrcAutoSettings?.({
      enabled: true,
      adaptiveEnabled: true,
      learningEnabled: true,
      restoreDebounceMs: 5200,
      minSwitchIntervalMs: 900,
      seekHoldMs: 2500,
      underrunHoldMs: 18000,
      sharedStressHoldMs: 11000,
      outputErrorHoldMs: 15000,
    });

    const settings = service.getDynamicSrcAutoSettings?.();
    expect(settings?.restoreDebounceMs).toBe(5200);
    expect(settings?.minSwitchIntervalMs).toBe(900);
    expect(settings?.seekHoldMs).toBe(2500);
    expect(settings?.underrunHoldMs).toBe(18000);
    expect(settings?.sharedStressHoldMs).toBe(11000);
    expect(settings?.outputErrorHoldMs).toBe(15000);

    const snapshot = service.getRobustnessSnapshot?.();
    expect(snapshot?.dynamicSrcRestoreDebounceMs).toBe(5200);
    expect(snapshot?.dynamicSrcMinSwitchIntervalMs).toBe(900);
    expect(snapshot?.dynamicSrcSeekHoldMs).toBe(2500);
    expect(snapshot?.dynamicSrcUnderrunHoldMs).toBe(18000);
    expect(snapshot?.dynamicSrcSharedStressHoldMs).toBe(11000);
    expect(snapshot?.dynamicSrcOutputErrorHoldMs).toBe(15000);

    service.destroy();
  });

  it('applies tuning profile by syncing engine, dynamic SRC and streaming settings', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'native_audio_set_engine_policy') {
        return Promise.resolve({
          transportMode: payload?.transportMode,
          srcMode: payload?.srcMode,
          srcBackend: payload?.srcBackend,
          srcTargetSampleRate: payload?.srcTargetSampleRate ?? null,
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await service.applyTuningProfile?.('robust-shield');

    expect(invokeMock).toHaveBeenCalledWith('native_audio_set_engine_policy', {
      transportMode: 'robust',
      srcMode: 'match-output',
      srcBackend: 'rubato',
      srcTargetSampleRate: null,
      outputQuantizationMode: 'round',
    });

    const dynamicRaw = localStorage.getItem(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_SETTINGS);
    expect(dynamicRaw).toBeTruthy();
    const dynamicSettings = JSON.parse(dynamicRaw as string) as Record<string, unknown>;
    expect(dynamicSettings.restoreDebounceMs).toBe(6500);
    expect(dynamicSettings.minSwitchIntervalMs).toBe(900);
    expect(dynamicSettings.underrunHoldMs).toBe(22000);

    const bufferRaw = localStorage.getItem(STORAGE_KEYS.NATIVE_AUDIO_STREAMING_BUFFER_SETTINGS);
    expect(bufferRaw).toBeTruthy();
    const streamingSettings = JSON.parse(bufferRaw as string) as Record<string, unknown>;
    expect(streamingSettings.startOrSeekSeconds).toBe(1.2);
    expect(streamingSettings.crossfadeSeconds).toBe(1.95);
    expect(streamingSettings.decodeMode).toBe('streaming');
    expect(streamingSettings.interactiveProfile).toBe('stable');

    service.destroy();
  });

  it('persists and clamps auto tuning controller settings', async () => {
    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await service.setAudioTuningAutoSettings?.({
      enabled: true,
      tickIntervalMs: 120,
      stableWindowMs: 999_999,
      minSwitchIntervalMs: 500,
      postSwitchObserveWindowMs: 200_000,
      elevatedStressScore: 6,
      criticalStressScore: 4,
      criticalUnderrunEventsWindow: 99,
      criticalOverflowGrowthTicks: 99,
    });

    const settings = service.getAudioTuningAutoSettings?.();
    expect(settings).toEqual({
      enabled: true,
      tickIntervalMs: 500,
      stableWindowMs: 120_000,
      minSwitchIntervalMs: 1_000,
      postSwitchObserveWindowMs: 120_000,
      elevatedStressScore: 6,
      criticalStressScore: 6,
      criticalUnderrunEventsWindow: 12,
      criticalOverflowGrowthTicks: 8,
    });

    const raw = localStorage.getItem(STORAGE_KEYS.NATIVE_AUDIO_TUNING_AUTO_SETTINGS);
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw as string) as Record<string, unknown>;
    expect(persisted.enabled).toBe(true);
    expect(persisted.tickIntervalMs).toBe(500);
    expect(persisted.criticalStressScore).toBe(6);

    service.destroy();
  });

  it('auto tuning controller escalates to robust-shield under critical scheduler pressure', async () => {
    vi.useFakeTimers();

    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'native_audio_set_engine_policy') {
        return Promise.resolve({
          transportMode: payload?.transportMode,
          srcMode: payload?.srcMode,
          srcBackend: payload?.srcBackend,
          srcTargetSampleRate: payload?.srcTargetSampleRate ?? null,
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    await service.setAudioTuningAutoSettings?.({
      enabled: true,
      tickIntervalMs: 500,
      stableWindowMs: 5000,
      minSwitchIntervalMs: 1000,
      postSwitchObserveWindowMs: 1000,
      elevatedStressScore: 4,
      criticalStressScore: 8,
      criticalUnderrunEventsWindow: 2,
      criticalOverflowGrowthTicks: 2,
    });

    invokeMock.mockClear();

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        schedulerProfile: 'critical',
        currentTime: 1,
      },
    });

    await vi.advanceTimersByTimeAsync(650);

    expect(invokeMock).toHaveBeenCalledWith('native_audio_set_engine_policy', {
      transportMode: 'robust',
      srcMode: 'match-output',
      srcBackend: 'rubato',
      srcTargetSampleRate: null,
      outputQuantizationMode: 'round',
    });

    const snapshot = service.getRobustnessSnapshot?.();
    expect(snapshot?.tuningAutoEnabled).toBe(true);
    expect(snapshot?.tuningAutoActiveProfile).toBe('robust-shield');

    service.destroy();
    vi.useRealTimers();
  });

  it('persists per-device dynamic SRC learning profile and increases effective timing scale', async () => {
    vi.useFakeTimers();

    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['wasapi']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'wasapi' });
      }
      if (cmd === 'native_audio_get_engine_policy') {
        return Promise.resolve({
          srcMode: 'target-rate',
          srcBackend: 'rubato',
          srcTargetSampleRate: 96000,
        });
      }
      if (cmd === 'native_audio_set_engine_policy') {
        return Promise.resolve({
          srcMode: payload?.srcMode,
          srcBackend: payload?.srcBackend,
          srcTargetSampleRate: payload?.srcTargetSampleRate ?? null,
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    await service.setDynamicSrcAutoSettings?.({
      enabled: true,
      adaptiveEnabled: true,
      learningEnabled: true,
      restoreDebounceMs: 3000,
      minSwitchIntervalMs: 1000,
      seekHoldMs: 2000,
      underrunHoldMs: 3000,
      sharedStressHoldMs: 3000,
      outputErrorHoldMs: 3000,
    });

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        outputCallbackMetricsValid: true,
        outputWaitTimeoutCount: 3,
        outputRenderUnderrunEvents: 2,
        outputCallbackIntervalOverrunCount: 1,
      },
    });
    await vi.advanceTimersByTimeAsync(100);

    const snapshot = service.getRobustnessSnapshot?.();
    expect(snapshot?.dynamicSrcLearningEnabled).toBe(true);
    expect(typeof snapshot?.dynamicSrcLearningScale).toBe('number');
    expect((snapshot?.dynamicSrcLearningScale ?? 1) > 1).toBe(true);
    expect(typeof snapshot?.dynamicSrcLearningDeviceKey).toBe('string');
    expect((snapshot?.dynamicSrcLearningStressIndex ?? 0) > 0).toBe(true);

    const learningRaw = localStorage.getItem(STORAGE_KEYS.NATIVE_AUDIO_DYNAMIC_SRC_LEARNING_PROFILE);
    expect(typeof learningRaw).toBe('string');

    service.destroy();
    vi.useRealTimers();
  });

  it('applies adaptive timing profile when stress rises and restores baseline once stable', async () => {
    vi.useFakeTimers();

    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['wasapi']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'wasapi' });
      }
      if (cmd === 'native_audio_get_engine_policy') {
        return Promise.resolve({
          srcMode: 'target-rate',
          srcBackend: 'rubato',
          srcTargetSampleRate: 96000,
        });
      }
      if (cmd === 'native_audio_set_engine_policy') {
        return Promise.resolve({
          srcMode: payload?.srcMode,
          srcBackend: payload?.srcBackend,
          srcTargetSampleRate: payload?.srcTargetSampleRate ?? null,
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    await service.setDynamicSrcAutoSettings?.({
      enabled: true,
      adaptiveEnabled: true,
      learningEnabled: false,
      restoreDebounceMs: 2000,
      minSwitchIntervalMs: 1000,
      seekHoldMs: 1500,
      underrunHoldMs: 3000,
      sharedStressHoldMs: 3000,
      outputErrorHoldMs: 3000,
    });

    invokeMock.mockClear();
    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        outputCallbackMetricsValid: true,
        outputWaitTimeoutCount: 3,
        outputRenderUnderrunEvents: 2,
        outputCallbackIntervalOverrunCount: 1,
      },
    });
    (service as unknown as { state: { duration: number } }).state.duration = 120;
    service.seek(20);
    await vi.advanceTimersByTimeAsync(120);

    expect(invoke).toHaveBeenCalledWith('native_audio_set_engine_policy', {
      srcMode: 'match-output',
      srcBackend: 'rubato',
      srcTargetSampleRate: null,
    });

    const stressed = service.getRobustnessSnapshot?.();
    expect(stressed?.dynamicSrcAdaptiveEnabled).toBe(true);
    expect(stressed?.dynamicSrcAdaptiveProfile).not.toBe('baseline');
    expect(typeof stressed?.dynamicSrcStressScore).toBe('number');
    expect((stressed?.dynamicSrcStressScore ?? 0) > 0).toBe(true);
    expect((stressed?.dynamicSrcEffectiveRestoreDebounceMs ?? 0) > (stressed?.dynamicSrcRestoreDebounceMs ?? 0)).toBe(true);
    expect((stressed?.dynamicSrcEffectiveMinSwitchIntervalMs ?? 0) < (stressed?.dynamicSrcMinSwitchIntervalMs ?? 0)).toBe(true);

    handlers.native_audio_state?.({ payload: { playbackState: 'playing', currentTime: 22 } });
    handlers.native_audio_state?.({
      payload: {
        outputCallbackMetricsValid: true,
        outputWaitTimeoutCount: 0,
        outputRenderUnderrunEvents: 0,
        outputCallbackIntervalOverrunCount: 0,
      },
    });
    await vi.advanceTimersByTimeAsync(6200);

    const recovered = service.getRobustnessSnapshot?.();
    expect(recovered?.dynamicSrcAdaptiveProfile).toBe('baseline');
    expect(recovered?.dynamicSrcStressScore).toBe(0);
    expect(recovered?.dynamicSrcEffectiveRestoreDebounceMs).toBe(recovered?.dynamicSrcRestoreDebounceMs);
    expect(recovered?.dynamicSrcEffectiveMinSwitchIntervalMs).toBe(recovered?.dynamicSrcMinSwitchIntervalMs);

    service.destroy();
    vi.useRealTimers();
  });

  it('ignores legacy persisted output device preference on startup', async () => {
    localStorage.setItem(
      'pixel-matrix-native-audio-output-device',
      JSON.stringify({ id: 'device-stale', name: 'Old Device' })
    );

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['wasapi']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({
          outputBackendId: 'wasapi',
          outputDeviceId: 'device-1',
          outputDevice: 'Device One',
        });
      }
      if (cmd === 'native_audio_get_engine_policy') {
        return Promise.resolve({});
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await flushMicrotasks(10);

    expect(
      invokeMock.mock.calls.some(([cmd]) => cmd === 'native_audio_select_device')
    ).toBe(false);
    expect(localStorage.getItem('pixel-matrix-native-audio-output-device')).toBeNull();

    service.destroy();
  });

  it('tracks explicit L0/L1/L2 auto degradation and recovers back to L0', async () => {
    vi.useFakeTimers();

    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string, payload?: Record<string, unknown>) => {
      if (cmd === 'native_audio_list_output_backends') {
        return Promise.resolve(['wasapi']);
      }
      if (cmd === 'native_audio_get_audio_components_state') {
        return Promise.resolve({ outputBackendId: 'wasapi' });
      }
      if (cmd === 'native_audio_get_engine_policy') {
        return Promise.resolve({
          srcMode: 'target-rate',
          srcBackend: 'rubato',
          srcTargetSampleRate: 96000,
        });
      }
      if (cmd === 'native_audio_set_engine_policy') {
        return Promise.resolve({
          srcMode: payload?.srcMode,
          srcBackend: payload?.srcBackend,
          srcTargetSampleRate: payload?.srcTargetSampleRate ?? null,
        });
      }
      return Promise.resolve(undefined);
    });

    const service = new NativeAudioService();
    await vi.advanceTimersByTimeAsync(0);

    await service.setDynamicSrcAutoSettings?.({
      enabled: true,
      adaptiveEnabled: true,
      learningEnabled: false,
      restoreDebounceMs: 2000,
      minSwitchIntervalMs: 100,
      seekHoldMs: 1000,
      underrunHoldMs: 3000,
      sharedStressHoldMs: 3000,
      outputErrorHoldMs: 3000,
    });

    invokeMock.mockClear();

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        outputCallbackMetricsValid: true,
        outputWaitTimeoutCount: 3,
        outputRenderUnderrunEvents: 2,
        outputCallbackIntervalOverrunCount: 0,
      },
    });
    await vi.advanceTimersByTimeAsync(80);

    const l1 = service.getRobustnessSnapshot?.();
    expect(l1?.dynamicSrcAutoDegradationLevel).toBe(1);
    expect(l1?.dynamicSrcAutoDegradationLabel).toBe('l1-balanced');
    expect(l1?.dynamicSrcAutoDegradationReason).toBe('stress-score-elevated');
    expect(typeof l1?.dynamicSrcAutoDegradationLastChangedAtMs).toBe('number');

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        outputCallbackMetricsValid: true,
        outputWaitTimeoutCount: 3,
        outputRenderUnderrunEvents: 3,
        outputCallbackIntervalOverrunCount: 2,
      },
    });
    await vi.advanceTimersByTimeAsync(80);

    const l2 = service.getRobustnessSnapshot?.();
    expect(l2?.dynamicSrcAutoDegradationLevel).toBe(2);
    expect(l2?.dynamicSrcAutoDegradationLabel).toBe('l2-protection');
    expect(l2?.dynamicSrcAutoDegradationReason).toBe('stress-score-critical');

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        outputCallbackMetricsValid: true,
        outputWaitTimeoutCount: 0,
        outputRenderUnderrunEvents: 0,
        outputCallbackIntervalOverrunCount: 0,
      },
    });
    await vi.advanceTimersByTimeAsync(80);

    const l0 = service.getRobustnessSnapshot?.();
    expect(l0?.dynamicSrcAutoDegradationLevel).toBe(0);
    expect(l0?.dynamicSrcAutoDegradationLabel).toBe('l0-fidelity');
    expect(l0?.dynamicSrcAutoDegradationReason).toBeNull();

    service.destroy();
    vi.useRealTimers();
  });

  it('stores and exposes dual spectrum frames by tap', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    handlers.native_audio_spectrum?.({
      payload: {
        frameId: 100,
        timestampMs: 1234,
        tapId: 'pre-dsp',
        sampleRate: 48000,
        bins: [0.1, 0.2, 0.3],
      },
    });

    handlers.native_audio_spectrum?.({
      payload: {
        frameId: 100,
        timestampMs: 1234,
        tapId: 'post-dsp',
        sampleRate: 48000,
        bins: [0.2, 0.3, 0.4],
      },
    });

    const pre = service.getSpectrumFrame?.('pre-dsp');
    const post = service.getSpectrumFrame?.('post-dsp');

    expect(pre?.frameId).toBe(100);
    expect(pre?.tap).toBe('pre-dsp');
    expect(post?.frameId).toBe(100);
    expect(post?.tap).toBe('post-dsp');
    expect(post?.bins?.length).toBe(3);

    service.destroy();
  });

  it('normalizes queue and track path separators from native payloads', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    service.addMultipleToQueue([
      { id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a.mp3' },
      { id: 't2', title: 'B', filePath: 'C:\\\\Music\\\\b.mp3' },
    ]);

    await service.playTrackAtIndex(0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const before = service.getState();
    const beforeQueueRef = before.queue;
    const beforeTrackRef = before.currentTrack;

    handlers.native_audio_state?.({
      payload: {
        queue: ['C:/Music/a.mp3', 'C:/Music/b.mp3'],
        currentIndex: 0,
        trackPath: 'C:/Music/a.mp3',
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const after = service.getState();
    expect(after.queue).toBe(beforeQueueRef);
    expect(after.currentTrack).toBe(beforeTrackRef);

    service.destroy();
  });

  it('matches native trackPath variants like file URI and extended Windows prefix', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    service.addMultipleToQueue([{ id: 't1', title: 'A', filePath: 'C:\\\\Music\\\\a b.mp3' }]);
    await service.playTrackAtIndex(0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const expectedTrack = service.getState().currentTrack;
    expect(expectedTrack?.id).toBe('t1');

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        trackPath: 'file:///C:/Music/a%20b.mp3',
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.getState().currentTrack).toBe(expectedTrack);

    handlers.native_audio_state?.({
      payload: {
        playbackState: 'playing',
        trackPath: '\\\\?\\C:\\\\Music\\\\a b.mp3',
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.getState().currentTrack).toBe(expectedTrack);

    service.destroy();
  });

  it('accepts byte-encoded spectrum bins without re-normalization', async () => {
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>;
    const handlers: Record<string, ((event: { payload?: unknown }) => void) | undefined> = {};
    listenMock.mockImplementation(async (eventName: string, handler: (event: { payload?: unknown }) => void) => {
      handlers[eventName] = handler;
      return () => {};
    });

    const service = new NativeAudioService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    handlers.native_audio_spectrum?.({
      payload: {
        frameId: 101,
        timestampMs: 2234,
        tapId: 'post-dsp',
        sampleRate: 48000,
        bins: [0, 127, 255],
      },
    });

    const post = service.getSpectrumFrame?.('post-dsp');
    expect(post?.bins).toBeInstanceOf(Uint8Array);
    expect(Array.from(post?.bins ?? [])).toEqual([0, 127, 255]);
    expect(Array.from(service.getFrequencyData() ?? [])).toEqual([0, 127, 255]);

    service.destroy();
  });
});
