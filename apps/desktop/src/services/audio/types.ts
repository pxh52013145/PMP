/**
 * 音频服务接口
 * 提供统一的音频播放控制 API，便于后续从 Web Audio 迁移到原生实现
 */

export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'error';

export type PlayMode = 'sequence' | 'loop' | 'single-loop' | 'shuffle';

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  tracks: Track[];
  coverUrl?: string;
  createdAt: number;
  updatedAt: number;
  trackCount?: number;
  totalDuration?: number;
  favorite?: boolean;
}

export interface Track {
  id: string;
  path?: string; // 文件路径或URL（Blob URL用于播放）
  filePath?: string; // 完整文件路径（Tauri场景 - 绝对路径）
  fileHandle?: FileSystemFileHandle; // ✅ 文件句柄（File System Access API - 零空间占用）
  originalPath?: string; // 原始文件路径（用于显示）
  libraryPathId?: string; // Music library folder id (IndexedDB.libraryPaths.id)
  mtimeMs?: number; // last modified time (ms) - library change detection
  metadataScannedAtMs?: number; // when metadata probe last ran (avoid repeated probing on unchanged files)
  title: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  duration?: number;
  coverKey?: string;
  coverUrl?: string;
  year?: number;
  genre?: string;
  trackNumber?: number;
  discNumber?: number;
  composer?: string;
  bitrate?: number;
  sampleRate?: number;
  replayGainTrackGainDb?: number; // ReplayGain track gain in dB (from tags, if present)
  replayGainAlbumGainDb?: number; // ReplayGain album gain in dB (from tags, if present)
  format?: string;
  codecName?: string; // 编码格式
  fileSize?: number;
  dateAdded?: number;
  addedAt?: Date; // 添加到库的时间
  lastPlayed?: number;
  playCount?: number;
  rating?: number;
  favorite?: boolean;
  tags?: string[];
  lyrics?: string;
  comment?: string;
  file?: File; // 原始File对象（用于播放）
  fileContent?: ArrayBuffer; // 文件内容（兼容性保留）
  mimeType?: string; // MIME类型（用于创建Blob）
}

export interface AudioState {
  currentTrack: Track | null;
  playbackState: PlaybackState;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  playMode: PlayMode;
  queue: Track[];
  currentIndex: number;
  playlists: Playlist[];
  currentPlaylist: Playlist | null;
}

/**
 * 音频服务接口
 * 定义了音乐播放器的核心功能
 */
export interface IAudioService {
  // ===== 播放控制 =====
  /**
   * 加载音频文件
   */
  loadTrack(track: Track): Promise<void>;

  /**
   * 播放
   */
  play(): Promise<void>;

  /**
   * 暂停
   */
  pause(): void;

  /**
   * 停止
   */
  stop(): void;

  /**
   * 跳转到指定时间
   * @param time 时间（秒）
   */
  seek(time: number): void;

  // ===== 音量控制 =====
  /**
   * 设置音量
   * @param volume 音量 (0.0 - 1.0)
   */
  setVolume(volume: number): void;

  /**
   * 获取当前音量
   */
  getVolume(): number;

  /**
   * 切换静音
   */
  toggleMute(): void;

  // ===== 状态查询 =====
  /**
   * 获取当前播放时间
   */
  getCurrentTime(): number;

  /**
   * 获取音频总时长
   */
  getDuration(): number;

  /**
   * 获取当前状态
   */
  getState(): AudioState;

  // ===== 事件监听 =====
  /**
   * 监听时间更新
   */
  onTimeUpdate(callback: (time: number) => void): () => void;

  /**
   * 监听播放结束
   */
  onEnded(callback: () => void): () => void;

  /**
   * 监听状态变化
   */
  onStateChange(callback: (state: AudioState) => void): () => void;

  /**
   * 监听加载进度
   */
  onLoadProgress(callback: (progress: number) => void): () => void;

  /**
   * 监听错误
   */
  onError(callback: (error: Error) => void): () => void;

  // ===== 播放队列 =====
  /**
   * 添加歌曲到播放队列
   */
  addToQueue(track: Track): void;

  /**
   * 添加多首歌曲到队列
   */
  addMultipleToQueue(tracks: Track[]): void;

  /**
   * 从队列移除歌曲
   */
  removeFromQueue(index: number): void;

  /**
   * 清空队列
   */
  clearQueue(): void;

  /**
   * 获取播放队列
   */
  getQueue(): Track[];

  /**
   * 播放队列中指定索引的歌曲
   */
  playTrackAtIndex(index: number): Promise<void>;

  /**
   * 重新排序队列
   */
  reorderQueue(fromIndex: number, toIndex: number): void;

  /**
   * 播放上一首
   */
  playPrevious(): Promise<void>;

  /**
   * 播放下一首
   */
  playNext(): Promise<void>;

  // ===== 播放模式 =====
  /**
   * 设置播放模式
   */
  setPlayMode(mode: PlayMode): void;

  /**
   * 获取播放模式
   */
  getPlayMode(): PlayMode;

  /**
   * 快进（秒）
   */
  fastForward(seconds: number): void;

  /**
   * 快退（秒）
   */
  rewind(seconds: number): void;

  // ===== 播放列表管理 =====
  /**
   * 创建播放列表
   */
  createPlaylist(name: string, description?: string): Playlist;

  /**
   * 删除播放列表
   */
  deletePlaylist(playlistId: string): void;

  /**
   * 重命名播放列表
   */
  renamePlaylist(playlistId: string, newName: string): void;

  /**
   * 获取所有播放列表
   */
  getPlaylists(): Playlist[];

  /**
   * 获取播放列表
   */
  getPlaylist(playlistId: string): Playlist | null;

  /**
   * 添加歌曲到播放列表
   */
  addTrackToPlaylist(playlistId: string, track: Track): void;

  /**
   * 从播放列表移除歌曲
   */
  removeTrackFromPlaylist(playlistId: string, trackIndex: number): void;

  /**
   * 清空播放列表
   */
  clearPlaylist(playlistId: string): void;

  /**
   * 播放播放列表
   */
  playPlaylist(playlistId: string): Promise<void>;

  /**
   * 将播放列表添加到队列
   */
  addPlaylistToQueue(playlistId: string): void;

  // ===== 音频可视化 =====
  /**
   * 获取频谱数据（用于可视化）
   * @returns 频谱数据数组，如果不可用则返回 null
   */
  getFrequencyData?(): Uint8Array | null;

  // ===== 清理 =====
  /**
   * 销毁音频服务，释放资源
   */
  destroy(): void;
}
