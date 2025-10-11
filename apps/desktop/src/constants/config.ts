/**
 * Pixel Matrix 配置常量
 */

export const MATRIX_CONFIG = {
  COLUMNS: 27,
  ROWS: 20,
  PIXEL_SIZE: 18, // px - 像素点的直径（圆形），固定不变
  EDGE_PADDING: 20, // px - 边缘留白距离
} as const;

export const WINDOW_CONFIG = {
  // 默认窗口尺寸
  WIDTH: 972, // 默认宽度
  HEIGHT: 720, // 默认高度

  // 最小窗口尺寸 = 所有像素点无间隔排列 + 两侧边距
  MIN_WIDTH: MATRIX_CONFIG.COLUMNS * MATRIX_CONFIG.PIXEL_SIZE + MATRIX_CONFIG.EDGE_PADDING * 2, // 27*18 + 40 = 526px
  MIN_HEIGHT: MATRIX_CONFIG.ROWS * MATRIX_CONFIG.PIXEL_SIZE + MATRIX_CONFIG.EDGE_PADDING * 2, // 20*18 + 40 = 400px
} as const;

export const PIXEL_COLORS = {
  DEFAULT: 0x808080, // 灰色，默认状态
  PRIMARY: 0x00ff88, // 亮绿色
  SECONDARY: 0x8800ff, // 紫色
  ACCENT: 0xff0088, // 粉红色
  OCCUPIED: 0x666666, // 深灰色
} as const;
