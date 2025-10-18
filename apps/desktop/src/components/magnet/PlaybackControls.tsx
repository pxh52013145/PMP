/**
 * 音乐播放器播放控制按钮组件
 * 包括播放/暂停、上一首、下一首等独立按钮
 */

import React, { useEffect, useState } from 'react';
import { audioService } from '../../services/audio';
import './PlaybackControls.css';

// 播放/暂停按钮
export const PlayPauseButton: React.FC = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = audioService.onStateChange((state) => {
      setIsPlaying(state.playbackState === 'playing');
      setIsLoading(state.playbackState === 'loading');
    });
    return unsubscribe;
  }, []);

  const handleClick = async () => {
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

  return (
    <button
      className="playback-btn play-pause-btn"
      onClick={handleClick}
      disabled={isLoading}
      title={isPlaying ? '暂停' : '播放'}
    >
      {isLoading ? '⏳' : isPlaying ? '⏸️' : '▶️'}
    </button>
  );
};

// 上一首按钮
export const PreviousButton: React.FC = () => {
  const [hasQueue, setHasQueue] = useState(false);

  useEffect(() => {
    const unsubscribe = audioService.onStateChange((state) => {
      setHasQueue(state.queue.length > 0);
    });
    return unsubscribe;
  }, []);

  const handleClick = () => {
    audioService.playPrevious();
  };

  return (
    <button
      className="playback-btn previous-btn"
      onClick={handleClick}
      disabled={!hasQueue}
      title="上一首"
    >
      ⏮️
    </button>
  );
};

// 下一首按钮
export const NextButton: React.FC = () => {
  const [hasQueue, setHasQueue] = useState(false);

  useEffect(() => {
    const unsubscribe = audioService.onStateChange((state) => {
      setHasQueue(state.queue.length > 0);
    });
    return unsubscribe;
  }, []);

  const handleClick = () => {
    audioService.playNext();
  };

  return (
    <button
      className="playback-btn next-btn"
      onClick={handleClick}
      disabled={!hasQueue}
      title="下一首"
    >
      ⏭️
    </button>
  );
};
