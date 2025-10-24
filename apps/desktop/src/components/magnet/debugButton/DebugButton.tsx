/**
 * DebugButton 主组件
 * 重构版本：三层分离架构（数据、交互、展示）
 */

import React from 'react';
import { useDebugButtonData } from './useDebugButtonData';
import { useDebugButtonLogic } from './useDebugButtonLogic';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { DebugButtonVariantProps } from './DebugButtonTypes';
import { StandardDebugButton } from './variants';

/**
 * 变体组件注册表
 */
const DEBUG_BUTTON_VARIANTS: Record<string, React.ComponentType<DebugButtonVariantProps>> = {
  standard: StandardDebugButton,
  default: StandardDebugButton,
};

/**
 * DebugButton 组件
 */
export const DebugButton: React.FC = () => {
  // Layer 1: 数据层
  const data = useDebugButtonData();

  // Layer 2: 交互逻辑层
  const logic = useDebugButtonLogic();

  // Layer 3: 主题配置
  const themeConfig = useComponentTheme('debug-button');

  // 选择变体组件
  const variant = themeConfig.variant || 'default';
  const VariantComponent = DEBUG_BUTTON_VARIANTS[variant] || StandardDebugButton;

  // 优先级：自定义渲染器 > 预设变体
  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic=logic} variantConfig={themeConfig.variantConfig} />;
  }

  // 使用预设变体
  return <VariantComponent data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
};
