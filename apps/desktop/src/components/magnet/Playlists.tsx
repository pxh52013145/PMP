import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Playlist, Track } from '../../services/audio';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { useT } from '../../i18n';
import type { CoverSizeHint } from '../../services/audio/MusicLibraryService';
import {
  partitionPlaylistCoverUrlsForRelease,
  pruneResolvedPlaylistCoverMap,
  resolvePlaylistTrackIndexes,
  type PlaylistTrackSortDirection,
  type PlaylistTrackSortField,
} from '../../modules/playlists/runtimeProjection';
import { getProcessPerfTotalsSnapshot } from '../../modules/debug/processPerf';
import { getGlobalProcessPerfService } from '../../services/performance-control';
import {
  recordPlaylistsOverlayResidencySample,
  type PlaylistCoverUrlKind,
} from '../../modules/playlists/residencyTelemetry';
import { musicLibraryService } from '../../services/audio/MusicLibraryService';
import { resolveBilibiliCoverAssetUrl, searchBilibiliResourceByBvid } from '../../modules/music-platform';
import { scheduleProcessWorkingSetTrim } from '../../utils/processWorkingSetTrim';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { captureTelemetryScenarioSnapshot } from '../../services/telemetry/scenarioSnapshots';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { InputDialog } from './InputDialog';
import { buildPlaylistTrackContextMenu } from './trackContextMenu';
import './Playlists.css';

interface PlaylistsProps {
  isOpen: boolean;
  onClose: () => void;
}

type PlaylistCoverImageProps = {
  src?: string;
  alt: string;
  className: string;
  fallbackClassName: string;
  fetchPriority?: 'high' | 'low' | 'auto';
  onDecoded: (coverUrl: string, naturalWidth: number, naturalHeight: number) => void;
  onError?: (coverUrl: string) => void;
};

type PopupMenuState = {
  x: number;
  y: number;
  items: ContextMenuItem[];
};

type SelectedPlaylistHeroCoverState = {
  playlistId: string | null;
  url: string;
};

type PlaylistTrackWindowItem = {
  playlistIndex: number;
  track: Track;
};

const makeTrackKey = (track: Track, index: number): string => `${track.id}::${index}`;

const BILIBILI_BVID_PATTERN = /BV[0-9A-Za-z]{10}/i;
const PLAYLIST_LIST_VIRTUAL_ROW_HEIGHT = 72;
const PLAYLIST_LIST_VIRTUAL_OVERSCAN_ROWS = 8;
const PLAYLIST_COVER_RESOLVE_BATCH_SIZE = 8;
const PLAYLIST_TRACK_PAGE_SIZE = 120;
const PLAYLIST_TRACK_WINDOW_OVERSCAN_ROWS = 10;
const PLAYLIST_TRACK_ROW_HEIGHT = 76;
const EMPTY_PLAYLISTS: Playlist[] = [];
const EMPTY_TRACKS: Track[] = [];
const EMPTY_NUMBERS: number[] = [];
const RECENT_SMART_PLAYLIST_ID = 'smart-recently-played';
const PLAYLIST_FALLBACK_GLYPH = '\u266B';
const PLAYLIST_CLOSE_GLYPH = '\u00D7';
const PLAYLIST_PLAY_GLYPH = '\u25B6';
const EMPTY_SELECTED_PLAYLIST_HERO_COVER: SelectedPlaylistHeroCoverState = {
  playlistId: null,
  url: '',
};

const isBilibiliConnectorId = (value: string | null | undefined): boolean => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized) return false;
  return normalized.includes('bilibili');
};

const isLikelyAbsolutePath = (value: string | null | undefined): boolean => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return false;
  if (normalized.startsWith('/') || normalized.startsWith('\\\\')) return true;
  return /^[A-Za-z]:[\\/]/.test(normalized);
};

const extractBvidFromText = (value: string | null | undefined): string | null => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;
  const matched = normalized.match(BILIBILI_BVID_PATTERN);
  if (!matched || !matched[0]) return null;
  return matched[0].toUpperCase();
};

const toNonEmptyString = (value: string | null | undefined): string =>
  typeof value === 'string' ? value.trim() : '';

function measureJsonBytes(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') return 0;
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(json).length;
    }
    return json.length * 2;
  } catch {
    return 0;
  }
}

function readTelemetryErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function classifyPlaylistCoverUrl(url: string): PlaylistCoverUrlKind {
  const normalized = toNonEmptyString(url).toLowerCase();
  if (!normalized) return 'none';
  if (normalized.startsWith('blob:')) return 'blob';
  if (normalized.startsWith('pmp://')) return 'pmp';
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) return 'http';
  return 'other';
}

function isAssetLocalhostHttpUrl(url: string): boolean {
  const normalized = toNonEmptyString(url);
  if (!normalized) return false;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    return parsed.hostname.toLowerCase() === 'asset.localhost';
  } catch {
    return false;
  }
}

function isStableExplicitPlaylistCoverUrl(url: string): boolean {
  const normalized = toNonEmptyString(url);
  if (!normalized) return false;

  const lower = normalized.toLowerCase();
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) {
    return false;
  }

  return !isAssetLocalhostHttpUrl(normalized);
}

function canRenderPmpCoverUrlDirectly(): boolean {
  if (typeof window === 'undefined') return true;
  const protocol = String(window.location?.protocol || '').toLowerCase();
  return protocol !== 'http:' && protocol !== 'https:';
}

function isManagedPmpPlaylistCoverUrl(url: string): boolean {
  const normalized = toNonEmptyString(url).toLowerCase();
  return (
    normalized.startsWith('pmp://cover/') || normalized.startsWith('pmp://localhost/cover/')
  );
}

function isRenderablePlaylistCoverUrl(url: string): boolean {
  const normalized = toNonEmptyString(url);
  if (!normalized) return false;
  if (isLikelyAbsolutePath(normalized)) return false;
  if (isManagedPmpPlaylistCoverUrl(normalized)) {
    return canRenderPmpCoverUrlDirectly();
  }
  return true;
}

function sanitizeRenderablePlaylistCoverUrl(url: string | null | undefined): string {
  const normalized = toNonEmptyString(url);
  return isRenderablePlaylistCoverUrl(normalized) ? normalized : '';
}

function isFixedRecentSmartPlaylist(playlist: Playlist | null | undefined): boolean {
  if (!playlist) return false;
  return playlist.kind === 'smart' && toNonEmptyString(playlist.id) === RECENT_SMART_PLAYLIST_ID;
}

const PlaylistCoverImage: React.FC<PlaylistCoverImageProps> = ({
  src,
  alt,
  className,
  fallbackClassName,
  fetchPriority,
  onDecoded,
  onError,
}) => {
  const normalizedSrc = toNonEmptyString(src);
  const [loadFailed, setLoadFailed] = useState(false);
  const fetchPriorityProps = fetchPriority
    ? ({ fetchpriority: fetchPriority } as Record<string, string>)
    : {};

  useEffect(() => {
    setLoadFailed(false);
  }, [normalizedSrc]);

  if (!normalizedSrc || loadFailed) {
    return <span className={fallbackClassName}>{PLAYLIST_FALLBACK_GLYPH}</span>;
  }

  return (
    <img
      className={className}
      src={normalizedSrc}
      alt={alt}
      loading="lazy"
      decoding="async"
      {...fetchPriorityProps}
      onLoad={(event) => {
        const target = event.currentTarget;
        onDecoded(normalizedSrc, target.naturalWidth, target.naturalHeight);
      }}
      onError={() => {
        setLoadFailed(true);
        onError?.(normalizedSrc);
      }}
    />
  );
};

const EMPTY_PLAYLIST_TRACK_PAGE: Array<{ playlistIndex: number; track: Track }> = [];

