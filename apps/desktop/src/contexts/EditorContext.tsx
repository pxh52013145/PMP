/**
 * Magnet 编辑器上下文
 */

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { Magnet } from '../types/pixel';
import { EditorState, PixelOccupancy, MagnetValidationResult } from '../types/editor';
import {
  calculatePixelOccupancy,
  validateMagnetImport,
  findFreeArea,
  calculateNewAnchors,
  checkMagnetCollision,
  getMagnetOccupiedPixels,
} from '../utils/magnetEditor';
import { STORAGE_KEYS, TAURI_EVENTS, broadcastDataUpdate } from '../utils/windowCommunication';

interface EditorContextType {
  editorState: EditorState;
  occupancyMap: Map<string, PixelOccupancy>;
  enterEditMode: () => void;
  exitEditMode: () => void;
  toggleEditMode: () => void;
  selectMagnet: (magnetId: string | null) => void;
  selectPixel: (x: number, y: number) => void;
  clearSelection: () => void;
  startDrag: (x: number, y: number) => void;
  updateDrag: (x: number, y: number) => void;
  endDrag: () => void;
  setHoverPixel: (x: number | null, y: number | null) => void;
  importMagnet: (data: unknown) => MagnetValidationResult;
  moveMagnet: (magnetId: string, deltaX: number, deltaY: number) => boolean;
  updateOccupancy: (magnets: Magnet[]) => void;
}

const EditorContext = createContext<EditorContextType | null>(null);

