/**
 * ProgressBar 组件专用类型定义
 */

import { ProgressBarData } from './useProgressBarData';
import { ProgressBarLogic } from './useProgressBarLogic';
import type { DynamicColors } from '../shared/useDynamicColor';
import type { DynamicColorConfig } from '../../../themes/types/theme';

/**
 * 变体组件的统一Props
 */
export interface ProgressBarVariantProps {
  data: ProgressBarData;
  logic: ProgressBarLogic;
  dynamicColors?: DynamicColors;
  dynamicColorConfig?: DynamicColorConfig;
  variantConfig?: Record<string, unknown>;
}
