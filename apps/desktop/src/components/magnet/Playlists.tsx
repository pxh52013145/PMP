import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AudioState, Playlist, Track } from '../../services/audio';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { useT } from '../../i18n';
import { musicLibraryService } from '../../services/audio/MusicLibraryService';
import { resolveBilibiliCoverAssetUrl, searchBilibiliResourceByBvid } from '../../modules/music-platform';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { InputDialog } from './InputDialog';
import { buildPlaylistTrackContextMenu } from './trackContextMenu';
import './Playlists.css';

interface PlaylistsProps {
  isOpen: boolean;
  onClose: () => void;
}

type PlaylistTrackSortField = 'default' | 'title' | 'artist' | 'album' | 'duration';

type PlaylistTrackSortDirection = 'asc' | 'desc';

type PlaylistTrackEntry = {
  track: Track;
  index: number;
  key: string;
};

type PopupMenuState = {
  x: number;
  y: number;
  items: ContextMenuItem[];
};

const makeTrackKey = (track: Track, index: number): string => `${track.id}::${index}`;

const BILIBILI_BVID_PATTERN = /BV[0-9A-Za-z]{10}/i;

const isBilibiliConnectorId = (value: string | null | undefined): boolean => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized) return false;
  return normalized.includes('bilibili');
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

