import { useMemo } from 'react';

import type { IAudioService, Playlist as AudioPlaylist } from '../../../services/audio';
import type {
  PlatformCompatRegistryRecord,
  PlatformConnectorAuthState,
} from '../../../modules/music-platform';
import type { MusicTemplatePlaybackSettingsContentProps } from './MusicTemplatePlaybackSettings';
import type { MusicTemplateWorkspaceProps } from './MusicTemplateWorkspace';
import type { MusicTemplateWorkspaceToolbarProps } from './MusicTemplateWorkspaceAdapter';
import {
  normalizeMusicTemplateQualityKey,
  resolveMusicTemplateQualityLabelKey,
  resolveMusicTemplateQualityProbeSourceLocator,
  type MusicTemplateRuntimeTarget,
} from './musicTemplateRuntime';
import { useMusicTemplateCollectionBrowser } from './useMusicTemplateCollectionBrowser';
import { useMusicTemplatePlaybackActions } from './useMusicTemplatePlaybackActions';
import { useMusicTemplatePlaybackQuality } from './useMusicTemplatePlaybackQuality';
import { useMusicTemplateWorkspaceModel } from './useMusicTemplateWorkspaceModel';

type Translator = (key: string, params?: Record<string, string | number>) => string;

function formatDuration(seconds: number | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return '--:--';
  }

  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const rest = (total % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
}

export interface UseMusicTemplateWorkspaceAdapterControllerParams {
  workspaceVisible: boolean;
  workspaceDataEnabled?: boolean;
  activeWorkspaceConnectorId: string | null;
  activeMusicConnectorId: string | null;
  activeMusicDisplayName: string | null;
  activeMusicContractRecord: PlatformCompatRegistryRecord | null;
  activeMusicInstanceId: string | null;
  activeMusicAuthState: PlatformConnectorAuthState | null;
  prefersDarkMode: boolean;
  audioService: IAudioService;
  t: Translator;
  selectedPlaylistId: string | null;
  playlistError: string | null;
  setPlaylistError: (value: string | null) => void;
}

export interface MusicTemplateWorkspaceAdapterControllerResult {
  musicTemplateWorkspaceActive: boolean;
  musicTemplateUseDarkMode: boolean;
  musicTemplateQualitySupported: boolean;
  musicTemplateSettingsSupported: boolean;
  musicTemplateCanGoBack: boolean;
  musicTemplateHandleBackAction: () => boolean;
  musicTemplateOpenDrawerPlaylist: (collectionId: string) => void;
  musicTemplateDrawerPlaylists: AudioPlaylist[];
  musicTemplateShellSearch: {
    value: string;
    placeholder: string;
    disabled: boolean;
    loading: boolean;
    onChange: (value: string) => void;
    onSubmit: () => void;
  };
  musicTemplateToolbarProps: MusicTemplateWorkspaceToolbarProps;
  musicTemplateWorkspaceProps: MusicTemplateWorkspaceProps;
  musicTemplateSettingsProps: MusicTemplatePlaybackSettingsContentProps;
}

