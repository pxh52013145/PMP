/**
 * VolumeControl 组件专用类型定义
 */

import { VolumeData } from './useVolumeData';
import { VolumeLogic } from './useVolumeLogic';

/**
 * 变体组件的统一Props
 */
export interface VolumeVariantProps {
  data: VolumeData;
  logic: VolumeLogic;
  variantConfig?: any;
}
