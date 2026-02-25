import type { BilibiliFavoriteResourceItem } from '../../../modules/music-platform';

type Translator = (key: string, params?: Record<string, string | number>) => string;
type BilibiliQualityBadge = 'dolby' | 'hires';

type BilibiliResourceGridProps = {
  items: BilibiliFavoriteResourceItem[];
  resourcePageHasMore: boolean;
  resourcePageAvailable: boolean;
  resourceLoadingMore: boolean;
  preparingResourceId: string | null;
  normalizedPlaybackQualityHint: string;
  resourceCoverUrlMap: Record<string, string>;
  resourceQualityTagMap: Record<string, BilibiliQualityBadge[]>;
  bvidSearchResultResourceId: string | null;
  resourceGridRef: React.RefObject<HTMLDivElement>;
  resourceLoadMoreSentinelRef: React.RefObject<HTMLDivElement>;
  t: Translator;
  getResourceCacheKey: (item: BilibiliFavoriteResourceItem) => string;
  getKindLabel: (kind: string) => string;
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
    bvidSearchResultResourceId,
    resourceGridRef,
    resourceLoadMoreSentinelRef,
    t,
    getResourceCacheKey,
    getKindLabel,
    getQualityBadgeLabel,
    formatDuration,
    onContextMenu,
  } = props;

  return (
    <div className="platform-magnet-bilibili-resource-grid" ref={resourceGridRef}>
      {items.map((item) => {
        const resourceCacheKey = getResourceCacheKey(item);
        const preparing =
          preparingResourceId === `${item.resourceId || item.sourceLocator}::${normalizedPlaybackQualityHint}`;
        const resolvedCoverUrl = resourceCoverUrlMap[resourceCacheKey] || item.coverUrl;
        const qualityBadges = resourceQualityTagMap[resourceCacheKey] ?? [];
        return (
          <article
            key={resourceCacheKey}
            className={`platform-magnet-bilibili-resource-card ${
              preparing ? 'platform-magnet-bilibili-resource-card--preparing' : ''
            }`}
            title={t('magnet.platform.bilibili.resource.contextHint')}
            onContextMenu={(event) => onContextMenu(item, event)}
          >
            <div className="platform-magnet-bilibili-resource-cover" aria-hidden="true">
              {resolvedCoverUrl ? <img src={resolvedCoverUrl} alt={item.title} loading="lazy" /> : <span>B</span>}
              {qualityBadges.length > 0 ? (
                <div className="platform-magnet-bilibili-resource-quality-tags">
                  {qualityBadges.map((badge) => (
                    <span
                      key={`${resourceCacheKey}:${badge}`}
                      className="platform-magnet-bilibili-resource-quality-tag"
                    >
                      {getQualityBadgeLabel(badge)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="platform-magnet-bilibili-resource-main">
              <p className="platform-magnet-bilibili-resource-title">{item.title}</p>
              <p className="platform-magnet-bilibili-resource-meta">
                {t('magnet.platform.bilibili.resource.meta', {
                  owner: item.ownerName ?? '-',
                  duration: formatDuration(item.durationSeconds),
                  kind: getKindLabel(item.contentKind),
                })}
              </p>
              <p className="platform-magnet-bilibili-resource-bvid">
                {item.bvid ? `BV: ${item.bvid}` : item.resourceId}
              </p>
              {bvidSearchResultResourceId === item.resourceId ? (
                <span className="platform-magnet-bilibili-resource-badge">
                  {t('magnet.platform.bilibili.resource.bvSearchResultTag')}
                </span>
              ) : null}
              {preparing ? (
                <span className="platform-magnet-bilibili-resource-badge">
                  {t('magnet.platform.bilibili.resource.actionPreparing')}
                </span>
              ) : null}
            </div>
          </article>
        );
      })}

      {resourcePageHasMore ? (
        <div ref={resourceLoadMoreSentinelRef} className="platform-magnet-bilibili-resource-load-more">
          {resourceLoadingMore
            ? t('magnet.platform.bilibili.resource.actionLoadingMore')
            : t('magnet.platform.bilibili.resource.actionLoadMoreHint')}
        </div>
      ) : resourcePageAvailable ? (
        <div className="platform-magnet-bilibili-resource-load-more">
          {t('magnet.platform.bilibili.resource.allLoaded')}
        </div>
      ) : null}
    </div>
  );
}
