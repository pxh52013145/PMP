import { NavigationPageData as NavigationState, NavigationPageType } from '../../../contexts/NavigationContext';
import { Track } from '../../../services/audio';

export interface NavigationPageDataProps {
  currentPage: NavigationState;
}

export interface NavigationPageLogic {
  handlePlayNow: (tracks: Track[], startIndex?: number) => Promise<void>;
  handleAddToQueue: (tracks: Track[]) => void;
  getPageTitle: (type: NavigationPageType) => string;
}

export interface NavigationPageVariantProps {
  data: NavigationPageDataProps;
  logic: NavigationPageLogic;
  variantConfig?: Record<string, unknown>;
}
