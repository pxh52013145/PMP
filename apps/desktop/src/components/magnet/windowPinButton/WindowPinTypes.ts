/**
 * WindowPinButton 类型定义
 */

/**
 * WindowPin 数据层接口
 */
export interface WindowPinData {
  isPinned: boolean;
}

/**
 * WindowPin 逻辑层接口
 */
export interface WindowPinLogic {
  togglePin: (e: React.MouseEvent) => Promise<void>;
  getButtonTitle: (isPinned: boolean) => string;
}

/**
 * WindowPin 变体组件 Props
 */
export interface WindowPinVariantProps {
  data: WindowPinData;
  logic: WindowPinLogic;
  variantConfig?: Record<string, unknown>;
}
