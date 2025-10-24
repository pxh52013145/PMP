/**
 * PreviousButton 主组件
 * 重构版本：三层分离架构（数据、交互、展示）
 */

import React from 'react';
import { usePlaybackData } from './usePlaybackData';
import { usePlaybackLogic } from './usePlaybackLogic';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { PlaybackVariantProps } from './PlaybackTypes';
import { StandardPrevious } from './variants';

/**
 * 变体组件注册表
 */
const PREVIOUS_VARIANTS: Record<string, React.ComponentType<PlaybackVariantProps>> = {
  standard: StandardPrevious,
  default: StandardPrevious,
};

/**
 * PreviousButton 组件
 */
export const PreviousButton: React.FC = () => {
  // Layer 1: 数据层
  const data = usePlaybackData();

  // Layer 2: 交互逻辑层
  const logic = usePlaybackLogic();

  // Layer 3: 主题配置
  const themeConfig = useComponentTheme('previous-button');

  // 选择变体组件
  const variant = themeConfig.variant || 'default';
  const VariantComponent = PREVIOUS_VARIANTS[variant] || StandardPrevious;

  // 优先级：自定义渲染器 > 预设变体
  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
  }

  // 使用预设变体
  return <VariantComponent data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
};
