/**
 * 编辑器覆盖层
 * 显示 Pixel 占用状态和选择区域
 * 处理 Magnet 拖动
 */

import React, { useCallback, useRef, useState } from 'react';
import { useEditor } from '../../contexts/EditorContext';
import { Magnet, PixelAnchor } from '../../types/pixel';
import { MATRIX_CONFIG } from '../../constants/config';
import { calculateNewAnchors, checkMagnetCollision } from '../../utils/magnetEditor';
import './EditorOverlay.css';

interface EditorOverlayProps {
  pixelPositions: Map<string, { x: number; y: number }>;
  magnets: Magnet[];
  onMagnetMove: (magnetId: string, newAnchors: PixelAnchor[]) => void;
}

/**
 * 获取 Magnet 的边界框
 */
function getMagnetBounds(
  magnet: Magnet,
  pixelPositions: Map<string, { x: number; y: number }>
): { left: number; top: number; right: number; bottom: number } | null {
  const { anchorType, anchors } = magnet;

  switch (anchorType) {
    case 'single': {
      const anchor = anchors[0];
      const pos = pixelPositions.get(`${anchor.gridX},${anchor.gridY}`);
      if (!pos) return null;

      const width = parseInt(magnet.style.width as string) || MATRIX_CONFIG.PIXEL_SIZE;
      const height = parseInt(magnet.style.height as string) || MATRIX_CONFIG.PIXEL_SIZE;
      const offsetX = (MATRIX_CONFIG.PIXEL_SIZE - width) / 2;
      const offsetY = (MATRIX_CONFIG.PIXEL_SIZE - height) / 2;

      return {
        left: pos.x + offsetX,
        top: pos.y + offsetY,
        right: pos.x + offsetX + width,
        bottom: pos.y + offsetY + height,
      };
    }

    case 'horizontal': {
      const leftAnchor = anchors[0];
      const rightAnchor = anchors[1];
      const leftPos = pixelPositions.get(`${leftAnchor.gridX},${leftAnchor.gridY}`);
      const rightPos = pixelPositions.get(`${rightAnchor.gridX},${rightAnchor.gridY}`);
      if (!leftPos || !rightPos) return null;

      const height = parseInt(magnet.style.height as string) || MATRIX_CONFIG.PIXEL_SIZE;
      const offsetY = (MATRIX_CONFIG.PIXEL_SIZE - height) / 2;

      return {
        left: leftPos.x,
        top: leftPos.y + offsetY,
        right: rightPos.x + MATRIX_CONFIG.PIXEL_SIZE,
        bottom: leftPos.y + offsetY + height,
      };
    }

    case 'vertical': {
      const topAnchor = anchors[0];
      const bottomAnchor = anchors[1];
      const topPos = pixelPositions.get(`${topAnchor.gridX},${topAnchor.gridY}`);
      const bottomPos = pixelPositions.get(`${bottomAnchor.gridX},${bottomAnchor.gridY}`);
      if (!topPos || !bottomPos) return null;

      const width = parseInt(magnet.style.width as string) || MATRIX_CONFIG.PIXEL_SIZE;
      const offsetX = (MATRIX_CONFIG.PIXEL_SIZE - width) / 2;

      return {
        left: topPos.x + offsetX,
        top: topPos.y,
        right: topPos.x + offsetX + width,
        bottom: bottomPos.y + MATRIX_CONFIG.PIXEL_SIZE,
      };
    }

    case 'rectangular': {
      const topLeft = anchors[0];
      const bottomRight = anchors[3];
      const topLeftPos = pixelPositions.get(`${topLeft.gridX},${topLeft.gridY}`);
      const bottomRightPos = pixelPositions.get(`${bottomRight.gridX},${bottomRight.gridY}`);
      if (!topLeftPos || !bottomRightPos) return null;

      return {
        left: topLeftPos.x,
        top: topLeftPos.y,
        right: bottomRightPos.x + MATRIX_CONFIG.PIXEL_SIZE,
        bottom: bottomRightPos.y + MATRIX_CONFIG.PIXEL_SIZE,
      };
    }

    default:
      return null;
  }
}

