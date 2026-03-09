import { describe, expect, it } from 'vitest';

import { buildMusicLibraryCardGroupLayout } from '../cardGroups';
import type { MusicLibraryGroupedRow } from '../groupedRows';

describe('cardGroups', () => {
  it('builds nested group entries instead of flattening headers into card items', () => {
    const rows: MusicLibraryGroupedRow[] = [
      {
        kind: 'group-header',
        id: 'artist-a',
        groupKey: 'artist:a',
        field: 'artist',
        fieldLabel: 'Artist',
        title: 'A',
        count: 2,
        depth: 0,
        startIndex: 0,
        collapsed: false,
      },
      {
        kind: 'group-header',
        id: 'album-a-1',
        groupKey: 'artist:a/album:one',
        parentGroupKey: 'artist:a',
        field: 'album',
        fieldLabel: 'Album',
        title: 'One',
        count: 1,
        depth: 1,
        startIndex: 0,
        collapsed: false,
      },
      {
        kind: 'track',
        id: 'track-1',
        trackId: 'track-1',
        trackIndex: 0,
        groupKey: 'artist:a/album:one',
        parentGroupKeys: ['artist:a', 'artist:a/album:one'],
      },
      {
        kind: 'group-header',
        id: 'album-a-2',
        groupKey: 'artist:a/album:two',
        parentGroupKey: 'artist:a',
        field: 'album',
        fieldLabel: 'Album',
        title: 'Two',
        count: 1,
        depth: 1,
        startIndex: 1,
        collapsed: false,
      },
      {
        kind: 'track',
        id: 'track-2',
        trackId: 'track-2',
        trackIndex: 1,
        groupKey: 'artist:a/album:two',
        parentGroupKeys: ['artist:a', 'artist:a/album:two'],
      },
    ];

    const layout = buildMusicLibraryCardGroupLayout(rows);

    expect(layout.entries).toHaveLength(1);
    expect(layout.entries[0]?.kind).toBe('group');

    const artistGroup = layout.entries[0]?.kind === 'group' ? layout.entries[0].node : null;
    expect(artistGroup?.header.groupKey).toBe('artist:a');
    expect(artistGroup?.entries).toHaveLength(2);
    expect(artistGroup?.entries.every((entry) => entry.kind === 'group')).toBe(true);

    const firstAlbum =
      artistGroup?.entries[0]?.kind === 'group' ? artistGroup.entries[0].node : null;
    const secondAlbum =
      artistGroup?.entries[1]?.kind === 'group' ? artistGroup.entries[1].node : null;

    expect(firstAlbum?.entries).toHaveLength(1);
    expect(firstAlbum?.entries[0]?.kind).toBe('track');
    expect(secondAlbum?.entries).toHaveLength(1);
    expect(secondAlbum?.entries[0]?.kind).toBe('track');
  });

  it('keeps ungrouped tracks at the root level', () => {
    const rows: MusicLibraryGroupedRow[] = [
      {
        kind: 'track',
        id: 'track-1',
        trackId: 'track-1',
        trackIndex: 0,
        parentGroupKeys: [],
      },
      {
        kind: 'track',
        id: 'track-2',
        trackId: 'track-2',
        trackIndex: 1,
        parentGroupKeys: [],
      },
    ];

    const layout = buildMusicLibraryCardGroupLayout(rows);

    expect(layout.entries).toHaveLength(2);
    expect(layout.entries.every((entry) => entry.kind === 'track')).toBe(true);
  });
});
