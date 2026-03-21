/**
 * DebugButton 组件专用类型定义
 */

import { DebugButtonData } from './useDebugButtonData';
import { DebugButtonLogic } from './useDebugButtonLogic';

/**
 * 变体组件的统一Props
 */
export interface DebugButtonVariantProps {
  data: DebugButtonData & { setIsOpen: (value: boolean) => void };
  logic: DebugButtonLogic;
  skinProps?: Record<string, unknown>;
}
