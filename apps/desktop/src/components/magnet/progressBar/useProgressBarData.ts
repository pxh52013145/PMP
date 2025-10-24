/**
 * ProgressBar 数据层 Hook
 * 负责获取播放时间数据
 */

import { useState, useEffect } from 'react';
import { audioService } from '../../../services/audio';

export interface ProgressBarData {
  currentTime: number;
  duration: number;
  buffered: number; // 缓冲进度（未来可用）
}

/**
 * 获取ProgressBar的数据
 */
export function useProgressBarData(isSeeking: boolean): ProgressBarData {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);

  useEffect(() => {
    const unsubscribe = audioService.onStateChange((state) => {
      // 拖动时不更新 currentTime，避免跳跃
      if (!isSeeking) {
        setCurrentTime(state.currentTime);
      }
      setDuration(state.duration);
      // TODO: 获取缓冲进度
      // setBuffered(state.buffered);
    });

    // 初始化
    const state = audioService.getState();
    setCurrentTime(state.currentTime);
    setDuration(state.duration);

    return unsubscribe;
  }, [isSeeking]);

  return {
    currentTime,
    duration,
    buffered,
  };
}

