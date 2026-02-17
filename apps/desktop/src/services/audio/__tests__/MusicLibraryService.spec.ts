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

describe('MusicLibraryService.getCoverUrlForTrack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

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
