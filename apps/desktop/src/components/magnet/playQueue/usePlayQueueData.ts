/**
 * PlayQueueButton 数据层 Hook
 * 负责获取播放队列数据
 */

import { useState, useEffect } from 'react';
import { audioService, AudioState } from '../../../services/audio';

export interface PlayQueueData {
  queue: AudioState['queue'];
  currentIndex: number;
  queueLength: number;
}

/**
 * 获取PlayQueue的数据
 */
export function usePlayQueueData(): PlayQueueData {
  const [audioState, setAudioState] = useState<AudioState>(audioService.getState());

  useEffect(() => {
    const unsubscribe = audioService.onStateChange(setAudioState);
    return unsubscribe;
  }, []);

  return {
    queue: audioState.queue,
    currentIndex: audioState.currentIndex,
    queueLength: audioState.queue.length,
  };
}
