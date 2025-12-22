/**
 * PlayQueueButton 组件专用类型定义
 */

import { PlayQueueData } from './usePlayQueueData';
import { PlayQueueLogic } from './usePlayQueueLogic';

/**
 * 变体组件的统一Props
 */
export interface PlayQueueVariantProps {
  data: PlayQueueData;
  logic: PlayQueueLogic;
  variantConfig?: unknown;
}
