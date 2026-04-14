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
      setResourceLoadingMore(false);
      return;
    }

    setResourceLoading(true);
    try {
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
        setResourceLoadingMore(false);
        return;
      }

      const normalizedFolderId = folderId.trim();
      if (!normalizedFolderId) {
        setResourcePage(null);
        setResourceLoadingMore(false);
        return;
      }

      setResourceLoading(true);
      try {
        const page = await listBilibiliFavoriteResources({
          folderId: normalizedFolderId,
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
    [bilibiliAuthorized, t]
  );

  const loadMoreBilibiliResources = useCallback(
    async (folderId: string) => {
      if (!bilibiliAuthorized || resourceLoading || resourceLoadingMore) return;

      const normalizedFolderId = folderId.trim();
      if (!normalizedFolderId) return;

      const currentPage = resourcePage;
      if (!currentPage || !currentPage.hasMore) return;
      if (currentPage.folderId !== normalizedFolderId) return;

      const nextPageNum = Math.max(2, currentPage.pageNum + 1);
      setResourceLoadingMore(true);
      try {
        const nextPage = await listBilibiliFavoriteResources({
          folderId: normalizedFolderId,
          pageNum: nextPageNum,
          pageSize: currentPage.pageSize || BILIBILI_RESOURCE_PAGE_SIZE,
        });

        if (!nextPage) {
          setResourcePage((prev) =>
            prev
              ? {
                  ...prev,
                  hasMore: false,
                }
              : prev
          );
          return;
        }

        setResourcePage((prev) => {
          if (!prev || prev.folderId !== normalizedFolderId) return nextPage;

          const mergedItems = mergeResourcePageItems(prev.items, nextPage.items);
          const estimatedHasMore = nextPage.hasMore && mergedItems.length < nextPage.total;
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
    },
    [bilibiliAuthorized, resourceLoading, resourceLoadingMore, resourcePage, t]
  );

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
