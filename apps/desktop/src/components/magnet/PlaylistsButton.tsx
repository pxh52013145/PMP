/**
 * 歌单管理按钮组件
 * 点击显示歌单管理界面
 */

import React, { useState } from 'react';
import { Playlists } from './Playlists';
import './PlaylistsButton.css';

export const PlaylistsButton: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        className="playlists-button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(true);
        }}
        title="歌单"
      >
        <span className="playlists-icon">♬</span>
      </button>
      <Playlists isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
};
