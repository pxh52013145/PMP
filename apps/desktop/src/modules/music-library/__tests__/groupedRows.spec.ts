import { describe, expect, it } from 'vitest';
import { buildMusicLibraryGroupedRows, sliceMusicLibraryGroupedRows } from '../groupedRows';

describe('groupedRows', () => {
  const tracks = [
    { id: 't-1', title: 'A', artist: 'Muse', album: 'Drones' },
    { id: 't-2', title: 'B', artist: 'Muse', album: 'Drones' },
    { id: 't-3', title: 'C', artist: 'Radiohead', album: 'OK Computer' },
  ];

  it('returns plain track rows when grouping is disabled', () => {
    const rows = buildMusicLibraryGroupedRows({
      tracks,
      groupByRules: [],
      resolveFieldLabel: (field) => field,
    });

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.kind === 'track')).toBe(true);
  });

  it('builds visible group headers and track rows', () => {
    const rows = buildMusicLibraryGroupedRows({
      tracks,
      groupByRules: [{ id: 'group-1', field: 'artist', order: 'asc' }],
      resolveFieldLabel: (field) => field,
      resolveFieldDisplayValue: (field, track) => String(track[field] ?? '-'),
    });

    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      kind: 'group-header',
      title: 'Muse',
      count: 2,
      startIndex: 0,
    });
    expect(rows[1]).toMatchObject({ kind: 'track', id: 't-1', trackIndex: 0, groupKey: 'artist:muse' });
    expect(rows[3]).toMatchObject({
      kind: 'group-header',
      title: 'Radiohead',
      count: 1,
      startIndex: 2,
    });
  });

  it('builds nested groups using priority order', () => {
    const rows = buildMusicLibraryGroupedRows({
      tracks: [
        { id: 't-1', title: 'A', artist: 'DOUDOU', album: 'Alpha' },
        { id: 't-2', title: 'B', artist: 'DOUDOU', album: 'Beta' },
        { id: 't-3', title: 'C', artist: 'MUSE', album: 'Absolution' },
      ],
      groupByRules: [
        { id: 'group-1', field: 'artist', order: 'asc' },
        { id: 'group-2', field: 'album', order: 'asc' },
      ],
      resolveFieldLabel: (field) => field,
      resolveFieldDisplayValue: (field, track) => String(track[field] ?? '-'),
    });

    expect(rows[0]).toMatchObject({
      kind: 'group-header',
      groupKey: 'artist:doudou',
      field: 'artist',
      depth: 0,
      count: 2,
    });
    expect(rows[1]).toMatchObject({
      kind: 'group-header',
      groupKey: 'artist:doudou/album:alpha',
      parentGroupKey: 'artist:doudou',
      field: 'album',
      depth: 1,
      count: 1,
    });
    expect(rows[2]).toMatchObject({
      kind: 'track',
      id: 't-1',
      groupKey: 'artist:doudou/album:alpha',
      parentGroupKeys: ['artist:doudou', 'artist:doudou/album:alpha'],
    });
    expect(rows[3]).toMatchObject({
      kind: 'group-header',
      groupKey: 'artist:doudou/album:beta',
      parentGroupKey: 'artist:doudou',
      field: 'album',
      depth: 1,
      count: 1,
    });
  });

  it('hides track rows for collapsed groups while preserving counts', () => {
    const rows = buildMusicLibraryGroupedRows({
      tracks,
      groupByRules: [{ id: 'group-1', field: 'artist', order: 'asc' }],
      collapsedGroupKeys: new Set(['artist:muse']),
      resolveFieldLabel: (field) => field,
      resolveFieldDisplayValue: (field, track) => String(track[field] ?? '-'),
    });

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      kind: 'group-header',
      groupKey: 'artist:muse',
      count: 2,
      collapsed: true,
    });
    expect(rows[1]).toMatchObject({ kind: 'group-header', groupKey: 'artist:radiohead' });
    expect(rows[2]).toMatchObject({ kind: 'track', id: 't-3', trackIndex: 2 });
  });

  it('hides nested child groups when a parent group is collapsed', () => {
    const rows = buildMusicLibraryGroupedRows({
      tracks: [
        { id: 't-1', title: 'A', artist: 'DOUDOU', album: 'Alpha' },
        { id: 't-2', title: 'B', artist: 'DOUDOU', album: 'Beta' },
        { id: 't-3', title: 'C', artist: 'MUSE', album: 'Absolution' },
      ],
      groupByRules: [
        { id: 'group-1', field: 'artist', order: 'asc' },
        { id: 'group-2', field: 'album', order: 'asc' },
      ],
      collapsedGroupKeys: new Set(['artist:doudou']),
      resolveFieldLabel: (field) => field,
      resolveFieldDisplayValue: (field, track) => String(track[field] ?? '-'),
    });

    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      kind: 'group-header',
      groupKey: 'artist:doudou',
      collapsed: true,
    });
    expect(rows[1]).toMatchObject({ kind: 'group-header', groupKey: 'artist:muse' });
    expect(rows[2]).toMatchObject({ kind: 'group-header', groupKey: 'artist:muse/album:absolution' });
    expect(rows[3]).toMatchObject({ kind: 'track', id: 't-3' });
  });

  it('keeps the current group header visible when a virtual slice starts mid-group', () => {
    const rows = buildMusicLibraryGroupedRows({
      tracks: [
        { id: 't-1', title: 'A', artist: 'Muse', album: 'Drones' },
        { id: 't-2', title: 'B', artist: 'Muse', album: 'Drones' },
        { id: 't-3', title: 'C', artist: 'Muse', album: 'Drones' },
        { id: 't-4', title: 'D', artist: 'Radiohead', album: 'OK Computer' },
      ],
      groupByRules: [{ id: 'group-1', field: 'artist', order: 'asc' }],
      resolveFieldLabel: (field) => field,
      resolveFieldDisplayValue: (field, track) => String(track[field] ?? '-'),
    });

    const sliced = sliceMusicLibraryGroupedRows({
      rows,
      start: 2,
      end: 4,
    });

    expect(sliced.topSpacerRowCount).toBe(1);
    expect(sliced.rows).toHaveLength(3);
    expect(sliced.rows[0]).toMatchObject({ kind: 'group-header', groupKey: 'artist:muse' });
    expect(sliced.rows[1]).toMatchObject({ kind: 'track', id: 't-2' });
    expect(sliced.rows[2]).toMatchObject({ kind: 'track', id: 't-3' });
  });

  it('keeps ancestor headers visible when a virtual slice starts inside nested groups', () => {
    const rows = buildMusicLibraryGroupedRows({
      tracks: [
        { id: 't-1', title: 'A', artist: 'DOUDOU', album: 'Alpha' },
        { id: 't-2', title: 'B', artist: 'DOUDOU', album: 'Alpha' },
        { id: 't-3', title: 'C', artist: 'DOUDOU', album: 'Beta' },
        { id: 't-4', title: 'D', artist: 'MUSE', album: 'Absolution' },
      ],
      groupByRules: [
        { id: 'group-1', field: 'artist', order: 'asc' },
        { id: 'group-2', field: 'album', order: 'asc' },
      ],
      resolveFieldLabel: (field) => field,
      resolveFieldDisplayValue: (field, track) => String(track[field] ?? '-'),
    });

    const sliced = sliceMusicLibraryGroupedRows({
      rows,
      start: 3,
      end: 5,
    });

    expect(sliced.topSpacerRowCount).toBe(1);
    expect(sliced.rows[0]).toMatchObject({ kind: 'group-header', groupKey: 'artist:doudou' });
    expect(sliced.rows[1]).toMatchObject({
      kind: 'group-header',
      groupKey: 'artist:doudou/album:alpha',
    });
    expect(sliced.rows[2]).toMatchObject({ kind: 'track', id: 't-2' });
    expect(sliced.rows[3]).toMatchObject({
      kind: 'group-header',
      groupKey: 'artist:doudou/album:beta',
    });
  });
});
