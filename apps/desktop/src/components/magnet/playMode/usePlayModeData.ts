/**
 * PlayModeButton 数据层 Hook
 * 负责获取和监听播放模式数据
 */

import { useState, useEffect } from 'react';
import { audioService, PlayMode } from '../../../services/audio';

export interface PlayModeData {
  playMode: PlayMode;
}

/**
 * 获取PlayModeButton的数据
 */
export function usePlayModeData(): PlayModeData {
  const [playMode, setPlayMode] = useState<PlayMode>('sequence');

  useEffect(() => {
    const unsubscribe = audioService.onStateChange((state) => {
      setPlayMode(state.playMode);
    });

    // 初始化
    setPlayMode(audioService.getState().playMode);

    return unsubscribe;
  }, []);

  return {
    playMode,
  };
}
