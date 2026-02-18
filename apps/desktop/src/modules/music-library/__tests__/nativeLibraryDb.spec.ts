import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupNativeLibrarySourceTracks,
  clearNativeLibraryTracks,
  deleteNativeLibraryTracks,
  listNativeLibrarySourceHealth,
  listNativeLibrarySources,
  queryNativeLibraryTracks,
} from '../nativeLibraryDb';

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/tauri', () => tauriMocks);

describe('nativeLibraryDb', () => {
  beforeEach(() => {
    tauriMocks.invoke.mockReset();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
  });

  it('normalizes extended track query payload fields', async () => {
    tauriMocks.invoke.mockResolvedValue([]);

    await queryNativeLibraryTracks({
      limit: 99999,
      offset: -10,
      includeMissing: true,
      visibleOnly: false,
      searchQuery: '  hello  ',
      artist: '  Artist A  ',
      album: '  Album A  ',
      trackId: '  track-1  ',
      sourceId: '  source-1  ',
    });

    expect(tauriMocks.invoke).toHaveBeenCalledWith('music_library_db_query_tracks', {
      query: {
        limit: 2000,
        offset: 0,
        includeMissing: true,
        visibleOnly: false,
        searchQuery: 'hello',
        artist: 'Artist A',
        album: 'Album A',
        trackId: 'track-1',
        sourceId: 'source-1',
      },
    });
  });

  it('parses native source records with trackCount', async () => {
    tauriMocks.invoke.mockResolvedValue([
      {
        id: 'source-1',
        path: 'D:/Music',
        displayName: 'Music',
        category: 'music',
        trackCount: 128,
        isVisible: true,
        isScanned: true,
        addedAtMs: 100,
        updatedAtMs: 200,
      },
      {
        id: 'source-2',
        path: 'E:/BGM',
        category: 'music',
        isVisible: true,
        isScanned: false,
        addedAtMs: 300,
        updatedAtMs: 400,
      },
    ]);

    const sources = await listNativeLibrarySources();
    expect(sources).toHaveLength(2);
    expect(sources[0].trackCount).toBe(128);
    expect(sources[1].trackCount).toBe(0);
  });

  it('clears native tracks and parses affected count', async () => {
    tauriMocks.invoke.mockResolvedValue(12);

    const affected = await clearNativeLibraryTracks();

    expect(tauriMocks.invoke).toHaveBeenCalledWith('music_library_db_clear_tracks');
    expect(affected).toBe(12);
  });

  it('normalizes delete track ids before invoking native command', async () => {
    tauriMocks.invoke.mockResolvedValue(2);

    const affected = await deleteNativeLibraryTracks(['  t-1  ', '   ', 't-2']);

    expect(tauriMocks.invoke).toHaveBeenCalledWith('music_library_db_delete_tracks', {
      trackIds: ['t-1', 't-2'],
    });
    expect(affected).toBe(2);
  });

  it('skips native delete call when ids are empty', async () => {
    const affected = await deleteNativeLibraryTracks(['', '   ']);
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    expect(affected).toBe(0);
  });

  it('normalizes source health query payload and parses rows', async () => {
    tauriMocks.invoke.mockResolvedValue([
      {
        sourceId: 'source-1',
        sourcePath: 'D:/Music',
        sourceDisplayName: 'Music',
        totalTracks: 120,
        availableTracks: 118,
        missingTracks: 2,
        totalArtists: 35,
        totalAlbums: 28,
        totalSize: 1024,
        sourceUpdatedAtMs: 1700000000,
        lastTrackUpdatedAtMs: 1700000123,
      },
    ]);

    const rows = await listNativeLibrarySourceHealth({ sourceId: '  source-1  ' });

    expect(tauriMocks.invoke).toHaveBeenCalledWith('music_library_db_list_source_health', {
      query: { sourceId: 'source-1' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].missingTracks).toBe(2);
  });

  it('normalizes source cleanup payload and parses affected count', async () => {
    tauriMocks.invoke.mockResolvedValue(7);

    const affected = await cleanupNativeLibrarySourceTracks('  source-2  ', {
      missingOnly: false,
    });

    expect(tauriMocks.invoke).toHaveBeenCalledWith('music_library_db_cleanup_source_tracks', {
      sourceId: 'source-2',
      missingOnly: false,
    });
    expect(affected).toBe(7);
  });
});
