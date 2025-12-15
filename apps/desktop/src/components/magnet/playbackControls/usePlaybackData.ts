/**
 * PlaybackControls 数据层 Hook
 * 负责获取播放控制相关数据
 */

import { useState, useEffect } from 'react';
import { PlaybackState } from '../../../services/audio';
import { useAudioService } from '../../../contexts/AudioEngineContext';

export interface PlaybackData {
  playbackState: PlaybackState;
  hasQueue: boolean;
  currentTrack: any;
  queueLength: number;
}

/**
 * 获取PlaybackControls的数据
 */
export function usePlaybackData(): PlaybackData {
  const audioService = useAudioService();
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
  const [hasQueue, setHasQueue] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<any>(null);
  const [queueLength, setQueueLength] = useState(0);

  useEffect(() => {
    const unsubscribe = audioService.onStateChange((state) => {
      setPlaybackState(state.playbackState);
      setHasQueue(state.queue.length > 0);
      setCurrentTrack(state.currentTrack);
      setQueueLength(state.queue.length);
    });

    // 初始化
    const state = audioService.getState();
    setPlaybackState(state.playbackState);
    setHasQueue(state.queue.length > 0);
    setCurrentTrack(state.currentTrack);
    setQueueLength(state.queue.length);

    return unsubscribe;
  }, [audioService]);

  return {
    playbackState,
    hasQueue,
    currentTrack,
    queueLength,
  };
}