export function EditorOverlay({ pixelPositions, magnets, onMagnetMove }: EditorOverlayProps) {
  const { editorState, occupancyMap, startDrag, updateDrag, endDrag, setHoverPixel, selectMagnet } =
    useEditor();

  const overlayRef = useRef<HTMLDivElement>(null);

  // Magnet 拖动状态
  const [draggingMagnet, setDraggingMagnet] = useState<{
    magnet: Magnet;
    startAnchor: { x: number; y: number };
    mouseOffset: { x: number; y: number };
    previewAnchors: PixelAnchor[];
    hasCollision: boolean;
  } | null>(null);

  // 检测鼠标是否点击在某个 Magnet 上
  const getMagnetAtPosition = useCallback(
    (mouseX: number, mouseY: number): Magnet | null => {
      // 从后往前遍历（后面的 Magnet z-index 更高，优先级更高）
      for (let i = magnets.length - 1; i >= 0; i--) {
        const magnet = magnets[i];
        const bounds = getMagnetBounds(magnet, pixelPositions);

        if (!bounds) continue;

        if (
          mouseX >= bounds.left &&
          mouseX <= bounds.right &&
          mouseY >= bounds.top &&
          mouseY <= bounds.bottom
        ) {
          return magnet;
        }
      }
      return null;
    },
    [magnets, pixelPositions]
  );

  // 获取鼠标位置对应的 Pixel 坐标
  const getPixelAtPosition = useCallback(
    (mouseX: number, mouseY: number): { x: number; y: number } | null => {
      let closestPixel: { x: number; y: number } | null = null;
      let minDistance = Infinity;

      pixelPositions.forEach((pos, key) => {
        const [gridX, gridY] = key.split(',').map(Number);
        const centerX = pos.x + MATRIX_CONFIG.PIXEL_SIZE / 2;
        const centerY = pos.y + MATRIX_CONFIG.PIXEL_SIZE / 2;
        const distance = Math.sqrt(Math.pow(centerX - mouseX, 2) + Math.pow(centerY - mouseY, 2));

        if (distance < minDistance) {
          minDistance = distance;
          closestPixel = { x: gridX, y: gridY };
        }
      });

      return closestPixel;
    },
    [pixelPositions]
  );

  // 处理鼠标按下
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!editorState.isEditing) return;

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // 检查是否点击在 Magnet 上
      const clickedMagnet = getMagnetAtPosition(mouseX, mouseY);

      if (clickedMagnet) {
        // 选中该 Magnet（会自动选中其占用的所有pixels）
        selectMagnet(clickedMagnet.id);

        // 进入拖动 Magnet 模式
        const firstAnchor = clickedMagnet.anchors[0];
        const anchorPos = pixelPositions.get(`${firstAnchor.gridX},${firstAnchor.gridY}`);
        if (!anchorPos) return;

        setDraggingMagnet({
          magnet: clickedMagnet,
          startAnchor: { x: firstAnchor.gridX, y: firstAnchor.gridY },
          mouseOffset: {
            x: mouseX - anchorPos.x,
            y: mouseY - anchorPos.y,
          },
          previewAnchors: clickedMagnet.anchors,
          hasCollision: false,
        });
        return;
      }

      // 否则进入 Pixel 选择模式
      const pixel = getPixelAtPosition(mouseX, mouseY);
      if (pixel) {
        startDrag(pixel.x, pixel.y);
      }
    },
    [editorState, getMagnetAtPosition, getPixelAtPosition, pixelPositions, startDrag, selectMagnet]
  );

  // 处理鼠标移动
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!editorState.isEditing) return;

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // 如果正在拖动 Magnet
      if (draggingMagnet) {
        // 计算目标 Pixel 位置（考虑鼠标偏移）
        const targetX = mouseX - draggingMagnet.mouseOffset.x;
        const targetY = mouseY - draggingMagnet.mouseOffset.y;

        // 找到最近的 Pixel
        const targetPixel = getPixelAtPosition(targetX, targetY);
        if (!targetPixel) return;

        // 计算 delta
        const deltaX = targetPixel.x - draggingMagnet.startAnchor.x;
        const deltaY = targetPixel.y - draggingMagnet.startAnchor.y;

        if (deltaX === 0 && deltaY === 0) return;

        // 计算新的锚点位置
        const newAnchors = calculateNewAnchors(draggingMagnet.magnet, deltaX, deltaY);

        // 检查是否有冲突
        const hasCollision = checkMagnetCollision(draggingMagnet.magnet, newAnchors, occupancyMap);

        setDraggingMagnet({
          ...draggingMagnet,
          previewAnchors: newAnchors,
          hasCollision,
        });
        return;
      }

      // 否则处理 Pixel 选择
      const pixel = getPixelAtPosition(mouseX, mouseY);
      if (pixel) {
        setHoverPixel(pixel.x, pixel.y);
        if (editorState.isDragging) {
          updateDrag(pixel.x, pixel.y);
        }
      }
    },
    [editorState, draggingMagnet, getPixelAtPosition, occupancyMap, setHoverPixel, updateDrag]
  );

  // 处理鼠标释放
  const handleMouseUp = useCallback(() => {
    // 如果正在拖动 Magnet
    if (draggingMagnet && !draggingMagnet.hasCollision) {
      // 检查锚点是否真的改变了
      const originalAnchors = draggingMagnet.magnet.anchors;
      const newAnchors = draggingMagnet.previewAnchors;
      const hasChanged = originalAnchors.some(
        (anchor, index) =>
          anchor.gridX !== newAnchors[index].gridX || anchor.gridY !== newAnchors[index].gridY
      );

      if (hasChanged) {
        console.log('Moving Magnet:', draggingMagnet.magnet.id);
        console.log('From:', originalAnchors);
        console.log('To:', newAnchors);
        // 应用移动
        onMagnetMove(draggingMagnet.magnet.id, draggingMagnet.previewAnchors);
      }
      setDraggingMagnet(null);
      return;
    }

    // 否则结束 Pixel 拖拽
    if (draggingMagnet) {
      console.log('Drag cancelled: collision detected');
      setDraggingMagnet(null);
      return;
    }

    if (editorState.isDragging) {
      endDrag();
    }
  }, [draggingMagnet, editorState.isDragging, onMagnetMove, endDrag]);

  // 处理鼠标离开
  const handleMouseLeave = useCallback(() => {
    setHoverPixel(null, null);
    setDraggingMagnet(null);
    if (editorState.isDragging) {
      endDrag();
    }
  }, [setHoverPixel, editorState.isDragging, endDrag]);

  if (!editorState.isEditing) {
    return null;
  }

  return (
    <div
      ref={overlayRef}
      className="editor-overlay"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      {/* 渲染所有 Pixel 的占用状态 */}
      {Array.from(pixelPositions.entries()).map(([key, pos]) => {
        const [gridX, gridY] = key.split(',').map(Number);
        const occupancy = occupancyMap.get(key);
        const isSelected = editorState.selectedPixels.has(key);
        const isHovered =
          editorState.hoverPixel?.x === gridX && editorState.hoverPixel?.y === gridY;
        const isDragSelection =
          editorState.isDragging &&
          editorState.dragStartPixel &&
          editorState.dragEndPixel &&
          isInDragArea(gridX, gridY, editorState.dragStartPixel, editorState.dragEndPixel);

        let pixelClass = 'editor-pixel';
        if (occupancy?.isOccupied) {
          pixelClass += ' occupied';
        } else {
          pixelClass += ' free';
        }
        if (isSelected) {
          pixelClass += ' selected';
        }
        if (isHovered) {
          pixelClass += ' hovered';
        }
        if (isDragSelection) {
          pixelClass += ' drag-selection';
        }

        return (
          <div
            key={key}
            className={pixelClass}
            style={{
              position: 'absolute',
              left: pos.x,
              top: pos.y,
              width: MATRIX_CONFIG.PIXEL_SIZE,
              height: MATRIX_CONFIG.PIXEL_SIZE,
            }}
            data-grid-x={gridX}
            data-grid-y={gridY}
            title={`(${gridX}, ${gridY})${occupancy?.isOccupied ? ` - ${occupancy.occupiedBy}` : ''}`}
          />
        );
      })}

      {/* 渲染拖动预览 */}
      {draggingMagnet && (
        <div
          className={`magnet-drag-preview ${draggingMagnet.hasCollision ? 'collision' : ''}`}
          style={{
            position: 'absolute',
            ...getMagnetPreviewStyle(
              draggingMagnet.magnet,
              draggingMagnet.previewAnchors,
              pixelPositions
            ),
            ...draggingMagnet.magnet.style,
            opacity: 0.7,
            pointerEvents: 'none',
            border: draggingMagnet.hasCollision
              ? '2px dashed rgba(255, 59, 48, 0.8)'
              : '2px dashed rgba(0, 122, 255, 0.8)',
          }}
        >
          {draggingMagnet.magnet.content}
        </div>
      )}
    </div>
  );
}

