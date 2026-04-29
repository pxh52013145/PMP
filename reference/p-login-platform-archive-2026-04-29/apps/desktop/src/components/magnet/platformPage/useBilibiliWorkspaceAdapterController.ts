import { useCallback, useEffect, useMemo } from 'react';

import type { Track } from '../../../services/audio';
import type { IAudioService } from '../../../services/audio/types';
import {
  BILIBILI_CONNECTOR_ID,
  getPlatformConnectorDefinition,
  type PlatformConnectorAuthState,
  type PlatformConnectorId,
} from '../../../modules/music-platform';
import {
  buildBilibiliResourceIdentity,
  isBilibiliVideoSourceLocator,
  normalizeBilibiliPlaybackQualityKey,
  type BilibiliFavoriteFolderItem,
  type BilibiliFavoriteResourceItem,
  type BilibiliPreparedPlayback,
  type BilibiliQualityBadge,
} from '../../../modules/music-platform/bilibiliWorkspaceModel';
import type { BilibiliPlaybackSettingsContentProps } from './BilibiliPlaybackSettingsModal';
import type { BilibiliWorkspaceProps } from './BilibiliWorkspace';
import type { BilibiliWorkspaceRuntimeTarget } from './bilibiliWorkspaceRuntime';
import {
  useBilibiliPlaybackQuality,
  resolveBilibiliPlaybackQualityDisplayLabel,
} from './useBilibiliPlaybackQuality';
import { useBilibiliResourceBrowser } from './useBilibiliResourceBrowser';
import { useBilibiliResourceContextMenu } from './useBilibiliResourceContextMenu';
import { useBilibiliResourceEnhancer } from './useBilibiliResourceEnhancer';
import { useBilibiliResourcePlaybackActions } from './useBilibiliResourcePlaybackActions';
import { useBilibiliResourceViewport } from './useBilibiliResourceViewport';

type Translator = (key: string, params?: Record<string, string | number>) => string;

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
  const cachePath =
    typeof prepared.cachePath === 'string' && prepared.cachePath.trim().length > 0
      ? prepared.cachePath.trim()
      : undefined;
  const preferredPath = cachePath || item.sourceLocator;
  return {
    id: `bilibili:${stableIdentity}`,
    title: item.title,
    artist: item.ownerName ?? 'Bilibili',
    duration: item.durationSeconds ?? prepared.durationSeconds,
    filePath: cachePath,
    path: preferredPath,
    originalPath: item.sourceLocator,
    coverUrl: coverUrl ?? item.coverUrl,
    genre: 'Bilibili',
    comment: item.sourceLocator,
  };
}

export interface UseBilibiliWorkspaceAdapterControllerParams {
  workspaceVisible: boolean;
  workspaceDataEnabled?: boolean;
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
    workspaceDataEnabled = true,
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
  const controllerVisible =
    workspaceVisible &&
    Boolean(activeVideoConnectorId) &&
    activeWorkspaceConnectorId === workspaceConnectorId;
  const bilibiliWorkspaceActive = controllerVisible && workspaceDataEnabled;
  const bilibiliAuthorized = activeVideoAuthState === 'authorized';
  const bilibiliRuntimeTarget = useMemo<BilibiliWorkspaceRuntimeTarget | null>(() => {
    if (!workspaceConnectorId) return null;
    const displayName =
      getPlatformConnectorDefinition(workspaceConnectorId)?.displayName || 'Bilibili';
    return {
      connectorId: workspaceConnectorId,
      displayName,
      instanceId: activeVideoInstanceId,
    };
  }, [activeVideoInstanceId, workspaceConnectorId]);

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
    workspaceVisible: bilibiliWorkspaceActive,
    bilibiliRuntimeTarget,
    bilibiliAuthorized,
    t,
  });

  const selectedBilibiliFolder = useMemo(
    () => bilibiliFolders.find((item) => item.folderId === selectedFolderId) ?? null,
    [bilibiliFolders, selectedFolderId]
  );

  const qualityProbeSourceLocator = useMemo(() => {
    if (!bilibiliWorkspaceActive || !bilibiliAuthorized) return null;
    const bvidLocator = bvidSearchResult?.sourceLocator?.trim();
    if (bvidLocator && isBilibiliVideoSourceLocator(bvidLocator)) {
      return bvidLocator;
    }

    const candidate = filteredBilibiliResources.find((item) =>
      isBilibiliVideoSourceLocator(item.sourceLocator)
    );
    return candidate?.sourceLocator?.trim() || null;
  }, [
    bilibiliAuthorized,
    bilibiliWorkspaceActive,
    bvidSearchResult?.sourceLocator,
    filteredBilibiliResources,
  ]);

  const playbackQuality = useBilibiliPlaybackQuality({
    controllerVisible,
    bilibiliRuntimeTarget,
    bilibiliAuthorized,
    qualityProbeSourceLocator,
    t,
  });

  const { resourceCoverUrlMap, resourceQualityTagMap } = useBilibiliResourceEnhancer({
    bilibiliRuntimeTarget,
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
    bilibiliRuntimeTarget,
    audioService,
    normalizedPlaybackQualityHint: playbackQuality.normalizedPlaybackQualityHint,
    preferredQualityLabel: playbackQuality.preferredPlaybackQualityLabel,
    targetPlaylistId: selectedLocalPlaylistId,
    t,
    setResourceError,
    setPlaylistError,
    buildTrackFromPreparedPlayback,
  });

  const { resourceViewportRef, resourceLoadMoreSentinelRef } = useBilibiliResourceViewport({
    workspaceVisible: bilibiliWorkspaceActive,
    selectedFolderId,
    resourceSourceKey,
    resourcePageHasMore: resourcePage?.hasMore === true,
    resourceLoading,
    resourceLoadingMore,
    filteredResourceCount: filteredBilibiliResources.length,
    loadMoreBilibiliResources,
  });

  const {
    resourceContextMenu,
    setResourceContextMenu,
    openResourceContextMenu,
  } = useBilibiliResourceContextMenu({
    t,
    preparingResourceId,
    normalizedPlaybackQualityHint: playbackQuality.normalizedPlaybackQualityHint,
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
    searchBilibiliHomepageResources,
    searchBilibiliResourceByLookupInput,
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
    normalizedPlaybackQualityHint: playbackQuality.normalizedPlaybackQualityHint,
    playbackQualityOptions: playbackQuality.playbackQualityOptions,
    playbackQualityLoading: playbackQuality.playbackQualityLoading,
    qualityProbeSourceLocator,
    availablePlaybackQualityLabel: playbackQuality.availablePlaybackQualityLabel,
    qualityLabelForKey: (qualityKey, qualityLabel) =>
      resolveBilibiliPlaybackQualityDisplayLabel(
        normalizeBilibiliPlaybackQualityKey(qualityKey),
        qualityLabel,
        t
      ),
    onQualityHintChange: playbackQuality.handleQualityHintChange,
    onRefreshQualityOptions: () => {
      if (!qualityProbeSourceLocator) return;
      void playbackQuality.refreshPlaybackQualityOptions(qualityProbeSourceLocator);
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
    normalizedPlaybackQualityHint: playbackQuality.normalizedPlaybackQualityHint,
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
