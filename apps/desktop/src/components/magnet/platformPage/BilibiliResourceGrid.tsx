import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildBilibiliPreparedResourceKey,
  type BilibiliFavoriteResourceItem,
  type BilibiliQualityBadge,
} from '../../../modules/music-platform/bilibiliWorkspaceModel';
import { Tv } from 'lucide-react';
import { PlatformResourceCard } from './PlatformResourceCard';

type Translator = (key: string, params?: Record<string, string | number>) => string;

const RESOURCE_GRID_MIN_COLUMN_WIDTH_PX = 250;
const RESOURCE_GRID_COLUMN_GAP_PX = 12;
const RESOURCE_GRID_ROW_GAP_PX = 12;
const RESOURCE_GRID_DEFAULT_ROW_HEIGHT_PX = 112;
const RESOURCE_GRID_MIN_VIEWPORT_HEIGHT_PX = 280;
const RESOURCE_GRID_OVERSCAN_ROWS = 4;

type ResourceGridViewportSnapshot = {
  scrollTop: number;
  width: number;
  height: number;
};

function resolveResourceGridColumns(viewportWidth: number): number {
  const safeViewportWidth = Number.isFinite(viewportWidth) ? viewportWidth : 0;
  if (safeViewportWidth <= 0) return 1;
  return Math.max(
    1,
    Math.floor(
      (safeViewportWidth + RESOURCE_GRID_COLUMN_GAP_PX) /
        (RESOURCE_GRID_MIN_COLUMN_WIDTH_PX + RESOURCE_GRID_COLUMN_GAP_PX)
    )
  );
}

type BilibiliResourceGridProps = {
  items: BilibiliFavoriteResourceItem[];
  resourcePageHasMore: boolean;
  resourcePageAvailable: boolean;
  resourceLoadingMore: boolean;
  preparingResourceId: string | null;
  normalizedPlaybackQualityHint: string;
  resourceCoverUrlMap: Record<string, string>;
  resourceQualityTagMap: Record<string, BilibiliQualityBadge[]>;
  resourceViewportRef: React.RefObject<HTMLDivElement>;
  resourceLoadMoreSentinelRef: React.RefObject<HTMLDivElement>;
  t: Translator;
  getResourceCacheKey: (item: BilibiliFavoriteResourceItem) => string;
  getQualityBadgeLabel: (badge: BilibiliQualityBadge) => string;
  formatDuration: (seconds: number | undefined) => string;
  onContextMenu: (item: BilibiliFavoriteResourceItem, event: React.MouseEvent) => void;
};

