/**
 * 共享的音频状态Hook
 * 供简单按钮组件使用
 */

import { useState, useEffect } from 'react';
import { PlayMode } from '../../../services/audio';
import { useAudioService } from '../../../contexts/AudioEngineContext';

/**
 * 获取播放状态
 */
export function usePlaybackState() {
  const audioService = useAudioService();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = audioService.onStateChange((state) => {
      setIsPlaying(state.playbackState === 'playing');
      setIsLoading(state.playbackState === 'loading');
    });

    const state = audioService.getState();
    setIsPlaying(state.playbackState === 'playing');
    setIsLoading(state.playbackState === 'loading');

    return unsubscribe;
  }, [audioService]);

  return { isPlaying, isLoading };
}

/**
 * 获取队列状态
 */
export function useQueueState() {
  const audioService = useAudioService();
  const [hasQueue, setHasQueue] = useState(false);
  const [queueLength, setQueueLength] = useState(0);

  useEffect(() => {
    const unsubscribe = audioService.onStateChange((state) => {
      setHasQueue(state.queue.length > 0);
      setQueueLength(state.queue.length);
    });

    const state = audioService.getState();
    setHasQueue(state.queue.length > 0);
    setQueueLength(state.queue.length);

    return unsubscribe;
  }, [audioService]);

  return { hasQueue, queueLength };
}

/**
 * 获取播放模式
 */
export function usePlayMode() {
  const audioService = useAudioService();
  const [playMode, setPlayMode] = useState<PlayMode>('sequence');

  useEffect(() => {
    const unsubscribe = audioService.onStateChange((state) => {
      setPlayMode(state.playMode);
    });

    setPlayMode(audioService.getState().playMode);

    return unsubscribe;
  }, [audioService]);

  return playMode;
}

/**
 * 获取音量状态
 */
export function useVolumeState() {
  const audioService = useAudioService();
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const unsubscribe = audioService.onStateChange((state) => {
      setVolume(state.volume);
      setMuted(state.muted);
    });

    const state = audioService.getState();
    setVolume(state.volume);
    setMuted(state.muted);

    return unsubscribe;
  }, [audioService]);

  return { volume, muted };
}
