/**
 * 编辑器覆盖层
 * 显示 Pixel 占用状态和选择区域
 * 处理 Magnet 拖动
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../contexts/EditorContext';
import { useWindowActivity } from '../../contexts/WindowActivityContext';
import { Magnet, PixelAnchor } from '../../types/pixel';
import { MATRIX_CONFIG } from '../../constants/config';
import {
  alignMagnetBounds,
  computeChromeBoundsFromLayoutBounds,
  type MagnetBounds,
} from '../../modules/magnets/geometry';
import { buildAdaptiveMagnetLayout, type MagnetJoinEdges } from '../../modules/magnets/layoutAdaptive';
import { MagnetComponent } from '../magnet/Magnet';
import { calculateNewAnchors, checkMagnetCollision, getMagnetOccupiedPixels } from '../../utils/magnetEditor';
import { buildMagnetAnchorsAtTopLeft, resolveMagnetFootprintShape } from '../../utils/magnetPlacement';
import {
  computePixelGridLayout,
  hitTestPixelGridFromPoint,
  nearestPixelGridFromPoint,
} from '../../utils/pixelGrid';
import { readJson } from '../../modules/storage';
import { setupStorageListener, setupTauriListener, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import './EditorOverlay.css';

interface EditorOverlayProps {
  pixelPositions: Map<string, { x: number; y: number }>;
  magnets: Magnet[];
  onMagnetMove: (magnetId: string, newAnchors: PixelAnchor[]) => void;
  onMagnetCtrlClick?: (magnetId: string) => void;
  placementMagnet: Magnet | null;
  onPlacementConfirm: (anchors: PixelAnchor[]) => void;
  onPlacementCancel: () => void;
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
function readViewportSize() {
  if (typeof window === 'undefined') {
    return { width: 0, height: 0 };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function toAbsoluteBounds(bounds: MagnetBounds | null): { left: number; top: number; right: number; bottom: number } | null {
  if (!bounds) return null;

  const aligned = alignMagnetBounds(bounds);

  return {
    left: aligned.x,
    top: aligned.y,
    right: aligned.x + aligned.width,
    bottom: aligned.y + aligned.height,
  };
}

function createPreviewMagnet(magnet: Magnet, anchors: PixelAnchor[]): Magnet {
  return {
    ...magnet,
    anchors,
  };
}

interface OverlayMagnetPreviewProps {
  magnet: Magnet;
  pixelPositions: Map<string, { x: number; y: number }>;
  layoutBounds: MagnetBounds;
  joinEdges?: MagnetJoinEdges;
  outlineTone: 'drag' | 'placement' | 'collision';
  ghostOpacity?: number;
}

function OverlayMagnetPreview({
  magnet,
  pixelPositions,
  layoutBounds,
  joinEdges,
  outlineTone,
  ghostOpacity = 0.72,
}: OverlayMagnetPreviewProps) {
  const alignedLayoutBounds = React.useMemo(() => alignMagnetBounds(layoutBounds), [layoutBounds]);
  const outlineStyle = React.useMemo(() => {
    const chromeBounds = computeChromeBoundsFromLayoutBounds(alignedLayoutBounds, magnet.chrome, {
      joinEdges,
    });
    if (!chromeBounds) return null;

    const aligned = alignMagnetBounds(chromeBounds);
    return {
      left: aligned.x,
      top: aligned.y,
      width: aligned.width,
      height: aligned.height,
      borderRadius: magnet.style.borderRadius,
    } satisfies React.CSSProperties;
  }, [alignedLayoutBounds, joinEdges, magnet.chrome, magnet.style.borderRadius]);

  if (!outlineStyle) return null;

  return (
    <div className="magnet-preview-layer">
      <div className="magnet-preview-ghost" style={{ opacity: ghostOpacity }}>
        <MagnetComponent
          magnet={magnet}
          pixelPositions={pixelPositions}
          layoutBoundsOverride={alignedLayoutBounds}
          joinEdges={joinEdges}
        />
      </div>
      <div className={`magnet-preview-outline magnet-preview-outline--${outlineTone}`} style={outlineStyle} />
    </div>
  );
}

export function EditorOverlay({
  pixelPositions,
  magnets,
  onMagnetMove,
  onMagnetCtrlClick,
  placementMagnet,
  onPlacementConfirm,
  onPlacementCancel,
}: EditorOverlayProps) {
  const { editorState, occupancyMap, startDrag, updateDrag, endDrag, setHoverPixel, selectMagnet } =
    useEditor();
  const { renderMode } = useWindowActivity();

  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridLayoutRef = useRef(computePixelGridLayout(window.innerWidth, window.innerHeight));
  const occupancyMapRef = useRef(occupancyMap);
  const editorStateRef = useRef(editorState);
  const placementMagnetRef = useRef<Magnet | null>(placementMagnet);
  const moveRafRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<{ x: number; y: number } | null>(null);
  const lastHoverKeyRef = useRef<string | null>(null);
  const lastDragKeyRef = useRef<string | null>(null);
  const lastMagnetDeltaRef = useRef<{ dx: number; dy: number } | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const drawRafRef = useRef<number | null>(null);
  const pendingDrawRef = useRef(false);
  const renderModeRef = useRef(renderMode);
  renderModeRef.current = renderMode;
  const [viewportSize, setViewportSize] = useState(readViewportSize);
  const adaptiveLayout = React.useMemo(
    () => buildAdaptiveMagnetLayout(magnets, pixelPositions, viewportSize),
    [magnets, pixelPositions, viewportSize]
  );
  const [pixelHintsVisible, setPixelHintsVisible] = useState(() =>
    readJson<boolean>(STORAGE_KEYS.EDITOR_OVERLAY_PIXEL_HINTS_VISIBLE, true)
  );

  const refreshPixelHintsVisible = useCallback(() => {
    setPixelHintsVisible(readJson<boolean>(STORAGE_KEYS.EDITOR_OVERLAY_PIXEL_HINTS_VISIBLE, true));
  }, []);

  useEffect(() => {
    let disposed = false;
    refreshPixelHintsVisible();

    const teardownStorage = setupStorageListener(
      [STORAGE_KEYS.EDITOR_OVERLAY_PIXEL_HINTS_VISIBLE],
      refreshPixelHintsVisible
    );

    let unlistenTauri: (() => void) | null = null;
    const setup = async () => {
      const unlisten = await setupTauriListener(
        TAURI_EVENTS.EDITOR_OVERLAY_PIXEL_HINTS_UPDATED,
        refreshPixelHintsVisible
      );
      if (disposed) {
        unlisten();
        return;
      }
      unlistenTauri = unlisten;
    };
    void setup();

    return () => {
      disposed = true;
      teardownStorage();
      if (unlistenTauri) unlistenTauri();
    };
  }, [refreshPixelHintsVisible]);

  occupancyMapRef.current = occupancyMap;
  editorStateRef.current = editorState;
  placementMagnetRef.current = placementMagnet;

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
    if (!placementMagnet) return;
    setDraggingMagnet(null);
    if (editorStateRef.current.isDragging) {
      endDrag();
    }
  }, [endDrag, placementMagnet]);

  useEffect(() => {
    if (!placementMagnet) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onPlacementCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onPlacementCancel, placementMagnet]);

  useEffect(() => {
    if (!draggingMagnet) lastMagnetDeltaRef.current = null;
  }, [draggingMagnet]);

  const draggingPreview = React.useMemo(() => {
    if (!draggingMagnet) return null;

    const previewMagnet = createPreviewMagnet(draggingMagnet.magnet, draggingMagnet.previewAnchors);
    const previewMagnets = magnets.map((magnet) => (magnet.id === previewMagnet.id ? previewMagnet : magnet));
    const previewLayout = buildAdaptiveMagnetLayout(previewMagnets, pixelPositions, viewportSize);
    const layoutBounds = previewLayout.layoutBoundsByMagnetId[previewMagnet.id];
    if (!layoutBounds) return null;

    return {
      magnet: previewMagnet,
      layoutBounds,
      joinEdges: previewLayout.joinsByMagnetId[previewMagnet.id],
      outlineTone: draggingMagnet.hasCollision ? ('collision' as const) : ('drag' as const),
    };
  }, [draggingMagnet, magnets, pixelPositions, viewportSize]);

  const placementPreview = React.useMemo(() => {
    if (!placementMagnet || !editorState.hoverPixel) return null;

    const hover = editorState.hoverPixel;
    const shape = resolveMagnetFootprintShape(placementMagnet);
    if (!shape) return null;
    if (
      hover.x < 0 ||
      hover.y < 0 ||
      hover.x + shape.width > MATRIX_CONFIG.COLUMNS ||
      hover.y + shape.height > MATRIX_CONFIG.ROWS
    ) {
      return null;
    }

    for (let dy = 0; dy < shape.height; dy++) {
      for (let dx = 0; dx < shape.width; dx++) {
        const key = `${hover.x + dx},${hover.y + dy}`;
        if (occupancyMap.get(key)?.isOccupied) return null;
      }
    }

    const anchors = buildMagnetAnchorsAtTopLeft(placementMagnet, { x: hover.x, y: hover.y });
    if (!anchors) return null;

    const previewMagnet = createPreviewMagnet(placementMagnet, anchors);
    const previewLayout = buildAdaptiveMagnetLayout([...magnets, previewMagnet], pixelPositions, viewportSize);
    const layoutBounds = previewLayout.layoutBoundsByMagnetId[previewMagnet.id];
    if (!layoutBounds) return null;

    return {
      magnet: previewMagnet,
      layoutBounds,
      joinEdges: previewLayout.joinsByMagnetId[previewMagnet.id],
    };
  }, [editorState.hoverPixel, magnets, occupancyMap, placementMagnet, pixelPositions, viewportSize]);

  // 检测鼠标是否点击在某个 Magnet 上
  const getMagnetAtPosition = useCallback(
    (mouseX: number, mouseY: number): Magnet | null => {
      // 从后往前遍历（后面的 Magnet z-index 更高，优先级更高）
      for (let i = magnets.length - 1; i >= 0; i--) {
        const magnet = magnets[i];
        const bounds = toAbsoluteBounds(
          computeChromeBoundsFromLayoutBounds(adaptiveLayout.layoutBoundsByMagnetId[magnet.id], magnet.chrome, {
            joinEdges: adaptiveLayout.joinsByMagnetId[magnet.id],
          })
        );

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
    [adaptiveLayout.joinsByMagnetId, adaptiveLayout.layoutBoundsByMagnetId, magnets]
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
  const capturePointer = useCallback((pointerId: number) => {
    activePointerIdRef.current = pointerId;
    const overlayEl = overlayRef.current;
    if (!overlayEl) return;
    try {
      overlayEl.setPointerCapture(pointerId);
    } catch {
      // best effort
    }
  }, []);

  const releasePointer = useCallback((pointerId?: number) => {
    const resolvedPointerId = pointerId ?? activePointerIdRef.current;
    const overlayEl = overlayRef.current;

    if (overlayEl && resolvedPointerId !== null) {
      try {
        if (overlayEl.hasPointerCapture(resolvedPointerId)) {
          overlayEl.releasePointerCapture(resolvedPointerId);
        }
      } catch {
        // best effort
      }
    }

    activePointerIdRef.current = null;
  }, []);

  const finishDragInteraction = useCallback(
    (commitMagnetMove: boolean) => {
      if (moveRafRef.current !== null) {
        window.cancelAnimationFrame(moveRafRef.current);
        moveRafRef.current = null;
      }
      pendingMoveRef.current = null;
      lastDragKeyRef.current = null;

      const draggingState = draggingMagnetRef.current;
      if (draggingState) {
        if (commitMagnetMove && !draggingState.hasCollision) {
          const originalAnchors = draggingState.magnet.anchors;
          const newAnchors = draggingState.previewAnchors;
          const hasChanged = originalAnchors.some(
            (anchor, index) =>
              anchor.gridX !== newAnchors[index].gridX || anchor.gridY !== newAnchors[index].gridY
          );

          if (hasChanged) {
            onMagnetMove(draggingState.magnet.id, draggingState.previewAnchors);
          }
        }

        setDraggingMagnet(null);
        return;
      }

      if (editorStateRef.current.isDragging) {
        endDrag();
      }
    },
    [endDrag, onMagnetMove]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!editorState.isEditing) return;

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // 检查是否点击在 Magnet 上
      const placementMagnet = placementMagnetRef.current;
      if (placementMagnet) {
        const pixel = getPixelAtPosition(mouseX, mouseY);
        if (!pixel) return;
        const shape = resolveMagnetFootprintShape(placementMagnet);
        if (!shape) return;
        if (
          pixel.x < 0 ||
          pixel.y < 0 ||
          pixel.x + shape.width > MATRIX_CONFIG.COLUMNS ||
          pixel.y + shape.height > MATRIX_CONFIG.ROWS
        ) {
          return;
        }

        for (let dy = 0; dy < shape.height; dy++) {
          for (let dx = 0; dx < shape.width; dx++) {
            const key = `${pixel.x + dx},${pixel.y + dy}`;
            if (occupancyMapRef.current.get(key)?.isOccupied) return;
          }
        }

        const anchors = buildMagnetAnchorsAtTopLeft(placementMagnet, { x: pixel.x, y: pixel.y });
        if (!anchors) return;
        onPlacementConfirm(anchors);
        return;
      }

      const clickedMagnet = getMagnetAtPosition(mouseX, mouseY);

      if (clickedMagnet) {
        // 选中该 Magnet（会自动选中其占用的所有pixels）
        selectMagnet(clickedMagnet.id);

        if ((e.ctrlKey || e.metaKey) && onMagnetCtrlClick) {
          onMagnetCtrlClick(clickedMagnet.id);
          return;
        }

        // 进入拖动 Magnet 模式
        const firstAnchor = clickedMagnet.anchors[0];
        const anchorPos = pixelPositions.get(`${firstAnchor.gridX},${firstAnchor.gridY}`);
        if (!anchorPos) return;

        capturePointer(e.pointerId);
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
        capturePointer(e.pointerId);
        startDrag(pixel.x, pixel.y);
      }
    },
    [
      editorState,
      getMagnetAtPosition,
      getPixelAtPosition,
      onMagnetCtrlClick,
      onPlacementConfirm,
      pixelPositions,
      capturePointer,
      startDrag,
      selectMagnet,
    ]
  );

  const flushMouseMove = useCallback(() => {
    moveRafRef.current = null;
    const pending = pendingMoveRef.current;
    pendingMoveRef.current = null;
    if (!pending) return;

    const { x: mouseX, y: mouseY } = pending;

    if (placementMagnetRef.current) {
      const pixel = getPixelAtPosition(mouseX, mouseY);
      if (!pixel) return;
      const key = `${pixel.x},${pixel.y}`;
      if (key !== lastHoverKeyRef.current) {
        lastHoverKeyRef.current = key;
        setHoverPixel(pixel.x, pixel.y);
      }
      return;
    }

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
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!editorState.isEditing) return;
      if (renderModeRef.current === 'pause') return;

      const activePointerId = activePointerIdRef.current;
      if (activePointerId !== null && e.pointerId !== activePointerId) {
        return;
      }

      if (
        activePointerId !== null &&
        (draggingMagnetRef.current || editorStateRef.current.isDragging) &&
        e.buttons === 0
      ) {
        releasePointer(e.pointerId);
        finishDragInteraction(true);
        return;
      }

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      pendingMoveRef.current = { x: mouseX, y: mouseY };
      if (moveRafRef.current !== null) return;
      moveRafRef.current = window.requestAnimationFrame(flushMouseMove);
    },
    [editorState.isEditing, finishDragInteraction, flushMouseMove, releasePointer]
  );

  // 处理鼠标释放
  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const activePointerId = activePointerIdRef.current;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;

    releasePointer(e.pointerId);
    finishDragInteraction(true);
  }, [finishDragInteraction, releasePointer]);

  // 处理鼠标离开
  const handlePointerLeave = useCallback(() => {
    lastHoverKeyRef.current = null;
    setHoverPixel(null, null);
  }, [setHoverPixel]);

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const activePointerId = activePointerIdRef.current;
      if (activePointerId !== null && e.pointerId !== activePointerId) return;

      releasePointer(e.pointerId);
      finishDragInteraction(false);
    },
    [finishDragInteraction, releasePointer]
  );

  const handleLostPointerCapture = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (activePointerIdRef.current !== e.pointerId) return;
      activePointerIdRef.current = null;

      if (e.buttons === 0) {
        finishDragInteraction(true);
      }
    },
    [finishDragInteraction]
  );

  const handlePointerEnter = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (
        activePointerIdRef.current !== null &&
        activePointerIdRef.current === e.pointerId &&
        (draggingMagnetRef.current || editorStateRef.current.isDragging) &&
        e.buttons === 0
      ) {
        releasePointer(e.pointerId);
        finishDragInteraction(true);
      }
    },
    [finishDragInteraction, releasePointer]
  );

  useEffect(() => {
    const handleWindowBlur = () => {
      if (!draggingMagnetRef.current && !editorStateRef.current.isDragging) return;
      releasePointer();
      finishDragInteraction(false);
    };

    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [finishDragInteraction, releasePointer]);

  const drawOverlay = useCallback(() => {
    drawRafRef.current = null;
    if (renderModeRef.current === 'pause') return;

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
    const placementMagnet = placementMagnetRef.current;
    const placementShape = placementMagnet ? resolveMagnetFootprintShape(placementMagnet) : null;

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

    if (!pixelHintsVisible && !placementMagnet) return;

    if (pixelHintsVisible) {
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
    }

    if (!placementMagnet || !placementShape) return;

    const hoveredTopLeft = state.hoverPixel ? { x: state.hoverPixel.x, y: state.hoverPixel.y } : null;
    const hoveredWithinBounds =
      hoveredTopLeft &&
      hoveredTopLeft.x >= 0 &&
      hoveredTopLeft.y >= 0 &&
      hoveredTopLeft.x + placementShape.width <= COLUMNS &&
      hoveredTopLeft.y + placementShape.height <= ROWS;

    let hoveredIsCandidate = false;
    if (hoveredWithinBounds && hoveredTopLeft) {
      hoveredIsCandidate = true;
      for (let dy = 0; dy < placementShape.height && hoveredIsCandidate; dy++) {
        for (let dx = 0; dx < placementShape.width; dx++) {
          const key = `${hoveredTopLeft.x + dx},${hoveredTopLeft.y + dy}`;
          if (occ.get(key)?.isOccupied) {
            hoveredIsCandidate = false;
            break;
          }
        }
      }
    }

    if (hoveredIsCandidate && hoveredTopLeft) {
      const anchors = buildMagnetAnchorsAtTopLeft(placementMagnet, hoveredTopLeft);
      if (anchors) {
        const previewPixels = getMagnetOccupiedPixels({ ...placementMagnet, anchors });
        for (const pixel of previewPixels) {
          if (pixel.x === hoveredTopLeft.x && pixel.y === hoveredTopLeft.y) continue;
          const baseX = EDGE_PADDING + pixel.x * stepX;
          const baseY = EDGE_PADDING + pixel.y * stepY;
          ctx.fillStyle = 'rgba(255, 0, 200, 0.30)';
          ctx.strokeStyle = 'rgba(255, 0, 200, 0.72)';
          ctx.lineWidth = 1;
          ctx.fillRect(baseX, baseY, PIXEL_SIZE, PIXEL_SIZE);
          ctx.strokeRect(baseX + 0.5, baseY + 0.5, PIXEL_SIZE - 1, PIXEL_SIZE - 1);
        }
      }
    }

    for (let y = 0; y <= ROWS - placementShape.height; y++) {
      for (let x = 0; x <= COLUMNS - placementShape.width; x++) {
        let free = true;
        for (let dy = 0; dy < placementShape.height && free; dy++) {
          for (let dx = 0; dx < placementShape.width; dx++) {
            const key = `${x + dx},${y + dy}`;
            if (occ.get(key)?.isOccupied) {
              free = false;
              break;
            }
          }
        }
        if (!free) continue;

        const isHovered = hoveredTopLeft?.x === x && hoveredTopLeft?.y === y;
        const baseX = EDGE_PADDING + x * stepX;
        const baseY = EDGE_PADDING + y * stepY;
        const scale = isHovered ? 1.1 : 1.0;
        const w = PIXEL_SIZE * scale;
        const h = PIXEL_SIZE * scale;
        const dx = baseX + (PIXEL_SIZE - w) / 2;
        const dy = baseY + (PIXEL_SIZE - h) / 2;

        ctx.fillStyle = isHovered ? 'rgba(0, 212, 255, 0.30)' : 'rgba(0, 212, 255, 0.18)';
        ctx.strokeStyle = isHovered ? 'rgba(0, 212, 255, 0.85)' : 'rgba(0, 212, 255, 0.55)';
        ctx.lineWidth = isHovered ? 2 : 1;
        ctx.fillRect(dx, dy, w, h);
        ctx.strokeRect(dx + 0.5, dy + 0.5, w - 1, h - 1);
      }
    }
  }, [pixelHintsVisible]);

  const scheduleDraw = useCallback(() => {
    if (renderModeRef.current === 'pause') {
      pendingDrawRef.current = true;
      return;
    }
    if (drawRafRef.current !== null) return;
    drawRafRef.current = window.requestAnimationFrame(drawOverlay);
  }, [drawOverlay]);

  useEffect(() => {
    scheduleDraw();
  }, [scheduleDraw, editorState, occupancyMap, pixelPositions, draggingMagnet, placementMagnet]);

  useEffect(() => {
    if (renderMode !== 'pause') {
      if (pendingDrawRef.current) {
        pendingDrawRef.current = false;
        scheduleDraw();
      }
      return;
    }

    pendingDrawRef.current = false;

    if (moveRafRef.current !== null) {
      window.cancelAnimationFrame(moveRafRef.current);
      moveRafRef.current = null;
    }
    if (drawRafRef.current !== null) {
      window.cancelAnimationFrame(drawRafRef.current);
      drawRafRef.current = null;
    }
    pendingMoveRef.current = null;
  }, [renderMode, scheduleDraw]);

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
      const nextViewportSize = readViewportSize();
      gridLayoutRef.current = computePixelGridLayout(nextViewportSize.width, nextViewportSize.height);
      setViewportSize(nextViewportSize);
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
        className={`editor-overlay ${placementMagnet ? 'editor-overlay--placing' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
        onPointerLeave={handlePointerLeave}
        onPointerEnter={handlePointerEnter}
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
      {draggingPreview && (
        <OverlayMagnetPreview
          magnet={draggingPreview.magnet}
          pixelPositions={pixelPositions}
          layoutBounds={draggingPreview.layoutBounds}
          joinEdges={draggingPreview.joinEdges}
          outlineTone={draggingPreview.outlineTone}
        />
      )}

      {placementPreview && (
        <OverlayMagnetPreview
          magnet={placementPreview.magnet}
          pixelPositions={pixelPositions}
          layoutBounds={placementPreview.layoutBounds}
          joinEdges={placementPreview.joinEdges}
          outlineTone="placement"
          ghostOpacity={0.75}
        />
      )}
    </div>
  );
}

/**
 * 检查 pixel 是否在拖拽选择区域内
 */
