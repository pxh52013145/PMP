import { useCallback, useEffect, useMemo, useState } from 'react';

import { getTelemetryLogger } from '../../../services/telemetry/TelemetryService';
import {
  BILIBILI_CONNECTOR_ID,
  listBilibiliFavoriteFolders,
  listBilibiliFavoriteResources,
  listBilibiliRecommendedResources,
  normalizeBilibiliLookupInput,
  parseBilibiliSearchSourceId,
  searchBilibiliResourceByBvid,
  searchBilibiliResources,
  type BilibiliFavoriteFolderItem,
  type BilibiliFavoriteResourceItem,
  type BilibiliFavoriteResourcePage,
  type PlatformConnectorId,
} from '../../../modules/music-platform';
import {
  getMusicPlatformDurationMs,
  getMusicPlatformNowMs,
  readMusicPlatformDiagnosticErrorMessage,
  warnOnSlowMusicPlatformOperation,
} from '../../../modules/music-platform/platformDiagnostics';

const BILIBILI_RESOURCE_PAGE_SIZE = 40;
const BILIBILI_FAVORITE_RESOURCE_EMPTY_PAGE_PROBE_LIMIT = 6;
const telemetry = getTelemetryLogger('magnet.platform', 'useBilibiliResourceBrowser');

type Translator = (key: string, params?: Record<string, string | number>) => string;

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message?.trim();
    return message || fallback;
  }
  if (typeof error === 'string') {
    const message = error.trim();
    return message || fallback;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return fallback;
}

function normalizeWorkspaceConnectorId(
  value: string | null | undefined
): PlatformConnectorId | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized.startsWith('connector.platform.')) return null;
  return normalized as PlatformConnectorId;
}

function mergeResourcePageItems(
  previous: BilibiliFavoriteResourceItem[],
  incoming: BilibiliFavoriteResourceItem[]
): BilibiliFavoriteResourceItem[] {
  if (incoming.length === 0) return previous;

  const merged = [...previous];
  const indexByKey = new Map<string, number>();
  const toMergeKey = (item: BilibiliFavoriteResourceItem): string =>
    item.resourceId || `${item.sourceLocator}::${item.title}`;

  for (let index = 0; index < merged.length; index += 1) {
    indexByKey.set(toMergeKey(merged[index]), index);
  }

  for (const item of incoming) {
    const mergeKey = toMergeKey(item);
    const currentIndex = indexByKey.get(mergeKey);
    if (typeof currentIndex === 'number') {
      merged[currentIndex] = item;
      continue;
    }
    indexByKey.set(mergeKey, merged.length);
    merged.push(item);
  }

  return merged;
}

type UseBilibiliResourceBrowserParams = {
  workspaceVisible: boolean;
  workspaceConnectorId: string | null;
  bilibiliInstanceId: string | null;
  bilibiliAuthorized: boolean;
  t: Translator;
};

