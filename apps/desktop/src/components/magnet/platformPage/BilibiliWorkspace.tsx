import React from 'react';

import type {
  BilibiliFavoriteFolderItem,
  BilibiliFavoriteResourceItem,
  BilibiliFavoriteResourcePage,
  BilibiliLyricLocatorResolved,
} from '../../../modules/music-platform';
import type { ContextMenuItem } from '../ContextMenu';
import { ContextMenu } from '../ContextMenu';
import { BilibiliResourceGrid } from './BilibiliResourceGrid';
import type { BilibiliQualityBadge } from './useBilibiliResourceEnhancer';

type Translator = (key: string, params?: Record<string, string | number>) => string;

export type BilibiliWorkspaceProps = {
  bilibiliAuthorized: boolean;
  selectedFolderId: string | null;
  resourceFilterQuery: string;
  resourceLoading: boolean;
  resourceLoadingMore: boolean;
  selectedBilibiliFolder: BilibiliFavoriteFolderItem | null;
  resourcePage: BilibiliFavoriteResourcePage | null;
  resourceInfo: string | null;
  resourceError: string | null;
  bvidSearchError: string | null;
  filteredBilibiliResources: BilibiliFavoriteResourceItem[];
  preparingResourceId: string | null;
  normalizedPlaybackQualityHint: string;
  resourceCoverUrlMap: Record<string, string>;
  resourceQualityTagMap: Record<string, BilibiliQualityBadge[]>;
  resourceGridRef: React.RefObject<HTMLDivElement>;
  resourceLoadMoreSentinelRef: React.RefObject<HTMLDivElement>;
  playlistError: string | null;
  resolvedLyric: BilibiliLyricLocatorResolved | null;
  lyricError: string | null;
  resourceContextMenu: { x: number; y: number; items: ContextMenuItem[] } | null;
  t: Translator;
  formatDuration: (seconds: number | undefined) => string;
  getResourceCacheKey: (item: BilibiliFavoriteResourceItem) => string;
  getQualityBadgeLabel: (badge: BilibiliQualityBadge) => string;
  onRefreshResources: () => void;
  onOpenResourceContextMenu: (item: BilibiliFavoriteResourceItem, event: React.MouseEvent) => void;
  onLoadMoreResources: () => void;
  onCloseResourceContextMenu: () => void;
};

