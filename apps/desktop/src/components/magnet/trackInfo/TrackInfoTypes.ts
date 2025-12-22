/**
 * TrackInfo 组件专用类型定义
 */

import { TrackInfoData } from './useTrackInfoData';
import { TrackInfoLogic } from './useTrackInfoLogic';
import { DynamicColors } from './useDynamicColor';

/**
 * 变体组件的统一Props
 */
export interface TrackInfoVariantProps {
  data: TrackInfoData;
  logic: TrackInfoLogic;
  dynamicColors?: DynamicColors;
  variantConfig?: unknown;
}
