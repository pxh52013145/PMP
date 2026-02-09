/**
 * 标准下一首按钮变体
 */

import React from 'react';
import { PlaybackVariantProps } from './PlaybackTypes';
import './StandardPlayback.css';

export const StandardNext: React.FC<PlaybackVariantProps> = ({ data, logic }) => {
  const { hasQueue } = data;
  const { playNext } = logic;

  return (
    <button
      className="playback-btn next-btn"
      onClick={playNext}
      disabled={!hasQueue}
      title="下一首"
    >
      ⟫
    </button>
  );
};