export function useMusicTemplateWorkspaceAdapterController(
  params: UseMusicTemplateWorkspaceAdapterControllerParams
): MusicTemplateWorkspaceAdapterControllerResult {
  const {
    workspaceVisible,
    workspaceDataEnabled = true,
    activeWorkspaceConnectorId,
    activeMusicConnectorId,
    activeMusicDisplayName,
    activeMusicContractRecord,
    activeMusicInstanceId,
    activeMusicAuthState,
    prefersDarkMode,
    audioService,
    t,
    selectedPlaylistId,
    playlistError,
    setPlaylistError,
  } = params;

  const musicRuntimeTarget = useMemo<MusicTemplateRuntimeTarget | null>(
    () =>
      activeMusicConnectorId
        ? {
            connectorId: activeMusicConnectorId,
            displayName: activeMusicDisplayName?.trim() || activeMusicConnectorId,
            instanceId: activeMusicInstanceId,
          }
        : null,
    [activeMusicConnectorId, activeMusicDisplayName, activeMusicInstanceId]
  );
  const controllerVisible =
    workspaceVisible &&
    Boolean(activeMusicConnectorId) &&
    activeWorkspaceConnectorId === activeMusicConnectorId;
  const musicTemplateWorkspaceActive = controllerVisible && workspaceDataEnabled;
  const authorized = activeMusicAuthState === 'authorized';

  const { workspaceCapabilities } = useMusicTemplateWorkspaceModel({
    contractRecord: activeMusicContractRecord,
    musicRuntimeTarget,
  });
  const supportsCollections = workspaceCapabilities.collections;
  const supportsDailyRecommendations = workspaceCapabilities.recommendations;
  const supportsSearch = workspaceCapabilities.search;
  const musicTemplateQualitySupported = workspaceCapabilities.quality;

  const browser = useMusicTemplateCollectionBrowser({
    workspaceVisible: controllerVisible,
    workspaceDataEnabled,
    authorized,
    musicRuntimeTarget,
    supportsCollections,
    supportsDailyRecommendations,
    supportsSearch,
    t,
  });

  const qualityProbeSourceLocator = useMemo(
    () => resolveMusicTemplateQualityProbeSourceLocator(browser.resourcePage),
    [browser.resourcePage]
  );

  const quality = useMusicTemplatePlaybackQuality({
    controllerVisible,
    authorized,
    qualitySupported: musicTemplateQualitySupported,
    musicRuntimeTarget,
    qualityProbeSourceLocator,
    t,
  });

  const playbackActions = useMusicTemplatePlaybackActions({
    musicRuntimeTarget,
    playbackQualityState: quality.playbackQualityState,
    audioService,
    selectedPlaylistId,
    t,
    setResourceError: browser.setResourceError,
    setResourceInfo: browser.setResourceInfo,
    setPlaylistError,
  });

  const musicTemplateDrawerPlaylists = useMemo<AudioPlaylist[]>(
    () =>
      browser.userPlaylists.map((collection) => ({
        id: collection.collectionId,
        name: collection.title,
        description: '',
        tracks: [],
        kind: 'platform',
        readonly: true,
        sourceConnectorId: activeMusicConnectorId ?? undefined,
        sourcePlaylistId: collection.collectionId,
        coverUrl: collection.coverUrl,
        createdAt: collection.updatedAtMs ?? 0,
        updatedAt: collection.updatedAtMs ?? 0,
        trackCount: collection.trackCount,
        totalDuration: 0,
        tracksHydrated: false,
      })),
    [activeMusicConnectorId, browser.userPlaylists]
  );

  const selectedDrawerPlaylist = useMemo(
    () =>
      musicTemplateDrawerPlaylists.find((playlist) => playlist.id === selectedPlaylistId) ?? null,
    [musicTemplateDrawerPlaylists, selectedPlaylistId]
  );
  const {
    searchQuery,
    resourceLoading,
    resourceLoadingMore,
    setSearchQuery,
    runSearch,
  } = browser;

  const musicTemplateShellSearch = useMemo(
    () => ({
      value: searchQuery,
      placeholder: supportsSearch
        ? t('magnet.platform.music-template.resource.searchPlaceholder')
        : t('magnet.platform.music-template.resource.searchUnavailable'),
      disabled: !authorized || !supportsSearch,
      loading: resourceLoading || resourceLoadingMore,
      onChange: setSearchQuery,
      onSubmit: () => {
        void runSearch(searchQuery, 1, false, false);
      },
    }),
    [
      authorized,
      resourceLoading,
      resourceLoadingMore,
      runSearch,
      searchQuery,
      setSearchQuery,
      supportsSearch,
      t,
    ]
  );

  const musicTemplateToolbarProps: MusicTemplateWorkspaceToolbarProps = {};

  const musicTemplateSettingsProps: MusicTemplatePlaybackSettingsContentProps = {
    t,
    authorized,
    qualitySupported: musicTemplateQualitySupported,
    qualityLoading: quality.playbackQualityLoading,
    qualitySaving: quality.playbackQualitySaving,
    qualityError: quality.playbackQualityError,
    qualityState: quality.playbackQualityState,
    qualityLabelForKey: (qualityKey) =>
      t(resolveMusicTemplateQualityLabelKey(normalizeMusicTemplateQualityKey(qualityKey))),
    onQualityHintChange: (qualityKey) => {
      void quality.setPlaybackQualityPreference(qualityKey);
    },
    onRefreshQualityState: () => {
      void quality.refreshPlaybackQualityState(true);
    },
  };

  const musicTemplateWorkspaceProps: MusicTemplateWorkspaceProps = {
    authorized,
    platformLabel: musicRuntimeTarget?.displayName ?? t('magnet.platform.title'),
    platformAccentColor: '#8aa6ff',
    platformFallbackLabel: 'M',
    platformIconAssetUrl: null,
    collectionLoading: browser.collectionLoading,
    collectionError: browser.collectionError,
    collectionBrowserSections: browser.collectionBrowserSections,
    selectedCollectionId:
      browser.selectedCollectionKind === 'search' ? null : browser.selectedCollectionId,
    selectedCollection: browser.selectedCollection,
    showCollectionBrowser: browser.showCollectionBrowser,
    resourceLoading: browser.resourceLoading,
    resourceLoadingMore: browser.resourceLoadingMore,
    resourceError: browser.resourceError,
    resourceInfo: browser.resourceInfo,
    resourcePage: browser.resourcePage,
    resourceViewportRef: browser.resourceViewportRef,
    preparingResourceId: playbackActions.preparingResourceId,
    selectedPlatformPlaylistId: selectedPlaylistId,
    selectedPlatformPlaylistTitle: selectedDrawerPlaylist?.name ?? null,
    selectedPlatformPlaylistCoverUrl: selectedDrawerPlaylist?.coverUrl ?? null,
    selectedPlatformPlaylistTrackCount:
      typeof selectedDrawerPlaylist?.trackCount === 'number' &&
      Number.isFinite(selectedDrawerPlaylist.trackCount)
        ? selectedDrawerPlaylist.trackCount
        : null,
    playlistError,
    t,
    formatDuration,
    onSelectCollection: browser.handleSelectCollection,
    onLoadMoreResources: browser.handleLoadMoreResources,
    onPlaySong: (item) => {
      void playbackActions.handlePlaySong(item);
    },
    onQueueSong: (item) => {
      void playbackActions.handleQueueSong(item);
    },
    onAddSongToPlaylist: (item) => {
      void playbackActions.handleAddSongToPlaylist(item);
    },
    onOpenSong: playbackActions.handleOpenSong,
  };

  return {
    musicTemplateWorkspaceActive,
    musicTemplateUseDarkMode: musicTemplateWorkspaceActive && prefersDarkMode,
    musicTemplateQualitySupported,
    musicTemplateSettingsSupported: musicTemplateQualitySupported,
    musicTemplateCanGoBack: browser.canGoBack,
    musicTemplateHandleBackAction: browser.handleBackToCollections,
    musicTemplateOpenDrawerPlaylist: browser.handleOpenDrawerPlaylist,
    musicTemplateDrawerPlaylists,
    musicTemplateShellSearch,
    musicTemplateToolbarProps,
    musicTemplateWorkspaceProps,
    musicTemplateSettingsProps,
  };
}
