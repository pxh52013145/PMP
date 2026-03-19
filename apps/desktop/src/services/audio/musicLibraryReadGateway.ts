import type { Track } from '../audio';
import type { AlbumSummary, LibraryStats } from './MusicLibraryService';

export type NativeReadResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'unavailable' };

export interface MusicLibraryReadGateway {
  getAllTracks(limit?: number, offset?: number): Promise<Track[]>;
  searchTracks(query: string, limit?: number): Promise<Track[]>;
  getTracksByAlbum(album: string): Promise<Track[]>;
  getAllAlbums(options?: { includeStoredCover?: boolean }): Promise<AlbumSummary[]>;
  getLibraryStats(): Promise<LibraryStats>;
}

export interface MusicLibraryReadGatewayContext {
  isDesktopRuntime(): boolean;
  shouldAllowDesktopWebFallback?(): boolean;
  tryGetAllTracksFromNativeDb(limit?: number, offset?: number): Promise<NativeReadResult<Track[]>>;
  trySearchTracksFromNativeDb(query: string, limit?: number): Promise<NativeReadResult<Track[]>>;
  tryGetTracksByAlbumFromNativeDb(album: string): Promise<NativeReadResult<Track[]>>;
  tryGetAllAlbumsFromNativeDb(
    includeStoredCover: boolean
  ): Promise<NativeReadResult<AlbumSummary[]>>;
  tryGetLibraryStatsFromNativeDb(): Promise<NativeReadResult<LibraryStats>>;
  ensureDb(): Promise<IDBDatabase>;
  buildPathVisibilityContext(): Promise<unknown>;
  isStoredTrackVisible(storedTrack: unknown, visibilityContext: unknown): boolean;
  restoreTrackForListProjection(storedTrack: unknown): Track;
  restoreTrackForPlayback(storedTrack: unknown): Track;
  sanitizeStoredCoverUrlForPath(rawCoverUrl: unknown, trackPath: unknown): string | undefined;
}

function isNativeReadAvailable<T>(
  result: NativeReadResult<T>
): result is Extract<NativeReadResult<T>, { status: 'ok' }> {
  return result.status === 'ok';
}

function shouldAllowDesktopWebFallback(context: MusicLibraryReadGatewayContext): boolean {
  return context.shouldAllowDesktopWebFallback?.() === true;
}

function createEmptyLibraryStats(): LibraryStats {
  return {
    totalTracks: 0,
    totalArtists: 0,
    totalAlbums: 0,
    totalSize: 0,
    totalDuration: 0,
  };
}

async function resolveDesktopRead<T>(
  context: MusicLibraryReadGatewayContext,
  nativeRead: Promise<NativeReadResult<T>>,
  webFallback: () => Promise<T>,
  unavailableValue: () => T
): Promise<T> {
  const nativeValue = await nativeRead;
  if (isNativeReadAvailable(nativeValue)) {
    return nativeValue.value;
  }
  if (shouldAllowDesktopWebFallback(context)) {
    return webFallback();
  }
  return unavailableValue();
}

