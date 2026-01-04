/**
 * ProgressBar 主组件
 * 重构版本：三层分离架构（数据、交互、展示）
 */

import React from 'react';
import { useProgressBarLogic } from './useProgressBarLogic';
import { useProgressBarData } from './useProgressBarData';
import { useDynamicColor } from '../shared/useDynamicColor';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { ProgressBarVariantProps } from './ProgressBarTypes';
import { StandardProgressBar, MinimalProgressBar } from './variants';

/**
 * 变体组件注册表
 */
const PROGRESS_BAR_VARIANTS: Record<string, React.ComponentType<ProgressBarVariantProps>> = {
  standard: StandardProgressBar,
  default: StandardProgressBar, // 默认使用标准进度条
  minimal: MinimalProgressBar,
};

/**
 * ProgressBar 组件
 */
export const ProgressBar: React.FC = () => {
  // Layer 2: 交互层（先初始化，因为数据层需要isSeeking）
  const logic = useProgressBarLogic();

  // Layer 1: 数据层
  const data = useProgressBarData(logic.isSeeking);

  // Layer 3: 主题配置
  const themeConfig = useComponentTheme('progress-bar');

  // 动态颜色提取（复用TrackInfo的Hook）
  const dynamicColorEnabled = themeConfig.dynamicColor?.extractFromCover !== false; // 默认启用
  const dynamicColors = useDynamicColor(data.coverUrl, dynamicColorEnabled);
  const dynamicColorConfig = themeConfig.dynamicColor;

  // 选择变体组件
  const variant = themeConfig.variant || 'default';
  const VariantComponent = PROGRESS_BAR_VARIANTS[variant] || StandardProgressBar;

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