export const Playlists: React.FC<PlaylistsProps> = ({ isOpen, onClose }) => {
  const t = useT();
  const audioService = useAudioService();

  const [audioState, setAudioState] = useState<AudioState>(audioService.getState());
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const [playlistToDelete, setPlaylistToDelete] = useState<string | null>(null);
  const [playlistToRename, setPlaylistToRename] = useState<Playlist | null>(null);
  const [playlistToClear, setPlaylistToClear] = useState<string | null>(null);

  const [playlistTrackSearchQuery, setPlaylistTrackSearchQuery] = useState('');
  const [playlistTrackSortField, setPlaylistTrackSortField] =
    useState<PlaylistTrackSortField>('default');
  const [playlistTrackSortDirection, setPlaylistTrackSortDirection] =
    useState<PlaylistTrackSortDirection>('asc');
  const [showPlaylistTrackSearch, setShowPlaylistTrackSearch] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [playlistBatchMode, setPlaylistBatchMode] = useState(false);
  const [selectedTrackKeys, setSelectedTrackKeys] = useState<string[]>([]);
  const [resolvedPlaylistCoverMap, setResolvedPlaylistCoverMap] = useState<Record<string, string>>({});
  const pendingPlaylistCoverIdsRef = useRef<Set<string>>(new Set());
  const playlistTrackSearchControlRef = useRef<HTMLDivElement | null>(null);
  const playlistTrackSearchInputRef = useRef<HTMLInputElement | null>(null);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const sortMenuTriggerRef = useRef<HTMLButtonElement | null>(null);

  const [trackContextMenu, setTrackContextMenu] = useState<PopupMenuState | null>(null);
  const [playlistActionsMenu, setPlaylistActionsMenu] = useState<PopupMenuState | null>(null);

  useEffect(() => {
    setAudioState(audioService.getState());
    setSelectedPlaylist(null);
    const unsubscribe = audioService.onStateChange(setAudioState);
    return unsubscribe;
  }, [audioService]);

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
    setPlaylistActionsMenu(null);
    setShowSortMenu(false);
    setShowPlaylistTrackSearch(false);
  }, [selectedPlaylist?.id, selectedPlaylist?.updatedAt]);

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

    const pruneRemovedPlaylistCovers = () => {
      const validPlaylistIds = new Set(audioState.playlists.map((playlist) => playlist.id));
      setResolvedPlaylistCoverMap((previous) => {
        let changed = false;
        const next: Record<string, string> = {};
        for (const [playlistId, url] of Object.entries(previous)) {
          if (!validPlaylistIds.has(playlistId)) {
            changed = true;
            continue;
          }
          next[playlistId] = url;
        }
        return changed ? next : previous;
      });
    };

    const resolvePlaylistCovers = async () => {
      for (const playlist of audioState.playlists) {
        const playlistId = String(playlist.id || '').trim();
        if (!playlistId) continue;
        if (pendingPlaylistCoverIdsRef.current.has(playlistId)) continue;

        if (playlist.kind === 'smart') {
          setResolvedPlaylistCoverMap((previous) => {
            if (!(playlistId in previous)) return previous;
            const next = { ...previous };
            delete next[playlistId];
            return next;
          });
          continue;
        }

        const explicitPlaylistCover =
          typeof playlist.coverUrl === 'string' ? playlist.coverUrl.trim() : '';
        if (explicitPlaylistCover) {
          setResolvedPlaylistCoverMap((previous) => {
            if (!(playlistId in previous)) return previous;
            const next = { ...previous };
            delete next[playlistId];
            return next;
          });
          continue;
        }

        const trackCandidates = playlist.tracks.slice(0, 5);
        if (trackCandidates.length === 0) {
          setResolvedPlaylistCoverMap((previous) => {
            if (!(playlistId in previous)) return previous;
            const next = { ...previous };
            delete next[playlistId];
            return next;
          });
          continue;
        }

        pendingPlaylistCoverIdsRef.current.add(playlistId);
        try {
          let resolvedCoverUrl: string | undefined;

          for (const candidate of trackCandidates) {
            const embeddedCoverUrl = toNonEmptyString(candidate.coverUrl);
            if (embeddedCoverUrl) {
              resolvedCoverUrl = embeddedCoverUrl;
              break;
            }

            try {
              const resolvedFromLibrary = await musicLibraryService.getCoverUrlForTrack(candidate, {
                coverSizeHint: 'small',
                bypassRuntimePolicy: true,
              });
              const normalizedResolved = toNonEmptyString(resolvedFromLibrary);
              if (normalizedResolved) {
                resolvedCoverUrl = normalizedResolved;
                break;
              }
            } catch {
              // best-effort per candidate: continue trying next tracks in the playlist head.
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
              resolvedCoverUrl = cachedBilibiliCover.trim();
            }
          }

          if (cancelled) continue;

          if (resolvedCoverUrl) {
            const finalCoverUrl = resolvedCoverUrl.trim();
            setResolvedPlaylistCoverMap((previous) => {
              if (previous[playlistId] === finalCoverUrl) return previous;
              return {
                ...previous,
                [playlistId]: finalCoverUrl,
              };
            });
          } else {
            setResolvedPlaylistCoverMap((previous) => {
              if (!(playlistId in previous)) return previous;
              const next = { ...previous };
              delete next[playlistId];
              return next;
            });
          }
        } catch {
          // best-effort: keep fallback icon when cover cannot be resolved.
        } finally {
          pendingPlaylistCoverIdsRef.current.delete(playlistId);
        }
      }
    };

    pruneRemovedPlaylistCovers();
    void resolvePlaylistCovers();

    return () => {
      cancelled = true;
    };
  }, [audioState.playlists]);

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

  const getPlaylistCoverUrl = (playlist: Playlist | null): string => {
    if (!playlist) {
      return '';
    }

    if (playlist.kind === 'smart') {
      return '';
    }

    if (typeof playlist.coverUrl === 'string' && playlist.coverUrl.trim()) {
      return playlist.coverUrl.trim();
    }

    const resolvedCoverUrl = resolvedPlaylistCoverMap[playlist.id] ?? '';
    if (resolvedCoverUrl) return resolvedCoverUrl;

    const firstTrack = playlist.tracks[0] ?? null;
    const fallbackFromFirstTrack = toNonEmptyString(firstTrack?.coverUrl);
    if (fallbackFromFirstTrack) {
      return fallbackFromFirstTrack;
    }

    const fallbackFromHeadTracks = playlist.tracks
      .slice(1, 5)
      .map((track) => toNonEmptyString(track.coverUrl))
      .find((value) => value.length > 0);
    if (!fallbackFromHeadTracks) return '';

    return fallbackFromHeadTracks;
  };

  const selectedPlaylistReadonly = isReadonlyPlaylist(selectedPlaylist);
  const selectedPlaylistCoverUrl = getPlaylistCoverUrl(selectedPlaylist);

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

    if (playlistTrackSortField === 'default') {
      return queryFiltered;
    }

    const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    const sorted = [...queryFiltered];

    sorted.sort((a, b) => {
      let result = 0;

      if (playlistTrackSortField === 'title') {
        result = collator.compare(a.track.title || '', b.track.title || '');
      } else if (playlistTrackSortField === 'artist') {
        result = collator.compare(a.track.artist || '', b.track.artist || '');
      } else if (playlistTrackSortField === 'album') {
        result = collator.compare(a.track.album || '', b.track.album || '');
      } else if (playlistTrackSortField === 'duration') {
        result = (a.track.duration ?? 0) - (b.track.duration ?? 0);
      }

      if (result === 0) {
        result = a.index - b.index;
      }

      return playlistTrackSortDirection === 'desc' ? -result : result;
    });

    return sorted;
  }, [selectedPlaylist, playlistTrackSearchQuery, playlistTrackSortDirection, playlistTrackSortField]);

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
            setPlaylistToRename(playlist);
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
            {!selectedPlaylist ? (
              <h2 className="playlists-detail-title">{t('pages.playlists.detail.title')}</h2>
            ) : null}
            <button className="playlists-close-btn" onClick={onClose}>
              ×
            </button>
          </div>

          {selectedPlaylist ? (
            <>
              <div className="playlists-hero">
                <div className="playlists-hero-cover-column">
                  <div className="playlists-hero-cover">
                    {selectedPlaylistCoverUrl ? (
                      <img
                        src={selectedPlaylistCoverUrl}
                        alt={selectedPlaylist.name}
                        className="playlists-hero-cover-image"
                      />
                    ) : (
                      <span className="playlists-hero-cover-fallback">♪</span>
                    )}
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
                    <div className="playlists-tracks-empty-icon">♪</div>
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
                            disabled={filteredPlaylistTrackEntries.length === 0}
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
                                setSelectedTrackKeys([]);
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

                    {filteredPlaylistTrackEntries.length === 0 ? (
                      <div className="playlists-tracks-empty playlists-tracks-empty-query">
                        <div className="playlists-tracks-empty-text">
                          {t('pages.playlists.tracks.empty.searchResult')}
                        </div>
                      </div>
                    ) : (
                      <>
                        {filteredPlaylistTrackEntries.map((entry) => {
                          const isSelected = selectedTrackKeys.includes(entry.key);

                          return (
                            <div
                              key={entry.key}
                              className={`playlists-track ${playlistBatchMode ? 'playlists-track-batch-selectable' : ''} ${isSelected ? 'playlists-track-selected' : ''}`}
                              onContextMenu={(event) =>
                                handleTrackContextMenu(selectedPlaylist, entry.track, entry.index, event)
                              }
                              onDoubleClick={() => {
                                if (playlistBatchMode) {
                                  return;
                                }
                                handlePlayTrackFromPlaylist(selectedPlaylist, entry.index);
                              }}
                              onClick={() => {
                                if (!playlistBatchMode) {
                                  return;
                                }
                                handleToggleTrackSelection(entry.key, !isSelected);
                              }}
                            >
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
