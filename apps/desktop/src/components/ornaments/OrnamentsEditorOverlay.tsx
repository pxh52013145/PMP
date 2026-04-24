import { memo, useCallback, useMemo, useState } from 'react';
import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';
import {
  ornamentMediaUrl,
  type OrnamentItem,
  type OrnamentsConfigV2,
  useOrnamentsConfig,
} from '../../modules/ornaments-v2/store';
import { offsetFromRect, ornamentRect, sortedOrnaments, type OrnamentRect } from './ornamentLayout';
import './OrnamentsEditorOverlay.css';

const EDIT_MARGIN = 240;
const TOOLBAR_WIDTH = 224;
const TOOLBAR_HEIGHT = 38;
const TOOLBAR_GAP = 12;
const EDGE_PADDING = 12;
const MIN_ORNAMENT_SIZE = 32;

function toEditorRect(rect: OrnamentRect): OrnamentRect {
  return { ...rect, left: rect.left + EDIT_MARGIN, top: rect.top + EDIT_MARGIN };
}

function toMainRect(rect: OrnamentRect): OrnamentRect {
  return { ...rect, left: rect.left - EDIT_MARGIN, top: rect.top - EDIT_MARGIN };
}

type DragState =
  | {
      kind: 'move';
      itemId: string;
      pointerId: number;
      startX: number;
      startY: number;
      startRect: OrnamentRect;
    }
  | {
      kind: 'resize';
      itemId: string;
      pointerId: number;
      handle: string;
      startX: number;
      startY: number;
      startRect: OrnamentRect;
    };

function updateItem(config: OrnamentsConfigV2, itemId: string, updater: (item: OrnamentItem) => OrnamentItem): OrnamentsConfigV2 {
  return {
    ...config,
    items: config.items.map((item) => (item.id === itemId ? updater(item) : item)),
  };
}

