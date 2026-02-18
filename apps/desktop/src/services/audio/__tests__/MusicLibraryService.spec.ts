import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/dialog', () => ({
  open: vi.fn(),
}));

vi.mock('@tauri-apps/api/fs', () => ({
  readDir: vi.fn(),
  exists: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/tauri';
import { MusicLibraryService } from '../MusicLibraryService';
import {
  clearCloudPlaybackFallbackQueue,
  getCloudPlaybackFallbackQueueSnapshot,
} from '../cloudPlaybackFallbackAdapter';

describe('MusicLibraryService.getCoverUrlForTrack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    clearCloudPlaybackFallbackQueue();

    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    (MusicLibraryService as unknown as { instance?: unknown }).instance = undefined;
    (MusicLibraryService as unknown as { startupRefreshScheduled?: boolean }).startupRefreshScheduled = false;
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  });

  it('ignores embedded base64 coverUrl for absolute paths in Tauri and resolves via Rust cache', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockResolvedValue({
      key: 'cover-abc-thumb-256px',
      path: 'C:\\AppData\\com.pixelmatrix.player\\music-covers\\cover-abc-thumb-256px.jpg',
      size: 12345,
      mediaType: 'image/jpeg',
    });

    const service = MusicLibraryService.getInstance();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

    (service as unknown as { upsertCoverCacheEntry: unknown }).upsertCoverCacheEntry = vi.fn().mockResolvedValue(undefined);
    (service as unknown as { maybeUpdateTrackCoverInDB: unknown }).maybeUpdateTrackCoverInDB = vi.fn().mockResolvedValue(undefined);
    (service as unknown as { pruneCoverCacheIfNeeded: unknown }).pruneCoverCacheIfNeeded = vi.fn().mockResolvedValue(undefined);

    const url = await service.getCoverUrlForTrack({
      id: 't1',
      title: 'Song',
      filePath: 'C:\\\\Music\\\\song.mp3',
      coverKey: 'legacy-thumb-256px',
      coverUrl: 'data:image/jpeg;base64,AAAA',
    });

    expect(invoke).toHaveBeenCalledWith(
      'music_library_get_cover',
      expect.objectContaining({ path: 'C:\\\\Music\\\\song.mp3' })
    );
    expect(url).toBe('pmp://cover/cover-abc-thumb-256px');
  });

  it('keeps embedded base64 coverUrl for non-absolute paths in Tauri', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockResolvedValue(null);

    const service = MusicLibraryService.getInstance();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

    const embedded = 'data:image/png;base64,BBBB';
    const url = await service.getCoverUrlForTrack({
      id: 't2',
      title: 'Relative',
      path: 'folder/relative.mp3',
      coverKey: 'legacy-thumb-256px',
      coverUrl: embedded,
    });

    expect(url).toBe(embedded);
    expect(invoke).not.toHaveBeenCalledWith('music_library_get_cover', expect.anything());
  });

  it('builds pmp cover url with size hint and requests matching thumbnail edge', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockResolvedValue({
      key: 'cover-small-thumb-160px',
      path: 'C:\\AppData\\com.pixelmatrix.player\\music-covers\\cover-small-thumb-160px.jpg',
      size: 8192,
      mediaType: 'image/jpeg',
    });

    const service = MusicLibraryService.getInstance();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

    (service as unknown as { upsertCoverCacheEntry: unknown }).upsertCoverCacheEntry = vi.fn().mockResolvedValue(undefined);
    (service as unknown as { maybeUpdateTrackCoverInDB: unknown }).maybeUpdateTrackCoverInDB = vi.fn().mockResolvedValue(undefined);
    (service as unknown as { pruneCoverCacheIfNeeded: unknown }).pruneCoverCacheIfNeeded = vi.fn().mockResolvedValue(undefined);

    const url = await service.getCoverUrlForTrack(
      {
        id: 't3',
        title: 'Sized',
        filePath: 'C:\\Music\\sized.mp3',
      },
      { coverSizeHint: 'small' }
    );

    expect(invoke).toHaveBeenCalledWith(
      'music_library_get_cover',
      expect.objectContaining({ path: 'C:\\Music\\sized.mp3', maxEdgePx: 160 })
    );
    expect(url).toBe('pmp://cover/cover-small-thumb-160px?size=small');
  });
});

