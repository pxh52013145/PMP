/**
 * 音频服务接口
 * 提供统一的音频播放控制 API，便于后续扩展 Native Audio 功能
 */

export type PlaybackState = 'idle' | 'loading' | 'buffering' | 'playing' | 'paused' | 'stopped' | 'error';

export type PlayMode = 'sequence' | 'loop' | 'single-loop' | 'shuffle';

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  tracks: Track[];
  kind?: 'manual' | 'smart' | 'platform';
  readonly?: boolean;
  sourceConnectorId?: string;
  sourcePlaylistId?: string;
  smartRuleJson?: string;
  coverUrl?: string;
  createdAt: number;
  updatedAt: number;
  trackCount?: number;
  totalDuration?: number;
  favorite?: boolean;
  tracksHydrated?: boolean;
}

export interface PlaylistCreateOptions {
  kind?: 'manual' | 'smart' | 'platform';
  readonly?: boolean;
  sourceConnectorId?: string;
  sourcePlaylistId?: string;
  smartRuleJson?: string;
}

export type PlaylistTrackSortField = 'default' | 'title' | 'artist' | 'album' | 'duration';

export type PlaylistTrackSortDirection = 'asc' | 'desc';

export interface PlaylistTrackPageEntry {
  playlistIndex: number;
  track: Track;
}

export interface PlaylistTrackPageResult {
  items: PlaylistTrackPageEntry[];
  total: number;
}

export interface Track {
  id: string;
  path?: string; // 文件路径或URL（Blob URL用于播放）
  filePath?: string; // 完整文件路径（Tauri场景 - 绝对路径）
  fileHandle?: FileSystemFileHandle; // ✅ 文件句柄（File System Access API - 零空间占用）
  originalPath?: string; // 原始文件路径（用于显示）
  libraryPathId?: string; // Music library folder id (IndexedDB.libraryPaths.id)
  mtimeMs?: number; // last modified time (ms) - library change detection
  quickFingerprint?: string; // metadata-resilient sparse audio fingerprint (v2)
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
  bufferedTime: number;
  bufferedAhead: number;
  decodeBufferedAhead?: number;
  outputBufferedAhead?: number;
  volume: number;
  muted: boolean;
  playMode: PlayMode;
  queue: Track[];
  currentIndex: number;
  playlists: Playlist[];
  currentPlaylist: Playlist | null;
}

export interface AudioProtectionWindowOptions {
  reason?: string;
  durationMs?: number;
}

export type AudioStabilityProfile =
  | 'low-latency'
  | 'balanced'
  | 'stable'
  | 'game-safe'
  | 'safe-mode';

export type AudioStabilityActionProfile = 'normal' | 'guarded' | 'critical';

export interface AudioEnginePolicyPatch {
  stabilityProfile?: AudioStabilityProfile;
  transportMode?: 'robust' | 'transport-exact';
  hqSrcEnabled?: boolean;
  hqSrcPhaseMode?: 'linear' | 'minimum' | 'intermediate';
  srcMode?: 'source-native' | 'match-output' | 'target-rate';
  srcBackend?: 'rubato' | 'linear-simd';
  srcTargetSampleRate?: number | null;
  outputQuantizationMode?: 'round' | 'tpdf';
}

export interface AudioDynamicSrcAutoSettings {
  enabled: boolean;
  adaptiveEnabled: boolean;
  learningEnabled: boolean;
  restoreDebounceMs: number;
  minSwitchIntervalMs: number;
  seekHoldMs: number;
  underrunHoldMs: number;
  sharedStressHoldMs: number;
  outputErrorHoldMs: number;
}

export interface AudioDynamicSrcAutoSettingsPatch {
  enabled?: boolean;
  adaptiveEnabled?: boolean;
  learningEnabled?: boolean;
  restoreDebounceMs?: number;
  minSwitchIntervalMs?: number;
  seekHoldMs?: number;
  underrunHoldMs?: number;
  sharedStressHoldMs?: number;
  outputErrorHoldMs?: number;
}

export type AudioDynamicSrcAdaptiveProfile = 'baseline' | 'elevated' | 'critical';

