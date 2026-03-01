import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AudioState, Playlist, Track } from '../../services/audio';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { useT } from '../../i18n';
import { musicLibraryService } from '../../services/audio/MusicLibraryService';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { InputDialog } from './InputDialog';
import { buildPlaylistTrackContextMenu } from './trackContextMenu';
import './Playlists.css';

interface PlaylistsProps {
  isOpen: boolean;
  onClose: () => void;
}

type PlaylistTrackSort =
  | 'default'
  | 'title'
  | 'artist'
  | 'album'
  | 'durationAsc'
  | 'durationDesc';

type PlaylistTrackEntry = {
  track: Track;
  index: number;
  key: string;
};

const MAX_TRACKS = 200;
const PLAYLIST_CUSTOM_COVER_STORAGE_KEY = 'pmp.playlists.customCoverById.v1';

const makeTrackKey = (track: Track, index: number): string => `${track.id}::${index}`;

const safeParseRecord = (raw: string | null): Record<string, string> => {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        continue;
      }
      const normalizedKey = key.trim();
      const normalizedValue = value.trim();
      if (!normalizedKey || !normalizedValue) {
        continue;
      }
      result[normalizedKey] = normalizedValue;
    }

    return result;
  } catch {
    return {};
  }
};

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
  const [showCoverDialog, setShowCoverDialog] = useState(false);

  const [playlistToDelete, setPlaylistToDelete] = useState<string | null>(null);
  const [playlistToRename, setPlaylistToRename] = useState<Playlist | null>(null);
  const [playlistToClear, setPlaylistToClear] = useState<string | null>(null);

  const [playlistTrackSearchQuery, setPlaylistTrackSearchQuery] = useState('');
  const [playlistTrackSort, setPlaylistTrackSort] = useState<PlaylistTrackSort>('default');
  const [playlistBatchMode, setPlaylistBatchMode] = useState(false);
  const [selectedTrackKeys, setSelectedTrackKeys] = useState<string[]>([]);

  const [customCoverById, setCustomCoverById] = useState<Record<string, string>>({});

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
    const parsed = safeParseRecord(window.localStorage.getItem(PLAYLIST_CUSTOM_COVER_STORAGE_KEY));
    setCustomCoverById(parsed);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PLAYLIST_CUSTOM_COVER_STORAGE_KEY, JSON.stringify(customCoverById));
  }, [customCoverById]);

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

  useEffect(() => {
    setSelectedTrackKeys([]);
    setTrackContextMenu(null);
  }, [selectedPlaylist?.id, selectedPlaylist?.updatedAt]);

  const loadAvailableTracks = async (query: string) => {
    try {
      setIsLoadingTracks(true);
      const normalizedQuery = query.trim();
      const tracks = normalizedQuery
        ? await musicLibraryService.searchTracks(normalizedQuery, MAX_TRACKS)
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
    if (!playlistToDelete) {
      return;
    }

    audioService.deletePlaylist(playlistToDelete);
    if (selectedPlaylist?.id === playlistToDelete) {
      setSelectedPlaylist(null);
    }
    setShowDeleteConfirm(false);
    setPlaylistToDelete(null);
  };

  const handleRenamePlaylist = (newName: string) => {
    if (!playlistToRename) {
      return;
    }

    audioService.renamePlaylist(playlistToRename.id, newName);
    setShowRenameDialog(false);
    setPlaylistToRename(null);
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
    if (!playlistToClear) {
      return;
    }

    audioService.clearPlaylist(playlistToClear);
    setShowClearConfirm(false);
    setPlaylistToClear(null);
    setSelectedTrackKeys([]);
  };

  const handleAddTrackToPlaylist = (track: Track) => {
    if (!selectedPlaylist) {
      return;
    }
    audioService.addTrackToPlaylist(selectedPlaylist.id, track);
  };

  const handlePlayTrackFromPlaylist = (playlist: Playlist, trackIndex: number) => {
    audioService.clearQueue();
    audioService.addMultipleToQueue(playlist.tracks);
    void audioService.playTrackAtIndex(trackIndex).catch((error) => {
      console.error('[Playlists] Failed to play track:', error);
    });
  };

  const handleSetPlaylistCover = (playlistId: string, coverUrl: string) => {
    const normalizedCoverUrl = coverUrl.trim();
    if (!normalizedCoverUrl) {
      return;
    }

    setCustomCoverById((previous) => ({
      ...previous,
      [playlistId]: normalizedCoverUrl,
    }));
  };

  const handleResetPlaylistCover = (playlistId: string) => {
    setCustomCoverById((previous) => {
      if (!previous[playlistId]) {
        return previous;
      }

      const next = { ...previous };
      delete next[playlistId];
      return next;
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

  const getPlaylistCoverUrl = (playlist: Playlist | null): string => {
    if (!playlist) {
      return '';
    }

    const customCover = typeof customCoverById[playlist.id] === 'string' ? customCoverById[playlist.id] : '';
    if (customCover.trim()) {
      return customCover.trim();
    }

    if (typeof playlist.coverUrl === 'string' && playlist.coverUrl.trim()) {
      return playlist.coverUrl.trim();
    }

    const fallbackFromTrack = playlist.tracks.find((item) => typeof item.coverUrl === 'string' && item.coverUrl.trim());
    if (!fallbackFromTrack) {
      return '';
    }

    return String(fallbackFromTrack.coverUrl ?? '').trim();
  };

  const selectedPlaylistReadonly = isReadonlyPlaylist(selectedPlaylist);

  const filteredPlaylistTrackEntries = useMemo<PlaylistTrackEntry[]>(() => {
    if (!selectedPlaylist) {
      return [];
    }

    const entries = selectedPlaylist.tracks.map((track, index) => ({
      track,
      index,
      key: makeTrackKey(track, index),
    }));

    const normalizedQuery = playlistTrackSearchQuery.trim().toLocaleLowerCase();
    const queryFiltered = normalizedQuery
      ? entries.filter((entry) => {
          const title = String(entry.track.title || '').toLocaleLowerCase();
          const artist = String(entry.track.artist || '').toLocaleLowerCase();
          const album = String(entry.track.album || '').toLocaleLowerCase();
          return (
            title.includes(normalizedQuery) ||
            artist.includes(normalizedQuery) ||
            album.includes(normalizedQuery)
          );
        })
      : entries;

    if (playlistTrackSort === 'default') {
      return queryFiltered;
    }

    const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    const sorted = [...queryFiltered];

    sorted.sort((a, b) => {
      if (playlistTrackSort === 'title') {
        return collator.compare(a.track.title || '', b.track.title || '');
      }

      if (playlistTrackSort === 'artist') {
        return collator.compare(a.track.artist || '', b.track.artist || '');
      }

      if (playlistTrackSort === 'album') {
        return collator.compare(a.track.album || '', b.track.album || '');
      }

      if (playlistTrackSort === 'durationAsc') {
        return (a.track.duration ?? 0) - (b.track.duration ?? 0);
      }

      if (playlistTrackSort === 'durationDesc') {
        return (b.track.duration ?? 0) - (a.track.duration ?? 0);
      }

      return a.index - b.index;
    });

    return sorted;
  }, [selectedPlaylist, playlistTrackSearchQuery, playlistTrackSort]);

  const selectedTrackEntryList = useMemo<PlaylistTrackEntry[]>(() => {
    if (!selectedPlaylist) {
      return [];
    }

    const selectedKeySet = new Set(selectedTrackKeys);
    return selectedPlaylist.tracks
      .map((track, index) => ({ track, index, key: makeTrackKey(track, index) }))
      .filter((entry) => selectedKeySet.has(entry.key));
  }, [selectedPlaylist, selectedTrackKeys]);

  const selectedTrackCount = selectedTrackEntryList.length;

  const handleToggleTrackSelection = (key: string, checked: boolean) => {
    setSelectedTrackKeys((previous) => {
      const next = new Set(previous);
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return Array.from(next);
    });
  };

  const handleSelectAllFilteredTracks = () => {
    setSelectedTrackKeys((previous) => {
      const next = new Set(previous);
      for (const entry of filteredPlaylistTrackEntries) {
        next.add(entry.key);
      }
      return Array.from(next);
    });
  };

  const handleClearTrackSelection = () => {
    setSelectedTrackKeys([]);
  };

  const handleBatchAddToQueue = () => {
    if (selectedTrackEntryList.length === 0) {
      return;
    }
    audioService.addMultipleToQueue(selectedTrackEntryList.map((item) => item.track));
  };

  const handleBatchRemoveFromPlaylist = () => {
    if (!selectedPlaylist || selectedTrackEntryList.length === 0 || selectedPlaylistReadonly) {
      return;
    }

    const sortedIndexes = selectedTrackEntryList
      .map((entry) => entry.index)
      .sort((left, right) => right - left);

    for (const index of sortedIndexes) {
      audioService.removeTrackFromPlaylist(selectedPlaylist.id, index);
    }

    setSelectedTrackKeys([]);
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
      playlists: audioService.getPlaylists(),
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

          <div className="playlists-list">
            {audioState.playlists.length === 0 ? (
              <div className="playlists-empty">
                <div className="playlists-empty-icon">♪</div>
                <div className="playlists-empty-text">{t('pages.playlists.empty.title')}</div>
                <button className="playlists-empty-btn" onClick={() => setShowCreateDialog(true)}>
                  {t('pages.playlists.empty.action.createFirst')}
                </button>
              </div>
            ) : (
              audioState.playlists.map((playlist) => {
                const coverUrl = getPlaylistCoverUrl(playlist);
                return (
                  <div
                    key={playlist.id}
                    className={`playlists-item ${selectedPlaylist?.id === playlist.id ? 'playlists-item-active' : ''}`}
                    onClick={() => setSelectedPlaylist(playlist)}
                  >
                    <div className="playlists-item-icon">
                      {coverUrl ? (
                        <img className="playlists-item-cover-image" src={coverUrl} alt={playlist.name} />
                      ) : (
                        <span className="playlists-item-cover-fallback">♪</span>
                      )}
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
              })
            )}
          </div>
        </div>

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
              ×
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
                    disabled={selectedPlaylist.trackCount === 0}
                  >
                    {t('common.action.play')}
                  </button>
                  <button
                    className="playlists-detail-btn"
                    onClick={() => handleAddPlaylistToQueue(selectedPlaylist.id)}
                    disabled={selectedPlaylist.trackCount === 0}
                  >
                    {t('common.action.addToQueue')}
                  </button>
                  <button
                    className="playlists-detail-btn"
                    onClick={() => setShowAddTrackModal(true)}
                    disabled={selectedPlaylistReadonly}
                  >
                    {t('pages.playlists.action.addTrack')}
                  </button>
                  <button
                    className="playlists-detail-btn"
                    onClick={() => {
                      setPlaylistToRename(selectedPlaylist);
                      setShowRenameDialog(true);
                    }}
                    disabled={selectedPlaylistReadonly}
                  >
                    {t('common.action.rename')}
                  </button>
                  <button
                    className="playlists-detail-btn"
                    onClick={() => setShowCoverDialog(true)}
                    disabled={selectedPlaylistReadonly}
                  >
                    {t('pages.playlists.editor.cover.set')}
                  </button>
                  <button
                    className="playlists-detail-btn"
                    onClick={() => handleResetPlaylistCover(selectedPlaylist.id)}
                    disabled={selectedPlaylistReadonly || !customCoverById[selectedPlaylist.id]}
                  >
                    {t('pages.playlists.editor.cover.reset')}
                  </button>
                  <button
                    className="playlists-detail-btn"
                    onClick={() => {
                      setPlaylistToClear(selectedPlaylist.id);
                      setShowClearConfirm(true);
                    }}
                    disabled={selectedPlaylist.trackCount === 0}
                  >
                    {t('common.action.clear')}
                  </button>
                  <button
                    className="playlists-detail-btn playlists-delete-btn"
                    onClick={() => {
                      setPlaylistToDelete(selectedPlaylist.id);
                      setShowDeleteConfirm(true);
                    }}
                    disabled={selectedPlaylistReadonly}
                  >
                    {t('pages.playlists.action.deletePlaylist')}
                  </button>
                </div>
              </div>

              <div className="playlists-detail-editor-row">
                <div className="playlists-detail-cover-card">
                  <div className="playlists-detail-cover-preview">
                    {getPlaylistCoverUrl(selectedPlaylist) ? (
                      <img
                        src={getPlaylistCoverUrl(selectedPlaylist)}
                        alt={selectedPlaylist.name}
                        className="playlists-detail-cover-image"
                      />
                    ) : (
                      <span className="playlists-detail-cover-fallback">♪</span>
                    )}
                  </div>
                  <div className="playlists-detail-cover-meta">
                    <div className="playlists-detail-cover-title">{t('pages.playlists.editor.cover.title')}</div>
                    <div className="playlists-detail-cover-hint">{t('pages.playlists.editor.cover.hint')}</div>
                  </div>
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
                    <div className="playlists-tracks-manage">
                      <input
                        className="playlists-tracks-search"
                        type="text"
                        value={playlistTrackSearchQuery}
                        onChange={(event) => setPlaylistTrackSearchQuery(event.target.value)}
                        placeholder={t('pages.playlists.manage.search.placeholder')}
                      />
                      <select
                        className="playlists-tracks-sort"
                        value={playlistTrackSort}
                        onChange={(event) => setPlaylistTrackSort(event.target.value as PlaylistTrackSort)}
                      >
                        <option value="default">{t('pages.playlists.manage.sort.default')}</option>
                        <option value="title">{t('pages.playlists.manage.sort.title')}</option>
                        <option value="artist">{t('pages.playlists.manage.sort.artist')}</option>
                        <option value="album">{t('pages.playlists.manage.sort.album')}</option>
                        <option value="durationAsc">{t('pages.playlists.manage.sort.durationAsc')}</option>
                        <option value="durationDesc">{t('pages.playlists.manage.sort.durationDesc')}</option>
                      </select>
                      <button
                        className="playlists-detail-btn"
                        onClick={() => {
                          setPlaylistBatchMode((previous) => {
                            const next = !previous;
                            if (!next) {
                              setSelectedTrackKeys([]);
                            }
                            return next;
                          });
                        }}
                      >
                        {playlistBatchMode
                          ? t('pages.playlists.manage.batch.exit')
                          : t('pages.playlists.manage.batch.enter')}
                      </button>

                      <span className="playlists-tracks-filter-count">
                        {t('pages.playlists.manage.resultCount', {
                          count: filteredPlaylistTrackEntries.length,
                        })}
                      </span>
                    </div>

                    {playlistBatchMode ? (
                      <div className="playlists-tracks-batch-actions">
                        <span className="playlists-tracks-batch-count">
                          {t('pages.playlists.manage.batch.selectedCount', {
                            count: selectedTrackCount,
                          })}
                        </span>
                        <button
                          className="playlists-detail-btn"
                          onClick={handleSelectAllFilteredTracks}
                          disabled={filteredPlaylistTrackEntries.length === 0}
                        >
                          {t('pages.playlists.manage.batch.selectAll')}
                        </button>
                        <button
                          className="playlists-detail-btn"
                          onClick={handleClearTrackSelection}
                          disabled={selectedTrackCount === 0}
                        >
                          {t('pages.playlists.manage.batch.clearSelection')}
                        </button>
                        <button
                          className="playlists-detail-btn"
                          onClick={handleBatchAddToQueue}
                          disabled={selectedTrackCount === 0}
                        >
                          {t('pages.playlists.manage.batch.addToQueue')}
                        </button>
                        <button
                          className="playlists-detail-btn playlists-delete-btn"
                          onClick={handleBatchRemoveFromPlaylist}
                          disabled={selectedPlaylistReadonly || selectedTrackCount === 0}
                        >
                          {t('pages.playlists.manage.batch.removeFromPlaylist')}
                        </button>
                      </div>
                    ) : null}

                    {filteredPlaylistTrackEntries.length === 0 ? (
                      <div className="playlists-tracks-empty playlists-tracks-empty-query">
                        <div className="playlists-tracks-empty-text">
                          {t('pages.playlists.tracks.empty.searchResult')}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div
                          className={`playlists-tracks-header ${playlistBatchMode ? 'playlists-tracks-header-batch' : ''}`}
                        >
                          {playlistBatchMode ? <div>{t('pages.playlists.manage.batch.selectColumn')}</div> : null}
                          <div>#</div>
                          <div>{t('pages.playlists.tracks.header.title')}</div>
                          <div>{t('pages.playlists.tracks.header.artist')}</div>
                          <div>{t('pages.playlists.tracks.header.album')}</div>
                          <div>{t('pages.playlists.tracks.header.duration')}</div>
                          <div>{t('pages.playlists.tracks.header.actions')}</div>
                        </div>

                        {filteredPlaylistTrackEntries.map((entry) => {
                          const isSelected = selectedTrackKeys.includes(entry.key);

                          return (
                            <div
                              key={entry.key}
                              className={`playlists-track ${playlistBatchMode ? 'playlists-track-batch' : ''} ${isSelected ? 'playlists-track-selected' : ''}`}
                              onContextMenu={(event) =>
                                handleTrackContextMenu(selectedPlaylist, entry.track, entry.index, event)
                              }
                              onDoubleClick={() => handlePlayTrackFromPlaylist(selectedPlaylist, entry.index)}
                            >
                              {playlistBatchMode ? (
                                <div className="playlists-track-select">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(event) =>
                                      handleToggleTrackSelection(entry.key, event.target.checked)
                                    }
                                    onClick={(event) => event.stopPropagation()}
                                  />
                                </div>
                              ) : null}

                              <div className="playlists-track-number">
                                {String(entry.index + 1).padStart(2, '0')}
                              </div>
                              <div className="playlists-track-title">{entry.track.title}</div>
                              <div className="playlists-track-artist">{entry.track.artist || '-'}</div>
                              <div className="playlists-track-album">{entry.track.album || '-'}</div>
                              <div className="playlists-track-duration">
                                {entry.track.duration ? formatDuration(entry.track.duration) : '-'}
                              </div>
                              <div className="playlists-track-actions">
                                <button
                                  className="playlists-track-action-btn playlists-track-play"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handlePlayTrackFromPlaylist(selectedPlaylist, entry.index);
                                  }}
                                  title={t('common.action.play')}
                                >
                                  ▶
                                </button>
                                <button
                                  className="playlists-track-action-btn playlists-track-remove"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleRemoveTrackFromPlaylist(selectedPlaylist.id, entry.index);
                                  }}
                                  disabled={selectedPlaylistReadonly}
                                  title={t('pages.playlists.tracks.action.removeFromPlaylist.title')}
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="playlists-no-selection">
              <div className="playlists-no-selection-icon">♪</div>
              <div className="playlists-no-selection-text">
                {audioState.playlists.length === 0
                  ? t('pages.playlists.noSelection.noPlaylists')
                  : t('pages.playlists.noSelection.selectPlaylist')}
              </div>
            </div>
          )}
        </div>

        {showAddTrackModal && selectedPlaylist && (
          <div className="playlists-add-modal-overlay" onClick={() => setShowAddTrackModal(false)}>
            <div className="playlists-add-modal" onClick={(event) => event.stopPropagation()}>
              <div className="playlists-add-modal-header">
                <h3>{t('pages.playlists.addTrackModal.title', { name: selectedPlaylist.name })}</h3>
                <button onClick={() => setShowAddTrackModal(false)}>×</button>
              </div>

              <div className="playlists-add-modal-search">
                <input
                  type="text"
                  placeholder={t('pages.playlists.addTrackModal.search.placeholder')}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
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
                        {t('common.action.add')}
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

        <InputDialog
          isOpen={showCoverDialog}
          title={t('pages.playlists.editor.cover.dialog.title')}
          message={t('pages.playlists.editor.cover.dialog.message')}
          defaultValue={getPlaylistCoverUrl(selectedPlaylist)}
          placeholder={t('pages.playlists.editor.cover.dialog.placeholder')}
          confirmText={t('common.action.save')}
          onConfirm={(value) => {
            if (!selectedPlaylist) {
              return;
            }
            handleSetPlaylistCover(selectedPlaylist.id, value);
            setShowCoverDialog(false);
          }}
          onCancel={() => setShowCoverDialog(false)}
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
