import { NavigationPageData as NavigationState } from '../../../contexts/NavigationContext';
import type { Track } from '../../../services/audio';

export interface NavigationPageDataProps {
  currentPage: NavigationState;
}

export interface NavigationPageLogic {
  handlePlayNow: (tracks: Track[], startIndex?: number) => Promise<void>;
  handleAddToQueue: (tracks: Track[]) => void;
}

export interface NavigationPageVariantProps {
  data: NavigationPageDataProps;
  logic: NavigationPageLogic;
  variantConfig?: Record<string, unknown>;
}