export function EditorProvider({ children, magnets }: { children: ReactNode; magnets: Magnet[] }) {
  const [editorState, setEditorState] = useState<EditorState>({
    mode: 'view',
    isEditing: false,
    selectedMagnetId: null,
    selectedPixels: new Set<string>(),
    isDragging: false,
    dragStartPixel: null,
    dragEndPixel: null,
    hoverPixel: null,
  });

  const [occupancyMap, setOccupancyMap] = useState<Map<string, PixelOccupancy>>(
    calculatePixelOccupancy(magnets)
  );

  // 监听 magnets 变化，更新 occupancyMap
  useEffect(() => {
    setOccupancyMap(calculatePixelOccupancy(magnets));
  }, [magnets]);

  // 同步 editorState 到其他窗口
  useEffect(() => {
    // 只同步跨窗口真正需要的字段，避免 hover/拖拽过程产生高频广播导致多窗口卡顿
    const serializableState = {
      mode: editorState.mode,
      isEditing: editorState.isEditing,
      selectedMagnetId: editorState.selectedMagnetId,
      selectedPixels: Array.from(editorState.selectedPixels),
    };

    // 同步到 localStorage 和广播事件
    void broadcastDataUpdate(
      STORAGE_KEYS.EDITOR_STATE,
      serializableState,
      TAURI_EVENTS.EDITOR_STATE_UPDATED
    );
  }, [
    editorState.mode,
    editorState.isEditing,
    editorState.selectedMagnetId,
    editorState.selectedPixels,
  ]);

  // 进入编辑模式
  const enterEditMode = useCallback(() => {
    setEditorState((prev) => ({
      ...prev,
      mode: 'edit',
      isEditing: true,
    }));
  }, []);

  // 退出编辑模式
  const exitEditMode = useCallback(() => {
    setEditorState({
      mode: 'view',
      isEditing: false,
      selectedMagnetId: null,
      selectedPixels: new Set<string>(),
      isDragging: false,
      dragStartPixel: null,
      dragEndPixel: null,
      hoverPixel: null,
    });
  }, []);

  // 切换编辑模式
  const toggleEditMode = useCallback(() => {
    setEditorState((prev) => {
      if (prev.isEditing) {
        return {
          mode: 'view',
          isEditing: false,
          selectedMagnetId: null,
          selectedPixels: new Set<string>(),
          isDragging: false,
          dragStartPixel: null,
          dragEndPixel: null,
          hoverPixel: null,
        };
      } else {
        return {
          ...prev,
          mode: 'edit',
          isEditing: true,
        };
      }
    });
  }, []);

  // 选中 Magnet
  const selectMagnet = useCallback(
    (magnetId: string | null) => {
      setEditorState((prev) => {
        if (!magnetId) {
          return {
            ...prev,
            selectedMagnetId: null,
            selectedPixels: new Set<string>(),
            mode: 'edit',
          };
        }

        // 找到magnet占用的所有pixels
        const magnetPixels = new Set<string>();
        occupancyMap.forEach((occupancy, key) => {
          if (occupancy.isOccupied && occupancy.occupiedBy === magnetId) {
            magnetPixels.add(key);
          }
        });

        return {
          ...prev,
          selectedMagnetId: magnetId,
          selectedPixels: magnetPixels,
          mode: 'drag',
        };
      });
    },
    [occupancyMap]
  );

  // 选中 Pixel
  const selectPixel = useCallback((x: number, y: number) => {
    setEditorState((prev) => {
      const key = `${x},${y}`;
      const newSelected = new Set(prev.selectedPixels);
      if (newSelected.has(key)) {
        newSelected.delete(key);
      } else {
        newSelected.add(key);
      }
      return {
        ...prev,
        selectedPixels: newSelected,
      };
    });
  }, []);

  // 清除选择
  const clearSelection = useCallback(() => {
    setEditorState((prev) => ({
      ...prev,
      selectedMagnetId: null,
      selectedPixels: new Set<string>(),
      mode: 'edit',
    }));
  }, []);

  // 开始拖拽
  const startDrag = useCallback((x: number, y: number) => {
    setEditorState((prev) => ({
      ...prev,
      isDragging: true,
      dragStartPixel: { x, y },
      dragEndPixel: { x, y },
      mode: 'select',
    }));
  }, []);

  // 更新拖拽
  const updateDrag = useCallback((x: number, y: number) => {
    setEditorState((prev) => {
      if (!prev.isDragging || !prev.dragStartPixel) return prev;
      return {
        ...prev,
        dragEndPixel: { x, y },
      };
    });
  }, []);

  // 结束拖拽
  const endDrag = useCallback(() => {
    setEditorState((prev) => {
      if (!prev.isDragging || !prev.dragStartPixel || !prev.dragEndPixel) {
        return {
          ...prev,
          isDragging: false,
          dragStartPixel: null,
          dragEndPixel: null,
          mode: 'edit',
        };
      }

      // 计算选中的区域
      const minX = Math.min(prev.dragStartPixel.x, prev.dragEndPixel.x);
      const maxX = Math.max(prev.dragStartPixel.x, prev.dragEndPixel.x);
      const minY = Math.min(prev.dragStartPixel.y, prev.dragEndPixel.y);
      const maxY = Math.max(prev.dragStartPixel.y, prev.dragEndPixel.y);

      const newSelected = new Set<string>();
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          newSelected.add(`${x},${y}`);
        }
      }

      return {
        ...prev,
        selectedPixels: newSelected,
        isDragging: false,
        dragStartPixel: null,
        dragEndPixel: null,
        mode: 'edit',
      };
    });
  }, []);

  // 设置悬停 Pixel
  const setHoverPixel = useCallback((x: number | null, y: number | null) => {
    setEditorState((prev) => ({
      ...prev,
      hoverPixel: x !== null && y !== null ? { x, y } : null,
    }));
  }, []);

  // 导入 Magnet
  const importMagnet = useCallback(
    (data: unknown): MagnetValidationResult => {
      const result = validateMagnetImport(data);
      if (!result.valid || !result.magnet) {
        return result;
      }

      // 检查是否与现有 Magnet 冲突
      const magnet = result.magnet;
      const occupiedPixels = getMagnetOccupiedPixels(magnet);
      const hasConflict = occupiedPixels.some((pixel) => {
        const key = `${pixel.x},${pixel.y}`;
        const occupancy = occupancyMap.get(key);
        return occupancy?.isOccupied;
      });

      if (hasConflict) {
        // 尝试自动查找空闲区域
        const size = calculateMagnetSize(magnet);
        const freeArea = findFreeArea(occupancyMap, size);

        if (!freeArea.found || !freeArea.position) {
          return {
            ...result,
            valid: false,
            errors: ['无法找到足够的空闲区域来放置 Magnet'],
          };
        }

        // 更新锚点到空闲位置
        const deltaX = freeArea.position.x - magnet.anchors[0].gridX;
        const deltaY = freeArea.position.y - magnet.anchors[0].gridY;
        magnet.anchors = calculateNewAnchors(magnet, deltaX, deltaY);

        result.warnings.push(
          `Magnet 已自动移动到空闲位置 (${freeArea.position.x}, ${freeArea.position.y})`
        );
      }

      return result;
    },
    [occupancyMap]
  );

  // 移动 Magnet
  const moveMagnet = useCallback(
    (magnetId: string, deltaX: number, deltaY: number): boolean => {
      const magnet = magnets.find((m) => m.id === magnetId);
      if (!magnet) return false;

      const newAnchors = calculateNewAnchors(magnet, deltaX, deltaY);
      const hasCollision = checkMagnetCollision(magnet, newAnchors, occupancyMap);

      return !hasCollision;
    },
    [magnets, occupancyMap]
  );

  // 更新占用信息
  const updateOccupancy = useCallback((newMagnets: Magnet[]) => {
    setOccupancyMap(calculatePixelOccupancy(newMagnets));
  }, []);

  const value: EditorContextType = {
    editorState,
    occupancyMap,
    enterEditMode,
    exitEditMode,
    toggleEditMode,
    selectMagnet,
    selectPixel,
    clearSelection,
    startDrag,
    updateDrag,
    endDrag,
    setHoverPixel,
    importMagnet,
    moveMagnet,
    updateOccupancy,
  };

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor(): EditorContextType {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error('useEditor must be used within EditorProvider');
  }
  return context;
}

/**
 * 辅助函数：计算 Magnet 尺寸
 */
function calculateMagnetSize(magnet: Magnet): { width: number; height: number } {
  switch (magnet.anchorType) {
    case 'single':
      return { width: 1, height: 1 };
    case 'horizontal': {
      const width = Math.abs(magnet.anchors[1].gridX - magnet.anchors[0].gridX) + 1;
      return { width, height: 1 };
    }
    case 'vertical': {
      const height = Math.abs(magnet.anchors[1].gridY - magnet.anchors[0].gridY) + 1;
      return { width: 1, height };
    }
    case 'rectangular': {
      const width = Math.abs(magnet.anchors[1].gridX - magnet.anchors[0].gridX) + 1;
      const height = Math.abs(magnet.anchors[2].gridY - magnet.anchors[0].gridY) + 1;
      return { width, height };
    }
    default:
      return { width: 1, height: 1 };
  }
}
