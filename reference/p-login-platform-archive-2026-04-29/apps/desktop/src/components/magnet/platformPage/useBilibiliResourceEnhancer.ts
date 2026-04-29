import { useCallback, useEffect, useRef, useState } from 'react';

import {
  resolveBilibiliQualityBadges,
  type BilibiliFavoriteResourceItem,
  type BilibiliQualityBadge,
} from '../../../modules/music-platform/bilibiliWorkspaceModel';
import {
  listBilibiliWorkspacePlaybackQualities,
  resolveBilibiliWorkspaceCoverAssetUrl,
  type BilibiliWorkspaceRuntimeTarget,
} from './bilibiliWorkspaceRuntime';

const RESOURCE_BADGE_CACHE_LIMIT = 512;
const RESOURCE_RENDER_CACHE_LIMIT = 512;
const COVER_RESOLVE_BATCH_SIZE = 6;
const QUALITY_PROBE_BATCH_SIZE = 4;
const COVER_RESOLVE_BACKOFF_MS = 60_000;
const QUALITY_PROBE_BACKOFF_MS = 60_000;

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

function retainRecordEntries<T>(
  current: Record<string, T>,
  retainedKeys: ReadonlySet<string>
): Record<string, T> {
  let removed = false;
  const retainedEntries = Object.entries(current).filter(([key]) => {
    const keep = retainedKeys.has(key);
    if (!keep) removed = true;
    return keep;
  });
  if (!removed) return current;
  return Object.fromEntries(retainedEntries) as Record<string, T>;
}

type UseBilibiliResourceEnhancerParams = {
  bilibiliRuntimeTarget: BilibiliWorkspaceRuntimeTarget | null;
  bilibiliAuthorized: boolean;
  selectedFolderId: string | null;
  bilibiliResources: BilibiliFavoriteResourceItem[];
  filteredBilibiliResources: BilibiliFavoriteResourceItem[];
  isVideoSourceLocator: (sourceLocator: string) => boolean;
  getResourceCacheKey: (item: BilibiliFavoriteResourceItem) => string;
};

