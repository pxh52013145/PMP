/**
 * MusicLibraryButton 主组件
 * 重构版本：三层分离架构（数据、交互、展示）
 */

import React from 'react';
import { useMusicLibraryData } from './useMusicLibraryData';
import { useMusicLibraryLogic } from './useMusicLibraryLogic';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { MusicLibraryVariantProps } from './MusicLibraryTypes';
import { StandardMusicLibrary } from './variants';

/**
 * 变体组件注册表
 */
const MUSIC_LIBRARY_VARIANTS: Record<string, React.ComponentType<MusicLibraryVariantProps>> = {
  standard: StandardMusicLibrary,
  default: StandardMusicLibrary, // 默认使用标准样式
};

/**
 * MusicLibraryButton 组件
 */
export const MusicLibraryButton: React.FC = () => {
  // Layer 1: 数据层
  const data = useMusicLibraryData();

  // Layer 2: 交互逻辑层
  const logic = useMusicLibraryLogic();

  // Layer 3: 主题配置
  const themeConfig = useComponentTheme('music-library-button');

  // 选择变体组件
  const variant = themeConfig.variant || 'default';
  const VariantComponent = MUSIC_LIBRARY_VARIANTS[variant] || StandardMusicLibrary;

  // 优先级：自定义渲染器 > 预设变体
  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
  }

  // 使用预设变体
  return <VariantComponent data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
};
