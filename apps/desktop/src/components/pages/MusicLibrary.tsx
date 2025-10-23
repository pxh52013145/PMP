import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Track } from '../../services/audio';
import {
  musicLibraryService,
  LibraryStats,
  ScanProgress,
  ViewMode,
  LibraryPath,
} from '../../services/audio/MusicLibraryService';
import { ConfirmDialog } from '../magnet/ConfirmDialog';
import { useNavigation } from '../../contexts/NavigationContext';
import './MusicLibrary.css';

interface MusicLibraryProps {
  isOpen?: boolean;
  onClose?: () => void;
  onAddToQueue?: (tracks: Track[]) => void;
  onPlayNow?: (tracks: Track[]) => void;
  embedded?: boolean; // 是否嵌入模式（在NavigationPage中）
}

// ✅ 模块级缓存：跨组件实例共享，不会因为组件卸载而丢失
let moduleCache: {
  tracks: Track[];
  artists: string[];
  albums: { album: string; artist: string; cover?: string }[];
  genres: string[];
  timestamp: number;
} | null = null;

const CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

// 清除模块缓存
export function clearModuleCache() {
  moduleCache = null;
}

export const MusicLibrary: React.FC<MusicLibraryProps> = ({
  isOpen = true,
  onClose,
  onAddToQueue,
  onPlayNow,
  embedded = false,
}) => {
  const { navigateTo } = useNavigation();
  const [viewMode, setViewMode] = useState<ViewMode>('albums');
  const [searchQuery, setSearchQuery] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [artists, setArtists] = useState<string[]>([]);
  const [albums, setAlbums] = useState<{ album: string; artist: string; cover?: string }[]>([]);
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
  const [selectedAlbum] = useState<string | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [libraryPaths, setLibraryPaths] = useState<LibraryPath[]>([]);
  const [showPathsManager, setShowPathsManager] = useState(false);
  const [isRefreshingPermissions, setIsRefreshingPermissions] = useState(false);

  // 加载库数据
  const loadLibraryData = async () => {
    console.log('Loading library data...');

    // ✅ 立即显示模块缓存数据（如果有效）
    const now = Date.now();
    if (moduleCache && now - moduleCache.timestamp < CACHE_DURATION) {
      console.log('✅ Using module cache for instant display');
      setTracks(moduleCache.tracks);
      setArtists(moduleCache.artists);
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
    } else {
      const allTracks = await musicLibraryService.getAllTracks();
      setTracks(allTracks);
    }
  };

  // 获取过滤后的轨道
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

    return filtered;
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

        <div className="music-library-view-modes">
          <button
            className={`music-library-view-btn ${viewMode === 'all' ? 'active' : ''}`}
            onClick={() => setViewMode('all')}
          >
            All
          </button>
          <button
            className={`music-library-view-btn ${viewMode === 'albums' ? 'active' : ''}`}
            onClick={() => setViewMode('albums')}
          >
            Albums
          </button>
          <button
            className={`music-library-view-btn ${viewMode === 'artists' ? 'active' : ''}`}
            onClick={() => setViewMode('artists')}
          >
            Artists
          </button>
          <button
            className={`music-library-view-btn ${viewMode === 'genres' ? 'active' : ''}`}
            onClick={() => setViewMode('genres')}
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
        {viewMode !== 'all' && (
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

        <div className="music-library-main">
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
                  {albums.map(({ album, artist, cover }) => (
                    <div
                      key={`${album}-${artist}`}
                      className="music-library-album-card"
                      onClick={() => handleAlbumClick(album, artist)}
                      onDoubleClick={() => handlePlayAlbum(album)}
                      title={`单击查看专辑 / 双击播放`}
                    >
                      <div className="music-library-album-cover">
                        {cover ? <img src={cover} alt={album} /> : '◉'}
                      </div>
                      <div className="music-library-album-title">{album}</div>
                      <div className="music-library-album-artist">{artist}</div>
                    </div>
                  ))}
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
                      onDoubleClick={() => onPlayNow?.([track])}
                    >
                      <div className="music-library-track-number">{index + 1}</div>
                      <div className="music-library-track-title">{track.title}</div>
                      <div className="music-library-track-artist">{track.artist || '-'}</div>
                      <div className="music-library-track-album">{track.album || '-'}</div>
                      <div className="music-library-track-duration">
                        {track.duration ? formatDuration(track.duration) : '-'}
                      </div>
                      <div className="music-library-track-actions">
                        {onAddToQueue && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddToQueue([track]);
                            }}
                            title="添加到播放列表"
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
  return embedded ? libraryContent : createPortal(libraryContent, document.body);
};
