import { describe, expect, it, vi } from 'vitest';

import { createMusicLibraryReadGateway, type MusicLibraryReadGatewayContext } from '../musicLibraryReadGateway';

function createAsyncRequest(result: unknown) {
  const request: {
    result: unknown;
    error: unknown;
    onsuccess: ((event: { target: unknown }) => void) | null;
    onerror: (() => void) | null;
  } = {
    result,
    error: null,
    onsuccess: null,
    onerror: null,
  };

  queueMicrotask(() => {
    request.onsuccess?.({ target: request });
  });

  return request;
}

function createCursorRequest(values: unknown[]) {
  const request: {
    result: unknown;
    error: unknown;
    onsuccess: ((event: { target: unknown }) => void) | null;
    onerror: (() => void) | null;
  } = {
    result: null,
    error: null,
    onsuccess: null,
    onerror: null,
  };

  let index = 0;

  const advance = () => {
    if (index >= values.length) {
      request.result = null;
      request.onsuccess?.({ target: request });
      return;
    }

    const value = values[index++];
    request.result = {
      value,
      continue: () => queueMicrotask(advance),
    };
    request.onsuccess?.({ target: request });
  };

  queueMicrotask(advance);
  return request;
}

function createFakeDb(records: Array<Record<string, unknown>>, options?: { hasAlbumIndex?: boolean }) {
  const hasAlbumIndex = options?.hasAlbumIndex ?? true;

  const store = {
    indexNames: {
      contains: (name: string) => hasAlbumIndex && name === 'album',
    },
    getAll: () => createAsyncRequest(records),
    openCursor: () => createCursorRequest(records),
    index: (name: string) => {
      if (name !== 'album') {
        throw new Error(`Unexpected index: ${name}`);
      }

      return {
        getAll: (album: string) =>
          createAsyncRequest(records.filter((record) => String(record.album ?? '') === album)),
        openCursor: () => createCursorRequest(records),
      };
    },
  };

  return {
    transaction: () => ({
      objectStore: () => store,
    }),
  } as unknown as IDBDatabase;
}

function createContext(
  overrides: Partial<MusicLibraryReadGatewayContext> = {}
): MusicLibraryReadGatewayContext {
  const context: MusicLibraryReadGatewayContext = {
    isDesktopRuntime: () => false,
    tryGetAllTracksFromNativeDb: vi.fn().mockResolvedValue(null),
    trySearchTracksFromNativeDb: vi.fn().mockResolvedValue(null),
    tryGetTracksByAlbumFromNativeDb: vi.fn().mockResolvedValue(null),
    tryGetAllAlbumsFromNativeDb: vi.fn().mockResolvedValue(null),
    tryGetLibraryStatsFromNativeDb: vi.fn().mockResolvedValue(null),
    ensureDb: vi.fn().mockResolvedValue(createFakeDb([])),
    buildPathVisibilityContext: vi.fn().mockResolvedValue({}),
    isStoredTrackVisible: vi.fn().mockImplementation((track: Record<string, unknown>) => track.visible !== false),
    restoreTrackForListProjection: vi
      .fn()
      .mockImplementation((track: Record<string, unknown>) => ({ ...track, projection: 'list' })),
    restoreTrackForPlayback: vi
      .fn()
      .mockImplementation((track: Record<string, unknown>) => ({ ...track, projection: 'playback' })),
    sanitizeStoredCoverUrlForPath: vi
      .fn()
      .mockImplementation((coverUrl: unknown) => (typeof coverUrl === 'string' ? `safe:${coverUrl}` : undefined)),
  };

  return {
    ...context,
    ...overrides,
  };
}

