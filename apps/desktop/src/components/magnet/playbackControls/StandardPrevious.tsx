/**
 * 标准上一首按钮变体
 */

import React from 'react';
import { PlaybackVariantProps } from './PlaybackTypes';
import './StandardPlayback.css';

export const StandardPrevious: React.FC<PlaybackVariantProps> = ({ data, logic }) => {
  const { hasQueue } = data;
  const { playPrevious } = logic;

  return (
    <button
      className="playback-btn previous-btn"
      onClick={playPrevious}
      disabled={!hasQueue}
      title="上一首"
    >
      ⟪
    </button>
  );
};
