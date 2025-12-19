/**
 * VolumeControl 主组件
 * 重构版本：三层分离架构（数据、交互、展示）
 */

import React from 'react';
import { useVolumeData } from './useVolumeData';
import { useVolumeLogic } from './useVolumeLogic';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { VolumeVariantProps } from './VolumeTypes';
import { StandardVolume, CyberEnergyVolume } from './variants';

/**
 * 变体组件注册表
 */
const VOLUME_VARIANTS: Record<string, React.ComponentType<VolumeVariantProps>> = {
  standard: StandardVolume,
  cyber: CyberEnergyVolume,
  default: StandardVolume, // 默认使用标准样式
};

/**
 * VolumeControl 组件
 */
export const VolumeControl: React.FC = () => {
  // Layer 1: 数据层
  const data = useVolumeData();

  // Layer 2: 交互逻辑层
  const logic = useVolumeLogic();

  // Layer 3: 主题配置
  const themeConfig = useComponentTheme('btn-volume');

  // 选择变体组件
  const variant = themeConfig.variant || 'default';
  const VariantComponent = VOLUME_VARIANTS[variant] || StandardVolume;

  // 优先级：自定义渲染器 > 预设变体
  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
  }

  // 使用预设变体
  return <VariantComponent data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
};
