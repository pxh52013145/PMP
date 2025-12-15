/**
 * 主题系统类型定义
 */

import { Shader } from './shader';
import { BackgroundConfig } from '../../types/background';

/**
 * 动态颜色配置
 * 用于TrackInfo等组件从封面提取颜色
 */
export interface DynamicColorConfig {
  // 是否从封面提取颜色
  extractFromCover?: boolean;

  // 提取后如何应用
  applyMode?: 'full' | 'glow-only' | 'blend' | 'none';

  // 混合比例（当mode为blend时）
  blendRatio?: number; // 0.0-1.0, 0=完全主题色, 1=完全提取色

  // 颜色调整
  colorAdjust?: {
    saturation?: number; // 饱和度调整 (0.5-2.0)
    brightness?: number; // 亮度调整 (0.5-2.0)
    hueShift?: number; // 色相偏移 (-180 to 180)
  };
}

/**
 * 组件主题配置
 */
export interface ComponentTheme {
  // 1. 预设变体选择
  variant?: string;

  // 2. 变体配置参数
  variantConfig?: {
    // 布局
    layout?: 'horizontal' | 'vertical' | 'compact' | 'full';

    // 动画
    animation?: {
      type: 'spin' | 'pulse' | 'glow' | 'float' | 'bounce' | 'none';
      speed?: number;
      intensity?: number;
    };

    // 封面样式（TrackInfo专用）
    coverStyle?: {
      shape: 'circle' | 'square' | 'rounded' | 'hexagon' | 'vinyl';
      size: 'small' | 'medium' | 'large' | 'auto';
      border?: boolean;
      shadow?: boolean;
      reflection?: boolean;
    };

    // 字体样式
    typography?: {
      titleFont?: string;
      titleSize?: string;
      titleWeight?: string | number;
      subtitleFont?: string;
      subtitleSize?: string;
    };

    // 特效
    effects?: {
      blur?: number;
      brightness?: number;
      saturation?: number;
      glow?: boolean;
      glitch?: boolean;
      scanlines?: boolean;
    };

    // 自定义参数
    [key: string]: any;
  };

  // 3. 渲染插槽
  slots?: {
    [slotName: string]: React.ComponentType<any>;
  };

  // 4. 完全自定义渲染器
  customRenderer?: React.ComponentType<any>;

  // 5. 样式覆盖（CSS-in-JS）
  styleOverride?: {
    container?: React.CSSProperties;
    cover?: React.CSSProperties;
    title?: React.CSSProperties;
    subtitle?: React.CSSProperties;
    [key: string]: React.CSSProperties | undefined;
  };

  // 6. CSS类名覆盖
  classNameOverride?: {
    container?: string;
    cover?: string;
    title?: string;
    subtitle?: string;
    [key: string]: string | undefined;
  };

  // 7. 动态颜色配置
  dynamicColor?: DynamicColorConfig;
}

/**
 * 主题
 * 完整的主题配置
 */
export interface Theme {
  id: string;
  name: string;
  author?: string;
  version: string;
  description?: string;
  thumbnail?: string;

  // 核心：使用的着色器
  shader: Shader;

  // Pixel系统配置
  pixel: {
    shape: 'circle' | 'square' | 'rounded-square' | 'diamond' | 'hexagon';
    size: number; // 0.5-1.0
    opacity: number; // 0.0-1.0

    // Pixel使用着色器的哪些颜色
    colors: {
      default: { slot: 'primary' | 'secondary' | 'accent' | 'detail'; alpha?: number };
      hover: { slot: 'primary' | 'secondary' | 'accent' | 'detail'; state?: 'hover' };
      active: { slot: 'primary' | 'secondary' | 'accent' | 'detail'; state?: 'active' };
      occupied: { slot: 'primary' | 'secondary' | 'accent' | 'detail'; alpha?: number };
    };
  };

  // 背景配置
  background: {
    maximized: BackgroundConfig;
    windowed: BackgroundConfig;
  };

  // 全局字体配置
  fonts: {
    primary: string;
    secondary?: string;
    mono?: string;
  };

  // 全局效果
  globalEffects?: {
    blur?: number;
    brightness?: number;
    contrast?: number;
    saturation?: number;
  };

  // 组件主题化配置
  componentThemes?: {
    [componentId: string]: ComponentTheme;
  };
}
