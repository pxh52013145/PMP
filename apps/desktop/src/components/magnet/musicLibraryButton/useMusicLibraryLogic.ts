/**
 * MusicLibraryButton 逻辑层 Hook
 * 负责导航逻辑
 */

import { useKernel } from '../../../contexts/KernelApiContext';
import { useNavigation } from '../../../contexts/NavigationContext';
import { COMMANDS_SERVICE_TOKEN, dispatchCommandOrFallback } from '../../../services/commands';

export interface MusicLibraryLogic {
  navigateToMusicLibrary: () => void;
}

/**
 * MusicLibraryButton的逻辑层
 */
export function useMusicLibraryLogic(): MusicLibraryLogic {
  const kernel = useKernel();
  const commands = kernel.services.getOptional(COMMANDS_SERVICE_TOKEN);
  const { navigateTo } = useNavigation();

  const navigateToMusicLibrary = () => {
    void dispatchCommandOrFallback(commands, 'app:navigate-music-library', () =>
      navigateTo('music-library')
    );
  };

  return {
    navigateToMusicLibrary,
  };
}
