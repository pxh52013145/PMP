import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Track } from '../../services/audio';
import {
  musicLibraryService,
  LibraryStats,
  ScanProgress,
  ViewMode,
  LibraryPath,
  LibraryPathHealth,
  AlbumSummary,
  CoverRuntimeCachePolicy,
} from '../../services/audio/MusicLibraryService';
import { ConfirmDialog } from '../magnet/ConfirmDialog';
import { ContextMenu, ContextMenuItem } from '../magnet/ContextMenu';
import { useNavigation } from '../../contexts/NavigationContext';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { useLocale, useT } from '../../i18n';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import './MusicLibrary.css';

interface MusicLibraryProps {
  isOpen?: boolean;
  onClose?: () => void;
  onAddToQueue?: (tracks: Track[]) => void;
  onPlayNow?: (tracks: Track[], startIndex?: number) => void;
  embedded?: boolean; // 閺勵垰鎯佸畵灞藉弳濡€崇础閿涘牆婀狽avigationPage娑擃叏绱?
}

// 閴?濡€虫健缁狙呯处鐎涙﹫绱扮捄銊х矋娴犺泛鐤勬笟瀣彙娴滎偓绱濇稉宥勭窗閸ョ姳璐熺紒鍕閸楁瓕娴囬懓灞兼丢婢?
type ModuleCacheSnapshot = {
  tracks: Track[];
  artists: string[];
  albums: AlbumSummary[];
  genres: string[];
  trackNextOffset: number;
  hasMoreTracks: boolean;
  timestamp: number;
};

let moduleCache: ModuleCacheSnapshot | null = null;

// ? 濡€虫健缁狙勭泊閸斻劋缍呯純顔剧处鐎涙﹫绱伴幐?viewMode 鐠佹澘绻傛稉缁樼泊閸斻劍娼担宥囩枂娑撳酣鏁嬮悙鐧哥礄鐠恒劑銆夐棃銏ｇ儲鏉?缂佸嫪娆㈤崡姝屾祰娣囨繃瀵旈敍?
type MainScrollAnchor =
  | { kind: 'track'; id: string; offset: number }
  | { kind: 'album'; key: string; offset: number };

type MainScrollRootKind = 'main' | 'navigation';
type MainScrollMemory = { scrollTop: number; anchor?: MainScrollAnchor; rootKind?: MainScrollRootKind };

type ViewScrollMemory = Partial<Record<ViewMode, MainScrollMemory>>;
const moduleScrollMemory: ViewScrollMemory = {};
let moduleLastViewMode: ViewMode | null = null;

type SidebarViewMode = Extract<ViewMode, 'artists' | 'genres'>;

type SidebarScrollAnchor =
  | { kind: 'artist'; key: string; offset: number }
  | { kind: 'genre'; key: string; offset: number };

type SidebarScrollMemory = { scrollTop: number; anchor?: SidebarScrollAnchor };

type SidebarViewScrollMemory = Partial<Record<SidebarViewMode, SidebarScrollMemory>>;
const moduleSidebarScrollMemory: SidebarViewScrollMemory = {};

type MainViewportSnapshot = {
  scrollTop: number;
  clientHeight: number;
  clientWidth: number;
};

const CACHE_DURATION = 5 * 60 * 1000; // 5閸掑棝鎸撶紓鎾崇摠
const INITIAL_TRACK_LOAD_LIMIT = 180;
const TRACK_LOAD_CHUNK_SIZE = 120;
const TRACK_RENDER_CHUNK_SIZE = 160;
const TRACK_SCROLL_LOAD_TRIGGER_PX = 320;
const MODULE_CACHE_TRACK_CAP = 300;
const TRACK_TEXT_MAX_CHARS = 200;
const TRACK_TEXT_INTERN_POOL_MAX = 4096;
const SEARCH_DEBOUNCE_MS = 180;
const TRACK_ROW_HEIGHT_PX = 46;
const TRACK_LIST_HEADER_HEIGHT_PX = 52;
const TRACK_WINDOW_OVERSCAN_ROWS = 20;
const ALBUM_CARD_MIN_WIDTH_PX = 150;
const ALBUM_GRID_GAP_PX = 15;
const ALBUM_CARD_VERTICAL_EXTRA_PX = 72;
const ALBUM_WINDOW_OVERSCAN_ROWS = 3;

const trackTextInternPool = new Map<string, string>();

function trimTracksForModuleCache(tracks: Track[]): Track[] {
  if (tracks.length <= MODULE_CACHE_TRACK_CAP) return tracks;
  return tracks.slice(0, MODULE_CACHE_TRACK_CAP);
}

function buildModuleCacheSnapshot(input: {
  tracks: Track[];
  artists: string[];
  albums: AlbumSummary[];
  genres: string[];
  trackNextOffset: number;
  hasMoreTracks: boolean;
  normalizeForIncrementalLoad?: boolean;
}): ModuleCacheSnapshot {
  const trimmedTracks = trimTracksForModuleCache(input.tracks);
  const normalizedOffset = Math.min(
    Math.max(0, Number.isFinite(input.trackNextOffset) ? Math.floor(input.trackNextOffset) : 0),
    trimmedTracks.length
  );
  const normalizedHasMore = input.normalizeForIncrementalLoad
    ? input.hasMoreTracks || input.trackNextOffset > trimmedTracks.length
    : input.hasMoreTracks;

  return {
    tracks: trimmedTracks,
    artists: input.artists,
    albums: input.albums,
    genres: input.genres,
    trackNextOffset: normalizedOffset,
    hasMoreTracks: normalizedHasMore,
    timestamp: Date.now(),
  };
}

function trimTrackText(value: unknown, maxChars: number = TRACK_TEXT_MAX_CHARS): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
}

function internTrackText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const existing = trackTextInternPool.get(value);
  if (existing) return existing;
  trackTextInternPool.set(value, value);
  if (trackTextInternPool.size > TRACK_TEXT_INTERN_POOL_MAX) {
    const oldestKey = trackTextInternPool.keys().next().value as string | undefined;
    if (oldestKey) trackTextInternPool.delete(oldestKey);
  }
  return value;
}

function compactTrackForLibrary(track: Track): Track {
  const safePath = typeof track.filePath === 'string' && track.filePath ? track.filePath : track.path;
  const normalizedCoverUrl = typeof track.coverUrl === 'string' ? track.coverUrl.trim() : '';
  const normalizedCoverLower = normalizedCoverUrl.toLowerCase();
  const safeCoverUrl =
    normalizedCoverLower.startsWith('blob:') ||
    normalizedCoverLower.startsWith('http://') ||
    normalizedCoverLower.startsWith('https://') ||
    normalizedCoverLower.startsWith('pmp://cover/')
      ? normalizedCoverUrl
      : undefined;
  const safeTitle = internTrackText(trimTrackText(track.title) || track.id) || track.id;
  const safeArtist = internTrackText(trimTrackText(track.artist));
  const safeAlbum = internTrackText(trimTrackText(track.album));
  const safeGenre = internTrackText(trimTrackText(track.genre));
  const safeCoverKey = internTrackText(trimTrackText(track.coverKey, 256));
  const safeOriginalPath = internTrackText(trimTrackText(track.originalPath, 512));
  const safeQuickFingerprint = internTrackText(trimTrackText(track.quickFingerprint, 80));

  return {
    id: track.id,
    title: safeTitle,
    artist: safeArtist,
    album: safeAlbum,
    genre: safeGenre,
    duration: typeof track.duration === 'number' ? track.duration : undefined,
    year: typeof track.year === 'number' ? track.year : undefined,
    filePath: typeof safePath === 'string' && safePath ? safePath : track.filePath,
    path: safePath,
    originalPath: safeOriginalPath,
    fileHandle: safePath ? undefined : track.fileHandle,
    coverKey: safeCoverKey,
    coverUrl: safeCoverUrl,
    quickFingerprint: safeQuickFingerprint,
    replayGainTrackGainDb:
      typeof track.replayGainTrackGainDb === 'number' ? track.replayGainTrackGainDb : undefined,
    replayGainAlbumGainDb:
      typeof track.replayGainAlbumGainDb === 'number' ? track.replayGainAlbumGainDb : undefined,
  };
}

function compactTracksForLibrary(tracks: Track[]): Track[] {
  if (tracks.length === 0) return tracks;
  return tracks.map(compactTrackForLibrary);
}

// 濞撳懘娅庡Ο鈥虫健缂傛挸鐡?
export function clearModuleCache() {
  moduleCache = null;
}

function albumKey(album: string, artist: string): string {
  return `${album}::${artist}`;
}

