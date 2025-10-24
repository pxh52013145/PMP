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
    console.log('Music Library button clicked - navigating to music library');
    navigateTo('music-library');
  };

  return {
    navigateToMusicLibrary,
  };
}
