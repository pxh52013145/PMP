import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useRef } from 'react';
import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';
import { useT } from '../../i18n';
import {
  getOrnamentsOverlayGeneration,
  markOrnamentsOverlayReady,
} from '../../modules/ornaments-v2/session';
import {
  ornamentMediaUrl,
  normalizeOrnamentLayerOrder,
  nextOrnamentLayerOrder,
  type OrnamentItem,
  type OrnamentsConfigV2,
  useOrnamentsConfig,
} from '../../modules/ornaments-v2/store';
import { offsetFromRect, ornamentRect, sortedOrnaments, type OrnamentRect } from './ornamentLayout';
import './OrnamentsEditorOverlay.css';

const EDIT_MARGIN = 240;
const TOOLBAR_WIDTH = 38;
const TOOLBAR_HEIGHT = 248;
const TOOLBAR_GAP = 10;
const EDGE_PADDING = 12;
const MIN_ORNAMENT_SIZE = 32;
const HANDLE_VISUAL_OUTSET = 6;

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

function editorZIndex(item: OrnamentItem, selectedId: string | null): number {
  const planeRank = item.layer.plane === -1 ? 0 : 1;
  const base = planeRank * 10_000 + normalizeOrnamentLayerOrder(item.layer.order);
  return item.id === selectedId ? 1_000_000 + base : 10_000 + base;
}

type TechLineIconName = 'front' | 'behind' | 'raise' | 'lower' | 'delete';

