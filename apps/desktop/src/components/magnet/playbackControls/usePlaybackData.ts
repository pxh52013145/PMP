/**
 * PlaybackControls 数据层 Hook
 * 负责获取播放控制相关数据
 */

import { useState, useEffect } from 'react';
import type { Track } from '../../../services/audio';
import { PlaybackState } from '../../../services/audio';
import { useAudioService } from '../../../contexts/AudioEngineContext';
import { isSameTrackRenderIdentity, sanitizeTrackForRuntime } from '../shared/sanitizeTrackForRuntime';

export interface PlaybackData {
  playbackState: PlaybackState;
  hasQueue: boolean;
  currentTrack: Track | null;
  queueLength: number;
}

/**
 * 获取PlaybackControls的数据
 */
export function usePlaybackData(): PlaybackData {
  const audioService = useAudioService();
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
  const [hasQueue, setHasQueue] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [queueLength, setQueueLength] = useState(0);

  useEffect(() => {
    const unsubscribe = audioService.onStateChange((state) => {
      setPlaybackState(state.playbackState);
      setHasQueue(state.queue.length > 0);
      const sanitizedTrack = sanitizeTrackForRuntime(state.currentTrack);
      setCurrentTrack((previousTrack) =>
        isSameTrackRenderIdentity(previousTrack, sanitizedTrack) ? previousTrack : sanitizedTrack
      );
      setQueueLength(state.queue.length);
    });

    // 初始化
    const state = audioService.getState();
    setPlaybackState(state.playbackState);
    setHasQueue(state.queue.length > 0);
    setCurrentTrack(sanitizeTrackForRuntime(state.currentTrack));
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
