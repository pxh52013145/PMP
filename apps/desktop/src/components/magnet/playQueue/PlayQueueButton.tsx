/**
 * PlayQueueButton 主组件
 * 重构版本：三层分离架构（数据、交互、展示）
 */

import React from 'react';
import { usePlayQueueData } from './usePlayQueueData';
import { usePlayQueueLogic } from './usePlayQueueLogic';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { PlayQueueVariantProps } from './PlayQueueTypes';
import { StandardPlayQueue } from './variants';

/**
 * 变体组件注册表
 */
const PLAY_QUEUE_VARIANTS: Record<string, React.ComponentType<PlayQueueVariantProps>> = {
  standard: StandardPlayQueue,
  default: StandardPlayQueue, // 默认使用标准样式
};

/**
 * PlayQueueButton 组件
 */
export const PlayQueueButton: React.FC = () => {
  // Layer 1: 数据层
  const data = usePlayQueueData();

  // Layer 2: 交互逻辑层
  const logic = usePlayQueueLogic();

  // Layer 3: 主题配置
  const themeConfig = useComponentTheme('btn-play-queue');

  // 选择变体组件
  const variant = themeConfig.variant || 'default';
  const VariantComponent = PLAY_QUEUE_VARIANTS[variant] || StandardPlayQueue;

  // 优先级：自定义渲染器 > 预设变体
  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
  }

  // 使用预设变体
  return <VariantComponent data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
};
