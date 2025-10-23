import { Track } from '../audio';
import { parseAudioFile } from '../../utils/audioMetadata';
import { open } from '@tauri-apps/api/dialog';
import { readDir, readBinaryFile, exists } from '@tauri-apps/api/fs';

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
  folderHandle?: FileSystemDirectoryHandle; // ✅ 存储文件夹句柄用于权限管理
}

// 扫描进度信息
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
  private db: IDBDatabase | null = null;
  private scanProgressListeners: Set<(progress: ScanProgress) => void> = new Set();

  // 缓存 - 减少数据库查询
  private cachedStats: LibraryStats | null = null;
  private cacheTimestamp: number = 0;
  private CACHE_TTL = 5000; // 5秒缓存

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
        const paths = (request.result || []).map((path: any) => ({
          ...path,
          addedAt: path.addedAt ? new Date(path.addedAt) : new Date(),
          lastScanned: path.lastScanned ? new Date(path.lastScanned) : undefined,
        }));
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

    for (const pathInfo of paths) {
      console.log(`Scanning library path: ${pathInfo.path}`);
      try {
        // 尝试重新获取文件夹句柄
        // @ts-ignore - File System Access API
        if (window.showDirectoryPicker) {
          console.log(`请授权访问文件夹: ${pathInfo.path}`);
          // 注意：每次都需要用户重新授权
          // @ts-ignore
          const folderHandle = await window.showDirectoryPicker({
            mode: 'read',
            id: pathInfo.id, // 尝试使用相同的ID来获取之前的权限
          });
          await this.scanFolder(folderHandle, pathInfo.id);
        }
      } catch (error: any) {
        if (error.name === 'AbortError') {
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

    // 优先使用 File System Access API（快速）
    if (!folderPathOrHandle) {
      try {
        // 检查是否支持 File System Access API
        // @ts-ignore
        if (window.showDirectoryPicker) {
          // @ts-ignore
          folderHandle = await window.showDirectoryPicker({ mode: 'read' });
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
      } catch (error: any) {
        if (error.name === 'AbortError') {
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
      const parsedTracks = await Promise.all(
        batch.map(async (audioFile, batchIndex) => {
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
              // 否则读取文件（Tauri API）
              const fileData = await readBinaryFile(audioFile.path);
              const arrayBuffer = fileData.buffer as ArrayBuffer;
              const blob = new Blob([arrayBuffer]);
              const file = new File([blob], audioFile.name);

              track = await parseAudioFile(file);
              filePath = audioFile.path;
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
      const validTracks = parsedTracks.filter((t) => t !== null);
      if (validTracks.length > 0) {
        await this.batchStoreTracks(validTracks as any[]);
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

  // 批量存储轨道到数据库（优化：一个事务处理多条记录）
  private async batchStoreTracks(tracks: any[]): Promise<void> {
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
                  const updatedTrack = {
                    ...existingRequest.result,
                    ...trackToStore,
                    id: existingRequest.result.id,
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
    const supportedFormats = ['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.weba', '.aac'];
    const currentPath = basePath ? `${basePath}/${dirHandle.name}` : dirHandle.name;

    try {
      // @ts-ignore
      for await (const entry of dirHandle.values()) {
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
    const supportedFormats = ['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.weba', '.aac'];

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
        const tracks: any[] = [];
        const request = store.openCursor();
        let count = 0;

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor && count < limit) {
            tracks.push(this.restoreTrackForPlayback(cursor.value));
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
          const tracks = request.result || [];
          const restoredTracks = tracks.map((track: any) => this.restoreTrackForPlayback(track));
          resolve(restoredTracks);
        };
        request.onerror = () => reject(request.error);
      }
    });
  }

  // 从存储的track恢复用于播放的track对象
  private restoreTrackForPlayback(storedTrack: any): Track {
    const track = { ...storedTrack };

    // 直接使用文件路径，WebAudioService 会负责处理
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
      const handle = fileHandle as any;
      if (!handle.queryPermission || !handle.requestPermission) {
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
          const handle = path.folderHandle as any;
          if (handle.requestPermission) {
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
        const tracks = request.result || [];
        const restoredTracks = tracks.map((track: any) => this.restoreTrackForPlayback(track));
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
        const tracks = request.result || [];
        const restoredTracks = tracks.map((track: any) => this.restoreTrackForPlayback(track));
        resolve(restoredTracks);
      };
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

  // 获取库统计信息（带缓存）
  async getLibraryStats(): Promise<LibraryStats> {
    // 检查缓存
    const now = Date.now();
    if (this.cachedStats && now - this.cacheTimestamp < this.CACHE_TTL) {
      return this.cachedStats;
    }

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

    const stats = {
      totalTracks: tracks.length,
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
    this.scanProgressListeners.forEach((listener) => listener(progress));
  }
}

export const musicLibraryService = MusicLibraryService.getInstance();