export function BilibiliWorkspace(props: BilibiliWorkspaceProps) {
  const {
    bilibiliAuthorized,
    selectedFolderId,
    resourceFilterQuery,
    resourceLoading,
    resourceLoadingMore,
    selectedBilibiliFolder,
    resourcePage,
    resourceInfo,
    resourceError,
    bvidSearchError,
    filteredBilibiliResources,
    preparingResourceId,
    normalizedPlaybackQualityHint,
    resourceCoverUrlMap,
    resourceQualityTagMap,
    resourceGridRef,
    resourceLoadMoreSentinelRef,
    playlistError,
    resolvedLyric,
    lyricError,
    resourceContextMenu,
    t,
    formatDuration,
    getResourceCacheKey,
    getQualityBadgeLabel,
    onRefreshResources,
    onOpenResourceContextMenu,
    onLoadMoreResources,
    onCloseResourceContextMenu,
  } = props;

  return (
    <div className="platform-magnet-bilibili">
      <div className="platform-magnet-bilibili-scroll">
        {!bilibiliAuthorized ? (
          <p className="platform-magnet-note">{t('magnet.platform.bilibili.status.waiting')}</p>
        ) : null}

        <div className="platform-magnet-bilibili-layout platform-magnet-bilibili-layout--drawers">
          <section className="platform-magnet-panel platform-magnet-bilibili-resources platform-magnet-bilibili-resources--main">
            {bilibiliAuthorized ? (
              <div className="platform-magnet-bilibili-resource-meta-row">
                {selectedBilibiliFolder ? (
                  <p className="platform-magnet-panel-summary">
                    {t('magnet.platform.bilibili.drawer.currentFolderName', {
                      folder: selectedBilibiliFolder.title,
                    })}
                  </p>
                ) : resourcePage ? (
                  <p className="platform-magnet-panel-summary">
                    {t('magnet.platform.bilibili.resource.recommended')}
                  </p>
                ) : (
                  <span />
                )}

                <div className="flex items-center gap-2">
                  {resourcePage ? (
                    <span className="platform-magnet-panel-tag">
                      {t('magnet.platform.bilibili.resource.total', { count: resourcePage.total })}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="platform-magnet-mini-btn"
                    disabled={!bilibiliAuthorized || resourceLoading || resourceLoadingMore}
                    onClick={onRefreshResources}
                  >
                    {resourceLoading
                      ? t('magnet.platform.bilibili.resource.actionRefreshing')
                      : t('magnet.platform.bilibili.resource.actionRefresh')}
                  </button>
                </div>
              </div>
            ) : null}

            {resourceInfo ? <p className="platform-magnet-note">{resourceInfo}</p> : null}
            {resourceError ? <p className="platform-magnet-error">{resourceError}</p> : null}
            {playlistError ? <p className="platform-magnet-error">{playlistError}</p> : null}
            {bvidSearchError ? <p className="platform-magnet-error">{bvidSearchError}</p> : null}

            {resourceLoading ? (
              <p className="platform-magnet-panel-empty">{t('magnet.platform.bilibili.resource.loading')}</p>
            ) : filteredBilibiliResources.length === 0 ? (
              <p className="platform-magnet-panel-empty">
                {resourceFilterQuery.trim().length > 0
                  ? t('magnet.platform.bilibili.resource.emptyFiltered')
                  : selectedFolderId
                    ? t('magnet.platform.bilibili.resource.empty')
                    : t('magnet.platform.bilibili.resource.recommendedEmpty')}
              </p>
            ) : (
              <BilibiliResourceGrid
                items={filteredBilibiliResources}
                resourcePageHasMore={Boolean(resourcePage?.hasMore)}
                resourcePageAvailable={Boolean(resourcePage)}
                resourceLoadingMore={resourceLoadingMore}
                preparingResourceId={preparingResourceId}
                normalizedPlaybackQualityHint={normalizedPlaybackQualityHint}
                resourceCoverUrlMap={resourceCoverUrlMap}
                resourceQualityTagMap={resourceQualityTagMap}
                resourceGridRef={resourceGridRef}
                resourceLoadMoreSentinelRef={resourceLoadMoreSentinelRef}
                t={t}
                getResourceCacheKey={getResourceCacheKey}
                getQualityBadgeLabel={getQualityBadgeLabel}
                formatDuration={formatDuration}
                onContextMenu={onOpenResourceContextMenu}
              />
            )}

            {resourcePage?.hasMore && !resourceLoading ? (
              <div className="platform-magnet-bilibili-resource-load-more-actions">
                <button
                  type="button"
                  className="platform-magnet-mini-btn"
                  disabled={resourceLoadingMore || !selectedFolderId}
                  onClick={onLoadMoreResources}
                >
                  {resourceLoadingMore
                    ? t('magnet.platform.bilibili.resource.actionLoadingMore')
                    : t('magnet.platform.bilibili.resource.actionLoadMore')}
                </button>
              </div>
            ) : null}

            {resolvedLyric ? (
              <div className="platform-magnet-bilibili-lyric-card">
                <p>
                  {t('magnet.platform.bilibili.lyric.resolved', {
                    format: resolvedLyric.format,
                    source: resolvedLyric.sourceKind,
                  })}
                </p>
                <p className="platform-magnet-bilibili-lyric-locator">{resolvedLyric.locator}</p>
              </div>
            ) : null}

            {lyricError ? <p className="platform-magnet-error">{lyricError}</p> : null}
          </section>
        </div>
      </div>
      {resourceContextMenu ? (
        <ContextMenu
          x={resourceContextMenu.x}
          y={resourceContextMenu.y}
          items={resourceContextMenu.items}
          onClose={onCloseResourceContextMenu}
        />
      ) : null}
    </div>
  );
}
