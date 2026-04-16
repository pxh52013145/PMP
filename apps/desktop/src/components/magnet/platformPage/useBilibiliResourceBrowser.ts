import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  listBilibiliFavoriteFolders,
  listBilibiliFavoriteResources,
  listBilibiliRecommendedResources,
  searchBilibiliResources,
  searchBilibiliResourceByBvid,
  type BilibiliFavoriteFolderItem,
  type BilibiliFavoriteResourceItem,
  type BilibiliFavoriteResourcePage,
} from '../../../modules/music-platform';

const BILIBILI_RESOURCE_PAGE_SIZE = 40;
const BILIBILI_FAVORITE_RESOURCE_EMPTY_PAGE_PROBE_LIMIT = 6;

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

function normalizeBilibiliLookupInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalizeBvidToken = (token: string): string | null => {
    const normalized = token.trim();
    if (!/^bv[0-9a-zA-Z]{10}$/i.test(normalized)) return null;
    return `BV${normalized.slice(2)}`;
  };

  try {
    const parsed = new URL(trimmed);
    for (const [name, rawValue] of parsed.searchParams.entries()) {
      if (!name.toLowerCase().includes('bvid')) continue;
      const normalizedToken = normalizeBvidToken(rawValue);
      if (normalizedToken) return normalizedToken;
    }
    const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
    for (const segment of segments) {
      const normalizedToken = normalizeBvidToken(segment);
      if (normalizedToken) return normalizedToken;
    }
  } catch {
    // noop
  }

  const matchedToken = trimmed.match(/(BV[0-9A-Za-z]{10})/i);
  if (!matchedToken) return null;
  return `BV${matchedToken[1].slice(2)}`;
}

function parseSearchKeywordFromResourceFolderId(folderId: string): string | null {
  const normalizedFolderId = folderId.trim();
  const prefix = 'bilibili:search:';
  if (!normalizedFolderId.startsWith(prefix)) return null;
  const keyword = normalizedFolderId.slice(prefix.length).trim();
  return keyword.length > 0 ? keyword : null;
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
  bilibiliAuthorized: boolean;
  t: Translator;
};

export function useBilibiliResourceBrowser(params: UseBilibiliResourceBrowserParams) {
  const { bilibiliAuthorized, t } = params;

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
    if (!bilibiliAuthorized) {
      setBilibiliFolders([]);
      setSelectedFolderId(null);
      setFolderError(null);
      setResourcePage(null);
      setResourceSourceKey(null);
      setResourceLoadingMore(false);
      return;
    }

    setFolderLoading(true);
    try {
      const folders = await listBilibiliFavoriteFolders();
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
    } catch (err) {
      setFolderError(toErrorMessage(err, t('magnet.platform.bilibili.folder.error')));
    } finally {
      setFolderLoading(false);
    }
  }, [bilibiliAuthorized, t]);

  const refreshBilibiliRecommendedResources = useCallback(async () => {
    if (!bilibiliAuthorized) {
      setResourcePage(null);
      setResourceSourceKey(null);
      setResourceLoadingMore(false);
      return;
    }

    setResourceLoading(true);
    try {
      setResourceSourceKey('recommended');
      const page = await listBilibiliRecommendedResources();
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
  }, [bilibiliAuthorized, t]);

  const searchBilibiliHomepageResources = useCallback(
    async (keyword: string) => {
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
    [bilibiliAuthorized, refreshBilibiliRecommendedResources, t]
  );

  const refreshBilibiliResources = useCallback(
    async (folderId: string) => {
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

      setResourceLoading(true);
      try {
        setResourceSourceKey(`folder:${normalizedFolderId}`);
        const requestFolderPage = async (pageNum: number, pageSize: number) =>
          listBilibiliFavoriteResources({
            folderId: normalizedFolderId,
            pageNum,
            pageSize,
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
      } catch (err) {
        setResourceError(toErrorMessage(err, t('magnet.platform.bilibili.resource.error')));
      } finally {
        setResourceLoading(false);
      }
    },
    [bilibiliAuthorized, bilibiliFolders, t]
  );

  const loadMoreBilibiliResources = useCallback(async () => {
    if (!bilibiliAuthorized || resourceLoading || resourceLoadingMore) return;

    const currentPage = resourcePage;
    if (!currentPage || !currentPage.hasMore) return;

    const normalizedFolderId = currentPage.folderId.trim();
    if (!normalizedFolderId) return;

    const nextPageNum = Math.max(2, currentPage.pageNum + 1);
    const pageSize = currentPage.pageSize || BILIBILI_RESOURCE_PAGE_SIZE;
    const searchKeyword = parseSearchKeywordFromResourceFolderId(normalizedFolderId);

    setResourceLoadingMore(true);
    try {
      let nextPage: BilibiliFavoriteResourcePage | null = null;

      if (searchKeyword) {
        nextPage = await searchBilibiliResources({
          keyword: searchKeyword,
          pageNum: nextPageNum,
          pageSize,
        });
      } else {
        const requestFolderPage = async (pageNum: number) =>
          listBilibiliFavoriteResources({
            folderId: normalizedFolderId,
            pageNum,
            pageSize,
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
    } catch (err) {
      setResourceError(toErrorMessage(err, t('magnet.platform.bilibili.resource.error')));
    } finally {
      setResourceLoadingMore(false);
    }
  }, [bilibiliAuthorized, resourceLoading, resourceLoadingMore, resourcePage, t]);

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
      const result = await searchBilibiliResourceByBvid(normalizedQuery);
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
  }, [t]);

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
    if (selectedFolderId) {
      void refreshBilibiliResources(selectedFolderId);
      return;
    }
    void refreshBilibiliRecommendedResources();
  }, [refreshBilibiliRecommendedResources, refreshBilibiliResources, selectedFolderId]);

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
