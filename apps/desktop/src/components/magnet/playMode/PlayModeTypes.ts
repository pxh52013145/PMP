/**
 * PlayModeButton 组件专用类型定义
 */

import { PlayModeData } from './usePlayModeData';
import { PlayModeLogic } from './usePlayModeLogic';

/**
 * 变体组件的统一Props
 */
export interface PlayModeVariantProps {
  data: PlayModeData;
  logic: PlayModeLogic;
  variantConfig?: any;
}