function normalizePlaylistTrackSearchQuery(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function buildPlaylistTrackPageQueryKey(options: {
  playlistId: string;
  playlistUpdatedAt?: number;
  playlistTrackCount?: number;
  searchQuery: string;
  sortField: PlaylistTrackSortField;
  sortDirection: PlaylistTrackSortDirection;
}): string {
  const normalizedPlaylistId = String(options.playlistId || '').trim();
  const updatedAt =
    typeof options.playlistUpdatedAt === 'number' && Number.isFinite(options.playlistUpdatedAt)
      ? Math.max(0, Math.floor(options.playlistUpdatedAt))
      : 0;
  const trackCount =
    typeof options.playlistTrackCount === 'number' && Number.isFinite(options.playlistTrackCount)
      ? Math.max(0, Math.floor(options.playlistTrackCount))
      : 0;
  const searchQuery = normalizePlaylistTrackSearchQuery(options.searchQuery);
  return `${normalizedPlaylistId}::${updatedAt}::${trackCount}::${options.sortField}::${options.sortDirection}::${searchQuery}`;
}

export const Playlists: React.FC<PlaylistsProps> = ({ isOpen, onClose }) => {
  const t = useT();
  const audioService = useAudioService();
  const telemetry = useMemo(() => getTelemetryLogger('playlists', 'Playlists'), []);

  const [playlists, setPlaylists] = useState<Playlist[]>(() =>
    isOpen ? audioService.getState().playlists : EMPTY_PLAYLISTS
  );
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const [playlistToDelete, setPlaylistToDelete] = useState<string | null>(null);
  const [playlistToRenameId, setPlaylistToRenameId] = useState<string | null>(null);
  const [playlistToClear, setPlaylistToClear] = useState<string | null>(null);

  const [playlistTrackSearchQuery, setPlaylistTrackSearchQuery] = useState('');
  const [playlistTrackSortField, setPlaylistTrackSortField] =
    useState<PlaylistTrackSortField>('default');
  const [playlistTrackSortDirection, setPlaylistTrackSortDirection] =
    useState<PlaylistTrackSortDirection>('asc');
  const [showPlaylistTrackSearch, setShowPlaylistTrackSearch] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [playlistBatchMode, setPlaylistBatchMode] = useState(false);
  const [isSelectedPlaylistLoading, setIsSelectedPlaylistLoading] = useState(false);
  const [selectedTrackIndexes, setSelectedTrackIndexes] = useState<number[]>([]);
  const [selectedPlaylistTrackPage, setSelectedPlaylistTrackPage] = useState<
    Array<{ playlistIndex: number; track: Track }>
  >([]);
  const [selectedPlaylistTrackPageOffset, setSelectedPlaylistTrackPageOffset] = useState(0);
  const [selectedPlaylistTrackPageTotal, setSelectedPlaylistTrackPageTotal] = useState(0);
  const selectedPlaylistTrackPageQueryKeyRef = useRef<string | null>(null);
  const [resolvedPlaylistCoverMap, setResolvedPlaylistCoverMap] = useState<Record<string, string>>({});
  const [selectedPlaylistHeroCover, setSelectedPlaylistHeroCover] =
    useState<SelectedPlaylistHeroCoverState>(EMPTY_SELECTED_PLAYLIST_HERO_COVER);
  const [playlistCoverDecodedStats, setPlaylistCoverDecodedStats] = useState({
    entryCount: 0,
    totalBytes: 0,
  });
  const resolvedPlaylistCoverMapRef = useRef<Record<string, string>>({});
  const pendingPlaylistCoverIdsRef = useRef<Set<string>>(new Set());
  const previousSelectedPlaylistIdRef = useRef<string | null>(null);
  const playlistOverlayHasBeenOpenRef = useRef(false);
  const playlistListRef = useRef<HTMLDivElement | null>(null);
  const activePlaylistCoverUrlsRef = useRef<Set<string>>(new Set());
  const playlistCoverDecodedBytesRef = useRef<Map<string, number>>(new Map());
  const playlistsResidencyMetricsRef = useRef({
    overlayOpen: false,
    selectedPlaylistId: null as string | null,
    selectedPlaylistTrackCount: 0,
    totalPlaylistCount: 0,
    hydratedPlaylistCount: 0,
    loadedPlaylistTrackCount: 0,
    visibleSidebarPlaylistCount: 0,
    filteredTrackCount: 0,
    selectedTrackCount: 0,
    resolvedCoverCount: 0,
    resolvedCoverBlobCount: 0,
    resolvedCoverUrlChars: 0,
    activeBlobCoverUrlCount: 0,
    decodedCoverEntryCount: 0,
    decodedCoverEstimateBytes: 0,
    selectedCoverUrlKind: 'none' as PlaylistCoverUrlKind,
    selectedCoverDecodedBytes: 0,
    pageApproxJsonBytes: 0,
  });
  const playlistsResidencyTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(new Map());
  const playlistTrackSearchControlRef = useRef<HTMLDivElement | null>(null);
  const playlistTrackSearchInputRef = useRef<HTMLInputElement | null>(null);
  const playlistTrackListRef = useRef<HTMLDivElement | null>(null);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const sortMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [playlistListScrollTop, setPlaylistListScrollTop] = useState(0);
  const [playlistListViewportHeight, setPlaylistListViewportHeight] = useState(0);
  const [playlistTrackListScrollTop, setPlaylistTrackListScrollTop] = useState(0);
  const [playlistTrackListViewportHeight, setPlaylistTrackListViewportHeight] = useState(0);

  const [trackContextMenu, setTrackContextMenu] = useState<PopupMenuState | null>(null);
  const [playlistActionsMenu, setPlaylistActionsMenu] = useState<PopupMenuState | null>(null);
  const selectedPlaylist = useMemo(
    () =>
      selectedPlaylistId
        ? playlists.find((item) => item.id === selectedPlaylistId) ?? null
        : null,
    [playlists, selectedPlaylistId]
  );

  useEffect(() => {
    if (!isOpen) {
      setPlaylists(EMPTY_PLAYLISTS);
      setSelectedPlaylistId(null);
      return;
    }

    setPlaylists(audioService.getState().playlists);
    const unsubscribe = audioService.onStateChange((state) => {
      setPlaylists((previous) => (previous === state.playlists ? previous : state.playlists));
    });
    return unsubscribe;
  }, [audioService, isOpen]);

  useEffect(() => {
    if (!selectedPlaylistId) return;
    if (playlists.some((item) => item.id === selectedPlaylistId)) return;
    setSelectedPlaylistId(null);
  }, [playlists, selectedPlaylistId]);

  useEffect(() => {
    telemetry.info(isOpen ? 'playlists.overlay.opened' : 'playlists.overlay.closed');
    captureTelemetryScenarioSnapshot({
      moduleId: 'playlists',
      component: 'Playlists',
      event: isOpen ? 'playlists.overlay.opened.snapshot' : 'playlists.overlay.closed.snapshot',
      fields: {
        isOpen,
      },
      minIntervalMs: 400,
    });
  }, [isOpen, telemetry]);

  useEffect(() => {
    resolvedPlaylistCoverMapRef.current = resolvedPlaylistCoverMap;
  }, [resolvedPlaylistCoverMap]);

  useEffect(() => {
    const previousSelectedPlaylistId = previousSelectedPlaylistIdRef.current;
    const nextSelectedPlaylistId = selectedPlaylistId;
    if (
      previousSelectedPlaylistId &&
      previousSelectedPlaylistId !== nextSelectedPlaylistId
    ) {
      audioService.releasePlaylistTracks?.(previousSelectedPlaylistId);
    }
    previousSelectedPlaylistIdRef.current = nextSelectedPlaylistId;
  }, [audioService, selectedPlaylistId]);

  useEffect(() => {
    let cancelled = false;

    if (!isOpen || !selectedPlaylist?.id) {
      setIsSelectedPlaylistLoading(false);
      setSelectedPlaylistTrackPage([]);
      setSelectedPlaylistTrackPageOffset(0);
      setSelectedPlaylistTrackPageTotal(0);
      selectedPlaylistTrackPageQueryKeyRef.current = null;
      return () => {
        cancelled = true;
      };
    }

    const supportsTrackPageQuery = typeof audioService.queryPlaylistTracksPage === 'function';
    const shouldUseTrackPageQuery = supportsTrackPageQuery;

    if (shouldUseTrackPageQuery) {
      const pageQueryKey = buildPlaylistTrackPageQueryKey({
        playlistId: selectedPlaylist.id,
        playlistUpdatedAt: selectedPlaylist.updatedAt,
        playlistTrackCount: selectedPlaylist.trackCount,
        searchQuery: playlistTrackSearchQuery,
        sortField: playlistTrackSortField,
        sortDirection: playlistTrackSortDirection,
      });
      const queryPlaylistTracksPage = audioService.queryPlaylistTracksPage;
      if (!queryPlaylistTracksPage) {
        setIsSelectedPlaylistLoading(false);
        setSelectedPlaylistTrackPage([]);
        setSelectedPlaylistTrackPageTotal(0);
        selectedPlaylistTrackPageQueryKeyRef.current = null;
        return () => {
          cancelled = true;
        };
      }

      const viewportHeight = playlistTrackListViewportHeight > 0 ? playlistTrackListViewportHeight : 720;
      const visibleCount = Math.max(1, Math.ceil(viewportHeight / PLAYLIST_TRACK_ROW_HEIGHT));
      const targetStart = Math.max(
        0,
        Math.floor(playlistTrackListScrollTop / PLAYLIST_TRACK_ROW_HEIGHT) -
          PLAYLIST_TRACK_WINDOW_OVERSCAN_ROWS
      );
      const targetEnd =
        targetStart + visibleCount + PLAYLIST_TRACK_WINDOW_OVERSCAN_ROWS * 2;
      const currentWindowStart = selectedPlaylistTrackPageOffset;
      const currentWindowEnd = currentWindowStart + selectedPlaylistTrackPage.length;
      const canReuseWindow =
        selectedPlaylistTrackPageQueryKeyRef.current === pageQueryKey &&
        selectedPlaylistTrackPage.length > 0 &&
        targetStart >= currentWindowStart &&
        targetEnd <= currentWindowEnd &&
        selectedPlaylistTrackPageTotal >= currentWindowEnd;

      if (canReuseWindow) {
        setIsSelectedPlaylistLoading(false);
        return () => {
          cancelled = true;
        };
      }

      const pageOffset = targetStart;
      const pageLimit = Math.max(
        PLAYLIST_TRACK_PAGE_SIZE,
        visibleCount + PLAYLIST_TRACK_WINDOW_OVERSCAN_ROWS * 2
      );

      setIsSelectedPlaylistLoading(true);
      telemetry.info('playlists.tracks.page-query.start', {
        fields: {
          playlistId: selectedPlaylist.id,
          trackCountHint: selectedPlaylist.trackCount ?? 0,
          searchQueryLength: playlistTrackSearchQuery.trim().length,
          sortField: playlistTrackSortField,
          sortDirection: playlistTrackSortDirection,
          offset: pageOffset,
          limit: pageLimit,
          kind: selectedPlaylist.kind ?? null,
        },
      });

      void queryPlaylistTracksPage
        .call(audioService, selectedPlaylist.id, {
          searchQuery: playlistTrackSearchQuery,
          sortField: playlistTrackSortField,
          sortDirection: playlistTrackSortDirection,
          limit: pageLimit,
          offset: pageOffset,
        })
        .then((page) => {
          if (cancelled) return;
          setSelectedPlaylistTrackPage(page?.items ?? []);
          setSelectedPlaylistTrackPageOffset(pageOffset);
          setSelectedPlaylistTrackPageTotal(page?.total ?? 0);
          selectedPlaylistTrackPageQueryKeyRef.current = pageQueryKey;
          telemetry.info('playlists.tracks.page-query.completed', {
            fields: {
              playlistId: selectedPlaylist.id,
              itemCount: page?.items.length ?? 0,
              total: page?.total ?? 0,
              offset: pageOffset,
              searchQueryLength: playlistTrackSearchQuery.trim().length,
              sortField: playlistTrackSortField,
              sortDirection: playlistTrackSortDirection,
              kind: selectedPlaylist.kind ?? null,
            },
          });
        })
        .catch((error) => {
          if (cancelled) return;
          telemetry.warn('playlists.tracks.page-query.failed', {
            message: readTelemetryErrorMessage(error),
            fields: {
              playlistId: selectedPlaylist.id,
              trackCountHint: selectedPlaylist.trackCount ?? 0,
              searchQueryLength: playlistTrackSearchQuery.trim().length,
              sortField: playlistTrackSortField,
              sortDirection: playlistTrackSortDirection,
              offset: pageOffset,
              kind: selectedPlaylist.kind ?? null,
            },
          });
          setSelectedPlaylistTrackPage([]);
          setSelectedPlaylistTrackPageOffset(0);
          setSelectedPlaylistTrackPageTotal(0);
          selectedPlaylistTrackPageQueryKeyRef.current = null;
        })
        .finally(() => {
          if (!cancelled) {
            setIsSelectedPlaylistLoading(false);
          }
        });

      return () => {
        cancelled = true;
      };
    }

    setSelectedPlaylistTrackPage([]);
    setSelectedPlaylistTrackPageOffset(0);
    setSelectedPlaylistTrackPageTotal(0);

    const requiresHydration =
      !supportsTrackPageQuery &&
      selectedPlaylist.tracksHydrated === false &&
      (selectedPlaylist.trackCount ?? 0) > 0;
    if (!requiresHydration) {
      setIsSelectedPlaylistLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsSelectedPlaylistLoading(true);
    telemetry.info('playlists.hydrate.start', {
      fields: {
        playlistId: selectedPlaylist.id,
        trackCountHint: selectedPlaylist.trackCount ?? 0,
        kind: selectedPlaylist.kind ?? null,
      },
    });
    const hydration = audioService.hydratePlaylistTracks?.(selectedPlaylist.id);
    if (!hydration) {
      setIsSelectedPlaylistLoading(false);
      return () => {
        cancelled = true;
      };
    }

    void hydration
      .then((hydratedPlaylist) => {
        telemetry.info('playlists.hydrate.completed', {
          fields: {
            playlistId: selectedPlaylist.id,
            trackCount: hydratedPlaylist?.tracks.length ?? hydratedPlaylist?.trackCount ?? 0,
            kind: hydratedPlaylist?.kind ?? selectedPlaylist.kind ?? null,
          },
        });
      })
      .catch((error) => {
        telemetry.warn('playlists.hydrate.failed', {
          message: readTelemetryErrorMessage(error),
          fields: {
            playlistId: selectedPlaylist.id,
            trackCountHint: selectedPlaylist.trackCount ?? 0,
            kind: selectedPlaylist.kind ?? null,
          },
        });
      })
      .finally(() => {
        if (!cancelled) {
          setIsSelectedPlaylistLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    audioService,
    isOpen,
    selectedPlaylist?.id,
    selectedPlaylist?.kind,
    selectedPlaylist?.trackCount,
    selectedPlaylist?.updatedAt,
    selectedPlaylist?.tracksHydrated,
    playlistTrackListScrollTop,
    playlistTrackListViewportHeight,
    playlistTrackSearchQuery,
    playlistTrackSortDirection,
    playlistTrackSortField,
    selectedPlaylistTrackPage.length,
    selectedPlaylistTrackPageOffset,
    selectedPlaylistTrackPageTotal,
    telemetry,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const fields = {
      playlistId: selectedPlaylist?.id ?? null,
      trackCount: selectedPlaylist?.trackCount ?? selectedPlaylist?.tracks.length ?? 0,
      tracksHydrated: selectedPlaylist?.tracksHydrated !== false,
      kind: selectedPlaylist?.kind ?? null,
    };
    telemetry.info('playlists.selection.changed', {
      fields,
    });
    captureTelemetryScenarioSnapshot({
      moduleId: 'playlists',
      component: 'Playlists',
      event: 'playlists.selection.changed.snapshot',
      fields,
      minIntervalMs: 400,
    });
  }, [
    isOpen,
    selectedPlaylist?.id,
    selectedPlaylist?.kind,
    selectedPlaylist?.trackCount,
    selectedPlaylist?.tracks.length,
    selectedPlaylist?.tracksHydrated,
    telemetry,
  ]);

  useEffect(() => {
    setSelectedTrackIndexes([]);
    setTrackContextMenu(null);
    setPlaylistActionsMenu(null);
    setShowSortMenu(false);
    setShowPlaylistTrackSearch(false);
  }, [selectedPlaylist?.id, selectedPlaylist?.updatedAt]);

  const handlePlaylistListScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setPlaylistListScrollTop(event.currentTarget.scrollTop);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const listElement = playlistListRef.current;
    if (!listElement) return;

    const syncViewport = () => {
      setPlaylistListViewportHeight(listElement.clientHeight);
      setPlaylistListScrollTop(listElement.scrollTop);
    };

    syncViewport();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      syncViewport();
    });
    observer.observe(listElement);
    return () => {
      observer.disconnect();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setPlaylistListScrollTop(0);
    if (playlistListRef.current) {
      playlistListRef.current.scrollTop = 0;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const listElement = playlistTrackListRef.current;
    if (!listElement) return;

    const syncViewport = () => {
      setPlaylistTrackListViewportHeight(listElement.clientHeight);
      setPlaylistTrackListScrollTop(listElement.scrollTop);
    };

    syncViewport();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      syncViewport();
    });
    observer.observe(listElement);
    return () => {
      observer.disconnect();
    };
  }, [isOpen, selectedPlaylist?.id]);

  useEffect(() => {
    setSelectedTrackIndexes([]);
    setPlaylistTrackListScrollTop(0);
    setSelectedPlaylistTrackPage([]);
    setSelectedPlaylistTrackPageOffset(0);
    setSelectedPlaylistTrackPageTotal(0);
    selectedPlaylistTrackPageQueryKeyRef.current = null;
    if (playlistTrackListRef.current) {
      playlistTrackListRef.current.scrollTop = 0;
    }
  }, [
    isOpen,
    playlistTrackSearchQuery,
    playlistTrackSortDirection,
    playlistTrackSortField,
    selectedPlaylist?.id,
    selectedPlaylist?.updatedAt,
  ]);

  const selectedPlaylistTrackPageQueryKey = useMemo(() => {
    if (!selectedPlaylist?.id) return null;
    return buildPlaylistTrackPageQueryKey({
      playlistId: selectedPlaylist.id,
      playlistUpdatedAt: selectedPlaylist.updatedAt,
      playlistTrackCount: selectedPlaylist.trackCount,
      searchQuery: playlistTrackSearchQuery,
      sortField: playlistTrackSortField,
      sortDirection: playlistTrackSortDirection,
    });
  }, [
    playlistTrackSearchQuery,
    playlistTrackSortDirection,
    playlistTrackSortField,
    selectedPlaylist?.id,
    selectedPlaylist?.trackCount,
    selectedPlaylist?.updatedAt,
  ]);

  const selectedPlaylistTrackPageMatchesQuery =
    !!selectedPlaylistTrackPageQueryKey &&
    selectedPlaylistTrackPageQueryKeyRef.current === selectedPlaylistTrackPageQueryKey;

  const selectedPlaylistTrackPageForRender = selectedPlaylistTrackPageMatchesQuery
    ? selectedPlaylistTrackPage
    : EMPTY_PLAYLIST_TRACK_PAGE;
  const selectedPlaylistTrackPageOffsetForRender = selectedPlaylistTrackPageMatchesQuery
    ? selectedPlaylistTrackPageOffset
    : 0;
  const selectedPlaylistTrackPageTotalForRender = selectedPlaylistTrackPageMatchesQuery
    ? selectedPlaylistTrackPageTotal
    : 0;

  const sidebarPlaylists = useMemo(() => {
    if (playlists.length <= 1) return playlists;

    const recentIndex = playlists.findIndex((playlist) => isFixedRecentSmartPlaylist(playlist));
    if (recentIndex <= 0) return playlists;

    const recentPlaylist = playlists[recentIndex];
    if (!recentPlaylist) return playlists;

    return [
      recentPlaylist,
      ...playlists.slice(0, recentIndex),
      ...playlists.slice(recentIndex + 1),
    ];
  }, [playlists]);

  const playlistVirtualWindow = useMemo(() => {
    const total = sidebarPlaylists.length;
    if (total <= 0) {
      return {
        start: 0,
        end: 0,
        topSpacerPx: 0,
        bottomSpacerPx: 0,
      };
    }

    const viewportHeight =
      playlistListViewportHeight > 0
        ? playlistListViewportHeight
        : PLAYLIST_LIST_VIRTUAL_ROW_HEIGHT * 8;
    const visibleCount = Math.max(1, Math.ceil(viewportHeight / PLAYLIST_LIST_VIRTUAL_ROW_HEIGHT));
    const rawStart = Math.max(
      0,
      Math.floor(playlistListScrollTop / PLAYLIST_LIST_VIRTUAL_ROW_HEIGHT) -
        PLAYLIST_LIST_VIRTUAL_OVERSCAN_ROWS
    );
    const maxStart = Math.max(0, total - visibleCount);
    const start = Math.min(rawStart, maxStart);
    const end = Math.min(
      total,
      start + visibleCount + PLAYLIST_LIST_VIRTUAL_OVERSCAN_ROWS * 2
    );

    return {
      start,
      end,
      topSpacerPx: start * PLAYLIST_LIST_VIRTUAL_ROW_HEIGHT,
      bottomSpacerPx: Math.max(0, (total - end) * PLAYLIST_LIST_VIRTUAL_ROW_HEIGHT),
    };
  }, [playlistListScrollTop, playlistListViewportHeight, sidebarPlaylists.length]);

  const virtualizedSidebarPlaylists = useMemo(
    () => sidebarPlaylists.slice(playlistVirtualWindow.start, playlistVirtualWindow.end),
    [playlistVirtualWindow.end, playlistVirtualWindow.start, sidebarPlaylists]
  );

  const playlistById = useMemo(
    () => new Map(playlists.map((playlist) => [playlist.id, playlist])),
    [playlists]
  );

  const playlistCoverResolveTargetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const playlist of virtualizedSidebarPlaylists) {
      ids.add(playlist.id);
    }
    if (selectedPlaylistId) {
      ids.add(selectedPlaylistId);
    }
    return Array.from(ids);
  }, [selectedPlaylistId, virtualizedSidebarPlaylists]);

  const playlistCoverResolveTargetIdSet = useMemo(
    () => new Set(playlistCoverResolveTargetIds),
    [playlistCoverResolveTargetIds]
  );

  const resolveRenderablePlaylistPreviewCoverUrl = useCallback(
    async (playlistId: string, coverSizeHint: CoverSizeHint = 'small'): Promise<string> => {
      const compactPreviewUrl = sanitizeRenderablePlaylistCoverUrl(
        await audioService.resolvePlaylistCoverPreview?.(playlistId, {
          coverSizeHint,
          preferCompactPreview: true,
        })
      );
      if (compactPreviewUrl) {
        return compactPreviewUrl;
      }

      return sanitizeRenderablePlaylistCoverUrl(
        await audioService.resolvePlaylistCoverPreview?.(playlistId, {
          coverSizeHint,
        })
      );
    },
    [audioService]
  );

  useEffect(() => {
    if (!showPlaylistTrackSearch) return;
    playlistTrackSearchInputRef.current?.focus();
  }, [showPlaylistTrackSearch]);

  useEffect(() => {
    if (!showPlaylistTrackSearch) return;

    const collapseSearch = () => {
      setShowPlaylistTrackSearch(false);
      setPlaylistTrackSearchQuery('');
    };

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (playlistTrackSearchControlRef.current?.contains(target)) return;
      collapseSearch();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        collapseSearch();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showPlaylistTrackSearch]);

  useEffect(() => {
    if (!showSortMenu) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (sortMenuRef.current?.contains(target)) return;
      if (sortMenuTriggerRef.current?.contains(target)) return;
      setShowSortMenu(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowSortMenu(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showSortMenu]);

  useEffect(() => {
    let cancelled = false;

    const clearResolvedPlaylistCover = (playlistId: string) => {
      setResolvedPlaylistCoverMap((previous) => {
        if (!(playlistId in previous)) return previous;
        const next = { ...previous };
        delete next[playlistId];
        return next;
      });
    };

    const resolvePlaylistCovers = async () => {
      let resolvedBatchCount = 0;

      for (const targetPlaylistId of playlistCoverResolveTargetIds) {
        if (resolvedBatchCount >= PLAYLIST_COVER_RESOLVE_BATCH_SIZE) {
          break;
        }

        const playlist = playlistById.get(targetPlaylistId);
        if (!playlist) continue;

        const playlistId = String(playlist.id || '').trim();
        if (!playlistId) continue;
        if (pendingPlaylistCoverIdsRef.current.has(playlistId)) continue;
        if (isFixedRecentSmartPlaylist(playlist)) {
          clearResolvedPlaylistCover(playlistId);
          continue;
        }

        const explicitPlaylistCover =
          typeof playlist.coverUrl === 'string' ? playlist.coverUrl.trim() : '';
        const hasStableExplicitPlaylistCover =
          isStableExplicitPlaylistCoverUrl(explicitPlaylistCover);
        if (hasStableExplicitPlaylistCover) {
          clearResolvedPlaylistCover(playlistId);
          continue;
        }

        if (playlist.tracksHydrated === false) {
          resolvedBatchCount += 1;
          pendingPlaylistCoverIdsRef.current.add(playlistId);
          try {
            const resolvedPreviewCoverUrl =
              await resolveRenderablePlaylistPreviewCoverUrl(playlistId);

            if (cancelled) continue;

            const normalizedPreviewCoverUrl =
              sanitizeRenderablePlaylistCoverUrl(resolvedPreviewCoverUrl);
            if (normalizedPreviewCoverUrl) {
              setResolvedPlaylistCoverMap((previous) => {
                if (previous[playlistId] === normalizedPreviewCoverUrl) return previous;
                return {
                  ...previous,
                  [playlistId]: normalizedPreviewCoverUrl,
                };
              });
            } else {
              clearResolvedPlaylistCover(playlistId);
            }
          } catch {
            clearResolvedPlaylistCover(playlistId);
          } finally {
            pendingPlaylistCoverIdsRef.current.delete(playlistId);
          }
          continue;
        }

        const trackCandidates = playlist.tracks.slice(0, 5);
        if (trackCandidates.length === 0) {
          clearResolvedPlaylistCover(playlistId);
          continue;
        }

        resolvedBatchCount += 1;
        pendingPlaylistCoverIdsRef.current.add(playlistId);
        try {
          let resolvedCoverUrl = await resolveRenderablePlaylistPreviewCoverUrl(playlistId);

          if (!resolvedCoverUrl) {
            for (const candidate of trackCandidates) {
              const embeddedCoverUrl = toNonEmptyString(candidate.coverUrl);
              const shouldIgnoreEmbeddedTrackCoverForResolution =
                isLikelyAbsolutePath(candidate.filePath || candidate.path) ||
                isManagedPmpPlaylistCoverUrl(embeddedCoverUrl);
              const resolutionCandidate = shouldIgnoreEmbeddedTrackCoverForResolution
                ? { ...candidate, coverUrl: undefined }
                : candidate;

              try {
                const resolvedFromLibrary = await musicLibraryService.getCoverUrlForTrack(
                  resolutionCandidate,
                  {
                    coverSizeHint: 'small',
                    bypassRuntimePolicy: true,
                  }
                );
                const normalizedResolved =
                  sanitizeRenderablePlaylistCoverUrl(resolvedFromLibrary);
                if (normalizedResolved) {
                  resolvedCoverUrl = normalizedResolved;
                  break;
                }
              } catch {
                // best-effort per candidate: continue trying next tracks in the playlist head.
              }

              if (
                embeddedCoverUrl &&
                !shouldIgnoreEmbeddedTrackCoverForResolution &&
                isRenderablePlaylistCoverUrl(embeddedCoverUrl)
              ) {
                resolvedCoverUrl = embeddedCoverUrl;
                break;
              }
            }
          }

          const isBilibiliPlaylist =
            playlist.kind === 'platform' && isBilibiliConnectorId(playlist.sourceConnectorId);
          if (!resolvedCoverUrl && isBilibiliPlaylist) {
            const bvid = trackCandidates
              .map(
                (candidate) =>
                  extractBvidFromText(candidate.originalPath) ||
                  extractBvidFromText(candidate.comment) ||
                  extractBvidFromText(candidate.path)
              )
              .find((value): value is string => Boolean(value));
            if (bvid) {
              const resource = await searchBilibiliResourceByBvid(bvid).catch(() => null);
              const discoveredCoverUrl =
                typeof resource?.coverUrl === 'string' ? resource.coverUrl.trim() : '';
              if (discoveredCoverUrl) {
                resolvedCoverUrl = discoveredCoverUrl;
              }
            }
          }

          if (resolvedCoverUrl && isBilibiliPlaylist) {
            const cachedBilibiliCover = await resolveBilibiliCoverAssetUrl(resolvedCoverUrl);
            if (typeof cachedBilibiliCover === 'string' && cachedBilibiliCover.trim().length > 0) {
              resolvedCoverUrl = sanitizeRenderablePlaylistCoverUrl(cachedBilibiliCover);
            }
          }

          if (cancelled) continue;

          const finalCoverUrl = sanitizeRenderablePlaylistCoverUrl(resolvedCoverUrl);
          if (finalCoverUrl) {
            setResolvedPlaylistCoverMap((previous) => {
              if (previous[playlistId] === finalCoverUrl) return previous;
              return {
                ...previous,
                [playlistId]: finalCoverUrl,
              };
            });
          } else {
            clearResolvedPlaylistCover(playlistId);
          }
        } catch {
          // best-effort: keep fallback icon when cover cannot be resolved.
        } finally {
          pendingPlaylistCoverIdsRef.current.delete(playlistId);
        }
      }
    };

    void resolvePlaylistCovers();

    return () => {
      cancelled = true;
    };
  }, [playlistById, playlistCoverResolveTargetIds, resolveRenderablePlaylistPreviewCoverUrl]);

  useEffect(() => {
    if (!selectedPlaylist || isFixedRecentSmartPlaylist(selectedPlaylist)) {
      setSelectedPlaylistHeroCover((previous) =>
        previous.playlistId === null && previous.url.length === 0
          ? previous
          : EMPTY_SELECTED_PLAYLIST_HERO_COVER
      );
      return;
    }

    const explicitPlaylistCover = sanitizeRenderablePlaylistCoverUrl(selectedPlaylist.coverUrl);
    if (isStableExplicitPlaylistCoverUrl(explicitPlaylistCover)) {
      setSelectedPlaylistHeroCover((previous) =>
        previous.playlistId === selectedPlaylist.id && previous.url.length === 0
          ? previous
          : { playlistId: selectedPlaylist.id, url: '' }
      );
      return;
    }

    let cancelled = false;
    setSelectedPlaylistHeroCover((previous) =>
      previous.playlistId === selectedPlaylist.id && previous.url.length === 0
        ? previous
        : { playlistId: selectedPlaylist.id, url: '' }
    );
    void resolveRenderablePlaylistPreviewCoverUrl(selectedPlaylist.id, 'medium')
      .then((resolvedUrl) => {
        if (cancelled) return;
        const normalizedUrl = sanitizeRenderablePlaylistCoverUrl(resolvedUrl);
        setSelectedPlaylistHeroCover((previous) =>
          previous.playlistId === selectedPlaylist.id && previous.url === normalizedUrl
            ? previous
            : { playlistId: selectedPlaylist.id, url: normalizedUrl }
        );
      })
      .catch(() => {
        if (cancelled) return;
        setSelectedPlaylistHeroCover((previous) =>
          previous.playlistId === selectedPlaylist.id && previous.url.length === 0
            ? previous
            : { playlistId: selectedPlaylist.id, url: '' }
        );
      });

    return () => {
      cancelled = true;
    };
  }, [resolveRenderablePlaylistPreviewCoverUrl, selectedPlaylist]);

  const handleCreatePlaylist = (name: string) => {
    audioService.createPlaylist(name);
    setShowCreateDialog(false);
  };

  const handleDeletePlaylist = () => {
    if (!playlistToDelete) {
      return;
    }

    audioService.deletePlaylist(playlistToDelete);
    if (selectedPlaylistId === playlistToDelete) {
      setSelectedPlaylistId(null);
    }
    setShowDeleteConfirm(false);
    setPlaylistToDelete(null);
  };

  const handleRenamePlaylist = (newName: string) => {
    if (!playlistToRenameId) {
      return;
    }

    audioService.renamePlaylist(playlistToRenameId, newName);
    setShowRenameDialog(false);
    setPlaylistToRenameId(null);
  };

  const handlePlayPlaylist = (playlistId: string) => {
    const playlist = audioService.getPlaylist?.(playlistId) ?? null;
    telemetry.info('playlists.playlist.play', {
      fields: {
        playlistId,
        trackCount: playlist?.trackCount ?? playlist?.tracks.length ?? 0,
        kind: playlist?.kind ?? null,
      },
    });
    void audioService.playPlaylist(playlistId).catch((error) => {
      telemetry.error('playlists.playlist.play.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          playlistId,
          trackCount: playlist?.trackCount ?? playlist?.tracks.length ?? 0,
          kind: playlist?.kind ?? null,
        },
      });
    });
  };

  const handleAddPlaylistToQueue = (playlistId: string) => {
    const playlist = audioService.getPlaylist?.(playlistId) ?? null;
    const fields = {
      playlistId,
      trackCount: playlist?.trackCount ?? playlist?.tracks.length ?? 0,
      kind: playlist?.kind ?? null,
    };
    telemetry.info('playlists.playlist.add-to-queue', {
      fields,
    });
    captureTelemetryScenarioSnapshot({
      moduleId: 'playlists',
      component: 'Playlists',
      event: 'playlists.playlist.add-to-queue.snapshot',
      fields,
      minIntervalMs: 300,
    });
    void audioService.addPlaylistToQueue(playlistId).catch((error) => {
      telemetry.error('playlists.playlist.add-to-queue.failed', {
        message: readTelemetryErrorMessage(error),
        fields,
      });
    });
  };

  const handleRemoveTrackFromPlaylist = (playlistId: string, trackIndex: number) => {
    audioService.removeTrackFromPlaylist(playlistId, trackIndex);
  };

  const handleClearPlaylist = () => {
    if (!playlistToClear) {
      return;
    }

    audioService.clearPlaylist(playlistToClear);
    setShowClearConfirm(false);
    setPlaylistToClear(null);
    setSelectedTrackIndexes([]);
  };

  const handlePlayTrackFromPlaylist = (playlist: Playlist, trackIndex: number) => {
    const track = playlist.tracks[trackIndex] ?? null;
    telemetry.info('playlists.track.play.start', {
      fields: {
        playlistId: playlist.id,
        playlistTrackCount: playlist.tracks.length,
        trackIndex,
        trackId: track?.id ?? null,
        trackTitle: track?.title ?? null,
      },
    });
    const playPromise = audioService.playPlaylistTrackAtIndex?.(playlist.id, trackIndex);
    if (playPromise) {
      void playPromise.catch((error) => {
        telemetry.error('playlists.track.play.failed', {
          message: readTelemetryErrorMessage(error),
          fields: {
            playlistId: playlist.id,
            playlistTrackCount: playlist.tracks.length,
            trackIndex,
            trackId: track?.id ?? null,
          },
        });
      });
      return;
    }

    audioService.clearQueue();
    audioService.addMultipleToQueue(playlist.tracks);
    void audioService.playTrackAtIndex(trackIndex).catch((error) => {
      telemetry.error('playlists.track.play.failed', {
        message: readTelemetryErrorMessage(error),
        fields: {
          playlistId: playlist.id,
          playlistTrackCount: playlist.tracks.length,
          trackIndex,
          trackId: track?.id ?? null,
        },
      });
    });
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTotalDuration = (seconds?: number): string => {
    const safeSeconds = seconds ?? 0;
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    if (hours > 0) return t('pages.music-library.duration.hoursMinutes', { hours, minutes });
    return t('pages.music-library.duration.minutes', { minutes });
  };

  const playlistSortOptions = useMemo<
    Array<{ field: PlaylistTrackSortField; label: string }>
  >(
    () => [
      { field: 'default', label: t('pages.playlists.manage.sort.field.default') },
      { field: 'title', label: t('pages.playlists.manage.sort.field.title') },
      { field: 'artist', label: t('pages.playlists.manage.sort.field.artist') },
      { field: 'album', label: t('pages.playlists.manage.sort.field.album') },
      { field: 'duration', label: t('pages.playlists.manage.sort.field.duration') },
    ],
    [t]
  );

  const currentSortOptionLabel =
    playlistSortOptions.find((option) => option.field === playlistTrackSortField)?.label ??
    playlistSortOptions[0]?.label ??
    t('pages.playlists.manage.sort.field.default');

  const handleSelectPlaylistSortField = (field: PlaylistTrackSortField) => {
    if (field === 'default') {
      setPlaylistTrackSortField('default');
      setPlaylistTrackSortDirection('asc');
      setShowSortMenu(false);
      return;
    }

    if (playlistTrackSortField === field) {
      setPlaylistTrackSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'));
      setShowSortMenu(false);
      return;
    }

    setPlaylistTrackSortField(field);
    setPlaylistTrackSortDirection('asc');
    setShowSortMenu(false);
  };

  const handleTogglePlaylistTrackSearch = () => {
    if (!showPlaylistTrackSearch) {
      setShowPlaylistTrackSearch(true);
      return;
    }

    setShowPlaylistTrackSearch(false);
    if (playlistTrackSearchQuery.trim().length > 0) {
      setPlaylistTrackSearchQuery('');
    }
  };

  const isReadonlyPlaylist = (playlist: Playlist | null): boolean => {
    if (!playlist) return false;
    if (playlist.readonly) return true;
    return playlist.kind === 'smart';
  };

  const getPlaylistSourceBadge = (
    playlist: Playlist
  ): { label: string; variant: 'manual' | 'smart' | 'platform' } => {
    if (playlist.kind === 'smart') {
      return { label: 'SMART', variant: 'smart' };
    }

    if (playlist.kind === 'platform') {
      const connectorId =
        typeof playlist.sourceConnectorId === 'string' ? playlist.sourceConnectorId.trim() : '';
      const connectorName = connectorId
        ? connectorId.replace(/^connector\./i, '').replace(/\./g, ' ').toUpperCase()
        : 'PLATFORM';
      return { label: connectorName, variant: 'platform' };
    }

    return { label: 'PMP', variant: 'manual' };
  };

  const renderPlaylistSourceBadge = (playlist: Playlist, className?: string) => {
    const badge = getPlaylistSourceBadge(playlist);
    const classes = [
      'playlists-source-badge',
      `playlists-source-badge-${badge.variant}`,
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    return <span className={classes}>{badge.label}</span>;
  };

  const resolveDisplayPlaylistCoverUrl = useCallback(
    (playlist: Playlist | null): string => {
      if (!playlist) return '';
      if (isFixedRecentSmartPlaylist(playlist)) return '';

      const resolvedCoverUrl = sanitizeRenderablePlaylistCoverUrl(
        resolvedPlaylistCoverMap[playlist.id]
      );
      if (resolvedCoverUrl) {
        return resolvedCoverUrl;
      }

      const explicitPlaylistCover = sanitizeRenderablePlaylistCoverUrl(playlist.coverUrl);
      if (explicitPlaylistCover) {
        return explicitPlaylistCover;
      }

      return '';
    },
    [resolvedPlaylistCoverMap]
  );

  const selectedPlaylistReadonly = isReadonlyPlaylist(selectedPlaylist);
  const selectedPlaylistBaseCoverUrl = resolveDisplayPlaylistCoverUrl(selectedPlaylist);
  const selectedPlaylistCoverUrl =
    (selectedPlaylist && selectedPlaylistHeroCover.playlistId === selectedPlaylist.id
      ? sanitizeRenderablePlaylistCoverUrl(selectedPlaylistHeroCover.url)
      : '') || selectedPlaylistBaseCoverUrl;

  const activePlaylistCoverUrls = useMemo(() => {
    const urls = new Set<string>();
    for (const playlist of virtualizedSidebarPlaylists) {
      const coverUrl = resolveDisplayPlaylistCoverUrl(playlist);
      if (coverUrl) {
        urls.add(coverUrl);
      }
    }
    if (selectedPlaylistCoverUrl) {
      urls.add(selectedPlaylistCoverUrl);
    }
    return Array.from(urls);
  }, [resolveDisplayPlaylistCoverUrl, selectedPlaylistCoverUrl, virtualizedSidebarPlaylists]);

  const activePlaylistBlobCoverUrlCount = useMemo(
    () => activePlaylistCoverUrls.filter((url) => url.startsWith('blob:')).length,
    [activePlaylistCoverUrls]
  );
  const activePlaylistCoverUrlSet = useMemo(
    () => new Set(activePlaylistCoverUrls),
    [activePlaylistCoverUrls]
  );

  const recomputePlaylistCoverDecodedStats = useCallback(() => {
    let totalBytes = 0;
    for (const bytes of playlistCoverDecodedBytesRef.current.values()) {
      totalBytes += bytes;
    }
    setPlaylistCoverDecodedStats((previous) => {
      if (
        previous.entryCount === playlistCoverDecodedBytesRef.current.size &&
        previous.totalBytes === totalBytes
      ) {
        return previous;
      }
      return {
        entryCount: playlistCoverDecodedBytesRef.current.size,
        totalBytes,
      };
    });
  }, []);

  const reportPlaylistCoverError = useCallback((coverUrl: string) => {
    const normalizedUrl = toNonEmptyString(coverUrl);
    if (!normalizedUrl) return;
    telemetry.warn('playlists.cover.load.failed', {
      fields: {
        coverUrl: normalizedUrl,
        coverKind: classifyPlaylistCoverUrl(normalizedUrl),
        selectedPlaylistId: selectedPlaylistId ?? null,
      },
    });
    playlistCoverDecodedBytesRef.current.delete(normalizedUrl);
    recomputePlaylistCoverDecodedStats();
  }, [recomputePlaylistCoverDecodedStats, selectedPlaylistId, telemetry]);

  const reportPlaylistCoverDecoded = useCallback(
    (coverUrl: string, naturalWidth: number, naturalHeight: number) => {
      const normalizedUrl = toNonEmptyString(coverUrl);
      if (!normalizedUrl) return;
      musicLibraryService.reportCoverDecoded(normalizedUrl, naturalWidth, naturalHeight);

      const width = Math.round(naturalWidth);
      const height = Math.round(naturalHeight);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return;
      }

      const bytes = width * height * 4;
      if (!Number.isFinite(bytes) || bytes <= 0) return;

      const existing = playlistCoverDecodedBytesRef.current.get(normalizedUrl);
      if (existing === bytes) return;
      playlistCoverDecodedBytesRef.current.set(normalizedUrl, bytes);
      recomputePlaylistCoverDecodedStats();
    },
    [recomputePlaylistCoverDecodedStats]
  );

  const releasePlaylistCoverUrls = useCallback(
    (urls: string[]) => {
      if (!Array.isArray(urls) || urls.length === 0) return;

      let changed = false;
      const { trackedUrls } = partitionPlaylistCoverUrlsForRelease(urls);
      for (const normalizedUrl of trackedUrls) {
        changed = playlistCoverDecodedBytesRef.current.delete(normalizedUrl) || changed;
      }

      if (changed) {
        recomputePlaylistCoverDecodedStats();
      }

      // Callers only pass URLs that are no longer active in the overlay, so release every runtime
      // cover candidate here instead of leaving service-managed pmp/http entries resident.
      if (trackedUrls.length > 0) {
        musicLibraryService.releaseCoverUrls(trackedUrls);
      }
    },
    [recomputePlaylistCoverDecodedStats]
  );

  useEffect(() => {
    const { changed, nextMap, releasedUrls } = pruneResolvedPlaylistCoverMap(
      resolvedPlaylistCoverMap,
      playlistCoverResolveTargetIdSet
    );
    if (!changed) return;

    setResolvedPlaylistCoverMap(nextMap);
    if (releasedUrls.length > 0) {
      const safeReleasedUrls = releasedUrls.filter((url) => !activePlaylistCoverUrlSet.has(url));
      if (safeReleasedUrls.length > 0) {
        releasePlaylistCoverUrls(safeReleasedUrls);
      }
    }
  }, [
    activePlaylistCoverUrlSet,
    playlistCoverResolveTargetIdSet,
    releasePlaylistCoverUrls,
    resolvedPlaylistCoverMap,
  ]);

  const clearScheduledPlaylistsResidencyCapture = useCallback((key?: string) => {
    if (key) {
      const timers = playlistsResidencyTimersRef.current.get(key);
      if (timers) {
        for (const timer of timers) {
          clearTimeout(timer);
        }
        playlistsResidencyTimersRef.current.delete(key);
      }
      return;
    }

    for (const timers of playlistsResidencyTimersRef.current.values()) {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    }
    playlistsResidencyTimersRef.current.clear();
  }, []);

  const schedulePlaylistsResidencyCapture = useCallback(
    (
      key: string,
      reason: 'overlay-open' | 'overlay-close' | 'playlist-switch',
      delaysMs: readonly number[]
    ) => {
      clearScheduledPlaylistsResidencyCapture(key);

      const timers = Array.from(new Set(delaysMs))
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.max(0, Math.floor(value)))
        .sort((left, right) => left - right)
        .map((delayMs) =>
          setTimeout(() => {
            const metrics = playlistsResidencyMetricsRef.current;
            void (
              getGlobalProcessPerfService()?.refreshTotalsSnapshot() ??
              getProcessPerfTotalsSnapshot()
            )
              .catch(() => null)
              .then((processSnapshot) => {
                const totals = processSnapshot?.totals;
                recordPlaylistsOverlayResidencySample({
                  timestampMs: Date.now(),
                  reason,
                  delayMs,
                  overlayOpen: metrics.overlayOpen,
                  selectedPlaylistId: metrics.selectedPlaylistId,
                  selectedPlaylistTrackCount: metrics.selectedPlaylistTrackCount,
                  totalPlaylistCount: metrics.totalPlaylistCount,
                  hydratedPlaylistCount: metrics.hydratedPlaylistCount,
                  loadedPlaylistTrackCount: metrics.loadedPlaylistTrackCount,
                  visibleSidebarPlaylistCount: metrics.visibleSidebarPlaylistCount,
                  filteredTrackCount: metrics.filteredTrackCount,
                  selectedTrackCount: metrics.selectedTrackCount,
                  resolvedCoverCount: metrics.resolvedCoverCount,
                  resolvedCoverBlobCount: metrics.resolvedCoverBlobCount,
                  resolvedCoverUrlChars: metrics.resolvedCoverUrlChars,
                  activeBlobCoverUrlCount: metrics.activeBlobCoverUrlCount,
                  decodedCoverEntryCount: metrics.decodedCoverEntryCount,
                  decodedCoverEstimateBytes: metrics.decodedCoverEstimateBytes,
                  selectedCoverUrlKind: metrics.selectedCoverUrlKind,
                  selectedCoverDecodedBytes: metrics.selectedCoverDecodedBytes,
                  pageApproxJsonBytes: metrics.pageApproxJsonBytes,
                  webview2PrivateBytes: totals?.webview2PrivateBytes ?? null,
                  webview2WorkingSetBytes: totals?.webview2WorkingSetBytes ?? null,
                  treePrivateBytes: totals?.privateBytes ?? null,
                  treeWorkingSetBytes: totals?.workingSetBytes ?? null,
                  webview2CpuPercent: totals?.webview2CpuPercent ?? null,
                });
              });
          }, delayMs)
        );

      if (timers.length > 0) {
        playlistsResidencyTimersRef.current.set(key, timers);
      }
    },
    [clearScheduledPlaylistsResidencyCapture]
  );

  useEffect(() => {
    const nextUrls = new Set(activePlaylistCoverUrls);
    const previousUrls = activePlaylistCoverUrlsRef.current;
    const urlsToRelease: string[] = [];

    for (const url of previousUrls) {
      if (!nextUrls.has(url)) {
        urlsToRelease.push(url);
      }
    }

    if (urlsToRelease.length > 0) {
      releasePlaylistCoverUrls(urlsToRelease);
    }

    activePlaylistCoverUrlsRef.current = nextUrls;
  }, [activePlaylistCoverUrls, releasePlaylistCoverUrls]);

  const releasePlaylistOverlayRuntimeResources = useCallback(
    (options?: { resetState?: boolean }) => {
      const urlsToRelease = new Set<string>(activePlaylistCoverUrlsRef.current);
      for (const url of Object.values(resolvedPlaylistCoverMapRef.current)) {
        const normalizedUrl = toNonEmptyString(url);
        if (normalizedUrl) {
          urlsToRelease.add(normalizedUrl);
        }
      }

      activePlaylistCoverUrlsRef.current.clear();
      resolvedPlaylistCoverMapRef.current = {};
      previousSelectedPlaylistIdRef.current = null;
      pendingPlaylistCoverIdsRef.current.clear();
      audioService.releasePlaylistTracks?.();

      if (options?.resetState) {
        setSelectedPlaylistId(null);
        setSelectedTrackIndexes([]);
        setTrackContextMenu(null);
        setPlaylistActionsMenu(null);
        setShowCreateDialog(false);
        setShowRenameDialog(false);
        setShowDeleteConfirm(false);
        setShowClearConfirm(false);
        setShowSortMenu(false);
        setShowPlaylistTrackSearch(false);
        setPlaylistBatchMode(false);
        setPlaylistTrackSearchQuery('');
        setPlaylistToDelete(null);
        setPlaylistToRenameId(null);
        setPlaylistToClear(null);
        setIsSelectedPlaylistLoading(false);
        setSelectedPlaylistTrackPage([]);
        setSelectedPlaylistTrackPageOffset(0);
        setSelectedPlaylistTrackPageTotal(0);
        setSelectedPlaylistHeroCover(EMPTY_SELECTED_PLAYLIST_HERO_COVER);
        setResolvedPlaylistCoverMap({});
        setPlaylistListScrollTop(0);
        setPlaylistListViewportHeight(0);
        setPlaylistTrackListScrollTop(0);
        setPlaylistTrackListViewportHeight(0);
      }

      if (urlsToRelease.size > 0) {
        releasePlaylistCoverUrls(Array.from(urlsToRelease));
      }
      if (playlistCoverDecodedBytesRef.current.size > 0) {
        playlistCoverDecodedBytesRef.current.clear();
        setPlaylistCoverDecodedStats({ entryCount: 0, totalBytes: 0 });
      }
    },
    [audioService, releasePlaylistCoverUrls]
  );

  useEffect(() => {
    if (isOpen) return;

    releasePlaylistOverlayRuntimeResources({ resetState: true });
    scheduleProcessWorkingSetTrim('webview2', {
      delaysMs: [0, 700, 2200],
      reason: 'playlists-overlay-hidden',
    });
  }, [isOpen, releasePlaylistOverlayRuntimeResources]);

  useEffect(() => {
    return () => {
      releasePlaylistOverlayRuntimeResources();
    };
  }, [releasePlaylistOverlayRuntimeResources]);

  const shouldUseSelectedPlaylistTrackPage =
    !!selectedPlaylist &&
    typeof audioService.queryPlaylistTracksPage === 'function';

  const selectedPlaylistTrackEntries = shouldUseSelectedPlaylistTrackPage
    ? selectedPlaylistTrackPageForRender
    : (selectedPlaylist?.tracks ?? EMPTY_TRACKS).map((track, playlistIndex) => ({
        playlistIndex,
        track,
      }));

  const selectedPlaylistTracks = selectedPlaylistTrackEntries.map((entry) => entry.track);
  const selectedPlaylistTrackEntryMap = useMemo(
    () => new Map(selectedPlaylistTrackEntries.map((entry) => [entry.playlistIndex, entry.track])),
    [selectedPlaylistTrackEntries]
  );

  const filteredPlaylistTrackIndexes = useMemo(
    () =>
      shouldUseSelectedPlaylistTrackPage
        ? EMPTY_NUMBERS
        : resolvePlaylistTrackIndexes({
            tracks: selectedPlaylistTracks,
            searchQuery: playlistTrackSearchQuery,
            sortField: playlistTrackSortField,
            sortDirection: playlistTrackSortDirection,
          }),
    [
      shouldUseSelectedPlaylistTrackPage,
      playlistTrackSearchQuery,
      playlistTrackSortDirection,
      playlistTrackSortField,
      selectedPlaylistTracks,
    ]
  );
  const filteredPlaylistTrackCount = shouldUseSelectedPlaylistTrackPage
    ? selectedPlaylistTrackPageTotalForRender
    : filteredPlaylistTrackIndexes.length;

  const shouldShowSelectedPlaylistTracksLoading =
    isSelectedPlaylistLoading ||
    (shouldUseSelectedPlaylistTrackPage &&
      !!selectedPlaylistTrackPageQueryKey &&
      !selectedPlaylistTrackPageMatchesQuery);

  const playlistTrackRenderWindow = useMemo(() => {
    const viewportHeight = playlistTrackListViewportHeight > 0 ? playlistTrackListViewportHeight : 720;
    const visibleCount = Math.max(1, Math.ceil(viewportHeight / PLAYLIST_TRACK_ROW_HEIGHT));
    const overscan = PLAYLIST_TRACK_WINDOW_OVERSCAN_ROWS;

    if (shouldUseSelectedPlaylistTrackPage) {
      const items: PlaylistTrackWindowItem[] = selectedPlaylistTrackPageForRender.map((entry) => ({
        playlistIndex: entry.playlistIndex,
        track: entry.track,
      }));
      const windowEnd =
        selectedPlaylistTrackPageOffsetForRender + selectedPlaylistTrackPageForRender.length;
      return {
        items,
        topSpacerPx: selectedPlaylistTrackPageOffsetForRender * PLAYLIST_TRACK_ROW_HEIGHT,
        bottomSpacerPx:
          Math.max(0, selectedPlaylistTrackPageTotalForRender - windowEnd) *
          PLAYLIST_TRACK_ROW_HEIGHT,
      };
    }

    const start = Math.max(
      0,
      Math.floor(playlistTrackListScrollTop / PLAYLIST_TRACK_ROW_HEIGHT) - overscan
    );
    const end = Math.min(
      filteredPlaylistTrackIndexes.length,
      start + visibleCount + overscan * 2
    );
    const items: PlaylistTrackWindowItem[] = filteredPlaylistTrackIndexes
      .slice(start, end)
      .map((playlistIndex) => {
        const track = selectedPlaylistTrackEntryMap.get(playlistIndex);
        if (!track) return null;
        return {
          playlistIndex,
          track,
        };
      })
      .filter((item): item is PlaylistTrackWindowItem => item != null);

    return {
      items,
      topSpacerPx: start * PLAYLIST_TRACK_ROW_HEIGHT,
      bottomSpacerPx: Math.max(0, filteredPlaylistTrackIndexes.length - end) * PLAYLIST_TRACK_ROW_HEIGHT,
    };
  }, [
    filteredPlaylistTrackIndexes,
    playlistTrackListScrollTop,
    playlistTrackListViewportHeight,
    selectedPlaylistTrackEntryMap,
    selectedPlaylistTrackPageForRender,
    selectedPlaylistTrackPageOffsetForRender,
    selectedPlaylistTrackPageTotalForRender,
    shouldUseSelectedPlaylistTrackPage,
  ]);

  const selectedTrackIndexSet = useMemo(
    () => new Set(selectedTrackIndexes),
    [selectedTrackIndexes]
  );

  const selectedPlaylistTrackIndexes = useMemo(() => {
    if (selectedTrackIndexes.length === 0) {
      return EMPTY_NUMBERS;
    }

    const maxPlaylistIndexExclusive = shouldUseSelectedPlaylistTrackPage
      ? Math.max(selectedPlaylistTrackPageTotalForRender, selectedPlaylist?.trackCount ?? 0)
      : selectedPlaylistTracks.length;
    if (maxPlaylistIndexExclusive <= 0) {
      return EMPTY_NUMBERS;
    }

    const next = Array.from(
      new Set(
        selectedTrackIndexes.filter((index) =>
          Number.isInteger(index) && index >= 0 && index < maxPlaylistIndexExclusive
        )
      )
    ).sort((left, right) => left - right);

    return next.length > 0 ? next : EMPTY_NUMBERS;
  }, [
    selectedPlaylist?.trackCount,
    selectedPlaylistTrackPageTotalForRender,
    selectedPlaylistTracks,
    selectedTrackIndexes,
    shouldUseSelectedPlaylistTrackPage,
  ]);

  const selectedTrackCount = selectedPlaylistTrackIndexes.length;
  const resolvedCoverValues = useMemo(
    () => Object.values(resolvedPlaylistCoverMap).map((value) => toNonEmptyString(value)).filter(Boolean),
    [resolvedPlaylistCoverMap]
  );
  const resolvedCoverBlobCount = useMemo(
    () => resolvedCoverValues.filter((value) => value.startsWith('blob:')).length,
    [resolvedCoverValues]
  );
  const resolvedCoverUrlChars = useMemo(
    () => resolvedCoverValues.reduce((total, value) => total + value.length, 0),
    [resolvedCoverValues]
  );
  const hydratedPlaylistCount = useMemo(
    () =>
      playlists.filter(
        (playlist) => playlist.tracksHydrated !== false && playlist.tracks.length > 0
      ).length,
    [playlists]
  );
  const loadedPlaylistTrackCount = useMemo(
    () =>
      playlists.reduce((total, playlist) => total + playlist.tracks.length, 0) +
      (shouldUseSelectedPlaylistTrackPage ? selectedPlaylistTrackPageForRender.length : 0),
    [playlists, selectedPlaylistTrackPageForRender.length, shouldUseSelectedPlaylistTrackPage]
  );
  const selectedCoverDecodedBytes = useMemo(() => {
    const normalizedUrl = toNonEmptyString(selectedPlaylistCoverUrl);
    if (!normalizedUrl) return 0;
    void playlistCoverDecodedStats.totalBytes;
    return playlistCoverDecodedBytesRef.current.get(normalizedUrl) ?? 0;
  }, [playlistCoverDecodedStats.totalBytes, selectedPlaylistCoverUrl]);
  const playlistsOverlayPageApproxJsonBytes = useMemo(
    () =>
      measureJsonBytes({
        selectedPlaylistId,
        selectedTrackIndexes,
        selectedPlaylistTrackPage,
        selectedPlaylistTrackPageOffset,
        selectedPlaylistTrackPageTotal,
        resolvedPlaylistCoverMap,
        filteredPlaylistTrackCount,
        playlistBatchMode,
        showPlaylistTrackSearch,
        playlistTrackSearchQuery,
        playlistTrackSortField,
        playlistTrackSortDirection,
      }),
    [
      filteredPlaylistTrackCount,
      playlistBatchMode,
      playlistTrackSearchQuery,
      playlistTrackSortDirection,
      playlistTrackSortField,
      resolvedPlaylistCoverMap,
      selectedPlaylistId,
      selectedPlaylistTrackPage,
      selectedPlaylistTrackPageOffset,
      selectedPlaylistTrackPageTotal,
      selectedTrackIndexes,
      showPlaylistTrackSearch,
    ]
  );

  useEffect(() => {
    playlistsResidencyMetricsRef.current = {
      overlayOpen: isOpen,
      selectedPlaylistId,
      selectedPlaylistTrackCount: shouldUseSelectedPlaylistTrackPage
        ? selectedPlaylistTrackPageTotalForRender
        : selectedPlaylistTracks.length,
      totalPlaylistCount: playlists.length,
      hydratedPlaylistCount,
      loadedPlaylistTrackCount,
      visibleSidebarPlaylistCount: virtualizedSidebarPlaylists.length,
      filteredTrackCount: filteredPlaylistTrackCount,
      selectedTrackCount,
      resolvedCoverCount: resolvedCoverValues.length,
      resolvedCoverBlobCount,
      resolvedCoverUrlChars,
      activeBlobCoverUrlCount: activePlaylistBlobCoverUrlCount,
      decodedCoverEntryCount: playlistCoverDecodedStats.entryCount,
      decodedCoverEstimateBytes: playlistCoverDecodedStats.totalBytes,
      selectedCoverUrlKind: classifyPlaylistCoverUrl(selectedPlaylistCoverUrl),
      selectedCoverDecodedBytes,
      pageApproxJsonBytes: playlistsOverlayPageApproxJsonBytes,
    };
  }, [
    activePlaylistBlobCoverUrlCount,
    playlists.length,
    filteredPlaylistTrackCount,
    hydratedPlaylistCount,
    isOpen,
    loadedPlaylistTrackCount,
    playlistCoverDecodedStats.entryCount,
    playlistCoverDecodedStats.totalBytes,
    playlistsOverlayPageApproxJsonBytes,
    resolvedCoverBlobCount,
    resolvedCoverUrlChars,
    resolvedCoverValues.length,
      selectedCoverDecodedBytes,
      selectedPlaylistCoverUrl,
      selectedPlaylistId,
      selectedPlaylistTrackPageTotalForRender,
      selectedPlaylistTracks.length,
      selectedTrackCount,
      shouldUseSelectedPlaylistTrackPage,
      virtualizedSidebarPlaylists.length,
    ]);

  useEffect(() => {
    if (!isOpen) return;
    playlistOverlayHasBeenOpenRef.current = true;
    schedulePlaylistsResidencyCapture('overlay-open', 'overlay-open', [0, 800]);
    return () => {
      clearScheduledPlaylistsResidencyCapture('overlay-open');
    };
  }, [clearScheduledPlaylistsResidencyCapture, isOpen, schedulePlaylistsResidencyCapture]);

  useEffect(() => {
    if (isOpen) return;
    if (!playlistOverlayHasBeenOpenRef.current) return;
    schedulePlaylistsResidencyCapture('overlay-close', 'overlay-close', [0, 700, 2200]);
    return () => {
      clearScheduledPlaylistsResidencyCapture('overlay-close');
    };
  }, [clearScheduledPlaylistsResidencyCapture, isOpen, schedulePlaylistsResidencyCapture]);

  useEffect(() => {
    if (!isOpen || !selectedPlaylistId) return;
    schedulePlaylistsResidencyCapture('playlist-switch', 'playlist-switch', [0, 600, 1600]);
    return () => {
      clearScheduledPlaylistsResidencyCapture('playlist-switch');
    };
  }, [
    clearScheduledPlaylistsResidencyCapture,
    isOpen,
    schedulePlaylistsResidencyCapture,
    selectedPlaylistId,
  ]);

  useEffect(() => {
    return () => {
      clearScheduledPlaylistsResidencyCapture();
    };
  }, [clearScheduledPlaylistsResidencyCapture]);

  const handleToggleTrackSelection = (index: number, checked: boolean) => {
    setSelectedTrackIndexes((previous) => {
      const next = new Set(previous);
      if (checked) {
        next.add(index);
      } else {
        next.delete(index);
      }
      return Array.from(next).sort((left, right) => left - right);
    });
  };

  const handleSelectAllFilteredTracks = () => {
    if (
      shouldUseSelectedPlaylistTrackPage &&
      selectedPlaylist?.id &&
      typeof audioService.queryPlaylistTracksPage === 'function'
    ) {
      const queryPlaylistTracksPage = audioService.queryPlaylistTracksPage;
      void (async () => {
        const indexes: number[] = [];
        let offset = 0;
        let total = selectedPlaylistTrackPageTotal;
        while (total <= 0 || offset < total) {
          const page = await queryPlaylistTracksPage.call(audioService, selectedPlaylist.id, {
            searchQuery: playlistTrackSearchQuery,
            sortField: playlistTrackSortField,
            sortDirection: playlistTrackSortDirection,
            limit: PLAYLIST_TRACK_PAGE_SIZE,
            offset,
          });
          const items = page?.items ?? [];
          if (typeof page?.total === 'number' && Number.isFinite(page.total)) {
            total = Math.max(0, Math.floor(page.total));
          }
          if (items.length === 0) {
            break;
          }
          for (const item of items) {
            indexes.push(item.playlistIndex);
          }
          offset += items.length;
          if (items.length < PLAYLIST_TRACK_PAGE_SIZE) {
            break;
          }
        }
        setSelectedTrackIndexes(Array.from(new Set(indexes)).sort((left, right) => left - right));
      })().catch((error) => {
        telemetry.warn('playlists.track.batch-select-all.failed', {
          message: readTelemetryErrorMessage(error),
          fields: {
            playlistId: selectedPlaylist.id,
            searchQueryLength: playlistTrackSearchQuery.trim().length,
            sortField: playlistTrackSortField,
            sortDirection: playlistTrackSortDirection,
          },
        });
      });
      return;
    }

    setSelectedTrackIndexes((previous) => {
      const next = new Set(previous);
      for (const index of filteredPlaylistTrackIndexes) {
        next.add(index);
      }
      return Array.from(next).sort((left, right) => left - right);
    });
  };

  const handleClearTrackSelection = () => {
    setSelectedTrackIndexes([]);
  };

  const handleBatchAddToQueue = () => {
    if (selectedPlaylistTrackIndexes.length === 0) {
      return;
    }
    if (selectedPlaylist?.id && audioService.addPlaylistTrackIndexesToQueue) {
      void audioService
        .addPlaylistTrackIndexesToQueue(selectedPlaylist.id, selectedPlaylistTrackIndexes)
        .catch((error) => {
          telemetry.error('playlists.track.batch-add-to-queue.failed', {
            message: readTelemetryErrorMessage(error),
            fields: {
              playlistId: selectedPlaylist.id,
              selectedTrackCount: selectedPlaylistTrackIndexes.length,
            },
          });
        });
      return;
    }

    audioService.addMultipleToQueue(
      selectedPlaylistTrackIndexes
        .map((index) => selectedPlaylistTracks[index])
        .filter((track): track is Track => Boolean(track))
    );
  };

  const handleBatchRemoveFromPlaylist = () => {
    if (!selectedPlaylist || selectedPlaylistTrackIndexes.length === 0 || selectedPlaylistReadonly) {
      return;
    }

    const sortedIndexes = [...selectedPlaylistTrackIndexes].sort((left, right) => right - left);

    for (const index of sortedIndexes) {
      audioService.removeTrackFromPlaylist(selectedPlaylist.id, index);
    }

    setSelectedTrackIndexes([]);
  };

  const handleOpenPlaylistActionsMenu = (
    event: React.MouseEvent<HTMLButtonElement>,
    playlist: Playlist
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const readonly = isReadonlyPlaylist(playlist);
    const buttonRect = event.currentTarget.getBoundingClientRect();

    setTrackContextMenu(null);
    setPlaylistActionsMenu({
      x: buttonRect.right - 8,
      y: buttonRect.bottom + 8,
      items: [
        {
          label: t('common.action.rename'),
          disabled: readonly,
          onClick: () => {
            setPlaylistToRenameId(playlist.id);
            setShowRenameDialog(true);
          },
        },
        { divider: true },
        {
          label: t('common.action.clear'),
          disabled: readonly || playlist.trackCount === 0,
          onClick: () => {
            setPlaylistToClear(playlist.id);
            setShowClearConfirm(true);
          },
        },
        {
          label: t('pages.playlists.action.deletePlaylist'),
          danger: true,
          disabled: readonly,
          onClick: () => {
            setPlaylistToDelete(playlist.id);
            setShowDeleteConfirm(true);
          },
        },
      ],
    });
  };

  const handleTrackContextMenu = (
    playlist: Playlist,
    track: Track,
    trackIndex: number,
    event: React.MouseEvent
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const playlistReadonly = isReadonlyPlaylist(playlist);
    const menuItems = buildPlaylistTrackContextMenu({
      t,
      track,
      playlists,
      excludePlaylistId: playlist.id,
      onPlay: () => handlePlayTrackFromPlaylist(playlist, trackIndex),
      onAddToQueue: () => audioService.addToQueue(track),
      onAddToPlaylist: (playlistId, trackToAdd) => {
        audioService.addTrackToPlaylist(playlistId, trackToAdd);
      },
      removeFromPlaylistLabel: t('pages.playlists.tracks.action.removeFromPlaylist.title'),
      removeFromPlaylistDisabled: playlistReadonly,
      onRemoveFromPlaylist: () => handleRemoveTrackFromPlaylist(playlist.id, trackIndex),
    });

    setTrackContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: menuItems,
    });
    setPlaylistActionsMenu(null);
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="playlists-overlay" onClick={onClose}>
      <div className="playlists-container" onClick={(event) => event.stopPropagation()}>
        <div className="playlists-sidebar">
          <div className="playlists-sidebar-header">
            <h3 className="playlists-sidebar-title">{t('pages.playlists.sidebar.title')}</h3>
            <button className="playlists-create-btn" onClick={() => setShowCreateDialog(true)}>
              +
            </button>
          </div>

          <div
            className="playlists-list"
            ref={playlistListRef}
            onScroll={handlePlaylistListScroll}
          >
            {playlists.length === 0 ? (
              <div className="playlists-empty">
                <div className="playlists-empty-icon">{PLAYLIST_FALLBACK_GLYPH}</div>
                <div className="playlists-empty-text">{t('pages.playlists.empty.title')}</div>
                <button className="playlists-empty-btn" onClick={() => setShowCreateDialog(true)}>
                  {t('pages.playlists.empty.action.createFirst')}
                </button>
              </div>
            ) : (
              <>
                {playlistVirtualWindow.topSpacerPx > 0 ? (
                  <div
                    className="playlists-list-spacer"
                    style={{ height: `${playlistVirtualWindow.topSpacerPx}px` }}
                    aria-hidden="true"
                  />
                ) : null}
                {virtualizedSidebarPlaylists.map((playlist) => {
                const coverUrl = resolveDisplayPlaylistCoverUrl(playlist);
                return (
                  <div
                    key={playlist.id}
                    className={`playlists-item ${selectedPlaylistId === playlist.id ? 'playlists-item-active' : ''}`}
                    onClick={() => setSelectedPlaylistId(playlist.id)}
                    style={{ height: `${PLAYLIST_LIST_VIRTUAL_ROW_HEIGHT}px`, marginBottom: 0 }}
                  >
                    <div className="playlists-item-icon">
                      <PlaylistCoverImage
                        key={coverUrl || 'fallback'}
                        className="playlists-item-cover-image"
                        fallbackClassName="playlists-item-cover-fallback"
                        src={coverUrl}
                        alt={playlist.name}
                        fetchPriority="low"
                        onDecoded={reportPlaylistCoverDecoded}
                        onError={reportPlaylistCoverError}
                      />
                    </div>
                    <div className="playlists-item-info">
                      <div className="playlists-item-name-row">
                        <div className="playlists-item-name">{playlist.name}</div>
                        {renderPlaylistSourceBadge(playlist, 'playlists-item-source-badge')}
                      </div>
                      <div className="playlists-item-count">
                        {t('pages.playlists.trackCount', { count: playlist.trackCount })}
                      </div>
                    </div>
                  </div>
                );
                })}
                {playlistVirtualWindow.bottomSpacerPx > 0 ? (
                  <div
                    className="playlists-list-spacer"
                    style={{ height: `${playlistVirtualWindow.bottomSpacerPx}px` }}
                    aria-hidden="true"
                  />
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="playlists-detail">
          <div className="playlists-detail-header">
            {!selectedPlaylist ? (
              <h2 className="playlists-detail-title">{t('pages.playlists.detail.title')}</h2>
            ) : null}
            <button className="playlists-close-btn" onClick={onClose}>
              {PLAYLIST_CLOSE_GLYPH}
            </button>
          </div>

          {selectedPlaylist ? (
            <>
              <div className="playlists-hero">
                <div className="playlists-hero-cover-column">
                  <div className="playlists-hero-cover">
                    <PlaylistCoverImage
                      key={`${selectedPlaylist.id}:${selectedPlaylistCoverUrl || 'fallback'}`}
                      src={selectedPlaylistCoverUrl}
                      alt={selectedPlaylist.name}
                      className="playlists-hero-cover-image"
                      fallbackClassName="playlists-hero-cover-fallback"
                      fetchPriority="high"
                      onDecoded={reportPlaylistCoverDecoded}
                      onError={reportPlaylistCoverError}
                    />
                  </div>

                </div>

                <div className="playlists-hero-main">
                  <div className="playlists-hero-title-row">
                    <h2 className="playlists-hero-title">{selectedPlaylist.name}</h2>
                    {renderPlaylistSourceBadge(selectedPlaylist, 'playlists-detail-source-badge')}
                  </div>

                  <div className="playlists-hero-meta">
                    <span className="playlists-hero-stat">
                      <strong>{selectedPlaylist.trackCount}</strong> {t('pages.playlists.trackCount.unit')}
                    </span>
                    <span className="playlists-hero-stat">
                      <strong>{formatTotalDuration(selectedPlaylist.totalDuration)}</strong>
                    </span>
                  </div>

                  <div className="playlists-hero-actions">
                    <button
                      className="playlists-hero-btn playlists-hero-btn-primary"
                      onClick={() => handlePlayPlaylist(selectedPlaylist.id)}
                      disabled={selectedPlaylist.trackCount === 0}
                    >
                      {t('common.action.play')}
                    </button>
                    <button
                      className="playlists-hero-btn"
                      onClick={() => handleAddPlaylistToQueue(selectedPlaylist.id)}
                      disabled={selectedPlaylist.trackCount === 0}
                    >
                      {t('common.action.addToQueue')}
                    </button>
                    {!selectedPlaylistReadonly ? (
                      <button
                        className="playlists-hero-btn playlists-hero-btn-more"
                        onClick={(event) => handleOpenPlaylistActionsMenu(event, selectedPlaylist)}
                      >
                        {t('pages.playlists.action.more')}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="playlists-tracks">
                {selectedPlaylist.trackCount === 0 ? (
                  <div className="playlists-tracks-empty">
                    <div className="playlists-tracks-empty-icon">{PLAYLIST_FALLBACK_GLYPH}</div>
                    <div className="playlists-tracks-empty-text">{t('pages.playlists.tracks.empty.title')}</div>
                  </div>
                ) : (
                  <>
                    <div className="playlists-tracks-manage-row">
                      {playlistBatchMode ? (
                        <div className="playlists-tracks-batch-actions playlists-tracks-batch-actions-inline">
                          <span
                            className="playlists-tracks-batch-count playlists-tracks-batch-count-badge"
                            title={t('pages.playlists.manage.batch.selectedCount', {
                              count: selectedTrackCount,
                            })}
                          >
                            <svg
                              className="playlists-tracks-batch-count-icon"
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                            >
                              <path
                                d="M12 4.5a7.5 7.5 0 1 0 7.5 7.5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                              />
                              <path
                                d="M12 4.5v3.2M9.9 6.1l2.1 1.6"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                              />
                            </svg>
                            <strong>{selectedTrackCount}</strong>
                          </span>
                          <button
                            className="playlists-tracks-batch-icon-btn"
                            onClick={handleSelectAllFilteredTracks}
                            disabled={filteredPlaylistTrackCount === 0}
                            title={t('pages.playlists.manage.batch.selectAll')}
                            aria-label={t('pages.playlists.manage.batch.selectAll')}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path
                                d="M6.8 12.3l3.2 3.1 7-7"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.9"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <rect
                                x="4"
                                y="4"
                                width="16"
                                height="16"
                                rx="4"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                              />
                            </svg>
                          </button>
                          <button
                            className="playlists-tracks-batch-icon-btn"
                            onClick={handleClearTrackSelection}
                            disabled={selectedTrackCount === 0}
                            title={t('pages.playlists.manage.batch.clearSelection')}
                            aria-label={t('pages.playlists.manage.batch.clearSelection')}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path
                                d="M6.2 6.2l11.6 11.6"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.9"
                                strokeLinecap="round"
                              />
                              <circle
                                cx="12"
                                cy="12"
                                r="8"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.6"
                              />
                            </svg>
                          </button>
                          <button
                            className="playlists-tracks-batch-icon-btn"
                            onClick={handleBatchAddToQueue}
                            disabled={selectedTrackCount === 0}
                            title={t('pages.playlists.manage.batch.addToQueue')}
                            aria-label={t('pages.playlists.manage.batch.addToQueue')}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path
                                d="M5 8.5h10M5 12h10M5 15.5h7"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                              />
                              <path
                                d="M16.5 14.2v5.3M13.9 16.8h5.2"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                              />
                            </svg>
                          </button>
                          <button
                            className="playlists-tracks-batch-icon-btn playlists-tracks-batch-icon-btn-danger"
                            onClick={handleBatchRemoveFromPlaylist}
                            disabled={selectedPlaylistReadonly || selectedTrackCount === 0}
                            title={t('pages.playlists.manage.batch.removeFromPlaylist')}
                            aria-label={t('pages.playlists.manage.batch.removeFromPlaylist')}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path
                                d="M7 7.5h10M9.1 7.5l.6-1.7h4.6l.6 1.7M9.4 10.3v6.2M12 10.3v6.2M14.6 10.3v6.2M8.4 7.5l.6 10.7h6l.6-10.7"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                        </div>
                      ) : null}

                      <div className="playlists-tracks-manage">
                        <div
                          className={`playlists-tracks-search-control ${
                            showPlaylistTrackSearch ? 'is-expanded' : ''
                          }`}
                          ref={playlistTrackSearchControlRef}
                        >
                          <button
                            className={`playlists-tracks-icon-btn ${showPlaylistTrackSearch ? 'is-active' : ''}`}
                            onClick={handleTogglePlaylistTrackSearch}
                            title={t('pages.playlists.manage.search.placeholder')}
                          >
                            <svg className="playlists-tracks-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                              <circle
                                cx="11"
                                cy="11"
                                r="6.5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                              />
                              <path
                                d="M16.2 16.2L20 20"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                              />
                            </svg>
                          </button>

                          <div
                            className={`playlists-tracks-search-inline-wrap ${
                              showPlaylistTrackSearch ? 'is-expanded' : ''
                            }`}
                          >
                            <input
                              ref={playlistTrackSearchInputRef}
                              className="playlists-tracks-search-inline"
                              type="text"
                              value={playlistTrackSearchQuery}
                              onChange={(event) => setPlaylistTrackSearchQuery(event.target.value)}
                              placeholder={t('pages.playlists.manage.search.placeholder')}
                            />
                          </div>
                        </div>

                        <span className="playlists-tracks-icon-divider" />

                        <div className="playlists-tracks-sort-menu" ref={sortMenuRef}>
                          <button
                            ref={sortMenuTriggerRef}
                            className={`playlists-tracks-icon-btn ${showSortMenu ? 'is-active' : ''}`}
                            onClick={() => setShowSortMenu((previous) => !previous)}
                            title={currentSortOptionLabel}
                          >
                            <svg className="playlists-tracks-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                              <path
                                d="M8 6v12M8 6l-2.2 2.2M8 6l2.2 2.2M16 18V6M16 18l-2.2-2.2M16 18l2.2-2.2"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>

                          {showSortMenu ? (
                            <div className="playlists-tracks-sort-dropdown">
                              {playlistSortOptions.map((option) => {
                                const isActive = option.field === playlistTrackSortField;
                                return (
                                  <button
                                    key={option.field}
                                    className={`playlists-tracks-sort-option ${
                                      isActive ? 'is-active' : ''
                                    }`}
                                    onClick={() => handleSelectPlaylistSortField(option.field)}
                                  >
                                    <span>{option.label}</span>
                                    {isActive && option.field !== 'default' ? (
                                      <span className="playlists-tracks-sort-option-direction">
                                        <svg
                                          className="playlists-tracks-sort-option-arrow"
                                          viewBox="0 0 24 24"
                                          aria-hidden="true"
                                        >
                                          <path
                                            d={
                                              playlistTrackSortDirection === 'asc'
                                                ? 'M12 7l4.8 6H7.2L12 7z'
                                                : 'M12 17l-4.8-6h9.6L12 17z'
                                            }
                                            fill="currentColor"
                                          />
                                        </svg>
                                      </span>
                                    ) : null}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>

                        <span className="playlists-tracks-icon-divider" />

                        <button
                          className={`playlists-tracks-icon-btn ${playlistBatchMode ? 'is-active' : ''}`}
                          onClick={() => {
                            setPlaylistBatchMode((previous) => {
                              const next = !previous;
                              if (!next) {
                                setSelectedTrackIndexes([]);
                              }
                              return next;
                            });
                          }}
                          title={
                            playlistBatchMode
                              ? t('pages.playlists.manage.batch.exit')
                              : t('pages.playlists.manage.batch.enter')
                          }
                        >
                          <svg className="playlists-tracks-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              d="M6 7h12M6 12h9M6 17h12"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {shouldShowSelectedPlaylistTracksLoading ? (
                      <div className="playlists-tracks-empty playlists-tracks-empty-query">
                        <div className="playlists-tracks-empty-text">
                          {t('common.state.loading')}
                        </div>
                      </div>
                    ) : filteredPlaylistTrackCount === 0 ? (
                      <div className="playlists-tracks-empty playlists-tracks-empty-query">
                        <div className="playlists-tracks-empty-text">
                          {t('pages.playlists.tracks.empty.searchResult')}
                        </div>
                      </div>
                    ) : (
                      <div
                        ref={playlistTrackListRef}
                        className="playlists-tracks-list-viewport"
                        onScroll={(event) => {
                          setPlaylistTrackListScrollTop(event.currentTarget.scrollTop);
                        }}
                      >
                        {playlistTrackRenderWindow.topSpacerPx > 0 ? (
                          <div
                            className="playlists-track-spacer"
                            style={{ height: `${playlistTrackRenderWindow.topSpacerPx}px` }}
                            aria-hidden="true"
                          />
                        ) : null}
                        {playlistTrackRenderWindow.items.map((item) => {
                          const { playlistIndex, track } = item;
                          const trackKey = makeTrackKey(track, playlistIndex);
                          const isSelected = selectedTrackIndexSet.has(playlistIndex);

                          return (
                            <div
                              key={trackKey}
                              className={`playlists-track ${playlistBatchMode ? 'playlists-track-batch-selectable' : ''} ${isSelected ? 'playlists-track-selected' : ''}`}
                              onContextMenu={(event) =>
                                handleTrackContextMenu(selectedPlaylist, track, playlistIndex, event)
                              }
                              onDoubleClick={() => {
                                if (playlistBatchMode) {
                                  return;
                                }
                                handlePlayTrackFromPlaylist(selectedPlaylist, playlistIndex);
                              }}
                              onClick={() => {
                                if (!playlistBatchMode) {
                                  return;
                                }
                                handleToggleTrackSelection(playlistIndex, !isSelected);
                              }}
                            >
                              <div className="playlists-track-number">
                                {String(playlistIndex + 1).padStart(2, '0')}
                              </div>
                              <div className="playlists-track-title">{track.title}</div>
                              <div className="playlists-track-artist">{track.artist || '-'}</div>
                              <div className="playlists-track-album">{track.album || '-'}</div>
                              <div className="playlists-track-duration">
                                {track.duration ? formatDuration(track.duration) : '-'}
                              </div>
                              <div className="playlists-track-actions">
                                <button
                                  className="playlists-track-action-btn playlists-track-play"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handlePlayTrackFromPlaylist(selectedPlaylist, playlistIndex);
                                  }}
                                  title={t('common.action.play')}
                                >
                                  {PLAYLIST_PLAY_GLYPH}
                                </button>
                                <button
                                  className="playlists-track-action-btn playlists-track-remove"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleRemoveTrackFromPlaylist(selectedPlaylist.id, playlistIndex);
                                  }}
                                  disabled={selectedPlaylistReadonly}
                                  title={t('pages.playlists.tracks.action.removeFromPlaylist.title')}
                                >
                                  {PLAYLIST_CLOSE_GLYPH}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        {playlistTrackRenderWindow.bottomSpacerPx > 0 ? (
                          <div
                            className="playlists-track-spacer"
                            style={{ height: `${playlistTrackRenderWindow.bottomSpacerPx}px` }}
                            aria-hidden="true"
                          />
                        ) : null}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="playlists-no-selection">
              <div className="playlists-no-selection-icon">{PLAYLIST_FALLBACK_GLYPH}</div>
              <div className="playlists-no-selection-text">
                {playlists.length === 0
                  ? t('pages.playlists.noSelection.noPlaylists')
                  : t('pages.playlists.noSelection.selectPlaylist')}
              </div>
            </div>
          )}
        </div>

        <InputDialog
          isOpen={showCreateDialog}
          title={t('pages.playlists.dialog.create.title')}
          placeholder={t('pages.playlists.dialog.create.placeholder')}
          confirmText={t('common.action.create')}
          onConfirm={handleCreatePlaylist}
          onCancel={() => setShowCreateDialog(false)}
        />

        <InputDialog
          isOpen={showRenameDialog}
          title={t('pages.playlists.dialog.rename.title')}
          defaultValue={
            (playlistToRenameId
              ? playlists.find((playlist) => playlist.id === playlistToRenameId)?.name
              : '') || ''
          }
          placeholder={t('pages.playlists.dialog.rename.placeholder')}
          confirmText={t('common.action.ok')}
          onConfirm={handleRenamePlaylist}
          onCancel={() => {
            setShowRenameDialog(false);
            setPlaylistToRenameId(null);
          }}
        />

        <ConfirmDialog
          isOpen={showDeleteConfirm}
          title={t('pages.playlists.dialog.delete.title')}
          message={t('pages.playlists.dialog.delete.message')}
          confirmText={t('common.action.delete')}
          cancelText={t('common.action.cancel')}
          confirmButtonStyle="danger"
          onConfirm={handleDeletePlaylist}
          onCancel={() => {
            setShowDeleteConfirm(false);
            setPlaylistToDelete(null);
          }}
        />

        <ConfirmDialog
          isOpen={showClearConfirm}
          title={t('pages.playlists.dialog.clear.title')}
          message={t('pages.playlists.dialog.clear.message')}
          confirmText={t('common.action.clear')}
          cancelText={t('common.action.cancel')}
          confirmButtonStyle="danger"
          onConfirm={handleClearPlaylist}
          onCancel={() => {
            setShowClearConfirm(false);
            setPlaylistToClear(null);
          }}
        />

        {playlistActionsMenu ? (
          <ContextMenu
            x={playlistActionsMenu.x}
            y={playlistActionsMenu.y}
            items={playlistActionsMenu.items}
            onClose={() => setPlaylistActionsMenu(null)}
          />
        ) : null}

        {trackContextMenu ? (
          <ContextMenu
            x={trackContextMenu.x}
            y={trackContextMenu.y}
            items={trackContextMenu.items}
            onClose={() => setTrackContextMenu(null)}
          />
        ) : null}
      </div>
    </div>,
    document.body
  );
};