function createWebMusicLibraryReadGateway(
  context: MusicLibraryReadGatewayContext
): MusicLibraryReadGateway {
  return {
    async getAllTracks(limit?: number, offset?: number): Promise<Track[]> {
      const db = await context.ensureDb();
      const visibilityContext = await context.buildPathVisibilityContext();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(['tracks'], 'readonly');
        const store = transaction.objectStore('tracks');

        if (limit) {
          const safeOffset =
            typeof offset === 'number' && Number.isFinite(offset) && offset > 0
              ? Math.floor(offset)
              : 0;

          const tracks: Track[] = [];
          const request = store.openCursor();
          let count = 0;
          let skipped = 0;

          request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result as
              | (IDBCursorWithValue & { continue: () => void })
              | null;
            if (!cursor) {
              resolve(tracks);
              return;
            }

            const value = cursor.value;
            if (!context.isStoredTrackVisible(value, visibilityContext)) {
              cursor.continue();
              return;
            }

            if (skipped < safeOffset) {
              skipped++;
              cursor.continue();
              return;
            }

            if (count < limit) {
              tracks.push(context.restoreTrackForListProjection(value));
              count++;
              cursor.continue();
              return;
            }

            resolve(tracks);
          };
          request.onerror = () => reject(request.error);
          return;
        }

        const request = store.getAll();
        request.onsuccess = () => {
          const raw = Array.isArray(request.result) ? request.result : [];
          resolve(
            raw
              .filter((track) => context.isStoredTrackVisible(track, visibilityContext))
              .map((track) => context.restoreTrackForListProjection(track))
          );
        };
        request.onerror = () => reject(request.error);
      });
    },

    async searchTracks(query: string, limit?: number): Promise<Track[]> {
      const normalizedQuery = query.trim().toLowerCase();
      if (!normalizedQuery) {
        return typeof limit === 'number' ? this.getAllTracks(limit) : this.getAllTracks();
      }

      const db = await context.ensureDb();
      const visibilityContext = await context.buildPathVisibilityContext();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(['tracks'], 'readonly');
        const store = transaction.objectStore('tracks');

        const results: Track[] = [];
        const request = store.openCursor();

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result as
            | (IDBCursorWithValue & { continue: () => void })
            | null;
          if (!cursor) {
            resolve(results);
            return;
          }

          const value = cursor.value as Record<string, unknown>;
          if (!context.isStoredTrackVisible(value, visibilityContext)) {
            cursor.continue();
            return;
          }

          const title = String(value.title || '').toLowerCase();
          const artist = String(value.artist || '').toLowerCase();
          const album = String(value.album || '').toLowerCase();

          if (
            title.includes(normalizedQuery) ||
            artist.includes(normalizedQuery) ||
            album.includes(normalizedQuery)
          ) {
            results.push(context.restoreTrackForListProjection(value));
            if (typeof limit === 'number' && results.length >= limit) {
              resolve(results);
              return;
            }
          }

          cursor.continue();
        };

        request.onerror = () => reject(request.error);
      });
    },

    async getTracksByAlbum(album: string): Promise<Track[]> {
      const db = await context.ensureDb();
      const visibilityContext = await context.buildPathVisibilityContext();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(['tracks'], 'readonly');
        const store = transaction.objectStore('tracks');
        const index = store.index('album');
        const request = index.getAll(album);

        request.onsuccess = () => {
          const raw = Array.isArray(request.result) ? request.result : [];
          resolve(
            raw
              .filter((track) => context.isStoredTrackVisible(track, visibilityContext))
              .map((track) => context.restoreTrackForPlayback(track))
          );
        };
        request.onerror = () => reject(request.error);
      });
    },

    async getAllAlbums(options?: { includeStoredCover?: boolean }): Promise<AlbumSummary[]> {
      const includeStoredCover = options?.includeStoredCover ?? true;
      const db = await context.ensureDb();
      const visibilityContext = await context.buildPathVisibilityContext();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(['tracks'], 'readonly');
        const store = transaction.objectStore('tracks');

        if (!store.indexNames.contains('album')) {
          void this.getAllTracks()
            .then((tracks) => {
              const albumMap = new Map<string, AlbumSummary>();
              tracks.forEach((track) => {
                if (!track.album) return;
                const key = `${track.album}::${track.artist || ''}`;
                if (albumMap.has(key)) return;
                albumMap.set(key, {
                  album: track.album,
                  artist: track.artist || 'Unknown Artist',
                  cover: includeStoredCover
                    ? context.sanitizeStoredCoverUrlForPath(track.coverUrl, track.filePath || track.path)
                    : undefined,
                  coverTrackPath: track.filePath || track.path,
                  coverTrackId: track.id,
                });
              });
              resolve(Array.from(albumMap.values()).sort((a, b) => a.album.localeCompare(b.album)));
            })
            .catch(reject);
          return;
        }

        const albumMap = new Map<string, AlbumSummary>();
        const index = store.index('album');
        const request = index.openCursor();
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result as
            | (IDBCursorWithValue & { continue: () => void })
            | null;
          if (!cursor) {
            resolve(Array.from(albumMap.values()).sort((a, b) => a.album.localeCompare(b.album)));
            return;
          }

          const value = cursor.value as Record<string, unknown>;
          if (!context.isStoredTrackVisible(value, visibilityContext)) {
            cursor.continue();
            return;
          }

          const albumName = String(value.album ?? '');
          if (albumName) {
            const artistName = String(value.artist ?? 'Unknown Artist');
            const key = `${albumName}::${artistName}`;
            if (!albumMap.has(key)) {
              albumMap.set(key, {
                album: albumName,
                artist: artistName,
                cover: includeStoredCover
                  ? context.sanitizeStoredCoverUrlForPath(value.coverUrl, value.filePath || value.path)
                  : undefined,
                coverTrackPath: String(value.filePath || value.path || ''),
                coverTrackId: typeof value.id === 'string' ? value.id : undefined,
              });
            }
          }

          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });
    },

    async getLibraryStats(): Promise<LibraryStats> {
      const artists = new Set<string>();
      const albums = new Set<string>();
      let totalTracks = 0;
      let totalSize = 0;
      let totalDuration = 0;

      const db = await context.ensureDb();
      const visibilityContext = await context.buildPathVisibilityContext();

      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(['tracks'], 'readonly');
        const store = transaction.objectStore('tracks');
        const request = store.openCursor();

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result as
            | (IDBCursorWithValue & { continue: () => void })
            | null;
          if (!cursor) {
            resolve();
            return;
          }

          const value = cursor.value as Record<string, unknown>;
          if (!context.isStoredTrackVisible(value, visibilityContext)) {
            cursor.continue();
            return;
          }

          totalTracks++;
          const artist = String(value.artist ?? '').trim();
          const album = String(value.album ?? '').trim();
          if (artist) artists.add(artist);
          if (album) albums.add(album);
          totalSize += Number(value.fileSize ?? 0);
          totalDuration += Number(value.duration ?? 0);

          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });

      return {
        totalTracks,
        totalArtists: artists.size,
        totalAlbums: albums.size,
        totalSize,
        totalDuration,
      };
    },
  };
}

