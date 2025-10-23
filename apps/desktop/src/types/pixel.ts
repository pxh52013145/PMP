/**
 * Pixel Dot 相关类型定义
 */

export type PixelShape = 'square' | 'circle' | 'triangle' | 'hexagon';

export interface PixelDot {
  x: number;
  y: number;
  color: string;
  shape: PixelShape;
  occupied: boolean;
  occupiedBy?: string;
  interactive: boolean;
}

export interface PixelMatrix {
  columns: number;
  rows: number;
  pixelSize: number;
  spacing: number;
  grid: PixelDot[][];
}

// ==================== Magnet 系统类型定义 ====================

/**
 * Magnet（磁性组件）类型
 * Magnet 通过"磁力吸附"到 Pixel 锚点上实现响应式定位
 */
export type MagnetType =
  | 'window-control' // 窗口控制按钮
  | 'playback-control' // 播放控制
  | 'track-info' // 歌曲信息
  | 'drag-handle' // 拖动手柄
  | 'visualizer' // 可视化器
  | 'search-bar' // 搜索栏
  | 'playlist' // 播放列表
  | 'progress-bar' // 进度条
  | 'player' // 播放器相关按钮
  | 'navigation' // 导航相关
  | 'custom'; // 自定义

/**
 * 锚点类型
 */
export type AnchorType = 'single' | 'horizontal' | 'vertical' | 'rectangular';

/**
 * Pixel 锚点
 * 用于将 Magnet 吸附到特定的 Pixel 位置
 */
export interface PixelAnchor {
  id: string; // 锚点标识（如 "top-left", "bottom-right"）
  gridX: number; // 网格列坐标（0-26）
  gridY: number; // 网格行坐标（0-19）
  role: 'anchor' | 'boundary'; // 定位锚点 或 边界锚点
}

/**
 * Magnet 样式配置
 */
export interface MagnetStyle {
  width?: string;
  height?: string;
  backgroundColor?: string;
  border?: string;
  borderRadius?: string;
  padding?: string;
  opacity?: number;
  backdropFilter?: string;
  boxShadow?: string;
  display?: string;
  alignItems?: string;
  justifyContent?: string;
  cursor?: string;
  overflow?: string;
  transform?: string;
  filter?: string;
  color?: string;
  fontSize?: string;
  fontWeight?: string;
  [key: string]: string | number | undefined;
}

/**
 * Magnet 动画配置
 * 用于定义不同状态下的样式变化
 */
export interface MagnetAnimation {
  // hover 状态样式（鼠标悬停）
  hoverStyle?: MagnetStyle;

  // active 状态样式（点击/按下）
  activeStyle?: MagnetStyle;

  // 过渡动画配置
  transition?: string; // 例如: "all 0.2s ease"
}

/**
 * Magnet 交互配置
 */
export interface MagnetInteractions {
  draggable: boolean;
  clickable: boolean;
  onDrag?: (anchors: PixelAnchor[]) => void;
  onClick?: () => void;
  onHover?: () => void;
}

/**
 * Magnet（磁性组件）
 * 核心设计：通过锚点（PixelAnchor）吸附到 Pixel 上，实现响应式布局
 */
export interface Magnet {
  id: string;
  type: MagnetType;
  name: string;

  // 锚点配置 - 核心设计
  anchors: PixelAnchor[];

  // 锚点类型（根据 anchors 数量自动推断）
  anchorType: AnchorType;
  // - single: 1个锚点（固定位置的小组件，如按钮）
  // - horizontal: 2个锚点（单行组件，如搜索栏）左端、右端
  // - vertical: 2个锚点（单列组件，如音量滑块）顶端、底端
  // - rectangular: 4个锚点（矩形组件，如播放列表）四个角

  // 内容配置
  content: React.ReactNode | string;

  // 样式配置（默认/空闲状态）
  style: MagnetStyle;

  // 动画配置（可选）
  animation?: MagnetAnimation;

  // 状态
  state: 'idle' | 'hover' | 'active' | 'disabled';

  // 交互
  interactions: MagnetInteractions;
}

// ==================== 向后兼容（已废弃） ====================

/**
 * @deprecated 使用 MagnetType 替代
 */
export type ComponentType = MagnetType;

/**
 * @deprecated 使用 Magnet 替代
 */
export interface Component {
  id: string;
  type: ComponentType;
  name: string;
  layout: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  cost: number;
  state: 'idle' | 'hover' | 'active' | 'disabled';
}
