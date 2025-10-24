/**
 * PlaylistsButton 逻辑层 Hook
 * 负责歌单弹窗控制逻辑
 */

import { useState } from 'react';

export interface PlaylistsLogic {
  isOpen: boolean;
  openPlaylists: () => void;
  closePlaylists: () => void;
}

/**
 * PlaylistsButton的逻辑层
 */
export function usePlaylistsLogic(): PlaylistsLogic {
  const [isOpen, setIsOpen] = useState(false);

  const openPlaylists = () => {
    setIsOpen(true);
  };

  const closePlaylists = () => {
    setIsOpen(false);
  };

  return {
    isOpen,
    openPlaylists,
    closePlaylists,
  };
}
