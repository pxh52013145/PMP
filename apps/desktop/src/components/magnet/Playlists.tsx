import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AudioState, Track, Playlist } from '../../services/audio';
import { musicLibraryService } from '../../services/audio/MusicLibraryService';
import { ConfirmDialog } from './ConfirmDialog';
import { InputDialog } from './InputDialog';
import { useAudioService } from '../../contexts/AudioEngineContext';
import './Playlists.css';

interface PlaylistsProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Playlists: React.FC<PlaylistsProps> = ({ isOpen, onClose }) => {
  const audioService = useAudioService();
  const [audioState, setAudioState] = useState<AudioState>(audioService.getState());
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [showAddTrackModal, setShowAddTrackModal] = useState(false);
  const [availableTracks, setAvailableTracks] = useState<Track[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingTracks, setIsLoadingTracks] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [playlistToDelete, setPlaylistToDelete] = useState<string | null>(null);
  const [playlistToRename, setPlaylistToRename] = useState<Playlist | null>(null);
  const [playlistToClear, setPlaylistToClear] = useState<string | null>(null);

  useEffect(() => {
    setAudioState(audioService.getState());
    setSelectedPlaylist(null);
    setShowAddTrackModal(false);
    setSearchQuery('');
    const unsubscribe = audioService.onStateChange(setAudioState);
    return unsubscribe;
  }, [audioService]);

  useEffect(() => {
    if (!showAddTrackModal) return;
    const handle = setTimeout(() => {
      void loadAvailableTracks(searchQuery);
    }, 200);
    return () => clearTimeout(handle);
  }, [searchQuery, showAddTrackModal]);

  const loadAvailableTracks = async (query: string) => {
    try {
      setIsLoadingTracks(true);
      const q = query.trim();
      const tracks = q
        ? await musicLibraryService.searchTracks(q, 200)
        : await musicLibraryService.getAllTracks(200);
      setAvailableTracks(tracks);
    } catch (error) {
      console.error('Failed to load tracks:', error);
    } finally {
      setIsLoadingTracks(false);
    }
  };

  const handleCreatePlaylist = (name: string) => {
    audioService.createPlaylist(name);
    setShowCreateDialog(false);
  };

  const handleDeletePlaylist = () => {
    if (playlistToDelete) {
      audioService.deletePlaylist(playlistToDelete);
      if (selectedPlaylist?.id === playlistToDelete) {
        setSelectedPlaylist(null);
      }
      setShowDeleteConfirm(false);
      setPlaylistToDelete(null);
    }
  };

  const handleRenamePlaylist = (newName: string) => {
    if (playlistToRename) {
      audioService.renamePlaylist(playlistToRename.id, newName);
      setShowRenameDialog(false);
      setPlaylistToRename(null);
    }
  };

  const handlePlayPlaylist = (playlistId: string) => {
    audioService.playPlaylist(playlistId);
  };

  const handleAddPlaylistToQueue = (playlistId: string) => {
    audioService.addPlaylistToQueue(playlistId);
  };

  const handleRemoveTrackFromPlaylist = (playlistId: string, trackIndex: number) => {
    audioService.removeTrackFromPlaylist(playlistId, trackIndex);
  };

  const handleClearPlaylist = () => {
    if (playlistToClear) {
      audioService.clearPlaylist(playlistToClear);
      setShowClearConfirm(false);
      setPlaylistToClear(null);
    }
  };

  const handleAddTrackToPlaylist = (track: Track) => {
    if (selectedPlaylist) {
      audioService.addTrackToPlaylist(selectedPlaylist.id, track);
    }
  };

