/**
 * ProgressBar 数据层 Hook
 * 负责获取播放时间数据
 */

import { useState, useEffect } from 'react';
import { useAudioService } from '../../../contexts/AudioEngineContext';

export interface ProgressBarData {
  currentTime: number;
  duration: number;
  buffered: number; // 缓冲进度（未来可用）
  coverUrl?: string; // 封面URL，用于提取颜色
}

/**
 * 获取ProgressBar的数据
 */
export function useProgressBarData(isSeeking: boolean): ProgressBarData {
  const audioService = useAudioService();
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const buffered = 0;
  const [coverUrl, setCoverUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = audioService.onStateChange((state) => {
      // 拖动时不更新 currentTime，避免跳跃
      if (!isSeeking) {
        setCurrentTime(state.currentTime);
      }
      setDuration(state.duration);
      setCoverUrl(state.currentTrack?.coverUrl);
      // TODO: 获取缓冲进度
      // setBuffered(state.buffered);
    });

    // 初始化
    const state = audioService.getState();
    setCurrentTime(state.currentTime);
    setDuration(state.duration);
    setCoverUrl(state.currentTrack?.coverUrl);

    return unsubscribe;
  }, [audioService, isSeeking]);

  return {
    currentTime,
    duration,
    buffered,
    coverUrl,
  };
}