export function BilibiliResourceGrid(props: BilibiliResourceGridProps) {
  const {
    items,
    resourcePageHasMore,
    resourcePageAvailable,
    resourceLoadingMore,
    preparingResourceId,
    normalizedPlaybackQualityHint,
    resourceCoverUrlMap,
    resourceQualityTagMap,
    resourceViewportRef,
    resourceLoadMoreSentinelRef,
    t,
    getResourceCacheKey,
    getQualityBadgeLabel,
    formatDuration,
    onContextMenu,
  } = props;
  const hasRenderableItems = items.length > 0;

  const sampleRowRef = useRef<HTMLDivElement | null>(null);
  const [gridViewport, setGridViewport] = useState<ResourceGridViewportSnapshot>({
    scrollTop: 0,
    width: 0,
    height: RESOURCE_GRID_MIN_VIEWPORT_HEIGHT_PX,
  });
  const [virtualRowHeightPx, setVirtualRowHeightPx] = useState<number>(RESOURCE_GRID_DEFAULT_ROW_HEIGHT_PX);

  useEffect(() => {
    const viewportElement = resourceViewportRef.current;
    if (!viewportElement) return;

    const syncViewport = () => {
      const nextSnapshot: ResourceGridViewportSnapshot = {
        scrollTop: viewportElement.scrollTop,
        width: viewportElement.clientWidth,
        height: viewportElement.clientHeight,
      };
      setGridViewport((previous) => {
        if (
          previous.scrollTop === nextSnapshot.scrollTop &&
          previous.width === nextSnapshot.width &&
          previous.height === nextSnapshot.height
        ) {
          return previous;
        }
        return nextSnapshot;
      });
    };

    syncViewport();
    const handleScroll = () => {
      setGridViewport((previous) => {
        const nextScrollTop = viewportElement.scrollTop;
        if (previous.scrollTop === nextScrollTop) return previous;
        return { ...previous, scrollTop: nextScrollTop };
      });
    };

    viewportElement.addEventListener('scroll', handleScroll, { passive: true });

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        viewportElement.removeEventListener('scroll', handleScroll);
      };
    }

    const viewportObserver = new ResizeObserver(() => {
      syncViewport();
    });
    viewportObserver.observe(viewportElement);

    return () => {
      viewportElement.removeEventListener('scroll', handleScroll);
      viewportObserver.disconnect();
    };
  }, [resourceViewportRef]);

  useEffect(() => {
    const sampleRow = sampleRowRef.current;
    if (!sampleRow) return;

    const syncRowHeight = () => {
      const measuredHeight = Math.ceil(sampleRow.getBoundingClientRect().height);
      if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) return;
      setVirtualRowHeightPx((previous) => {
        if (Math.abs(previous - measuredHeight) <= 1) return previous;
        return measuredHeight;
      });
    };

    syncRowHeight();

    if (typeof ResizeObserver === 'undefined') return;
    const sampleObserver = new ResizeObserver(() => {
      syncRowHeight();
    });
    sampleObserver.observe(sampleRow);
    return () => sampleObserver.disconnect();
  }, [items.length, gridViewport.width]);

  const virtualColumns = useMemo(
    () => resolveResourceGridColumns(gridViewport.width),
    [gridViewport.width]
  );
  const virtualRowCount = useMemo(
    () => Math.ceil(items.length / Math.max(1, virtualColumns)),
    [items.length, virtualColumns]
  );
  const virtualRowStridePx = virtualRowHeightPx + RESOURCE_GRID_ROW_GAP_PX;
  const virtualViewportHeightPx = Math.max(RESOURCE_GRID_MIN_VIEWPORT_HEIGHT_PX, gridViewport.height);

  const virtualWindow = useMemo(() => {
    if (virtualRowCount <= 0) {
      return {
        startRow: 0,
        endRow: 0,
        topSpacerPx: 0,
        bottomSpacerPx: 0,
      };
    }

    const visibleRowCount = Math.max(1, Math.ceil(virtualViewportHeightPx / virtualRowStridePx));
    const rawStartRow = Math.max(
      0,
      Math.floor(gridViewport.scrollTop / virtualRowStridePx) - RESOURCE_GRID_OVERSCAN_ROWS
    );
    const maxStartRow = Math.max(0, virtualRowCount - visibleRowCount);
    const startRow = Math.min(rawStartRow, maxStartRow);
    const endRow = Math.min(
      virtualRowCount,
      startRow + visibleRowCount + RESOURCE_GRID_OVERSCAN_ROWS * 2
    );
    const visibleRows = Math.max(0, endRow - startRow);
    const totalHeightPx =
      virtualRowCount * virtualRowHeightPx + Math.max(0, virtualRowCount - 1) * RESOURCE_GRID_ROW_GAP_PX;
    const topSpacerPx = startRow * virtualRowStridePx;
    const visibleHeightPx =
      visibleRows * virtualRowHeightPx + Math.max(0, visibleRows - 1) * RESOURCE_GRID_ROW_GAP_PX;
    const bottomSpacerPx = Math.max(0, totalHeightPx - topSpacerPx - visibleHeightPx);

    return {
      startRow,
      endRow,
      topSpacerPx,
      bottomSpacerPx,
    };
  }, [
    gridViewport.scrollTop,
    virtualRowCount,
    virtualRowHeightPx,
    virtualRowStridePx,
    virtualViewportHeightPx,
  ]);

  const visibleRows = useMemo(() => {
    const rows: Array<{
      rowIndex: number;
      rowItems: BilibiliFavoriteResourceItem[];
    }> = [];

    for (let rowIndex = virtualWindow.startRow; rowIndex < virtualWindow.endRow; rowIndex += 1) {
      const rowStart = rowIndex * virtualColumns;
      rows.push({
        rowIndex,
        rowItems: items.slice(rowStart, rowStart + virtualColumns),
      });
    }

    return rows;
  }, [items, virtualColumns, virtualWindow.endRow, virtualWindow.startRow]);

  const attachSampleRow = useCallback((node: HTMLDivElement | null) => {
    sampleRowRef.current = node;
  }, []);

  return (
    <div className="platform-magnet-bilibili-resource-grid">
      {virtualWindow.topSpacerPx > 0 ? (
        <div
          className="platform-magnet-resource-virtual-spacer"
          style={{ height: `${virtualWindow.topSpacerPx}px` }}
          aria-hidden="true"
        />
      ) : null}

      <div className="platform-magnet-bilibili-resource-window">
        {visibleRows.map((row, rowOffset) => (
          <div
            key={`row:${row.rowIndex}`}
            className="platform-magnet-bilibili-resource-row"
            style={{ gridTemplateColumns: `repeat(${virtualColumns}, minmax(0, 1fr))` }}
            ref={rowOffset === 0 ? attachSampleRow : undefined}
          >
            {row.rowItems.map((item, itemOffset) => {
              const resourceCacheKey = getResourceCacheKey(item);
              const renderKey = `${resourceCacheKey}:${row.rowIndex}:${itemOffset}`;
              const preparing =
                preparingResourceId ===
                buildBilibiliPreparedResourceKey(item, normalizedPlaybackQualityHint);
              const resolvedCoverUrl = resourceCoverUrlMap[resourceCacheKey] || item.coverUrl;
              const qualityBadges = resourceQualityTagMap[resourceCacheKey] ?? [];

              return (
                <div key={renderKey}>
                  <PlatformResourceCard
                    accentColor="#67c7ff"
                    coverUrl={resolvedCoverUrl}
                    coverAlt={item.title}
                    coverFallbackLabel="B"
                    title={item.title}
                    subtitle={t('magnet.platform.bilibili.resource.owner', {
                      owner: item.ownerName ?? '-',
                    })}
                    detail={null}
                    durationLabel={formatDuration(item.durationSeconds)}
                    coverBadges={[]}
                    badges={[
                      ...qualityBadges.map((badge) => ({
                        id: `${resourceCacheKey}:quality:${badge}`,
                        label: getQualityBadgeLabel(badge),
                        tone: 'accent' as const,
                      })),
                      {
                        id: `${resourceCacheKey}:platform`,
                        label: 'Bilibili',
                        tone: 'default' as const,
                        compact: true,
                        icon: <Tv className="h-3.5 w-3.5" />,
                      },
                    ]}
                    preparing={preparing}
                    titleHint={t('magnet.platform.bilibili.resource.contextHint')}
                    onContextMenu={(event) => onContextMenu(item, event)}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {virtualWindow.bottomSpacerPx > 0 ? (
        <div
          className="platform-magnet-resource-virtual-spacer"
          style={{ height: `${virtualWindow.bottomSpacerPx}px` }}
          aria-hidden="true"
        />
      ) : null}

      {resourcePageHasMore && hasRenderableItems ? (
        <div ref={resourceLoadMoreSentinelRef} className="platform-magnet-bilibili-resource-load-more">
          {resourceLoadingMore
            ? t('magnet.platform.bilibili.resource.actionLoadingMore')
            : t('magnet.platform.bilibili.resource.actionLoadMoreHint')}
        </div>
      ) : resourcePageAvailable && hasRenderableItems ? (
        <div className="platform-magnet-bilibili-resource-load-more">
          {t('magnet.platform.bilibili.resource.allLoaded')}
        </div>
      ) : null}
    </div>
  );
}
