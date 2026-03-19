import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `http://asset.localhost/${String(path).replace(/\\/g, '/')}`),
}));

vi.mock('@tauri-apps/api/dialog', () => ({
  open: vi.fn(),
}));

vi.mock('@tauri-apps/api/fs', () => ({
  readDir: vi.fn(),
  exists: vi.fn(),
  readBinaryFile: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
}));

import { invoke } from '@tauri-apps/api/tauri';
import { MusicLibraryService } from '../MusicLibraryService';
import { PMP_STORAGE_CHANGE_EVENT } from '../../../modules/storage/localStorage';
import { replaceMusicLibraryBaseFieldCapabilities } from '../../../modules/music-library/fieldCapabilities';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';
import {
  clearCloudPlaybackFallbackQueue,
  getCloudPlaybackFallbackQueueSnapshot,
} from '../cloudPlaybackFallbackAdapter';

describe('MusicLibraryService.getCoverUrlForTrack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    clearCloudPlaybackFallbackQueue();
    replaceMusicLibraryBaseFieldCapabilities([], { source: 'extension' });

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:mock-cover-url'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

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
    expect(url?.startsWith('blob:')).toBe(true);
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
      key: 'cover-small-thumb-96px',
      path: 'C:\\AppData\\com.pixelmatrix.player\\music-covers\\cover-small-thumb-96px.jpg',
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
      expect.objectContaining({ path: 'C:\\Music\\sized.mp3', maxEdgePx: 96 })
    );
    expect(url?.startsWith('blob:')).toBe(true);
  });

  it('applies the configured thumbnail quality cap to larger size hints', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockResolvedValue({
      key: 'cover-medium-thumb-128px',
      path: 'C:\\AppData\\com.pixelmatrix.player\\music-covers\\cover-medium-thumb-128px.jpg',
      size: 12288,
      mediaType: 'image/jpeg',
    });

    localStorage.setItem(STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX, JSON.stringify(128));

    const service = MusicLibraryService.getInstance();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

    (service as unknown as { upsertCoverCacheEntry: unknown }).upsertCoverCacheEntry = vi.fn().mockResolvedValue(undefined);
    (service as unknown as { maybeUpdateTrackCoverInDB: unknown }).maybeUpdateTrackCoverInDB = vi.fn().mockResolvedValue(undefined);
    (service as unknown as { pruneCoverCacheIfNeeded: unknown }).pruneCoverCacheIfNeeded = vi.fn().mockResolvedValue(undefined);

    const url = await service.getCoverUrlForTrack(
      {
        id: 't3-medium',
        title: 'Sized Medium',
        filePath: 'C:\\Music\\sized-medium.mp3',
      },
      { coverSizeHint: 'medium' }
    );

    expect(invoke).toHaveBeenCalledWith(
      'music_library_get_cover',
      expect.objectContaining({ path: 'C:\\Music\\sized-medium.mp3', maxEdgePx: 128 })
    );
    expect(url?.startsWith('blob:')).toBe(true);
  });

  it('clears runtime cover caches when thumbnail quality setting changes', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockResolvedValue({
      key: 'cover-medium-thumb-256px',
      path: 'C:\\AppData\\com.pixelmatrix.player\\music-covers\\cover-medium-thumb-256px.jpg',
      size: 12288,
      mediaType: 'image/jpeg',
    });

    localStorage.setItem(STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX, JSON.stringify(256));

    const service = MusicLibraryService.getInstance();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

    (service as unknown as { upsertCoverCacheEntry: unknown }).upsertCoverCacheEntry = vi.fn().mockResolvedValue(undefined);
    (service as unknown as { maybeUpdateTrackCoverInDB: unknown }).maybeUpdateTrackCoverInDB = vi.fn().mockResolvedValue(undefined);
    (service as unknown as { pruneCoverCacheIfNeeded: unknown }).pruneCoverCacheIfNeeded = vi.fn().mockResolvedValue(undefined);

    await service.getCoverUrlForTrack(
      {
        id: 't3-cache',
        title: 'Cached Cover',
        filePath: 'C:\\Music\\cached-cover.mp3',
      },
      { coverSizeHint: 'medium' }
    );

    expect(service.getCoverRuntimeCacheStats().coverUrlCacheEntries).toBeGreaterThan(0);

    localStorage.setItem(STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX, JSON.stringify(128));
    window.dispatchEvent(
      new CustomEvent(PMP_STORAGE_CHANGE_EVENT, {
        detail: {
          key: STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX,
          value: JSON.stringify(128),
        },
      })
    );

    expect(service.getCoverRuntimeCacheStats().coverUrlCacheEntries).toBe(0);
    expect(service.getCoverRuntimeCacheStats().coverBlobUrlCacheEntries).toBe(0);
  });

  it('uses full projection when native grouping depends on a custom field', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockResolvedValue({ items: [], total: 0 });

    replaceMusicLibraryBaseFieldCapabilities(
      [
        {
          id: 'moodLabel',
          label: 'Mood',
          kind: 'text',
          filterable: true,
          sortable: true,
          groupable: true,
          facetable: true,
          nativeSortField: 'moodLabel',
        },
      ],
      { source: 'extension' }
    );

    const service = MusicLibraryService.getInstance();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

    await service.queryLocalTracksPageByBase({
      searchQuery: '',
      baseQuery: {
        filterOperator: 'and',
        filterGroups: [],
        groupByRules: [
          {
            id: 'group-1',
            field: 'moodLabel',
            order: 'asc',
          },
        ],
        sortRules: [],
      },
      limit: 120,
      offset: 0,
      includeMissing: false,
      visibleOnly: true,
    });

    expect(invokeMock).toHaveBeenCalledWith(
      'music_library_db_query_tracks_page',
      expect.objectContaining({
        query: expect.objectContaining({
          projection: 'full',
        }),
      })
    );
  });

  it('keeps builtin format grouping on native base query path with list projection', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockResolvedValue({ items: [], total: 0 });

    const service = MusicLibraryService.getInstance();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

    const result = await service.queryLocalTracksPageByBase({
      searchQuery: '',
      baseQuery: {
        filterOperator: 'and',
        filterGroups: [],
        groupByRules: [
          {
            id: 'group-format',
            field: 'format',
            order: 'asc',
          },
        ],
        sortRules: [],
      },
      limit: 120,
      offset: 0,
      includeMissing: false,
      visibleOnly: true,
    });

    expect(result).toEqual({ tracks: [], total: 0 });
    expect(invokeMock).toHaveBeenCalledWith(
      'music_library_db_query_tracks_page',
      expect.objectContaining({
        query: expect.objectContaining({
          projection: 'list',
        }),
      })
    );
  });

  it('maps native year and format fields into restored local tracks', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockResolvedValue({
      items: [
        {
          id: 'track-format-1',
          sourceId: 'source-1',
          filePath: 'C:\\Music\\format-test.flac',
          title: 'Format Test',
          artist: 'Tester',
          album: 'Album',
          genre: 'Jazz',
          year: 2024,
          format: 'flac',
          playCount: 0,
          status: 'available',
          updatedAtMs: 1700000000000,
        },
      ],
      total: 1,
    });

    const service = MusicLibraryService.getInstance();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

    const result = await service.queryLocalTracksPageByBase({
      searchQuery: '',
      baseQuery: {
        filterOperator: 'and',
        filterGroups: [],
        groupByRules: [{ id: 'group-format', field: 'format', order: 'asc' }],
        sortRules: [],
      },
      limit: 120,
      offset: 0,
      includeMissing: false,
      visibleOnly: true,
    });

    expect(result?.tracks[0]).toMatchObject({
      year: 2024,
      format: 'flac',
    });
  });

  it('keeps builtin numeric filters on the native base query path', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockResolvedValue({ items: [], total: 0 });

    const service = MusicLibraryService.getInstance();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

    const result = await service.queryLocalTracksPageByBase({
      searchQuery: '',
      baseQuery: {
        filterOperator: 'and',
        filterGroups: [
          {
            id: 'filter-group-year',
            operator: 'and',
            filters: [
              {
                id: 'filter-year-gte',
                field: 'year',
                operator: 'gte',
                value: '2020',
              },
            ],
          },
        ],
        groupByRules: [],
        sortRules: [],
      },
      limit: 120,
      offset: 0,
      includeMissing: false,
      visibleOnly: true,
    });

    expect(result).toEqual({ tracks: [], total: 0 });
    expect(invokeMock).toHaveBeenCalledWith(
      'music_library_db_query_tracks_page',
      expect.objectContaining({
        query: expect.objectContaining({
          baseQuery: expect.objectContaining({
            filterGroups: [
              {
                operator: 'and',
                filters: [{ field: 'year', operator: 'gte', value: '2020' }],
              },
            ],
          }),
        }),
      })
    );
  });

  it('maps numeric native extension filters without falling back to query-page cache', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockResolvedValue({ items: [], total: 0 });

    replaceMusicLibraryBaseFieldCapabilities(
      [
        {
          id: 'energyScore',
          label: 'Energy',
          kind: 'number',
          filterable: true,
          sortable: true,
          groupable: false,
          nativeFilterField: 'energyScore',
          nativeSortField: 'energyScore',
        },
      ],
      { source: 'extension' }
    );

    const service = MusicLibraryService.getInstance();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

    const result = await service.queryLocalTracksPageByBase({
      searchQuery: '',
      baseQuery: {
        filterOperator: 'and',
        filterGroups: [
          {
            id: 'filter-group-energy',
            operator: 'and',
            filters: [
              {
                id: 'filter-energy-gte',
                field: 'energyScore',
                operator: 'gte',
                value: '42',
              },
            ],
          },
        ],
        groupByRules: [],
        sortRules: [],
      },
      limit: 120,
      offset: 0,
      includeMissing: false,
      visibleOnly: true,
    });

    expect(result).toEqual({ tracks: [], total: 0 });
    expect(invokeMock).toHaveBeenCalledWith(
      'music_library_db_query_tracks_page',
      expect.objectContaining({
        query: expect.objectContaining({
          baseQuery: expect.objectContaining({
            filterGroups: [
              {
                operator: 'and',
                filters: [{ field: 'energyScore', operator: 'gte', value: '42' }],
              },
            ],
          }),
        }),
      })
    );
  });

  it('replaces stale pmp coverUrl in http dev runtime with asset url fallback', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockResolvedValue({
      key: 'cover-dev-thumb-256px',
      path: 'C:\\AppData\\com.pixelmatrix.player\\music-covers\\cover-dev-thumb-256px.jpg',
      size: 2048,
      mediaType: 'image/jpeg',
    });

    const service = MusicLibraryService.getInstance();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

    (service as unknown as { upsertCoverCacheEntry: unknown }).upsertCoverCacheEntry = vi
      .fn()
      .mockResolvedValue(undefined);
    (service as unknown as { maybeUpdateTrackCoverInDB: unknown }).maybeUpdateTrackCoverInDB = vi
      .fn()
      .mockResolvedValue(undefined);
    (service as unknown as { pruneCoverCacheIfNeeded: unknown }).pruneCoverCacheIfNeeded = vi
      .fn()
      .mockResolvedValue(undefined);

    const url = await service.getCoverUrlForTrack({
      id: 't-dev-1',
      title: 'Dev URL',
      filePath: 'C:\\Music\\dev.mp3',
      coverUrl: 'pmp://cover/cover-dev-thumb-256px?size=medium',
    });

    expect(invoke).toHaveBeenCalledWith(
      'music_library_get_cover',
      expect.objectContaining({ path: 'C:\\Music\\dev.mp3' })
    );
    expect(url?.startsWith('blob:')).toBe(true);
  });

  it('allows bypassing hidden runtime cache policy for active track cover resolution', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockResolvedValue({
      key: 'cover-hidden-thumb-256px',
      path: 'C:\\AppData\\com.pixelmatrix.player\\music-covers\\cover-hidden-thumb-256px.jpg',
      size: 4096,
      mediaType: 'image/jpeg',
    });

    const service = MusicLibraryService.getInstance();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

    (service as unknown as { upsertCoverCacheEntry: unknown }).upsertCoverCacheEntry = vi
      .fn()
      .mockResolvedValue(undefined);
    (service as unknown as { maybeUpdateTrackCoverInDB: unknown }).maybeUpdateTrackCoverInDB = vi
      .fn()
      .mockResolvedValue(undefined);
    (service as unknown as { pruneCoverCacheIfNeeded: unknown }).pruneCoverCacheIfNeeded = vi
      .fn()
      .mockResolvedValue(undefined);

    service.applyCoverRuntimeCachePolicy('hidden');

    const track = {
      id: 't-hidden',
      title: 'Hidden Policy Track',
      filePath: 'C:\\Music\\hidden.mp3',
    };

    const blocked = await service.getCoverUrlForTrack(track);
    expect(blocked).toBeUndefined();

    const url = await service.getCoverUrlForTrack(track, { bypassRuntimePolicy: true });
    expect(url?.startsWith('blob:')).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      'music_library_get_cover',
      expect.objectContaining({ path: 'C:\\Music\\hidden.mp3' })
    );
  });

  it('does not fall back to stale asset.localhost cover urls for absolute desktop tracks', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockResolvedValue(null);

    const service = MusicLibraryService.getInstance();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

    const url = await service.getCoverUrlForTrack({
      id: 't-stale-asset',
      title: 'Stale Asset Cover',
      filePath: 'C:\\Music\\stale-cover.mp3',
      coverUrl:
        'https://asset.localhost/C%3A%5CUsers%5C31625%5CAppData%5CRoaming%5Ccom.pixelmatrix.player%5Cmusic-covers%5Ccover-stale-thumb-96px.jpg',
    });

    expect(url).toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith(
      'music_library_get_cover',
      expect.objectContaining({ path: 'C:\\Music\\stale-cover.mp3' })
    );
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

describe('MusicLibraryService cloud library persistence helpers', () => {
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

  it('upserts cloud library entry through native db bridge', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'music_library_db_upsert_user_entry') {
        return Promise.resolve({
          id: 'entry-1',
          ownerUid: 'u_1',
          inCloud: true,
          isMissing: false,
          playCount: 0,
          createdAtMs: 1700000000,
          updatedAtMs: 1700000001,
        });
      }
      return Promise.resolve(null);
    });

    const service = MusicLibraryService.getInstance();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

    const result = await service.upsertCloudLibraryEntry({
      entryId: '  entry-1  ',
      ownerUid: '  u_1  ',
      quickFingerprint: '  ABCDEF1234567890  ',
      inCloud: true,
    });

    expect(invoke).toHaveBeenCalledWith(
      'music_library_db_upsert_user_entry',
      expect.objectContaining({
        entry: expect.objectContaining({
          id: 'entry-1',
          ownerUid: 'u_1',
          quickFingerprint: 'qf2:abcdef1234567890',
          inCloud: true,
        }),
      })
    );
    expect(result?.id).toBe('entry-1');
  });

  it('queues fallback task and cloud hash job via native db bridge', async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'music_library_db_upsert_fallback_task') {
        return Promise.resolve({
          id: 'task-1',
          ownerUid: 'u_2',
          entryId: 'entry-2',
          reason: 'local-miss',
          status: 'queued',
          enqueueCount: 1,
          requestedAtMs: 1700000100,
          lastRequestedAtMs: 1700000100,
          updatedAtMs: 1700000101,
        });
      }
      if (cmd === 'music_library_db_upsert_cloud_hash_job') {
        return Promise.resolve({
          id: 'job-1',
          ownerUid: 'u_2',
          entryId: 'entry-2',
          status: 'pending',
          attemptCount: 1,
          requestedAtMs: 1700000200,
          updatedAtMs: 1700000201,
        });
      }
      return Promise.resolve(null);
    });

    const service = MusicLibraryService.getInstance();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

    const fallbackTask = await service.queueCloudFallbackTask({
      entryId: 'entry-2',
      ownerUid: 'u_2',
      quickFingerprint: 'abcdef1234567890',
      requestedAtMs: 1700000100,
      reason: 'local-miss',
    });

    const hashJob = await service.upsertCloudHashJob({
      ownerUid: 'u_2',
      entryId: 'entry-2',
      quickFingerprint: 'abcdef1234567890',
      status: 'pending',
      requestedAtMs: 1700000200,
    });

    expect(fallbackTask?.status).toBe('queued');
    expect(hashJob?.status).toBe('pending');
    expect(invoke).toHaveBeenCalledWith(
      'music_library_db_upsert_fallback_task',
      expect.objectContaining({
        task: expect.objectContaining({
          ownerUid: 'u_2',
          entryId: 'entry-2',
          quickFingerprint: 'qf2:abcdef1234567890',
        }),
      })
    );
    expect(invoke).toHaveBeenCalledWith(
      'music_library_db_upsert_cloud_hash_job',
      expect.objectContaining({
        job: expect.objectContaining({
          ownerUid: 'u_2',
          entryId: 'entry-2',
          quickFingerprint: 'qf2:abcdef1234567890',
          status: 'pending',
        }),
      })
    );
  });
});