function TechLineIcon({ name }: { name: TechLineIconName }) {
  const common = {
    className: 'ornaments-editor-overlay__toolbar-icon',
    viewBox: '0 0 24 24',
    width: 18,
    height: 18,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.45,
    strokeLinecap: 'square' as const,
    strokeLinejoin: 'miter' as const,
    'aria-hidden': true,
  };

  if (name === 'front') {
    return (
      <svg {...common}>
        <path d="M6 5h12l2 2v10l-2 2H6l-2-2V7l2-2Z" />
        <path d="M8 11h8l2 2-2 2H8l-2-2 2-2Z" />
        <path d="M12 9V3m-3 3 3-3 3 3" />
      </svg>
    );
  }

  if (name === 'behind') {
    return (
      <svg {...common}>
        <path d="M6 5h12l2 2v10l-2 2H6l-2-2V7l2-2Z" />
        <path d="M8 11h8l2 2-2 2H8l-2-2 2-2Z" />
        <path d="M12 15v6m-3-3 3 3 3-3" />
        <path d="M4 13h4m8 0h4" />
      </svg>
    );
  }

  if (name === 'raise' || name === 'lower') {
    const isRaise = name === 'raise';
    return (
      <svg {...common}>
        <path d={isRaise ? 'M5 18.5h14M12 18.5V5.5M7.5 10 12 5.5l4.5 4.5' : 'M5 5.5h14M12 5.5v13M7.5 14 12 18.5l4.5-4.5'} />
        <path d={isRaise ? 'M5 3.5h4M5 3.5v4' : 'M19 20.5h-4M19 20.5v-4'} />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M6 8.5h12v11H6zM4 5.5h16M9 3.5h6M9.5 11.5v5M14.5 11.5v5" />
      <path d="m4 5.5 1.5-2h3M20 5.5l-1.5-2h-3" />
    </svg>
  );
}

function adjustItemOrderWithinPlane(
  config: OrnamentsConfigV2,
  itemId: string,
  direction: -1 | 1
): OrnamentsConfigV2 {
  const item = config.items.find((candidate) => candidate.id === itemId);
  if (!item) return config;

  const currentOrder = normalizeOrnamentLayerOrder(item.layer.order);
  const nextOrder = Math.max(1, currentOrder + direction);
  if (nextOrder === currentOrder) return config;
  const conflicting = config.items.find(
    (candidate) =>
      candidate.id !== itemId &&
      candidate.enabled &&
      candidate.layer.plane === item.layer.plane &&
      normalizeOrnamentLayerOrder(candidate.layer.order) === nextOrder
  );

  return {
    ...config,
    items: config.items.map((candidate) => {
      if (candidate.id === itemId) {
        return { ...candidate, layer: { ...candidate.layer, order: nextOrder } };
      }
      if (conflicting && candidate.id === conflicting.id) {
        return { ...candidate, layer: { ...candidate.layer, order: currentOrder } };
      }
      return candidate;
    }),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

type ToolbarPlacement = {
  className: string;
  style: React.CSSProperties;
};

function toolbarPlacement(rect: OrnamentRect, overlayWidth: number, overlayHeight: number): ToolbarPlacement {
  const centeredTop = rect.top + rect.height / 2 - TOOLBAR_HEIGHT / 2;
  const clampedTop = clamp(centeredTop, EDGE_PADDING, Math.max(EDGE_PADDING, overlayHeight - TOOLBAR_HEIGHT - EDGE_PADDING));
  const leftLeft = rect.left - TOOLBAR_WIDTH - TOOLBAR_GAP;
  const rightLeft = rect.left + rect.width + TOOLBAR_GAP;

  if (leftLeft >= EDGE_PADDING) {
    return {
      className: 'ornaments-editor-overlay__toolbar ornaments-editor-overlay__toolbar--left',
      style: { left: leftLeft, top: clampedTop },
    };
  }

  if (rightLeft + TOOLBAR_WIDTH <= overlayWidth - EDGE_PADDING) {
    return {
      className: 'ornaments-editor-overlay__toolbar ornaments-editor-overlay__toolbar--right',
      style: { left: rightLeft, top: clampedTop },
    };
  }

  const bottomTop = rect.top + rect.height + TOOLBAR_GAP;
  const topTop = rect.top - TOOLBAR_HEIGHT - TOOLBAR_GAP;
  const horizontalLeft = clamp(
    rect.left + rect.width / 2 - TOOLBAR_WIDTH / 2,
    EDGE_PADDING,
    Math.max(EDGE_PADDING, overlayWidth - TOOLBAR_WIDTH - EDGE_PADDING)
  );

  if (bottomTop + TOOLBAR_HEIGHT <= overlayHeight - EDGE_PADDING) {
    return {
      className: 'ornaments-editor-overlay__toolbar ornaments-editor-overlay__toolbar--bottom',
      style: { left: horizontalLeft, top: bottomTop },
    };
  }

  return {
    className: 'ornaments-editor-overlay__toolbar ornaments-editor-overlay__toolbar--top',
    style: { left: horizontalLeft, top: Math.max(EDGE_PADDING, topTop) },
  };
}

function editorBounds(overlayWidth: number, overlayHeight: number): OrnamentRect {
  return {
    left: HANDLE_VISUAL_OUTSET,
    top: HANDLE_VISUAL_OUTSET,
    width: Math.max(MIN_ORNAMENT_SIZE, overlayWidth - HANDLE_VISUAL_OUTSET * 2),
    height: Math.max(MIN_ORNAMENT_SIZE, overlayHeight - HANDLE_VISUAL_OUTSET * 2),
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
  const t = useT();
  const [config, setConfig] = useOrnamentsConfig();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const latestDragRectRef = useRef<{ itemId: string; rect: OrnamentRect } | null>(null);
  const viewportWidth = Math.max(1, window.innerWidth - EDIT_MARGIN * 2);
  const viewportHeight = Math.max(1, window.innerHeight - EDIT_MARGIN * 2);
  const bounds = useMemo(() => editorBounds(window.innerWidth, window.innerHeight), []);
  const selected = config.items.find((item) => item.id === selectedId) ?? null;

  const orderedItems = useMemo(() => sortedOrnaments(config.items), [config.items]);

  useEffect(() => {
    let disposed = false;
    const images = Array.from(
      document.querySelectorAll<HTMLImageElement>('.ornaments-editor-overlay__item')
    );
    const waitForImages = Promise.all(
      images.map(async (image) => {
        if (!image.complete) {
          await new Promise<void>((resolve) => {
            const resolveOnce = () => resolve();
            image.addEventListener('load', resolveOnce, { once: true });
            image.addEventListener('error', resolveOnce, { once: true });
          });
        }
        if (typeof image.decode === 'function') {
          await image.decode().catch(() => undefined);
        }
      })
    );

    void Promise.all([getOrnamentsOverlayGeneration('editor'), waitForImages]).then(
      ([generation]) => {
        if (disposed) return;
        window.requestAnimationFrame(() => {
          window.setTimeout(() => {
            if (disposed) return;
            void markOrnamentsOverlayReady('editor', generation).catch(() => {
              // The native window may have been closed while the image was loading.
            });
          });
        });
      }
    );

    return () => {
      disposed = true;
    };
  }, [orderedItems]);

  const persistItemRect = useCallback(
    async (itemId: string, rect: OrnamentRect) => {
      await setConfig((current) => updateItem(current, itemId, (currentItem) => ({
        ...currentItem,
        placement: {
          ...currentItem.placement,
          ...offsetFromRect(currentItem, toMainRect(rect), viewportWidth, viewportHeight),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      })));
    },
    [setConfig, viewportHeight, viewportWidth]
  );

  const handleItemPointerDown = useCallback(
    (event: React.PointerEvent<HTMLImageElement>, item: OrnamentItem) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const rect = toEditorRect(ornamentRect(item, viewportWidth, viewportHeight));
      setSelectedId(item.id);
      event.currentTarget.setPointerCapture(event.pointerId);
      latestDragRectRef.current = { itemId: item.id, rect };
      setDragState({
        kind: 'move',
        itemId: item.id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startRect: rect,
      });
    },
    [viewportHeight, viewportWidth]
  );

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, handle: string) => {
      if (event.button !== 0 || !selected) return;
      event.stopPropagation();
      const rect = toEditorRect(ornamentRect(selected, viewportWidth, viewportHeight));
      event.currentTarget.setPointerCapture(event.pointerId);
      latestDragRectRef.current = { itemId: selected.id, rect };
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

      latestDragRectRef.current = { itemId: dragState.itemId, rect };
      void setConfig((current) => updateItem(current, dragState.itemId, (currentItem) => ({
        ...currentItem,
        placement: {
          ...currentItem.placement,
          ...offsetFromRect(currentItem, toMainRect(rect), viewportWidth, viewportHeight),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      })));
    },
    [bounds, dragState, setConfig, viewportHeight, viewportWidth]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      setDragState(null);
      const latest = latestDragRectRef.current;
      latestDragRectRef.current = null;
      if (latest?.itemId === dragState.itemId) {
        void persistItemRect(latest.itemId, latest.rect);
      }
    },
    [dragState, persistItemRect]
  );

  const handleOverlayPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    setSelectedId(null);
    void invokeWithTelemetry('ornaments_drag_main_window', undefined, {
      moduleId: 'ornaments',
      component: 'OrnamentsEditorOverlay',
      event: 'ornaments.editor-overlay.drag-main-window',
    });
  }, []);

  const changePlane = useCallback(async (plane: -1 | 1) => {
    if (!selected) return;
    if (selected.layer.plane === plane) return;
    await setConfig((current) => {
      const currentItem = current.items.find((item) => item.id === selected.id);
      if (!currentItem || currentItem.layer.plane === plane) return current;
      return updateItem(current, selected.id, (item) => ({
        ...item,
        layer: {
          plane,
          order: nextOrnamentLayerOrder(current.items, plane),
        },
      }));
    });
  }, [selected, setConfig]);

  const nudgeOrder = useCallback(async (direction: -1 | 1) => {
    if (!selected) return;
    await setConfig((current) => adjustItemOrderWithinPlane(current, selected.id, direction));
  }, [selected, setConfig]);

  const deleteSelected = useCallback(async () => {
    if (!selected) return;
    const deletedId = selected.id;
    await setConfig((current) => ({
      ...current,
      items: current.items.filter((item) => item.id !== deletedId),
    }));
    setSelectedId(null);
  }, [selected, setConfig]);

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
        const layerOrder = normalizeOrnamentLayerOrder(item.layer.order);
        return (
          <div
            key={item.id}
            className={`ornaments-editor-overlay__item-shell ${isSelected ? 'selected' : ''}`}
            data-plane={item.layer.plane === -1 ? 'behind' : 'above'}
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              zIndex: editorZIndex(item, selectedId),
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
                  <button
                    type="button"
                    title={t('editor.style-bar.ornaments.bringToFront')}
                    className={item.layer.plane === 1 ? 'active' : ''}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => void changePlane(1)}
                  >
                    <TechLineIcon name="front" />
                    <span className="ornaments-editor-overlay__toolbar-label">{t('editor.style-bar.ornaments.bringToFront')}</span>
                  </button>
                  <button
                    type="button"
                    title={t('editor.style-bar.ornaments.sendToBack')}
                    className={item.layer.plane === -1 ? 'active' : ''}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => void changePlane(-1)}
                  >
                    <TechLineIcon name="behind" />
                    <span className="ornaments-editor-overlay__toolbar-label">{t('editor.style-bar.ornaments.sendToBack')}</span>
                  </button>
                  <button
                    type="button"
                    title={t('editor.style-bar.ornaments.raiseLayer')}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => void nudgeOrder(1)}
                  >
                    <TechLineIcon name="raise" />
                    <span className="ornaments-editor-overlay__toolbar-label">{t('editor.style-bar.ornaments.raiseLayer')}</span>
                  </button>
                  <button
                    type="button"
                    title={t('editor.style-bar.ornaments.lowerLayer')}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => void nudgeOrder(-1)}
                  >
                    <TechLineIcon name="lower" />
                    <span className="ornaments-editor-overlay__toolbar-label">{t('editor.style-bar.ornaments.lowerLayer')}</span>
                  </button>
                  <button
                    type="button"
                    title={t('editor.style-bar.ornaments.delete')}
                    className="danger"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => void deleteSelected()}
                  >
                    <TechLineIcon name="delete" />
                    <span className="ornaments-editor-overlay__toolbar-label">{t('editor.style-bar.ornaments.delete')}</span>
                  </button>
                </div>
              </>
            )}
            <div
              className={`ornaments-editor-overlay__layer-indicator${isSelected ? ' is-selected' : ''}`}
              title={t('editor.style-bar.ornaments.layerHint')}
              onPointerDown={(event) => {
                event.stopPropagation();
                if (!isSelected) setSelectedId(item.id);
              }}
            >
              {isSelected ? (
                <>
                  <span className="ornaments-editor-overlay__layer-label">{t('editor.style-bar.ornaments.layer')}</span>
                  <span className="ornaments-editor-overlay__layer-value">{layerOrder}</span>
                </>
              ) : (
                <span
                  className="ornaments-editor-overlay__layer-value"
                  aria-label={`${t('editor.style-bar.ornaments.layer')}: ${layerOrder}`}
                >
                  {layerOrder}
                </span>
              )}
            </div>
          </div>
        );
      })}
      <div className="ornaments-editor-overlay__hint">{t('editor.style-bar.ornaments.editingDesc')}</div>
    </div>
  );
});
