import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Track } from '../../services/audio';
import {
  musicLibraryService,
  LibraryStats,
  ScanProgress,
  ViewMode,
  LibraryPath,
  AlbumSummary,
} from '../../services/audio/MusicLibraryService';
import { ConfirmDialog } from '../magnet/ConfirmDialog';
import { ContextMenu, ContextMenuItem } from '../magnet/ContextMenu';
import { useNavigation } from '../../contexts/NavigationContext';
import { useLocale, useT } from '../../i18n';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import './MusicLibrary.css';

interface MusicLibraryProps {
  isOpen?: boolean;
  onClose?: () => void;
  onAddToQueue?: (tracks: Track[]) => void;
  onPlayNow?: (tracks: Track[], startIndex?: number) => void;
  embedded?: boolean; // 是否嵌入模式（在NavigationPage中）
}

// ✅ 模块级缓存：跨组件实例共享，不会因为组件卸载而丢失
let moduleCache: {
  tracks: Track[];
  artists: string[];
  albums: AlbumSummary[];
  genres: string[];
  timestamp: number;
} | null = null;

// ? 模块级滚动位置缓存：按 viewMode 记忆主滚动条位置与锚点（跨页面跳转/组件卸载保持）
type MainScrollAnchor =
  | { kind: 'track'; id: string; offset: number }
  | { kind: 'album'; key: string; offset: number };

type MainScrollMemory = { scrollTop: number; anchor?: MainScrollAnchor };

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

const CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

