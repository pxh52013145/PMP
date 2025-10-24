/**
 * ProgressBar 组件专用类型定义
 */

import { ProgressBarData } from './useProgressBarData';
import { ProgressBarLogic } from './useProgressBarLogic';

/**
 * 变体组件的统一Props
 */
export interface ProgressBarVariantProps {
  data: ProgressBarData;
  logic: ProgressBarLogic;
  variantConfig?: any;
}

