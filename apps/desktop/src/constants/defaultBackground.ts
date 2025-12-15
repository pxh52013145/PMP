import { BackgroundConfig, BackgroundSettings } from '../types/background';

/**
 * 默认背景配置
 * 用户可以通过设置修改
 */
export const DEFAULT_BACKGROUND: BackgroundConfig = {
  type: 'color',
  color: '#000000', // 默认黑色
  opacity: 1,
};

/**
 * 默认背景设置（区分窗口模式和最大化模式）
 */
export const DEFAULT_BACKGROUND_SETTINGS: BackgroundSettings = {
  // 最大化模式：黑色背景
  maximized: {
    type: 'color',
    color: '#000000',
    opacity: 1,
  },
  // 窗口模式：黑色背景
  windowed: {
    type: 'color',
    color: '#000000',
    opacity: 1,
  },
};

/**
 * 示例：深色渐变背景
 */
export const EXAMPLE_GRADIENT_BACKGROUND: BackgroundConfig = {
  type: 'gradient',
  gradient: {
    type: 'linear',
    colors: ['#0f0c29', '#302b63', '#24243e'],
    angle: 135,
  },
  opacity: 1,
};

/**
 * 示例：图片背景
 */
export const EXAMPLE_IMAGE_BACKGROUND: BackgroundConfig = {
  type: 'image',
  image: {
    url: 'https://example.com/background.jpg',
    fit: 'cover',
    position: 'center center',
    repeat: 'no-repeat',
    opacity: 0.8,
  },
  blur: 5, // 添加模糊效果
};

/**
 * 示例：视频背景
 */
export const EXAMPLE_VIDEO_BACKGROUND: BackgroundConfig = {
  type: 'video',
  video: {
    url: 'https://example.com/background.mp4',
    fit: 'cover',
    loop: true,
    muted: true,
    opacity: 0.6,
  },
};
