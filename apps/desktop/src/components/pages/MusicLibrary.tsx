import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return isTauriRuntime() ? 'all' : 'albums';
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
      setErrorMessage('扫描文件夹失败: ' + (error as Error).message);
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
        setErrorMessage(`部分权限刷新成功：${result.granted}/${result.total} 个文件夹`);
      } else {
        setErrorMessage('权限刷新失败，请尝试重新扫描文件夹');
      }
    } catch (error) {
      console.error('Failed to refresh permissions:', error);
      setErrorMessage('权限刷新失败: ' + (error as Error).message);
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
              artist: track.artist || '未知艺术家',
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
  const applySorting = <T extends Track | { album: string; artist: string }>(items: T[]): T[] => {
    if (sortBy === 'default') return items;

    const sorted = [...items];
    sorted.sort((a, b) => {
      let compareA: any;
      let compareB: any;

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
      if (typeof compareA === 'string') {
        result = compareA.localeCompare(compareB);
      } else {
        result = compareA - compareB;
      }

      // 应用排序方向
      return sortOrder === 'asc' ? result : -result;
    });

    return sorted;
  };

  // 获取过滤和排序后的轨道
  const getFilteredTracks = () => {
    let filtered = [...tracks];

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
  };

  // 获取排序后的专辑列表
  const getSortedAlbums = () => {
    return applySorting(albums);
  };

  // 单击专辑 - 导航到专辑详情页
  const handleAlbumClick = async (albumName: string, artist: string) => {
    if (embedded) {
      // 在embedded模式下，导航到专辑页面
      const albumTracks = await musicLibraryService.getTracksByAlbum(albumName);
      navigateTo('album', { albumName, artist, tracks: albumTracks });
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
    const filteredTracks = getFilteredTracks();
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

    const filteredTracks = getFilteredTracks();

    const menuItems: ContextMenuItem[] = [
      {
        label: '播放',
        icon: '▶',
        onClick: () => handlePlaySingleTrack(track, e),
      },
      {
        label: '添加到队列',
        icon: '+',
        onClick: () => onAddToQueue?.([track]),
      },
      {
        label: '播放全部（从此开始）',
        icon: '🎵',
        onClick: () => onPlayNow?.(filteredTracks, index),
      },
      { divider: true } as ContextMenuItem,
      {
        label: '查看专辑',
        icon: '💿',
        onClick: () => {
          if (track.album && embedded) {
            handleAlbumClick(track.album, track.artist || '');
          }
        },
        disabled: !track.album || !embedded,
      },
      {
        label: '查看艺术家',
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
        label: '查看专辑',
        icon: '💿',
        onClick: () => handleAlbumClick(album, artist),
        disabled: !embedded,
      },
      {
        label: '播放专辑',
        icon: '▶',
        onClick: () => handlePlayAlbum(album),
      },
      {
        label: '添加到队列',
        icon: '+',
        onClick: async () => {
          const albumTracks = await musicLibraryService.getTracksByAlbum(album);
          onAddToQueue?.(albumTracks);
        },
      },
      { divider: true } as ContextMenuItem,
      {
        label: '查看艺术家',
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
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
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
          <h2 className="music-library-title">♪ Music Library</h2>
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
            title="管理库路径"
          >
            <span>📁 库路径 ({libraryPaths.length})</span>
          </button>
          <button
            className="music-library-btn"
            onClick={() => setShowClearConfirm(true)}
            disabled={libraryStats.totalTracks === 0}
          >
            × Clear
          </button>
        </div>

        <div className="music-library-search">
          <input
            type="text"
            placeholder="Search tracks, artists, albums..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
          />
          <span className="music-library-search-icon">🔍</span>
        </div>

        <div className="music-library-sort">
          <label htmlFor="sort-select">排序：</label>
          <select
            id="sort-select"
            className="music-library-sort-select"
            value={sortBy}
            onChange={(e) => handleSort(e.target.value as typeof sortBy)}
          >
            <option value="default">默认</option>
            {/* Albums 视图只显示专辑和艺术家排序 */}
            {viewMode !== 'albums' && <option value="title">标题</option>}
            <option value="artist">艺术家</option>
            <option value="album">专辑</option>
            {viewMode !== 'albums' && <option value="duration">时长</option>}
            {viewMode !== 'albums' && <option value="year">年份</option>}
          </select>
          <button
            className={`music-library-sort-order-btn ${sortBy === 'default' ? 'disabled' : ''}`}
            onClick={() =>
              sortBy !== 'default' && setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
            }
            disabled={sortBy === 'default'}
            title={
              sortBy === 'default'
                ? '请先选择排序字段'
                : sortOrder === 'asc'
                  ? '升序 - 点击切换为降序'
                  : '降序 - 点击切换为升序'
            }
          >
            {sortOrder === 'asc' ? '↑' : '↓'}
          </button>
          <span
            className="music-library-sort-hint"
            title={sortBy === 'default' ? '当前使用默认顺序' : '播放时将按此排序顺序'}
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
            All
          </button>
          <button
            className={`music-library-view-btn ${viewMode === 'albums' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('albums')}
          >
            Albums
          </button>
          <button
            className={`music-library-view-btn ${viewMode === 'artists' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('artists')}
          >
            Artists
          </button>
          <button
            className={`music-library-view-btn ${viewMode === 'genres' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('genres')}
          >
            Genres
          </button>
        </div>

        <div className="music-library-stats">
          <div className="music-library-stat">
            <strong>{libraryStats.totalTracks}</strong> tracks
          </div>
          <div className="music-library-stat">
            <strong>{libraryStats.totalArtists}</strong> artists
          </div>
          <div className="music-library-stat">
            <strong>{libraryStats.totalAlbums}</strong> albums
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
          <div className="music-library-sidebar">
            {viewMode === 'artists' && (
              <div className="music-library-sidebar-section">
                <div className="music-library-sidebar-title">Artists</div>
                {artists.map((artist) => (
                  <div
                    key={artist}
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
                <div className="music-library-sidebar-title">Genres</div>
                {genres.map((genre) => (
                  <div
                    key={genre}
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
              <div className="music-library-empty-icon">⊞</div>
              <div className="music-library-empty-text">Your music library is empty</div>
              <button className="music-library-btn" onClick={handleScanFolder}>
                Scan a folder to get started
              </button>
            </div>
          ) : (
            <>
              {viewMode === 'albums' && (
                <div className="music-library-grid">
                  {getSortedAlbums().map(({ album, artist, cover }) => {
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
                        title={`单击查看专辑 / 双击播放 / 右键菜单`}
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
                    <div>Title</div>
                    <div>Artist</div>
                    <div>Album</div>
                    <div>Duration</div>
                    <div>Actions</div>
                  </div>
                  {getFilteredTracks().map((track, index) => (
                    <div
                      key={track.id}
                      className="music-library-track"
                      onDoubleClick={() => handleTrackDoubleClick(track, index)}
                      onContextMenu={(e) => handleTrackContextMenu(track, index, e)}
                      title="双击播放所有歌曲（从此歌曲开始） / 右键菜单"
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
                            title="只播放此歌曲"
                            className="track-action-play"
                          >
                            ▶
                          </button>
                        )}
                        {onAddToQueue && (
                          <button
                            onClick={(e) => handleAddSingleTrack(track, e)}
                            title="只添加此歌曲到队列"
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
            <div className="music-library-scan-title">🔍 扫描中...</div>
            <button
              className="music-library-scan-cancel"
              onClick={handleCancelScan}
              title="取消扫描"
            >
              取消
            </button>
            <div className="music-library-scan-percentage">
              {scanProgress.progress ? `${scanProgress.progress.toFixed(1)}%` : '0%'}
            </div>
          </div>
          {scanProgress.currentFile && (
            <div className="music-library-scan-file">正在处理：{scanProgress.currentFile}</div>
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
              {scanProgress.current} / {scanProgress.total} 个文件
            </span>
            {scanProgress.speed && (
              <span className="scan-stat-speed">{scanProgress.speed.toFixed(1)} 文件/秒</span>
            )}
            {scanProgress.remaining && scanProgress.remaining > 0 && (
              <span className="scan-stat-remaining">
                预计剩余 {Math.ceil(scanProgress.remaining)} 秒
              </span>
            )}
          </div>
        </div>
      )}

      {/* 清空确认对话框 */}
      <ConfirmDialog
        isOpen={showClearConfirm}
        title="清空音乐库"
        message="确定要清空整个音乐库吗？此操作无法撤销。"
        confirmText="清空"
        cancelText="取消"
        confirmButtonStyle="danger"
        onConfirm={handleClearLibrary}
        onCancel={() => setShowClearConfirm(false)}
      />

      {/* 库路径管理器 */}
      {showPathsManager && (
        <div className="paths-manager-overlay" onClick={() => setShowPathsManager(false)}>
          <div className="paths-manager-modal" onClick={(e) => e.stopPropagation()}>
            <div className="paths-manager-header">
              <h3>库路径管理</h3>
              <div className="paths-manager-header-actions">
                <button
                  className="paths-scan-btn"
                  onClick={handleRefreshPermissions}
                  disabled={isRefreshingPermissions || libraryPaths.length === 0}
                  title="刷新所有文件夹的访问权限"
                  style={{
                    background: 'rgba(0, 200, 100, 0.2)',
                    border: '1px solid rgba(0, 200, 100, 0.5)',
                  }}
                >
                  {isRefreshingPermissions ? '⟳ 刷新中...' : '🔑 刷新权限'}
                </button>
                <button
                  className="paths-scan-btn"
                  onClick={async () => {
                    await handleScanFolder();
                    await loadLibraryPaths();
                  }}
                  disabled={scanProgress?.isScanning}
                >
                  + 添加文件夹
                </button>
                <button onClick={() => setShowPathsManager(false)}>✕</button>
              </div>
            </div>

            <div className="paths-manager-body">
              {libraryPaths.length === 0 ? (
                <div className="paths-manager-empty">
                  <div className="paths-empty-icon">📁</div>
                  <div className="paths-empty-text">暂无库路径</div>
                  <div className="paths-empty-hint">点击"+ 添加文件夹"扫描音乐库</div>
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
                            <span className="path-meta-tracks">♪ {path.trackCount} 首</span>
                          )}
                          {path.lastScanned && (
                            <span className="path-meta-time">
                              🕐{' '}
                              {new Date(path.lastScanned).toLocaleString('zh-CN', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          )}
                          {!path.lastScanned && <span className="path-meta-unscanned">未扫描</span>}
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
                          title="重新扫描此路径"
                        >
                          ↻
                        </button>
                        <button
                          className="path-item-action-btn path-item-remove"
                          onClick={async () => {
                            await musicLibraryService.removeLibraryPath(path.id);
                            await loadLibraryPaths();
                          }}
                          title="移除路径"
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
                管理音乐库扫描路径。点击"⊞ 添加文件夹"扫描新的音乐文件夹，会自动保存路径。
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 错误提示对话框 */}
      {errorMessage && (
        <ConfirmDialog
          isOpen={true}
          title="错误"
          message={errorMessage}
          confirmText="确定"
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
