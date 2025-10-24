/**
 * TrackInfo 数据层 Hook
 * 负责获取歌曲数据和播放状态
 */

import { useState, useEffect } from 'react';
import { audioService, Track } from '../../../services/audio';

export interface TrackInfoData {
  track: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

/**
 * 获取TrackInfo的数据
 */
export function useTrackInfoData(): TrackInfoData {
  const [track, setTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const unsubscribe = audioService.onStateChange((state) => {
      setTrack(state.currentTrack);
      setIsPlaying(state.playbackState === 'playing');
      setCurrentTime(state.currentTime);
      setDuration(state.duration);
    });

    // 初始化
    const state = audioService.getState();
    setTrack(state.currentTrack);
    setIsPlaying(state.playbackState === 'playing');
    setCurrentTime(state.currentTime);
    setDuration(state.duration);

    return unsubscribe;
  }, []);

  return {
    track,
    isPlaying,
    currentTime,
    duration,
  };
}
