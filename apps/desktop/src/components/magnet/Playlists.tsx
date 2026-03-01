import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AudioState, Track, Playlist } from '../../services/audio';
import { musicLibraryService } from '../../services/audio/MusicLibraryService';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { InputDialog } from './InputDialog';
import { buildAddToPlaylistMenuItem } from './trackContextMenu';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { useT } from '../../i18n';
import './Playlists.css';

interface PlaylistsProps {
  isOpen: boolean;
  onClose: () => void;
}

const MAX_TRACKS = 200;

export const Playlists: React.FC<PlaylistsProps> = ({ isOpen, onClose }) => {
  const t = useT();
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
  const [trackContextMenu, setTrackContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

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

  useEffect(() => {
    if (!selectedPlaylist?.id) return;
    const nextSelectedPlaylist =
      audioState.playlists.find((item) => item.id === selectedPlaylist.id) ?? null;
    if (nextSelectedPlaylist !== selectedPlaylist) {
      setSelectedPlaylist(nextSelectedPlaylist);
    }
  }, [audioState.playlists, selectedPlaylist]);

  const loadAvailableTracks = async (query: string) => {
    try {
      setIsLoadingTracks(true);
      const q = query.trim();
      const tracks = q
        ? await musicLibraryService.searchTracks(q, MAX_TRACKS)
        : await musicLibraryService.getAllTracks(MAX_TRACKS);
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
    if (hours > 0) return t('pages.music-library.duration.hoursMinutes', { hours, minutes });
    return t('pages.music-library.duration.minutes', { minutes });
  };

  const getFilteredTracks = () => {
    return availableTracks;
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

  const handleTrackContextMenu = (
    playlist: Playlist,
    track: Track,
    trackIndex: number,
    event: React.MouseEvent
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const playlistReadonly = isReadonlyPlaylist(playlist);
    const addToPlaylistMenuItem = buildAddToPlaylistMenuItem({
      t,
      track,
      playlists: audioService.getPlaylists(),
      excludePlaylistId: playlist.id,
      onAddToPlaylist: (playlistId, trackToAdd) => {
        audioService.addTrackToPlaylist(playlistId, trackToAdd);
      },
    });

    const menuItems: ContextMenuItem[] = [
      {
        label: t('common.action.play'),
        icon: '>',
        onClick: () => handlePlayTrackFromPlaylist(playlist, trackIndex),
      },
      {
        label: t('common.action.addToQueue'),
        icon: '+',
        onClick: () => audioService.addToQueue(track),
      },
      addToPlaylistMenuItem,
      { divider: true },
      {
        label: t('pages.playlists.tracks.action.removeFromPlaylist.title'),
        icon: '×',
        danger: true,
        disabled: playlistReadonly,
        onClick: () => handleRemoveTrackFromPlaylist(playlist.id, trackIndex),
      },
    ];

    setTrackContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: menuItems,
    });
  };

  const selectedPlaylistReadonly = isReadonlyPlaylist(selectedPlaylist);

  if (!isOpen) return null;

  return createPortal(
    <div className="playlists-overlay" onClick={onClose}>
      <div className="playlists-container" onClick={(e) => e.stopPropagation()}>
        {/* 左侧：歌单列表 */}
        <div className="playlists-sidebar">
          <div className="playlists-sidebar-header">
            <h3 className="playlists-sidebar-title">♬ {t('pages.playlists.sidebar.title')}</h3>
            <button className="playlists-create-btn" onClick={() => setShowCreateDialog(true)}>
              ➕
            </button>
          </div>

          <div className="playlists-list">
            {audioState.playlists.length === 0 ? (
              <div className="playlists-empty">
                <div className="playlists-empty-icon">♬</div>
                <div className="playlists-empty-text">{t('pages.playlists.empty.title')}</div>
                <button className="playlists-empty-btn" onClick={() => setShowCreateDialog(true)}>
                  {t('pages.playlists.empty.action.createFirst')}
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
                    <div className="playlists-item-name-row">
                      <div className="playlists-item-name">{playlist.name}</div>
                      {renderPlaylistSourceBadge(playlist, 'playlists-item-source-badge')}
                    </div>
                    <div className="playlists-item-count">{t('pages.playlists.trackCount', { count: playlist.trackCount })}</div>
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
              {selectedPlaylist ? (
                <>
                  <span>{selectedPlaylist.name}</span>
                  {renderPlaylistSourceBadge(selectedPlaylist, 'playlists-detail-source-badge')}
                </>
              ) : (
                t('pages.playlists.detail.title')
              )}
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
                    <strong>{selectedPlaylist.trackCount}</strong> {t('pages.playlists.trackCount.unit')}
                  </span>
                  <span className="playlists-detail-stat">
                    <strong>{formatTotalDuration(selectedPlaylist.totalDuration)}</strong>
                  </span>
                </div>

                <div className="playlists-detail-actions">
                  <button
                    className="playlists-detail-btn"
                    onClick={() => handlePlayPlaylist(selectedPlaylist.id)}
                    disabled={selectedPlaylistReadonly || selectedPlaylist.trackCount === 0}
                  >
                    ▶ {t('common.action.play')}
                  </button>
                  <button
                    className="playlists-detail-btn"
                    onClick={() => handleAddPlaylistToQueue(selectedPlaylist.id)}
                    disabled={selectedPlaylist.trackCount === 0}
                  >
                    ➕ {t('common.action.addToQueue')}
                  </button>
                  <button
                    className="playlists-detail-btn"
                    onClick={() => setShowAddTrackModal(true)}
                    disabled={selectedPlaylistReadonly}
                  >
                    ➕ {t('pages.playlists.action.addTrack')}
                  </button>
                  <button
                    className="playlists-detail-btn"
                    onClick={() => {
                      setPlaylistToRename(selectedPlaylist);
                      setShowRenameDialog(true);
                    }}
                    disabled={selectedPlaylistReadonly}
                  >
                    ✏️ {t('common.action.rename')}
                  </button>
                  <button
                    className="playlists-detail-btn"
                    onClick={() => {
                      setPlaylistToClear(selectedPlaylist.id);
                      setShowClearConfirm(true);
                    }}
                    disabled={selectedPlaylist.trackCount === 0}
                  >
                    × {t('common.action.clear')}
                  </button>
                  <button
                    className="playlists-detail-btn playlists-delete-btn"
                    onClick={() => {
                      setPlaylistToDelete(selectedPlaylist.id);
                      setShowDeleteConfirm(true);
                    }}
                    disabled={selectedPlaylistReadonly}
                  >
                    × {t('pages.playlists.action.deletePlaylist')}
                  </button>
                </div>
              </div>

              <div className="playlists-tracks">
                {selectedPlaylist.trackCount === 0 ? (
                  <div className="playlists-tracks-empty">
                    <div className="playlists-tracks-empty-icon">♪</div>
                    <div className="playlists-tracks-empty-text">{t('pages.playlists.tracks.empty.title')}</div>
                    <button
                      className="playlists-tracks-empty-btn"
                      onClick={() => setShowAddTrackModal(true)}
                      disabled={selectedPlaylistReadonly}
                    >
                      {t('pages.playlists.tracks.empty.action.addTracks')}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="playlists-tracks-header">
                      <div>#</div>
                      <div>{t('pages.playlists.tracks.header.title')}</div>
                      <div>{t('pages.playlists.tracks.header.artist')}</div>
                      <div>{t('pages.playlists.tracks.header.album')}</div>
                      <div>{t('pages.playlists.tracks.header.duration')}</div>
                      <div>{t('pages.playlists.tracks.header.actions')}</div>
                    </div>
                    {selectedPlaylist.tracks.map((track, index) => (
                      <div
                        key={index}
                        className="playlists-track"
                        onContextMenu={(event) =>
                          handleTrackContextMenu(selectedPlaylist, track, index, event)
                        }
                      >
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
                            title={t('common.action.play')}
                          >
                            ▶
                          </button>
                          <button
                            className="playlists-track-action-btn playlists-track-remove"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveTrackFromPlaylist(selectedPlaylist.id, index);
                            }}
                            disabled={selectedPlaylistReadonly}
                            title={t('pages.playlists.tracks.action.removeFromPlaylist.title')}
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
                {audioState.playlists.length === 0
                  ? t('pages.playlists.noSelection.noPlaylists')
                  : t('pages.playlists.noSelection.selectPlaylist')}
              </div>
            </div>
          )}
        </div>

        {/* 添加歌曲模态框 */}
        {showAddTrackModal && selectedPlaylist && (
          <div className="playlists-add-modal-overlay" onClick={() => setShowAddTrackModal(false)}>
            <div className="playlists-add-modal" onClick={(e) => e.stopPropagation()}>
              <div className="playlists-add-modal-header">
                <h3>{t('pages.playlists.addTrackModal.title', { name: selectedPlaylist.name })}</h3>
                <button onClick={() => setShowAddTrackModal(false)}>✕</button>
              </div>

              <div className="playlists-add-modal-search">
                <input
                  type="text"
                  placeholder={t('pages.playlists.addTrackModal.search.placeholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="playlists-add-modal-tracks">
                {isLoadingTracks ? (
                  <div className="playlists-add-modal-empty">
                    <div>{t('common.state.loading')}</div>
                  </div>
                ) : availableTracks.length === 0 ? (
                  <div className="playlists-add-modal-empty">
                    <div>{t('pages.playlists.addTrackModal.empty.libraryTitle')}</div>
                    <div>{t('pages.playlists.addTrackModal.empty.libraryHint')}</div>
                  </div>
                ) : (
                  getFilteredTracks().map((track) => (
                    <div key={track.id} className="playlists-add-modal-track">
                      <div className="playlists-add-modal-track-info">
                        <div className="playlists-add-modal-track-title">{track.title}</div>
                        <div className="playlists-add-modal-track-artist">
                          {track.artist || t('common.unknown.artist')}
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
                        ➕ {t('common.action.add')}
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="playlists-add-modal-footer">
                <span>{t('pages.playlists.addTrackModal.footerHint', { count: MAX_TRACKS })}</span>
              </div>
            </div>
          </div>
        )}

        {/* 对话框 */}
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
          defaultValue={playlistToRename?.name || ''}
          placeholder={t('pages.playlists.dialog.rename.placeholder')}
          confirmText={t('common.action.ok')}
          onConfirm={handleRenamePlaylist}
          onCancel={() => {
            setShowRenameDialog(false);
            setPlaylistToRename(null);
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

        {trackContextMenu && (
          <ContextMenu
            x={trackContextMenu.x}
            y={trackContextMenu.y}
            items={trackContextMenu.items}
            onClose={() => setTrackContextMenu(null)}
          />
        )}
      </div>
    </div>,
    document.body
  );
};