export function useBilibiliResourceBrowser(params: UseBilibiliResourceBrowserParams) {
  const {
    workspaceVisible,
    workspaceConnectorId,
    bilibiliAuthorized,
    bilibiliInstanceId,
    t,
  } = params;
  const resolvedWorkspaceConnectorId =
    normalizeWorkspaceConnectorId(workspaceConnectorId) ?? BILIBILI_CONNECTOR_ID;

  const [folderLoading, setFolderLoading] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [bilibiliFolders, setBilibiliFolders] = useState<BilibiliFavoriteFolderItem[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  const [resourceLoading, setResourceLoading] = useState(false);
  const [resourceLoadingMore, setResourceLoadingMore] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [resourcePage, setResourcePage] = useState<BilibiliFavoriteResourcePage | null>(null);
  const [resourceSourceKey, setResourceSourceKey] = useState<string | null>(null);
  const [resourceFilterQuery, setResourceFilterQuery] = useState('');

  const [bvidSearching, setBvidSearching] = useState(false);
  const [bvidSearchError, setBvidSearchError] = useState<string | null>(null);
  const [bvidSearchResult, setBvidSearchResult] = useState<BilibiliFavoriteResourceItem | null>(null);

  const bilibiliResources = useMemo(() => {
    const resources = resourcePage?.items ?? [];
    if (!bvidSearchResult) return resources;
    if (resources.some((item) => item.resourceId === bvidSearchResult.resourceId)) return resources;
    return [bvidSearchResult, ...resources];
  }, [bvidSearchResult, resourcePage?.items]);

  const filteredBilibiliResources = useMemo(() => {
    const query = resourceFilterQuery.trim().toLowerCase();
    if (!query) return bilibiliResources;
    if (!selectedFolderId) return bilibiliResources;
    return bilibiliResources.filter((item) => {
      const haystack = `${item.title} ${item.ownerName ?? ''} ${item.bvid ?? ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [bilibiliResources, resourceFilterQuery, selectedFolderId]);

  const refreshBilibiliFolders = useCallback(async () => {
    if (!workspaceVisible) return;
    if (!bilibiliAuthorized) {
      setBilibiliFolders([]);
      setSelectedFolderId(null);
      setFolderError(null);
      setResourcePage(null);
      setResourceSourceKey(null);
      setResourceLoadingMore(false);
      return;
    }

    const startedAtMs = getMusicPlatformNowMs();
    setFolderLoading(true);
    try {
      const folders = await listBilibiliFavoriteFolders(bilibiliInstanceId);
      setBilibiliFolders(folders);
      setFolderError(null);

      if (folders.length === 0) {
        setSelectedFolderId(null);
        setResourcePage(null);
        setResourceSourceKey(null);
        setResourceLoadingMore(false);
        return;
      }

      setSelectedFolderId((prev) => {
        if (prev && folders.some((item) => item.folderId === prev)) return prev;
        return null;
      });
      warnOnSlowMusicPlatformOperation({
        logger: telemetry,
        event: 'platform.runtime.bilibili.folder-load.slow',
        startedAtMs,
        fields: {
          connectorId: resolvedWorkspaceConnectorId,
          instanceIdPresent: Boolean(bilibiliInstanceId),
          folderCount: folders.length,
        },
      });
    } catch (err) {
      telemetry.warn('platform.runtime.bilibili.folder-load.failed', {
        message: readMusicPlatformDiagnosticErrorMessage(err),
        fields: {
          connectorId: resolvedWorkspaceConnectorId,
          instanceIdPresent: Boolean(bilibiliInstanceId),
          durationMs: getMusicPlatformDurationMs(startedAtMs),
        },
      });
      setFolderError(toErrorMessage(err, t('magnet.platform.bilibili.folder.error')));
    } finally {
      setFolderLoading(false);
    }
  }, [bilibiliAuthorized, bilibiliInstanceId, resolvedWorkspaceConnectorId, t, workspaceVisible]);

  const refreshBilibiliRecommendedResources = useCallback(async () => {
    if (!workspaceVisible) return;
    if (!bilibiliAuthorized) {
      setResourcePage(null);
      setResourceSourceKey(null);
      setResourceLoadingMore(false);
      return;
    }

    const startedAtMs = getMusicPlatformNowMs();
    setResourceLoading(true);
    try {
      setResourceSourceKey('recommended');
      const page = await listBilibiliRecommendedResources(bilibiliInstanceId);
      setResourcePage(
        page
          ? {
              ...page,
              items: [...page.items],
            }
          : null
      );
      setResourceLoadingMore(false);
      setResourceError(null);
      warnOnSlowMusicPlatformOperation({
        logger: telemetry,
        event: 'platform.runtime.bilibili.recommended-load.slow',
        startedAtMs,
        fields: {
          connectorId: resolvedWorkspaceConnectorId,
          instanceIdPresent: Boolean(bilibiliInstanceId),
          resultCount: page?.items.length ?? 0,
          hasMore: page?.hasMore ?? false,
        },
      });
    } catch (err) {
      telemetry.warn('platform.runtime.bilibili.recommended-load.failed', {
        message: readMusicPlatformDiagnosticErrorMessage(err),
        fields: {
          connectorId: resolvedWorkspaceConnectorId,
          instanceIdPresent: Boolean(bilibiliInstanceId),
          durationMs: getMusicPlatformDurationMs(startedAtMs),
        },
      });
      setResourceError(toErrorMessage(err, t('magnet.platform.bilibili.resource.error')));
    } finally {
      setResourceLoading(false);
    }
  }, [bilibiliAuthorized, bilibiliInstanceId, resolvedWorkspaceConnectorId, t, workspaceVisible]);

  const searchBilibiliHomepageResources = useCallback(
    async (keyword: string) => {
      if (!workspaceVisible) return;
      if (!bilibiliAuthorized) {
        setResourcePage(null);
        setResourceSourceKey(null);
        setResourceLoadingMore(false);
        return;
      }

      const normalizedKeyword = keyword.trim();
      if (!normalizedKeyword) {
        await refreshBilibiliRecommendedResources();
        return;
      }

      setResourceLoading(true);
      try {
        setResourceSourceKey(`search:${normalizedKeyword.toLowerCase()}`);
        const page = await searchBilibiliResources({
          keyword: normalizedKeyword,
          pageNum: 1,
          pageSize: BILIBILI_RESOURCE_PAGE_SIZE,
          instanceId: bilibiliInstanceId,
        });
        setResourcePage(
          page
          ? {
                ...page,
                items: [...page.items],
              }
            : null
        );
        setResourceLoadingMore(false);
        setResourceError(null);
      } catch (err) {
        setResourceError(toErrorMessage(err, t('magnet.platform.bilibili.resource.error')));
      } finally {
        setResourceLoading(false);
      }
    },
    [
      bilibiliAuthorized,
      bilibiliInstanceId,
      refreshBilibiliRecommendedResources,
      t,
      workspaceVisible,
    ]
  );

  const refreshBilibiliResources = useCallback(
    async (folderId: string) => {
      if (!workspaceVisible) return;
      if (!bilibiliAuthorized) {
        setResourcePage(null);
        setResourceSourceKey(null);
        setResourceLoadingMore(false);
        return;
      }

      const normalizedFolderId = folderId.trim();
      if (!normalizedFolderId) {
        setResourcePage(null);
        setResourceSourceKey(null);
        setResourceLoadingMore(false);
        return;
      }

      const startedAtMs = getMusicPlatformNowMs();
      setResourceLoading(true);
      try {
        setResourceSourceKey(`folder:${normalizedFolderId}`);
        const requestFolderPage = async (pageNum: number, pageSize: number) =>
          await listBilibiliFavoriteResources({
            folderId: normalizedFolderId,
            pageNum,
            pageSize,
            instanceId: bilibiliInstanceId,
          });

        let page = await requestFolderPage(1, BILIBILI_RESOURCE_PAGE_SIZE);
        const expectedFolderCount =
          bilibiliFolders.find((folder) => folder.folderId === normalizedFolderId)?.mediaCount ?? 0;

        if (page && page.items.length === 0 && expectedFolderCount > 0) {
          const candidateRequests: Array<{ pageNum: number; pageSize: number }> = [
            { pageNum: 1, pageSize: 80 },
          ];
          const maxProbePageNum = Math.max(
            2,
            Math.min(
              BILIBILI_FAVORITE_RESOURCE_EMPTY_PAGE_PROBE_LIMIT,
              Math.ceil(expectedFolderCount / BILIBILI_RESOURCE_PAGE_SIZE)
            )
          );
          for (let pageNum = 2; pageNum <= maxProbePageNum; pageNum += 1) {
            candidateRequests.push({ pageNum, pageSize: BILIBILI_RESOURCE_PAGE_SIZE });
          }

          let bestFallback = page;
          for (const candidate of candidateRequests) {
            if (candidate.pageNum === 1 && candidate.pageSize === BILIBILI_RESOURCE_PAGE_SIZE) {
              continue;
            }
            const candidatePage = await requestFolderPage(candidate.pageNum, candidate.pageSize);
            if (!candidatePage) continue;
            bestFallback = candidatePage;
            if (candidatePage.items.length > 0 || !candidatePage.hasMore) {
              page = candidatePage;
              break;
            }
          }

          if (page.items.length === 0) {
            page = bestFallback;
          }
        }

        setResourcePage(
          page
            ? {
                ...page,
                items: [...page.items],
              }
            : null
        );
        setResourceLoadingMore(false);
        setResourceError(null);
        warnOnSlowMusicPlatformOperation({
          logger: telemetry,
          event: 'platform.runtime.bilibili.resource-load.slow',
          startedAtMs,
          fields: {
            connectorId: resolvedWorkspaceConnectorId,
            instanceIdPresent: Boolean(bilibiliInstanceId),
            folderId: normalizedFolderId,
            resultCount: page?.items.length ?? 0,
            hasMore: page?.hasMore ?? false,
          },
        });
      } catch (err) {
        telemetry.warn('platform.runtime.bilibili.resource-load.failed', {
          message: readMusicPlatformDiagnosticErrorMessage(err),
          fields: {
            connectorId: resolvedWorkspaceConnectorId,
            instanceIdPresent: Boolean(bilibiliInstanceId),
            folderId: normalizedFolderId,
            durationMs: getMusicPlatformDurationMs(startedAtMs),
          },
        });
        setResourceError(toErrorMessage(err, t('magnet.platform.bilibili.resource.error')));
      } finally {
        setResourceLoading(false);
      }
    },
    [
      bilibiliAuthorized,
      bilibiliFolders,
      bilibiliInstanceId,
      resolvedWorkspaceConnectorId,
      t,
      workspaceVisible,
    ]
  );

  const loadMoreBilibiliResources = useCallback(async () => {
    if (!workspaceVisible) return;
    if (!bilibiliAuthorized || resourceLoading || resourceLoadingMore) return;

    const currentPage = resourcePage;
    if (!currentPage || !currentPage.hasMore) return;

    const normalizedFolderId = currentPage.folderId.trim();
    if (!normalizedFolderId) return;

    const nextPageNum = Math.max(2, currentPage.pageNum + 1);
    const pageSize = currentPage.pageSize || BILIBILI_RESOURCE_PAGE_SIZE;
    const searchKeyword = parseBilibiliSearchSourceId(normalizedFolderId);

    const startedAtMs = getMusicPlatformNowMs();
    setResourceLoadingMore(true);
    try {
      let nextPage: BilibiliFavoriteResourcePage | null = null;

      if (searchKeyword) {
        nextPage = await searchBilibiliResources({
          keyword: searchKeyword,
          pageNum: nextPageNum,
          pageSize,
          instanceId: bilibiliInstanceId,
        });
      } else {
        const requestFolderPage = async (pageNum: number) =>
          await listBilibiliFavoriteResources({
            folderId: normalizedFolderId,
            pageNum,
            pageSize,
            instanceId: bilibiliInstanceId,
          });

        nextPage = await requestFolderPage(nextPageNum);
        let probePageNum = nextPageNum;
        let probeCount = 0;
        while (
          nextPage &&
          nextPage.items.length === 0 &&
          nextPage.hasMore &&
          probeCount < BILIBILI_FAVORITE_RESOURCE_EMPTY_PAGE_PROBE_LIMIT
        ) {
          probeCount += 1;
          probePageNum += 1;
          const candidatePage = await requestFolderPage(probePageNum);
          if (!candidatePage) break;
          nextPage = candidatePage;
        }
      }

      if (!nextPage) {
        setResourcePage((prev) =>
          prev && prev.folderId === currentPage.folderId
            ? {
                ...prev,
                hasMore: false,
              }
            : prev
        );
        return;
      }

      setResourcePage((prev) => {
        if (!prev || prev.folderId !== currentPage.folderId) return prev;

        const mergedItems = mergeResourcePageItems(prev.items, nextPage.items);
        const estimatedHasMore =
          nextPage.hasMore || (nextPage.items.length > 0 && mergedItems.length < nextPage.total);

        return {
          ...nextPage,
          items: mergedItems,
          hasMore: estimatedHasMore,
        };
      });
      setResourceError(null);
      warnOnSlowMusicPlatformOperation({
        logger: telemetry,
        event: 'platform.runtime.bilibili.resource-load-more.slow',
        startedAtMs,
        fields: {
          connectorId: resolvedWorkspaceConnectorId,
          instanceIdPresent: Boolean(bilibiliInstanceId),
          folderId: normalizedFolderId,
          pageNum: nextPageNum,
          searchKeywordPresent: Boolean(searchKeyword),
        },
      });
    } catch (err) {
      telemetry.warn('platform.runtime.bilibili.resource-load-more.failed', {
        message: readMusicPlatformDiagnosticErrorMessage(err),
        fields: {
          connectorId: resolvedWorkspaceConnectorId,
          instanceIdPresent: Boolean(bilibiliInstanceId),
          folderId: normalizedFolderId,
          pageNum: nextPageNum,
          searchKeywordPresent: Boolean(searchKeyword),
          durationMs: getMusicPlatformDurationMs(startedAtMs),
        },
      });
      setResourceError(toErrorMessage(err, t('magnet.platform.bilibili.resource.error')));
    } finally {
      setResourceLoadingMore(false);
    }
  }, [
    bilibiliAuthorized,
    bilibiliInstanceId,
    resolvedWorkspaceConnectorId,
    resourceLoading,
    resourceLoadingMore,
    resourcePage,
    t,
    workspaceVisible,
  ]);

  const searchBilibiliResourceByLookupInput = useCallback(async (lookupInput: string): Promise<boolean> => {
    const normalizedQuery = normalizeBilibiliLookupInput(lookupInput);
    if (!normalizedQuery) {
      return false;
    }

    setBvidSearching(true);
    setBvidSearchError(null);
    setResourceError(null);
    setResourceFilterQuery(normalizedQuery);
    try {
      const result = await searchBilibiliResourceByBvid(normalizedQuery, bilibiliInstanceId);
      if (!result) {
        setBvidSearchResult(null);
        setBvidSearchError(t('magnet.platform.bilibili.resource.bvSearchNotFound'));
        return true;
      }

      setBvidSearchResult(result);
      return true;
    } catch (err) {
      setBvidSearchResult(null);
      setBvidSearchError(toErrorMessage(err, t('magnet.platform.bilibili.resource.error')));
      return true;
    } finally {
      setBvidSearching(false);
    }
  }, [bilibiliInstanceId, t]);

  useEffect(() => {
    if (normalizeBilibiliLookupInput(resourceFilterQuery)) return;
    if (!bvidSearchResult && !bvidSearchError) return;
    setBvidSearchResult(null);
    setBvidSearchError(null);
  }, [bvidSearchError, bvidSearchResult, resourceFilterQuery]);

  useEffect(() => {
    void refreshBilibiliFolders();
  }, [refreshBilibiliFolders]);

  useEffect(() => {
    if (!workspaceVisible) return;
    if (selectedFolderId) {
      void refreshBilibiliResources(selectedFolderId);
      return;
    }
    void refreshBilibiliRecommendedResources();
  }, [refreshBilibiliRecommendedResources, refreshBilibiliResources, selectedFolderId, workspaceVisible]);

  return {
    folderLoading,
    folderError,
    bilibiliFolders,
    selectedFolderId,
    setSelectedFolderId,
    resourceLoading,
    resourceLoadingMore,
    resourceError,
    setResourceError,
    resourcePage,
    resourceSourceKey,
    resourceFilterQuery,
    setResourceFilterQuery,
    bvidSearching,
    bvidSearchError,
    bvidSearchResult,
    bilibiliResources,
    filteredBilibiliResources,
    refreshBilibiliFolders,
    refreshBilibiliRecommendedResources,
    searchBilibiliHomepageResources,
    refreshBilibiliResources,
    loadMoreBilibiliResources,
    searchBilibiliResourceByLookupInput,
  };
}
