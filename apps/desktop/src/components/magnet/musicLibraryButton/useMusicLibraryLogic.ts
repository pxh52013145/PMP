/**
 * MusicLibraryButton 逻辑层 Hook
 * 负责导航逻辑
 */

import { useNavigation } from '../../../contexts/NavigationContext';

export interface MusicLibraryLogic {
  navigateToMusicLibrary: () => void;
}

/**
 * MusicLibraryButton的逻辑层
 */
export function useMusicLibraryLogic(): MusicLibraryLogic {
  const { navigateTo } = useNavigation();

  const navigateToMusicLibrary = () => {
    navigateTo('music-library');
  };

  return {
    navigateToMusicLibrary,
  };
}
