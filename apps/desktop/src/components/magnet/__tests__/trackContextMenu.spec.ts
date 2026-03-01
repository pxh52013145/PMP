import { describe, expect, it, vi } from 'vitest';
import type { Playlist, Track } from '../../../services/audio';
import { buildAddToPlaylistMenuItem, resolveWritablePlaylistTargets } from '../trackContextMenu';

const createPlaylist = (partial: Partial<Playlist>): Playlist => ({
  id: partial.id ?? 'playlist-1',
  name: partial.name ?? 'Playlist',
  tracks: partial.tracks ?? [],
  createdAt: partial.createdAt ?? Date.now(),
  updatedAt: partial.updatedAt ?? Date.now(),
  kind: partial.kind,
  readonly: partial.readonly,
  trackCount: partial.trackCount,
  totalDuration: partial.totalDuration,
  description: partial.description,
  sourceConnectorId: partial.sourceConnectorId,
  sourcePlaylistId: partial.sourcePlaylistId,
  smartRuleJson: partial.smartRuleJson,
  coverUrl: partial.coverUrl,
  favorite: partial.favorite,
});

const createTrack = (partial: Partial<Track>): Track => ({
  id: partial.id ?? 'track-1',
  title: partial.title ?? 'Track',
  artist: partial.artist,
  album: partial.album,
  duration: partial.duration,
  path: partial.path,
  filePath: partial.filePath,
});

describe('trackContextMenu', () => {
  it('filters out smart, readonly, and excluded playlists', () => {
    const playlists: Playlist[] = [
      createPlaylist({ id: 'manual', name: 'Manual', kind: 'manual' }),
      createPlaylist({ id: 'smart', name: 'Smart', kind: 'smart' }),
      createPlaylist({ id: 'readonly', name: 'Readonly', kind: 'manual', readonly: true }),
      createPlaylist({ id: 'platform', name: 'Platform', kind: 'platform' }),
    ];

    const targets = resolveWritablePlaylistTargets(playlists, 'platform');

    expect(targets.map((item) => item.id)).toEqual(['manual']);
  });

  it('returns disabled fallback child when no writable target', () => {
    const menu = buildAddToPlaylistMenuItem({
      t: (key) => key,
      track: createTrack({ id: 'track-a' }),
      playlists: [createPlaylist({ id: 'smart-only', kind: 'smart' })],
      onAddToPlaylist: vi.fn(),
    });

    expect(menu.label).toBe('common.action.addToPlaylist');
    expect(menu.children).toHaveLength(1);
    expect(menu.children?.[0].disabled).toBe(true);
    expect(menu.children?.[0].label).toBe('common.state.noAvailablePlaylist');
  });

  it('builds writable target children and calls add callback', () => {
    const onAddToPlaylist = vi.fn();
    const track = createTrack({ id: 'track-target', title: 'Hello' });
    const menu = buildAddToPlaylistMenuItem({
      t: (key) => key,
      track,
      playlists: [
        createPlaylist({ id: 'a', name: 'A', kind: 'manual' }),
        createPlaylist({ id: 'b', name: 'B', kind: 'platform' }),
      ],
      onAddToPlaylist,
      excludePlaylistId: 'b',
    });

    expect(menu.children).toHaveLength(1);
    expect(menu.children?.[0].label).toBe('A');

    menu.children?.[0].onClick?.();
    expect(onAddToPlaylist).toHaveBeenCalledWith('a', track);
  });
});

