/**
 * PlaylistsButton 主组件
 * 重构版本：三层分离架构（数据、交互、展示）
 */

import React from 'react';
import { usePlaylistsData } from './usePlaylistsData';
import { usePlaylistsLogic } from './usePlaylistsLogic';
import { useComponentTheme } from '../../../themes/contexts/ThemeContextWithSync';
import { PlaylistsVariantProps } from './PlaylistsTypes';
import { StandardPlaylists } from './variants';

/**
 * 变体组件注册表
 */
const PLAYLISTS_VARIANTS: Record<string, React.ComponentType<PlaylistsVariantProps>> = {
  standard: StandardPlaylists,
  default: StandardPlaylists, // 默认使用标准样式
};

/**
 * PlaylistsButton 组件
 */
export const PlaylistsButton: React.FC = () => {
  // Layer 1: 数据层
  const data = usePlaylistsData();

  // Layer 2: 交互逻辑层
  const logic = usePlaylistsLogic();

  // Layer 3: 主题配置
  const themeConfig = useComponentTheme('btn-playlists');

  // 选择变体组件
  const variant = themeConfig.variant || 'default';
  const VariantComponent = PLAYLISTS_VARIANTS[variant] || StandardPlaylists;

  // 优先级：自定义渲染器 > 预设变体
  if (themeConfig.customRenderer) {
    const CustomRenderer = themeConfig.customRenderer;
    return <CustomRenderer data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
  }

  // 使用预设变体
  return <VariantComponent data={data} logic={logic} variantConfig={themeConfig.variantConfig} />;
};
