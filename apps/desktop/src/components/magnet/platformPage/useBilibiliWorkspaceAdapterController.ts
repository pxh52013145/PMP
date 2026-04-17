import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { Track } from '../../../services/audio';
import type { IAudioService } from '../../../services/audio/types';
import {
  type BilibiliFavoriteFolderItem,
  listBilibiliPlaybackQualities,
  type BilibiliFavoriteResourceItem,
  type BilibiliPlaybackQualityOption,
  type BilibiliPreparedPlayback,
  type PlatformConnectorFacadeItem,
} from '../../../modules/music-platform';
import { usePersistentSetting } from '../../../modules/storage';
import type { BilibiliWorkspaceProps } from './BilibiliWorkspace';
import type { BilibiliPlaybackSettingsContentProps } from './BilibiliPlaybackSettingsModal';
import { useBilibiliResourceBrowser } from './useBilibiliResourceBrowser';
import { useBilibiliResourceContextMenu } from './useBilibiliResourceContextMenu';
import {
  useBilibiliResourceEnhancer,
  type BilibiliQualityBadge,
} from './useBilibiliResourceEnhancer';
import { useBilibiliResourcePlaybackActions } from './useBilibiliResourcePlaybackActions';

type Translator = (key: string, params?: Record<string, string | number>) => string;

const BILIBILI_CONNECTOR_ID = 'connector.platform.bilibili' as const;
const BILIBILI_PLAYBACK_QUALITY_PREFERENCE_KEY =
  'music-platform.bilibili.playback-quality-preference';

type BilibiliPlaybackQualityKey = 'auto' | '64k' | '132k' | '192k' | 'dolby' | 'hires';

const BILIBILI_QUALITY_OPTION_ORDER: BilibiliPlaybackQualityKey[] = [
  'auto',
  '64k',
  '132k',
  '192k',
  'dolby',
  'hires',
];

const DEFAULT_BILIBILI_QUALITY_OPTIONS: BilibiliPlaybackQualityOption[] =
  BILIBILI_QUALITY_OPTION_ORDER.map((key) => ({
    key,
    label: key,
    available: key === 'auto',
  }));

function toBilibiliQualityLabelKey(key: string): string {
  const normalized = key.trim().toLowerCase();
  switch (normalized) {
    case 'auto':
      return 'magnet.platform.bilibili.quality.option.auto';
    case '64k':
      return 'magnet.platform.bilibili.quality.option.64k';
    case '132k':
      return 'magnet.platform.bilibili.quality.option.132k';
    case '192k':
      return 'magnet.platform.bilibili.quality.option.192k';
    case 'dolby':
      return 'magnet.platform.bilibili.quality.option.dolby';
    case 'hires':
      return 'magnet.platform.bilibili.quality.option.hires';
    default:
      return 'magnet.platform.bilibili.quality.option.auto';
  }
}

function normalizeBilibiliQualityHint(value: string): BilibiliPlaybackQualityKey {
  const normalized = value.trim().toLowerCase();
  if (normalized === '64k') return '64k';
  if (normalized === '132k') return '132k';
  if (normalized === '192k') return '192k';
  if (normalized === 'dolby') return 'dolby';
  if (normalized === 'hires') return 'hires';
  return 'auto';
}

function toBilibiliQualityBadgeLabelKey(badge: BilibiliQualityBadge): string {
  switch (badge) {
    case 'hires':
      return 'magnet.platform.bilibili.quality.badge.hires';
    default:
      return 'magnet.platform.bilibili.quality.badge.dolby';
  }
}

function mergePlaybackQualityOptions(
  options: BilibiliPlaybackQualityOption[]
): BilibiliPlaybackQualityOption[] {
  const lookup = new Map(
    options
      .map((item) => ({ ...item, key: item.key.trim().toLowerCase() }))
      .filter((item) => item.key.length > 0)
      .map((item) => [item.key, item] as const)
  );

  return BILIBILI_QUALITY_OPTION_ORDER.map((key) => {
    const matched = lookup.get(key);
    return {
      key,
      label: matched?.label ?? key,
      available: matched?.available ?? key === 'auto',
    };
  });
}

