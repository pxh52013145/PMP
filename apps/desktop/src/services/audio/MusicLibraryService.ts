import { Track } from '../audio';
import { parseAudioFile } from '../../utils/audioMetadata';
import { open } from '@tauri-apps/api/dialog';
import { readDir, exists } from '@tauri-apps/api/fs';
import { isTauriRuntime } from '../../utils/tauriRuntime';

// 音乐库数据库版本
const DB_VERSION = 4;
const DB_NAME = 'MusicLibrary';

// 库统计信息
export interface LibraryStats {
  totalTracks: number;
  totalArtists: number;
  totalAlbums: number;
  totalSize: number;
  totalDuration: number;
}

export interface AlbumSummary {
  album: string;
  artist: string;
  cover?: string;
  coverTrackPath?: string;
  coverTrackId?: string;
}

// 库路径信息
export interface LibraryPath {
  id: string;
  path: string;
  addedAt: Date;
  lastScanned?: Date;
  trackCount: number;
  folderHandle?: FileSystemDirectoryHandle; // ✅ 存储文件夹句柄用于权限管理
}

// 扫描进度信息
type StoredLibraryPathRecord = Omit<LibraryPath, 'addedAt' | 'lastScanned'> & {
  addedAt?: number;
  lastScanned?: number;
};

type StoredTrackRecord = Omit<Track, 'addedAt'> & { addedAt?: number };

export interface ScanProgress {
  total: number;
  current: number;
  currentFile?: string;
  isScanning: boolean;
  progress?: number; // 进度百分比
  speed?: number; // 扫描速度（文件/秒）
  remaining?: number; // 预计剩余时间（秒）
}

// 视图类型
export type ViewMode = 'artists' | 'albums' | 'folders' | 'genres' | 'years' | 'all';

// 排序选项
export type SortBy = 'title' | 'artist' | 'album' | 'duration' | 'addedAt' | 'year';

export class MusicLibraryService {
  private static instance: MusicLibraryService;
  private static startupRefreshScheduled: boolean = false;
  private db: IDBDatabase | null = null;
  private scanProgressListeners: Set<(progress: ScanProgress) => void> = new Set();
  private isScanning: boolean = false;
  private coverUrlCache: Map<string, string> = new Map();
  private coverBlobUrlCache: Map<string, { url: string; bytes: number }> = new Map();
  private coverBlobUrlTotalBytes: number = 0;
  private coverUrlInflight: Map<string, Promise<string | undefined>> = new Map();
  private albumCoverUrlCache: Map<string, string> = new Map();
  private albumCoverUrlInflight: Map<string, Promise<string | undefined>> = new Map();
  private COVER_CACHE_MAX_BYTES = 80 * 1024 * 1024; // 80MB
  private COVER_MAX_IMAGE_BYTES = 1024 * 1024; // 1MB per cover (many embedded covers exceed 256KB)
  private COVER_BLOB_CACHE_MAX_BYTES = 32 * 1024 * 1024; // 32MB in-memory blob URL cache

  // 缓存 - 减少数据库查询
  private cachedStats: LibraryStats | null = null;
  private cacheTimestamp: number = 0;
  private CACHE_TTL = 5000; // 5秒缓存

  private constructor() {
    void this.initDB().catch((error) => {
      console.warn('[MusicLibraryService] initDB failed:', error);
    });
    this.scheduleStartupRefresh();
  }

  private stableIdFromPath(path: string): string {
    const normalized = path.replace(/\\/g, '/').toLowerCase();
    let hash = 2166136261;
    for (let i = 0; i < normalized.length; i++) {
      hash ^= normalized.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `track-${(hash >>> 0).toString(16)}`;
  }

  private normalizePathForCompare(path: string): string {
    return path.replace(/\\/g, '/').toLowerCase();
  }

  private normalizeFolderPrefix(folderPath: string): string {
    const normalized = this.normalizePathForCompare(folderPath);
    return normalized.endsWith('/') ? normalized : `${normalized}/`;
  }

  private albumKeyForTrack(track: Track): string | null {
    const album = String(track.album || '').trim();
    if (!album) return null;
    const artist = String(track.artist || '').trim();
    return `${album}::${artist}`;
  }

  private sanitizeCoverUrl(raw: unknown): string | undefined {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) return undefined;

    const lower = value.toLowerCase();
    if (lower.startsWith('data:')) return value;
    if (lower.startsWith('blob:')) return value;
    if (lower.startsWith('http:') || lower.startsWith('https:')) return value;

    if (lower.startsWith('asset:') || lower.startsWith('tauri:')) return undefined;

    if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\')) {
      return undefined;
    }

