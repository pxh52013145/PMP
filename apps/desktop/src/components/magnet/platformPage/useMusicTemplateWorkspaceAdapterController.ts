
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { IAudioService, Playlist as AudioPlaylist, Track } from '../../../services/audio';
import type {
  PlatformCompatRegistryRecord,
  PlatformConnectorAuthState,
} from '../../../modules/music-platform';
import type { MusicTemplatePlaybackSettingsContentProps } from './MusicTemplatePlaybackSettings';
import type {
  MusicTemplateCollectionBrowserItem,
  MusicTemplateCollectionBrowserSection,
  MusicTemplateWorkspaceProps,
} from './MusicTemplateWorkspace';
import type { MusicTemplateWorkspaceToolbarProps } from './MusicTemplateWorkspaceAdapter';
import {
  getMusicTemplatePlaybackQualityState,
  listMusicTemplateCollectionResources,
  listMusicTemplateCollections,
  listMusicTemplateRecommendations,
  prepareMusicTemplatePlayback,
  setMusicTemplatePlaybackQualityPreference,
  searchMusicTemplateResources,
  type MusicTemplateCollectionItem,
  type MusicTemplatePlaybackQualityState,
  type MusicTemplatePreparedPlayback,
  type MusicTemplateResourceItem,
  type MusicTemplateResourcePage,
  type MusicTemplateRuntimeTarget,
} from './musicTemplateRuntime';

type Translator = (key: string, params?: Record<string, string | number>) => string;

const MUSIC_TEMPLATE_SEARCH_PAGE_SIZE = 40;
const PREPARED_TRACK_CACHE_LIMIT = 96;
const DAILY_COLLECTION_BROWSER_ID = '__music-template-daily__';

type MusicTemplatePlaybackQualityKey = 'auto' | 'standard' | 'higher' | 'exhigh' | 'lossless';
type MusicTemplateCollectionSelectionKind = MusicTemplateCollectionBrowserItem['kind'] | 'search' | null;

function normalizeMusicTemplateQualityKey(value: string): MusicTemplatePlaybackQualityKey {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'standard' || normalized === '128k') return 'standard';
  if (normalized === 'higher' || normalized === '192k') return 'higher';
  if (normalized === 'exhigh' || normalized === '320k') return 'exhigh';
  if (normalized === 'lossless' || normalized === '999k') return 'lossless';
  return 'auto';
}

function toMusicTemplateQualityLabelKey(value: string): string {
  switch (normalizeMusicTemplateQualityKey(value)) {
    case 'standard':
      return 'magnet.platform.music-template.quality.option.standard';
    case 'higher':
      return 'magnet.platform.music-template.quality.option.higher';
    case 'exhigh':
      return 'magnet.platform.music-template.quality.option.exhigh';
    case 'lossless':
      return 'magnet.platform.music-template.quality.option.lossless';
    default:
      return 'magnet.platform.music-template.quality.option.auto';
  }
}

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

