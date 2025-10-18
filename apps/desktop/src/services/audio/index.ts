/**
 * 音频服务导出
 * 提供全局音频服务实例
 */

export type { Track, AudioState, PlaybackState, PlayMode, Playlist } from './types';
export type { IAudioService } from './types';
export * from './WebAudioService';

import { WebAudioService } from './WebAudioService';
import { IAudioService } from './types';

// 配置：是否使用原生音频服务（未来实现）
const USE_NATIVE_AUDIO = false;

// 全局音频服务实例
export const audioService: IAudioService = USE_NATIVE_AUDIO
  ? // 未来实现：new NativeAudioService()
    new WebAudioService()
  : new WebAudioService();
