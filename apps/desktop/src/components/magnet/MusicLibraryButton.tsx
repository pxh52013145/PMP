/**
 * 音乐库按钮组件
 * 点击导航到音乐库页面
 */

import React from 'react';
import { useNavigation } from '../../contexts/NavigationContext';
import './MusicLibraryButton.css';

export const MusicLibraryButton: React.FC = () => {
  const { navigateTo } = useNavigation();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    console.log('Music Library button clicked - navigating to music library');
    navigateTo('music-library');
  };

  return (
    <button className="music-library-button" onClick={handleClick} title="音乐库">
      <span className="music-library-icon">♪</span>
    </button>
  );
};
