/**
 * ProgressBar 交互层 Hook
 * 负责所有交互逻辑（点击、拖动）
 */

import { useCallback, useEffect, useState } from 'react';
import { useAudioService } from '../../../contexts/AudioEngineContext';

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
  const audioService = useAudioService();
  const [isSeeking, setIsSeeking] = useState(false);

  // Safety net: pointer capture can occasionally be lost without our handlers firing.
  // Ensure we always exit seeking mode on global pointer end/cancel/blur.
  useEffect(() => {
    if (!isSeeking) return;

    const end = () => setIsSeeking(false);
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    window.addEventListener('blur', end);

    return () => {
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      window.removeEventListener('blur', end);
    };
  }, [isSeeking]);

  const onSeek = useCallback(
    (time: number) => {
      audioService.seek(time);
    },
    [audioService]
  );

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
