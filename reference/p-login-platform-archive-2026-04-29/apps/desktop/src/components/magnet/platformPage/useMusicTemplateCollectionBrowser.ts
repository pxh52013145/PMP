import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { getTelemetryLogger } from '../../../services/telemetry/TelemetryService';
import {
  getMusicPlatformDurationMs,
  getMusicPlatformNowMs,
  readMusicPlatformDiagnosticErrorMessage,
  warnOnSlowMusicPlatformOperation,
} from '../../../modules/music-platform/platformDiagnostics';
import {
  listMusicTemplateCollectionResources,
  listMusicTemplateCollections,
  listMusicTemplateRecommendations,
  mergeMusicTemplateResourcePages,
  searchMusicTemplateResources,
  type MusicTemplateCollectionItem,
  type MusicTemplateResourcePage,
  type MusicTemplateRuntimeTarget,
} from './musicTemplateRuntime';
import type {
  MusicTemplateCollectionBrowserItem,
  MusicTemplateCollectionBrowserSection,
} from './MusicTemplateWorkspace';

type Translator = (key: string, params?: Record<string, string | number>) => string;

const MUSIC_TEMPLATE_SEARCH_PAGE_SIZE = 40;
const DAILY_COLLECTION_BROWSER_ID = '__music-template-daily__';
const telemetry = getTelemetryLogger('magnet.platform', 'useMusicTemplateCollectionBrowser');

type MusicTemplateCollectionSelectionKind =
  | MusicTemplateCollectionBrowserItem['kind']
  | 'search'
  | null;

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

function isSameCollection(
  left: MusicTemplateCollectionItem | null,
  right: MusicTemplateCollectionItem | null
): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    left.collectionId === right.collectionId &&
    left.title === right.title &&
    left.trackCount === right.trackCount &&
    left.coverUrl === right.coverUrl &&
    left.updatedAtMs === right.updatedAtMs
  );
}

export interface UseMusicTemplateCollectionBrowserParams {
  workspaceVisible: boolean;
  workspaceDataEnabled: boolean;
  authorized: boolean;
  musicRuntimeTarget: MusicTemplateRuntimeTarget | null;
  supportsCollections: boolean;
  supportsDailyRecommendations: boolean;
  supportsSearch: boolean;
  t: Translator;
}

export interface MusicTemplateCollectionBrowserState {
  collectionLoading: boolean;
  collectionError: string | null;
  userPlaylists: MusicTemplateCollectionItem[];
  showCollectionBrowser: boolean;
  selectedCollectionId: string | null;
  selectedCollectionKind: MusicTemplateCollectionSelectionKind;
  selectedCollection: MusicTemplateCollectionItem | null;
  searchQuery: string;
  resourceLoading: boolean;
  resourceLoadingMore: boolean;
  resourceError: string | null;
  resourceInfo: string | null;
  resourcePage: MusicTemplateResourcePage | null;
  resourceViewportRef: React.RefObject<HTMLDivElement>;
  collectionBrowserSections: MusicTemplateCollectionBrowserSection[];
  canGoBack: boolean;
  setSearchQuery: (value: string) => void;
  setResourceError: (value: string | null) => void;
  setResourceInfo: (value: string | null) => void;
  runSearch: (
    keyword: string,
    pageNum?: number,
    append?: boolean,
    forceRefresh?: boolean
  ) => Promise<void>;
  handleLoadMoreResources: () => void;
  handleBackToCollections: () => boolean;
  handleOpenDrawerPlaylist: (collectionId: string) => void;
  handleSelectCollection: (item: MusicTemplateCollectionBrowserItem) => void;
}

