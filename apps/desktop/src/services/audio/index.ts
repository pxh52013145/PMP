/**
 * 音频服务导出
 * 提供全局音频服务实例
 */

export type { Track, AudioState, PlaybackState, PlayMode, Playlist } from './types';
export type { IAudioService } from './types';
export { NativeAudioService } from './NativeAudioService';
export type { AudioEngineService, AudioEngineSnapshot, AudioEngineType } from './AudioEngineService';
export { AUDIO_ENGINE_SERVICE_TOKEN, DefaultAudioEngineService } from './AudioEngineService';
export { createAudioModule } from './audioModule';