export type AudioDynamicSrcDegradationLevel = 0 | 1 | 2;

export type AudioTuningProfileId = 'extreme-ll' | 'll-guarded' | 'robust-shield';

export interface AudioTuningAutoSettings {
  enabled: boolean;
  tickIntervalMs: number;
  stableWindowMs: number;
  minSwitchIntervalMs: number;
  postSwitchObserveWindowMs: number;
  elevatedStressScore: number;
  criticalStressScore: number;
  criticalUnderrunEventsWindow: number;
  criticalOverflowGrowthTicks: number;
}

export interface AudioTuningAutoSettingsPatch {
  enabled?: boolean;
  tickIntervalMs?: number;
  stableWindowMs?: number;
  minSwitchIntervalMs?: number;
  postSwitchObserveWindowMs?: number;
  elevatedStressScore?: number;
  criticalStressScore?: number;
  criticalUnderrunEventsWindow?: number;
  criticalOverflowGrowthTicks?: number;
}

export type AudioDynamicSrcDegradationLabel =
  | 'l0-fidelity'
  | 'l1-balanced'
  | 'l2-protection';

export interface AudioRobustnessSnapshot {
  outputBackendId: string | null;
  outputBackends: string[];
  schedulerProfile?: 'normal' | 'guarded' | 'critical';
  stabilityProfile?: AudioStabilityProfile;
  stabilityActionProfile?: AudioStabilityActionProfile;
  stabilityPrimaryReason?: string | null;
  stabilityReasonCodes?: string[];
  transportMode?: 'robust' | 'transport-exact';
  hqSrcPhaseMode?: 'linear' | 'minimum' | 'intermediate';
  srcMode?: 'source-native' | 'match-output' | 'target-rate';
  srcBackend?: 'rubato' | 'linear-simd';
  srcTargetSampleRate?: number | null;
  outputQuantizationMode?: 'round' | 'tpdf';
  dynamicSrcAutoEnabled?: boolean;
  dynamicSrcProfile?: 'quality' | 'latency';
  dynamicSrcLastSwitchAtMs?: number | null;
  dynamicSrcLastSwitchReason?: string | null;
  dynamicSrcHoldUntilMs?: number;
  dynamicSrcManualLockActive?: boolean;
  dynamicSrcAdaptiveEnabled?: boolean;
  dynamicSrcAdaptiveProfile?: AudioDynamicSrcAdaptiveProfile;
  dynamicSrcStressScore?: number;
  dynamicSrcAutoDegradationLevel?: AudioDynamicSrcDegradationLevel;
  dynamicSrcAutoDegradationLabel?: AudioDynamicSrcDegradationLabel;
  dynamicSrcAutoDegradationReason?: string | null;
  dynamicSrcAutoDegradationLastChangedAtMs?: number | null;
  dynamicSrcLearningEnabled?: boolean;
  dynamicSrcLearningDeviceKey?: string;
  dynamicSrcLearningStressIndex?: number;
  dynamicSrcLearningScale?: number;
  dynamicSrcRestoreDebounceMs?: number;
  dynamicSrcMinSwitchIntervalMs?: number;
  dynamicSrcSeekHoldMs?: number;
  dynamicSrcUnderrunHoldMs?: number;
  dynamicSrcSharedStressHoldMs?: number;
  dynamicSrcOutputErrorHoldMs?: number;
  tuningAutoEnabled?: boolean;
  tuningAutoTickIntervalMs?: number;
  tuningAutoStableWindowMs?: number;
  tuningAutoMinSwitchIntervalMs?: number;
  tuningAutoPostSwitchObserveWindowMs?: number;
  tuningAutoElevatedStressScore?: number;
  tuningAutoCriticalStressScore?: number;
  tuningAutoCriticalUnderrunEventsWindow?: number;
  tuningAutoCriticalOverflowGrowthTicks?: number;
  tuningAutoCriticalOverflowGrowthStreak?: number;
  tuningAutoActiveProfile?: AudioTuningProfileId;
  tuningAutoLastReason?: string | null;
  tuningAutoLastAppliedAtMs?: number | null;
  tuningAutoStableSinceMs?: number | null;
  tuningAutoLastSwitchAtMs?: number | null;
  dynamicSrcEffectiveRestoreDebounceMs?: number;
  dynamicSrcEffectiveMinSwitchIntervalMs?: number;
  dynamicSrcEffectiveSeekHoldMs?: number;
  dynamicSrcEffectiveUnderrunHoldMs?: number;
  dynamicSrcEffectiveSharedStressHoldMs?: number;
  dynamicSrcEffectiveOutputErrorHoldMs?: number;
  hqSrcStopbandDb?: number;
  hqSrcActive?: boolean;
  hqSrcRatio?: number;
  sourceSampleRate?: number;
  outputSampleRate?: number;
  transportExactInt32Container?: boolean;
  outputCallbackMetricsValid?: boolean;
  underrunEvents: number;
  underrunFrames: number;
  underrunEventsWindow: number;
  underrunRecoveryActive: boolean;
  protectionWindowActive: boolean;
  protectionRefCount: number;
  protectionReason: string | null;
  autoSwitchCount: number;
  lastAutoSwitchAtMs: number | null;
  lastAutoSwitchReason: string | null;
  bufferedAheadSeconds: number;
  decodeBufferedAheadSeconds: number;
  outputBufferedAheadSeconds: number;
  bufferedAheadMinSeconds: number | null;
  bufferedAheadAvgSeconds: number | null;
  rebufferCount: number;
  outputCallbackP99Us?: number;
  outputWaitTimeoutCount?: number;
  outputRenderUnderrunEvents?: number;
  outputRenderUnderrunFrames?: number;
  outputCallbackIntervalJitterP99Us?: number;
  outputCallbackIntervalOverrunCount?: number;
  outputCallbackExpectedIntervalUs?: number;
  transferLowWatermarkSamples?: number;
  transferRenderLowHitCount?: number;
  transferDecodeLowHitCount?: number;
  transferAdaptationLevel?: number;
  transferOscillationStreak?: number;
  renderQueuePageLocked?: boolean;
  renderQueuePageLockFailureCount?: number;
  renderQueuePageLockAttemptedBytes?: number;
  renderQueuePageLockSucceededBytes?: number;
  renderQueuePageLockFailedBytes?: number;
  transferMetricsValid?: boolean;
  sharedRenderAheadEnabled?: boolean;
  sharedRenderUnderrunEvents?: number;
  sharedRenderUnderrunFrames?: number;
  sharedRenderLowHitCount?: number;
  sharedRenderLowWatermarkSamples?: number;
  memoryPoolF32GrowthEvents?: number;
  memoryPoolF32GrowthBytes?: number;
  memoryPoolF32PrewarmHits?: number;
  realtimeMemoryLockAttemptedBytes?: number;
  realtimeMemoryLockSucceededBytes?: number;
  realtimeMemoryLockFailedBytes?: number;
  realtimeMemoryLockSkippedBytes?: number;
  realtimeMemoryLockFailureCount?: number;
  realtimeMemoryLockSkippedCount?: number;
  realtimeMemoryLockedRoleMask?: number;
  realtimeMemoryFailedRoleMask?: number;
  realtimeMemorySkippedRoleMask?: number;
  realtimeMemoryPressureEvents?: number;
  controlQueueLockFree?: boolean;
  controlQueueMode?: string;
  controlQueueCapacity?: number;
  controlQueueOverwriteEvents?: number;
  controlQueueDropNewestEvents?: number;
  controlQueueCoalescedOverflowEvents?: number;
  controlQueueCriticalOverflowEvents?: number;
  estimatedAudioBufferBytes?: number;
  diagnosticTimelineDroppedEvents?: number;
  diagnosticTimeline?: Array<{
    seq: number;
    timestampMs: number;
    kind: string;
    value: number;
    aux: number;
  }>;
  dspRefillBudgetExceededCount?: number;
  dspRefillBudgetExceededLastUs?: number | null;
  dspRefillBudgetExceededLastBudgetUs?: number | null;
  vstBridgeFailureCount?: number;
  vstBridgeWriteBackpressureCount?: number;
  vstBridgeStallCount?: number;
  vstBridgeRestartAttemptCount?: number;
  vstSidecarCallbackLockMissCount?: number;
  vstSidecarCallbackLockMissFrames?: number;
  vstSidecarDryBypassFrames?: number;
  vstSidecarOutputBackpressureCount?: number;
  vstSidecarOutputBackpressureFrames?: number;
  lastWorkingSetTrimAtMs?: number | null;
  lastWorkingSetTrimTarget?: string | null;
  lastWorkingSetTrimReason?: string | null;
  lastWorkingSetTrimSucceeded?: boolean | null;
  lastWorkingSetTrimAttemptedCount?: number;
  lastWorkingSetTrimTrimmedCount?: number;
  lastWorkingSetTrimFailedCount?: number;
  recentPlaylistWriteScheduledCount?: number;
  recentPlaylistWriteFlushCount?: number;
  recentPlaylistWriteEventCount?: number;
  recentPlaylistWriteTrackCount?: number;
  recentPlaylistWritePayloadBytesTotal?: number;
  recentPlaylistWritePayloadBytesLast?: number;
  coverResolveRequestCount?: number;
  coverResolveCacheHitCount?: number;
  coverResolveCacheMissCount?: number;
  coverResolveHitRate?: number;
  coverBlobReleaseCount?: number;
}

