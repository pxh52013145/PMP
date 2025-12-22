/**
 * ProgressBar 组件专用类型定义
 */

import { ProgressBarData } from './useProgressBarData';
import { ProgressBarLogic } from './useProgressBarLogic';
import { DynamicColors } from '../trackInfo/useDynamicColor';

/**
 * 变体组件的统一Props
 */
export interface ProgressBarVariantProps {
  data: ProgressBarData;
  logic: ProgressBarLogic;
  dynamicColors?: DynamicColors;
  variantConfig?: unknown;
}
