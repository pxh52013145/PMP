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
          icon: playlist.kind === 'platform' ? '☁' : '♪',
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
    icon: '↳',
    children,
  };
};

