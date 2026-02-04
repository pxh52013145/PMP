/**
 * TrackInfo 交互层 Hook
 * 负责所有交互逻辑
 */

import { useCallback } from 'react';
import { useAudioService } from '../../../contexts/AudioEngineContext';
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
  const audioService = useAudioService();
  const { navigateTo } = useNavigation();

  const onPlay = useCallback(() => {
    audioService.play();
  }, [audioService]);

  const onPause = useCallback(() => {
    audioService.pause();
  }, [audioService]);

  const onTogglePlay = useCallback(() => {
    const state = audioService.getState();
    if (state.playbackState === 'playing' || state.playbackState === 'buffering') {
      audioService.pause();
      return;
    }

    if (!state.currentTrack && state.queue.length > 0) {
      void audioService.playTrackAtIndex(0);
    } else {
      void audioService.play();
    }
  }, [audioService]);

  const onSeek = useCallback(
    (time: number) => {
      audioService.seek(time);
    },
    [audioService]
  );

  const onNavigateToTrack = useCallback(
    (_track: Track) => {
      navigateTo('track');
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
