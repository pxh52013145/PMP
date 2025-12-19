/**
 * PlayModeButton 主组件
 * 重构版本：三层分离架构（数据、交互、展示）
 */

import React from 'react';
import { usePlayModeData } from './usePlayModeData';
import { usePlayModeLogic } from './usePlayModeLogic';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { PlayModeVariantProps } from './PlayModeTypes';
import { StandardPlayMode, MinimalPlayMode } from './variants';

/**
 * 变体组件注册表
 */
const PLAY_MODE_VARIANTS: Record<string, React.ComponentType<PlayModeVariantProps>> = {
  standard: StandardPlayMode,
  minimal: MinimalPlayMode,
  default: StandardPlayMode, // 默认使用标准样式
};

/**
 * PlayModeButton 组件
 */
export const PlayModeButton: React.FC = () => {
  // Layer 1: 数据层
  const data = usePlayModeData();

  // Layer 2: 交互逻辑层
  const logic = usePlayModeLogic();

  // Layer 3: 主题配置
  const themeConfig = useComponentTheme('btn-mode');

  // 选择变体组件
  const variant = themeConfig.variant || 'default';
  const VariantComponent = PLAY_MODE_VARIANTS[variant] || StandardPlayMode;

  // 优先级：自定义渲染器 > 预设变体
  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
  }

  // 使用预设变体
  return <VariantComponent data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
};