describe('musicLibraryReadGateway', () => {
  it('selects the desktop gateway dynamically at call time', async () => {
    let desktopRuntime = false;
    const nativeTracks = [{ id: 'native-track-1', title: 'Native Track' }];
    const context = createContext({
      isDesktopRuntime: () => desktopRuntime,
      tryGetAllTracksFromNativeDb: vi.fn().mockResolvedValue(nativeTracks),
      ensureDb: vi.fn().mockResolvedValue(createFakeDb([{ id: 'web-track-1', title: 'Web Track' }])),
    });

    const gateway = createMusicLibraryReadGateway(context);
    desktopRuntime = true;

    const result = await gateway.getAllTracks(50, 10);

    expect(context.tryGetAllTracksFromNativeDb).toHaveBeenCalledWith(50, 10);
    expect(context.ensureDb).not.toHaveBeenCalled();
    expect(result).toEqual(nativeTracks);
  });

  it('uses IndexedDB search in web runtime and respects visibility plus limit', async () => {
    const records = [
      { id: 'hidden', title: 'Hidden Match', artist: 'Artist', album: 'Album', visible: false },
      { id: 'first', title: 'Needle Song', artist: 'Artist', album: 'Album', visible: true },
      { id: 'second', title: 'Another Needle', artist: 'Artist', album: 'Album', visible: true },
    ];
    const context = createContext({
      ensureDb: vi.fn().mockResolvedValue(createFakeDb(records)),
    });

    const gateway = createMusicLibraryReadGateway(context);
    const result = await gateway.searchTracks('needle', 1);

    expect(context.trySearchTracksFromNativeDb).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'first', projection: 'list' });
  });

  it('loads album tracks from IndexedDB using playback projection', async () => {
    const records = [
      { id: 'album-1', title: 'Track 1', album: 'Target Album', visible: true },
      { id: 'album-2', title: 'Track 2', album: 'Target Album', visible: true },
      { id: 'other', title: 'Other', album: 'Other Album', visible: true },
    ];
    const context = createContext({
      ensureDb: vi.fn().mockResolvedValue(createFakeDb(records)),
    });

    const gateway = createMusicLibraryReadGateway(context);
    const result = await gateway.getTracksByAlbum('Target Album');

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'album-1', projection: 'playback' });
    expect(result[1]).toMatchObject({ id: 'album-2', projection: 'playback' });
  });

  it('builds album summaries from IndexedDB and sanitizes stored cover urls', async () => {
    const records = [
      {
        id: 'cover-track-1',
        title: 'Track 1',
        album: 'Album A',
        artist: 'Artist A',
        coverUrl: 'blob:cover-a',
        filePath: 'C:\\Music\\album-a-1.mp3',
        visible: true,
      },
      {
        id: 'cover-track-2',
        title: 'Track 2',
        album: 'Album A',
        artist: 'Artist A',
        coverUrl: 'blob:cover-a-duplicate',
        filePath: 'C:\\Music\\album-a-2.mp3',
        visible: true,
      },
      {
        id: 'cover-track-3',
        title: 'Track 3',
        album: 'Album B',
        artist: 'Artist B',
        coverUrl: 'blob:cover-b',
        filePath: 'C:\\Music\\album-b-1.mp3',
        visible: true,
      },
    ];
    const context = createContext({
      ensureDb: vi.fn().mockResolvedValue(createFakeDb(records)),
    });

    const gateway = createMusicLibraryReadGateway(context);
    const result = await gateway.getAllAlbums({ includeStoredCover: true });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      album: 'Album A',
      artist: 'Artist A',
      cover: 'safe:blob:cover-a',
      coverTrackId: 'cover-track-1',
    });
    expect(result[1]).toMatchObject({
      album: 'Album B',
      artist: 'Artist B',
      cover: 'safe:blob:cover-b',
      coverTrackId: 'cover-track-3',
    });
  });

  it('aggregates library stats from visible IndexedDB tracks', async () => {
    const records = [
      { id: 's1', title: 'Track 1', artist: 'Artist A', album: 'Album A', duration: 120, fileSize: 1000, visible: true },
      { id: 's2', title: 'Track 2', artist: 'Artist A', album: 'Album B', duration: 180, fileSize: 2000, visible: true },
      { id: 's3', title: 'Track 3', artist: 'Artist B', album: 'Album B', duration: 240, fileSize: 3000, visible: false },
    ];
    const context = createContext({
      ensureDb: vi.fn().mockResolvedValue(createFakeDb(records)),
    });

    const gateway = createMusicLibraryReadGateway(context);
    const stats = await gateway.getLibraryStats();

    expect(stats).toEqual({
      totalTracks: 2,
      totalArtists: 1,
      totalAlbums: 2,
      totalSize: 3000,
      totalDuration: 300,
    });
  });
});
