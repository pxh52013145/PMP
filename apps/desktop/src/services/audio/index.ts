/**
 * 音频服务导出
 * 提供全局音频服务实例
 */

export type {
  AudioProtectionWindowOptions,
  AudioRobustnessSnapshot,
  Track,
  AudioState,
  PlaybackState,
  PlayMode,
  Playlist,
} from './types';
export type { IAudioService } from './types';
export { NativeAudioService } from './NativeAudioService';
export type { AudioEngineService, AudioEngineSnapshot, AudioEngineType } from './AudioEngineService';
export { AUDIO_ENGINE_SERVICE_TOKEN, DefaultAudioEngineService } from './AudioEngineService';
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
