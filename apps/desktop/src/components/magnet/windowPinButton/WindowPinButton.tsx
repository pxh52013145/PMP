/**
 * WindowPinButton 主组件
 * 重构版本：三层分离架构（数据、交互、展示）
 */

import React from 'react';
import { useWindowPinData } from './useWindowPinData';
import { useWindowPinLogic } from './useWindowPinLogic';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { WindowPinVariantProps } from './WindowPinTypes';
import { StandardWindowPin } from './variants';

/**
 * 变体组件注册表
 */
const WINDOW_PIN_VARIANTS: Record<string, React.ComponentType<WindowPinVariantProps>> = {
  standard: StandardWindowPin,
  default: StandardWindowPin,
};

/**
 * WindowPinButton 组件
 */
export const WindowPinButton: React.FC = () => {
  // Layer 1: 数据层
  const data = useWindowPinData();

  // Layer 2: 交互逻辑层
  const logic = useWindowPinLogic();

  // Layer 3: 主题配置
  const themeConfig = useComponentTheme('btn-window-pin');

  // 选择变体组件
  const variant = themeConfig.variant || 'default';
  const VariantComponent = WINDOW_PIN_VARIANTS[variant] || StandardWindowPin;

  // 优先级：自定义渲染器 > 预设变体
  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
  }

  // 使用预设变体
  return <VariantComponent data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
};
