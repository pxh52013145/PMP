/**
 * 背景类型定义
 */

export type BackgroundType = 'color' | 'image' | 'video' | 'gradient' | 'html';

export interface BackgroundConfig {
  type: BackgroundType;
  // 纯色背景
  color?: string;
  // 渐变背景
  gradient?: {
    type: 'linear' | 'radial';
    colors: string[];
    angle?: number; // 线性渐变角度
  };
  // 图片背景
  image?: {
    url: string;
    fit: 'cover' | 'contain' | 'fill' | 'none';
    position: string; // 如 'center center'
    repeat: 'no-repeat' | 'repeat' | 'repeat-x' | 'repeat-y';
    opacity?: number;
  };
  // 视频背景（动态背景）
  video?: {
    url: string;
    fit: 'cover' | 'contain';
    loop: boolean;
    muted: boolean;
    opacity?: number;
  };
  // HTML 背景（自定义 HTML 内容）
  html?: {
    content: string;
    opacity?: number;
  };
  // 背景模糊效果
  blur?: number; // 0-20px
  // 整体透明度
  opacity?: number; // 0-1
}

// 背景设置（区分窗口模式和最大化模式）
export interface BackgroundSettings {
  // 最大化模式背景
  maximized: BackgroundConfig;
  // 窗口模式背景（默认透明）
  windowed: BackgroundConfig;
}

// 预设背景
export const PRESET_BACKGROUNDS: Record<string, BackgroundConfig> = {
  // 纯色
  black: {
    type: 'color',
    color: '#000000',
  },
  dark: {
    type: 'color',
    color: '#1a1a1a',
  },
  navy: {
    type: 'color',
    color: '#0a1628',
  },

  // 渐变
  'dark-gradient': {
    type: 'gradient',
    gradient: {
      type: 'linear',
      colors: ['#0f0c29', '#302b63', '#24243e'],
      angle: 135,
    },
  },
  'purple-gradient': {
    type: 'gradient',
    gradient: {
      type: 'linear',
      colors: ['#667eea', '#764ba2'],
      angle: 45,
    },
  },
  'blue-gradient': {
    type: 'gradient',
    gradient: {
      type: 'radial',
      colors: ['#667eea', '#0f0c29'],
    },
  },
};
