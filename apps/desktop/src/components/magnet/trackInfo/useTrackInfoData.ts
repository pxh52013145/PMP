/**
 * TrackInfo 数据层 Hook
 * 负责获取歌曲数据和播放状态
 */

import { useEffect, useMemo, useState } from 'react';
import { Track } from '../../../services/audio';
import { useAudioService } from '../../../contexts/AudioEngineContext';
import { musicLibraryService } from '../../../services/audio/MusicLibraryService';

export interface TrackInfoData {
  track: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

function trackKey(track: Track | null): string {
  if (!track) return 'none';
  return (
    track.id ||
    track.filePath ||
    track.path ||
    track.originalPath ||
    `${track.title}::${track.artist || ''}`
  );
}

/**
 * 获取TrackInfo的数据
 */
export function useTrackInfoData(): TrackInfoData {
  const audioService = useAudioService();
  const [baseTrack, setBaseTrack] = useState<Track | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | undefined>(undefined);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const unsubscribe = audioService.onStateChange((state) => {
      setBaseTrack((prev) => {
        const next = state.currentTrack;
        if (trackKey(prev) !== trackKey(next)) {
          setCoverUrl(undefined);
        }
        return next;
      });
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

  useEffect(() => {
    let cancelled = false;
    const current = baseTrack;
    if (!current) return;

    void musicLibraryService.getCoverUrlForTrack(current).then((url) => {
      if (cancelled) return;
      if (!url) return;
      setCoverUrl(url);
    });

    return () => {
      cancelled = true;
    };
  }, [baseTrack]);

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
