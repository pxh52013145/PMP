import { Track } from '../audio';
import { parseAudioFile } from '../../utils/audioMetadata';

// 音乐库数据库版本
const DB_VERSION = 1;
const DB_NAME = 'MusicLibrary';

// 库统计信息
export interface LibraryStats {
  totalTracks: number;
  totalArtists: number;
  totalAlbums: number;
  totalSize: number;
  totalDuration: number;
}

// 库路径信息
export interface LibraryPath {
  id: string;
  path: string;
  addedAt: Date;
  lastScanned?: Date;
  trackCount: number;
}

// 扫描进度信息
export interface ScanProgress {
  total: number;
  current: number;
  currentFile?: string;
  isScanning: boolean;
}

// 视图类型
export type ViewMode = 'artists' | 'albums' | 'folders' | 'genres' | 'years' | 'all';

// 排序选项
export type SortBy = 'title' | 'artist' | 'album' | 'duration' | 'addedAt' | 'year';

export class MusicLibraryService {
  private static instance: MusicLibraryService;
  private db: IDBDatabase | null = null;
  private scanProgressListeners: Set<(progress: ScanProgress) => void> = new Set();

  private constructor() {
    this.initDB();
  }

  static getInstance(): MusicLibraryService {
    if (!MusicLibraryService.instance) {
      MusicLibraryService.instance = new MusicLibraryService();
    }
    return MusicLibraryService.instance;
  }

