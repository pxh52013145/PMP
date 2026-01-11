/**
 * TrackInfo 数据层 Hook
 * 负责获取歌曲数据和播放状态
 */

import { useEffect, useMemo, useState } from 'react';
import { Track } from '../../../services/audio';
import { useAudioService } from '../../../contexts/AudioEngineContext';
import { useCoverUrlForTrack } from '../shared/useCoverUrlForTrack';

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
  const audioService = useAudioService();
  const [baseTrack, setBaseTrack] = useState<Track | null>(null);
  const coverUrl = useCoverUrlForTrack(baseTrack);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const unsubscribe = audioService.onStateChange((state) => {
      setBaseTrack(state.currentTrack);
      setIsPlaying(state.playbackState === 'playing');
      setCurrentTime(state.currentTime);
      setDuration(state.duration);
    });

    // 初始化
    const state = audioService.getState();
    setBaseTrack(state.currentTrack);
    setIsPlaying(state.playbackState === 'playing');
    setCurrentTime(state.currentTime);
    setDuration(state.duration);

    return unsubscribe;
  }, [audioService]);

  const track = useMemo(() => {
    if (!baseTrack) return null;
    if (!coverUrl) return baseTrack;
    if (baseTrack.coverUrl === coverUrl) return baseTrack;
    return { ...baseTrack, coverUrl };
  }, [baseTrack, coverUrl]);

  return {
    track,
    isPlaying,
    currentTime,
    duration,
  };
}
