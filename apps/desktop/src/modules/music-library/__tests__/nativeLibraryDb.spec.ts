import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
});
