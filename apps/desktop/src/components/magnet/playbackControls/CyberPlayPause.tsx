import React from 'react';
import { PlaybackVariantProps } from './PlaybackTypes';
import './CyberPlayback.css';

export const CyberPlayPause: React.FC<PlaybackVariantProps> = ({ data, logic }) => {
  const { playbackState } = data;
  const { togglePlayPause, getPlayPauseIcon, getPlayPauseTitle, isPlayPauseDisabled } = logic;

  return (
    <button
      className={`cyber-playback-btn cyber-play-pause-btn ${playbackState === 'playing' ? 'playing' : ''}`}
      onClick={togglePlayPause}
      disabled={isPlayPauseDisabled(playbackState)}
      title={getPlayPauseTitle(playbackState)}
    >
      {getPlayPauseIcon(playbackState)}
    </button>
  );
};