function formatDuration(seconds: number | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '--:--';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const rest = (total % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
}

function toResourceCacheKey(item: BilibiliFavoriteResourceItem): string {
  return buildStableBilibiliResourceIdentity(item);
}

function buildStableBilibiliResourceIdentity(item: BilibiliFavoriteResourceItem): string {
  const resourceId = item.resourceId.trim();
  if (resourceId) {
    return `rid:${resourceId}`;
  }

  const bvid = (item.bvid || '').trim();
  const cid = (item.cid || '').trim();
  if (bvid && cid) {
    return `bvid:${bvid.toUpperCase()}::cid:${cid}`;
  }
  if (bvid) {
    return `bvid:${bvid.toUpperCase()}`;
  }

  const sourceLocator = item.sourceLocator.trim();
  if (sourceLocator) {
    return `locator:${sourceLocator}`;
  }

  const fallbackSeed = `${item.title || 'unknown'}::${item.ownerName || ''}::${item.durationSeconds || 0}`;
  return `meta:${fallbackSeed.trim() || 'unknown'}`;
}

function isBilibiliVideoSourceLocator(sourceLocator: string): boolean {
  const normalized = sourceLocator.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes('bilibili://video/') ||
    normalized.includes('bilibili.com/video/') ||
    normalized.includes('bvid=')
  );
}

function buildTrackFromPreparedPlayback(
  item: BilibiliFavoriteResourceItem,
  prepared: BilibiliPreparedPlayback,
  coverUrl?: string
): Track {
  const stableIdentity = buildStableBilibiliResourceIdentity(item);
  return {
    id: `bilibili:${stableIdentity}`,
    title: item.title,
    artist: item.ownerName ?? 'Bilibili',
    duration: item.durationSeconds ?? prepared.durationSeconds,
    filePath: prepared.cachePath,
    path: prepared.cachePath,
    originalPath: item.sourceLocator,
    coverUrl: coverUrl ?? item.coverUrl,
    genre: 'Bilibili',
    comment: item.sourceLocator,
  };
}

export interface UseBilibiliWorkspaceAdapterControllerParams {
  activeWorkspaceConnectorId: string | null;
  activeBilibiliInstanceId: string | null;
  items: PlatformConnectorFacadeItem[];
  audioService: IAudioService;
  t: Translator;
  selectedLocalPlaylistId: string | null;
  playlistError: string | null;
  setPlaylistError: (value: string | null) => void;
}

export interface BilibiliWorkspaceAdapterControllerResult {
  bilibiliWorkspaceActive: boolean;
  bilibiliShellSearch: {
    value: string;
    placeholder: string;
    disabled: boolean;
    loading: boolean;
    onChange: (value: string) => void;
    onSubmit: () => void;
  };
  bilibiliPreviewFolders: {
    authorized: boolean;
    loading: boolean;
    error: string | null;
    folders: BilibiliFavoriteFolderItem[];
    selectedFolderId: string | null;
    onShowRecommended: () => void;
    onSelectFolder: (folderId: string) => void;
  };
  bilibiliSettingsProps: BilibiliPlaybackSettingsContentProps;
  bilibiliWorkspaceProps: BilibiliWorkspaceProps;
}