  const handlePlayTrackFromPlaylist = (playlist: Playlist, trackIndex: number) => {
    audioService.clearQueue();
    audioService.addMultipleToQueue(playlist.tracks);
    void audioService.playTrackAtIndex(trackIndex).catch((error) => {
      console.error('[Playlists] Failed to play track:', error);
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
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  const getFilteredTracks = () => {
    return availableTracks;
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="playlists-overlay" onClick={onClose}>
      <div className="playlists-container" onClick={(e) => e.stopPropagation()}>
        {/* 左侧：歌单列表 */}
        <div className="playlists-sidebar">
          <div className="playlists-sidebar-header">
            <h3 className="playlists-sidebar-title">♬ 我的歌单</h3>
            <button className="playlists-create-btn" onClick={() => setShowCreateDialog(true)}>
              ➕
            </button>
          </div>

          <div className="playlists-list">
            {audioState.playlists.length === 0 ? (
              <div className="playlists-empty">
                <div className="playlists-empty-icon">♬</div>
                <div className="playlists-empty-text">暂无歌单</div>
                <button className="playlists-empty-btn" onClick={() => setShowCreateDialog(true)}>
                  创建第一个歌单
                </button>
              </div>
            ) : (
              audioState.playlists.map((playlist) => (
                <div
                  key={playlist.id}
                  className={`playlists-item ${selectedPlaylist?.id === playlist.id ? 'playlists-item-active' : ''}`}
                  onClick={() => setSelectedPlaylist(playlist)}
                >
                  <div className="playlists-item-icon">♪</div>
                  <div className="playlists-item-info">
                    <div className="playlists-item-name">{playlist.name}</div>
                    <div className="playlists-item-count">{playlist.trackCount} 首歌曲</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 右侧：歌单详情 */}
        <div className="playlists-detail">
          <div className="playlists-detail-header">
            <h2 className="playlists-detail-title">
              {selectedPlaylist ? selectedPlaylist.name : '歌单管理'}
            </h2>
            <button className="playlists-close-btn" onClick={onClose}>
              ✕
            </button>
          </div>

          {selectedPlaylist ? (
            <>
              <div className="playlists-detail-toolbar">
                <div className="playlists-detail-info">
                  <span className="playlists-detail-stat">
                    <strong>{selectedPlaylist.trackCount}</strong> 首歌曲
                  </span>
                  <span className="playlists-detail-stat">
                    <strong>{formatTotalDuration(selectedPlaylist.totalDuration)}</strong>
                  </span>
                </div>

                <div className="playlists-detail-actions">
                  <button
                    className="playlists-detail-btn"
                    onClick={() => handlePlayPlaylist(selectedPlaylist.id)}
                    disabled={selectedPlaylist.trackCount === 0}
                  >
                    ▶ 播放
                  </button>
                  <button
                    className="playlists-detail-btn"
                    onClick={() => handleAddPlaylistToQueue(selectedPlaylist.id)}
                    disabled={selectedPlaylist.trackCount === 0}
                  >
                    ➕ 添加到队列
                  </button>
                  <button
                    className="playlists-detail-btn"
                    onClick={() => setShowAddTrackModal(true)}
                  >
                    ➕ 添加歌曲
                  </button>
                  <button
                    className="playlists-detail-btn"
                    onClick={() => {
                      setPlaylistToRename(selectedPlaylist);
                      setShowRenameDialog(true);
                    }}
                  >
                    ✏️ 重命名
                  </button>
                  <button
                    className="playlists-detail-btn"
                    onClick={() => {
                      setPlaylistToClear(selectedPlaylist.id);
                      setShowClearConfirm(true);
                    }}
                    disabled={selectedPlaylist.trackCount === 0}
                  >
                    × 清空
                  </button>
                  <button
                    className="playlists-detail-btn playlists-delete-btn"
                    onClick={() => {
                      setPlaylistToDelete(selectedPlaylist.id);
                      setShowDeleteConfirm(true);
                    }}
                  >
                    × 删除歌单
                  </button>
                </div>
              </div>

              <div className="playlists-tracks">
                {selectedPlaylist.trackCount === 0 ? (
                  <div className="playlists-tracks-empty">
                    <div className="playlists-tracks-empty-icon">♪</div>
                    <div className="playlists-tracks-empty-text">歌单为空</div>
                    <button
                      className="playlists-tracks-empty-btn"
                      onClick={() => setShowAddTrackModal(true)}
                    >
                      添加歌曲到歌单
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="playlists-tracks-header">
                      <div>#</div>
                      <div>标题</div>
                      <div>艺术家</div>
                      <div>专辑</div>
                      <div>时长</div>
                      <div>操作</div>
                    </div>
                    {selectedPlaylist.tracks.map((track, index) => (
                      <div key={index} className="playlists-track">
                        <div className="playlists-track-number">
                          {String(index + 1).padStart(2, '0')}
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
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlayTrackFromPlaylist(selectedPlaylist, index);
                            }}
                            title="播放"
                          >
                            ▶
                          </button>
                          <button
                            className="playlists-track-action-btn playlists-track-remove"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveTrackFromPlaylist(selectedPlaylist.id, index);
                            }}
                            title="从歌单移除"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="playlists-no-selection">
              <div className="playlists-no-selection-icon">♬</div>
              <div className="playlists-no-selection-text">
                {audioState.playlists.length === 0 ? '创建你的第一个歌单' : '选择一个歌单查看详情'}
              </div>
            </div>
          )}
        </div>

        {/* 添加歌曲模态框 */}
        {showAddTrackModal && selectedPlaylist && (
          <div className="playlists-add-modal-overlay" onClick={() => setShowAddTrackModal(false)}>
            <div className="playlists-add-modal" onClick={(e) => e.stopPropagation()}>
              <div className="playlists-add-modal-header">
                <h3>添加歌曲到「{selectedPlaylist.name}」</h3>
                <button onClick={() => setShowAddTrackModal(false)}>✕</button>
              </div>

              <div className="playlists-add-modal-search">
                <input
                  type="text"
                  placeholder="搜索歌曲..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="playlists-add-modal-tracks">
                {isLoadingTracks ? (
                  <div className="playlists-add-modal-empty">
                    <div>加载中...</div>
                  </div>
                ) : availableTracks.length === 0 ? (
                  <div className="playlists-add-modal-empty">
                    <div>音乐库为空</div>
                    <div>请先在音乐库中添加音乐文件</div>
                  </div>
                ) : (
                  getFilteredTracks().map((track) => (
                    <div key={track.id} className="playlists-add-modal-track">
                      <div className="playlists-add-modal-track-info">
                        <div className="playlists-add-modal-track-title">{track.title}</div>
                        <div className="playlists-add-modal-track-artist">
                          {track.artist || '未知艺术家'}
                        </div>
                      </div>
                      <button
                        className="playlists-add-modal-track-btn"
                        onClick={() => {
                          handleAddTrackToPlaylist(track);
                          setShowAddTrackModal(false);
                          setSearchQuery('');
                        }}
                      >
                        ➕ 添加
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="playlists-add-modal-footer">
                <span>最多显示 200 首（建议用搜索）</span>
              </div>
            </div>
          </div>
        )}

        {/* 对话框 */}
        <InputDialog
          isOpen={showCreateDialog}
          title="创建歌单"
          placeholder="请输入歌单名称"
          confirmText="创建"
          onConfirm={handleCreatePlaylist}
          onCancel={() => setShowCreateDialog(false)}
        />

        <InputDialog
          isOpen={showRenameDialog}
          title="重命名歌单"
          defaultValue={playlistToRename?.name || ''}
          placeholder="请输入新的歌单名称"
          confirmText="确定"
          onConfirm={handleRenamePlaylist}
          onCancel={() => {
            setShowRenameDialog(false);
            setPlaylistToRename(null);
          }}
        />

        <ConfirmDialog
          isOpen={showDeleteConfirm}
          title="删除歌单"
          message={`确定要删除歌单吗？此操作无法撤销。`}
          confirmText="删除"
          cancelText="取消"
          confirmButtonStyle="danger"
          onConfirm={handleDeletePlaylist}
          onCancel={() => {
            setShowDeleteConfirm(false);
            setPlaylistToDelete(null);
          }}
        />

        <ConfirmDialog
          isOpen={showClearConfirm}
          title="清空歌单"
          message="确定要清空此歌单的所有歌曲吗？此操作无法撤销。"
          confirmText="清空"
          cancelText="取消"
          confirmButtonStyle="danger"
          onConfirm={handleClearPlaylist}
          onCancel={() => {
            setShowClearConfirm(false);
            setPlaylistToClear(null);
          }}
        />
      </div>
    </div>,
    document.body
  );
};
