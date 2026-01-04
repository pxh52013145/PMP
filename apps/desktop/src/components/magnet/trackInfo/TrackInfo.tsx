/**
 * TrackInfo 主组件
 * 重构版本：三层分离架构（数据、交互、展示）
 */

import React from 'react';
import { useTrackInfoData } from './useTrackInfoData';
import { useTrackInfoLogic } from './useTrackInfoLogic';
import { useDynamicColor } from './useDynamicColor';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { TrackInfoVariantProps } from './TrackInfoTypes';
import { SpinningVinylView, MinimalView, CardView } from './variants';

/**
 * 变体组件注册表
 */
const TRACK_INFO_VARIANTS: Record<string, React.ComponentType<TrackInfoVariantProps>> = {
  'spinning-vinyl': SpinningVinylView,
  default: SpinningVinylView, // 默认使用旋转唱片
  minimal: MinimalView,
  card: CardView,
};

/**
 * TrackInfo 组件
 */
export const TrackInfo: React.FC = () => {
  // Layer 1: 数据层
  const data = useTrackInfoData();

  // Layer 2: 交互层
  const logic = useTrackInfoLogic();

  // Layer 3: 主题配置
  const themeConfig = useComponentTheme('track-info');

  // 动态颜色提取
  const dynamicColorEnabled = themeConfig.dynamicColor?.extractFromCover !== false; // 默认启用
  const dynamicColors = useDynamicColor(data.track?.coverUrl, dynamicColorEnabled);
  const dynamicColorConfig = themeConfig.dynamicColor;

  // 选择变体组件
  const variant = themeConfig.variant || 'default';
  const VariantComponent = TRACK_INFO_VARIANTS[variant] || SpinningVinylView;

  // 优先级：自定义渲染器 > 预设变体
  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return (
      <CustomRenderer
        data={data}
        logic={logic}
        dynamicColors={dynamicColorEnabled ? dynamicColors : undefined}
        dynamicColorConfig={dynamicColorConfig}
        variantConfig={themeConfig.variantConfig}
      />
    );
  }

  // 使用预设变体
  return (
    <VariantComponent
      data={data}
      logic={logic}
      dynamicColors={dynamicColorEnabled ? dynamicColors : undefined}
      dynamicColorConfig={dynamicColorConfig}
      variantConfig={themeConfig.variantConfig}
    />
  );
};