  // 初始化数据库
  private async initDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

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
        }

        // 创建库路径存储
        if (!db.objectStoreNames.contains('libraryPaths')) {
          const pathsStore = db.createObjectStore('libraryPaths', { keyPath: 'id' });
          pathsStore.createIndex('path', 'path', { unique: true });
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

  // 扫描文件夹
  async scanFolder(folderHandle?: FileSystemDirectoryHandle): Promise<void> {
    if (!folderHandle) {
      // 请求用户选择文件夹
      try {
        // @ts-ignore - File System Access API
        folderHandle = await window.showDirectoryPicker({
          mode: 'read',
        });
      } catch (error) {
        console.error('User cancelled folder selection:', error);
        return;
      }
    }

    const files: File[] = [];
    await this.collectAudioFiles(folderHandle, files);

    const total = files.length;
    let current = 0;

    this.notifyScanProgress({
      total,
      current: 0,
      isScanning: true,
    });

    if (total === 0) {
      console.log('No audio files found in selected folder');
      return;
    }

    console.log(`Found ${total} audio files, starting scan...`);

    const db = await this.ensureDB();

    for (const file of files) {
      current++;
      this.notifyScanProgress({
        total,
        current,
        currentFile: file.name,
        isScanning: true,
      });

      try {
        const track = await parseAudioFile(file);
        console.log(`Parsed track: ${track.title}`);

        // 创建 Blob URL 用于播放（注意：刷新页面后会失效）
        const blobUrl = URL.createObjectURL(file);

        // 准备存储的数据 - 移除不可序列化的字段
        const trackToStore = {
          ...track,
          file: undefined, // 不存储File对象
          path: blobUrl, // 使用 Blob URL 作为播放路径
          originalPath: track.path, // 保存原始路径用于显示
          addedAt: track.addedAt ? track.addedAt.getTime() : Date.now(), // 转换为时间戳
        };

        // 每个文件单独创建事务
        const transaction = db.transaction(['tracks'], 'readwrite');
        const store = transaction.objectStore('tracks');

        // 检查是否已存在
        const existingRequest = store.index('path').get(trackToStore.path);

        await new Promise<void>((resolve, reject) => {
          existingRequest.onsuccess = () => {
            try {
              if (!existingRequest.result) {
                // 添加新轨道
                console.log(`Adding new track: ${track.title}`);
                const addRequest = store.add(trackToStore);
                addRequest.onsuccess = () => resolve();
                addRequest.onerror = () => reject(addRequest.error);
              } else {
                // 更新现有轨道
                console.log(`Updating existing track: ${track.title}`);
                const updatedTrack = { ...existingRequest.result, ...trackToStore };
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

        // 等待事务完成
        await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(new Error('Transaction aborted'));
        });
      } catch (error) {
        console.error(`Failed to process file ${file.name}:`, error);
      }
    }

    console.log(`Scan completed: ${current} files processed`);

    this.notifyScanProgress({
      total,
      current,
      isScanning: false,
    });
  }

  // 递归收集音频文件
  private async collectAudioFiles(
    dirHandle: FileSystemDirectoryHandle,
    files: File[],
    path: string = ''
  ): Promise<void> {
    const supportedFormats = ['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.weba', '.aac'];

    console.log(`Scanning directory: ${path || '(root)'}`);

    try {
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          const file = await (entry as FileSystemFileHandle).getFile();
          const ext = '.' + file.name.split('.').pop()?.toLowerCase();

          if (supportedFormats.includes(ext)) {
            // 添加路径信息
            Object.defineProperty(file, 'webkitRelativePath', {
              value: path ? `${path}/${file.name}` : file.name,
              writable: false,
            });
            files.push(file);
            console.log(`Found audio file: ${file.name}`);
          }
        } else if (entry.kind === 'directory') {
          const newPath = path ? `${path}/${entry.name}` : entry.name;
          await this.collectAudioFiles(entry as FileSystemDirectoryHandle, files, newPath);
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${path}:`, error);
      throw error;
    }
  }

  // 获取所有轨道
  async getAllTracks(): Promise<Track[]> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // 按艺术家获取轨道
  async getTracksByArtist(artist: string): Promise<Track[]> {
    const db = await this.ensureDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tracks'], 'readonly');
      const store = transaction.objectStore('tracks');
      const index = store.index('artist');
      const request = index.getAll(artist);

      request.onsuccess = () => resolve(request.result || []);
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

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // 获取所有艺术家
  async getAllArtists(): Promise<string[]> {
    const tracks = await this.getAllTracks();
    const artists = new Set<string>();
    tracks.forEach((track) => {
      if (track.artist) artists.add(track.artist);
    });
    return Array.from(artists).sort();
  }

  // 获取所有专辑
  async getAllAlbums(): Promise<{ album: string; artist: string; cover?: string }[]> {
    const tracks = await this.getAllTracks();
    const albumMap = new Map<string, { artist: string; cover?: string }>();

    tracks.forEach((track) => {
      if (track.album && !albumMap.has(track.album)) {
        albumMap.set(track.album, {
          artist: track.artist || 'Unknown Artist',
          cover: track.coverUrl,
        });
      }
    });

    return Array.from(albumMap.entries())
      .map(([album, info]) => ({ album, ...info }))
      .sort((a, b) => a.album.localeCompare(b.album));
  }

  // 获取所有流派
  async getAllGenres(): Promise<string[]> {
    const tracks = await this.getAllTracks();
    const genres = new Set<string>();
    tracks.forEach((track) => {
      if (track.genre) genres.add(track.genre);
    });
    return Array.from(genres).sort();
  }

  // 获取库统计信息
  async getLibraryStats(): Promise<LibraryStats> {
    const tracks = await this.getAllTracks();
    const artists = new Set<string>();
    const albums = new Set<string>();
    let totalSize = 0;
    let totalDuration = 0;

    tracks.forEach((track) => {
      if (track.artist) artists.add(track.artist);
      if (track.album) albums.add(track.album);
      totalSize += track.fileSize || 0;
      totalDuration += track.duration || 0;
    });

    return {
      totalTracks: tracks.length,
      totalArtists: artists.size,
      totalAlbums: albums.size,
      totalSize,
      totalDuration,
    };
  }

  // 搜索轨道
  async searchTracks(query: string): Promise<Track[]> {
    const allTracks = await this.getAllTracks();
    const lowerQuery = query.toLowerCase();

    return allTracks.filter(
      (track) =>
        track.title?.toLowerCase().includes(lowerQuery) ||
        track.artist?.toLowerCase().includes(lowerQuery) ||
        track.album?.toLowerCase().includes(lowerQuery) ||
        track.genre?.toLowerCase().includes(lowerQuery)
    );
  }

  // 清空库
  async clearLibrary(): Promise<void> {
    const db = await this.ensureDB();
    const transaction = db.transaction(['tracks'], 'readwrite');
    const store = transaction.objectStore('tracks');
    await store.clear();
  }

  // 删除轨道
  async deleteTrack(id: string): Promise<void> {
    const db = await this.ensureDB();
    const transaction = db.transaction(['tracks'], 'readwrite');
    const store = transaction.objectStore('tracks');
    await store.delete(id);
  }

  // 订阅扫描进度
  onScanProgress(listener: (progress: ScanProgress) => void): () => void {
    this.scanProgressListeners.add(listener);
    return () => this.scanProgressListeners.delete(listener);
  }

  // 通知扫描进度
  private notifyScanProgress(progress: ScanProgress): void {
    this.scanProgressListeners.forEach((listener) => listener(progress));
  }
}

export const musicLibraryService = MusicLibraryService.getInstance();
