/**
 * Magnet 编辑器相关类型定义
 */

import { Magnet } from './pixel';

/**
 * 编辑模式
 */
export type EditorMode = 'view' | 'edit' | 'select' | 'drag';

/**
 * 编辑器状态
 */
export interface EditorState {
  mode: EditorMode;
  isEditing: boolean;
  selectedMagnetId: string | null;
  selectedPixels: Set<string>; // "x,y" 格式
  isDragging: boolean;
  dragStartPixel: { x: number; y: number } | null;
  dragEndPixel: { x: number; y: number } | null;
  hoverPixel: { x: number; y: number } | null;
}

/**
 * Pixel 占用信息
 */
export interface PixelOccupancy {
  pixel: { x: number; y: number };
  isOccupied: boolean;
  occupiedBy: string | null; // Magnet ID
  magnetType: string | null;
}

/**
 * Magnet 导入格式（JSON Schema）
 */
export interface MagnetImportSchema {
  id: string;
  type: string;
  name: string;
  anchorType: 'single' | 'horizontal' | 'vertical' | 'rectangular';
  anchors: Array<{
    id: string;
    gridX: number;
    gridY: number;
    role: 'anchor' | 'boundary';
  }>;
  content: string;
  style: {
    width?: string;
    height?: string;
    backgroundColor?: string;
    border?: string;
    borderRadius?: string;
    [key: string]: string | undefined;
  };
  interactions: {
    draggable: boolean;
    clickable: boolean;
  };
}

/**
 * Magnet 验证结果
 */
export interface MagnetValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  magnet?: Magnet;
}

/**
 * 拖拽移动结果
 */
export interface DragMoveResult {
  success: boolean;
  newAnchors: Array<{
    id: string;
    gridX: number;
    gridY: number;
    role: 'anchor' | 'boundary';
  }>;
  message?: string;
}

/**
 * 空闲区域查找结果
 */
export interface FreeAreaResult {
  found: boolean;
  position: { x: number; y: number } | null;
  area: Array<{ x: number; y: number }>;
}
