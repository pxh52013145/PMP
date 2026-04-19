import { useEffect, useRef, useState } from 'react';

import {
  listBilibiliPlaybackQualities,
  resolveBilibiliCoverAssetUrl,
  type BilibiliFavoriteResourceItem,
} from '../../../modules/music-platform';

export type BilibiliQualityBadge = 'dolby' | 'hires';

const RESOURCE_BADGE_CACHE_LIMIT = 512;
const RESOURCE_RENDER_CACHE_LIMIT = 512;

function trimMapToMaxEntries<K, V>(map: Map<K, V>, maxEntries: number): void {
  while (map.size > maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}

function setBoundedRecordValue<T>(
  current: Record<string, T>,
  key: string,
  value: T,
  maxEntries: number
): Record<string, T> {
  if (current[key] === value) return current;
  const next = {
    ...current,
    [key]: value,
  };
  const keys = Object.keys(next);
  if (keys.length <= maxEntries) return next;

  const keepKeys = new Set(keys.slice(keys.length - maxEntries));
  const bounded: Record<string, T> = {};
  for (const candidateKey of keys) {
    if (!keepKeys.has(candidateKey)) continue;
    bounded[candidateKey] = next[candidateKey] as T;
  }
  return bounded;
}

function toBilibiliResourceQualityBadgesFromOptions(
  options: Array<{ key: string; available: boolean }>
): BilibiliQualityBadge[] {
  const available = new Set(
    options
      .filter((item) => item.available)
      .map((item) => item.key.trim().toLowerCase())
  );

  const badges: BilibiliQualityBadge[] = [];
  if (available.has('hires')) badges.push('hires');
  if (available.has('dolby')) badges.push('dolby');
  return badges;
}

type UseBilibiliResourceEnhancerParams = {
  activeBilibiliInstanceId: string | null;
  bilibiliAuthorized: boolean;
  selectedFolderId: string | null;
  bilibiliResources: BilibiliFavoriteResourceItem[];
  filteredBilibiliResources: BilibiliFavoriteResourceItem[];
  isVideoSourceLocator: (sourceLocator: string) => boolean;
  getResourceCacheKey: (item: BilibiliFavoriteResourceItem) => string;
};

export function useBilibiliResourceEnhancer(params: UseBilibiliResourceEnhancerParams) {
  const {
    activeBilibiliInstanceId,
    bilibiliAuthorized,
    selectedFolderId,
    bilibiliResources,
    filteredBilibiliResources,
    isVideoSourceLocator,
    getResourceCacheKey,
  } = params;

  const [resourceCoverUrlMap, setResourceCoverUrlMap] = useState<Record<string, string>>({});
  const [resourceQualityTagMap, setResourceQualityTagMap] = useState<
    Record<string, BilibiliQualityBadge[]>
  >({});

  const qualityBadgesByLocatorRef = useRef<Map<string, BilibiliQualityBadge[]>>(new Map());
  const qualityProbeBackoffUntilRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    setResourceCoverUrlMap({});
    setResourceQualityTagMap({});
    qualityBadgesByLocatorRef.current.clear();
    qualityProbeBackoffUntilRef.current.clear();
  }, [activeBilibiliInstanceId, selectedFolderId]);

  useEffect(() => {
    setResourceQualityTagMap({});
    qualityBadgesByLocatorRef.current.clear();
    qualityProbeBackoffUntilRef.current.clear();
  }, [bilibiliAuthorized]);

  useEffect(() => {
    const retainedResourceIds = new Set(
      bilibiliResources.map((item) => getResourceCacheKey(item)).filter((value) => value.length > 0)
    );
    const retainedSourceLocators = new Set(
      bilibiliResources
        .map((item) => item.sourceLocator.trim())
        .filter((value) => value.length > 0)
    );

    setResourceCoverUrlMap((prev) => {
      const entries = Object.entries(prev).filter(([resourceId]) => retainedResourceIds.has(resourceId));
      if (entries.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(entries) as Record<string, string>;
    });

    setResourceQualityTagMap((prev) => {
      const entries = Object.entries(prev).filter(([resourceId]) => retainedResourceIds.has(resourceId));
      if (entries.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(entries) as Record<string, BilibiliQualityBadge[]>;
    });

    qualityBadgesByLocatorRef.current = new Map(
      [...qualityBadgesByLocatorRef.current.entries()].filter(([locator]) =>
        retainedSourceLocators.has(locator.trim())
      )
    );
    qualityProbeBackoffUntilRef.current = new Map(
      [...qualityProbeBackoffUntilRef.current.entries()].filter(([locator]) =>
        retainedSourceLocators.has(locator.trim())
      )
    );
  }, [bilibiliResources, getResourceCacheKey]);

  useEffect(() => {
    const candidates = filteredBilibiliResources
      .filter((item) => {
        const cacheKey = getResourceCacheKey(item);
        return item.coverUrl && !resourceCoverUrlMap[cacheKey];
      })
      .slice(0, 24);
    if (candidates.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const item of candidates) {
        if (cancelled) return;
        const normalizedCoverUrl = item.coverUrl?.trim();
        if (!normalizedCoverUrl) continue;
        const resolvedCoverUrl = await resolveBilibiliCoverAssetUrl(
          normalizedCoverUrl,
          activeBilibiliInstanceId
        );
        if (!resolvedCoverUrl || cancelled) continue;

        setResourceCoverUrlMap((prev) => {
          const cacheKey = getResourceCacheKey(item);
          return setBoundedRecordValue(prev, cacheKey, resolvedCoverUrl, RESOURCE_RENDER_CACHE_LIMIT);
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeBilibiliInstanceId, filteredBilibiliResources, getResourceCacheKey, resourceCoverUrlMap]);

  useEffect(() => {
    if (!selectedFolderId) return;
    const now = Date.now();
    const candidates = filteredBilibiliResources
      .filter((item) => {
        const locator = item.sourceLocator.trim();
        const cacheKey = getResourceCacheKey(item);
        if (!locator || !isVideoSourceLocator(locator) || resourceQualityTagMap[cacheKey]) {
          return false;
        }
        const backoffUntilMs = qualityProbeBackoffUntilRef.current.get(locator) ?? 0;
        return backoffUntilMs <= now;
      })
      .slice(0, 16);
    if (candidates.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const item of candidates) {
        if (cancelled) return;

        const locator = item.sourceLocator.trim();
        if (!locator) continue;

        const cachedBadges = qualityBadgesByLocatorRef.current.get(locator);
        if (cachedBadges) {
          setResourceQualityTagMap((prev) => {
            const cacheKey = getResourceCacheKey(item);
            if (prev[cacheKey]) return prev;
            return setBoundedRecordValue(prev, cacheKey, cachedBadges, RESOURCE_RENDER_CACHE_LIMIT);
          });
          continue;
        }

        try {
          const options = await listBilibiliPlaybackQualities(locator, activeBilibiliInstanceId);
          if (options.length === 0) {
            qualityProbeBackoffUntilRef.current.set(locator, Date.now() + 60_000);
            trimMapToMaxEntries(qualityProbeBackoffUntilRef.current, RESOURCE_BADGE_CACHE_LIMIT);
            continue;
          }

          const badges = toBilibiliResourceQualityBadgesFromOptions(options);
          qualityBadgesByLocatorRef.current.set(locator, badges);
          qualityProbeBackoffUntilRef.current.delete(locator);
          trimMapToMaxEntries(qualityBadgesByLocatorRef.current, RESOURCE_BADGE_CACHE_LIMIT);
          trimMapToMaxEntries(qualityProbeBackoffUntilRef.current, RESOURCE_BADGE_CACHE_LIMIT);

          if (cancelled) return;
          setResourceQualityTagMap((prev) => {
            const cacheKey = getResourceCacheKey(item);
            if (prev[cacheKey]) return prev;
            return setBoundedRecordValue(prev, cacheKey, badges, RESOURCE_RENDER_CACHE_LIMIT);
          });
        } catch {
          qualityProbeBackoffUntilRef.current.set(locator, Date.now() + 60_000);
          trimMapToMaxEntries(qualityProbeBackoffUntilRef.current, RESOURCE_BADGE_CACHE_LIMIT);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeBilibiliInstanceId,
    filteredBilibiliResources,
    getResourceCacheKey,
    isVideoSourceLocator,
    resourceQualityTagMap,
    selectedFolderId,
  ]);

  return {
    resourceCoverUrlMap,
    resourceQualityTagMap,
  };
}