export const MusicLibrary: React.FC<MusicLibraryProps> = ({
  isOpen = true,
  onClose,
  onAddToQueue,
  onPlayNow,
  embedded = false,
}) => {
  const audioService = useAudioService();
  const { navigateTo } = useNavigation();
  const t = useT();
  const locale = useLocale();
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return moduleLastViewMode ?? (isTauriRuntime() ? 'all' : 'albums');
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [artists, setArtists] = useState<string[]>([]);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [libraryStats, setLibraryStats] = useState<LibraryStats>({
    totalTracks: 0,
    totalArtists: 0,
    totalAlbums: 0,
    totalSize: 0,
    totalDuration: 0,
  });
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [libraryPaths, setLibraryPaths] = useState<LibraryPath[]>([]);
  const [libraryPathHealthMap, setLibraryPathHealthMap] = useState<Record<string, LibraryPathHealth>>(
    {}
  );
  const [isLibraryPathHealthLoading, setIsLibraryPathHealthLoading] = useState(false);
  const [isLibraryPathHealthAvailable, setIsLibraryPathHealthAvailable] = useState(true);
  const [pathCleanupBusyMap, setPathCleanupBusyMap] = useState<Record<string, boolean>>({});
  const [isCleanupAllMissingBusy, setIsCleanupAllMissingBusy] = useState(false);
  const [showPathsManager, setShowPathsManager] = useState(false);
  const [hasMoreTracks, setHasMoreTracks] = useState(false);
  const [isTrackChunkLoading, setIsTrackChunkLoading] = useState(false);
  const [renderedTrackLimit, setRenderedTrackLimit] = useState(TRACK_RENDER_CHUNK_SIZE);
  const trackNextOffsetRef = useRef(0);
  const trackChunkLoadingRef = useRef(false);
  const searchTokenRef = useRef(0);
  const searchDebounceTimerRef = useRef<number | null>(null);
  const libraryLoadTokenRef = useRef(0);
  const [mainViewport, setMainViewport] = useState<MainViewportSnapshot>({
    scrollTop: 0,
    clientHeight: 0,
    clientWidth: 0,
  });
  const facetLoadingRef = useRef<{ artists: boolean; albums: boolean; genres: boolean }>({
    artists: false,
    albums: false,
    genres: false,
  });
  const currentCoverPolicyRef = useRef<CoverRuntimeCachePolicy>('default');
  const requestedAlbumCoversRef = useRef<Set<string>>(new Set());
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const sidebarScrollRef = useRef<HTMLDivElement | null>(null);
  const albumCardElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const albumCardRefCallbacksRef = useRef<Map<string, (el: HTMLDivElement | null) => void>>(
    new Map()
  );
  const albumCoverObserverRef = useRef<IntersectionObserver | null>(null);
  const albumCoverQueueRef = useRef<string[]>([]);
  const albumCoverInFlightRef = useRef<number>(0);
  const albumCoverDrainRafRef = useRef<number | null>(null);
  const albumInfoByKeyRef = useRef<Map<string, AlbumSummary>>(new Map());
  const albumCoverGenerationRef = useRef<number>(0);
  const albumOffscreenReclaimTimerRef = useRef<number | null>(null);

  const beginAudioProtection = useCallback(
    (reason: string, durationMs: number = 20_000): (() => void) => {
      return audioService.enterProtectionWindow?.({ reason, durationMs }) ?? (() => {});
    },
    [audioService]
  );

  const bumpAudioProtection = useCallback(
    (reason: string, durationMs: number = 20_000) => {
      const release = beginAudioProtection(reason, durationMs);
      release();
    },
    [beginAudioProtection]
  );

  // ? 鐠佹澘绻傚姘З娴ｅ秶鐤嗛敍姘瘻 viewMode 缂佸瓨濮㈡稉缁樼泊閸斻劍娼?scrollTop + 闁挎氨鍋ｉ敍宀勪缉閸忓秷娉曟い鐢告桨/閸掑洦宕?tab 娑撱垹銇戞担宥囩枂
  const isRestoringMainScrollRef = useRef(false);
  const mainScrollUserDirtyRef = useRef(false);
  const mainScrollAnchorDebounceRef = useRef<number | null>(null);
  const mainScrollRestoreStateRef = useRef<{ viewMode: ViewMode | null; done: boolean }>({
    viewMode: null,
    done: false,
  });

  const escapeCssSelector = useCallback((value: string): string => {
    const css = (globalThis as unknown as { CSS?: { escape?: (text: string) => string } }).CSS;
    if (css?.escape) return css.escape(value);
    return value.replace(/["\\]/g, '\\$&');
  }, []);

  const getMainScrollRoot = useCallback(
    (preferred?: MainScrollRootKind): HTMLElement | null => {
      const main = mainScrollRef.current;
      if (!main) return null;

      const navigationContent =
        typeof main.closest === 'function'
          ? main.closest<HTMLElement>('.navigation-content')
          : null;

      const isScrollable = (element: HTMLElement): boolean =>
        element.scrollHeight > element.clientHeight + 1;

      // If one of the roots is already scrolled, treat that as the active scroll root.
      if (navigationContent && navigationContent.scrollTop > 0) return navigationContent;
      if (main.scrollTop > 0) return main;

      if (preferred === 'navigation' && navigationContent && isScrollable(navigationContent)) {
        return navigationContent;
      }
      if (preferred === 'main' && isScrollable(main)) {
        return main;
      }

      if (isScrollable(main)) return main;
      if (navigationContent && isScrollable(navigationContent)) return navigationContent;

      return main;
    },
    []
  );

  const syncMainViewport = useCallback((root: HTMLElement | null) => {
    if (!root) return;
    const next: MainViewportSnapshot = {
      scrollTop: root.scrollTop,
      clientHeight: root.clientHeight,
      clientWidth: root.clientWidth,
    };

    setMainViewport((prev) => {
      if (
        prev.scrollTop === next.scrollTop &&
        prev.clientHeight === next.clientHeight &&
        prev.clientWidth === next.clientWidth
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const computeMainScrollAnchor = useCallback(
    (root: HTMLElement, mode: ViewMode): MainScrollAnchor | null => {
      const rootRect = root.getBoundingClientRect();

      const findFirstVisible = (selector: string): HTMLElement | null => {
        const elements = Array.from(root.querySelectorAll<HTMLElement>(selector));
        for (const element of elements) {
          const rect = element.getBoundingClientRect();
          if (rect.bottom <= rootRect.top) continue;
          return element;
        }
        return null;
      };

      if (mode === 'albums') {
        const element = findFirstVisible('.music-library-album-card[data-album-key]');
        const key = element?.getAttribute('data-album-key')?.trim();
        if (!element || !key) return null;
        const rect = element.getBoundingClientRect();
        return { kind: 'album', key, offset: rect.top - rootRect.top };
      }

      const element = findFirstVisible('.music-library-track[data-track-id]');
      const id = element?.getAttribute('data-track-id')?.trim();
      if (!element || !id) return null;
      const rect = element.getBoundingClientRect();
      return { kind: 'track', id, offset: rect.top - rootRect.top };
    },
    []
  );

  const captureMainScrollMemory = useCallback(
    (mode: ViewMode) => {
      const root = getMainScrollRoot();
      if (!root) return;

      const memory: MainScrollMemory = {
        scrollTop: root.scrollTop,
      };
      const main = mainScrollRef.current;
      const navigationContent = main?.closest<HTMLElement>('.navigation-content') ?? null;
      memory.rootKind = navigationContent && root === navigationContent ? 'navigation' : 'main';

      const anchor = computeMainScrollAnchor(root, mode);
      if (anchor) memory.anchor = anchor;

      moduleScrollMemory[mode] = memory;
    },
    [computeMainScrollAnchor, getMainScrollRoot]
  );

  const scheduleMainScrollAnchorUpdate = useCallback(
    (mode: ViewMode) => {
      if (typeof window === 'undefined') return;
      if (mainScrollAnchorDebounceRef.current !== null) {
        window.clearTimeout(mainScrollAnchorDebounceRef.current);
      }

      mainScrollAnchorDebounceRef.current = window.setTimeout(() => {
        mainScrollAnchorDebounceRef.current = null;

        const root = getMainScrollRoot(moduleScrollMemory[mode]?.rootKind);
        if (!root) return;

        const anchor = computeMainScrollAnchor(root, mode);
        if (!anchor) return;

        const previous = moduleScrollMemory[mode];
        moduleScrollMemory[mode] = {
          ...(previous ?? { scrollTop: root.scrollTop }),
          scrollTop: root.scrollTop,
          anchor,
        };
      }, 140);
    },
    [computeMainScrollAnchor, getMainScrollRoot]
  );

  useEffect(() => {
    return () => {
      if (typeof window === 'undefined') return;
      if (mainScrollAnchorDebounceRef.current !== null) {
        window.clearTimeout(mainScrollAnchorDebounceRef.current);
        mainScrollAnchorDebounceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    moduleLastViewMode = viewMode;
  }, [viewMode]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    return () => {
      const root = getMainScrollRoot(moduleScrollMemory[viewMode]?.rootKind);
      const currentScrollTop = root?.scrollTop ?? 0;
      const existing = moduleScrollMemory[viewMode];

      // When the Music Library unmounts, the shared `.navigation-content` container can reset its
      // scroll position to 0 before this cleanup runs. Avoid overwriting a previously recorded
      // non-zero scroll memory with that transient reset.
      if (existing && existing.scrollTop > 0 && currentScrollTop === 0) {
        return;
      }

      if (!existing) {
        if (currentScrollTop > 0) captureMainScrollMemory(viewMode);
        return;
      }

      if (mainScrollUserDirtyRef.current && currentScrollTop > 0) {
        captureMainScrollMemory(viewMode);
        return;
      }

      if (currentScrollTop > 0 && existing.scrollTop !== currentScrollTop) {
        captureMainScrollMemory(viewMode);
      }
    };
  }, [captureMainScrollMemory, getMainScrollRoot, isOpen, viewMode]);

  // ? Artists/Genres sidebar: 閻欘剛鐝涘姘З鐠佹澘绻傞敍鍫ユ晪閻愮懓绱￠幁銏狀槻閿?
  const isRestoringSidebarScrollRef = useRef(false);
  const sidebarScrollUserDirtyRef = useRef(false);
  const sidebarScrollRestoreStateRef = useRef<{ viewMode: SidebarViewMode | null; done: boolean }>({
    viewMode: null,
    done: false,
  });

  const getSidebarScrollRoot = useCallback((): HTMLElement | null => {
    return sidebarScrollRef.current;
  }, []);

  const computeSidebarScrollAnchor = useCallback(
    (root: HTMLElement, mode: SidebarViewMode): SidebarScrollAnchor | null => {
      const rootRect = root.getBoundingClientRect();
      const selector =
        mode === 'artists'
          ? '.music-library-sidebar-item[data-artist-name]'
          : '.music-library-sidebar-item[data-genre-name]';

      const elements = Array.from(root.querySelectorAll<HTMLElement>(selector));
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        if (rect.bottom <= rootRect.top) continue;
        if (mode === 'artists') {
          const key = element.getAttribute('data-artist-name')?.trim();
          if (!key) return null;
          return { kind: 'artist', key, offset: rect.top - rootRect.top };
        }
        const key = element.getAttribute('data-genre-name')?.trim();
        if (!key) return null;
        return { kind: 'genre', key, offset: rect.top - rootRect.top };
      }
      return null;
    },
    []
  );

  const captureSidebarScrollMemory = useCallback(
    (mode: ViewMode) => {
      if (mode !== 'artists' && mode !== 'genres') return;
      const root = getSidebarScrollRoot();
      if (!root) return;

      const memory: SidebarScrollMemory = {
        scrollTop: root.scrollTop,
      };

      const anchor = computeSidebarScrollAnchor(root, mode);
      if (anchor) memory.anchor = anchor;

      moduleSidebarScrollMemory[mode] = memory;
    },
    [computeSidebarScrollAnchor, getSidebarScrollRoot]
  );

  const handleSidebarScroll = useCallback(() => {
    if (isRestoringSidebarScrollRef.current) return;
    if (viewMode !== 'artists' && viewMode !== 'genres') return;
    const root = getSidebarScrollRoot();
    if (!root) return;
    sidebarScrollUserDirtyRef.current = true;

    const previous = moduleSidebarScrollMemory[viewMode];
    moduleSidebarScrollMemory[viewMode] = {
      ...(previous ?? { scrollTop: 0 }),
      scrollTop: root.scrollTop,
    };
  }, [getSidebarScrollRoot, viewMode]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    if (viewMode !== 'artists' && viewMode !== 'genres') return;
    const root = getSidebarScrollRoot();
    if (!root) return;

    if (sidebarScrollRestoreStateRef.current.viewMode !== viewMode) {
      sidebarScrollRestoreStateRef.current = { viewMode, done: false };
      sidebarScrollUserDirtyRef.current = false;
    }

    if (sidebarScrollRestoreStateRef.current.done) return;

    const memory = moduleSidebarScrollMemory[viewMode];
    const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);

    const setScrollTop = (target: number) => {
      const clamped = Math.min(Math.max(0, target), maxScrollTop);
      if (root.scrollTop === clamped) return;
      isRestoringSidebarScrollRef.current = true;
      root.scrollTop = clamped;
      window.requestAnimationFrame(() => {
        isRestoringSidebarScrollRef.current = false;
      });
    };

    const tryRestoreFromScrollTop = (scrollTop: number): boolean => {
      setScrollTop(scrollTop);
      return scrollTop === 0 || scrollTop <= maxScrollTop;
    };

    if (!memory) {
      setScrollTop(0);
      sidebarScrollRestoreStateRef.current.done = true;
      return;
    }

    const anchor = memory.anchor;
    if (anchor) {
      const selector =
        viewMode === 'artists'
          ? `[data-artist-name="${escapeCssSelector(anchor.key)}"]`
          : `[data-genre-name="${escapeCssSelector(anchor.key)}"]`;
      const element = root.querySelector<HTMLElement>(selector);
      if (element) {
        const rootRect = root.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const elementTopInContent = elementRect.top - rootRect.top + root.scrollTop;
        const targetScrollTop = elementTopInContent - anchor.offset;
        setScrollTop(targetScrollTop);
        sidebarScrollRestoreStateRef.current.done = true;
        return;
      }
    }

    if (tryRestoreFromScrollTop(memory.scrollTop)) {
      sidebarScrollRestoreStateRef.current.done = true;
    }
  }, [
    artists.length,
    escapeCssSelector,
    genres.length,
    getSidebarScrollRoot,
    isOpen,
    viewMode,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    return () => {
      if (viewMode !== 'artists' && viewMode !== 'genres') return;
      const root = getSidebarScrollRoot();
      const currentScrollTop = root?.scrollTop ?? 0;
      const existing = moduleSidebarScrollMemory[viewMode];
      const shouldCapture =
        sidebarScrollUserDirtyRef.current ||
        !existing ||
        (currentScrollTop > 0 && existing.scrollTop !== currentScrollTop);

      if (shouldCapture) captureSidebarScrollMemory(viewMode);
    };
  }, [captureSidebarScrollMemory, getSidebarScrollRoot, isOpen, viewMode]);

  // 閹烘帒绨悩鑸碘偓?
  const [sortBy, setSortBy] = useState<
    'title' | 'artist' | 'album' | 'duration' | 'year' | 'default'
  >('default');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // 閸欐娊鏁懣婊冨礋閻樿埖鈧?
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  const updateCoverRuntimePolicy = useCallback((policy: CoverRuntimeCachePolicy) => {
    if (currentCoverPolicyRef.current === policy) return;
    currentCoverPolicyRef.current = policy;
    musicLibraryService.applyCoverRuntimeCachePolicy(policy);
  }, []);

  const loadFacetCollections = useCallback(
    async (mode: ViewMode, trackSource?: Track[]) => {
      if (mode === 'artists') {
        if (artists.length > 0 || facetLoadingRef.current.artists) return;
        facetLoadingRef.current.artists = true;
        try {
          if (trackSource && trackSource.length > 0) {
            const uniqueArtists = Array.from(
              new Set(trackSource.map((track) => track.artist).filter(Boolean))
            ).sort();
            setArtists(uniqueArtists as string[]);
            return;
          }
          setArtists(await musicLibraryService.getAllArtists());
        } catch (error) {
          console.warn('[MusicLibrary] Failed to load artists facet:', error);
        } finally {
          facetLoadingRef.current.artists = false;
        }
        return;
      }

      if (mode === 'genres') {
        if (genres.length > 0 || facetLoadingRef.current.genres) return;
        facetLoadingRef.current.genres = true;
        try {
          if (trackSource && trackSource.length > 0) {
            const uniqueGenres = Array.from(
              new Set(trackSource.map((track) => track.genre).filter(Boolean))
            ).sort();
            setGenres(uniqueGenres as string[]);
            return;
          }
          setGenres(await musicLibraryService.getAllGenres());
        } catch (error) {
          console.warn('[MusicLibrary] Failed to load genres facet:', error);
        } finally {
          facetLoadingRef.current.genres = false;
        }
        return;
      }

      if (mode === 'albums') {
        if (albums.length > 0 || facetLoadingRef.current.albums) return;
        facetLoadingRef.current.albums = true;
        try {
          if (trackSource && trackSource.length > 0) {
            const albumMap = new Map<string, AlbumSummary>();
            for (const track of trackSource) {
              if (!track.album) continue;
              const artist = track.artist || t('common.unknown.artist');
              const key = albumKey(track.album, artist);
              if (albumMap.has(key)) continue;

              albumMap.set(key, {
                album: track.album,
                artist,
                cover:
                  typeof track.coverUrl === 'string' &&
                  (track.coverUrl.startsWith('blob:') ||
                    track.coverUrl.startsWith('data:') ||
                    track.coverUrl.startsWith('http://') ||
                    track.coverUrl.startsWith('https://'))
                    ? track.coverUrl
                    : undefined,
                coverTrackPath: track.filePath || track.path,
                coverTrackId: track.id,
              });
            }
            setAlbums(Array.from(albumMap.values()));
            return;
          }
          setAlbums(await musicLibraryService.getAllAlbums({ includeStoredCover: false }));
        } catch (error) {
          console.warn('[MusicLibrary] Failed to load albums facet:', error);
        } finally {
          facetLoadingRef.current.albums = false;
        }
      }
    },
    [albums.length, artists.length, genres.length, t]
  );

  const scheduleTrackChunkLoad = useCallback(async (): Promise<boolean> => {
    if (trackChunkLoadingRef.current) return false;
    if (!hasMoreTracks) return false;
    const offset = trackNextOffsetRef.current;
    if (!Number.isFinite(offset) || offset < 0) return false;

    trackChunkLoadingRef.current = true;
    setIsTrackChunkLoading(true);
    const releaseProtection = beginAudioProtection('music-library-track-chunk', 18_000);

    try {
      const nextChunk = await musicLibraryService.getAllTracks(TRACK_LOAD_CHUNK_SIZE, offset);
      if (nextChunk.length === 0) {
        setHasMoreTracks(false);
        return false;
      }

      const compactChunk = compactTracksForLibrary(nextChunk);
      const chunkHasMore = nextChunk.length >= TRACK_LOAD_CHUNK_SIZE;

      trackNextOffsetRef.current = offset + nextChunk.length;
      setTracks((prev) => {
        const merged = [...prev, ...compactChunk];
        if (moduleCache) {
          moduleCache = buildModuleCacheSnapshot({
            tracks: merged,
            artists: moduleCache.artists,
            albums: moduleCache.albums,
            genres: moduleCache.genres,
            trackNextOffset: trackNextOffsetRef.current,
            hasMoreTracks: chunkHasMore,
            normalizeForIncrementalLoad: true,
          });
        }
        return merged;
      });

      if (!chunkHasMore) {
        setHasMoreTracks(false);
      }

      return true;
    } catch (error) {
      console.warn('[MusicLibrary] Failed to load next track chunk:', error);
      setHasMoreTracks(false);
      return false;
    } finally {
      trackChunkLoadingRef.current = false;
      setIsTrackChunkLoading(false);
      releaseProtection();
    }
  }, [beginAudioProtection, hasMoreTracks]);

  const maybeLoadTrackChunkFromScroll = useCallback(() => {
    if (!hasMoreTracks) return;
    const root = getMainScrollRoot();
    if (!root) return;
    const remaining = root.scrollHeight - (root.scrollTop + root.clientHeight);
    if (remaining <= TRACK_SCROLL_LOAD_TRIGGER_PX) {
      void scheduleTrackChunkLoad();
    }
  }, [getMainScrollRoot, hasMoreTracks, scheduleTrackChunkLoad]);

  const handleMainScroll = useCallback(() => {
    const root = getMainScrollRoot(moduleScrollMemory[viewMode]?.rootKind);
    if (!root) return;

    if (isRestoringMainScrollRef.current) {
      syncMainViewport(root);
      return;
    }

    mainScrollUserDirtyRef.current = true;

    const previous = moduleScrollMemory[viewMode];
    moduleScrollMemory[viewMode] = {
      ...(previous ?? { scrollTop: 0 }),
      scrollTop: root.scrollTop,
      rootKind:
        (() => {
          const main = mainScrollRef.current;
          const navigationContent = main?.closest<HTMLElement>('.navigation-content') ?? null;
          return navigationContent && root === navigationContent ? 'navigation' : 'main';
        })(),
    };

    if (viewMode !== 'albums') {
      const remaining = root.scrollHeight - (root.scrollTop + root.clientHeight);
      if (remaining <= TRACK_SCROLL_LOAD_TRIGGER_PX) {
        setRenderedTrackLimit((prev) => prev + TRACK_RENDER_CHUNK_SIZE);
      }
      maybeLoadTrackChunkFromScroll();
    }

    syncMainViewport(root);
    scheduleMainScrollAnchorUpdate(viewMode);
  }, [
    getMainScrollRoot,
    maybeLoadTrackChunkFromScroll,
    scheduleMainScrollAnchorUpdate,
    syncMainViewport,
    viewMode,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const main = mainScrollRef.current;
    if (!main) return;

    const navigationContent = main.closest<HTMLElement>('.navigation-content');
    const handler = () => handleMainScroll();

    main.addEventListener('scroll', handler, { passive: true });
    navigationContent?.addEventListener('scroll', handler, { passive: true });

    return () => {
      main.removeEventListener('scroll', handler);
      navigationContent?.removeEventListener('scroll', handler);
    };
  }, [handleMainScroll, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const refreshViewport = () => {
      const root = getMainScrollRoot(moduleScrollMemory[viewMode]?.rootKind);
      syncMainViewport(root);
    };

    refreshViewport();
    window.addEventListener('resize', refreshViewport);

    return () => {
      window.removeEventListener('resize', refreshViewport);
    };
  }, [albums.length, getMainScrollRoot, isOpen, syncMainViewport, tracks.length, viewMode]);

  // 鍒囨崲瑙嗗浘妯″紡鏃舵竻闄ょ瓫閫夌姸鎬?
  const handleViewModeChange = (
    newMode: ViewMode,
    options?: { artist?: string; genre?: string }
  ) => {
    captureMainScrollMemory(viewMode);
    captureSidebarScrollMemory(viewMode);
    moduleLastViewMode = newMode;
    setViewMode(newMode);
    // 濞撳懘娅庨幍鈧張澶岀摣闁娼禒璁圭礉鐠佲晜鐦℃稉顏囶潒閸ュ墽瀚粩?
    setSelectedArtist(options?.artist || null);
    setSelectedAlbum(null);
    setSelectedGenre(options?.genre || null);
  };

  // 閸旂姾娴囨惔鎾存殶閹?
  const loadLibraryData = useCallback(async () => {
    const token = ++libraryLoadTokenRef.current;
    console.log('Loading library data...');
    const releaseProtection = beginAudioProtection('music-library-load', 25_000);

    // 閴?缁斿宓嗛弰鍓с仛濡€虫健缂傛挸鐡ㄩ弫鐗堝祦閿涘牆顩ч弸婊勬箒閺佸牞绱?
    const now = Date.now();
    if (moduleCache && now - moduleCache.timestamp < CACHE_DURATION) {
      console.log('Using module cache for instant display');
      setTracks(moduleCache.tracks);
      setArtists(moduleCache.artists);
      requestedAlbumCoversRef.current.clear();
      setAlbums(moduleCache.albums);
      setGenres(moduleCache.genres);
      trackNextOffsetRef.current = moduleCache.trackNextOffset;
      setHasMoreTracks(moduleCache.hasMoreTracks);
      setRenderedTrackLimit(TRACK_RENDER_CHUNK_SIZE);
      updateCoverRuntimePolicy(viewMode === 'albums' ? 'watch' : 'high');

      if (viewMode === 'albums' || viewMode === 'artists' || viewMode === 'genres') {
        void loadFacetCollections(viewMode, moduleCache.tracks);
      }

      // 閸︺劌鎮楅崣鏉跨磽濮濄儲娲块弬鎵埠鐠佲€蹭繆閹?
      musicLibraryService.getLibraryStats().then((stats) => {
        if (token !== libraryLoadTokenRef.current) return;
        setLibraryStats(stats);
      });
      return; // 閴?閻╁瓨甯存潻鏂挎礀閿涘奔绗夐柌宥嗘煀閸旂姾娴?
    }

    // 濞屸剝婀佺紓鎾崇摠閹存牜绱︾€涙绻冮張鐕傜礉娴?IndexedDB 閸旂姾娴?
    console.log('Loading from IndexedDB...');

    try {
      // 閴?娴兼ê瀵查敍姘辨纯閹恒儱濮炴潪鑺ユ殶閹诡噯绱濋梽鎰煑娑?1000 妫ｆ牭绱欓柆鍨帳闁插秴顦茬拠璇插絿閿?
      const initialTracks = await musicLibraryService.getAllTracks(INITIAL_TRACK_LOAD_LIMIT);

      if (token !== libraryLoadTokenRef.current) return;

      const compactInitialTracks = compactTracksForLibrary(initialTracks);
      const hasMore = compactInitialTracks.length >= INITIAL_TRACK_LOAD_LIMIT;
      trackNextOffsetRef.current = initialTracks.length;
      setHasMoreTracks(hasMore);
      setRenderedTrackLimit(TRACK_RENDER_CHUNK_SIZE);
      updateCoverRuntimePolicy(viewMode === 'albums' ? 'watch' : 'high');

      console.log('Library data loaded:', {
        tracks: compactInitialTracks.length,
      });

      // 閺囧瓨鏌婇弰鍓с仛閺佺増宓侀崪灞灸侀崸妤冪处鐎?
      moduleCache = buildModuleCacheSnapshot({
        tracks: compactInitialTracks,
        artists: [],
        albums: [],
        genres: [],
        trackNextOffset: trackNextOffsetRef.current,
        hasMoreTracks: hasMore,
        normalizeForIncrementalLoad: true,
      });

      setTracks(compactInitialTracks);
      setArtists([]);
      requestedAlbumCoversRef.current.clear();
      setAlbums([]);
      setGenres([]);
      facetLoadingRef.current = { artists: false, albums: false, genres: false };

      if (viewMode === 'albums' || viewMode === 'artists' || viewMode === 'genres') {
        void loadFacetCollections(viewMode, compactInitialTracks);
      }

      // 閸︺劌鎮楅崣鏉跨磽濮濄儴顓哥粻妤冪埠鐠佲€蹭繆閹垽绱欐稉宥夋▎婵夋拷I閿?
      musicLibraryService.getLibraryStats().then((stats) => {
        if (token !== libraryLoadTokenRef.current) return;
        setLibraryStats(stats);
        console.log('Library stats loaded:', stats);
      });
    } catch (error) {
      console.error('Failed to load library data:', error);
      setHasMoreTracks(false);
    } finally {
      releaseProtection();
    }
  }, [beginAudioProtection, loadFacetCollections, updateCoverRuntimePolicy, viewMode]);

  // 閸旂姾娴囨惔鎾圭熅瀵?
  const loadLibraryPathHealth = useCallback(async () => {
    if (!isTauriRuntime()) {
      setLibraryPathHealthMap({});
      setIsLibraryPathHealthAvailable(false);
      return;
    }

    setIsLibraryPathHealthLoading(true);
    try {
      const healthRows = await musicLibraryService.getLibraryPathHealth();
      if (!healthRows) {
        setLibraryPathHealthMap({});
        setIsLibraryPathHealthAvailable(false);
        return;
      }

      const nextMap: Record<string, LibraryPathHealth> = {};
      for (const row of healthRows) {
        if (!row.sourceId) continue;
        nextMap[row.sourceId] = row;
      }
      setLibraryPathHealthMap(nextMap);
      setIsLibraryPathHealthAvailable(true);
    } catch (error) {
      console.warn('Failed to load library path health:', error);
      setLibraryPathHealthMap({});
      setIsLibraryPathHealthAvailable(false);
    } finally {
      setIsLibraryPathHealthLoading(false);
    }
  }, []);

  const loadLibraryPaths = useCallback(async () => {
    try {
      const paths = await musicLibraryService.getLibraryPaths();
      setLibraryPaths(paths);
      if (showPathsManager) {
        void loadLibraryPathHealth();
      }
      return paths;
    } catch (error) {
      console.error('Failed to load library paths:', error);
      return [];
    }
  }, [loadLibraryPathHealth, showPathsManager]);

  const resetLibraryDataFromStorage = useCallback(async () => {
    clearModuleCache();
    await loadLibraryData();
  }, [loadLibraryData]);

  useEffect(() => {
    if (!isOpen) return;
    updateCoverRuntimePolicy(viewMode === 'albums' ? 'watch' : 'high');
    void loadLibraryData();
  }, [isOpen, loadLibraryData, updateCoverRuntimePolicy, viewMode]);

  useEffect(() => {
    if (!isOpen) return;
    void loadLibraryPaths();
  }, [isOpen, loadLibraryPaths]);

  useEffect(() => {
    if (!showPathsManager) return;
    void loadLibraryPathHealth();
  }, [loadLibraryPathHealth, showPathsManager]);

  useEffect(() => {
    if (!isOpen) {
      updateCoverRuntimePolicy('hidden');
      return;
    }
    return () => {
      updateCoverRuntimePolicy('hidden');
    };
  }, [isOpen, updateCoverRuntimePolicy]);

  // 鐠併垽妲勯幍顐ｅ伎鏉╂稑瀹?
  useEffect(() => {
    const unsubscribe = musicLibraryService.onScanProgress((progress) => {
      console.log('Scan progress:', progress);
      setScanProgress(progress);

      // 閹殿偅寮跨€瑰本鍨氶崥搴ゅ殰閸斻劌鍩涢弬鐗堟殶閹诡喖鎷扮捄顖氱窞閸掓銆?
      if (!progress.isScanning && progress.current > 0) {
        console.log('Scan completed, refreshing library...');
        clearModuleCache(); // 閴?濞撳懘娅庣紓鎾崇摠
        // 瀵ゆ儼绻滄稉鈧悙鍦€樻穱婵囨殶閹诡喖鍟撻崗銉ョ暚閹?
        setTimeout(() => {
          Promise.all([
            loadLibraryData(),
            loadLibraryPaths(), // 閸氬本妞傞崚閿嬫煀鐠侯垰绶為崚妤勩€?
          ]);
        }, 300); // 閸戝繐鐨鎯扮箿閸?300ms
      }
    });
    return unsubscribe;
  }, [loadLibraryData, loadLibraryPaths]);

  useEffect(() => {
    const map = new Map<string, AlbumSummary>();
    for (const a of albums) {
      map.set(albumKey(a.album, a.artist), a);
    }
    albumInfoByKeyRef.current = map;
  }, [albums]);

  useEffect(() => {
    if (!isOpen) return;
    if (viewMode === 'albums') {
      updateCoverRuntimePolicy('watch');
      return;
    }

    if (searchQuery.trim()) {
      updateCoverRuntimePolicy('high');
      return;
    }

    updateCoverRuntimePolicy(hasMoreTracks ? 'watch' : 'high');
  }, [hasMoreTracks, isOpen, searchQuery, updateCoverRuntimePolicy, viewMode]);

  useEffect(() => {
    if (!isOpen) return;
    if (searchQuery.trim()) return;
    if (viewMode !== 'albums' && viewMode !== 'artists' && viewMode !== 'genres') return;
    void loadFacetCollections(viewMode, tracks);
  }, [isOpen, loadFacetCollections, searchQuery, tracks, viewMode]);

  const getAlbumCardRef = useCallback((key: string) => {
    const existing = albumCardRefCallbacksRef.current.get(key);
    if (existing) return existing;

    const cb = (el: HTMLDivElement | null) => {
      const previousEl = albumCardElementsRef.current.get(key);
      if (previousEl && previousEl !== el) {
        albumCoverObserverRef.current?.unobserve(previousEl);
      }

      if (el) {
        albumCardElementsRef.current.set(key, el);
        albumCoverObserverRef.current?.observe(el);
      } else {
        albumCardElementsRef.current.delete(key);
      }
    };

    albumCardRefCallbacksRef.current.set(key, cb);
    return cb;
  }, []);

  // Desktop/Tauri: 娑撴捁绶亸渚€娼伴幊鎺戝鏉炴枻绱橧ntersectionObserver + 楠炶泛褰傞梼鐔峰灙閿?
  useEffect(() => {
    if (!isOpen) return;
    if (!isTauriRuntime()) return;
    if (viewMode !== 'albums') return;
    if (typeof IntersectionObserver === 'undefined') return;

    const root = mainScrollRef.current;
    if (!root) return;

    const generation = (albumCoverGenerationRef.current += 1);
    let disposed = false;

    albumCoverQueueRef.current = [];
    albumCoverInFlightRef.current = 0;

    const maxConcurrency = searchQuery.trim() ? 2 : hasMoreTracks ? 2 : 3;
    const rootMargin = searchQuery.trim() ? '220px 0px' : hasMoreTracks ? '280px 0px' : '360px 0px';

    function scheduleDrain() {
      if (disposed) return;
      if (albumCoverDrainRafRef.current != null) return;
      albumCoverDrainRafRef.current = window.requestAnimationFrame(() => {
        albumCoverDrainRafRef.current = null;
        drainQueue();
      });
    }

    async function loadCoverForAlbumKey(key: string) {
      const info = albumInfoByKeyRef.current.get(key);
      if (!info || info.cover || !info.coverTrackPath) return;

      const stub: Track = {
        id: info.coverTrackId || `cover-${info.album}-${info.artist}`,
        title: info.album,
        album: info.album,
        artist: info.artist,
        filePath: info.coverTrackPath,
        path: info.coverTrackPath,
      };

      const url = await musicLibraryService.getCoverUrlForTrack(stub, { coverSizeHint: 'small' });
      if (!url) return;
      if (disposed) return;
      if (albumCoverGenerationRef.current !== generation) return;

      setAlbums((prev) =>
        prev.map((a) => (albumKey(a.album, a.artist) === key ? { ...a, cover: url } : a))
      );
    }

    function drainQueue() {
      if (disposed) return;

      while (albumCoverInFlightRef.current < maxConcurrency) {
        const nextKey = albumCoverQueueRef.current.shift();
        if (!nextKey) return;

        albumCoverInFlightRef.current += 1;
        void loadCoverForAlbumKey(nextKey)
          .catch(() => {})
          .finally(() => {
            albumCoverInFlightRef.current = Math.max(0, albumCoverInFlightRef.current - 1);
            scheduleDrain();
          });
      }
    }

    function enqueue(key: string) {
      if (disposed) return;
      if (requestedAlbumCoversRef.current.has(key)) return;

      const info = albumInfoByKeyRef.current.get(key);
      if (!info || info.cover || !info.coverTrackPath) return;

      requestedAlbumCoversRef.current.add(key);
      albumCoverQueueRef.current.push(key);
      scheduleDrain();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const key = (entry.target as HTMLElement).dataset.albumKey;
          if (!key) continue;
          enqueue(key);
        }
      },
      {
        root,
        rootMargin,
        threshold: 0.01,
      }
    );

    albumCoverObserverRef.current = observer;
    for (const el of albumCardElementsRef.current.values()) {
      observer.observe(el);
    }

    return () => {
      disposed = true;
      if (albumCoverDrainRafRef.current != null) {
        cancelAnimationFrame(albumCoverDrainRafRef.current);
        albumCoverDrainRafRef.current = null;
      }
      observer.disconnect();
      if (albumCoverObserverRef.current === observer) {
        albumCoverObserverRef.current = null;
      }
    };
  }, [hasMoreTracks, isOpen, searchQuery, viewMode]);

  // 婢跺嫮鎮婇弬鍥︽婢惰澹傞幓?
  const handleScanFolder = async () => {
    const releaseProtection = beginAudioProtection('music-library-scan', 90_000);
    try {
      console.log('Starting folder scan...');
      await musicLibraryService.scanFolder();
      console.log('Folder scan completed, refreshing library data...');
      // 閹殿偅寮跨€瑰本鍨氶崥搴㈢闂勩倗绱︾€涙ê鑻熼崚閿嬫煀閺佺増宓侀崪宀冪熅瀵板嫬鍨悰?
      clearModuleCache(); // 閴?濞撳懘娅庣紓鎾崇摠閿涘苯宸遍崚鍫曞櫢閺傛澘濮炴潪?
      await Promise.all([
        loadLibraryData(),
        loadLibraryPaths(), // 閸掗攱鏌婄捄顖氱窞閸掓銆?
      ]);
      console.log('Library data and paths refreshed');
      setErrorMessage(null);
    } catch (error) {
      console.error('Failed to scan folder:', error);
      setErrorMessage(
        t('pages.music-library.error.scanFolderFailed', {
          message: error instanceof Error ? error.message : String(error),
        })
      );
    } finally {
      releaseProtection();
    }
  };

  const handleCancelScan = async () => {
    try {
      await musicLibraryService.cancelCurrentScan();
    } catch (error) {
      console.error('Failed to cancel scan:', error);
    }
  };
  const handleClearLibrary = async () => {
    await musicLibraryService.clearLibrary();
    clearModuleCache();
    await loadLibraryData();
    setShowClearConfirm(false);
  };

  const handleSearch = useCallback(async (query: string) => {
    bumpAudioProtection('music-library-search', 20_000);
    const token = ++searchTokenRef.current;
    setRenderedTrackLimit(TRACK_RENDER_CHUNK_SIZE);

    if (query.trim()) {
      const results = await musicLibraryService.searchTracks(query, 600);
      if (token !== searchTokenRef.current) return;

      const compactResults = compactTracksForLibrary(results);
      setTracks(compactResults);
      trackNextOffsetRef.current = results.length;
      setHasMoreTracks(false);
      updateCoverRuntimePolicy(viewMode === 'albums' ? 'watch' : 'high');

      const uniqueArtists = Array.from(
        new Set(compactResults.map((track) => track.artist).filter(Boolean))
      );
      const uniqueGenres = Array.from(
        new Set(compactResults.map((track) => track.genre).filter(Boolean))
      );

      const albumMap = new Map<string, AlbumSummary>();
      compactResults.forEach((track) => {
        if (!track.album) return;

        const key = `${track.album}-${track.artist}`;
        if (albumMap.has(key)) return;

        albumMap.set(key, {
          album: track.album,
          artist: track.artist || t('common.unknown.artist'),
          cover:
            typeof track.coverUrl === 'string' &&
            (track.coverUrl.toLowerCase().startsWith('data:') ||
              track.coverUrl.toLowerCase().startsWith('blob:') ||
              track.coverUrl.toLowerCase().startsWith('http:') ||
              track.coverUrl.toLowerCase().startsWith('https:') ||
              track.coverUrl.toLowerCase().startsWith('pmp://cover/'))
              ? track.coverUrl
              : undefined,
          coverTrackPath: track.filePath || track.path,
          coverTrackId: track.id,
        });
      });

      const uniqueAlbums = Array.from(albumMap.values());

      setArtists(uniqueArtists as string[]);
      setGenres(uniqueGenres as string[]);
      requestedAlbumCoversRef.current.clear();
      setAlbums(uniqueAlbums);
      moduleCache = buildModuleCacheSnapshot({
        tracks: compactResults,
        artists: uniqueArtists as string[],
        albums: uniqueAlbums,
        genres: uniqueGenres as string[],
        trackNextOffset: trackNextOffsetRef.current,
        hasMoreTracks: false,
      });
    } else {
      await resetLibraryDataFromStorage();
      if (token !== searchTokenRef.current) return;
      updateCoverRuntimePolicy(viewMode === 'albums' ? 'watch' : 'high');
    }

    maybeLoadTrackChunkFromScroll();
  }, [
    bumpAudioProtection,
    maybeLoadTrackChunkFromScroll,
    resetLibraryDataFromStorage,
    updateCoverRuntimePolicy,
    viewMode,
    t,
  ]);

  const handleSearchInputChange = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (searchDebounceTimerRef.current != null) {
        window.clearTimeout(searchDebounceTimerRef.current);
      }
      searchDebounceTimerRef.current = window.setTimeout(() => {
        void handleSearch(query);
      }, SEARCH_DEBOUNCE_MS);
    },
    [handleSearch]
  );

  useEffect(() => {
    return () => {
      if (searchDebounceTimerRef.current != null) {
        window.clearTimeout(searchDebounceTimerRef.current);
        searchDebounceTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (viewMode === 'albums') return;
    if (searchQuery.trim()) return;
    maybeLoadTrackChunkFromScroll();
  }, [isOpen, maybeLoadTrackChunkFromScroll, searchQuery, viewMode, tracks.length]);

  // 閹烘帒绨径鍕倞閸戣姤鏆?
  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      // 婵″倹鐏夊鑼病閺勵垰缍嬮崜宥嗗笓鎼村繐鐡у▓纰夌礉閸掑洦宕查幒鎺戠碍閺傜懓鎮?
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // 閸掑洦宕查崚鐗堟煀閻ㄥ嫭甯撴惔蹇撶摟濞堢绱濇妯款吇閸楀洤绨?
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  // 鎼存梻鏁ら幒鎺戠碍閸掔増鏆熺紒?
  const applySorting = useCallback(<T extends Track | { album: string; artist: string }>(items: T[]): T[] => {
    if (sortBy === 'default') return items;

    const sorted = [...items];
    sorted.sort((a, b) => {
      let compareA: string | number = '';
      let compareB: string | number = '';

      // 閺嶈宓侀幒鎺戠碍鐎涙顔岄懢宄板絿濮ｆ棁绶濋崐?
      if ('title' in a && sortBy === 'title') {
        compareA = (a as Track).title?.toLowerCase() || '';
        compareB = (b as Track).title?.toLowerCase() || '';
      } else if (sortBy === 'artist') {
        compareA = ('artist' in a ? a.artist : '')?.toLowerCase() || '';
        compareB = ('artist' in b ? b.artist : '')?.toLowerCase() || '';
      } else if (sortBy === 'album') {
        compareA = ('album' in a ? a.album : '')?.toLowerCase() || '';
        compareB = ('album' in b ? b.album : '')?.toLowerCase() || '';
      } else if ('duration' in a && sortBy === 'duration') {
        compareA = (a as Track).duration || 0;
        compareB = (b as Track).duration || 0;
      } else if ('year' in a && sortBy === 'year') {
        compareA = (a as Track).year || 0;
        compareB = (b as Track).year || 0;
      } else {
        return 0;
      }

      // 濮ｆ棁绶?
      let result = 0;
      if (typeof compareA === 'string' && typeof compareB === 'string') {
        result = compareA.localeCompare(compareB);
      } else {
        result = Number(compareA) - Number(compareB);
      }

      // 鎼存梻鏁ら幒鎺戠碍閺傜懓鎮?
      return sortOrder === 'asc' ? result : -result;
    });

    return sorted;
  }, [sortBy, sortOrder]);

  // 閼惧嘲褰囨潻鍥ㄦ姢閸滃本甯撴惔蹇撴倵閻ㄥ嫯寤洪柆?
  const filteredTracks = useMemo(() => {
    let filtered = tracks;

    if (selectedArtist) {
      filtered = filtered.filter((t) => t.artist === selectedArtist);
    }
    if (selectedAlbum) {
      filtered = filtered.filter((t) => t.album === selectedAlbum);
    }
    if (selectedGenre) {
      filtered = filtered.filter((t) => t.genre === selectedGenre);
    }

    return applySorting(filtered);
  }, [applySorting, selectedAlbum, selectedArtist, selectedGenre, tracks]);

  // 閼惧嘲褰囬幒鎺戠碍閸氬海娈戞稉鎾圭帆閸掓銆?
  const sortedAlbums = useMemo(() => applySorting(albums), [albums, applySorting]);

  const filteredTracksTotal = filteredTracks.length;

  useEffect(() => {
    if (viewMode === 'albums') {
      setRenderedTrackLimit(filteredTracksTotal);
      return;
    }

    setRenderedTrackLimit((prev) => {
      if (!Number.isFinite(prev) || prev <= 0) {
        return Math.min(filteredTracksTotal, TRACK_RENDER_CHUNK_SIZE);
      }
      return Math.min(filteredTracksTotal, prev);
    });
  }, [filteredTracksTotal, viewMode]);

  const renderedTracks = useMemo(() => {
    if (renderedTrackLimit >= filteredTracks.length) return filteredTracks;
    return filteredTracks.slice(0, renderedTrackLimit);
  }, [filteredTracks, renderedTrackLimit]);

  const trackVirtualWindow = useMemo(() => {
    const viewportHeight = mainViewport.clientHeight > 0 ? mainViewport.clientHeight : 720;
    const effectiveScrollTop = Math.max(0, mainViewport.scrollTop - TRACK_LIST_HEADER_HEIGHT_PX);
    const visibleRows = Math.max(1, Math.ceil(viewportHeight / TRACK_ROW_HEIGHT_PX));
    const start = Math.max(
      0,
      Math.floor(effectiveScrollTop / TRACK_ROW_HEIGHT_PX) - TRACK_WINDOW_OVERSCAN_ROWS
    );
    const end = Math.min(
      renderedTracks.length,
      start + visibleRows + TRACK_WINDOW_OVERSCAN_ROWS * 2
    );

    return {
      start,
      end,
      topSpacerPx: start * TRACK_ROW_HEIGHT_PX,
      bottomSpacerPx: Math.max(0, (renderedTracks.length - end) * TRACK_ROW_HEIGHT_PX),
    };
  }, [mainViewport.clientHeight, mainViewport.scrollTop, renderedTracks.length]);

  const virtualizedTracks = useMemo(
    () => renderedTracks.slice(trackVirtualWindow.start, trackVirtualWindow.end),
    [renderedTracks, trackVirtualWindow.end, trackVirtualWindow.start]
  );

  const albumVirtualWindow = useMemo(() => {
    const viewportHeight = mainViewport.clientHeight > 0 ? mainViewport.clientHeight : 720;
    const contentWidth = Math.max(240, (mainViewport.clientWidth || 900) - 40);
    const columns = Math.max(
      1,
      Math.floor((contentWidth + ALBUM_GRID_GAP_PX) / (ALBUM_CARD_MIN_WIDTH_PX + ALBUM_GRID_GAP_PX))
    );
    const cardWidth =
      (contentWidth - (columns - 1) * ALBUM_GRID_GAP_PX) / Math.max(1, columns);
    const rowHeight = Math.max(180, cardWidth + ALBUM_CARD_VERTICAL_EXTRA_PX);
    const totalRows = Math.ceil(sortedAlbums.length / columns);
    const visibleRows = Math.max(1, Math.ceil(viewportHeight / rowHeight));
    const startRow = Math.max(
      0,
      Math.floor(mainViewport.scrollTop / rowHeight) - ALBUM_WINDOW_OVERSCAN_ROWS
    );
    const endRow = Math.min(
      totalRows,
      startRow + visibleRows + ALBUM_WINDOW_OVERSCAN_ROWS * 2
    );
    const start = Math.min(sortedAlbums.length, startRow * columns);
    const end = Math.min(sortedAlbums.length, endRow * columns);

    return {
      start,
      end,
      topSpacerPx: startRow * rowHeight,
      bottomSpacerPx: Math.max(0, (totalRows - endRow) * rowHeight),
    };
  }, [
    mainViewport.clientHeight,
    mainViewport.clientWidth,
    mainViewport.scrollTop,
    sortedAlbums.length,
  ]);

  const virtualizedAlbums = useMemo(
    () => sortedAlbums.slice(albumVirtualWindow.start, albumVirtualWindow.end),
    [albumVirtualWindow.end, albumVirtualWindow.start, sortedAlbums]
  );

  useEffect(() => {
    if (!isOpen) return;
    if (viewMode !== 'albums') {
      const releaseUrls: string[] = [];
      setAlbums((previousAlbums) => {
        let changed = false;
        const nextAlbums = previousAlbums.map((albumItem) => {
          if (!albumItem.cover) return albumItem;
          const coverUrl = albumItem.cover.trim();
          if (coverUrl) releaseUrls.push(coverUrl);
          changed = true;
          return { ...albumItem, cover: undefined };
        });
        return changed ? nextAlbums : previousAlbums;
      });

      requestedAlbumCoversRef.current.clear();
      if (releaseUrls.length > 0) {
        musicLibraryService.releaseCoverUrls(releaseUrls);
      }
      return;
    }

    if (albumOffscreenReclaimTimerRef.current != null) {
      window.clearTimeout(albumOffscreenReclaimTimerRef.current);
    }

    albumOffscreenReclaimTimerRef.current = window.setTimeout(() => {
      albumOffscreenReclaimTimerRef.current = null;

      const keepAlbumKeys = new Set<string>(
        virtualizedAlbums.map((albumItem) => albumKey(albumItem.album, albumItem.artist))
      );
      const releaseUrls: string[] = [];
      const droppedAlbumKeys: string[] = [];

      setAlbums((previousAlbums) => {
        let changed = false;
        const nextAlbums = previousAlbums.map((albumItem) => {
          if (!albumItem.cover) return albumItem;

          const key = albumKey(albumItem.album, albumItem.artist);
          if (keepAlbumKeys.has(key)) return albumItem;

          const coverUrl = albumItem.cover.trim();
          if (coverUrl) releaseUrls.push(coverUrl);
          droppedAlbumKeys.push(key);
          changed = true;
          return { ...albumItem, cover: undefined };
        });

        return changed ? nextAlbums : previousAlbums;
      });

      if (droppedAlbumKeys.length > 0) {
        for (const key of droppedAlbumKeys) {
          requestedAlbumCoversRef.current.delete(key);
        }
      }

      if (releaseUrls.length > 0) {
        musicLibraryService.releaseCoverUrls(releaseUrls);
      }
    }, 450);

    return () => {
      if (albumOffscreenReclaimTimerRef.current != null) {
        window.clearTimeout(albumOffscreenReclaimTimerRef.current);
        albumOffscreenReclaimTimerRef.current = null;
      }
    };
  }, [isOpen, viewMode, virtualizedAlbums]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    if (mainScrollRestoreStateRef.current.viewMode !== viewMode) {
      mainScrollRestoreStateRef.current = { viewMode, done: false };
      mainScrollUserDirtyRef.current = false;
    }

    if (mainScrollRestoreStateRef.current.done) return;

    const memory = moduleScrollMemory[viewMode];
    const root = getMainScrollRoot(memory?.rootKind);
    if (!root) return;
    const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);

    if (viewMode !== 'albums' && memory) {
      const anchor = memory.anchor;
      if (anchor?.kind === 'track') {
        const anchorIndex = filteredTracks.findIndex((track) => track.id === anchor.id);
        if (anchorIndex >= 0) {
          const desiredLimit = Math.min(
            filteredTracks.length,
            Math.max(renderedTrackLimit, anchorIndex + TRACK_RENDER_CHUNK_SIZE)
          );
          if (desiredLimit > renderedTrackLimit) {
            setRenderedTrackLimit(desiredLimit);
            return;
          }
        } else if (hasMoreTracks) {
          void scheduleTrackChunkLoad();
          return;
        }
      }

      const desiredScrollTop = memory.scrollTop;
      if (
        desiredScrollTop > 0 &&
        desiredScrollTop > maxScrollTop + 1 &&
        (renderedTrackLimit < filteredTracks.length || hasMoreTracks)
      ) {
        if (renderedTrackLimit < filteredTracks.length) {
          setRenderedTrackLimit((prev) => {
            if (prev >= filteredTracks.length) return prev;
            return Math.min(filteredTracks.length, prev + TRACK_RENDER_CHUNK_SIZE);
          });
          return;
        }

        if (hasMoreTracks) {
          void scheduleTrackChunkLoad();
          return;
        }
      }
    }

    const setScrollTop = (target: number) => {
      const clamped = Math.min(Math.max(0, target), maxScrollTop);
      if (root.scrollTop === clamped) return;
      isRestoringMainScrollRef.current = true;
      root.scrollTop = clamped;
      window.requestAnimationFrame(() => {
        isRestoringMainScrollRef.current = false;
      });
    };

    const tryRestoreFromScrollTop = (scrollTop: number): boolean => {
      if (scrollTop !== 0 && scrollTop > maxScrollTop) {
        return false;
      }
      setScrollTop(scrollTop);
      return true;
    };

    if (!memory) {
      setScrollTop(0);
      mainScrollRestoreStateRef.current.done = true;
      return;
    }

    const anchor = memory.anchor;
    if (anchor) {
      if (anchor.kind === 'track') {
        const selector = `[data-track-id="${escapeCssSelector(anchor.id)}"]`;
        const element = root.querySelector<HTMLElement>(selector);
        if (element) {
          const rootRect = root.getBoundingClientRect();
          const elementRect = element.getBoundingClientRect();
          const elementTopInContent = elementRect.top - rootRect.top + root.scrollTop;
          const targetScrollTop = elementTopInContent - anchor.offset;
          setScrollTop(targetScrollTop);
          mainScrollRestoreStateRef.current.done = true;
          return;
        }
      } else if (anchor.kind === 'album') {
        const selector = `[data-album-key="${escapeCssSelector(anchor.key)}"]`;
        const element = root.querySelector<HTMLElement>(selector);
        if (element) {
          const rootRect = root.getBoundingClientRect();
          const elementRect = element.getBoundingClientRect();
          const elementTopInContent = elementRect.top - rootRect.top + root.scrollTop;
          const targetScrollTop = elementTopInContent - anchor.offset;
          setScrollTop(targetScrollTop);
          mainScrollRestoreStateRef.current.done = true;
          return;
        }
      }
    }

    if (tryRestoreFromScrollTop(memory.scrollTop)) {
      mainScrollRestoreStateRef.current.done = true;
    }
  }, [
    albums.length,
    artists.length,
    escapeCssSelector,
    filteredTracks,
    genres.length,
    getMainScrollRoot,
    hasMoreTracks,
    isOpen,
    libraryStats.totalTracks,
    renderedTrackLimit,
    scheduleTrackChunkLoad,
    tracks.length,
    viewMode,
  ]);

  // 閸楁洖鍤稉鎾圭帆 - 鐎佃壈鍩呴崚棰佺瑩鏉堟垼顕涢幆鍛淬€?
  const handleAlbumClick = (albumName: string, artist: string) => {
    if (embedded) {
      // 閸︹暋mbedded濡€崇础娑撳绱濈€佃壈鍩呴崚棰佺瑩鏉堟垿銆夐棃?
      navigateTo('album', { albumName, artist });
    }
  };

  // 閸欏苯鍤稉鎾圭帆 - 閹绢厽鏂佹稉鎾圭帆
  const handlePlayAlbum = async (album: string) => {
    if (!onPlayNow) {
      console.log('Play album:', album, '(embedded mode - no playback)');
      return;
    }
    const albumTracks = await musicLibraryService.getTracksByAlbum(album);
    if (albumTracks.length > 0) {
      onPlayNow(albumTracks);
    }
  };

  // 閹绢厽鏂侀懝鐑樻钩鐎?
  const handlePlayArtist = async (artist: string) => {
    if (!onPlayNow) {
      console.log('Play artist:', artist, '(embedded mode - no playback)');
      return;
    }
    const artistTracks = await musicLibraryService.getTracksByArtist(artist);
    if (artistTracks.length > 0) {
      onPlayNow(artistTracks);
    }
  };

  // 閸欏苯鍤灞炬锤閿涙碍鍧婇崝鐘冲閺堝绻冨銈呮倵閻ㄥ嫭鐡曢弴鎻掑煂闂冪喎鍨敍灞肩矤闁鑵戦惃鍕摃閺囨彃绱戞慨瀣尡閺€?
  const handleTrackDoubleClick = (track: Track, index: number) => {
    if (!onPlayNow) {
      console.log('Play track:', track.title, '(embedded mode - no playback)');
      return;
    }
    const originalIndex = filteredTracks.findIndex((candidate) => candidate.id === track.id);
    const startIndex = originalIndex >= 0 ? originalIndex : index;
    console.log(`[MusicLibrary] Playing from track ${startIndex + 1}/${filteredTracks.length}`);
    onPlayNow(filteredTracks, startIndex);
  };

  // 閸欘亝鎸遍弨鎯у礋妫ｆ牗鐡曢弴?
  const handlePlaySingleTrack = (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onPlayNow) {
      console.log('Play single track:', track.title, '(embedded mode - no playback)');
      return;
    }
    console.log('[MusicLibrary] Playing single track:', track.title);
    onPlayNow([track]);
  };

  // 閸欘亝鍧婇崝鐘插礋妫ｆ牗鐡曢弴鎻掑煂闂冪喎鍨?
  const handleAddSingleTrack = (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onAddToQueue) {
      console.log('Add track:', track.title, '(embedded mode - no queue)');
      return;
    }
    console.log('閴?Adding single track:', track.title);
    onAddToQueue([track]);
  };

  // 婢跺嫮鎮婂灞炬锤閸欐娊鏁懣婊冨礋
  const handleTrackContextMenu = (track: Track, index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const playTracks = filteredTracks;
    const playStartIndex = playTracks.findIndex((candidate) => candidate.id === track.id);

    const menuItems: ContextMenuItem[] = [
      {
        label: t('pages.music-library.contextMenu.play'),
        icon: '>',
        onClick: () => handlePlaySingleTrack(track, e),
      },
      {
        label: t('pages.music-library.contextMenu.addToQueue'),
        icon: '+',
        onClick: () => onAddToQueue?.([track]),
      },
      {
        label: t('pages.music-library.contextMenu.playAllFromHere'),
        icon: '>>',
        onClick: () => onPlayNow?.(playTracks, playStartIndex >= 0 ? playStartIndex : index),
      },
      { divider: true } as ContextMenuItem,
      {
        label: t('pages.music-library.contextMenu.viewAlbum'),
        icon: 'A',
        onClick: () => {
          if (track.album && embedded) {
            handleAlbumClick(track.album, track.artist || '');
          }
        },
        disabled: !track.album || !embedded,
      },
      {
        label: t('pages.music-library.contextMenu.viewArtist'),
        icon: 'R',
        onClick: () => {
          if (track.artist) {
            handleViewModeChange('artists', { artist: track.artist });
          }
        },
        disabled: !track.artist,
      },
    ];

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: menuItems,
    });
  };

  // 婢跺嫮鎮婃稉鎾圭帆閸欐娊鏁懣婊冨礋
  const handleAlbumContextMenu = (album: string, artist: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const menuItems: ContextMenuItem[] = [
      {
        label: t('pages.music-library.contextMenu.viewAlbum'),
        icon: 'A',
        onClick: () => handleAlbumClick(album, artist),
        disabled: !embedded,
      },
      {
        label: t('pages.music-library.contextMenu.playAlbum'),
        icon: '>',
        onClick: () => handlePlayAlbum(album),
      },
      {
        label: t('pages.music-library.contextMenu.addToQueue'),
        icon: '+',
        onClick: async () => {
          const albumTracks = await musicLibraryService.getTracksByAlbum(album);
          onAddToQueue?.(albumTracks);
        },
      },
      { divider: true } as ContextMenuItem,
      {
        label: t('pages.music-library.contextMenu.viewArtist'),
        icon: 'R',
        onClick: () => {
          handleViewModeChange('artists', { artist: artist });
        },
      },
    ];

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: menuItems,
    });
  };

  // 閺嶇厧绱￠崠鏍ㄦ瀮娴犺泛銇囩亸?
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  // 閺嶇厧绱￠崠鏍ㄦ闂€?
  const formatTotalDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return t('pages.music-library.duration.hoursMinutes', { hours, minutes });
    }
    return t('pages.music-library.duration.minutes', { minutes });
  };

  // 閺嶇厧绱￠崠鏍缓闁挻妞傞梹?
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const totalMissingTracks = useMemo(() => {
    return libraryPaths.reduce((sum, path) => {
      const health = libraryPathHealthMap[path.id];
      return sum + (health?.missingTracks ?? 0);
    }, 0);
  }, [libraryPathHealthMap, libraryPaths]);

  const handleCleanupMissingForPath = useCallback(
    async (pathId: string) => {
      const normalizedPathId = String(pathId || '').trim();
      if (!normalizedPathId) return;

      setPathCleanupBusyMap((prev) => ({
        ...prev,
        [normalizedPathId]: true,
      }));

      const releaseProtection = beginAudioProtection('music-library-cleanup-missing-path', 45_000);
      try {
        const deleted = await musicLibraryService.cleanupLibraryPathTracks(normalizedPathId, {
          missingOnly: true,
        });
        if (deleted > 0) {
          await Promise.all([loadLibraryPaths(), loadLibraryData()]);
        } else {
          await loadLibraryPathHealth();
        }
      } finally {
        setPathCleanupBusyMap((prev) => ({
          ...prev,
          [normalizedPathId]: false,
        }));
        releaseProtection();
      }
    },
    [beginAudioProtection, loadLibraryData, loadLibraryPathHealth, loadLibraryPaths]
  );

  const handleCleanupMissingForAllPaths = useCallback(async () => {
    if (totalMissingTracks <= 0) return;
    setIsCleanupAllMissingBusy(true);

    const releaseProtection = beginAudioProtection('music-library-cleanup-missing-all-paths', 120_000);
    try {
      let deletedTotal = 0;
      for (const path of libraryPaths) {
        const missingCount = libraryPathHealthMap[path.id]?.missingTracks ?? 0;
        if (missingCount <= 0) continue;
        const deleted = await musicLibraryService.cleanupLibraryPathTracks(path.id, { missingOnly: true });
        deletedTotal += deleted;
      }

      if (deletedTotal > 0) {
        await Promise.all([loadLibraryPaths(), loadLibraryData()]);
      } else {
        await loadLibraryPathHealth();
      }
    } finally {
      setIsCleanupAllMissingBusy(false);
      releaseProtection();
    }
  }, [
    beginAudioProtection,
    libraryPathHealthMap,
    libraryPaths,
    loadLibraryData,
    loadLibraryPathHealth,
    loadLibraryPaths,
    totalMissingTracks,
  ]);

  if (!isOpen) return null;

  const libraryContent = (
    <div className={`music-library ${embedded ? 'music-library-embedded' : ''}`}>
      {!embedded && (
        <div className="music-library-header">
          <h2 className="music-library-title">{t('pages.music-library.title')}</h2>
          {onClose && (
            <button className="music-library-close" onClick={onClose}>
              X
            </button>
          )}
        </div>
      )}

      <div className="music-library-toolbar">
        <div className="music-library-actions">
          <button
            className="music-library-btn"
            onClick={() => setShowPathsManager(true)}
            title={t('pages.music-library.paths.manageTitle')}
          >
            <span>{t('pages.music-library.paths.button', { count: libraryPaths.length })}</span>
          </button>
          <button
            className="music-library-btn"
            onClick={() => setShowClearConfirm(true)}
            disabled={libraryStats.totalTracks === 0}
          >
            {t('common.action.clear')}
          </button>
        </div>

        <div className="music-library-search">
          <input
            type="text"
            placeholder={t('pages.music-library.search.placeholder')}
            value={searchQuery}
            onChange={(e) => handleSearchInputChange(e.target.value)}
          />
          <span className="music-library-search-icon">🔍</span>
        </div>

        <div className="music-library-sort">
          <label htmlFor="sort-select">{t('pages.music-library.sort.label')}</label>
          <select
            id="sort-select"
            className="music-library-sort-select"
            value={sortBy}
            onChange={(e) => handleSort(e.target.value as typeof sortBy)}
          >
            <option value="default">{t('pages.music-library.sort.option.default')}</option>
            {/* Albums 鐟欏棗娴橀崣顏呮▔缁€杞扮瑩鏉堟垵鎷伴懝鐑樻钩鐎硅埖甯撴惔?*/}
            {viewMode !== 'albums' && <option value="title">{t('pages.music-library.sort.option.title')}</option>}
            <option value="artist">{t('pages.music-library.sort.option.artist')}</option>
            <option value="album">{t('pages.music-library.sort.option.album')}</option>
            {viewMode !== 'albums' && (
              <option value="duration">{t('pages.music-library.sort.option.duration')}</option>
            )}
            {viewMode !== 'albums' && <option value="year">{t('pages.music-library.sort.option.year')}</option>}
          </select>
          <button
            className={`music-library-sort-order-btn ${sortBy === 'default' ? 'disabled' : ''}`}
            onClick={() =>
              sortBy !== 'default' && setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
            }
            disabled={sortBy === 'default'}
            title={
              sortBy === 'default'
                ? t('pages.music-library.sortOrder.disabledTitle')
                : sortOrder === 'asc'
                  ? t('pages.music-library.sortOrder.ascTitle')
                  : t('pages.music-library.sortOrder.descTitle')
            }
          >
            {sortOrder === 'asc' ? '↑' : '↓'}
          </button>
          <span
            className="music-library-sort-hint"
            title={
              sortBy === 'default'
                ? t('pages.music-library.sortHint.defaultTitle')
                : t('pages.music-library.sortHint.playTitle')
            }
            style={{ opacity: sortBy === 'default' ? 0.4 : 1 }}
          >
            ▶
          </span>
        </div>

        <div className="music-library-view-modes">
          <button
            className={`music-library-view-btn ${viewMode === 'all' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('all')}
          >
            {t('pages.music-library.viewMode.all')}
          </button>
          <button
            className={`music-library-view-btn ${viewMode === 'albums' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('albums')}
          >
            {t('pages.music-library.viewMode.albums')}
          </button>
          <button
            className={`music-library-view-btn ${viewMode === 'artists' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('artists')}
          >
            {t('pages.music-library.viewMode.artists')}
          </button>
          <button
            className={`music-library-view-btn ${viewMode === 'genres' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('genres')}
          >
            {t('pages.music-library.viewMode.genres')}
          </button>
        </div>

        <div className="music-library-stats">
          <div className="music-library-stat">
            <strong>{libraryStats.totalTracks}</strong> {t('pages.music-library.stats.tracksUnit')}
          </div>
          <div className="music-library-stat">
            <strong>{libraryStats.totalArtists}</strong> {t('pages.music-library.stats.artistsUnit')}
          </div>
          <div className="music-library-stat">
            <strong>{libraryStats.totalAlbums}</strong> {t('pages.music-library.stats.albumsUnit')}
          </div>
          <div className="music-library-stat">
            <strong>{formatFileSize(libraryStats.totalSize)}</strong>
          </div>
          <div className="music-library-stat">
            <strong>{formatTotalDuration(libraryStats.totalDuration)}</strong>
          </div>
        </div>
      </div>

      <div className="music-library-content">
        {(viewMode === 'artists' || viewMode === 'genres') && (
          <div className="music-library-sidebar" ref={sidebarScrollRef} onScroll={handleSidebarScroll}>
            {viewMode === 'artists' && (
              <div className="music-library-sidebar-section">
                <div className="music-library-sidebar-title">{t('pages.music-library.sidebar.artists')}</div>
                {artists.map((artist) => (
                  <div
                    key={artist}
                    data-artist-name={artist}
                    className={`music-library-sidebar-item ${selectedArtist === artist ? 'selected' : ''}`}
                    onClick={() => setSelectedArtist(selectedArtist === artist ? null : artist)}
                    onDoubleClick={() => handlePlayArtist(artist)}
                  >
                    <span>{artist}</span>
                    <span className="music-library-sidebar-count">
                      {tracks.filter((t) => t.artist === artist).length}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {viewMode === 'genres' && (
              <div className="music-library-sidebar-section">
                <div className="music-library-sidebar-title">{t('pages.music-library.sidebar.genres')}</div>
                {genres.map((genre) => (
                  <div
                    key={genre}
                    data-genre-name={genre}
                    className={`music-library-sidebar-item ${selectedGenre === genre ? 'selected' : ''}`}
                    onClick={() => setSelectedGenre(selectedGenre === genre ? null : genre)}
                  >
                    <span>{genre}</span>
                    <span className="music-library-sidebar-count">
                      {tracks.filter((t) => t.genre === genre).length}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

          <div className="music-library-main" ref={mainScrollRef}>
          {libraryStats.totalTracks === 0 ? (
            <div className="music-library-empty">
              <div className="music-library-empty-icon">♪</div>
              <div className="music-library-empty-text">{t('pages.music-library.empty.title')}</div>
              <button className="music-library-btn" onClick={handleScanFolder}>
                {t('pages.music-library.empty.scanButton')}
              </button>
            </div>
          ) : (
            <>
              {viewMode === 'albums' && (
                <>
                  {albumVirtualWindow.topSpacerPx > 0 && (
                    <div
                      className="music-library-virtual-spacer"
                      style={{ height: `${albumVirtualWindow.topSpacerPx}px` }}
                      aria-hidden="true"
                    />
                  )}
                  <div className="music-library-grid">
                  {virtualizedAlbums.map(({ album, artist, cover }) => {
                    const key = albumKey(album, artist);
                    return (
                      <div
                        key={`${album}-${artist}`}
                        ref={getAlbumCardRef(key)}
                        data-album-key={key}
                        className="music-library-album-card"
                        onClick={() => handleAlbumClick(album, artist)}
                        onDoubleClick={() => handlePlayAlbum(album)}
                        onContextMenu={(e) => handleAlbumContextMenu(album, artist, e)}
                        title={t('pages.music-library.albums.cardTooltip')}
                      >
                        <div className="music-library-album-cover">
                          {cover ? (
                            <img
                              src={cover}
                              alt={album}
                              loading="lazy"
                              decoding="async"
                              onLoad={(event) => {
                                musicLibraryService.reportCoverDecoded(
                                  cover,
                                  event.currentTarget.naturalWidth,
                                  event.currentTarget.naturalHeight
                                );
                              }}
                            />
                          ) : (
                            '♫'
                          )}
                        </div>
                        <div className="music-library-album-title">{album}</div>
                        <div className="music-library-album-artist">{artist}</div>
                      </div>
                    );
                  })}
                  </div>
                  {albumVirtualWindow.bottomSpacerPx > 0 && (
                    <div
                      className="music-library-virtual-spacer"
                      style={{ height: `${albumVirtualWindow.bottomSpacerPx}px` }}
                      aria-hidden="true"
                    />
                  )}
                </>
              )}

              {(viewMode === 'all' || viewMode === 'artists' || viewMode === 'genres') && (
                <div className="music-library-list">
                  <div className="music-library-list-header">
                    <div>#</div>
                    <div>{t('pages.music-library.tracks.header.title')}</div>
                    <div>{t('pages.music-library.tracks.header.artist')}</div>
                    <div>{t('pages.music-library.tracks.header.album')}</div>
                    <div>{t('pages.music-library.tracks.header.duration')}</div>
                    <div>{t('pages.music-library.tracks.header.actions')}</div>
                  </div>
                  {trackVirtualWindow.topSpacerPx > 0 && (
                    <div
                      className="music-library-virtual-spacer"
                      style={{ height: `${trackVirtualWindow.topSpacerPx}px` }}
                      aria-hidden="true"
                    />
                  )}
                  {virtualizedTracks.map((track, index) => {
                    const absoluteIndex = trackVirtualWindow.start + index;
                    return (
                    <div
                      key={track.id}
                      data-track-id={track.id}
                      className="music-library-track"
                      onDoubleClick={() => handleTrackDoubleClick(track, absoluteIndex)}
                      onContextMenu={(e) => handleTrackContextMenu(track, absoluteIndex, e)}
                      title={t('pages.music-library.tracks.rowTooltip')}
                    >
                      <div className="music-library-track-number">{absoluteIndex + 1}</div>
                      <div className="music-library-track-title">{track.title}</div>
                      <div className="music-library-track-artist">{track.artist || '-'}</div>
                      <div className="music-library-track-album">{track.album || '-'}</div>
                      <div className="music-library-track-duration">
                        {track.duration ? formatDuration(track.duration) : '-'}
                      </div>
                      <div className="music-library-track-actions">
                        {onPlayNow && (
                          <button
                            onClick={(e) => handlePlaySingleTrack(track, e)}
                            title={t('pages.music-library.tracks.action.playOneTitle')}
                            className="track-action-play"
                          >
                            ▶
                          </button>
                        )}
                        {onAddToQueue && (
                          <button
                            onClick={(e) => handleAddSingleTrack(track, e)}
                            title={t('pages.music-library.tracks.action.addOneTitle')}
                            className="track-action-add"
                          >
                            +
                          </button>
                        )}
                      </div>
                    </div>
                    );
                  })}
                  {trackVirtualWindow.bottomSpacerPx > 0 && (
                    <div
                      className="music-library-virtual-spacer"
                      style={{ height: `${trackVirtualWindow.bottomSpacerPx}px` }}
                      aria-hidden="true"
                    />
                  )}
                  {(isTrackChunkLoading || hasMoreTracks || renderedTracks.length < filteredTracksTotal) && (
                    <div className="music-library-track-load-hint" role="status" aria-live="polite">
                      {isTrackChunkLoading
                        ? t('pages.music-library.loading.tracksChunk')
                        : renderedTracks.length < filteredTracksTotal
                          ? t('pages.music-library.loading.renderWindowHint', {
                              shown: renderedTracks.length,
                              total: filteredTracksTotal,
                            })
                          : t('pages.music-library.loading.scrollToLoadMore')}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {scanProgress && scanProgress.isScanning && (
        <div className="music-library-scan-progress">
          <div className="music-library-scan-header">
            <div className="music-library-scan-title">{t('pages.music-library.scan.title')}</div>
            <button
              className="music-library-scan-cancel"
              onClick={handleCancelScan}
              title={t('pages.music-library.scan.cancelTitle')}
            >
              {t('common.action.cancel')}
            </button>
            <div className="music-library-scan-percentage">
              {scanProgress.progress ? `${scanProgress.progress.toFixed(1)}%` : '0%'}
            </div>
          </div>
          {scanProgress.currentFile && (
            <div className="music-library-scan-file">
              {t('pages.music-library.scan.processing', { file: scanProgress.currentFile })}
            </div>
          )}
          <div className="music-library-scan-progress-bar">
            <div
              className="music-library-scan-progress-fill"
              style={{
                width: `${(scanProgress.current / scanProgress.total) * 100}%`,
              }}
            />
          </div>
          <div className="music-library-scan-stats">
            <span className="scan-stat-count">
              {t('pages.music-library.scan.count', {
                current: scanProgress.current,
                total: scanProgress.total,
              })}
            </span>
            {scanProgress.speed && (
              <span className="scan-stat-speed">
                {t('pages.music-library.scan.speed', { speed: scanProgress.speed.toFixed(1) })}
              </span>
            )}
            {scanProgress.remaining && scanProgress.remaining > 0 && (
              <span className="scan-stat-remaining">
                {t('pages.music-library.scan.remaining', { seconds: Math.ceil(scanProgress.remaining) })}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 濞撳懐鈹栫涵顔款吇鐎电鐦藉?*/}
      <ConfirmDialog
        isOpen={showClearConfirm}
        title={t('pages.music-library.clear.title')}
        message={t('pages.music-library.clear.message')}
        confirmText={t('common.action.clear')}
        cancelText={t('common.action.cancel')}
        confirmButtonStyle="danger"
        onConfirm={handleClearLibrary}
        onCancel={() => setShowClearConfirm(false)}
      />

      {/* 鎼存捁鐭惧鍕吀閻炲棗娅?*/}
      {showPathsManager && (
        <div className="paths-manager-overlay" onClick={() => setShowPathsManager(false)}>
          <div className="paths-manager-modal" onClick={(e) => e.stopPropagation()}>
            <div className="paths-manager-header">
              <h3>{t('pages.music-library.pathsManager.title')}</h3>
              <div className="paths-manager-header-actions">
                <button
                  className="paths-scan-btn"
                  onClick={async () => {
                    await handleScanFolder();
                    await loadLibraryPaths();
                  }}
                  disabled={scanProgress?.isScanning}
                >
                  {t('pages.music-library.pathsManager.addFolderButton')}
                </button>
                <button
                  className="paths-clean-missing-btn"
                  onClick={handleCleanupMissingForAllPaths}
                  disabled={
                    scanProgress?.isScanning ||
                    isCleanupAllMissingBusy ||
                    isLibraryPathHealthLoading ||
                    totalMissingTracks <= 0
                  }
                  title={t('pages.music-library.pathsManager.path.cleanupMissingAllTitle', {
                    count: totalMissingTracks,
                  })}
                >
                  {isCleanupAllMissingBusy
                    ? t('pages.music-library.pathsManager.path.cleanupMissingBusy')
                    : t('pages.music-library.pathsManager.path.cleanupMissingAllButton', {
                        count: totalMissingTracks,
                      })}
                </button>
                <button onClick={() => setShowPathsManager(false)}>X</button>
              </div>
            </div>

            <div className="paths-manager-body">
              {libraryPaths.length === 0 ? (
                <div className="paths-manager-empty">
                  <div className="paths-empty-icon">📁</div>
                  <div className="paths-empty-text">{t('pages.music-library.pathsManager.empty.title')}</div>
                  <div className="paths-empty-hint">{t('pages.music-library.pathsManager.empty.hint')}</div>
                </div>
              ) : (
                <div className="paths-manager-list">
                  {libraryPaths.map((path) => {
                    const pathHealth = libraryPathHealthMap[path.id];
                    const missingCount = pathHealth?.missingTracks ?? 0;
                    const isPathCleanupBusy = pathCleanupBusyMap[path.id] === true;

                    return (
                    <div key={path.id} className="path-item">
                      <div className="path-item-icon">📁</div>
                      <div className="path-item-info">
                        <div className="path-item-name" title={path.path}>
                          {path.path}
                        </div>
                        <div className="path-item-meta">
                          {path.trackCount > 0 && (
                            <span className="path-meta-tracks">
                              {t('pages.music-library.pathsManager.path.trackCount', { count: path.trackCount })}
                            </span>
                          )}
                          {missingCount > 0 && (
                            <span className="path-meta-missing">
                              {t('pages.music-library.pathsManager.path.missingCount', {
                                count: missingCount,
                              })}
                            </span>
                          )}
                          {!path.isVisible && (
                            <span className="path-meta-hidden">
                              {t('pages.music-library.pathsManager.path.hiddenBadge')}
                            </span>
                          )}
                          {!path.isScanned && (
                            <span className="path-meta-scan-paused">
                              {t('pages.music-library.pathsManager.path.scanPausedBadge')}
                            </span>
                          )}
                          {path.lastScanned && (
                            <span className="path-meta-time">
                              🕒{' '}
                              {new Date(path.lastScanned).toLocaleString(locale, {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          )}
                          {!path.lastScanned && (
                            <span className="path-meta-unscanned">
                              {t('pages.music-library.pathsManager.path.unscanned')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="path-item-actions">
                        <button
                          className={`path-item-action-btn ${path.isVisible ? 'path-item-visibility-on' : 'path-item-visibility-off'}`}
                          onClick={async () => {
                            const releaseProtection = beginAudioProtection(
                              'music-library-toggle-path-visibility',
                              20_000
                            );
                            try {
                              await musicLibraryService.setLibraryPathVisibility(path.id, !path.isVisible);
                              await Promise.all([loadLibraryPaths(), loadLibraryData()]);
                            } finally {
                              releaseProtection();
                            }
                          }}
                          title={
                            path.isVisible
                              ? t('pages.music-library.pathsManager.path.hideTitle')
                              : t('pages.music-library.pathsManager.path.showTitle')
                          }
                        >
                          {path.isVisible ? '👁' : '🙈'}
                        </button>
                        <button
                          className={`path-item-action-btn ${path.isScanned ? 'path-item-scanning-on' : 'path-item-scanning-off'}`}
                          onClick={async () => {
                            const releaseProtection = beginAudioProtection(
                              'music-library-toggle-path-scanning',
                              20_000
                            );
                            try {
                              await musicLibraryService.setLibraryPathScanning(path.id, !path.isScanned);
                              await loadLibraryPaths();
                            } finally {
                              releaseProtection();
                            }
                          }}
                          title={
                            path.isScanned
                              ? t('pages.music-library.pathsManager.path.disableScanTitle')
                              : t('pages.music-library.pathsManager.path.enableScanTitle')
                          }
                        >
                          {path.isScanned ? '🔄' : '⏸'}
                        </button>
                        <button
                          className="path-item-action-btn path-item-clean-missing"
                          onClick={() => {
                            void handleCleanupMissingForPath(path.id);
                          }}
                          disabled={
                            scanProgress?.isScanning ||
                            isLibraryPathHealthLoading ||
                            isPathCleanupBusy ||
                            missingCount <= 0
                          }
                          title={
                            missingCount > 0
                              ? t('pages.music-library.pathsManager.path.cleanupMissingTitle', {
                                  count: missingCount,
                                })
                              : t('pages.music-library.pathsManager.path.cleanupMissingDisabledTitle')
                          }
                        >
                          {isPathCleanupBusy
                            ? t('pages.music-library.pathsManager.path.cleanupMissingBusy')
                            : '🧹'}
                        </button>
                        <button
                          className="path-item-action-btn path-item-rescan"
                          onClick={async () => {
                            const releaseProtection = beginAudioProtection('music-library-rescan-path', 90_000);
                            try {
                              await musicLibraryService.scanFolder(path.path, path.id);
                              await loadLibraryPaths();
                              await loadLibraryData();
                            } catch (error) {
                              console.error('Failed to rescan path:', error);
                            } finally {
                              releaseProtection();
                            }
                          }}
                          disabled={scanProgress?.isScanning}
                          title={t('pages.music-library.pathsManager.path.rescanTitle')}
                        >
                          ↻
                        </button>
                        <button
                          className="path-item-action-btn path-item-remove"
                          onClick={async () => {
                            const releaseProtection = beginAudioProtection('music-library-remove-path', 20_000);
                            try {
                              await musicLibraryService.removeLibraryPath(path.id);
                              await Promise.all([loadLibraryPaths(), loadLibraryData()]);
                            } finally {
                              releaseProtection();
                            }
                          }}
                          title={t('pages.music-library.pathsManager.path.removeTitle')}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="paths-manager-footer">
              <div className="paths-manager-info">
                {t('pages.music-library.pathsManager.footer')}
              </div>
              <div className="paths-manager-health-info">
                {isLibraryPathHealthLoading
                  ? t('pages.music-library.pathsManager.health.loading')
                  : isLibraryPathHealthAvailable
                    ? t('pages.music-library.pathsManager.health.summary', {
                        count: totalMissingTracks,
                      })
                    : t('pages.music-library.pathsManager.health.unavailable')}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 闁挎瑨顕ら幓鎰仛鐎电鐦藉?*/}
      {errorMessage && (
        <ConfirmDialog
          isOpen={true}
          title={t('common.dialog.errorTitle')}
          message={errorMessage}
          confirmText={t('common.action.ok')}
          cancelText=""
          confirmButtonStyle="primary"
          onConfirm={() => setErrorMessage(null)}
          onCancel={() => setErrorMessage(null)}
        />
      )}
    </div>
  );

  // 瀹撳苯鍙嗗Ο鈥崇础閻╁瓨甯存潻鏂挎礀閸愬懎顔愰敍宀勬姜瀹撳苯鍙嗗Ο鈥崇础娴ｈ法鏁ortal
  return (
    <>
      {embedded ? libraryContent : createPortal(libraryContent, document.body)}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
};