    return undefined;
  }

  private guessMimeTypeFromPath(path: string): string | undefined {
    const lower = path.toLowerCase();
    if (lower.endsWith('.mp3')) return 'audio/mpeg';
    if (lower.endsWith('.flac')) return 'audio/flac';
    if (lower.endsWith('.wav')) return 'audio/wav';
    if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4';
    if (lower.endsWith('.aac')) return 'audio/aac';
    if (lower.endsWith('.ogg')) return 'audio/ogg';
    if (lower.endsWith('.opus')) return 'audio/opus';
    if (lower.endsWith('.aiff') || lower.endsWith('.aif')) return 'audio/aiff';
    return undefined;
  }

  private isLikelyAbsolutePath(path: string): boolean {
    if (!path) return false;
    if (path.startsWith('/')) return true;
    return /^[a-zA-Z]:[\\/]/.test(path);
  }

  private scheduleStartupRefresh(): void {
    if (MusicLibraryService.startupRefreshScheduled) return;
    MusicLibraryService.startupRefreshScheduled = true;

    if (typeof window === 'undefined') return;
    if (!isTauriRuntime()) return;

    window.setTimeout(() => {
      void this.refreshLibraryOnStartup().catch((error) => {
        console.error('[MusicLibrary] Startup refresh failed:', error);
      });
    }, 2500);
  }

  private async refreshLibraryOnStartup(): Promise<void> {
    if (this.isScanning) return;

    const paths = await this.getLibraryPaths();
    const toRefresh = paths.filter(
      (p) => typeof p.path === 'string' && this.isLikelyAbsolutePath(p.path)
    );
    if (toRefresh.length === 0) return;

    for (const p of toRefresh) {
      if (this.isScanning) return;
      await this.scanFolderViaTauriBackend(p.path, p.id, false, { silentProgress: true });
    }
  }

  private async upsertCoverCacheEntry(entry: {
    key: string;
    filePath: string;
    bytes: number;
    lastAccessedAtMs: number;
  }): Promise<void> {
    const db = await this.ensureDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['coverCache'], 'readwrite');
      const store = transaction.objectStore('coverCache');
      store.put(entry);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  private async touchCoverCacheEntry(key: string): Promise<void> {
    const db = await this.ensureDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['coverCache'], 'readwrite');
      const store = transaction.objectStore('coverCache');
      const request = store.get(key);
      request.onsuccess = () => {
        const existing = request.result;
        if (existing) {
          existing.lastAccessedAtMs = Date.now();
          store.put(existing);
        }
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  private async maybeUpdateTrackCoverInDB(
    audioPath: string,
    coverUrl: string,
    coverKey: string
  ): Promise<void> {
    // Blob URLs are session-only; never persist them into IndexedDB.
    if (String(coverUrl).startsWith('blob:')) {
      const db = await this.ensureDB();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(['tracks'], 'readwrite');
        const store = transaction.objectStore('tracks');

        if (!store.indexNames.contains('path')) {
          resolve();
          return;
        }

        const request = store.index('path').get(audioPath);
        request.onsuccess = () => {
          const existing = request.result;
          if (existing) {
            store.put({
              ...existing,
              coverKey,
            });
          }
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
      return;
    }

    const db = await this.ensureDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readwrite');
      const store = transaction.objectStore('tracks');

      if (!store.indexNames.contains('path')) {
        resolve();
        return;
      }

      const request = store.index('path').get(audioPath);
      request.onsuccess = () => {
        const existing = request.result;
        if (existing) {
          const prevCoverUrl = String(existing.coverUrl || '');
          const shouldReplace =
            !prevCoverUrl || prevCoverUrl.startsWith('data:') || prevCoverUrl !== coverUrl;
          if (shouldReplace) {
            store.put({
              ...existing,
              coverUrl,
              coverKey,
            });
          }
        }
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  private touchCoverBlobCache(normalizedAudioPath: string): void {
    const existing = this.coverBlobUrlCache.get(normalizedAudioPath);
    if (!existing) return;
    this.coverBlobUrlCache.delete(normalizedAudioPath);
    this.coverBlobUrlCache.set(normalizedAudioPath, existing);
  }

  private addCoverBlobUrlToCache(
    normalizedAudioPath: string,
    url: string,
    bytes: number
  ): void {
    const existing = this.coverBlobUrlCache.get(normalizedAudioPath);
    if (existing) {
      this.coverBlobUrlCache.delete(normalizedAudioPath);
      this.coverBlobUrlCache.set(normalizedAudioPath, existing);
      return;
    }

    this.coverBlobUrlCache.set(normalizedAudioPath, { url, bytes });
    this.coverBlobUrlTotalBytes += bytes;

    while (
      this.coverBlobUrlTotalBytes > this.COVER_BLOB_CACHE_MAX_BYTES &&
      this.coverBlobUrlCache.size > 0
    ) {
      const oldestKey = this.coverBlobUrlCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const oldest = this.coverBlobUrlCache.get(oldestKey);
        this.coverBlobUrlCache.delete(oldestKey);
        if (oldest) {
          this.coverBlobUrlTotalBytes = Math.max(0, this.coverBlobUrlTotalBytes - oldest.bytes);
          try {
            URL.revokeObjectURL(oldest.url);
          } catch (err) {
            void err;
          }

          const cached = this.coverUrlCache.get(oldestKey);
          if (cached === oldest.url) {
            this.coverUrlCache.delete(oldestKey);
          }
      }
    }
  }

  private async pruneCoverCacheIfNeeded(): Promise<void> {
    const db = await this.ensureDB();

    const entries: Array<{
      key: string;
      filePath: string;
      bytes: number;
      lastAccessedAtMs: number;
    }> = await new Promise((resolve, reject) => {
      const transaction = db.transaction(['coverCache'], 'readonly');
      const store = transaction.objectStore('coverCache');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    let total = 0;
    for (const e of entries) total += Number(e.bytes || 0);
    if (total <= this.COVER_CACHE_MAX_BYTES) return;

    entries.sort((a, b) => Number(a.lastAccessedAtMs || 0) - Number(b.lastAccessedAtMs || 0));

    const keysToDelete: string[] = [];
    for (const entry of entries) {
      if (total <= this.COVER_CACHE_MAX_BYTES) break;
      keysToDelete.push(entry.key);
      total -= Number(entry.bytes || 0);
    }

    if (keysToDelete.length === 0) return;

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['coverCache'], 'readwrite');
      const store = transaction.objectStore('coverCache');
      for (const key of keysToDelete) {
        store.delete(key);
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    const { invoke } = await import('@tauri-apps/api/tauri');
    for (const key of keysToDelete) {
      try {
        await invoke('music_library_remove_cover', { key });
      } catch (error) {
        console.warn('[MusicLibrary] Failed to delete cached cover file:', error);
      }
    }
  }

  async getCoverUrlForTrack(
    track: Track,
    options?: { allowAlbumFallback?: boolean }
  ): Promise<string | undefined> {
    const allowAlbumFallback = options?.allowAlbumFallback !== false;
    const existingUrl = track.coverUrl;
    if (existingUrl && (String(existingUrl).startsWith('data:') || String(existingUrl).startsWith('blob:'))) {
      if (track.coverKey) {
        void this.touchCoverCacheEntry(track.coverKey).catch(() => {});
      }
      return existingUrl;
    }

    if (!isTauriRuntime()) return existingUrl;

    const audioPath = track.filePath || track.path;
    if (!audioPath || !this.isLikelyAbsolutePath(audioPath)) return existingUrl;

    const normalized = this.normalizePathForCompare(audioPath);
    const cached = this.coverUrlCache.get(normalized);
    if (cached) {
      if (track.coverKey) {
        void this.touchCoverCacheEntry(track.coverKey).catch(() => {});
      }
      this.touchCoverBlobCache(normalized);
      return cached;
    }

    const inflight = this.coverUrlInflight.get(normalized);
    if (inflight) return inflight;

    const promise = (async () => {
      const { invoke } = await import('@tauri-apps/api/tauri');

      const result = await invoke<
        | {
            key: string;
            path: string;
            size: number;
            mediaType?: string | null;
            bytesBase64?: string | null;
          }
        | null
      >('music_library_get_cover', {
        path: audioPath,
        maxBytes: this.COVER_MAX_IMAGE_BYTES,
      });

      if (!result) return undefined;

      const rawBase64 = String(result.bytesBase64 || '').trim();
      if (!rawBase64) return undefined;

      const mime = result.mediaType || 'image/jpeg';
      const binary = atob(rawBase64);
      const buffer = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        buffer[i] = binary.charCodeAt(i);
      }

      const blob = new Blob([buffer], { type: mime });
      const url = URL.createObjectURL(blob);
      this.coverUrlCache.set(normalized, url);
      this.addCoverBlobUrlToCache(normalized, url, result.size);

      const albumKey = this.albumKeyForTrack(track);
      if (albumKey) {
        this.albumCoverUrlCache.set(albumKey, url);
      }

      const now = Date.now();
      await this.upsertCoverCacheEntry({
        key: result.key,
        filePath: result.path,
        bytes: result.size,
        lastAccessedAtMs: now,
      });

      await this.maybeUpdateTrackCoverInDB(audioPath, url, result.key);
      await this.pruneCoverCacheIfNeeded();

      return url;
    })()
      .catch((error) => {
        console.warn('[MusicLibrary] Failed to get cover:', error);
        return undefined;
      })
      .finally(() => {
        this.coverUrlInflight.delete(normalized);
      });

    this.coverUrlInflight.set(normalized, promise);
    const direct = await promise;
    if (direct) return direct;

    if (!allowAlbumFallback) return undefined;

    const albumKey = this.albumKeyForTrack(track);
    if (!albumKey) return undefined;

    const cachedAlbum = this.albumCoverUrlCache.get(albumKey);
    if (cachedAlbum) return cachedAlbum;

    const inflightAlbum = this.albumCoverUrlInflight.get(albumKey);
    if (inflightAlbum) return inflightAlbum;

    const albumPromise = (async () => {
      const album = String(track.album || '').trim();
      if (!album) return undefined;
      const artist = String(track.artist || '').trim();

      const candidates = await this.getTracksByAlbum(album);
      const filtered = candidates
        .filter((t) => t && (t.filePath || t.path))
        .filter((t) => (artist ? String(t.artist || '').trim() === artist : true))
        .slice(0, 12);

      for (const candidate of filtered) {
        if (candidate.id === track.id) continue;
        const url = await this.getCoverUrlForTrack(candidate, { allowAlbumFallback: false });
        if (url) {
          this.albumCoverUrlCache.set(albumKey, url);
          return url;
        }
      }

      return undefined;
    })()
      .catch((error) => {
        console.warn('[MusicLibrary] Failed to resolve album cover fallback:', error);
        return undefined;
      })
      .finally(() => {
        this.albumCoverUrlInflight.delete(albumKey);
      });

    this.albumCoverUrlInflight.set(albumKey, albumPromise);
    return albumPromise;
  }

  static getInstance(): MusicLibraryService {
    if (!MusicLibraryService.instance) {
      MusicLibraryService.instance = new MusicLibraryService();
    }
    return MusicLibraryService.instance;
  }

  // 初始化数据库
  private async initDB(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      return;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = (event.target as IDBOpenDBRequest).transaction;
        const oldVersion = (event as IDBVersionChangeEvent).oldVersion ?? 0;

        // 创建音乐轨道存储
        if (!db.objectStoreNames.contains('tracks')) {
          const tracksStore = db.createObjectStore('tracks', { keyPath: 'id' });
          tracksStore.createIndex('title', 'title', { unique: false });
          tracksStore.createIndex('artist', 'artist', { unique: false });
          tracksStore.createIndex('album', 'album', { unique: false });
          tracksStore.createIndex('genre', 'genre', { unique: false });
          tracksStore.createIndex('year', 'year', { unique: false });
          tracksStore.createIndex('addedAt', 'addedAt', { unique: false });
          tracksStore.createIndex('path', 'path', { unique: true });
          tracksStore.createIndex('libraryPathId', 'libraryPathId', { unique: false });
        } else if (transaction) {
          const tracksStore = transaction.objectStore('tracks');
          if (!tracksStore.indexNames.contains('libraryPathId')) {
            tracksStore.createIndex('libraryPathId', 'libraryPathId', { unique: false });
          }
          if (!tracksStore.indexNames.contains('path')) {
            tracksStore.createIndex('path', 'path', { unique: true });
          }
        }

        // 创建库路径存储
        if (!db.objectStoreNames.contains('libraryPaths')) {
          const pathsStore = db.createObjectStore('libraryPaths', { keyPath: 'id' });
          pathsStore.createIndex('path', 'path', { unique: true });
        } else if (transaction) {
          const pathsStore = transaction.objectStore('libraryPaths');
          if (!pathsStore.indexNames.contains('path')) {
            pathsStore.createIndex('path', 'path', { unique: true });
          }
        }

        // 封面磁盘缓存索引（仅存 key/路径/最近访问时间，不存 base64）
        if (!db.objectStoreNames.contains('coverCache')) {
          const coverStore = db.createObjectStore('coverCache', { keyPath: 'key' });
          coverStore.createIndex('lastAccessedAtMs', 'lastAccessedAtMs', { unique: false });
        } else if (transaction) {
          const coverStore = transaction.objectStore('coverCache');
          if (!coverStore.indexNames.contains('lastAccessedAtMs')) {
            coverStore.createIndex('lastAccessedAtMs', 'lastAccessedAtMs', { unique: false });
          }
        }

        // v3 migration: drop legacy base64 coverUrl for Desktop paths (covers can be regenerated via Rust cache)
        if (transaction && oldVersion < 3 && db.objectStoreNames.contains('tracks')) {
          const tracksStore = transaction.objectStore('tracks');
          const cursorRequest = tracksStore.openCursor();
          cursorRequest.onsuccess = (evt) => {
            const cursor = (evt.target as IDBRequest).result as IDBCursorWithValue | null;
            if (!cursor) return;

            const value = cursor.value as unknown as Record<string, unknown>;
            const coverUrl = String(value.coverUrl ?? '');
            const filePath = String(value.filePath ?? value.path ?? '');
            const isAbs = /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('/');

            if (isAbs && coverUrl.startsWith('data:')) {
              delete value.coverUrl;
              delete value.coverKey;
              tracksStore.put(value);
            }

            cursor.continue();
          };
        }

        // v4 migration: drop legacy asset/tauri/blob cover URLs that depend on Tauri assetScope.
        if (transaction && oldVersion < 4 && db.objectStoreNames.contains('tracks')) {
          const tracksStore = transaction.objectStore('tracks');
          const cursorRequest = tracksStore.openCursor();
          cursorRequest.onsuccess = (evt) => {
            const cursor = (evt.target as IDBRequest).result as IDBCursorWithValue | null;
            if (!cursor) return;

            const value = cursor.value as unknown as Record<string, unknown>;
            const coverUrl = String(value.coverUrl ?? '').trim();
            const lower = coverUrl.toLowerCase();
            const shouldDrop =
              !coverUrl ||
              lower.startsWith('asset:') ||
              lower.startsWith('tauri:') ||
              lower.startsWith('blob:') ||
              lower.includes('music-covers');

            if (shouldDrop && 'coverUrl' in value) {
              delete value.coverUrl;
              tracksStore.put(value);
            }

            cursor.continue();
          };
        }
      };
    });
  }

  // 确保数据库已初始化
  private async ensureDB(): Promise<IDBDatabase> {
    if (!this.db) {
      await this.initDB();
    }
    if (!this.db) {
      throw new Error('Failed to initialize database');
    }
    return this.db;
  }

  // 添加库路径
  async addLibraryPath(folderHandle: FileSystemDirectoryHandle): Promise<LibraryPath> {
    const db = await this.ensureDB();
    const pathId = `path-${Date.now()}`;

    // 检查路径是否已存在
    const existingPaths = await this.getLibraryPaths();
    const exists = existingPaths.some((p) => p.path === folderHandle.name);
    if (exists) {
      console.log(`Path already exists: ${folderHandle.name}`);
      return existingPaths.find((p) => p.path === folderHandle.name)!;
    }

    const pathInfo: LibraryPath = {
      id: pathId,
      path: folderHandle.name,
      addedAt: new Date(),
      trackCount: 0,
      folderHandle: folderHandle, // ✅ 保存文件夹句柄
    };

    // 存储时将 Date 转换为时间戳
    const pathToStore = {
      ...pathInfo,
      addedAt: pathInfo.addedAt.getTime(),
      folderHandle: folderHandle, // ✅ FileHandle 可以序列化到 IndexedDB
    };

    const transaction = db.transaction(['libraryPaths'], 'readwrite');
    const store = transaction.objectStore('libraryPaths');
    store.add(pathToStore);

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => {
        console.log(`Successfully added library path: ${folderHandle.name}`);
        resolve();
      };
      transaction.onerror = () => {
        console.error('Failed to add library path:', transaction.error);
        reject(transaction.error);
      };
    });

    return pathInfo;
  }

  // 获取所有库路径
  async getLibraryPaths(): Promise<LibraryPath[]> {
    const db = await this.ensureDB();
    const transaction = db.transaction(['libraryPaths'], 'readonly');
    const store = transaction.objectStore('libraryPaths');

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const raw = Array.isArray(request.result) ? request.result : [];
        const paths: LibraryPath[] = raw.map((entry) => {
          const stored = entry as unknown as StoredLibraryPathRecord;
          return {
            ...stored,
            addedAt: stored.addedAt ? new Date(stored.addedAt) : new Date(),
            lastScanned: stored.lastScanned ? new Date(stored.lastScanned) : undefined,
          };
        });
        resolve(paths);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // 移除库路径
  async removeLibraryPath(pathId: string): Promise<void> {
    const db = await this.ensureDB();
    const transaction = db.transaction(['libraryPaths'], 'readwrite');
    const store = transaction.objectStore('libraryPaths');
    store.delete(pathId);

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // 扫描所有库路径
  async scanAllLibraryPaths(): Promise<void> {
    const paths = await this.getLibraryPaths();
    console.log(`Found ${paths.length} library paths to scan`);
    const tauriRuntime = isTauriRuntime();

    for (const pathInfo of paths) {
      console.log(`Scanning library path: ${pathInfo.path}`);
      try {
        if (tauriRuntime) {
          await this.scanFolder(pathInfo.path, pathInfo.id);
          continue;
        }

        // 尝试重新获取文件夹句柄
        const showDirectoryPicker = (window as unknown as {
          showDirectoryPicker?: (options: { mode: 'read' | 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>;
        }).showDirectoryPicker;
        if (showDirectoryPicker) {
          console.log(`请授权访问文件夹: ${pathInfo.path}`);
          // 注意：每次都需要用户重新授权
          const folderHandle = await showDirectoryPicker({
            mode: 'read',
            id: pathInfo.id, // 尝试使用相同的ID来获取之前的权限
          });
          await this.scanFolder(folderHandle, pathInfo.id);
        }
      } catch (error: unknown) {
        const name =
          typeof (error as { name?: unknown }).name === 'string'
            ? (error as { name: string }).name
            : undefined;
        if (name === 'AbortError') {
          console.log(`User cancelled scanning for path: ${pathInfo.path}`);
        } else {
          console.error(`Failed to scan path ${pathInfo.path}:`, error);
        }
      }
    }
  }

  // 扫描文件夹
  async scanFolder(
    folderPathOrHandle: string | FileSystemDirectoryHandle | null = null,
    pathId?: string
  ): Promise<void> {
    let shouldAddPath = false;
    let folderPath: string | null = null;
    let folderHandle: FileSystemDirectoryHandle | null = null;
    let useFileSystemAPI = false;

    const tauriRuntime = isTauriRuntime();

    // 优先使用 File System Access API（快速）
    if (!folderPathOrHandle) {
      try {
        // 检查是否支持 File System Access API
        // NOTE: In Tauri, we prefer native dialogs so we always have absolute file paths for NativeAudio.
        const showDirectoryPicker = (window as unknown as {
          showDirectoryPicker?: (options: { mode: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
        }).showDirectoryPicker;
        if (!tauriRuntime && showDirectoryPicker) {
          folderHandle = await showDirectoryPicker({ mode: 'read' });
          useFileSystemAPI = true;
          shouldAddPath = true;
          console.log('Using File System Access API (fast)');
        } else {
          // 降级到 Tauri dialog
          const selected = await open({
            directory: true,
            multiple: false,
            title: '选择音乐文件夹',
          });

          if (!selected || Array.isArray(selected)) {
            console.log('User cancelled folder selection');
            return;
          }

          folderPath = selected;
          shouldAddPath = true;
          console.log('Using Tauri dialog (fallback)');
        }
      } catch (error: unknown) {
        const name =
          typeof (error as { name?: unknown }).name === 'string'
            ? (error as { name: string }).name
            : undefined;
        if (name === 'AbortError') {
          console.log('User cancelled folder selection');
          return;
        }
        console.error('Error during folder selection:', error);
        throw error;
      }
    } else if (typeof folderPathOrHandle === 'string') {
      folderPath = folderPathOrHandle;
    } else {
      folderHandle = folderPathOrHandle;
      useFileSystemAPI = true;
    }

    // ML.1 (Desktop/Tauri): do all scanning + metadata extraction in Rust backend.
    // This avoids reading/decoding whole files in the frontend and prevents UI stalls/crashes.
    if (tauriRuntime && folderPath && !useFileSystemAPI) {
      await this.scanFolderViaTauriBackend(folderPath, pathId, shouldAddPath);
      return;
    }

    console.log('Starting to scan folder...');

    // 收集所有音频文件
    const audioFiles: Array<{
      path: string;
      name: string;
      file?: File;
      fileHandle?: FileSystemFileHandle;
    }> = [];

    try {
      if (useFileSystemAPI && folderHandle) {
        // 使用快速的 File System Access API
        await this.collectAudioFilesFromHandle(folderHandle, audioFiles);
      } else if (folderPath) {
        // 使用 Tauri fs API（较慢但支持路径）
        await this.collectAudioFilePaths(folderPath, audioFiles);
      } else {
        throw new Error('No folder source available');
      }

      console.log(`Successfully collected ${audioFiles.length} audio files`);
    } catch (error) {
      console.error('Error collecting audio files:', error);
      this.notifyScanProgress({
        total: 0,
        current: 0,
        isScanning: false,
      });
      throw error;
    }

    const total = audioFiles.length;
    let current = 0;

    this.notifyScanProgress({
      total,
      current: 0,
      isScanning: true,
    });

    if (total === 0) {
      console.log('No audio files found in selected folder');
      this.notifyScanProgress({
        total: 0,
        current: 0,
        isScanning: false,
      });
      return;
    }

    console.log(`Found ${total} audio files, starting scan...`);

    await this.ensureDB();
    const startTime = Date.now();

    // 批量处理 - 一次处理5个文件以提高速度
    const BATCH_SIZE = 5;

    for (let i = 0; i < audioFiles.length; i += BATCH_SIZE) {
      const batch = audioFiles.slice(i, Math.min(i + BATCH_SIZE, audioFiles.length));

      // 并行解析文件元数据
      const parsedTracks: Array<StoredTrackRecord | null> = await Promise.all(
        batch.map(async (audioFile, batchIndex): Promise<StoredTrackRecord | null> => {
          const absoluteIndex = i + batchIndex;

          // 更新进度（使用索引而不是共享变量，避免竞争）
          const progress = ((absoluteIndex + 1) / total) * 100;
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = (absoluteIndex + 1) / elapsed;
          const remaining = (total - absoluteIndex - 1) / speed;

          this.notifyScanProgress({
            total,
            current: absoluteIndex + 1,
            currentFile: audioFile.name,
            isScanning: true,
            progress,
            speed,
            remaining,
          });

          try {
            let track: Track;
            let filePath: string;

            // 如果有 File 对象（浏览器API），直接使用（快！）
            if (audioFile.file) {
              track = await parseAudioFile(audioFile.file);
              filePath = audioFile.path;
            } else {
              filePath = audioFile.path;

              // ML.0 (Desktop/Tauri): do not read full audio contents in the frontend during scans.
              // Store minimal metadata and rely on later phases for enrichment.
              track = {
                id: this.stableIdFromPath(filePath),
                title: audioFile.name.replace(/\.[^/.]+$/, ''),
                filePath,
                originalPath: filePath,
                path: filePath,
              };
            }

            // 准备存储的数据
            return {
              ...track,
              file: undefined,
              fileContent: undefined,
              fileHandle: audioFile.fileHandle,
              filePath: audioFile.fileHandle ? undefined : audioFile.path,
              mimeType: audioFile.file?.type || 'audio/mpeg',
              originalPath: filePath,
              path: filePath,
              addedAt: track.addedAt ? track.addedAt.getTime() : Date.now(),
            };
          } catch (error) {
            console.error(`Failed to process file ${audioFile.name}:`, error);
            return null;
          }
        })
      );

      // 批量存储到数据库（一个事务处理整个批次）
      const validTracks = parsedTracks.filter((t): t is StoredTrackRecord => t !== null);
      if (validTracks.length > 0) {
        await this.batchStoreTracks(validTracks);
      }

      current = i + batch.length;
    }

    console.log(`Scan completed: ${current} files processed`);

    // 清除缓存以便重新计算统计信息
    this.clearCache();

    // 如果是新添加的路径，保存到数据库
    if (shouldAddPath) {
      try {
        if (folderHandle) {
          // File System Access API 场景
          const newPath = await this.addLibraryPath(folderHandle);
          pathId = newPath.id;
          console.log(`Added library path: ${folderHandle.name}, ID: ${pathId}`);
        } else if (folderPath) {
          // Tauri dialog 场景
          const folderName = folderPath.split(/[/\\]/).pop() || folderPath;
          const newPath = await this.addLibraryPathByString(folderPath, folderName);
          pathId = newPath.id;
          console.log(`Added library path: ${folderPath}, ID: ${pathId}`);
        }
      } catch (error) {
        console.error('Failed to add library path:', error);
      }
    }

    // 更新路径的最后扫描时间和歌曲数量
    if (pathId) {
      try {
        const db = await this.ensureDB();
        const transaction = db.transaction(['libraryPaths'], 'readwrite');
        const store = transaction.objectStore('libraryPaths');
        const request = store.get(pathId);

        await new Promise<void>((resolve, reject) => {
          request.onsuccess = () => {
            const pathInfo = request.result;
            if (pathInfo) {
              pathInfo.lastScanned = Date.now();
              pathInfo.trackCount = current;
              store.put(pathInfo);
              console.log(
                `Updated path ${pathId}: ${current} tracks, last scanned: ${new Date(pathInfo.lastScanned).toLocaleString()}`
              );
            }
            resolve();
          };
          request.onerror = () => reject(request.error);
        });

        await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
      } catch (error) {
        console.error('Failed to update library path:', error);
      }
    }

    this.notifyScanProgress({
      total,
      current,
      isScanning: false,
    });
  }

  async cancelCurrentScan(): Promise<void> {
    if (!isTauriRuntime()) return;
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      await invoke('music_library_cancel_scan');
    } catch (error) {
      console.error('[MusicLibrary] Failed to cancel scan:', error);
    } finally {
      this.notifyScanProgress({ total: 0, current: 0, isScanning: false });
    }
  }

  private async scanFolderViaTauriBackend(
    folderPath: string,
    pathId?: string,
    shouldAddPath: boolean = false,
    options?: { silentProgress?: boolean; enrichUnscannedMetadata?: boolean }
  ): Promise<void> {
    const silentProgress = options?.silentProgress ?? false;
    const enrichUnscannedMetadata = options?.enrichUnscannedMetadata ?? true;

    this.isScanning = true;

    if (!silentProgress) {
      this.notifyScanProgress({
        total: 0,
        current: 0,
        currentFile: folderPath.split(/[/\\]/).pop() || folderPath,
        isScanning: true,
        progress: 0,
      });
    }

    const { invoke } = await import('@tauri-apps/api/tauri');
    const { listen } = await import('@tauri-apps/api/event');

    // Ensure the folder is registered so tracks can be associated to a stable libraryPathId.
    if (shouldAddPath && !pathId) {
      try {
        const folderName = folderPath.split(/[/\\]/).pop() || folderPath;
        const newPath = await this.addLibraryPathByString(folderPath, folderName);
        pathId = newPath.id;
      } catch (error) {
        console.error('Failed to add library path before scanning:', error);
      }
    }

    const startTime = Date.now();
    const unlisten = silentProgress
      ? async () => {}
      : await listen<{ total: number; current: number; currentFile?: string }>(
          'music-library-scan-progress',
          (event) => {
            const total = event.payload?.total ?? 0;
            const current = event.payload?.current ?? 0;
            const progress = total > 0 ? (current / total) * 100 : 0;
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = elapsed > 0 ? current / elapsed : 0;
            const remaining = speed > 0 ? (total - current) / speed : undefined;

            this.notifyScanProgress({
              total,
              current,
              currentFile: event.payload?.currentFile,
              isScanning: current < total,
              progress,
              speed,
              remaining,
            });
          }
        );

    try {
      // ML.2 Stage A: fast enumerate only (mtime/size) without metadata probing.
      const quick = await invoke<
        Array<{ path: string; fileName: string; size: number; mtimeMs: number }>
      >('music_library_scan', {
        paths: [folderPath],
        options: { includeMetadata: false },
      });

      await this.ensureDB();

      const existing = await this.getStoredTracksForBackendScan(folderPath, pathId);
      const existingByPath = new Map<string, StoredTrackRecord>();
      for (const t of existing) {
        const p = String(t.filePath || t.path || '');
        if (!p) continue;
        existingByPath.set(this.normalizePathForCompare(p), t);
      }

      const seen = new Set<string>();
      const upserts: StoredTrackRecord[] = [];
      const needMetadataPaths: string[] = [];

      for (const item of quick) {
        const normalizedPath = this.normalizePathForCompare(item.path);
        seen.add(normalizedPath);

        const prev = existingByPath.get(normalizedPath);
        const isNew = !prev;
        const unchanged =
          prev &&
          typeof prev.mtimeMs === 'number' &&
          typeof prev.fileSize === 'number' &&
          prev.mtimeMs === item.mtimeMs &&
          prev.fileSize === item.size;

        const needsLibraryPathLink = Boolean(pathId) && prev && !prev.libraryPathId;
        const metadataScannedBefore = prev && typeof prev.metadataScannedAtMs === 'number';
        const shouldProbeMetadata = isNew || !unchanged || (!metadataScannedBefore && enrichUnscannedMetadata);

        if (shouldProbeMetadata) needMetadataPaths.push(item.path);
        if (!isNew && unchanged && !needsLibraryPathLink && !shouldProbeMetadata) continue;

        const fallbackTitle = item.fileName.replace(/\.[^/.]+$/, '');
        upserts.push(
          {
            ...(prev ?? {}),
            id: prev?.id ?? this.stableIdFromPath(item.path),
            title: prev?.title ?? fallbackTitle,
            fileSize: item.size,
            mtimeMs: item.mtimeMs,
            filePath: item.path,
            originalPath: item.path,
            path: item.path,
            libraryPathId: pathId ?? prev?.libraryPathId,
            addedAt: prev?.addedAt ?? Date.now(),
            mimeType: prev?.mimeType ?? this.guessMimeTypeFromPath(item.path),
            file: undefined,
            fileContent: undefined,
          } as StoredTrackRecord
        );
      }

      const deletions = existing
        .filter((t) => {
          const p = String(t.filePath || t.path || '');
          if (!p) return false;
          const normalizedPath = this.normalizePathForCompare(p);
          return !seen.has(normalizedPath);
        })
        .map((t) => t.id)
        .filter(Boolean);

      // ML.2 Stage B: only probe metadata for added/modified/unscanned items.
      if (needMetadataPaths.length > 0) {
        const scannedMeta = await invoke<
          Array<{
            path: string;
            fileName: string;
            size: number;
            mtimeMs: number;
            duration?: number | null;
            sampleRate?: number | null;
            title?: string | null;
            artist?: string | null;
            album?: string | null;
            replayGainTrackDb?: number | null;
            replayGainAlbumDb?: number | null;
          }>
        >('music_library_scan', {
          paths: needMetadataPaths,
          options: { includeMetadata: true },
        });

        const metaByPath = new Map<string, (typeof scannedMeta)[number]>();
        for (const item of scannedMeta) {
          metaByPath.set(this.normalizePathForCompare(item.path), item);
        }

        const now = Date.now();
        for (const record of upserts) {
          const p = String(record.filePath || record.path || '');
          if (!p) continue;
          const meta = metaByPath.get(this.normalizePathForCompare(p));
          if (!meta) continue;

          const title = String(meta.title || '').trim();
          const artist = String(meta.artist || '').trim();
          const album = String(meta.album || '').trim();

          if (title.length > 0) record.title = title;
          if (artist.length > 0) record.artist = artist;
          if (album.length > 0) record.album = album;
          if (typeof meta.duration === 'number') record.duration = meta.duration;
          if (typeof meta.sampleRate === 'number') record.sampleRate = meta.sampleRate;
          if (typeof meta.replayGainTrackDb === 'number') {
            record.replayGainTrackGainDb = meta.replayGainTrackDb;
          }
          if (typeof meta.replayGainAlbumDb === 'number') {
            record.replayGainAlbumGainDb = meta.replayGainAlbumDb;
          }

          record.metadataScannedAtMs = now;
        }

        const normalizedNeed = new Set(needMetadataPaths.map((p) => this.normalizePathForCompare(p)));
        for (const record of upserts) {
          const p = String(record.filePath || record.path || '');
          if (!p) continue;
          if (record.metadataScannedAtMs) continue;
          if (normalizedNeed.has(this.normalizePathForCompare(p))) {
            record.metadataScannedAtMs = Date.now();
          }
        }
      }

      await this.applyBackendScanDiff(upserts, deletions);
      this.clearCache();

      if (pathId) {
        try {
          const db = await this.ensureDB();
          const transaction = db.transaction(['libraryPaths'], 'readwrite');
          const store = transaction.objectStore('libraryPaths');
          const request = store.get(pathId);

          await new Promise<void>((resolve, reject) => {
            request.onsuccess = () => {
              const pathInfo = request.result;
              if (pathInfo) {
                pathInfo.lastScanned = Date.now();
                pathInfo.trackCount = quick.length;
                store.put(pathInfo);
              }
              resolve();
            };
            request.onerror = () => reject(request.error);
          });
        } catch (error) {
          console.error('Failed to update library path metadata:', error);
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Scan cancelled')) {
        return;
      }
      throw error;
    } finally {
      await unlisten();
      this.isScanning = false;
      if (!silentProgress) {
        this.notifyScanProgress({ total: 0, current: 0, isScanning: false });
      }
    }
  }

  private async getStoredTracksForBackendScan(
    folderPath: string,
    pathId?: string
  ): Promise<StoredTrackRecord[]> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');
      const folderPrefix = this.normalizeFolderPrefix(folderPath);

      const scanByPrefix = () => {
        const results: StoredTrackRecord[] = [];
        const request = store.openCursor();
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
          if (!cursor) {
            resolve(results);
            return;
          }
          const value = cursor.value as unknown as StoredTrackRecord;
          const p = String(value.filePath || value.path || '');
          if (p) {
            const normalized = this.normalizePathForCompare(p);
            if (normalized.startsWith(folderPrefix)) results.push(value);
          }
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      };

      if (pathId && store.indexNames.contains('libraryPathId')) {
        try {
          const index = store.index('libraryPathId');
          const request = index.getAll(pathId);
          request.onsuccess = () => {
            const result = (request.result || []) as unknown as StoredTrackRecord[];
            if (result.length > 0) {
              resolve(result);
              return;
            }
            scanByPrefix();
          };
          request.onerror = () => {
            scanByPrefix();
          };
        } catch (_error) {
          scanByPrefix();
        }
      } else {
        scanByPrefix();
      }
    });
  }

  private async applyBackendScanDiff(
    upserts: StoredTrackRecord[],
    deletions: string[]
  ): Promise<void> {
    if (upserts.length === 0 && deletions.length === 0) return;

    const db = await this.ensureDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readwrite');
      const store = transaction.objectStore('tracks');

      for (const item of upserts) {
        store.put(item);
      }

      for (const id of deletions) {
        store.delete(id);
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // 批量存储轨道到数据库（优化：一个事务处理多条记录）
  private async batchStoreTracks(tracks: StoredTrackRecord[]): Promise<void> {
    const db = await this.ensureDB();
    const transaction = db.transaction(['tracks'], 'readwrite');
    const store = transaction.objectStore('tracks');

    for (const trackToStore of tracks) {
      try {
        if (!trackToStore.path) {
          await new Promise<void>((resolve, reject) => {
            const request = store.add(trackToStore);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
          });
        } else {
          // 检查是否已存在
          const existingRequest = store.index('path').get(trackToStore.path);
          await new Promise<void>((resolve, reject) => {
            existingRequest.onsuccess = () => {
              try {
                if (!existingRequest.result) {
                  const addRequest = store.add(trackToStore);
                  addRequest.onsuccess = () => resolve();
                  addRequest.onerror = () => reject(addRequest.error);
                } else {
                  const existing = existingRequest.result as unknown as StoredTrackRecord;
                  const updatedTrack: StoredTrackRecord = {
                    ...existing,
                    ...trackToStore,
                    id: existing.id,
                  };
                  const updateRequest = store.put(updatedTrack);
                  updateRequest.onsuccess = () => resolve();
                  updateRequest.onerror = () => reject(updateRequest.error);
                }
              } catch (err) {
                reject(err);
              }
            };
            existingRequest.onerror = () => reject(existingRequest.error);
          });
        }
      } catch (error) {
        console.error('Failed to store track:', error);
      }
    }

    // 等待整个事务完成
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(new Error('Transaction aborted'));
    });
  }

  // 递归收集音频文件（使用 File System Access API - 快速）
  private async collectAudioFilesFromHandle(
    dirHandle: FileSystemDirectoryHandle,
    audioFiles: Array<{
      path: string;
      name: string;
      file?: File;
      fileHandle?: FileSystemFileHandle;
    }>,
    basePath: string = ''
  ): Promise<void> {
    const supportedFormats = ['.mp3', '.flac', '.wav', '.m4a', '.mp4', '.ogg', '.weba', '.aac'];
    const currentPath = basePath ? `${basePath}/${dirHandle.name}` : dirHandle.name;

    try {
      const values = (dirHandle as unknown as {
        values: () => AsyncIterable<FileSystemHandle>;
      }).values();
      for await (const entry of values) {
        if (entry.kind === 'file') {
          const fileHandle = entry as FileSystemFileHandle;
          const ext = '.' + entry.name.split('.').pop()?.toLowerCase();

          if (supportedFormats.includes(ext)) {
            // ✅ 快速！File 对象是懒加载的，不立即读取内容
            const file = await fileHandle.getFile();
            audioFiles.push({
              path: `${currentPath}/${entry.name}`,
              name: entry.name,
              file: file,
              fileHandle: fileHandle, // ✅ 存储 FileHandle（可序列化）
            });
          }
        } else if (entry.kind === 'directory') {
          const subDirHandle = entry as FileSystemDirectoryHandle;
          await this.collectAudioFilesFromHandle(subDirHandle, audioFiles, currentPath);
        }
      }
    } catch (error) {
      console.error(`Error scanning directory:`, error);
      throw error;
    }
  }

  // 递归收集音频文件路径（使用 Tauri fs API - 较慢但支持绝对路径）
  private async collectAudioFilePaths(
    dirPath: string,
    audioFiles: Array<{
      path: string;
      name: string;
      file?: File;
      fileHandle?: FileSystemFileHandle;
    }>,
    relativePath: string = ''
  ): Promise<void> {
    const supportedFormats = ['.mp3', '.flac', '.wav', '.m4a', '.mp4', '.ogg', '.weba', '.aac'];

    console.log(`Scanning directory: ${dirPath}`);

    try {
      const entries = await readDir(dirPath, { recursive: false });

      for (const entry of entries) {
        if (entry.children) {
          // 是目录，递归扫描
          const newRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name || '';
          await this.collectAudioFilePaths(entry.path, audioFiles, newRelativePath);
        } else {
          // 是文件
          const ext = '.' + (entry.name?.split('.').pop()?.toLowerCase() || '');
          if (supportedFormats.includes(ext)) {
            audioFiles.push({
              path: entry.path,
              name: entry.name || '',
              file: undefined, // 没有 File 对象，需要读取
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error);
      throw error;
    }
  }

  // 添加库路径（通过字符串路径）
  async addLibraryPathByString(path: string, _displayName?: string): Promise<LibraryPath> {
    const db = await this.ensureDB();
    const pathId = `path-${Date.now()}`;

    // 检查路径是否已存在
    const existingPaths = await this.getLibraryPaths();
    const exists = existingPaths.some((p) => p.path === path);
    if (exists) {
      console.log(`Path already exists: ${path}`);
      return existingPaths.find((p) => p.path === path)!;
    }

    const pathInfo: LibraryPath = {
      id: pathId,
      path: path,
      addedAt: new Date(),
      trackCount: 0,
    };

    // 存储时将 Date 转换为时间戳
    const pathToStore = {
      ...pathInfo,
      addedAt: pathInfo.addedAt.getTime(),
    };

    const transaction = db.transaction(['libraryPaths'], 'readwrite');
    const store = transaction.objectStore('libraryPaths');
    store.add(pathToStore);

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => {
        console.log(`Successfully added library path: ${path}`);
        resolve();
      };
      transaction.onerror = () => {
        console.error('Failed to add library path:', transaction.error);
        reject(transaction.error);
      };
    });

    return pathInfo;
  }

  // 获取所有轨道（带限制，避免内存溢出）
  async getAllTracks(limit?: number): Promise<Track[]> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');

      if (limit) {
        // 使用游标限制结果数量
        const tracks: Track[] = [];
        const request = store.openCursor();
        let count = 0;

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor && count < limit) {
            tracks.push(this.restoreTrackForPlayback(cursor.value as unknown as StoredTrackRecord));
            count++;
            cursor.continue();
          } else {
            resolve(tracks);
          }
        };
        request.onerror = () => reject(request.error);
      } else {
        // 获取所有
        const request = store.getAll();
        request.onsuccess = () => {
          const raw = Array.isArray(request.result) ? request.result : [];
          const restoredTracks = raw.map((track) =>
            this.restoreTrackForPlayback(track as unknown as StoredTrackRecord)
          );
          resolve(restoredTracks);
        };
        request.onerror = () => reject(request.error);
      }
    });
  }

  // 搜索轨道（避免一次性加载全库导致卡顿）
  async searchTracks(query: string, limit?: number): Promise<Track[]> {
    const q = query.trim().toLowerCase();
    if (!q) return typeof limit === 'number' ? this.getAllTracks(limit) : this.getAllTracks();

    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');

      const results: Track[] = [];
      const request = store.openCursor();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
        if (!cursor) {
          resolve(results);
          return;
        }

        const value = cursor.value as unknown as StoredTrackRecord;
        const title = String(value.title || '').toLowerCase();
        const artist = String(value.artist || '').toLowerCase();
        const album = String(value.album || '').toLowerCase();

        if (title.includes(q) || artist.includes(q) || album.includes(q)) {
          results.push(this.restoreTrackForPlayback(value));
          if (typeof limit === 'number' && results.length >= limit) {
            resolve(results);
            return;
          }
        }

        cursor.continue();
      };

      request.onerror = () => reject(request.error);
    });
  }

  // 从存储的track恢复用于播放的track对象
  private restoreTrackForPlayback(storedTrack: StoredTrackRecord): Track {
    const { addedAt, ...rest } = storedTrack;
    const track: Track = { ...rest };

    track.coverUrl = this.sanitizeCoverUrl(track.coverUrl);

    if (typeof addedAt === 'number') {
      track.addedAt = new Date(addedAt);
    }

    // 直接使用文件路径，供播放器读取
    if (track.filePath) {
      track.path = track.filePath;
    }

    return track;
  }

  // 测试权限是否有效
  async testFileHandlePermissions(): Promise<{
    total: number;
    accessible: number;
    needAuth: number;
  }> {
    const tracks = await this.getAllTracks(100); // 测试前100首
    let accessible = 0;
    let needAuth = 0;

    for (const track of tracks) {
      if (track.fileHandle) {
        try {
          // 尝试访问文件，检查权限
          await track.fileHandle.getFile();
          accessible++;
        } catch (error) {
          needAuth++;
        }
      }
    }

    return { total: tracks.length, accessible, needAuth };
  }

  // ✅ 请求单个 FileHandle 的权限
  async requestFileHandlePermission(fileHandle: FileSystemFileHandle): Promise<boolean> {
    try {
      type PermissionCapableFileHandle = FileSystemFileHandle & {
        queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
        requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
      };
      const handle = fileHandle as unknown as PermissionCapableFileHandle;
      if (typeof handle.queryPermission !== 'function' || typeof handle.requestPermission !== 'function') {
        // 浏览器不支持权限 API
        return false;
      }

      const permission = await handle.queryPermission({ mode: 'read' });
      if (permission === 'granted') {
        return true;
      }

      if (permission === 'prompt') {
        const newPermission = await handle.requestPermission({ mode: 'read' });
        return newPermission === 'granted';
      }

      return false;
    } catch (error) {
      console.error('[MusicLibrary] Failed to request permission:', error);
      return false;
    }
  }

  // ✅ 批量刷新所有文件夹的权限
  async refreshAllPermissions(): Promise<{
    total: number;
    granted: number;
    denied: number;
  }> {
    const paths = await this.getLibraryPaths();
    let granted = 0;
    let denied = 0;

    for (const path of paths) {
      if (path.folderHandle) {
        try {
          type PermissionCapableDirectoryHandle = FileSystemDirectoryHandle & {
            requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
          };
          const handle = path.folderHandle as unknown as PermissionCapableDirectoryHandle;
          if (typeof handle.requestPermission === 'function') {
            const permission = await handle.requestPermission({ mode: 'read' });
            if (permission === 'granted') {
              granted++;
              console.log(`[MusicLibrary] ✅ Permission granted for: ${path.path}`);
            } else {
              denied++;
              console.warn(`[MusicLibrary] ❌ Permission denied for: ${path.path}`);
            }
          } else {
            // 不支持权限 API，跳过
            granted++;
          }
        } catch (error) {
          denied++;
          console.error(`[MusicLibrary] Error requesting permission for ${path.path}:`, error);
        }
      }
    }

    return { total: paths.length, granted, denied };
  }

  // 检查文件是否存在
  async checkTrackAvailability(track: Track): Promise<boolean> {
    if (!track.filePath) {
      console.warn(`[MusicLibrary] Track ${track.title} has no filePath`);
      return false;
    }

    try {
      const fileExists = await exists(track.filePath);
      if (!fileExists) {
        console.warn(`[MusicLibrary] File not found for track ${track.title}: ${track.filePath}`);
      }
      return fileExists;
    } catch (error) {
      console.error(`[MusicLibrary] Error checking file existence for ${track.title}:`, error);
      return false;
    }
  }

  // 批量检查轨道可用性
  async checkTracksAvailability(tracks: Track[]): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const track of tracks) {
      const available = await this.checkTrackAvailability(track);
      results.set(track.id, available);
    }

    return results;
  }

  // 按艺术家获取轨道
  async getTracksByArtist(artist: string): Promise<Track[]> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');
      const index = store.index('artist');
      const request = index.getAll(artist);

      request.onsuccess = () => {
        const raw = Array.isArray(request.result) ? request.result : [];
        const restoredTracks = raw.map((track) =>
          this.restoreTrackForPlayback(track as unknown as StoredTrackRecord)
        );
        resolve(restoredTracks);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // 按专辑获取轨道
  async getTracksByAlbum(album: string): Promise<Track[]> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');
      const index = store.index('album');
      const request = index.getAll(album);

      request.onsuccess = () => {
        const raw = Array.isArray(request.result) ? request.result : [];
        const restoredTracks = raw.map((track) =>
          this.restoreTrackForPlayback(track as unknown as StoredTrackRecord)
        );
        resolve(restoredTracks);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // 获取所有艺术家
  async getAllArtists(): Promise<string[]> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');

      const request = (store.indexNames.contains('artist') ? store.index('artist') : store).openCursor();
      const seen = new Set<string>();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
        if (!cursor) {
          resolve(Array.from(seen).sort());
          return;
        }
        const value = cursor.value as unknown as Partial<Track>;
        const artist = String(value.artist ?? '').trim();
        if (artist) seen.add(artist);
        cursor.continue();
      };

      request.onerror = () => reject(request.error);
    });
  }

  // 获取所有专辑
  async getAllAlbums(): Promise<AlbumSummary[]> {
    const db = await this.ensureDB();

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
                cover: this.sanitizeCoverUrl(track.coverUrl),
                coverTrackPath: track.filePath || track.path,
                coverTrackId: track.id,
              });
            });
            resolve(
              Array.from(albumMap.values()).sort((a, b) => a.album.localeCompare(b.album))
            );
          })
          .catch(reject);
        return;
      }

      const albumMap = new Map<string, AlbumSummary>();
      const index = store.index('album');
      const request = index.openCursor();
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
        if (!cursor) {
          resolve(Array.from(albumMap.values()).sort((a, b) => a.album.localeCompare(b.album)));
          return;
        }

        const value = cursor.value as unknown as StoredTrackRecord;
        const album = String(value.album ?? '');
        if (album) {
          const artist = String(value.artist ?? 'Unknown Artist');
          const key = `${album}::${artist}`;
          if (!albumMap.has(key)) {
            albumMap.set(key, {
              album,
              artist,
                cover: this.sanitizeCoverUrl(value.coverUrl),
              coverTrackPath: value.filePath || value.path,
              coverTrackId: value.id,
            });
          }
        }

        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }

  // 获取所有流派
  async getAllGenres(): Promise<string[]> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');

      const request = (store.indexNames.contains('genre') ? store.index('genre') : store).openCursor();
      const seen = new Set<string>();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
        if (!cursor) {
          resolve(Array.from(seen).sort());
          return;
        }
        const value = cursor.value as unknown as Partial<Track>;
        const genre = String(value.genre ?? '').trim();
        if (genre) seen.add(genre);
        cursor.continue();
      };

      request.onerror = () => reject(request.error);
    });
  }

  // 获取库统计信息（带缓存）
  async getLibraryStats(): Promise<LibraryStats> {
    // 检查缓存
    const now = Date.now();
    if (this.cachedStats && now - this.cacheTimestamp < this.CACHE_TTL) {
      return this.cachedStats;
    }

    const artists = new Set<string>();
    const albums = new Set<string>();
    let totalTracks = 0;
    let totalSize = 0;
    let totalDuration = 0;

    const db = await this.ensureDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');
      const request = store.openCursor();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
        if (!cursor) {
          resolve();
          return;
        }

        const value = cursor.value as unknown as Partial<Track>;
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

    const stats = {
      totalTracks,
      totalArtists: artists.size,
      totalAlbums: albums.size,
      totalSize,
      totalDuration,
    };

    // 更新缓存
    this.cachedStats = stats;
    this.cacheTimestamp = now;

    return stats;
  }

  // 清除缓存
  private clearCache(): void {
    this.cachedStats = null;
    this.cacheTimestamp = 0;
  }

  // 搜索轨道
  // 清空库
  async clearLibrary(): Promise<void> {
    const db = await this.ensureDB();
    const transaction = db.transaction(['tracks'], 'readwrite');
    const store = transaction.objectStore('tracks');
    await store.clear();

    // 清除缓存
    this.clearCache();
  }

  // 删除轨道
  async deleteTrack(id: string): Promise<void> {
    const db = await this.ensureDB();
    const transaction = db.transaction(['tracks'], 'readwrite');
    const store = transaction.objectStore('tracks');
    await store.delete(id);

    // 清除缓存
    this.clearCache();
  }

  // 批量删除轨道（性能优化）
  async deleteMultipleTracks(ids: string[]): Promise<void> {
    const db = await this.ensureDB();
    const transaction = db.transaction(['tracks'], 'readwrite');
    const store = transaction.objectStore('tracks');

    for (const id of ids) {
      store.delete(id);
    }

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    // 清除缓存
    this.clearCache();
  }

  // 订阅扫描进度
  onScanProgress(listener: (progress: ScanProgress) => void): () => void {
    this.scanProgressListeners.add(listener);
    return () => this.scanProgressListeners.delete(listener);
  }

  // 通知扫描进度
  private notifyScanProgress(progress: ScanProgress): void {
    this.isScanning = progress.isScanning;
    this.scanProgressListeners.forEach((listener) => listener(progress));
  }
}

export const musicLibraryService = MusicLibraryService.getInstance();
