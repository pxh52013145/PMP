import type { BilibiliFavoriteResourceItem } from '../../../modules/music-platform';
import { Tv } from 'lucide-react';
import { PlatformResourceCard } from './PlatformResourceCard';

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
  resourceGridRef: React.RefObject<HTMLDivElement>;
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
    resourceGridRef,
    resourceLoadMoreSentinelRef,
    t,
    getResourceCacheKey,
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
          <PlatformResourceCard
            key={resourceCacheKey}
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