export type AudioSpectrumTap = 'pre-dsp' | 'post-dsp';

export interface AudioSpectrumFrame {
  frameId: number;
  timestampMs: number;
  tap: AudioSpectrumTap;
  sampleRate: number;
  bins: Uint8Array;
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

  enterProtectionWindow?(options?: AudioProtectionWindowOptions): () => void;

  setEnginePolicy?(patch: AudioEnginePolicyPatch): Promise<void>;

  getDynamicSrcAutoSettings?(): AudioDynamicSrcAutoSettings;

  setDynamicSrcAutoSettings?(settings: AudioDynamicSrcAutoSettingsPatch): Promise<void>;

  applyTuningProfile?(profileId: AudioTuningProfileId): Promise<void>;

  getAudioTuningAutoSettings?(): AudioTuningAutoSettings;

  setAudioTuningAutoSettings?(settings: AudioTuningAutoSettingsPatch): Promise<void>;

  getRobustnessSnapshot?(): AudioRobustnessSnapshot;

  onRobustnessSnapshot?(callback: (snapshot: AudioRobustnessSnapshot) => void): () => void;

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
  createPlaylist(name: string, description?: string, options?: PlaylistCreateOptions): Playlist;

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
  addPlaylistToQueue(playlistId: string): Promise<void>;

