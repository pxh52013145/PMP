/**
 * 歌单管理按钮组件
 * 点击显示歌单管理界面
 */

import React from 'react';
import './PlaylistsButton.css';

export const PlaylistsButton: React.FC = () => {
  const handleClick = () => {
    alert('歌单管理功能开发中...\n请暂时使用"音乐播放器模拟器"中的歌单功能');
  };

  return (
    <button className="playlists-button" onClick={handleClick} title="歌单">
      <span className="playlists-icon">🎼</span>
    </button>
  );
};
