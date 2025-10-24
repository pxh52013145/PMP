/**
 * BackButton 主组件
 * 重构版本：三层分离架构（数据、交互、展示）
 */

import React from 'react';
import { useBackButtonData } from './useBackButtonData';
import { useBackButtonLogic } from './useBackButtonLogic';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { BackButtonVariantProps } from './BackButtonTypes';
import { StandardBackButton } from './variants';

/**
 * 变体组件注册表
 */
const BACK_BUTTON_VARIANTS: Record<string, React.ComponentType<BackButtonVariantProps>> = {
  standard: StandardBackButton,
  default: StandardBackButton, // 默认使用标准样式
};

/**
 * BackButton 组件
 */
export const BackButton: React.FC = () => {
  // Layer 1: 数据层
  const data = useBackButtonData();

  // Layer 2: 交互逻辑层
  const logic = useBackButtonLogic();

  // Layer 3: 主题配置
  const themeConfig = useComponentTheme('back-button');

  // 选择变体组件
  const variant = themeConfig.variant || 'default';
  const VariantComponent = BACK_BUTTON_VARIANTS[variant] || StandardBackButton;

  // 优先级：自定义渲染器 > 预设变体
  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
  }

  // 使用预设变体
  return <VariantComponent data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
};