  playPlaylistTrackAtIndex?(playlistId: string, trackIndex: number): Promise<void>;

  addPlaylistTrackIndexesToQueue?(
    playlistId: string,
    trackIndexes: number[]
  ): Promise<void>;

  /**
   * 按需加载播放列表曲目
   */
  hydratePlaylistTracks?(playlistId: string): Promise<Playlist | null>;

  queryPlaylistTracksPage?(
    playlistId: string,
    options?: {
      searchQuery?: string;
      sortField?: PlaylistTrackSortField;
      sortDirection?: PlaylistTrackSortDirection;
      limit?: number;
      offset?: number;
    }
  ): Promise<PlaylistTrackPageResult | null>;

  resolvePlaylistCoverPreview?(
    playlistId: string,
    options?: {
      coverSizeHint?: 'small' | 'medium' | 'large';
      preferCompactPreview?: boolean;
    }
  ): Promise<string | undefined>;

  /**
   * 释放播放列表曲目常驻内存
   */
  releasePlaylistTracks?(playlistId?: string): void;

  // ===== 音频可视化 =====
  /**
   * 获取频谱数据（用于可视化）
   * @returns 频谱数据数组，如果不可用则返回 null
   */
  getFrequencyData?(): Uint8Array | null;

  getSpectrumFrame?(tap?: AudioSpectrumTap): AudioSpectrumFrame | null;

  // ===== 清理 =====
  /**
   * 销毁音频服务，释放资源
   */
  destroy(): void;
}
