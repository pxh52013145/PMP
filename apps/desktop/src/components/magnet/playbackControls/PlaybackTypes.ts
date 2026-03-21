/**
 * PlaybackControls 组件专用类型定义
 */

import { PlaybackData } from './usePlaybackData';
import { PlaybackLogic } from './usePlaybackLogic';
import type { DynamicColors } from '../shared/useDynamicColor';
import type { DynamicColorConfig } from '../../../themes/types/theme';

/**
 * 变体组件的统一Props
 */
export interface PlaybackVariantProps {
  data: PlaybackData;
  logic: PlaybackLogic;
  dynamicColors?: DynamicColors;
  dynamicColorConfig?: DynamicColorConfig;
  skinProps?: Record<string, unknown>;
}

