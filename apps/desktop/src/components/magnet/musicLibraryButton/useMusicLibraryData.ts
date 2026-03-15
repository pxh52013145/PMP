import { useNavigation } from '../../../contexts/NavigationContext';

export interface MusicLibraryData {
  isActive: boolean;
}

export function useMusicLibraryData(): MusicLibraryData {
  const navigation = useNavigation();
  return {
    isActive: navigation.currentPage.type === 'music-library',
  };
}
