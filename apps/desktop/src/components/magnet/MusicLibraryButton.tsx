/**
 * 音乐库按钮组件
 * 点击显示音乐库管理界面
 */

import React from 'react';
import './MusicLibraryButton.css';

export const MusicLibraryButton: React.FC = () => {
  const handleClick = () => {
    alert('音乐库管理功能开发中...\n请暂时使用"音乐播放器模拟器"中的音乐库功能');
  };

  return (
    <button className="music-library-button" onClick={handleClick} title="音乐库">
      <span className="music-library-icon">🎵</span>
    </button>
  );
};