function setPreparedTrackWithBoundedLru(cache: Map<string, Track>, cacheKey: string, track: Track): void {
  if (cache.has(cacheKey)) {
    cache.delete(cacheKey);
  }
  cache.set(cacheKey, track);

  while (cache.size > PREPARED_TRACK_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

function mergeSongPages(
  previous: MusicTemplateResourcePage | null,
  next: MusicTemplateResourcePage
): MusicTemplateResourcePage {
  if (!previous || previous.sourceKind !== next.sourceKind || previous.sourceId !== next.sourceId) {
    return next;
  }

  const seen = new Set(previous.items.map((item) => item.resourceId));
  const items = previous.items.slice();
  for (const item of next.items) {
    if (seen.has(item.resourceId)) continue;
    seen.add(item.resourceId);
    items.push(item);
  }

  return {
    ...next,
    items,
  };
}

function buildTrackFromPreparedPlayback(
  item: MusicTemplateResourceItem,
  prepared: MusicTemplatePreparedPlayback,
  platformLabel: string
): Track {
  return {
    id: `${item.resourceId}:${item.sourceLocator}`,
    title: item.title,
    artist: item.artistNames || platformLabel,
    album: item.albumName,
    duration: item.durationSeconds ?? prepared.durationSeconds,
    filePath: prepared.cachePath,
    path: prepared.cachePath,
    originalPath: item.sourceLocator,
    coverUrl: item.coverUrl,
    genre: platformLabel,
    comment: item.sourceLocator,
    mimeType: prepared.mimeType,
  };
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

export interface UseMusicTemplateWorkspaceAdapterControllerParams {
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
  const musicTemplateWorkspaceActive =
    Boolean(activeMusicConnectorId) && activeWorkspaceConnectorId === activeMusicConnectorId;
  const authorized = activeMusicAuthState === 'authorized';

  const supportsCollections = activeMusicContractRecord?.contract.capabilities.playlists === true;
  const supportsDailyRecommendations =
    activeMusicContractRecord?.contract.capabilities.dailyRecommendations === true;
  const supportsSearch = activeMusicContractRecord?.contract.capabilities.search === true;
  const musicTemplateQualitySupported =
    activeMusicContractRecord?.contract.capabilities.quality === true;

  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [userPlaylists, setUserPlaylists] = useState<MusicTemplateCollectionItem[]>([]);
  const [recommendedCollections, setRecommendedCollections] = useState<MusicTemplateCollectionItem[]>([]);
  const [recommendedResourcePage, setRecommendedResourcePage] =
    useState<MusicTemplateResourcePage | null>(null);
  const [showCollectionBrowser, setShowCollectionBrowser] = useState(true);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [selectedCollectionKind, setSelectedCollectionKind] =
    useState<MusicTemplateCollectionSelectionKind>(null);
  const [selectedCollection, setSelectedCollection] = useState<MusicTemplateCollectionItem | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [resourceLoading, setResourceLoading] = useState(false);
  const [resourceLoadingMore, setResourceLoadingMore] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [resourceInfo, setResourceInfo] = useState<string | null>(null);
  const [resourcePage, setResourcePage] = useState<MusicTemplateResourcePage | null>(null);
  const [resourceSourceKey, setResourceSourceKey] = useState<string | null>(null);
  const [preparingResourceId, setPreparingResourceId] = useState<string | null>(null);
  const [playbackQualityState, setPlaybackQualityState] =
    useState<MusicTemplatePlaybackQualityState | null>(null);
  const [playbackQualityLoading, setPlaybackQualityLoading] = useState(false);
  const [playbackQualitySaving, setPlaybackQualitySaving] = useState(false);
  const [playbackQualityError, setPlaybackQualityError] = useState<string | null>(null);

  const preparedTrackMapRef = useRef<Map<string, Track>>(new Map());
  const resourceViewportRef = useRef<HTMLDivElement>(null);

  const qualityProbeSourceLocator = resourcePage?.items[0]?.sourceLocator?.trim() || null;

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
      if (!authorized || !musicRuntimeTarget) {
        setUserPlaylists([]);
        setRecommendedCollections([]);
        setRecommendedResourcePage(null);
        setCollectionError(null);
        return;
      }

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
      } finally {
        setCollectionLoading(false);
      }
    },
    [authorized, musicRuntimeTarget, supportsCollections, supportsDailyRecommendations, t]
  );

  const loadDailyResources = useCallback(
    async (forceRefresh = false) => {
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
    [authorized, musicRuntimeTarget, recommendedResourcePage, supportsDailyRecommendations, t]
  );

  const loadCollectionResources = useCallback(
    async (
      collectionId: string,
      kind: Extract<MusicTemplateCollectionSelectionKind, 'recommended-playlist' | 'user-playlist'>,
      providedCollection: MusicTemplateCollectionItem | null = null,
      forceRefresh = false
    ) => {
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
    [authorized, musicRuntimeTarget, resolveCollectionItemById, t]
  );

  const runSearch = useCallback(
    async (keyword: string, pageNum = 1, append = false, forceRefresh = false) => {
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
        setResourcePage((prev) => (append && page ? mergeSongPages(prev, page) : page));
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
    [authorized, loadCollectionBrowserData, musicRuntimeTarget, resourceLoadingMore, supportsSearch, t]
  );

  const refreshPlaybackQualityState = useCallback(
    async (forceRefresh = false) => {
      if (!authorized || !musicRuntimeTarget || !musicTemplateQualitySupported) {
        setPlaybackQualityState(null);
        setPlaybackQualityError(null);
        return;
      }

      setPlaybackQualityLoading(true);
      setPlaybackQualityError(null);
      try {
        const nextState = await getMusicTemplatePlaybackQualityState(musicRuntimeTarget, {
          sourceLocator: qualityProbeSourceLocator,
          forceRefresh,
        });
        setPlaybackQualityState(nextState);
      } catch (error) {
        setPlaybackQualityError(
          toErrorMessage(error, t('magnet.platform.music-template.quality.errorLoad'))
        );
      } finally {
        setPlaybackQualityLoading(false);
      }
    },
    [authorized, musicRuntimeTarget, musicTemplateQualitySupported, qualityProbeSourceLocator, t]
  );

  const setPlaybackQualityPreference = useCallback(
    async (qualityKey: string) => {
      if (!authorized || !musicRuntimeTarget || !musicTemplateQualitySupported) return;

      setPlaybackQualitySaving(true);
      setPlaybackQualityError(null);
      try {
        const nextState = await setMusicTemplatePlaybackQualityPreference(
          musicRuntimeTarget,
          normalizeMusicTemplateQualityKey(qualityKey),
          {
            sourceLocator: qualityProbeSourceLocator,
          }
        );
        setPlaybackQualityState((prev) => nextState ?? prev);
      } catch (error) {
        setPlaybackQualityError(
          toErrorMessage(error, t('magnet.platform.music-template.quality.errorSave'))
        );
      } finally {
        setPlaybackQualitySaving(false);
      }
    },
    [authorized, musicRuntimeTarget, musicTemplateQualitySupported, qualityProbeSourceLocator, t]
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
    setPreparingResourceId(null);
    setPlaybackQualityState(null);
    setPlaybackQualityLoading(false);
    setPlaybackQualitySaving(false);
    setPlaybackQualityError(null);
    preparedTrackMapRef.current.clear();
  }, [activeMusicConnectorId, activeMusicInstanceId]);

  useEffect(() => {
    if (!musicTemplateWorkspaceActive || !authorized) {
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
        setResourcePage(null);
        setResourceSourceKey(null);
        setResourceLoadingMore(false);
        setPlaybackQualityState(null);
        setPlaybackQualityError(null);
        preparedTrackMapRef.current.clear();
      }
      return;
    }

    void loadCollectionBrowserData();
  }, [authorized, loadCollectionBrowserData, musicTemplateWorkspaceActive]);

  useEffect(() => {
    if (!musicTemplateWorkspaceActive || !authorized || !musicTemplateQualitySupported) {
      if (!musicTemplateQualitySupported) {
        setPlaybackQualityState(null);
        setPlaybackQualityError(null);
      }
      return;
    }

    void refreshPlaybackQualityState();
  }, [
    authorized,
    musicTemplateQualitySupported,
    musicTemplateWorkspaceActive,
    qualityProbeSourceLocator,
    refreshPlaybackQualityState,
  ]);

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

  const ensurePreparedTrack = useCallback(
    async (item: MusicTemplateResourceItem): Promise<Track> => {
      const cacheKey = item.resourceId.trim() || item.sourceLocator.trim();
      const cached = preparedTrackMapRef.current.get(cacheKey);
      if (cached) return cached;

      setPreparingResourceId(item.resourceId);
      try {
        if (!musicRuntimeTarget) {
          throw new Error(t('magnet.platform.music-template.player.error.prepareFailed'));
        }

        const prepared = await prepareMusicTemplatePlayback(musicRuntimeTarget, item, {
          qualityHint: playbackQualityState?.currentKey,
        });
        if (!prepared) {
          throw new Error(t('magnet.platform.music-template.player.error.prepareFailed'));
        }

        const track = buildTrackFromPreparedPlayback(item, prepared, musicRuntimeTarget.displayName);
        setPreparedTrackWithBoundedLru(preparedTrackMapRef.current, cacheKey, track);
        return track;
      } finally {
        setPreparingResourceId((prev) => (prev === item.resourceId ? null : prev));
      }
    },
    [musicRuntimeTarget, playbackQualityState?.currentKey, t]
  );

  const handlePlaySong = useCallback(
    async (item: MusicTemplateResourceItem) => {
      try {
        const track = await ensurePreparedTrack(item);
        const queueLengthBefore = audioService.getQueue().length;
        audioService.addMultipleToQueue([track]);
        await audioService.playTrackAtIndex(Math.max(0, queueLengthBefore));
        setResourceError(null);
      } catch (error) {
        setResourceInfo(null);
        setResourceError(toErrorMessage(error, t('magnet.platform.music-template.player.error.playFailed')));
      }
    },
    [audioService, ensurePreparedTrack, t]
  );

  const handleQueueSong = useCallback(
    async (item: MusicTemplateResourceItem) => {
      try {
        const track = await ensurePreparedTrack(item);
        audioService.addToQueue(track);
        setResourceError(null);
      } catch (error) {
        setResourceInfo(null);
        setResourceError(toErrorMessage(error, t('magnet.platform.music-template.player.error.queueFailed')));
      }
    },
    [audioService, ensurePreparedTrack, t]
  );

  const handleAddSongToPlaylist = useCallback(
    async (item: MusicTemplateResourceItem) => {
      if (!selectedPlaylistId) {
        setPlaylistError(t('magnet.platform.music-template.playlist.addHintNoSelection'));
        return;
      }

      try {
        const track = await ensurePreparedTrack(item);
        audioService.addTrackToPlaylist(selectedPlaylistId, track);
        setPlaylistError(null);
      } catch (error) {
        setPlaylistError(
          toErrorMessage(error, t('magnet.platform.music-template.playlist.errorAddTrackFailed'))
        );
      }
    },
    [audioService, ensurePreparedTrack, selectedPlaylistId, setPlaylistError, t]
  );

  const handleOpenSong = useCallback(
    (item: MusicTemplateResourceItem) => {
      const webUrl = item.webUrl?.trim();
      if (!webUrl) {
        setResourceError(t('magnet.platform.music-template.resource.noLink'));
        return;
      }
      window.open(webUrl, '_blank', 'noopener,noreferrer');
    },
    [t]
  );

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

  const collectionBrowserSections = useMemo<MusicTemplateCollectionBrowserSection[]>(() => {
    if (!authorized) return [];

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
  ]);

  const musicTemplateDrawerPlaylists = useMemo<AudioPlaylist[]>(
    () =>
      userPlaylists.map((collection) => ({
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
    [activeMusicConnectorId, userPlaylists]
  );

  const selectedDrawerPlaylist = useMemo(
    () =>
      musicTemplateDrawerPlaylists.find((playlist) => playlist.id === selectedPlaylistId) ?? null,
    [musicTemplateDrawerPlaylists, selectedPlaylistId]
  );

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
    [authorized, resourceLoading, resourceLoadingMore, runSearch, searchQuery, supportsSearch, t]
  );

  const musicTemplateToolbarProps: MusicTemplateWorkspaceToolbarProps = {};

  const musicTemplateSettingsProps: MusicTemplatePlaybackSettingsContentProps = {
    t,
    authorized,
    qualitySupported: musicTemplateQualitySupported,
    qualityLoading: playbackQualityLoading,
    qualitySaving: playbackQualitySaving,
    qualityError: playbackQualityError,
    qualityState: playbackQualityState,
    qualityLabelForKey: (qualityKey) =>
      t(toMusicTemplateQualityLabelKey(normalizeMusicTemplateQualityKey(qualityKey))),
    onQualityHintChange: (qualityKey) => {
      void setPlaybackQualityPreference(qualityKey);
    },
    onRefreshQualityState: () => {
      void refreshPlaybackQualityState(true);
    },
  };

  const musicTemplateWorkspaceProps: MusicTemplateWorkspaceProps = {
    authorized,
    platformLabel: musicRuntimeTarget?.displayName ?? t('magnet.platform.title'),
    platformAccentColor: '#8aa6ff',
    platformFallbackLabel: 'M',
    platformIconAssetUrl: null,
    collectionLoading,
    collectionError,
    collectionBrowserSections,
    selectedCollectionId: selectedCollectionKind === 'search' ? null : selectedCollectionId,
    selectedCollection,
    showCollectionBrowser,
    resourceLoading,
    resourceLoadingMore,
    resourceError,
    resourceInfo,
    resourcePage,
    resourceViewportRef,
    preparingResourceId,
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
    onSelectCollection: (item) => {
      if (item.kind === 'daily') {
        void loadDailyResources();
        return;
      }
      if (!item.collectionId) return;
      const resolvedCollection = resolveCollectionItemById(item.collectionId, item.kind);
      void loadCollectionResources(item.collectionId, item.kind, resolvedCollection);
    },
    onLoadMoreResources: () => {
      if (!resourcePage?.hasMore || resourcePage.sourceKind !== 'search') return;
      void runSearch(resourcePage.sourceId, resourcePage.pageNum + 1, true);
    },
    onPlaySong: (item) => {
      void handlePlaySong(item);
    },
    onQueueSong: (item) => {
      void handleQueueSong(item);
    },
    onAddSongToPlaylist: (item) => {
      void handleAddSongToPlaylist(item);
    },
    onOpenSong: handleOpenSong,
  };

  return {
    musicTemplateWorkspaceActive,
    musicTemplateUseDarkMode: musicTemplateWorkspaceActive && prefersDarkMode,
    musicTemplateQualitySupported,
    musicTemplateSettingsSupported: musicTemplateQualitySupported,
    musicTemplateCanGoBack: !showCollectionBrowser,
    musicTemplateHandleBackAction: handleBackToCollections,
    musicTemplateOpenDrawerPlaylist: handleOpenDrawerPlaylist,
    musicTemplateDrawerPlaylists,
    musicTemplateShellSearch,
    musicTemplateToolbarProps,
    musicTemplateWorkspaceProps,
    musicTemplateSettingsProps,
  };
}