export function useBilibiliWorkspaceAdapterController(
  params: UseBilibiliWorkspaceAdapterControllerParams
): BilibiliWorkspaceAdapterControllerResult {
  const {
    activeWorkspaceConnectorId,
    activeBilibiliInstanceId,
    items,
    audioService,
    t,
    selectedLocalPlaylistId,
    playlistError,
    setPlaylistError,
  } = params;

  const bilibiliWorkspaceActive = activeWorkspaceConnectorId === BILIBILI_CONNECTOR_ID;
  const bilibiliConnector = useMemo(
    () => items.find((item) => item.connectorId === BILIBILI_CONNECTOR_ID) ?? null,
    [items]
  );
  const bilibiliAuthorized = bilibiliConnector?.authState === 'authorized';

  const [playbackQualityHint, setPlaybackQualityHint] = usePersistentSetting<string>(
    BILIBILI_PLAYBACK_QUALITY_PREFERENCE_KEY,
    'auto',
    { format: 'string' }
  );
  const [playbackQualityLoading, setPlaybackQualityLoading] = useState(false);
  const [playbackQualityProbeLocator, setPlaybackQualityProbeLocator] = useState<string | null>(null);
  const [playbackQualityOptions, setPlaybackQualityOptions] = useState<BilibiliPlaybackQualityOption[]>(
    DEFAULT_BILIBILI_QUALITY_OPTIONS
  );

  const resourceViewportRef = useRef<HTMLDivElement>(null);
  const resourceLoadMoreSentinelRef = useRef<HTMLDivElement>(null);

  const {
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
    refreshBilibiliRecommendedResources,
    searchBilibiliHomepageResources,
    refreshBilibiliResources,
    loadMoreBilibiliResources,
    searchBilibiliResourceByLookupInput,
  } = useBilibiliResourceBrowser({
    bilibiliAuthorized,
    t,
  });

  const selectedBilibiliFolder = useMemo(
    () => bilibiliFolders.find((item) => item.folderId === selectedFolderId) ?? null,
    [bilibiliFolders, selectedFolderId]
  );

  const normalizedPlaybackQualityHint = useMemo(
    () => normalizeBilibiliQualityHint(playbackQualityHint),
    [playbackQualityHint]
  );

  const qualityProbeSourceLocator = useMemo(() => {
    if (!bilibiliAuthorized) return null;
    const bvidLocator = bvidSearchResult?.sourceLocator?.trim();
    if (bvidLocator && isBilibiliVideoSourceLocator(bvidLocator)) {
      return bvidLocator;
    }

    const candidate = filteredBilibiliResources.find((item) =>
      isBilibiliVideoSourceLocator(item.sourceLocator)
    );
    return candidate?.sourceLocator?.trim() || null;
  }, [bilibiliAuthorized, bvidSearchResult?.sourceLocator, filteredBilibiliResources]);

  const availablePlaybackQualityLabel = useMemo(() => {
    const availableKeys = playbackQualityOptions.filter((item) => item.available).map((item) => item.key);
    if (availableKeys.length === 0) return t('magnet.platform.bilibili.quality.none');
    return availableKeys.map((key) => t(toBilibiliQualityLabelKey(key))).join(' / ');
  }, [playbackQualityOptions, t]);

  const preferredPlaybackQualityLabel = useMemo(
    () => t(toBilibiliQualityLabelKey(normalizedPlaybackQualityHint)),
    [normalizedPlaybackQualityHint, t]
  );

  const { resourceCoverUrlMap, resourceQualityTagMap } = useBilibiliResourceEnhancer({
    activeBilibiliInstanceId,
    bilibiliAuthorized,
    selectedFolderId,
    bilibiliResources,
    filteredBilibiliResources,
    isVideoSourceLocator: isBilibiliVideoSourceLocator,
    getResourceCacheKey: toResourceCacheKey,
  });

  const {
    resourceInfo,
    preparingResourceId,
    lyricResolvingId,
    resolvedLyric,
    lyricError,
    handleResolveLyric,
    handlePlayResource,
    handleQueueResource,
    handleAddToPlaylist,
    handleOpenBilibiliResource,
  } = useBilibiliResourcePlaybackActions({
    activeBilibiliInstanceId,
    audioService,
    normalizedPlaybackQualityHint,
    preferredQualityLabel: preferredPlaybackQualityLabel,
    targetPlaylistId: selectedLocalPlaylistId,
    t,
    setResourceError,
    setPlaylistError,
    buildTrackFromPreparedPlayback,
  });

  const refreshPlaybackQualityOptions = useCallback(async (sourceLocator: string) => {
    const normalizedSourceLocator = sourceLocator.trim();
    if (!normalizedSourceLocator) return;

    setPlaybackQualityLoading(true);
    try {
      const options = await listBilibiliPlaybackQualities(normalizedSourceLocator);
      setPlaybackQualityOptions(mergePlaybackQualityOptions(options));
      setPlaybackQualityProbeLocator(normalizedSourceLocator);
    } catch {
      setPlaybackQualityOptions(DEFAULT_BILIBILI_QUALITY_OPTIONS);
    } finally {
      setPlaybackQualityLoading(false);
    }
  }, []);

  useEffect(() => {
    const supportsResourceAutoLoad = Boolean(selectedFolderId) || resourceSourceKey?.startsWith('search:');
    if (!supportsResourceAutoLoad || !resourcePage?.hasMore) return;
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
    filteredBilibiliResources.length,
    loadMoreBilibiliResources,
    resourceLoading,
    resourceLoadingMore,
    resourcePage?.hasMore,
    resourceSourceKey,
    selectedFolderId,
  ]);

  useLayoutEffect(() => {
    if (!resourceSourceKey) return;
    const viewportElement = resourceViewportRef.current;
    if (!viewportElement) return;
    viewportElement.scrollTop = 0;
    viewportElement.scrollLeft = 0;
  }, [resourceSourceKey]);

  useEffect(() => {
    if (!qualityProbeSourceLocator) {
      setPlaybackQualityProbeLocator(null);
      setPlaybackQualityOptions(DEFAULT_BILIBILI_QUALITY_OPTIONS);
      return;
    }
    if (playbackQualityProbeLocator === qualityProbeSourceLocator) return;
    void refreshPlaybackQualityOptions(qualityProbeSourceLocator);
  }, [
    playbackQualityProbeLocator,
    qualityProbeSourceLocator,
    refreshPlaybackQualityOptions,
  ]);

  const {
    resourceContextMenu,
    setResourceContextMenu,
    openResourceContextMenu,
  } = useBilibiliResourceContextMenu({
    t,
    preparingResourceId,
    normalizedPlaybackQualityHint,
    lyricResolvingId,
    onPlay: (item) => {
      void handlePlayResource(item);
    },
    onQueue: (item) => {
      void handleQueueResource(item);
    },
    onAddToPlaylist: (item) => {
      void handleAddToPlaylist(item);
    },
    onOpen: (item) => {
      handleOpenBilibiliResource(item);
    },
    onResolveLyric: (item) => {
      void handleResolveLyric(item);
    },
  });

  useEffect(() => {
    if (!bilibiliWorkspaceActive || !bilibiliAuthorized) {
      setResourceContextMenu(null);
    }
  }, [bilibiliAuthorized, bilibiliWorkspaceActive, setResourceContextMenu]);

  const handleBilibiliResourceSearchSubmit = useCallback(() => {
    void (async () => {
      const lookupHandled = await searchBilibiliResourceByLookupInput(resourceFilterQuery);
      if (lookupHandled) return;
      if (!selectedFolderId) {
        await searchBilibiliHomepageResources(resourceFilterQuery);
        return;
      }
      await refreshBilibiliResources(selectedFolderId);
    })();
  }, [
    refreshBilibiliResources,
    resourceFilterQuery,
    searchBilibiliResourceByLookupInput,
    searchBilibiliHomepageResources,
    selectedFolderId,
  ]);

  const bilibiliShellSearch = useMemo(
    () => ({
      value: resourceFilterQuery,
      placeholder: selectedFolderId
        ? t('magnet.platform.bilibili.resource.searchPlaceholder')
        : t('magnet.platform.bilibili.resource.searchPlaceholderHomepage'),
      disabled: !bilibiliAuthorized,
      loading: resourceLoading || resourceLoadingMore || bvidSearching,
      onChange: setResourceFilterQuery,
      onSubmit: handleBilibiliResourceSearchSubmit,
    }),
    [
      bilibiliAuthorized,
      bvidSearching,
      handleBilibiliResourceSearchSubmit,
      resourceFilterQuery,
      resourceLoading,
      resourceLoadingMore,
      selectedFolderId,
      setResourceFilterQuery,
      t,
    ]
  );

  const bilibiliPreviewFolders = useMemo(
    () => ({
      authorized: bilibiliAuthorized,
      loading: folderLoading,
      error: folderError,
      folders: bilibiliFolders,
      selectedFolderId,
      onShowRecommended: () => {
        setSelectedFolderId(null);
      },
      onSelectFolder: (folderId: string) => {
        setSelectedFolderId(folderId);
      },
    }),
    [bilibiliAuthorized, bilibiliFolders, folderError, folderLoading, selectedFolderId, setSelectedFolderId]
  );

  const bilibiliSettingsProps: BilibiliPlaybackSettingsContentProps = {
    t,
    bilibiliAuthorized,
    normalizedPlaybackQualityHint,
    playbackQualityOptions,
    playbackQualityLoading,
    qualityProbeSourceLocator,
    availablePlaybackQualityLabel,
    qualityLabelForKey: (qualityKey) => t(toBilibiliQualityLabelKey(normalizeBilibiliQualityHint(qualityKey))),
    onQualityHintChange: (qualityKey) => {
      setPlaybackQualityHint(normalizeBilibiliQualityHint(qualityKey));
    },
    onRefreshQualityOptions: () => {
      if (!qualityProbeSourceLocator) return;
      void refreshPlaybackQualityOptions(qualityProbeSourceLocator);
    },
  };

  const bilibiliWorkspaceProps: BilibiliWorkspaceProps = {
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
    resourceViewportRef,
    resourceLoadMoreSentinelRef,
    playlistError,
    resolvedLyric,
    lyricError,
    resourceContextMenu,
    t,
    formatDuration,
    getResourceCacheKey: toResourceCacheKey,
    getQualityBadgeLabel: (badge) => t(toBilibiliQualityBadgeLabelKey(badge)),
    onRefreshResources: () => {
      if (!selectedFolderId) {
        const keyword = resourceFilterQuery.trim();
        if (keyword) {
          void searchBilibiliHomepageResources(keyword);
          return;
        }
        void refreshBilibiliRecommendedResources();
        return;
      }
      void refreshBilibiliResources(selectedFolderId);
    },
    onOpenResourceContextMenu: openResourceContextMenu,
    onLoadMoreResources: () => {
      void loadMoreBilibiliResources();
    },
    onCloseResourceContextMenu: () => {
      setResourceContextMenu(null);
    },
  };

  return {
    bilibiliWorkspaceActive,
    bilibiliShellSearch,
    bilibiliPreviewFolders,
    bilibiliSettingsProps,
    bilibiliWorkspaceProps,
  };
}
