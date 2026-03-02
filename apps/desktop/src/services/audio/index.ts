/**
 * 音频服务导出
 * 提供全局音频服务实例
 */

export type {
  AudioProtectionWindowOptions,
  AudioRobustnessSnapshot,
  AudioTuningAutoSettings,
  AudioTuningAutoSettingsPatch,
  AudioTuningProfileId,
  Track,
  AudioState,
  PlaybackState,
  PlayMode,
  Playlist,
  PlaylistCreateOptions,
} from './types';
export type { IAudioService } from './types';
export { NativeAudioService } from './NativeAudioService';
export type { AudioEngineService, AudioEngineSnapshot, AudioEngineType } from './AudioEngineService';
export { AUDIO_ENGINE_SERVICE_TOKEN, DefaultAudioEngineService } from './AudioEngineService';
export {
  CLOUD_PLAYBACK_QUEUE_AUDIT_MAX_ENTRIES,
  CLOUD_PLAYBACK_QUEUE_SERVICE_TOKEN,
  DefaultCloudPlaybackQueueService,
  type CloudPlaybackQueueAuditEntry,
  type CloudPlaybackQueueAuditSnapshot,
  type CloudPlaybackQueueAuditStats,
  type CloudPlaybackQueueService,
} from './CloudPlaybackQueueService';
export {
  clearCloudPlaybackFallbackQueue,
  getCloudPlaybackFallbackAdapter,
  getCloudPlaybackFallbackQueueSnapshot,
  subscribeCloudPlaybackFallbackQueued,
  type CloudPlaybackFallbackAdapter,
  type CloudPlaybackFallbackDispatchResult,
  type CloudPlaybackFallbackQueuedEvent,
  type CloudPlaybackFallbackRequest,
} from './cloudPlaybackFallbackAdapter';
export { createAudioModule } from './audioModule';
export { createCloudPlaybackQueueModule } from './cloudPlaybackQueueModule';
