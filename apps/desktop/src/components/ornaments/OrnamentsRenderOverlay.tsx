import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  getOrnamentsOverlayGeneration,
  markOrnamentsOverlayReady,
  type OrnamentsOverlayKind,
} from '../../modules/ornaments-v2/session';
import {
  normalizeOrnamentLayerOrder,
  ornamentMediaUrl,
  useOrnamentsConfig,
} from '../../modules/ornaments-v2/store';
import { sortedOrnaments } from './ornamentLayout';
import './OrnamentsRenderOverlay.css';

const EDIT_MARGIN = 240;

function centeredOffsetCss(offset: number): string {
  return offset >= 0
    ? `calc(50% + ${offset}px)`
    : `calc(50% - ${Math.abs(offset)}px)`;
}

function renderItemStyle(item: Parameters<typeof sortedOrnaments>[0][number]): CSSProperties {
  const { width, height, offsetX, offsetY, anchor } = item.placement;
  const left = anchor.includes('left')
    ? `${EDIT_MARGIN + offsetX}px`
    : anchor.includes('right')
      ? `calc(100% - ${EDIT_MARGIN + width - offsetX}px)`
      : centeredOffsetCss(offsetX - width / 2);
  const top = anchor.startsWith('top')
    ? `${EDIT_MARGIN + offsetY}px`
    : anchor.startsWith('bottom')
      ? `calc(100% - ${EDIT_MARGIN + height - offsetY}px)`
      : centeredOffsetCss(offsetY - height / 2);

  return { left, top, width, height, zIndex: normalizeOrnamentLayerOrder(item.layer.order) };
}

export const OrnamentsRenderOverlay = memo(function OrnamentsRenderOverlay() {
  const [config] = useOrnamentsConfig();
  const [compositorReady, setCompositorReady] = useState(false);
  const hasPresentedRef = useRef(false);
  const plane = window.location.hash.includes('/behind') ? -1 : 1;
  const overlayKind: OrnamentsOverlayKind = plane === -1 ? 'behind' : 'above';
  const renderedItems = useMemo(
    () => sortedOrnaments(config.items).filter((item) => item.layer.plane === plane),
    [config.items, plane]
  );

  useEffect(() => {
    let disposed = false;
    if (!hasPresentedRef.current) {
      setCompositorReady(false);
    }
    const images = Array.from(
      document.querySelectorAll<HTMLImageElement>('.ornaments-render-overlay__item')
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

    void Promise.all([getOrnamentsOverlayGeneration(overlayKind), waitForImages]).then(
      ([generation]) => {
        if (disposed) return;
        // Let the browser commit the decoded image while the native window is
        // still hidden. The page stays invisible until native presentation has
        // completed, so WebView's first surface frame cannot flash through.
        window.requestAnimationFrame(() => {
          if (disposed) return;
          void markOrnamentsOverlayReady(overlayKind, generation)
            .catch(() => {
              // The native window may have been closed while the image was loading.
            })
            .finally(() => {
              if (disposed) return;
              window.requestAnimationFrame(() => {
                if (disposed) return;
                hasPresentedRef.current = true;
                setCompositorReady(true);
              });
            });
        });
      }
    );

    return () => {
      disposed = true;
    };
  }, [overlayKind, renderedItems]);

  return (
    <div
      className="ornaments-render-overlay"
      style={{ visibility: compositorReady ? 'visible' : 'hidden' }}
    >
      {renderedItems.map((item) => {
        return (
          <img
            key={item.id}
            className="ornaments-render-overlay__item"
            src={ornamentMediaUrl(item)}
            alt=""
            draggable={false}
            style={renderItemStyle(item)}
          />
        );
      })}
    </div>
  );
});