export function useBilibiliResourceEnhancer(params: UseBilibiliResourceEnhancerParams) {
  const {
    bilibiliRuntimeTarget,
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

  const resourceEnhancerContextKey = [
    bilibiliRuntimeTarget?.connectorId ?? '',
    bilibiliRuntimeTarget?.instanceId ?? '',
    selectedFolderId ?? '',
    bilibiliAuthorized ? 'authorized' : 'unauthorized',
  ].join('\u001f');
  const mountedRef = useRef(true);
  const resourceEnhancerContextKeyRef = useRef(resourceEnhancerContextKey);
  resourceEnhancerContextKeyRef.current = resourceEnhancerContextKey;
  const resourceCoverUrlMapRef = useRef<Record<string, string>>({});
  const resourceQualityTagMapRef = useRef<Record<string, BilibiliQualityBadge[]>>({});
  const coverResolveBackoffUntilRef = useRef<Map<string, number>>(new Map());
  const coverResolutionInFlightRef = useRef<Set<string>>(new Set());
  const qualityBadgesByLocatorRef = useRef<Map<string, BilibiliQualityBadge[]>>(new Map());
  const qualityProbeBackoffUntilRef = useRef<Map<string, number>>(new Map());
  const qualityProbeInFlightLocatorsRef = useRef<Set<string>>(new Set());

  const updateResourceCoverUrlMap = useCallback(
    (updater: (current: Record<string, string>) => Record<string, string>) => {
      const current = resourceCoverUrlMapRef.current;
      const next = updater(current);
      if (next === current) return;
      resourceCoverUrlMapRef.current = next;
      setResourceCoverUrlMap(next);
    },
    []
  );

  const updateResourceQualityTagMap = useCallback(
    (
      updater: (
        current: Record<string, BilibiliQualityBadge[]>
      ) => Record<string, BilibiliQualityBadge[]>
    ) => {
      const current = resourceQualityTagMapRef.current;
      const next = updater(current);
      if (next === current) return;
      resourceQualityTagMapRef.current = next;
      setResourceQualityTagMap(next);
    },
    []
  );

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    resourceCoverUrlMapRef.current = {};
    resourceQualityTagMapRef.current = {};
    setResourceCoverUrlMap({});
    setResourceQualityTagMap({});
    coverResolveBackoffUntilRef.current.clear();
    coverResolutionInFlightRef.current.clear();
    qualityBadgesByLocatorRef.current.clear();
    qualityProbeBackoffUntilRef.current.clear();
    qualityProbeInFlightLocatorsRef.current.clear();
  }, [bilibiliRuntimeTarget?.connectorId, bilibiliRuntimeTarget?.instanceId, selectedFolderId]);

  useEffect(() => {
    resourceQualityTagMapRef.current = {};
    setResourceQualityTagMap({});
    qualityBadgesByLocatorRef.current.clear();
    qualityProbeBackoffUntilRef.current.clear();
    qualityProbeInFlightLocatorsRef.current.clear();
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

    updateResourceCoverUrlMap((prev) => retainRecordEntries(prev, retainedResourceIds));

    updateResourceQualityTagMap((prev) => retainRecordEntries(prev, retainedResourceIds));

    coverResolveBackoffUntilRef.current = new Map(
      [...coverResolveBackoffUntilRef.current.entries()].filter(([cacheKey]) =>
        retainedResourceIds.has(cacheKey)
      )
    );
    coverResolutionInFlightRef.current = new Set(
      [...coverResolutionInFlightRef.current].filter((cacheKey) => retainedResourceIds.has(cacheKey))
    );

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
    qualityProbeInFlightLocatorsRef.current = new Set(
      [...qualityProbeInFlightLocatorsRef.current].filter((locator) =>
        retainedSourceLocators.has(locator.trim())
      )
    );
  }, [bilibiliResources, getResourceCacheKey, updateResourceCoverUrlMap, updateResourceQualityTagMap]);

  useEffect(() => {
    if (!bilibiliAuthorized) return;

    const effectContextKey = resourceEnhancerContextKey;
    void (async () => {
      let shouldDrain = true;
      while (shouldDrain) {
        const now = Date.now();
        const scheduledCacheKeys = new Set<string>();
        const candidates: Array<{
          cacheKey: string;
          normalizedCoverUrl: string;
        }> = [];

        for (const item of filteredBilibiliResources) {
          const cacheKey = getResourceCacheKey(item);
          const normalizedCoverUrl = item.coverUrl?.trim();
          if (!cacheKey || !normalizedCoverUrl) continue;
          if (resourceCoverUrlMapRef.current[cacheKey]) continue;
          if (
            scheduledCacheKeys.has(cacheKey) ||
            coverResolutionInFlightRef.current.has(cacheKey)
          ) {
            continue;
          }
          const backoffUntilMs = coverResolveBackoffUntilRef.current.get(cacheKey) ?? 0;
          if (backoffUntilMs > now) continue;

          scheduledCacheKeys.add(cacheKey);
          candidates.push({ cacheKey, normalizedCoverUrl });
          if (candidates.length >= COVER_RESOLVE_BATCH_SIZE) break;
        }

        if (candidates.length === 0) {
          shouldDrain = false;
          continue;
        }
        for (const candidate of candidates) {
          coverResolutionInFlightRef.current.add(candidate.cacheKey);
        }

        await Promise.allSettled(
          candidates.map(async ({ cacheKey, normalizedCoverUrl }) => {
            try {
              const resolvedCoverUrl = await resolveBilibiliWorkspaceCoverAssetUrl(
                bilibiliRuntimeTarget,
                normalizedCoverUrl
              );
              if (!resolvedCoverUrl) {
                coverResolveBackoffUntilRef.current.set(
                  cacheKey,
                  Date.now() + COVER_RESOLVE_BACKOFF_MS
                );
                trimMapToMaxEntries(
                  coverResolveBackoffUntilRef.current,
                  RESOURCE_BADGE_CACHE_LIMIT
                );
                return;
              }

              coverResolveBackoffUntilRef.current.delete(cacheKey);
              trimMapToMaxEntries(
                coverResolveBackoffUntilRef.current,
                RESOURCE_BADGE_CACHE_LIMIT
              );
              if (
                !mountedRef.current ||
                resourceEnhancerContextKeyRef.current !== effectContextKey
              ) {
                return;
              }

              updateResourceCoverUrlMap((prev) =>
                setBoundedRecordValue(
                  prev,
                  cacheKey,
                  resolvedCoverUrl,
                  RESOURCE_RENDER_CACHE_LIMIT
                )
              );
            } catch {
              coverResolveBackoffUntilRef.current.set(
                cacheKey,
                Date.now() + COVER_RESOLVE_BACKOFF_MS
              );
              trimMapToMaxEntries(
                coverResolveBackoffUntilRef.current,
                RESOURCE_BADGE_CACHE_LIMIT
              );
            } finally {
              coverResolutionInFlightRef.current.delete(cacheKey);
            }
          })
        );
      }
    })();
  }, [
    bilibiliAuthorized,
    bilibiliRuntimeTarget,
    filteredBilibiliResources,
    getResourceCacheKey,
    resourceEnhancerContextKey,
    updateResourceCoverUrlMap,
  ]);

  useEffect(() => {
    if (!selectedFolderId || !bilibiliAuthorized) return;

    const effectContextKey = resourceEnhancerContextKey;
    void (async () => {
      const applyQualityBadgesToVisibleResources = (
        locator: string,
        badges: BilibiliQualityBadge[]
      ) => {
        updateResourceQualityTagMap((prev) => {
          let next = prev;
          for (const resource of filteredBilibiliResources) {
            if (resource.sourceLocator.trim() !== locator) continue;
            const cacheKey = getResourceCacheKey(resource);
            if (!cacheKey) continue;
            next = setBoundedRecordValue(next, cacheKey, badges, RESOURCE_RENDER_CACHE_LIMIT);
          }
          return next;
        });
      };

      let shouldDrain = true;
      while (shouldDrain) {
        const now = Date.now();
        const scheduledLocators = new Set<string>();
        const candidates: string[] = [];

        for (const item of filteredBilibiliResources) {
          const locator = item.sourceLocator.trim();
          const cacheKey = getResourceCacheKey(item);
          if (!locator || !cacheKey || !isVideoSourceLocator(locator)) continue;
          if (resourceQualityTagMapRef.current[cacheKey]) continue;

          const cachedBadges = qualityBadgesByLocatorRef.current.get(locator);
          if (cachedBadges) {
            applyQualityBadgesToVisibleResources(locator, cachedBadges);
            continue;
          }

          if (
            scheduledLocators.has(locator) ||
            qualityProbeInFlightLocatorsRef.current.has(locator)
          ) {
            continue;
          }

          const backoffUntilMs = qualityProbeBackoffUntilRef.current.get(locator) ?? 0;
          if (backoffUntilMs > now) continue;

          scheduledLocators.add(locator);
          candidates.push(locator);
          if (candidates.length >= QUALITY_PROBE_BATCH_SIZE) break;
        }

        if (candidates.length === 0) {
          shouldDrain = false;
          continue;
        }
        for (const locator of candidates) {
          qualityProbeInFlightLocatorsRef.current.add(locator);
        }

        await Promise.allSettled(
          candidates.map(async (locator) => {
            try {
              const options = await listBilibiliWorkspacePlaybackQualities(
                bilibiliRuntimeTarget,
                locator
              );
              if (options.length === 0) {
                qualityProbeBackoffUntilRef.current.set(
                  locator,
                  Date.now() + QUALITY_PROBE_BACKOFF_MS
                );
                trimMapToMaxEntries(
                  qualityProbeBackoffUntilRef.current,
                  RESOURCE_BADGE_CACHE_LIMIT
                );
                return;
              }

              const badges = resolveBilibiliQualityBadges(options);
              qualityBadgesByLocatorRef.current.set(locator, badges);
              qualityProbeBackoffUntilRef.current.delete(locator);
              trimMapToMaxEntries(qualityBadgesByLocatorRef.current, RESOURCE_BADGE_CACHE_LIMIT);
              trimMapToMaxEntries(
                qualityProbeBackoffUntilRef.current,
                RESOURCE_BADGE_CACHE_LIMIT
              );

              if (
                !mountedRef.current ||
                resourceEnhancerContextKeyRef.current !== effectContextKey
              ) {
                return;
              }
              applyQualityBadgesToVisibleResources(locator, badges);
            } catch {
              qualityProbeBackoffUntilRef.current.set(
                locator,
                Date.now() + QUALITY_PROBE_BACKOFF_MS
              );
              trimMapToMaxEntries(
                qualityProbeBackoffUntilRef.current,
                RESOURCE_BADGE_CACHE_LIMIT
              );
            } finally {
              qualityProbeInFlightLocatorsRef.current.delete(locator);
            }
          })
        );
      }
    })();
  }, [
    bilibiliAuthorized,
    bilibiliRuntimeTarget,
    filteredBilibiliResources,
    getResourceCacheKey,
    isVideoSourceLocator,
    resourceEnhancerContextKey,
    selectedFolderId,
    updateResourceQualityTagMap,
  ]);

  return {
    resourceCoverUrlMap,
    resourceQualityTagMap,
  };
}
