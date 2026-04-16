import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { IAudioService, Playlist, Track } from '../../../services/audio';
import {
  listNeteasePlaylistTracks,
  listNeteaseRecommendedPlaylists,
  listNeteaseRecommendedSongs,
  listNeteaseUserPlaylists,
  prepareNeteaseCachedPlayback,
  searchNeteaseSongs,
  type NeteasePreparedPlayback,
  type NeteaseSongItem,
  type NeteaseSongPage,
  type NeteaseUserPlaylistItem,
  type PlatformConnectorFacadeItem,
} from '../../../modules/music-platform';
import type { NeteaseWorkspaceProps } from './NeteaseWorkspace';
import type { NeteaseWorkspaceToolbarProps } from './NeteaseWorkspaceAdapter';

type Translator = (key: string, params?: Record<string, string | number>) => string;

const NETEASE_CONNECTOR_ID = 'connector.platform.netease' as const;
const NETEASE_SEARCH_PAGE_SIZE = 40;
const PREPARED_TRACK_CACHE_LIMIT = 96;

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

function mergeSongPages(previous: NeteaseSongPage | null, next: NeteaseSongPage): NeteaseSongPage {
  if (!previous || previous.sourceKind !== next.sourceKind || previous.sourceId !== next.sourceId) {
    return next;
  }

  const seen = new Set(previous.items.map((item) => item.songId));
  const items = previous.items.slice();
  for (const item of next.items) {
    if (seen.has(item.songId)) continue;
    seen.add(item.songId);
    items.push(item);
  }

  return {
    ...next,
    items,
  };
}

function buildTrackFromPreparedPlayback(
  item: NeteaseSongItem,
  prepared: NeteasePreparedPlayback
): Track {
  return {
    id: `netease:song:${item.songId}`,
    title: item.title,
    artist: item.artistNames || 'Netease Cloud Music',
    album: item.albumName,
    duration: item.durationSeconds ?? prepared.durationSeconds,
    filePath: prepared.cachePath,
    path: prepared.cachePath,
    originalPath: item.sourceLocator,
    coverUrl: item.coverUrl,
    genre: 'Netease',
    comment: item.sourceLocator,
    mimeType: prepared.mimeType,
  };
}

export interface UseNeteaseWorkspaceAdapterControllerParams {
  activeWorkspaceConnectorId: string | null;
  prefersDarkMode: boolean;
  items: PlatformConnectorFacadeItem[];
  audioService: IAudioService;
  t: Translator;
  platformPlaylists: Playlist[];
  selectedPlaylist: Playlist | null;
  selectedPlaylistId: string | null;
  newPlaylistName: string;
  playlistError: string | null;
  onCreatePlaylist: () => void;
  setSelectedPlaylistId: (playlistId: string | null) => void;
  setNewPlaylistName: (value: string) => void;
  setPlaylistError: (value: string | null) => void;
}

export interface NeteaseWorkspaceAdapterControllerResult {
  neteaseWorkspaceActive: boolean;
  neteaseUseDarkMode: boolean;
  neteaseShellSearch: {
    value: string;
    placeholder: string;
    disabled: boolean;
    loading: boolean;
    onChange: (value: string) => void;
    onSubmit: () => void;
  };
  openNeteasePlaylistDrawer: () => void;
  neteaseToolbarProps: NeteaseWorkspaceToolbarProps;
  neteaseWorkspaceProps: NeteaseWorkspaceProps;
}

