import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { getTelemetryLogger } from '../../../services/telemetry/TelemetryService';
import type { Track } from '../../../services/audio';
import type { IAudioService } from '../../../services/audio/types';
import {
  BILIBILI_CONNECTOR_ID,
  buildBilibiliResourceIdentity,
  createDefaultBilibiliPlaybackQualityOptions,
  isBilibiliVideoSourceLocator,
  listBilibiliPlaybackQualities,
  mergeBilibiliPlaybackQualityOptions,
  normalizeBilibiliPlaybackQualityKey,
  type BilibiliFavoriteFolderItem,
  type BilibiliFavoriteResourceItem,
  type BilibiliQualityBadge,
  type BilibiliPlaybackQualityOption,
  type BilibiliPreparedPlayback,
  type PlatformConnectorAuthState,
  type PlatformConnectorId,
} from '../../../modules/music-platform';
import {
  getMusicPlatformDurationMs,
  getMusicPlatformNowMs,
  readMusicPlatformDiagnosticErrorMessage,
  warnOnSlowMusicPlatformOperation,
} from '../../../modules/music-platform/platformDiagnostics';
import { usePersistentSetting } from '../../../modules/storage';
import type { BilibiliWorkspaceProps } from './BilibiliWorkspace';
import type { BilibiliPlaybackSettingsContentProps } from './BilibiliPlaybackSettingsModal';
import { useBilibiliResourceBrowser } from './useBilibiliResourceBrowser';
import { useBilibiliResourceContextMenu } from './useBilibiliResourceContextMenu';
import { useBilibiliResourceEnhancer } from './useBilibiliResourceEnhancer';
import { useBilibiliResourcePlaybackActions } from './useBilibiliResourcePlaybackActions';

type Translator = (key: string, params?: Record<string, string | number>) => string;

const BILIBILI_PLAYBACK_QUALITY_PREFERENCE_KEY =
  'music-platform.bilibili.playback-quality-preference';

const telemetry = getTelemetryLogger('magnet.platform', 'useBilibiliWorkspaceAdapterController');

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

function toBilibiliQualityBadgeLabelKey(badge: BilibiliQualityBadge): string {
  switch (badge) {
    case 'hires':
      return 'magnet.platform.bilibili.quality.badge.hires';
    default:
      return 'magnet.platform.bilibili.quality.badge.dolby';
  }
}

function normalizeWorkspaceConnectorId(
  value: string | null | undefined
): PlatformConnectorId | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized.startsWith('connector.platform.')) return null;
  return normalized as PlatformConnectorId;
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
  return buildBilibiliResourceIdentity(item);
}

function buildTrackFromPreparedPlayback(
  item: BilibiliFavoriteResourceItem,
  prepared: BilibiliPreparedPlayback,
  coverUrl?: string
): Track {
  const stableIdentity = buildBilibiliResourceIdentity(item);
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
  workspaceVisible: boolean;
  activeWorkspaceConnectorId: string | null;
  activeVideoConnectorId: string | null;
  activeVideoInstanceId: string | null;
  activeVideoAuthState: PlatformConnectorAuthState | null;
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
    workspaceVisible,
    activeWorkspaceConnectorId,
    activeVideoConnectorId,
    activeVideoInstanceId,
    activeVideoAuthState,
    audioService,
    t,
    selectedLocalPlaylistId,
    playlistError,
    setPlaylistError,
  } = params;

  const workspaceConnectorId =
    normalizeWorkspaceConnectorId(activeVideoConnectorId) ?? BILIBILI_CONNECTOR_ID;
  const bilibiliWorkspaceActive =
    workspaceVisible && activeWorkspaceConnectorId === workspaceConnectorId;
  const bilibiliAuthorized = activeVideoAuthState === 'authorized';

  const [playbackQualityHint, setPlaybackQualityHint] = usePersistentSetting<string>(
    BILIBILI_PLAYBACK_QUALITY_PREFERENCE_KEY,
    'auto',
    { format: 'string' }
  );
  const [playbackQualityLoading, setPlaybackQualityLoading] = useState(false);
  const [playbackQualityProbeLocator, setPlaybackQualityProbeLocator] = useState<string | null>(null);
  const [playbackQualityOptions, setPlaybackQualityOptions] = useState<BilibiliPlaybackQualityOption[]>(
    () => createDefaultBilibiliPlaybackQualityOptions()
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
    workspaceVisible,
    workspaceConnectorId,
    bilibiliInstanceId: activeVideoInstanceId,
    bilibiliAuthorized,
    t,
  });

  const selectedBilibiliFolder = useMemo(
    () => bilibiliFolders.find((item) => item.folderId === selectedFolderId) ?? null,
    [bilibiliFolders, selectedFolderId]
  );

  const normalizedPlaybackQualityHint = useMemo(
    () => normalizeBilibiliPlaybackQualityKey(playbackQualityHint),
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
    activeBilibiliInstanceId: activeVideoInstanceId,
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
    workspaceConnectorId,
    activeBilibiliInstanceId: activeVideoInstanceId,
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

    const startedAtMs = getMusicPlatformNowMs();
    setPlaybackQualityLoading(true);
    try {
      const options = await listBilibiliPlaybackQualities(
        normalizedSourceLocator,
        activeVideoInstanceId
      );
      setPlaybackQualityOptions(mergeBilibiliPlaybackQualityOptions(options));
      setPlaybackQualityProbeLocator(normalizedSourceLocator);
      warnOnSlowMusicPlatformOperation({
        logger: telemetry,
        event: 'platform.runtime.bilibili.quality-options-load.slow',
        startedAtMs,
        fields: {
          connectorId: workspaceConnectorId,
          instanceIdPresent: Boolean(activeVideoInstanceId),
          sourceLocatorPresent: true,
          optionCount: options.length,
        },
      });
    } catch (error) {
      telemetry.warn('platform.runtime.bilibili.quality-options-load.failed', {
        message: readMusicPlatformDiagnosticErrorMessage(error),
        fields: {
          connectorId: workspaceConnectorId,
          instanceIdPresent: Boolean(activeVideoInstanceId),
          durationMs: getMusicPlatformDurationMs(startedAtMs),
        },
      });
      setPlaybackQualityOptions(createDefaultBilibiliPlaybackQualityOptions());
    } finally {
      setPlaybackQualityLoading(false);
    }
  }, [activeVideoInstanceId, workspaceConnectorId]);

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
      setPlaybackQualityOptions(createDefaultBilibiliPlaybackQualityOptions());
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
    qualityLabelForKey: (qualityKey) =>
      t(toBilibiliQualityLabelKey(normalizeBilibiliPlaybackQualityKey(qualityKey))),
    onQualityHintChange: (qualityKey) => {
      setPlaybackQualityHint(normalizeBilibiliPlaybackQualityKey(qualityKey));
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
