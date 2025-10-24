/**
 * 着色器系统类型定义
 * 参考命运2（Destiny 2）的着色器系统
 */

/**
 * 颜色槽位
 * 定义单个颜色槽位的不同状态
 */
export interface ColorSlot {
  base: string; // 基础颜色 (hex/rgb/hsl)
  hover?: string; // hover状态颜色
  active?: string; // active状态颜色
  disabled?: string; // disabled状态颜色
  opacity?: number; // 透明度 (0-1)
}

/**
 * 材质属性
 */
export interface MaterialProperties {
  metallic?: number; // 金属度 (0-1)
  roughness?: number; // 粗糙度 (0-1)
  glow?: number; // 发光强度 (0-1)
}

/**
 * 特殊效果
 */
export interface ShaderEffects {
  gradient?: boolean; // 是否使用渐变
  pattern?: 'dots' | 'stripes' | 'noise'; // 图案
  animation?: 'pulse' | 'wave' | 'none'; // 动画效果
}

/**
 * 着色器
 * 定义一组颜色槽位，可应用到任何组件
 */
export interface Shader {
  id: string;
  name: string;
  author?: string;
  description?: string;
  thumbnail?: string; // 预览图

  // 颜色槽位（命运2通常有4个槽位）
  colors: {
    primary: ColorSlot; // 主色
    secondary: ColorSlot; // 次要色
    accent: ColorSlot; // 强调色
    detail: ColorSlot; // 细节色
  };

  // 材质属性（可选）
  materials?: MaterialProperties;

  // 特殊效果（可选）
  effects?: ShaderEffects;
}
