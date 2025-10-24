/**
 * TrackInfo 交互层 Hook
 * 负责所有交互逻辑
 */

import { useCallback } from 'react';
import { audioService } from '../../../services/audio';
import { useNavigation } from '../../../contexts/NavigationContext';
import { Track } from '../../../services/audio';

export interface TrackInfoLogic {
  onPlay: () => void;
  onPause: () => void;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onNavigateToTrack: (track: Track) => void;
}

/**
 * 获取TrackInfo的交互逻辑
 */
export function useTrackInfoLogic(): TrackInfoLogic {
  const { navigateTo } = useNavigation();

  const onPlay = useCallback(() => {
    audioService.play();
  }, []);

  const onPause = useCallback(() => {
    audioService.pause();
  }, []);

  const onTogglePlay = useCallback(() => {
    audioService.togglePlayPause();
  }, []);

  const onSeek = useCallback((time: number) => {
    audioService.seek(time);
  }, []);

  const onNavigateToTrack = useCallback(
    (track: Track) => {
      navigateTo('track', { track });
    },
    [navigateTo]
  );

  return {
    onPlay,
    onPause,
    onTogglePlay,
    onSeek,
    onNavigateToTrack,
  };
}
