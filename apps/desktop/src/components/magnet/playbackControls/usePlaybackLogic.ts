/**
 * PlaybackControls 逻辑层 Hook
 * 负责播放控制逻辑
 */

import { PlaybackState } from '../../../services/audio';
import { useAudioService } from '../../../contexts/AudioEngineContext';

export interface PlaybackLogic {
  // 播放控制
  togglePlayPause: () => Promise<void>;
  playPrevious: () => void;
  playNext: () => void;

  // UI辅助
  getPlayPauseIcon: (playbackState: PlaybackState) => string;
  getPlayPauseTitle: (playbackState: PlaybackState) => string;
  isPlayPauseDisabled: (playbackState: PlaybackState) => boolean;
}

/**
 * PlaybackControls的逻辑层
 */
export function usePlaybackLogic(): PlaybackLogic {
  const audioService = useAudioService();
  const togglePlayPause = async () => {
    const state = audioService.getState();
    if (state.playbackState === 'playing') {
      audioService.pause();
    } else if (state.currentTrack || state.queue.length > 0) {
      if (!state.currentTrack && state.queue.length > 0) {
        await audioService.playTrackAtIndex(0);
      } else {
        await audioService.play();
      }
    }
  };

  const playPrevious = () => {
    audioService.playPrevious();
  };

  const playNext = () => {
    audioService.playNext();
  };

  const getPlayPauseIcon = (playbackState: PlaybackState): string => {
    switch (playbackState) {
      case 'loading':
        return '○';
      case 'playing':
        return '⏸';
      default:
        return '▶';
    }
  };

  const getPlayPauseTitle = (playbackState: PlaybackState): string => {
    return playbackState === 'playing' ? '暂停' : '播放';
  };

  const isPlayPauseDisabled = (playbackState: PlaybackState): boolean => {
    return playbackState === 'loading';
  };

  return {
    togglePlayPause,
    playPrevious,
    playNext,
    getPlayPauseIcon,
    getPlayPauseTitle,
    isPlayPauseDisabled,
  };
}
