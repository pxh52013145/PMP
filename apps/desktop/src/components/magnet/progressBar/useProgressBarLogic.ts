/**
 * ProgressBar 交互层 Hook
 * 负责所有交互逻辑（点击、拖动）
 */

import { useCallback, useRef, useState } from 'react';
import { audioService } from '../../../services/audio';

export interface ProgressBarLogic {
  isSeeking: boolean;
  onSeek: (time: number) => void;
  onSeekStart: () => void;
  onSeekEnd: () => void;
  formatTime: (seconds: number) => string;
}

/**
 * 获取ProgressBar的交互逻辑
 */
export function useProgressBarLogic(): ProgressBarLogic {
  const [isSeeking, setIsSeeking] = useState(false);

  const onSeek = useCallback((time: number) => {
    audioService.seek(time);
  }, []);

  const onSeekStart = useCallback(() => {
    setIsSeeking(true);
  }, []);

  const onSeekEnd = useCallback(() => {
    setIsSeeking(false);
  }, []);

  const formatTime = useCallback((seconds: number): string => {
    if (!seconds || !isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  return {
    isSeeking,
    onSeek,
    onSeekStart,
    onSeekEnd,
    formatTime,
  };
}

