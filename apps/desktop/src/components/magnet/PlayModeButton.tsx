/**
 * 播放模式按钮组件
 * 支持顺序播放、列表循环、单曲循环、随机播放
 */

import React, { useEffect, useState } from 'react';
import { audioService, PlayMode } from '../../services/audio';
import './PlayModeButton.css';

const PLAY_MODE_CONFIG: Record<PlayMode, { icon: string; text: string; next: PlayMode }> = {
  sequence: { icon: '→', text: '顺序播放', next: 'loop' },
  loop: { icon: '↻', text: '列表循环', next: 'single-loop' },
  'single-loop': { icon: '⟲', text: '单曲循环', next: 'shuffle' },
  shuffle: { icon: '⧢', text: '随机播放', next: 'sequence' },
};

export const PlayModeButton: React.FC = () => {
  const [playMode, setPlayMode] = useState<PlayMode>('sequence');

  useEffect(() => {
    const unsubscribe = audioService.onStateChange((state) => {
      setPlayMode(state.playMode);
    });

    // 初始化
    setPlayMode(audioService.getState().playMode);

    return unsubscribe;
  }, []);

  const handleClick = () => {
    const nextMode = PLAY_MODE_CONFIG[playMode].next;
    audioService.setPlayMode(nextMode);
  };

  const config = PLAY_MODE_CONFIG[playMode];

  return (
    <button className="play-mode-btn" onClick={handleClick} title={config.text}>
      {config.icon}
    </button>
  );
};