export function useMusicTemplateCollectionBrowser(
  params: UseMusicTemplateCollectionBrowserParams
): MusicTemplateCollectionBrowserState {
  const {
    workspaceVisible,
    workspaceDataEnabled,
    authorized,
    musicRuntimeTarget,
    supportsCollections,
    supportsDailyRecommendations,
    supportsSearch,
    t,
  } = params;

  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [userPlaylists, setUserPlaylists] = useState<MusicTemplateCollectionItem[]>([]);
  const [recommendedCollections, setRecommendedCollections] = useState<MusicTemplateCollectionItem[]>(
    []
  );
  const [recommendedResourcePage, setRecommendedResourcePage] =
    useState<MusicTemplateResourcePage | null>(null);
  const [showCollectionBrowser, setShowCollectionBrowser] = useState(true);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [selectedCollectionKind, setSelectedCollectionKind] =
    useState<MusicTemplateCollectionSelectionKind>(null);
  const [selectedCollection, setSelectedCollection] = useState<MusicTemplateCollectionItem | null>(
    null
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [resourceLoading, setResourceLoading] = useState(false);
  const [resourceLoadingMore, setResourceLoadingMore] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [resourceInfo, setResourceInfo] = useState<string | null>(null);
  const [resourcePage, setResourcePage] = useState<MusicTemplateResourcePage | null>(null);
  const [resourceSourceKey, setResourceSourceKey] = useState<string | null>(null);

  const resourceViewportRef = useRef<HTMLDivElement>(null);

  const resolveCollectionItemById = useCallback(
    (
      collectionId: string | null,
      kind: Extract<MusicTemplateCollectionSelectionKind, 'recommended-playlist' | 'user-playlist'>
    ): MusicTemplateCollectionItem | null => {
      if (!collectionId) return null;
      const pool = kind === 'recommended-playlist' ? recommendedCollections : userPlaylists;
      return pool.find((item) => item.collectionId === collectionId) ?? null;
    },
    [recommendedCollections, userPlaylists]
  );

  const loadCollectionBrowserData = useCallback(
    async (forceRefresh = false) => {
      if (!workspaceDataEnabled) {
        return;
      }
      if (!authorized || !musicRuntimeTarget) {
        setUserPlaylists([]);
        setRecommendedCollections([]);
        setRecommendedResourcePage(null);
        setCollectionError(null);
        return;
      }

      const startedAtMs = getMusicPlatformNowMs();
      setCollectionLoading(true);
      setCollectionError(null);
      try {
        const userCollectionsPromise = supportsCollections
          ? listMusicTemplateCollections(musicRuntimeTarget, {
              forceRefresh,
            })
          : Promise.resolve<MusicTemplateCollectionItem[]>([]);
        const recommendationsPromise = supportsDailyRecommendations
          ? listMusicTemplateRecommendations(musicRuntimeTarget, {
              forceRefresh,
            })
          : Promise.resolve<{
              page: MusicTemplateResourcePage | null;
              collections: MusicTemplateCollectionItem[];
            }>({
              page: null,
              collections: [],
            });

        const [userCollectionsResult, recommendationsResult] = await Promise.allSettled([
          userCollectionsPromise,
          recommendationsPromise,
        ]);

        let nextError: string | null = null;

        if (userCollectionsResult.status === 'fulfilled') {
          setUserPlaylists(userCollectionsResult.value);
        } else {
          setUserPlaylists([]);
          nextError = toErrorMessage(
            userCollectionsResult.reason,
            t('magnet.platform.music-template.collection.error')
          );
        }

        if (recommendationsResult.status === 'fulfilled') {
          setRecommendedCollections(recommendationsResult.value.collections);
          setRecommendedResourcePage(recommendationsResult.value.page);
        } else {
          setRecommendedCollections([]);
          setRecommendedResourcePage(null);
          nextError ??= toErrorMessage(
            recommendationsResult.reason,
            t('magnet.platform.music-template.resource.errorRecommended')
          );
        }

        setCollectionError(nextError);
        warnOnSlowMusicPlatformOperation({
          logger: telemetry,
          event: 'platform.runtime.music-template.collection-browser-load.slow',
          startedAtMs,
          fields: {
            connectorId: musicRuntimeTarget.connectorId,
            instanceIdPresent: Boolean(musicRuntimeTarget.instanceId),
            forceRefresh,
            supportsCollections,
            supportsDailyRecommendations,
            userCollectionCount:
              userCollectionsResult.status === 'fulfilled' ? userCollectionsResult.value.length : 0,
            recommendedCollectionCount:
              recommendationsResult.status === 'fulfilled'
                ? recommendationsResult.value.collections.length
                : 0,
            hasRecommendedResourcePage:
              recommendationsResult.status === 'fulfilled'
                ? Boolean(recommendationsResult.value.page)
                : false,
            hasPartialError: Boolean(nextError),
          },
        });
      } catch (error) {
        telemetry.warn('platform.runtime.music-template.collection-browser-load.failed', {
          message: readMusicPlatformDiagnosticErrorMessage(error),
          fields: {
            connectorId: musicRuntimeTarget.connectorId,
            instanceIdPresent: Boolean(musicRuntimeTarget.instanceId),
            forceRefresh,
            durationMs: getMusicPlatformDurationMs(startedAtMs),
          },
        });
        setCollectionError(toErrorMessage(error, t('magnet.platform.music-template.collection.error')));
      } finally {
        setCollectionLoading(false);
      }
    },
    [
      authorized,
      musicRuntimeTarget,
      supportsCollections,
      supportsDailyRecommendations,
      t,
      workspaceDataEnabled,
    ]
  );

  const loadDailyResources = useCallback(
    async (forceRefresh = false) => {
      if (!workspaceDataEnabled) {
        return;
      }
      if (!supportsDailyRecommendations) {
        setResourceInfo(t('magnet.platform.music-template.collection.waiting'));
        setResourcePage(null);
        setResourceSourceKey(null);
        setShowCollectionBrowser(true);
        return;
      }
      if (!authorized || !musicRuntimeTarget) {
        setResourcePage(null);
        setResourceSourceKey(null);
        return;
      }

      setSearchQuery('');
      setShowCollectionBrowser(false);
      setSelectedCollectionKind('daily');
      setSelectedCollectionId(DAILY_COLLECTION_BROWSER_ID);
      setSelectedCollection(null);
      setResourceSourceKey('recommended');
      setResourceLoading(true);
      setResourceError(null);
      setResourceInfo(null);

      try {
        if (!forceRefresh && recommendedResourcePage) {
          setResourcePage(recommendedResourcePage);
          return;
        }

        const recommendations = await listMusicTemplateRecommendations(musicRuntimeTarget, {
          forceRefresh,
        });
        setRecommendedCollections(recommendations.collections);
        setRecommendedResourcePage(recommendations.page);
        setResourcePage(recommendations.page);
      } catch (error) {
        setResourceError(
          toErrorMessage(error, t('magnet.platform.music-template.resource.errorRecommended'))
        );
      } finally {
        setResourceLoading(false);
      }
    },
    [
      authorized,
      musicRuntimeTarget,
      recommendedResourcePage,
      supportsDailyRecommendations,
      t,
      workspaceDataEnabled,
    ]
  );

  const loadCollectionResources = useCallback(
    async (
      collectionId: string,
      kind: Extract<MusicTemplateCollectionSelectionKind, 'recommended-playlist' | 'user-playlist'>,
      providedCollection: MusicTemplateCollectionItem | null = null,
      forceRefresh = false
    ) => {
      if (!workspaceDataEnabled) {
        return;
      }

      const normalizedCollectionId = collectionId.trim();
      if (!normalizedCollectionId) {
        setShowCollectionBrowser(true);
        return;
      }
      if (!authorized || !musicRuntimeTarget) {
        setResourcePage(null);
        setResourceSourceKey(null);
        return;
      }

      const resolvedCollection =
        providedCollection ?? resolveCollectionItemById(normalizedCollectionId, kind);

      setSearchQuery('');
      setShowCollectionBrowser(false);
      setSelectedCollectionKind(kind);
      setSelectedCollectionId(normalizedCollectionId);
      setSelectedCollection(resolvedCollection);
      setResourceSourceKey(`collection:${kind}:${normalizedCollectionId}`);
      setResourceLoading(true);
      setResourceError(null);
      setResourceInfo(null);

      try {
        const page = await listMusicTemplateCollectionResources(
          musicRuntimeTarget,
          normalizedCollectionId,
          { forceRefresh }
        );
        setSelectedCollection((prev) => {
          if (resolvedCollection) return resolvedCollection;
          const refreshedCollection = resolveCollectionItemById(normalizedCollectionId, kind);
          return refreshedCollection ?? prev;
        });
        setResourcePage(page);
      } catch (error) {
        setResourceError(
          toErrorMessage(error, t('magnet.platform.music-template.resource.errorPlaylist'))
        );
      } finally {
        setResourceLoading(false);
      }
    },
    [authorized, musicRuntimeTarget, resolveCollectionItemById, t, workspaceDataEnabled]
  );

  const runSearch = useCallback(
    async (keyword: string, pageNum = 1, append = false, forceRefresh = false) => {
      if (!workspaceDataEnabled) {
        return;
      }

      const normalizedKeyword = keyword.trim();
      if (append && resourceLoadingMore) return;
      if (!normalizedKeyword) {
        setShowCollectionBrowser(true);
        setResourceError(null);
        setResourceInfo(null);
        await loadCollectionBrowserData(forceRefresh);
        return;
      }
      if (!supportsSearch) {
        setShowCollectionBrowser(true);
        setResourceError(null);
        setResourceInfo(t('magnet.platform.music-template.resource.searchUnavailable'));
        return;
      }
      if (!authorized || !musicRuntimeTarget) {
        setResourcePage(null);
        setResourceSourceKey(null);
        return;
      }

      setShowCollectionBrowser(false);
      setSelectedCollectionKind('search');
      setSelectedCollectionId(null);
      setSelectedCollection(null);
      setResourceSourceKey(`search:${normalizedKeyword.toLowerCase()}`);
      if (append) {
        setResourceLoadingMore(true);
      } else {
        setResourceLoading(true);
      }
      setResourceError(null);
      setResourceInfo(null);

      try {
        const page = await searchMusicTemplateResources(musicRuntimeTarget, {
          keyword: normalizedKeyword,
          pageNum,
          pageSize: MUSIC_TEMPLATE_SEARCH_PAGE_SIZE,
          forceRefresh,
        });
        setResourcePage((prev) => (append && page ? mergeMusicTemplateResourcePages(prev, page) : page));
      } catch (error) {
        setResourceError(toErrorMessage(error, t('magnet.platform.music-template.resource.errorSearch')));
      } finally {
        if (append) {
          setResourceLoadingMore(false);
        } else {
          setResourceLoading(false);
        }
      }
    },
    [
      authorized,
      loadCollectionBrowserData,
      musicRuntimeTarget,
      resourceLoadingMore,
      supportsSearch,
      t,
      workspaceDataEnabled,
    ]
  );

  useEffect(() => {
    setCollectionError(null);
    setCollectionLoading(false);
    setUserPlaylists([]);
    setRecommendedCollections([]);
    setRecommendedResourcePage(null);
    setShowCollectionBrowser(true);
    setSelectedCollectionId(null);
    setSelectedCollectionKind(null);
    setSelectedCollection(null);
    setSearchQuery('');
    setResourceLoading(false);
    setResourceLoadingMore(false);
    setResourceError(null);
    setResourceInfo(null);
    setResourcePage(null);
    setResourceSourceKey(null);
  }, [musicRuntimeTarget?.connectorId, musicRuntimeTarget?.instanceId]);

  useEffect(() => {
    if (!workspaceDataEnabled) {
      return;
    }
    if (!workspaceVisible || !authorized) {
      if (!authorized) {
        setCollectionError(null);
        setResourceError(null);
        setResourceInfo(null);
        setUserPlaylists([]);
        setRecommendedCollections([]);
        setRecommendedResourcePage(null);
        setShowCollectionBrowser(true);
        setSelectedCollectionId(null);
        setSelectedCollectionKind(null);
        setSelectedCollection(null);
        setSearchQuery('');
        setResourcePage(null);
        setResourceSourceKey(null);
        setResourceLoadingMore(false);
      }
      return;
    }

    void loadCollectionBrowserData();
  }, [authorized, loadCollectionBrowserData, workspaceDataEnabled, workspaceVisible]);

  useEffect(() => {
    if (!selectedCollectionId) return;
    if (
      selectedCollectionKind !== 'recommended-playlist' &&
      selectedCollectionKind !== 'user-playlist'
    ) {
      return;
    }

    const nextSelectedCollection = resolveCollectionItemById(
      selectedCollectionId,
      selectedCollectionKind
    );
    if (nextSelectedCollection) {
      setSelectedCollection((prev) =>
        isSameCollection(prev, nextSelectedCollection) ? prev : nextSelectedCollection
      );
      return;
    }

    if (showCollectionBrowser) {
      setSelectedCollection(null);
      setSelectedCollectionId(null);
      setSelectedCollectionKind(null);
    }
  }, [resolveCollectionItemById, selectedCollectionId, selectedCollectionKind, showCollectionBrowser]);

  useLayoutEffect(() => {
    if (!resourceSourceKey) return;
    const viewportElement = resourceViewportRef.current;
    if (!viewportElement) return;
    viewportElement.scrollTop = 0;
    viewportElement.scrollLeft = 0;
  }, [resourceSourceKey]);

  const handleBackToCollections = useCallback((): boolean => {
    if (showCollectionBrowser) {
      return false;
    }
    setShowCollectionBrowser(true);
    return true;
  }, [showCollectionBrowser]);

  const handleOpenDrawerPlaylist = useCallback(
    (collectionId: string) => {
      const normalizedCollectionId = collectionId.trim();
      if (!normalizedCollectionId) return;
      const resolvedCollection = resolveCollectionItemById(normalizedCollectionId, 'user-playlist');
      void loadCollectionResources(normalizedCollectionId, 'user-playlist', resolvedCollection);
    },
    [loadCollectionResources, resolveCollectionItemById]
  );

  const handleSelectCollection = useCallback(
    (item: MusicTemplateCollectionBrowserItem) => {
      if (item.kind === 'daily') {
        void loadDailyResources();
        return;
      }
      if (!item.collectionId) return;
      const resolvedCollection = resolveCollectionItemById(item.collectionId, item.kind);
      void loadCollectionResources(item.collectionId, item.kind, resolvedCollection);
    },
    [loadCollectionResources, loadDailyResources, resolveCollectionItemById]
  );

  const handleLoadMoreResources = useCallback(() => {
    if (!resourcePage?.hasMore || resourcePage.sourceKind !== 'search') return;
    void runSearch(resourcePage.sourceId, resourcePage.pageNum + 1, true);
  }, [resourcePage, runSearch]);

  const collectionBrowserSections = useMemo<MusicTemplateCollectionBrowserSection[]>(() => {
    if (!authorized || !workspaceDataEnabled) return [];

    const nextSections: MusicTemplateCollectionBrowserSection[] = [];
    const exploreItems: MusicTemplateCollectionBrowserItem[] = [];

    if (supportsDailyRecommendations) {
      exploreItems.push({
        id: 'daily',
        kind: 'daily',
        collectionId: DAILY_COLLECTION_BROWSER_ID,
        title: t('magnet.platform.music-template.collection.recommendedEntry'),
        subtitle: t('magnet.platform.music-template.collection-browser.dailySubtitle'),
        countLabel:
          recommendedResourcePage && recommendedResourcePage.total > 0
            ? t('magnet.platform.music-template.resource.total', {
                count: recommendedResourcePage.total,
              })
            : null,
      });
      exploreItems.push(
        ...recommendedCollections.map((collection) => ({
          id: `recommended:${collection.collectionId}`,
          kind: 'recommended-playlist' as const,
          collectionId: collection.collectionId,
          title: collection.title,
          subtitle: t('magnet.platform.music-template.collection-browser.recommendedSubtitle'),
          countLabel:
            collection.trackCount > 0
              ? t('magnet.platform.music-template.collection.count', {
                  count: collection.trackCount,
                })
              : null,
          coverUrl: collection.coverUrl,
        }))
      );
    }

    if (exploreItems.length > 0) {
      nextSections.push({
        id: 'explore',
        title: t('magnet.platform.music-template.collection-browser.sectionExplore'),
        items: exploreItems,
      });
    }

    return nextSections;
  }, [
    authorized,
    recommendedCollections,
    recommendedResourcePage,
    supportsDailyRecommendations,
    t,
    workspaceDataEnabled,
  ]);

  return {
    collectionLoading,
    collectionError,
    userPlaylists,
    showCollectionBrowser,
    selectedCollectionId,
    selectedCollectionKind,
    selectedCollection,
    searchQuery,
    resourceLoading,
    resourceLoadingMore,
    resourceError,
    resourceInfo,
    resourcePage,
    resourceViewportRef,
    collectionBrowserSections,
    canGoBack: !showCollectionBrowser,
    setSearchQuery,
    setResourceError,
    setResourceInfo,
    runSearch,
    handleLoadMoreResources,
    handleBackToCollections,
    handleOpenDrawerPlaylist,
    handleSelectCollection,
  };
}