describe('MusicLibraryService local resolver and playback stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    clearCloudPlaybackFallbackQueue();

    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    (MusicLibraryService as unknown as { instance?: unknown }).instance = undefined;
    (MusicLibraryService as unknown as { startupRefreshScheduled?: boolean }).startupRefreshScheduled = false;
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  });

  it('resolves local playback candidate by quick fingerprint', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'music_library_db_query_tracks') {
        return Promise.resolve([
          {
            id: 'track-qf-1',
            sourceId: 'source-1',
            filePath: 'C:\\Music\\found.flac',
            quickFingerprint: 'qf2:abcdef1234567890',
            title: 'Found',
            artist: 'Artist',
            album: 'Album',
            genre: 'Genre',
            durationSeconds: 123,
            status: 'available',
            playCount: 2,
            updatedAtMs: 1700000000,
          },
        ]);
      }
      return Promise.resolve(null);
    });

    const service = MusicLibraryService.getInstance();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

    const resolved = await service.resolveLocalPlaybackCandidate({
      quickFingerprint: '  ABCDEF1234567890  ',
      includeMissing: true,
      visibleOnly: false,
    });

    expect(invoke).toHaveBeenCalledWith('music_library_db_query_tracks', {
      query: expect.objectContaining({
        quickFingerprint: 'qf2:abcdef1234567890',
      }),
    });
    expect(resolved.strategy).toBe('quickFingerprint');
    expect(resolved.requiresNetworkFallback).toBe(false);
    expect(resolved.track?.filePath).toBe('C:\\Music\\found.flac');
    expect(resolved.track?.playCount).toBe(2);
  });

  it('marks track played through native database command', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'music_library_db_mark_track_played') {
        return Promise.resolve(true);
      }
      return Promise.resolve(null);
    });

    const service = MusicLibraryService.getInstance();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

    const updated = await service.markTrackPlayed('  track-1  ', {
      playedAtMs: 1700000123.8,
    });

    expect(updated).toBe(true);
    expect(invoke).toHaveBeenCalledWith('music_library_db_mark_track_played', {
      trackId: 'track-1',
      playedAtMs: 1700000123,
    });
  });

  it('builds local playback plan for cloud blueprint when local match exists', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'music_library_db_query_tracks') {
        return Promise.resolve([
          {
            id: 'track-local-1',
            sourceId: 'source-1',
            filePath: 'C:\\Music\\local.mp3',
            quickFingerprint: 'qf2:1234567890abcdef',
            title: 'Local Match',
            status: 'available',
            playCount: 3,
            updatedAtMs: 1700001000,
          },
        ]);
      }
      return Promise.resolve(null);
    });

    const service = MusicLibraryService.getInstance();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

    const plan = await service.resolvePlaybackPlanForCloudEntry({
      entryId: 'entry-1',
      ownerUid: 'u_10086',
      quickFingerprint: '1234567890abcdef',
    });

    expect(plan.strategy).toBe('local-quickFingerprint');
    expect(plan.local.track?.id).toBe('track-local-1');
    expect(plan.local.requiresNetworkFallback).toBe(false);
    expect(plan.networkFallback).toBeUndefined();
  });

  it('returns network blueprint plan when local candidate misses', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockResolvedValue([]);

    const service = MusicLibraryService.getInstance();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

    const plan = await service.resolvePlaybackPlanForCloudEntry({
      entryId: 'entry-miss-1',
      ownerUid: 'u_42',
      cloudContentId: 'cloud_hash_abc',
      quickFingerprint: 'abcdef1234567890',
    });

    expect(plan.strategy).toBe('network-blueprint');
    expect(plan.local.track).toBeNull();
    expect(plan.local.requiresNetworkFallback).toBe(true);
    expect(plan.networkFallback).toMatchObject({
      entryId: 'entry-miss-1',
      ownerUid: 'u_42',
      cloudContentId: 'cloud_hash_abc',
      quickFingerprint: 'qf2:abcdef1234567890',
      reason: 'local-miss',
    });
    expect(plan.fallbackDispatch).toMatchObject({
      accepted: true,
      deduped: false,
      queueSize: 1,
    });
    const queued = getCloudPlaybackFallbackQueueSnapshot();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      entryId: 'entry-miss-1',
      ownerUid: 'u_42',
      cloudContentId: 'cloud_hash_abc',
      quickFingerprint: 'qf2:abcdef1234567890',
      reason: 'local-miss',
    });
  });
});
