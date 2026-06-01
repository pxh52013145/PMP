import type { Playlist, Track } from '../../services/audio';
import { isSameTrackByIdentityOrPath } from '../../services/audio/trackIdentity';
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
  editTagsLabel?: string;
  onEditTags?: () => void;
}

export interface TrackPlaylistMembership {
  playlistId: string;
  playlistName: string;
  playlistKind: 'manual' | 'platform';
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

export const resolveTrackPlaylistMemberships = (
  track: Track,
  playlists: Playlist[],
  excludePlaylistId?: string
): TrackPlaylistMembership[] => {
  const memberships: TrackPlaylistMembership[] = [];

  for (const playlist of playlists) {
    if (excludePlaylistId && playlist.id === excludePlaylistId) continue;
    if (playlist.kind === 'smart') continue;

    const isMember = playlist.tracks.some((candidate) => isSameTrackByIdentityOrPath(candidate, track));
    if (!isMember) continue;

    memberships.push({
      playlistId: playlist.id,
      playlistName: playlist.name,
      playlistKind: playlist.kind === 'platform' ? 'platform' : 'manual',
    });
  }

  return memberships;
};

export const buildAddToPlaylistMenuItem = ({
  t,
  track,
  playlists,
  onAddToPlaylist,
  excludePlaylistId,
}: BuildAddToPlaylistMenuItemOptions): ContextMenuItem => {
  const targets = resolveWritablePlaylistTargets(playlists, excludePlaylistId);
  const membershipSet = new Set(
    resolveTrackPlaylistMemberships(track, targets).map((membership) => membership.playlistId)
  );

  const children: ContextMenuItem[] =
    targets.length > 0
      ? targets.map((playlist) => ({
          label: membershipSet.has(playlist.id)
            ? `${playlist.name} (${t('common.state.alreadyAdded')})`
            : playlist.name,
          icon: playlist.kind === 'platform' ? 'C' : 'M',
          disabled: membershipSet.has(playlist.id),
          onClick: membershipSet.has(playlist.id)
            ? undefined
            : () => onAddToPlaylist(playlist.id, track),
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
    ...(options.editTagsLabel && options.onEditTags
      ? [
          { divider: true } as ContextMenuItem,
          {
            label: options.editTagsLabel,
            icon: 'T',
            onClick: options.onEditTags,
          } as ContextMenuItem,
        ]
      : []),
  ];
};
