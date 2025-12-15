/**
 * BackButton 组件专用类型定义
 */

import { BackButtonData } from './useBackButtonData';
import { BackButtonLogic } from './useBackButtonLogic';

/**
 * 变体组件的统一Props
 */
export interface BackButtonVariantProps {
  data: BackButtonData;
  logic: BackButtonLogic;
  variantConfig?: any;
}
