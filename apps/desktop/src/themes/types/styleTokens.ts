/**
 * 样式令牌类型定义
 * 组件样式的抽象表示，分离颜色和非颜色属性
 */

/**
 * 样式令牌
 * 将组件样式分为不同类别，便于主题化
 */
export interface StyleTokens {
  // 颜色相关（会被着色器影响）
  colors: {
    background?: string;
    foreground?: string;
    border?: string;
    accent?: string;
    text?: string;
    icon?: string;
    [key: string]: string | undefined;
  };

  // 布局和几何（不受着色器影响）
  layout: {
    width?: string;
    height?: string;
    padding?: string;
    margin?: string;
    gap?: string;
  };

  // 视觉效果（部分受着色器影响）
  effects: {
    borderRadius?: string;
    boxShadow?: string;
    backdropFilter?: string;
    opacity?: number;
    transform?: string;
  };

  // 排版（不受着色器影响）
  typography: {
    fontSize?: string;
    fontWeight?: string | number;
    lineHeight?: string;
    letterSpacing?: string;
  };
}
