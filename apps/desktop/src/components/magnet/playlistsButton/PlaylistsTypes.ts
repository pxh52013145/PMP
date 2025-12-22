/**
 * PlaylistsButton 组件专用类型定义
 */

import { PlaylistsData } from './usePlaylistsData';
import { PlaylistsLogic } from './usePlaylistsLogic';

/**
 * 变体组件的统一Props
 */
export interface PlaylistsVariantProps {
  data: PlaylistsData;
  logic: PlaylistsLogic;
  variantConfig?: unknown;
}
