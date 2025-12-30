/**
 * 编辑器覆盖层
 * 显示 Pixel 占用状态和选择区域
 * 处理 Magnet 拖动
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../contexts/EditorContext';
import { Magnet, PixelAnchor } from '../../types/pixel';
import { MATRIX_CONFIG } from '../../constants/config';
import { calculateNewAnchors, checkMagnetCollision, getMagnetOccupiedPixels } from '../../utils/magnetEditor';
import {
  computePixelGridLayout,
  hitTestPixelGridFromPoint,
  nearestPixelGridFromPoint,
} from '../../utils/pixelGrid';
import './EditorOverlay.css';

interface EditorOverlayProps {
  pixelPositions: Map<string, { x: number; y: number }>;
  magnets: Magnet[];
  onMagnetMove: (magnetId: string, newAnchors: PixelAnchor[]) => void;
}

type DraggingMagnetState = {
  magnet: Magnet;
  startAnchor: { x: number; y: number };
  mouseOffset: { x: number; y: number };
  previewAnchors: PixelAnchor[];
  hasCollision: boolean;
} | null;

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridLayoutRef = useRef(computePixelGridLayout(window.innerWidth, window.innerHeight));
  const occupancyMapRef = useRef(occupancyMap);
  const editorStateRef = useRef(editorState);
  const moveRafRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<{ x: number; y: number } | null>(null);
  const lastHoverKeyRef = useRef<string | null>(null);
  const lastDragKeyRef = useRef<string | null>(null);
  const lastMagnetDeltaRef = useRef<{ dx: number; dy: number } | null>(null);
  const drawRafRef = useRef<number | null>(null);

  occupancyMapRef.current = occupancyMap;
  editorStateRef.current = editorState;

  useEffect(() => {
    gridLayoutRef.current = computePixelGridLayout(window.innerWidth, window.innerHeight);
  }, [pixelPositions]);

  useEffect(() => {
    if (!editorState.isDragging) lastDragKeyRef.current = null;
  }, [editorState.isDragging]);

  // Magnet 拖动状态
  const [draggingMagnet, setDraggingMagnet] = useState<DraggingMagnetState>(null);
  const draggingMagnetRef = useRef<DraggingMagnetState>(null);

  useEffect(() => {
    draggingMagnetRef.current = draggingMagnet;
  }, [draggingMagnet]);

  useEffect(() => {
    if (!draggingMagnet) lastMagnetDeltaRef.current = null;
  }, [draggingMagnet]);

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
      const layout = gridLayoutRef.current;
      const hit = hitTestPixelGridFromPoint(mouseX, mouseY, layout);
      const nearest = nearestPixelGridFromPoint(mouseX, mouseY, layout);
      const grid = hit ?? nearest;
      return { x: grid.gridX, y: grid.gridY };
    },
    []
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

  const flushMouseMove = useCallback(() => {
    moveRafRef.current = null;
    const pending = pendingMoveRef.current;
    pendingMoveRef.current = null;
    if (!pending) return;

    const { x: mouseX, y: mouseY } = pending;

    if (draggingMagnetRef.current) {
      const hoverPixel = getPixelAtPosition(mouseX, mouseY);
      if (hoverPixel) {
        const key = `${hoverPixel.x},${hoverPixel.y}`;
        if (key !== lastHoverKeyRef.current) {
          lastHoverKeyRef.current = key;
          setHoverPixel(hoverPixel.x, hoverPixel.y);
        }
      }

      setDraggingMagnet((prev) => {
        if (!prev) return prev;

        const targetX = mouseX - prev.mouseOffset.x;
        const targetY = mouseY - prev.mouseOffset.y;

        const targetPixel = getPixelAtPosition(targetX, targetY);
        if (!targetPixel) return prev;

        const dx = targetPixel.x - prev.startAnchor.x;
        const dy = targetPixel.y - prev.startAnchor.y;

        const lastDelta = lastMagnetDeltaRef.current;
        if (lastDelta && lastDelta.dx === dx && lastDelta.dy === dy) return prev;
        lastMagnetDeltaRef.current = { dx, dy };

        const newAnchors = calculateNewAnchors(prev.magnet, dx, dy);
        const hasCollision = checkMagnetCollision(
          prev.magnet,
          newAnchors,
          occupancyMapRef.current
        );

        return {
          ...prev,
          previewAnchors: newAnchors,
          hasCollision,
        };
      });
      return;
    }

    const pixel = getPixelAtPosition(mouseX, mouseY);
    if (!pixel) return;

    const key = `${pixel.x},${pixel.y}`;
    if (key !== lastHoverKeyRef.current) {
      lastHoverKeyRef.current = key;
      setHoverPixel(pixel.x, pixel.y);
    }

    const editorStateNow = editorStateRef.current;
    if (!editorStateNow.isDragging) return;
    if (key === lastDragKeyRef.current) return;

    lastDragKeyRef.current = key;
    updateDrag(pixel.x, pixel.y);
  }, [getPixelAtPosition, setHoverPixel, updateDrag]);

  // 处理鼠标移动
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!editorState.isEditing) return;

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      pendingMoveRef.current = { x: mouseX, y: mouseY };
      if (moveRafRef.current !== null) return;
      moveRafRef.current = window.requestAnimationFrame(flushMouseMove);
    },
    [editorState.isEditing, flushMouseMove]
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
        // 应用移动
        onMagnetMove(draggingMagnet.magnet.id, draggingMagnet.previewAnchors);
      }
      setDraggingMagnet(null);
      return;
    }

    // 否则结束 Pixel 拖拽
    if (draggingMagnet) {
      setDraggingMagnet(null);
      return;
    }

    if (editorState.isDragging) {
      endDrag();
    }
  }, [draggingMagnet, editorState.isDragging, onMagnetMove, endDrag]);

  // 处理鼠标离开
  const handleMouseLeave = useCallback(() => {
    if (moveRafRef.current !== null) {
      window.cancelAnimationFrame(moveRafRef.current);
      moveRafRef.current = null;
    }
    pendingMoveRef.current = null;
    lastHoverKeyRef.current = null;
    lastDragKeyRef.current = null;
    setHoverPixel(null, null);
    setDraggingMagnet(null);
    if (editorState.isDragging) {
      endDrag();
    }
  }, [setHoverPixel, editorState.isDragging, endDrag]);

  const drawOverlay = useCallback(() => {
    drawRafRef.current = null;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const overlayEl = overlayRef.current;
    const cssWidth = overlayEl?.clientWidth ?? window.innerWidth;
    const cssHeight = overlayEl?.clientHeight ?? window.innerHeight;
    const dpr = window.devicePixelRatio || 1;

    const targetWidth = Math.max(1, Math.floor(cssWidth * dpr));
    const targetHeight = Math.max(1, Math.floor(cssHeight * dpr));
    if (canvas.width !== targetWidth) canvas.width = targetWidth;
    if (canvas.height !== targetHeight) canvas.height = targetHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (
      gridLayoutRef.current.width !== cssWidth ||
      gridLayoutRef.current.height !== cssHeight
    ) {
      gridLayoutRef.current = computePixelGridLayout(cssWidth, cssHeight);
    }

    const { COLUMNS, ROWS, PIXEL_SIZE, EDGE_PADDING } = MATRIX_CONFIG;
    const { stepX, stepY } = gridLayoutRef.current;

    const state = editorStateRef.current;
    const occ = occupancyMapRef.current;

    const draggingSelectedPixels = draggingMagnetRef.current
      ? new Set(
          getMagnetOccupiedPixels({
            ...draggingMagnetRef.current.magnet,
            anchors: draggingMagnetRef.current.previewAnchors,
          }).map((pixel) => `${pixel.x},${pixel.y}`)
        )
      : null;

    let dragMinX = 0;
    let dragMaxX = -1;
    let dragMinY = 0;
    let dragMaxY = -1;
    const hasDragArea =
      state.isDragging && state.dragStartPixel && state.dragEndPixel ? true : false;
    if (hasDragArea && state.dragStartPixel && state.dragEndPixel) {
      dragMinX = Math.min(state.dragStartPixel.x, state.dragEndPixel.x);
      dragMaxX = Math.max(state.dragStartPixel.x, state.dragEndPixel.x);
      dragMinY = Math.min(state.dragStartPixel.y, state.dragEndPixel.y);
      dragMaxY = Math.max(state.dragStartPixel.y, state.dragEndPixel.y);
    }

    ctx.clearRect(0, 0, cssWidth, cssHeight);

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLUMNS; col++) {
        const key = `${col},${row}`;
        const occupancy = occ.get(key);

        const isOccupied = occupancy?.isOccupied === true;
        const isSelected = draggingSelectedPixels ? draggingSelectedPixels.has(key) : state.selectedPixels.has(key);
        const isHovered = state.hoverPixel?.x === col && state.hoverPixel?.y === row;
        const isDragSelection = hasDragArea
          ? col >= dragMinX && col <= dragMaxX && row >= dragMinY && row <= dragMaxY
          : false;

        let fill = 'rgba(0, 255, 136, 0.10)';
        let stroke = 'rgba(0, 255, 136, 0.20)';
        let lineWidth = 1;
        let scale = 1.0;

        if (isOccupied) {
          fill = 'rgba(255, 59, 48, 0.20)';
          stroke = 'rgba(255, 59, 48, 0.40)';
        }

        if (isDragSelection) {
          fill = 'rgba(0, 122, 255, 0.30)';
          stroke = 'rgba(0, 122, 255, 0.60)';
          lineWidth = 2;
        }

        if (isSelected) {
          if (isOccupied) {
            fill = 'rgba(255, 149, 0, 0.50)';
            stroke = 'rgba(255, 149, 0, 1.00)';
          } else {
            fill = 'rgba(255, 149, 0, 0.40)';
            stroke = 'rgba(255, 149, 0, 0.80)';
          }
          lineWidth = 2;
        }

        if (isHovered) {
          if (isOccupied) {
            fill = 'rgba(255, 59, 48, 0.40)';
            stroke = 'rgba(255, 59, 48, 0.80)';
          } else {
            fill = 'rgba(0, 122, 255, 0.30)';
            stroke = 'rgba(0, 122, 255, 0.60)';
          }
          lineWidth = 2;
          scale = 1.1;
        }

        const baseX = EDGE_PADDING + col * stepX;
        const baseY = EDGE_PADDING + row * stepY;

        const w = PIXEL_SIZE * scale;
        const h = PIXEL_SIZE * scale;
        const dx = baseX + (PIXEL_SIZE - w) / 2;
        const dy = baseY + (PIXEL_SIZE - h) / 2;

        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lineWidth;
        ctx.fillRect(dx, dy, w, h);
        ctx.strokeRect(dx + 0.5, dy + 0.5, w - 1, h - 1);
      }
    }
  }, []);

  const scheduleDraw = useCallback(() => {
    if (drawRafRef.current !== null) return;
    drawRafRef.current = window.requestAnimationFrame(drawOverlay);
  }, [drawOverlay]);

  useEffect(() => {
    scheduleDraw();
  }, [scheduleDraw, editorState, occupancyMap, pixelPositions, draggingMagnet]);

  useEffect(() => {
    return () => {
      if (drawRafRef.current !== null) {
        window.cancelAnimationFrame(drawRafRef.current);
        drawRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const onResize = () => {
      gridLayoutRef.current = computePixelGridLayout(window.innerWidth, window.innerHeight);
      scheduleDraw();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [scheduleDraw]);

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
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />

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