/**
 * 获取 Magnet 预览样式
 */
function getMagnetPreviewStyle(
  magnet: Magnet,
  anchors: PixelAnchor[],
  pixelPositions: Map<string, { x: number; y: number }>
): React.CSSProperties {
  const { anchorType } = magnet;

  switch (anchorType) {
    case 'single': {
      const anchor = anchors[0];
      const pos = pixelPositions.get(`${anchor.gridX},${anchor.gridY}`);
      if (!pos) return {};

      const width = parseInt(magnet.style.width as string) || MATRIX_CONFIG.PIXEL_SIZE;
      const height = parseInt(magnet.style.height as string) || MATRIX_CONFIG.PIXEL_SIZE;
      const offsetX = (MATRIX_CONFIG.PIXEL_SIZE - width) / 2;
      const offsetY = (MATRIX_CONFIG.PIXEL_SIZE - height) / 2;

      return {
        left: pos.x + offsetX,
        top: pos.y + offsetY,
        width,
        height,
      };
    }

    case 'horizontal': {
      const leftAnchor = anchors[0];
      const rightAnchor = anchors[1];
      const leftPos = pixelPositions.get(`${leftAnchor.gridX},${leftAnchor.gridY}`);
      const rightPos = pixelPositions.get(`${rightAnchor.gridX},${rightAnchor.gridY}`);
      if (!leftPos || !rightPos) return {};

      const height = parseInt(magnet.style.height as string) || MATRIX_CONFIG.PIXEL_SIZE;
      const offsetY = (MATRIX_CONFIG.PIXEL_SIZE - height) / 2;
      const width = rightPos.x - leftPos.x + MATRIX_CONFIG.PIXEL_SIZE;

      return {
        left: leftPos.x,
        top: leftPos.y + offsetY,
        width,
        height,
      };
    }

    case 'rectangular': {
      const topLeft = anchors[0];
      const bottomRight = anchors[3];
      const topLeftPos = pixelPositions.get(`${topLeft.gridX},${topLeft.gridY}`);
      const bottomRightPos = pixelPositions.get(`${bottomRight.gridX},${bottomRight.gridY}`);
      if (!topLeftPos || !bottomRightPos) return {};

      const width = bottomRightPos.x - topLeftPos.x + MATRIX_CONFIG.PIXEL_SIZE;
      const height = bottomRightPos.y - topLeftPos.y + MATRIX_CONFIG.PIXEL_SIZE;

      return {
        left: topLeftPos.x,
        top: topLeftPos.y,
        width,
        height,
      };
    }

    default:
      return {};
  }
}

/**
 * 检查 pixel 是否在拖拽选择区域内
 */
function isInDragArea(
  x: number,
  y: number,
  start: { x: number; y: number },
  end: { x: number; y: number }
): boolean {
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);

  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}
