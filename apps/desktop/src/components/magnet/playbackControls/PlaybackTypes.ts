/**
 * PlaybackControls 组件专用类型定义
 */

import { PlaybackData } from './usePlaybackData';
import { PlaybackLogic } from './usePlaybackLogic';

/**
 * 变体组件的统一Props
 */
export interface PlaybackVariantProps {
  data: PlaybackData;
  logic: PlaybackLogic;
  variantConfig?: unknown;
}
