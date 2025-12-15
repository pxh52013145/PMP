/**
 * 音频服务导出
 * 提供全局音频服务实例
 */

export type { Track, AudioState, PlaybackState, PlayMode, Playlist } from './types';
export type { IAudioService } from './types';
export { WebAudioService } from './WebAudioService';
export { NativeAudioService } from './NativeAudioService';
