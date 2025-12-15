/**
 * VolumeControl 数据层 Hook
 * 负责获取和监听音量数据
 */

import { useState, useEffect } from 'react';
import { useAudioService } from '../../../contexts/AudioEngineContext';

export interface VolumeData {
  volume: number;
  muted: boolean;
}

/**
 * 获取VolumeControl的数据
 */
export function useVolumeData(): VolumeData {
  const audioService = useAudioService();
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const unsubscribe = audioService.onStateChange((state) => {
      setVolume(state.volume);
      setMuted(state.muted);
    });

    // 初始化
    const state = audioService.getState();
    setVolume(state.volume);
    setMuted(state.muted);

    return unsubscribe;
  }, [audioService]);

  return {
    volume,
    muted,
  };
}
