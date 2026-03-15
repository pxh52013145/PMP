/**
 * MusicLibraryButton 组件专用类型定义
 */

import { MusicLibraryData } from './useMusicLibraryData';
import { MusicLibraryLogic } from './useMusicLibraryLogic';

/**
 * 变体组件的统一Props
 */
export interface MusicLibraryVariantProps {
  data: MusicLibraryData;
  logic: MusicLibraryLogic;
  variantConfig?: Record<string, unknown>;
}