// 清除模块缓存
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
  const [showPathsManager, setShowPathsManager] = useState(false);
  const [isRefreshingPermissions, setIsRefreshingPermissions] = useState(false);
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

  // ? 记忆滚动位置：按 viewMode 维护主滚动条 scrollTop + 锚点，避免跨页面/切换 tab 丢失位置
  const isRestoringMainScrollRef = useRef(false);
  const mainScrollUserDirtyRef = useRef(false);
  const mainScrollRestoreStateRef = useRef<{ viewMode: ViewMode | null; done: boolean }>({
    viewMode: null,
    done: false,
  });

  const escapeCssSelector = useCallback((value: string): string => {
    const css = (globalThis as unknown as { CSS?: { escape?: (text: string) => string } }).CSS;
    if (css?.escape) return css.escape(value);
    return value.replace(/["\\]/g, '\\$&');
  }, []);

  const getMainScrollRoot = useCallback((): HTMLElement | null => {
    const main = mainScrollRef.current;
    if (!main) return null;

    const isScrollable = (element: HTMLElement): boolean =>
      element.scrollHeight > element.clientHeight + 1;

    if (isScrollable(main)) return main;

    const navigationContent = main.closest<HTMLElement>('.navigation-content');
    if (navigationContent && isScrollable(navigationContent)) return navigationContent;

    return main;
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

      const anchor = computeMainScrollAnchor(root, mode);
      if (anchor) memory.anchor = anchor;

      moduleScrollMemory[mode] = memory;
    },
    [computeMainScrollAnchor, getMainScrollRoot]
  );

  const handleMainScroll = useCallback(() => {
    if (isRestoringMainScrollRef.current) return;
    const root = getMainScrollRoot();
    if (!root) return;
    mainScrollUserDirtyRef.current = true;

    const previous = moduleScrollMemory[viewMode];
    moduleScrollMemory[viewMode] = {
      ...(previous ?? { scrollTop: 0 }),
      scrollTop: root.scrollTop,
    };
  }, [getMainScrollRoot, viewMode]);

  useEffect(() => {
    moduleLastViewMode = viewMode;
  }, [viewMode]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const root = getMainScrollRoot();
    if (!root) return;

    if (mainScrollRestoreStateRef.current.viewMode !== viewMode) {
      mainScrollRestoreStateRef.current = { viewMode, done: false };
      mainScrollUserDirtyRef.current = false;
    }

    if (mainScrollRestoreStateRef.current.done) return;

    const memory = moduleScrollMemory[viewMode];
    const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);

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
      setScrollTop(scrollTop);
      return scrollTop === 0 || scrollTop <= maxScrollTop;
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
    genres.length,
    getMainScrollRoot,
    isOpen,
    libraryStats.totalTracks,
    tracks.length,
    viewMode,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    return () => {
      const root = getMainScrollRoot();
      const currentScrollTop = root?.scrollTop ?? 0;
      const existing = moduleScrollMemory[viewMode];
      const shouldCapture =
        mainScrollUserDirtyRef.current ||
        !existing ||
        (currentScrollTop > 0 && existing.scrollTop !== currentScrollTop);

      if (shouldCapture) captureMainScrollMemory(viewMode);
    };
  }, [captureMainScrollMemory, getMainScrollRoot, isOpen, viewMode]);

  // ? Artists/Genres sidebar: 独立滚动记忆（锚点式恢复）
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

  // 排序状态
  const [sortBy, setSortBy] = useState<
    'title' | 'artist' | 'album' | 'duration' | 'year' | 'default'
  >('default');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  // 切换视图模式时清除筛选状态
  const handleViewModeChange = (
    newMode: ViewMode,
    options?: { artist?: string; genre?: string }
  ) => {
    captureMainScrollMemory(viewMode);
    captureSidebarScrollMemory(viewMode);
    moduleLastViewMode = newMode;
    setViewMode(newMode);
    // 清除所有筛选条件，让每个视图独立
    setSelectedArtist(options?.artist || null);
    setSelectedAlbum(null);
    setSelectedGenre(options?.genre || null);
  };

  // 加载库数据
  const loadLibraryData = async () => {
    console.log('Loading library data...');

    // ✅ 立即显示模块缓存数据（如果有效）
    const now = Date.now();
    if (moduleCache && now - moduleCache.timestamp < CACHE_DURATION) {
      console.log('✅ Using module cache for instant display');
      setTracks(moduleCache.tracks);
      setArtists(moduleCache.artists);
      requestedAlbumCoversRef.current.clear();
      setAlbums(moduleCache.albums);
      setGenres(moduleCache.genres);

      // 在后台异步更新统计信息
      musicLibraryService.getLibraryStats().then((stats) => {
        setLibraryStats(stats);
      });
      return; // ✅ 直接返回，不重新加载
    }

    // 没有缓存或缓存过期，从 IndexedDB 加载
    console.log('Loading from IndexedDB...');

    try {
      // ✅ 优化：直接加载数据，限制为 1000 首（避免重复读取）
      const [allTracks, allArtists, allAlbums, allGenres] = await Promise.all([
        musicLibraryService.getAllTracks(1000), // 最多加载 1000 首
        musicLibraryService.getAllArtists(),
        musicLibraryService.getAllAlbums(),
        musicLibraryService.getAllGenres(),
      ]);

      console.log('Library data loaded:', {
        tracks: allTracks.length,
        artists: allArtists.length,
        albums: allAlbums.length,
        genres: allGenres.length,
      });

      // 更新显示数据和模块缓存
      moduleCache = {
        tracks: allTracks,
        artists: allArtists,
        albums: allAlbums,
        genres: allGenres,
        timestamp: Date.now(),
      };

      setTracks(allTracks);
      setArtists(allArtists);
      requestedAlbumCoversRef.current.clear();
      setAlbums(allAlbums);
      setGenres(allGenres);

      // 在后台异步计算统计信息（不阻塞UI）
      musicLibraryService.getLibraryStats().then((stats) => {
        setLibraryStats(stats);
        console.log('Library stats loaded:', stats);
      });
    } catch (error) {
      console.error('Failed to load library data:', error);
    }
  };

  // 加载库路径
  const loadLibraryPaths = async () => {
    try {
      const paths = await musicLibraryService.getLibraryPaths();
      setLibraryPaths(paths);
      return paths;
    } catch (error) {
      console.error('Failed to load library paths:', error);
      return [];
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadLibraryData();
      loadLibraryPaths();
    }
    // ✅ 不清空数据，让它保留在状态中以便快速切换
  }, [isOpen]);

  // 订阅扫描进度
  useEffect(() => {
    const unsubscribe = musicLibraryService.onScanProgress((progress) => {
      console.log('Scan progress:', progress);
      setScanProgress(progress);

      // 扫描完成后自动刷新数据和路径列表
      if (!progress.isScanning && progress.current > 0) {
        console.log('Scan completed, refreshing library...');
        clearModuleCache(); // ✅ 清除缓存
        // 延迟一点确保数据写入完成
        setTimeout(() => {
          Promise.all([
            loadLibraryData(),
            loadLibraryPaths(), // 同时刷新路径列表
          ]);
        }, 300); // 减少延迟到 300ms
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const map = new Map<string, AlbumSummary>();
    for (const a of albums) {
      map.set(albumKey(a.album, a.artist), a);
    }
    albumInfoByKeyRef.current = map;
  }, [albums]);

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

  // Desktop/Tauri: 专辑封面懒加载（IntersectionObserver + 并发队列）
  useEffect(() => {
    if (!isOpen) return;
    if (!isTauriRuntime()) return;
    if (viewMode !== 'albums') return;

    const root = mainScrollRef.current;
    if (!root) return;

    const generation = (albumCoverGenerationRef.current += 1);
    let disposed = false;

    albumCoverQueueRef.current = [];
    albumCoverInFlightRef.current = 0;

    const maxConcurrency = 4;

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

      const url = await musicLibraryService.getCoverUrlForTrack(stub);
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
        rootMargin: '600px 0px',
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
  }, [isOpen, viewMode]);

  // 处理文件夹扫描
  const handleScanFolder = async () => {
    try {
      console.log('Starting folder scan...');
      await musicLibraryService.scanFolder();
      console.log('Folder scan completed, refreshing library data...');
      // 扫描完成后清除缓存并刷新数据和路径列表
      clearModuleCache(); // ✅ 清除缓存，强制重新加载
      await Promise.all([
        loadLibraryData(),
        loadLibraryPaths(), // 刷新路径列表
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
    }
  };

  const handleCancelScan = async () => {
    try {
      await musicLibraryService.cancelCurrentScan();
    } catch (error) {
      console.error('Failed to cancel scan:', error);
    }
  };

  // 清空库
  const handleClearLibrary = async () => {
    await musicLibraryService.clearLibrary();
    clearModuleCache(); // ✅ 清除缓存
    await loadLibraryData();
    setShowClearConfirm(false);
  };

  // ✅ 刷新所有文件夹的权限
  const handleRefreshPermissions = async () => {
    setIsRefreshingPermissions(true);
    try {
      console.log('Refreshing all folder permissions...');
      const result = await musicLibraryService.refreshAllPermissions();
      console.log('Permission refresh result:', result);

      if (result.granted === result.total) {
        setErrorMessage(null);
        console.log(`✅ All ${result.granted} folder permissions granted`);
      } else if (result.granted > 0) {
        setErrorMessage(
          t('pages.music-library.refreshPermissions.partial', {
            granted: result.granted,
            total: result.total,
          })
        );
      } else {
        setErrorMessage(t('pages.music-library.refreshPermissions.failed'));
      }
    } catch (error) {
      console.error('Failed to refresh permissions:', error);
      setErrorMessage(
        t('pages.music-library.refreshPermissions.failedWithReason', {
          message: error instanceof Error ? error.message : String(error),
        })
      );
    } finally {
      setIsRefreshingPermissions(false);
    }
  };

  // 搜索处理
  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.trim()) {
      const results = await musicLibraryService.searchTracks(query);
      setTracks(results);

      // 从搜索结果中提取 albums、artists 和 genres
      const uniqueArtists = Array.from(new Set(results.map((t) => t.artist).filter(Boolean)));
      const uniqueGenres = Array.from(new Set(results.map((t) => t.genre).filter(Boolean)));

      // 提取专辑信息（专辑名 + 艺术家 + 封面）
      const albumMap = new Map<string, AlbumSummary>();
      results.forEach((track) => {
        if (track.album) {
          const key = `${track.album}-${track.artist}`;
          if (!albumMap.has(key)) {
              albumMap.set(key, {
                album: track.album,
              artist: track.artist || t('common.unknown.artist'),
                cover:
                  typeof track.coverUrl === 'string' &&
                  (track.coverUrl.toLowerCase().startsWith('data:') ||
                  track.coverUrl.toLowerCase().startsWith('blob:') ||
                  track.coverUrl.toLowerCase().startsWith('http:') ||
                  track.coverUrl.toLowerCase().startsWith('https:'))
                  ? track.coverUrl
                  : undefined,
              coverTrackPath: track.filePath || track.path,
              coverTrackId: track.id,
            });
          }
        }
      });
      const uniqueAlbums = Array.from(albumMap.values());

      setArtists(uniqueArtists as string[]);
      setGenres(uniqueGenres as string[]);
      requestedAlbumCoversRef.current.clear();
      setAlbums(uniqueAlbums);
    } else {
      // 清空搜索时恢复原始数据
      const [allTracks, allArtists, allAlbums, allGenres] = await Promise.all([
        musicLibraryService.getAllTracks(),
        musicLibraryService.getAllArtists(),
        musicLibraryService.getAllAlbums(),
        musicLibraryService.getAllGenres(),
      ]);

      setTracks(allTracks);
      setArtists(allArtists);
      requestedAlbumCoversRef.current.clear();
      setAlbums(allAlbums);
      setGenres(allGenres);
    }
  };

  // 排序处理函数
  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      // 如果已经是当前排序字段，切换排序方向
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // 切换到新的排序字段，默认升序
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  // 应用排序到数组
  const applySorting = useCallback(<T extends Track | { album: string; artist: string }>(items: T[]): T[] => {
    if (sortBy === 'default') return items;

    const sorted = [...items];
    sorted.sort((a, b) => {
      let compareA: string | number = '';
      let compareB: string | number = '';

      // 根据排序字段获取比较值
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

      // 比较
      let result = 0;
      if (typeof compareA === 'string' && typeof compareB === 'string') {
        result = compareA.localeCompare(compareB);
      } else {
        result = Number(compareA) - Number(compareB);
      }

      // 应用排序方向
      return sortOrder === 'asc' ? result : -result;
    });

    return sorted;
  }, [sortBy, sortOrder]);

  // 获取过滤和排序后的轨道
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

  // 获取排序后的专辑列表
  const sortedAlbums = useMemo(() => applySorting(albums), [albums, applySorting]);

  // 单击专辑 - 导航到专辑详情页
  const handleAlbumClick = (albumName: string, artist: string) => {
    if (embedded) {
      // 在embedded模式下，导航到专辑页面
      navigateTo('album', { albumName, artist });
    }
  };

  // 双击专辑 - 播放专辑
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

  // 播放艺术家
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

  // 双击歌曲：添加所有过滤后的歌曲到队列，从选中的歌曲开始播放
  const handleTrackDoubleClick = (track: Track, index: number) => {
    if (!onPlayNow) {
      console.log('Play track:', track.title, '(embedded mode - no playback)');
      return;
    }
    console.log(`🎵 Playing from track ${index + 1}/${filteredTracks.length}`);
    onPlayNow(filteredTracks, index);
  };

  // 只播放单首歌曲
  const handlePlaySingleTrack = (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onPlayNow) {
      console.log('Play single track:', track.title, '(embedded mode - no playback)');
      return;
    }
    console.log('🎵 Playing single track:', track.title);
    onPlayNow([track]);
  };

  // 只添加单首歌曲到队列
  const handleAddSingleTrack = (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onAddToQueue) {
      console.log('Add track:', track.title, '(embedded mode - no queue)');
      return;
    }
    console.log('➕ Adding single track:', track.title);
    onAddToQueue([track]);
  };

  // 处理歌曲右键菜单
  const handleTrackContextMenu = (track: Track, index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const playTracks = filteredTracks;

    const menuItems: ContextMenuItem[] = [
      {
        label: t('pages.music-library.contextMenu.play'),
        icon: '▶',
        onClick: () => handlePlaySingleTrack(track, e),
      },
      {
        label: t('pages.music-library.contextMenu.addToQueue'),
        icon: '+',
        onClick: () => onAddToQueue?.([track]),
      },
      {
        label: t('pages.music-library.contextMenu.playAllFromHere'),
        icon: '🎵',
        onClick: () => onPlayNow?.(playTracks, index),
      },
      { divider: true } as ContextMenuItem,
      {
        label: t('pages.music-library.contextMenu.viewAlbum'),
        icon: '💿',
        onClick: () => {
          if (track.album && embedded) {
            handleAlbumClick(track.album, track.artist || '');
          }
        },
        disabled: !track.album || !embedded,
      },
      {
        label: t('pages.music-library.contextMenu.viewArtist'),
        icon: '👤',
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

  // 处理专辑右键菜单
  const handleAlbumContextMenu = (album: string, artist: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const menuItems: ContextMenuItem[] = [
      {
        label: t('pages.music-library.contextMenu.viewAlbum'),
        icon: '💿',
        onClick: () => handleAlbumClick(album, artist),
        disabled: !embedded,
      },
      {
        label: t('pages.music-library.contextMenu.playAlbum'),
        icon: '▶',
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
        icon: '👤',
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

  // 格式化文件大小
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  // 格式化时长
  const formatTotalDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return t('pages.music-library.duration.hoursMinutes', { hours, minutes });
    }
    return t('pages.music-library.duration.minutes', { minutes });
  };

  // 格式化轨道时长
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  const libraryContent = (
    <div className={`music-library ${embedded ? 'music-library-embedded' : ''}`}>
      {!embedded && (
        <div className="music-library-header">
          <h2 className="music-library-title">♪ {t('pages.music-library.title')}</h2>
          {onClose && (
            <button className="music-library-close" onClick={onClose}>
              ✕
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
            <span>📁 {t('pages.music-library.paths.button', { count: libraryPaths.length })}</span>
          </button>
          <button
            className="music-library-btn"
            onClick={() => setShowClearConfirm(true)}
            disabled={libraryStats.totalTracks === 0}
          >
            × {t('common.action.clear')}
          </button>
        </div>

        <div className="music-library-search">
          <input
            type="text"
            placeholder={t('pages.music-library.search.placeholder')}
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
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
            {/* Albums 视图只显示专辑和艺术家排序 */}
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
            🎵
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

          <div className="music-library-main" ref={mainScrollRef} onScroll={handleMainScroll}>
          {libraryStats.totalTracks === 0 ? (
            <div className="music-library-empty">
              <div className="music-library-empty-icon">⊞</div>
              <div className="music-library-empty-text">{t('pages.music-library.empty.title')}</div>
              <button className="music-library-btn" onClick={handleScanFolder}>
                {t('pages.music-library.empty.scanButton')}
              </button>
            </div>
          ) : (
            <>
              {viewMode === 'albums' && (
                <div className="music-library-grid">
                  {sortedAlbums.map(({ album, artist, cover }) => {
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
                            <img src={cover} alt={album} loading="lazy" decoding="async" />
                          ) : (
                            '◉'
                          )}
                        </div>
                        <div className="music-library-album-title">{album}</div>
                        <div className="music-library-album-artist">{artist}</div>
                      </div>
                    );
                  })}
                </div>
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
                  {filteredTracks.map((track, index) => (
                    <div
                      key={track.id}
                      data-track-id={track.id}
                      className="music-library-track"
                      onDoubleClick={() => handleTrackDoubleClick(track, index)}
                      onContextMenu={(e) => handleTrackContextMenu(track, index, e)}
                      title={t('pages.music-library.tracks.rowTooltip')}
                    >
                      <div className="music-library-track-number">{index + 1}</div>
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
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {scanProgress && scanProgress.isScanning && (
        <div className="music-library-scan-progress">
          <div className="music-library-scan-header">
            <div className="music-library-scan-title">🔍 {t('pages.music-library.scan.title')}</div>
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

      {/* 清空确认对话框 */}
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

      {/* 库路径管理器 */}
      {showPathsManager && (
        <div className="paths-manager-overlay" onClick={() => setShowPathsManager(false)}>
          <div className="paths-manager-modal" onClick={(e) => e.stopPropagation()}>
            <div className="paths-manager-header">
              <h3>{t('pages.music-library.pathsManager.title')}</h3>
              <div className="paths-manager-header-actions">
                <button
                  className="paths-scan-btn"
                  onClick={handleRefreshPermissions}
                  disabled={isRefreshingPermissions || libraryPaths.length === 0}
                  title={t('pages.music-library.pathsManager.refreshPermissionsTitle')}
                  style={{
                    background: 'rgba(0, 200, 100, 0.2)',
                    border: '1px solid rgba(0, 200, 100, 0.5)',
                  }}
                >
                  {isRefreshingPermissions
                    ? t('pages.music-library.pathsManager.refreshingButton')
                    : t('pages.music-library.pathsManager.refreshPermissionsButton')}
                </button>
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
                <button onClick={() => setShowPathsManager(false)}>✕</button>
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
                  {libraryPaths.map((path) => (
                    <div key={path.id} className="path-item">
                      <div className="path-item-icon">📁</div>
                      <div className="path-item-info">
                        <div className="path-item-name" title={path.path}>
                          {path.path}
                        </div>
                        <div className="path-item-meta">
                          {path.trackCount > 0 && (
                            <span className="path-meta-tracks">
                              ♪ {t('pages.music-library.pathsManager.path.trackCount', { count: path.trackCount })}
                            </span>
                          )}
                          {path.lastScanned && (
                            <span className="path-meta-time">
                              🕐{' '}
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
                          className="path-item-action-btn path-item-rescan"
                          onClick={async () => {
                            try {
                              await musicLibraryService.scanFolder(path.path, path.id);
                              await loadLibraryPaths();
                              await loadLibraryData();
                            } catch (error) {
                              console.error('Failed to rescan path:', error);
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
                            await musicLibraryService.removeLibraryPath(path.id);
                            await loadLibraryPaths();
                          }}
                          title={t('pages.music-library.pathsManager.path.removeTitle')}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="paths-manager-footer">
              <div className="paths-manager-info">
                {t('pages.music-library.pathsManager.footer')}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 错误提示对话框 */}
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

  // 嵌入模式直接返回内容，非嵌入模式使用Portal
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
