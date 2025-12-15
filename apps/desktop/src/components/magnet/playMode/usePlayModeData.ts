/**
 * PlayModeButton 数据层 Hook
 * 负责获取和监听播放模式数据
 */

import { useState, useEffect } from 'react';
import { PlayMode } from '../../../services/audio';
import { useAudioService } from '../../../contexts/AudioEngineContext';

export interface PlayModeData {
  playMode: PlayMode;
}

/**
 * 获取PlayModeButton的数据
 */
export function usePlayModeData(): PlayModeData {
  const audioService = useAudioService();
  const [playMode, setPlayMode] = useState<PlayMode>('sequence');

  useEffect(() => {
    const unsubscribe = audioService.onStateChange((state) => {
      setPlayMode(state.playMode);
    });

    // 初始化
    setPlayMode(audioService.getState().playMode);

    return unsubscribe;
  }, [audioService]);

  return {
    playMode,
  };
}