function maxOrder(items: readonly OrnamentItem[], plane: number): number {
  return items.reduce((max, item) => (item.layer.plane === plane ? Math.max(max, item.layer.order) : max), 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

type ToolbarPlacement = {
  className: string;
  style: React.CSSProperties;
};

function toolbarPlacement(rect: OrnamentRect, overlayWidth: number, overlayHeight: number): ToolbarPlacement {
  const centeredLeft = rect.left + rect.width / 2 - TOOLBAR_WIDTH / 2;
  const clampedLeft = clamp(centeredLeft, EDGE_PADDING, Math.max(EDGE_PADDING, overlayWidth - TOOLBAR_WIDTH - EDGE_PADDING));
  const bottomTop = rect.top + rect.height + TOOLBAR_GAP;
  const topTop = rect.top - TOOLBAR_HEIGHT - TOOLBAR_GAP;

  if (bottomTop + TOOLBAR_HEIGHT <= overlayHeight - EDGE_PADDING) {
    return {
      className: 'ornaments-editor-overlay__toolbar ornaments-editor-overlay__toolbar--bottom',
      style: { left: clampedLeft, top: bottomTop },
    };
  }

  if (topTop >= EDGE_PADDING) {
    return {
      className: 'ornaments-editor-overlay__toolbar ornaments-editor-overlay__toolbar--top',
      style: { left: clampedLeft, top: topTop },
    };
  }

  const rightLeft = rect.left + rect.width + TOOLBAR_GAP;
  const leftLeft = rect.left - TOOLBAR_WIDTH - TOOLBAR_GAP;
  const sideTop = clamp(
    rect.top + rect.height / 2 - TOOLBAR_HEIGHT / 2,
    EDGE_PADDING,
    Math.max(EDGE_PADDING, overlayHeight - TOOLBAR_HEIGHT - EDGE_PADDING)
  );

  if (rightLeft + TOOLBAR_WIDTH <= overlayWidth - EDGE_PADDING) {
    return {
      className: 'ornaments-editor-overlay__toolbar ornaments-editor-overlay__toolbar--right',
      style: { left: rightLeft, top: sideTop },
    };
  }

  return {
    className: 'ornaments-editor-overlay__toolbar ornaments-editor-overlay__toolbar--left',
    style: { left: Math.max(EDGE_PADDING, leftLeft), top: sideTop },
  };
}

function editorBounds(overlayWidth: number, overlayHeight: number): OrnamentRect {
  return {
    left: EDGE_PADDING,
    top: EDGE_PADDING,
    width: Math.max(MIN_ORNAMENT_SIZE, overlayWidth - EDGE_PADDING * 2),
    height: Math.max(MIN_ORNAMENT_SIZE, overlayHeight - EDGE_PADDING * 2),
  };
}

function constrainMoveRect(rect: OrnamentRect, bounds: OrnamentRect): OrnamentRect {
  const width = Math.min(rect.width, bounds.width);
  const height = Math.min(rect.height, bounds.height);
  return {
    left: clamp(rect.left, bounds.left, bounds.left + bounds.width - width),
    top: clamp(rect.top, bounds.top, bounds.top + bounds.height - height),
    width,
    height,
  };
}

function constrainResizeRect(rect: OrnamentRect, bounds: OrnamentRect, handle: string): OrnamentRect {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  let left = rect.left;
  let top = rect.top;
  let width = rect.width;
  let height = rect.height;

  if (handle.includes('w')) {
    left = clamp(left, bounds.left, right - MIN_ORNAMENT_SIZE);
    width = right - left;
  } else {
    width = Math.min(Math.max(width, MIN_ORNAMENT_SIZE), bounds.left + bounds.width - left);
  }

  if (handle.includes('n')) {
    top = clamp(top, bounds.top, bottom - MIN_ORNAMENT_SIZE);
    height = bottom - top;
  } else {
    height = Math.min(Math.max(height, MIN_ORNAMENT_SIZE), bounds.top + bounds.height - top);
  }

  return constrainMoveRect({ left, top, width, height }, bounds);
}

export const OrnamentsEditorOverlay = memo(function OrnamentsEditorOverlay() {
  const [config, setConfig] = useOrnamentsConfig();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const viewportWidth = Math.max(1, window.innerWidth - EDIT_MARGIN * 2);
  const viewportHeight = Math.max(1, window.innerHeight - EDIT_MARGIN * 2);
  const bounds = useMemo(() => editorBounds(window.innerWidth, window.innerHeight), []);
  const selected = config.items.find((item) => item.id === selectedId) ?? null;

  const orderedItems = useMemo(() => sortedOrnaments(config.items), [config.items]);

  const persistItemRect = useCallback(
    async (itemId: string, rect: OrnamentRect) => {
      const item = config.items.find((candidate) => candidate.id === itemId);
      if (!item) return;
      const offset = offsetFromRect(item, toMainRect(rect), viewportWidth, viewportHeight);
      await setConfig(updateItem(config, itemId, (current) => ({
        ...current,
        placement: {
          ...current.placement,
          ...offset,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      })));
    },
    [config, setConfig, viewportHeight, viewportWidth]
  );

  const bringForwardInPlane = useCallback(
    async (itemId: string) => {
      const item = config.items.find((candidate) => candidate.id === itemId);
      if (!item) return;
      await setConfig(updateItem(config, itemId, (current) => ({
        ...current,
        layer: {
          ...current.layer,
          order: maxOrder(config.items, current.layer.plane) + 1,
        },
      })));
    },
    [config, setConfig]
  );

  const handleItemPointerDown = useCallback(
    (event: React.PointerEvent<HTMLImageElement>, item: OrnamentItem) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const rect = toEditorRect(ornamentRect(item, viewportWidth, viewportHeight));
      setSelectedId(item.id);
      void bringForwardInPlane(item.id);
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragState({
        kind: 'move',
        itemId: item.id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startRect: rect,
      });
    },
    [bringForwardInPlane, viewportHeight, viewportWidth]
  );

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, handle: string) => {
      if (event.button !== 0 || !selected) return;
      event.stopPropagation();
      const rect = toEditorRect(ornamentRect(selected, viewportWidth, viewportHeight));
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragState({
        kind: 'resize',
        itemId: selected.id,
        pointerId: event.pointerId,
        handle,
        startX: event.clientX,
        startY: event.clientY,
        startRect: rect,
      });
    },
    [selected, viewportHeight, viewportWidth]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const dx = event.clientX - dragState.startX;
      const dy = event.clientY - dragState.startY;
      const item = config.items.find((candidate) => candidate.id === dragState.itemId);
      if (!item) return;

      let rect: OrnamentRect = { ...dragState.startRect };
      if (dragState.kind === 'move') {
        rect = constrainMoveRect({ ...rect, left: rect.left + dx, top: rect.top + dy }, bounds);
      } else {
        if (dragState.handle.includes('e')) rect.width = Math.max(MIN_ORNAMENT_SIZE, rect.width + dx);
        if (dragState.handle.includes('s')) rect.height = Math.max(MIN_ORNAMENT_SIZE, rect.height + dy);
        if (dragState.handle.includes('w')) {
          const width = Math.max(MIN_ORNAMENT_SIZE, rect.width - dx);
          rect.left += rect.width - width;
          rect.width = width;
        }
        if (dragState.handle.includes('n')) {
          const height = Math.max(MIN_ORNAMENT_SIZE, rect.height - dy);
          rect.top += rect.height - height;
          rect.height = height;
        }
        rect = constrainResizeRect(rect, bounds, dragState.handle);
      }

      const offset = offsetFromRect(item, toMainRect(rect), viewportWidth, viewportHeight);
      void setConfig(updateItem(config, item.id, (current) => ({
        ...current,
        placement: {
          ...current.placement,
          ...offset,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      })));
    },
    [bounds, config, dragState, setConfig, viewportHeight, viewportWidth]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      setDragState(null);
      const item = config.items.find((candidate) => candidate.id === dragState.itemId);
      if (item) {
        void persistItemRect(item.id, toEditorRect(ornamentRect(item, viewportWidth, viewportHeight)));
      }
    },
    [config.items, dragState, persistItemRect, viewportHeight, viewportWidth]
  );

  const handleOverlayPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (event.target !== event.currentTarget) return;
    setSelectedId(null);
    void invokeWithTelemetry('ornaments_drag_main_window', undefined, {
      moduleId: 'ornaments',
      component: 'OrnamentsEditorOverlay',
      event: 'ornaments.editor-overlay.drag-main-window',
    });
  }, []);

  const changePlane = useCallback(async (plane: -1 | 1) => {
    if (!selected) return;
    await setConfig(updateItem(config, selected.id, (current) => ({
      ...current,
      layer: {
        plane,
        order: maxOrder(config.items, plane) + 1,
      },
    })));
  }, [config, selected, setConfig]);

  const nudgeOrder = useCallback(async (direction: -1 | 1) => {
    if (!selected) return;
    await setConfig(updateItem(config, selected.id, (current) => ({
      ...current,
      layer: {
        ...current.layer,
        order: current.layer.order + direction,
      },
    })));
  }, [config, selected, setConfig]);

  const deleteSelected = useCallback(async () => {
    if (!selected) return;
    await setConfig({ ...config, items: config.items.filter((item) => item.id !== selected.id) });
    setSelectedId(null);
  }, [config, selected, setConfig]);

  return (
    <div
      className="ornaments-editor-overlay"
      onPointerDown={handleOverlayPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="ornaments-editor-overlay__main-mask" />
      {orderedItems.map((item) => {
        const rect = toEditorRect(ornamentRect(item, viewportWidth, viewportHeight));
        const isSelected = item.id === selectedId;
        const toolbar = toolbarPlacement(rect, window.innerWidth, window.innerHeight);
        return (
          <div
            key={item.id}
            className={`ornaments-editor-overlay__item-shell ${isSelected ? 'selected' : ''}`}
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              zIndex: item.layer.plane * 100000 + item.layer.order,
            }}
          >
            <img
              className="ornaments-editor-overlay__item"
              src={ornamentMediaUrl(item)}
              alt=""
              draggable={false}
              onPointerDown={(event) => handleItemPointerDown(event, item)}
            />
            {isSelected && (
              <>
                {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((handle) => (
                  <button
                    key={handle}
                    type="button"
                    className={`ornaments-editor-overlay__resize ornaments-editor-overlay__resize--${handle}`}
                    aria-label={handle}
                    onPointerDown={(event) => handleResizePointerDown(event, handle)}
                  />
                ))}
                <div className={toolbar.className} style={toolbar.style}>
                  <button type="button" title="置于窗前" onClick={() => void changePlane(1)}>
                    <span className="ornaments-editor-overlay__toolbar-icon">⬆</span>
                    <span>窗前</span>
                  </button>
                  <button type="button" title="置于窗后" onClick={() => void changePlane(-1)}>
                    <span className="ornaments-editor-overlay__toolbar-icon">⬇</span>
                    <span>窗后</span>
                  </button>
                  <button type="button" title="同层上移" onClick={() => void nudgeOrder(1)}>
                    <span className="ornaments-editor-overlay__toolbar-icon">＋</span>
                    <span>上移</span>
                  </button>
                  <button type="button" title="同层下移" onClick={() => void nudgeOrder(-1)}>
                    <span className="ornaments-editor-overlay__toolbar-icon">－</span>
                    <span>下移</span>
                  </button>
                  <button type="button" title="删除挂件" className="danger" onClick={() => void deleteSelected()}>
                    <span className="ornaments-editor-overlay__toolbar-icon">×</span>
                    <span>删除</span>
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
      <div className="ornaments-editor-overlay__hint">窗口挂件编辑中 · 拖拽空白区域移动主窗口</div>
    </div>
  );
});
