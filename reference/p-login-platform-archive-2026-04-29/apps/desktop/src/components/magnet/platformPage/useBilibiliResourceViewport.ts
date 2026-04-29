import { useEffect, useLayoutEffect, useRef } from 'react';

export interface UseBilibiliResourceViewportParams {
  workspaceVisible: boolean;
  selectedFolderId: string | null;
  resourceSourceKey: string | null;
  resourcePageHasMore: boolean;
  resourceLoading: boolean;
  resourceLoadingMore: boolean;
  filteredResourceCount: number;
  loadMoreBilibiliResources: () => Promise<void>;
}

export interface BilibiliResourceViewportController {
  resourceViewportRef: React.RefObject<HTMLDivElement>;
  resourceLoadMoreSentinelRef: React.RefObject<HTMLDivElement>;
}

export function useBilibiliResourceViewport(
  params: UseBilibiliResourceViewportParams
): BilibiliResourceViewportController {
  const {
    workspaceVisible,
    selectedFolderId,
    resourceSourceKey,
    resourcePageHasMore,
    resourceLoading,
    resourceLoadingMore,
    filteredResourceCount,
    loadMoreBilibiliResources,
  } = params;

  const resourceViewportRef = useRef<HTMLDivElement>(null);
  const resourceLoadMoreSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!workspaceVisible) return;
    const supportsResourceAutoLoad = Boolean(selectedFolderId) || resourceSourceKey?.startsWith('search:');
    if (!supportsResourceAutoLoad || !resourcePageHasMore) return;
    const rootElement = resourceViewportRef.current;
    const sentinelElement = resourceLoadMoreSentinelRef.current;
    if (!rootElement || !sentinelElement) return;
    if (rootElement.scrollHeight <= rootElement.clientHeight + 1) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (resourceLoading || resourceLoadingMore) return;
        void loadMoreBilibiliResources();
      },
      {
        root: rootElement,
        rootMargin: '220px 0px',
        threshold: 0.01,
      }
    );

    observer.observe(sentinelElement);
    return () => observer.disconnect();
  }, [
    filteredResourceCount,
    loadMoreBilibiliResources,
    resourceLoading,
    resourceLoadingMore,
    resourcePageHasMore,
    resourceSourceKey,
    selectedFolderId,
    workspaceVisible,
  ]);

  useLayoutEffect(() => {
    if (!workspaceVisible || !resourceSourceKey) return;
    const viewportElement = resourceViewportRef.current;
    if (!viewportElement) return;
    viewportElement.scrollTop = 0;
    viewportElement.scrollLeft = 0;
  }, [resourceSourceKey, workspaceVisible]);

  return {
    resourceViewportRef,
    resourceLoadMoreSentinelRef,
  };
}