export function useNeteaseWorkspaceAdapterController(
  params: UseNeteaseWorkspaceAdapterControllerParams
): NeteaseWorkspaceAdapterControllerResult {
  const {
    activeWorkspaceConnectorId,
    prefersDarkMode,
    items,
    audioService,
    t,
    platformPlaylists,
    selectedPlaylist,
    selectedPlaylistId,
    newPlaylistName,
    playlistError,
    onCreatePlaylist,
    setSelectedPlaylistId,
    setNewPlaylistName,
    setPlaylistError,
  } = params;

  const neteaseWorkspaceActive = activeWorkspaceConnectorId === NETEASE_CONNECTOR_ID;
  const neteaseConnector = useMemo(
    () => items.find((item) => item.connectorId === NETEASE_CONNECTOR_ID) ?? null,
    [items]
  );
  const neteaseAuthorized = neteaseConnector?.authState === 'authorized';

  const [collectionDrawerOpen, setCollectionDrawerOpen] = useState(false);
  const [playlistDrawerOpen, setPlaylistDrawerOpen] = useState(false);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [userPlaylists, setUserPlaylists] = useState<NeteaseUserPlaylistItem[]>([]);
  const [recommendedPlaylists, setRecommendedPlaylists] = useState<
    Awaited<ReturnType<typeof listNeteaseRecommendedPlaylists>>
  >([]);
  const [selectedUserPlaylistId, setSelectedUserPlaylistId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [resourceLoading, setResourceLoading] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [resourceInfo, setResourceInfo] = useState<string | null>(null);
  const [resourcePage, setResourcePage] = useState<NeteaseSongPage | null>(null);
  const [resourceSourceKey, setResourceSourceKey] = useState<string | null>(null);
  const [preparingSongId, setPreparingSongId] = useState<string | null>(null);

  const preparedTrackMapRef = useRef<Map<string, Track>>(new Map());
  const resourceViewportRef = useRef<HTMLDivElement>(null);

  const selectedUserPlaylist = useMemo(
    () => userPlaylists.find((item) => item.playlistId === selectedUserPlaylistId) ?? null,
    [selectedUserPlaylistId, userPlaylists]
  );

  const loadCollections = useCallback(async (forceRefresh = false) => {
    if (!neteaseAuthorized) {
      setUserPlaylists([]);
      setRecommendedPlaylists([]);
      return;
    }

    setCollectionLoading(true);
    setCollectionError(null);
    try {
      const [nextUserPlaylists, nextRecommendedPlaylists] = await Promise.all([
        listNeteaseUserPlaylists({ forceRefresh }),
        listNeteaseRecommendedPlaylists({ forceRefresh }),
      ]);
      setUserPlaylists(nextUserPlaylists);
      setRecommendedPlaylists(nextRecommendedPlaylists);
    } catch (error) {
      setCollectionError(toErrorMessage(error, t('magnet.platform.netease.collection.error')));
    } finally {
      setCollectionLoading(false);
    }
  }, [neteaseAuthorized, t]);

  const loadRecommendedResources = useCallback(async (forceRefresh = false) => {
    if (!neteaseAuthorized) {
      setResourcePage(null);
      setResourceSourceKey(null);
      return;
    }

    setResourceSourceKey('recommended');
    setResourceLoading(true);
    setResourceError(null);
    setResourceInfo(null);

    try {
      const page = await listNeteaseRecommendedSongs({ forceRefresh });
      setSelectedUserPlaylistId(null);
      setResourcePage(page);
    } catch (error) {
      setResourceError(toErrorMessage(error, t('magnet.platform.netease.resource.errorRecommended')));
    } finally {
      setResourceLoading(false);
    }
  }, [neteaseAuthorized, t]);

  const loadUserPlaylistResources = useCallback(
    async (playlistId: string, forceRefresh = false) => {
      const normalizedPlaylistId = playlistId.trim();
      if (!normalizedPlaylistId) {
        await loadRecommendedResources(forceRefresh);
        return;
      }
      if (!neteaseAuthorized) {
        setResourcePage(null);
        setResourceSourceKey(null);
        return;
      }

      setResourceSourceKey(`user-playlist:${normalizedPlaylistId}`);
      setResourceLoading(true);
      setResourceError(null);
      setResourceInfo(null);

      try {
        const page = await listNeteasePlaylistTracks(normalizedPlaylistId, { forceRefresh });
        setSelectedUserPlaylistId(normalizedPlaylistId);
        setResourcePage(page);
      } catch (error) {
        setResourceError(toErrorMessage(error, t('magnet.platform.netease.resource.errorPlaylist')));
      } finally {
        setResourceLoading(false);
      }
    },
    [loadRecommendedResources, neteaseAuthorized, t]
  );

  const runSearch = useCallback(
    async (keyword: string, pageNum = 1, append = false, forceRefresh = false) => {
      const normalizedKeyword = keyword.trim();
      if (!normalizedKeyword) {
        await loadRecommendedResources(forceRefresh);
        return;
      }
      if (!neteaseAuthorized) {
        setResourcePage(null);
        setResourceSourceKey(null);
        return;
      }

      setResourceSourceKey(`search:${normalizedKeyword.toLowerCase()}`);
      setResourceLoading(true);
      setResourceError(null);
      setResourceInfo(null);

      try {
        const page = await searchNeteaseSongs({
          keyword: normalizedKeyword,
          pageNum,
          pageSize: NETEASE_SEARCH_PAGE_SIZE,
          forceRefresh,
        });
        setSelectedUserPlaylistId(null);
        setResourcePage((prev) => (append && page ? mergeSongPages(prev, page) : page));
      } catch (error) {
        setResourceError(toErrorMessage(error, t('magnet.platform.netease.resource.errorSearch')));
      } finally {
        setResourceLoading(false);
      }
    },
    [loadRecommendedResources, neteaseAuthorized, t]
  );

  const refreshResources = useCallback(async (forceRefresh = false) => {
    const normalizedQuery = searchQuery.trim();
    if (normalizedQuery) {
      await runSearch(normalizedQuery, 1, false, forceRefresh);
      return;
    }

    if (selectedUserPlaylistId) {
      await loadUserPlaylistResources(selectedUserPlaylistId, forceRefresh);
      return;
    }

    await loadRecommendedResources(forceRefresh);
  }, [loadRecommendedResources, loadUserPlaylistResources, runSearch, searchQuery, selectedUserPlaylistId]);

  useEffect(() => {
    if (!neteaseWorkspaceActive || !neteaseAuthorized) {
      setCollectionDrawerOpen(false);
      setPlaylistDrawerOpen(false);
      if (!neteaseAuthorized) {
        setCollectionError(null);
        setResourceError(null);
        setResourceInfo(null);
        setUserPlaylists([]);
        setRecommendedPlaylists([]);
        setSelectedUserPlaylistId(null);
        setResourcePage(null);
        setResourceSourceKey(null);
        preparedTrackMapRef.current.clear();
      }
      return;
    }

    void loadCollections();
    if (!resourcePage) {
      void loadRecommendedResources();
    }
  }, [
    loadCollections,
    loadRecommendedResources,
    neteaseAuthorized,
    neteaseWorkspaceActive,
    resourcePage,
  ]);

  useEffect(() => {
    if (!selectedUserPlaylistId) return;
    if (userPlaylists.some((item) => item.playlistId === selectedUserPlaylistId)) return;
    setSelectedUserPlaylistId(null);
  }, [selectedUserPlaylistId, userPlaylists]);

  useLayoutEffect(() => {
    if (!resourceSourceKey) return;
    const viewportElement = resourceViewportRef.current;
    if (!viewportElement) return;
    viewportElement.scrollTop = 0;
    viewportElement.scrollLeft = 0;
  }, [resourceSourceKey]);

  const ensurePreparedTrack = useCallback(
    async (item: NeteaseSongItem): Promise<Track> => {
      const cacheKey = item.songId.trim() || item.sourceLocator.trim();
      const cached = preparedTrackMapRef.current.get(cacheKey);
      if (cached) return cached;

      setPreparingSongId(item.songId);
      try {
        const prepared = await prepareNeteaseCachedPlayback(item.sourceLocator);
        if (!prepared) {
          throw new Error(t('magnet.platform.netease.player.error.prepareFailed'));
        }

        const track = buildTrackFromPreparedPlayback(item, prepared);
        setPreparedTrackWithBoundedLru(preparedTrackMapRef.current, cacheKey, track);
        return track;
      } finally {
        setPreparingSongId((prev) => (prev === item.songId ? null : prev));
      }
    },
    [t]
  );

  const handlePlaySong = useCallback(
    async (item: NeteaseSongItem) => {
      try {
        const track = await ensurePreparedTrack(item);
        const queueLengthBefore = audioService.getQueue().length;
        audioService.addMultipleToQueue([track]);
        await audioService.playTrackAtIndex(Math.max(0, queueLengthBefore));
        setResourceError(null);
      } catch (error) {
        setResourceInfo(null);
        setResourceError(toErrorMessage(error, t('magnet.platform.netease.player.error.playFailed')));
      }
    },
    [audioService, ensurePreparedTrack, t]
  );

  const handleQueueSong = useCallback(
    async (item: NeteaseSongItem) => {
      try {
        const track = await ensurePreparedTrack(item);
        audioService.addToQueue(track);
        setResourceError(null);
      } catch (error) {
        setResourceInfo(null);
        setResourceError(toErrorMessage(error, t('magnet.platform.netease.player.error.queueFailed')));
      }
    },
    [audioService, ensurePreparedTrack, t]
  );

  const handleAddSongToPlaylist = useCallback(
    async (item: NeteaseSongItem) => {
      if (!selectedPlaylistId) {
        setPlaylistError(t('magnet.platform.netease.playlist.addHintNoSelection'));
        return;
      }

      try {
        const track = await ensurePreparedTrack(item);
        audioService.addTrackToPlaylist(selectedPlaylistId, track);
        setPlaylistError(null);
      } catch (error) {
        setPlaylistError(toErrorMessage(error, t('magnet.platform.netease.playlist.errorAddTrackFailed')));
      }
    },
    [audioService, ensurePreparedTrack, selectedPlaylistId, setPlaylistError, t]
  );

  const handleOpenSong = useCallback(
    (item: NeteaseSongItem) => {
      const webUrl = item.webUrl?.trim();
      if (!webUrl) {
        setResourceError(t('magnet.platform.netease.resource.noLink'));
        return;
      }
      window.open(webUrl, '_blank', 'noopener,noreferrer');
    },
    [t]
  );

  const openNeteasePlaylistDrawer = useCallback(() => {
    if (!neteaseAuthorized) return;
    setPlaylistDrawerOpen(true);
    setCollectionDrawerOpen(false);
  }, [neteaseAuthorized]);

  const neteaseShellSearch = useMemo(
    () => ({
      value: searchQuery,
      placeholder: t('magnet.platform.netease.resource.searchPlaceholder'),
      disabled: !neteaseAuthorized,
      loading: resourceLoading,
      onChange: setSearchQuery,
      onSubmit: () => {
        void refreshResources();
      },
    }),
    [neteaseAuthorized, refreshResources, resourceLoading, searchQuery, t]
  );

  const neteaseToolbarProps: NeteaseWorkspaceToolbarProps = {
    neteaseAuthorized,
    collectionLoading,
    resourceLoading,
    t,
    onShowRecommended: () => {
      setSearchQuery('');
      void loadRecommendedResources();
    },
    onRefreshCollections: () => {
      void loadCollections(true);
    },
    onRefreshResources: () => {
      void refreshResources(true);
    },
  };

  const neteaseWorkspaceProps: NeteaseWorkspaceProps = {
    neteaseAuthorized,
    collectionDrawerOpen,
    playlistDrawerOpen,
    collectionLoading,
    collectionError,
    userPlaylists,
    recommendedPlaylists,
    selectedUserPlaylistId,
    selectedUserPlaylist,
    searchQuery,
    resourceLoading,
    resourceError,
    resourceInfo,
    resourcePage,
    resourceViewportRef,
    preparingSongId,
    selectedPlatformPlaylist: selectedPlaylist,
    selectedPlatformPlaylistId: selectedPlaylistId,
    platformPlaylists,
    newPlatformPlaylistName: newPlaylistName,
    playlistError,
    t,
    formatDuration,
    onRefreshCollections: () => {
      void loadCollections(true);
    },
    onShowRecommended: () => {
      setSearchQuery('');
      void loadRecommendedResources();
      setCollectionDrawerOpen(false);
    },
    onSelectUserPlaylist: (playlistId) => {
      setSearchQuery('');
      void loadUserPlaylistResources(playlistId);
      setCollectionDrawerOpen(false);
    },
    onSearchQueryChange: setSearchQuery,
    onSearchSubmit: () => {
      void refreshResources();
    },
    onRefreshResources: () => {
      void refreshResources(true);
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
    onCloseDrawers: () => {
      setCollectionDrawerOpen(false);
      setPlaylistDrawerOpen(false);
    },
    onToggleCollectionDrawer: () => {
      setCollectionDrawerOpen((prev) => {
        const next = !prev;
        if (next) setPlaylistDrawerOpen(false);
        return next;
      });
    },
    onTogglePlaylistDrawer: () => {
      setPlaylistDrawerOpen((prev) => {
        const next = !prev;
        if (next) setCollectionDrawerOpen(false);
        return next;
      });
    },
    onNewPlatformPlaylistNameChange: setNewPlaylistName,
    onCreatePlaylist,
    onSelectPlatformPlaylist: setSelectedPlaylistId,
    onPlaySelectedPlaylist: () => {
      if (!selectedPlaylistId) return;
      void audioService.playPlaylist(selectedPlaylistId);
    },
    onDeleteSelectedPlaylist: () => {
      if (!selectedPlaylistId) return;
      audioService.deletePlaylist(selectedPlaylistId);
    },
    onRemoveTrackFromSelectedPlaylist: (trackIndex) => {
      if (!selectedPlaylistId) return;
      audioService.removeTrackFromPlaylist(selectedPlaylistId, trackIndex);
    },
  };

  return {
    neteaseWorkspaceActive,
    neteaseUseDarkMode: neteaseWorkspaceActive && prefersDarkMode,
    neteaseShellSearch,
    openNeteasePlaylistDrawer,
    neteaseToolbarProps,
    neteaseWorkspaceProps,
  };
}
