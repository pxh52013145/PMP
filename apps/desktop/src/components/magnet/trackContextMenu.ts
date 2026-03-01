import type { Playlist, Track } from '../../services/audio';
import type { ContextMenuItem } from './ContextMenu';

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

interface BuildAddToPlaylistMenuItemOptions {
  t: TranslateFn;
  track: Track;
  playlists: Playlist[];
  onAddToPlaylist: (playlistId: string, track: Track) => void;
  excludePlaylistId?: string;
}

interface BuildTrackContextMenuBaseOptions {
  t: TranslateFn;
  track: Track;
  playlists: Playlist[];
  onPlay: () => void;
  onAddToQueue: () => void;
  onAddToPlaylist: (playlistId: string, track: Track) => void;
  excludePlaylistId?: string;
}

interface BuildPlaylistTrackContextMenuOptions extends BuildTrackContextMenuBaseOptions {
  removeFromPlaylistLabel: string;
  removeFromPlaylistDisabled?: boolean;
  onRemoveFromPlaylist: () => void;
}

interface BuildLibraryTrackContextMenuOptions extends BuildTrackContextMenuBaseOptions {
  playAllFromHereLabel: string;
  onPlayAllFromHere: () => void;
  openInFileManagerLabel: string;
  openInFileManagerDisabled?: boolean;
  onOpenInFileManager: () => void;
  viewAlbumLabel: string;
  viewAlbumDisabled?: boolean;
  onViewAlbum: () => void;
  viewArtistLabel: string;
  viewArtistDisabled?: boolean;
  onViewArtist: () => void;
}

const isReadonlyPlaylist = (playlist: Playlist): boolean => {
  if (playlist.readonly) {
    return true;
  }
  return playlist.kind === 'smart';
};

export const resolveWritablePlaylistTargets = (
  playlists: Playlist[],
  excludePlaylistId?: string
): Playlist[] => {
  return playlists.filter((playlist) => {
    if (excludePlaylistId && playlist.id === excludePlaylistId) {
      return false;
    }
    if (isReadonlyPlaylist(playlist)) {
      return false;
    }
    return playlist.kind !== 'smart';
  });
};

export const buildAddToPlaylistMenuItem = ({
  t,
  track,
  playlists,
  onAddToPlaylist,
  excludePlaylistId,
}: BuildAddToPlaylistMenuItemOptions): ContextMenuItem => {
  const targets = resolveWritablePlaylistTargets(playlists, excludePlaylistId);

  const children: ContextMenuItem[] =
    targets.length > 0
      ? targets.map((playlist) => ({
          label: playlist.name,
          icon: playlist.kind === 'platform' ? 'C' : 'M',
          onClick: () => onAddToPlaylist(playlist.id, track),
        }))
      : [
          {
            label: t('common.state.noAvailablePlaylist'),
            disabled: true,
          },
        ];

  return {
    label: t('common.action.addToPlaylist'),
    icon: '>',
    children,
  };
};

const buildTrackContextMenuBaseItems = ({
  t,
  track,
  playlists,
  onPlay,
  onAddToQueue,
  onAddToPlaylist,
  excludePlaylistId,
}: BuildTrackContextMenuBaseOptions): ContextMenuItem[] => {
  return [
    {
      label: t('common.action.play'),
      icon: 'P',
      onClick: onPlay,
    },
    {
      label: t('common.action.addToQueue'),
      icon: 'Q',
      onClick: onAddToQueue,
    },
    buildAddToPlaylistMenuItem({
      t,
      track,
      playlists,
      onAddToPlaylist,
      excludePlaylistId,
    }),
  ];
};

export const buildPlaylistTrackContextMenu = (
  options: BuildPlaylistTrackContextMenuOptions
): ContextMenuItem[] => {
  return [
    ...buildTrackContextMenuBaseItems(options),
    { divider: true },
    {
      label: options.removeFromPlaylistLabel,
      icon: 'X',
      danger: true,
      disabled: options.removeFromPlaylistDisabled,
      onClick: options.onRemoveFromPlaylist,
    },
  ];
};

export const buildLibraryTrackContextMenu = (
  options: BuildLibraryTrackContextMenuOptions
): ContextMenuItem[] => {
  return [
    ...buildTrackContextMenuBaseItems(options),
    {
      label: options.playAllFromHereLabel,
      icon: 'A',
      onClick: options.onPlayAllFromHere,
    },
    { divider: true },
    {
      label: options.openInFileManagerLabel,
      icon: 'F',
      disabled: options.openInFileManagerDisabled,
      onClick: options.onOpenInFileManager,
    },
    { divider: true },
    {
      label: options.viewAlbumLabel,
      icon: 'B',
      disabled: options.viewAlbumDisabled,
      onClick: options.onViewAlbum,
    },
    {
      label: options.viewArtistLabel,
      icon: 'R',
      disabled: options.viewArtistDisabled,
      onClick: options.onViewArtist,
    },
  ];
};

