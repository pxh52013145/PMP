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

export const OrnamentsEditorOverlay = memo(function OrnamentsEditorOverlay() {
  const [config, setConfig] = useOrnamentsConfig();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const viewportWidth = Math.max(1, window.innerWidth - EDIT_MARGIN * 2);
  const viewportHeight = Math.max(1, window.innerHeight - EDIT_MARGIN * 2);
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
        rect = { ...rect, left: rect.left + dx, top: rect.top + dy };
      } else {
        const minSize = 32;
        if (dragState.handle.includes('e')) rect.width = Math.max(minSize, rect.width + dx);
        if (dragState.handle.includes('s')) rect.height = Math.max(minSize, rect.height + dy);
        if (dragState.handle.includes('w')) {
          const width = Math.max(minSize, rect.width - dx);
          rect.left += rect.width - width;
          rect.width = width;
        }
        if (dragState.handle.includes('n')) {
          const height = Math.max(minSize, rect.height - dy);
          rect.top += rect.height - height;
          rect.height = height;
        }
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
    [config, dragState, setConfig, viewportHeight, viewportWidth]
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
                <div className="ornaments-editor-overlay__toolbar">
                  <button type="button" onClick={() => void changePlane(1)}>窗前</button>
                  <button type="button" onClick={() => void changePlane(-1)}>窗后</button>
                  <button type="button" onClick={() => void nudgeOrder(1)}>上移</button>
                  <button type="button" onClick={() => void nudgeOrder(-1)}>下移</button>
                  <button type="button" onClick={() => void deleteSelected()}>删除</button>
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