function createDesktopMusicLibraryReadGateway(
  context: MusicLibraryReadGatewayContext,
  webGateway: MusicLibraryReadGateway
): MusicLibraryReadGateway {
  return {
    async getAllTracks(limit?: number, offset?: number): Promise<Track[]> {
      return resolveDesktopRead(
        context,
        context.tryGetAllTracksFromNativeDb(limit, offset),
        () => webGateway.getAllTracks(limit, offset),
        () => []
      );
    },

    async searchTracks(query: string, limit?: number): Promise<Track[]> {
      const normalizedQuery = query.trim().toLowerCase();
      if (!normalizedQuery) {
        return typeof limit === 'number' ? this.getAllTracks(limit) : this.getAllTracks();
      }

      return resolveDesktopRead(
        context,
        context.trySearchTracksFromNativeDb(normalizedQuery, limit),
        () => webGateway.searchTracks(normalizedQuery, limit),
        () => []
      );
    },

    async getTracksByAlbum(album: string): Promise<Track[]> {
      return resolveDesktopRead(
        context,
        context.tryGetTracksByAlbumFromNativeDb(album),
        () => webGateway.getTracksByAlbum(album),
        () => []
      );
    },

    async getAllAlbums(options?: { includeStoredCover?: boolean }): Promise<AlbumSummary[]> {
      const includeStoredCover = options?.includeStoredCover ?? true;
      return resolveDesktopRead(
        context,
        context.tryGetAllAlbumsFromNativeDb(includeStoredCover),
        () => webGateway.getAllAlbums(options),
        () => []
      );
    },

    async getLibraryStats(): Promise<LibraryStats> {
      return resolveDesktopRead(
        context,
        context.tryGetLibraryStatsFromNativeDb(),
        () => webGateway.getLibraryStats(),
        () => createEmptyLibraryStats()
      );
    },
  };
}

export function createMusicLibraryReadGateway(
  context: MusicLibraryReadGatewayContext
): MusicLibraryReadGateway {
  const webGateway = createWebMusicLibraryReadGateway(context);
  const desktopGateway = createDesktopMusicLibraryReadGateway(context, webGateway);

  const resolveGateway = (): MusicLibraryReadGateway =>
    context.isDesktopRuntime() ? desktopGateway : webGateway;

  return {
    getAllTracks(limit?: number, offset?: number): Promise<Track[]> {
      return resolveGateway().getAllTracks(limit, offset);
    },
    searchTracks(query: string, limit?: number): Promise<Track[]> {
      return resolveGateway().searchTracks(query, limit);
    },
    getTracksByAlbum(album: string): Promise<Track[]> {
      return resolveGateway().getTracksByAlbum(album);
    },
    getAllAlbums(options?: { includeStoredCover?: boolean }): Promise<AlbumSummary[]> {
      return resolveGateway().getAllAlbums(options);
    },
    getLibraryStats(): Promise<LibraryStats> {
      return resolveGateway().getLibraryStats();
    },
  };
}
