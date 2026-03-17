import { describe, expect, it } from 'vitest';

import {
  buildMusicLibraryCardVirtualLayout,
  resolveMusicLibraryCardGridColumns,
  sliceMusicLibraryCardVirtualLayout,
} from '../cardVirtualWindow';
import type { MusicLibraryGroupedRow } from '../groupedRows';

describe('cardVirtualWindow', () => {
  it('chunks ungrouped tracks into viewport rows based on available width', () => {
    const rows: MusicLibraryGroupedRow[] = Array.from({ length: 5 }, (_, index) => ({
      kind: 'track',
      id: `track-${index + 1}`,
      trackId: `track-${index + 1}`,
      trackIndex: index,
      parentGroupKeys: [],
    }));

    expect(resolveMusicLibraryCardGridColumns(980)).toBe(3);

    const layout = buildMusicLibraryCardVirtualLayout(rows, 980);

    expect(layout.blocks).toHaveLength(2);
    expect(layout.blocks[0]?.kind).toBe('track-row');
    expect(layout.blocks[1]?.kind).toBe('track-row');
    if (layout.blocks[0]?.kind !== 'track-row' || layout.blocks[1]?.kind !== 'track-row') {
      throw new Error('expected track-row blocks');
    }
    expect(layout.blocks[0].rows).toHaveLength(3);
    expect(layout.blocks[1].rows).toHaveLength(2);
    expect(layout.totalHeightPx).toBe(154);
  });

  it('reduces nested grid columns for grouped card rows', () => {
    const rows: MusicLibraryGroupedRow[] = [
      {
        kind: 'group-header',
        id: 'artist:a',
        groupKey: 'artist:a',
        field: 'artist',
        fieldLabel: 'Artist',
        title: 'A',
        count: 3,
        depth: 0,
        startIndex: 0,
        collapsed: false,
      },
      {
        kind: 'track',
        id: 'track-1',
        trackId: 'track-1',
        trackIndex: 0,
        groupKey: 'artist:a',
        parentGroupKeys: ['artist:a'],
      },
      {
        kind: 'track',
        id: 'track-2',
        trackId: 'track-2',
        trackIndex: 1,
        groupKey: 'artist:a',
        parentGroupKeys: ['artist:a'],
      },
      {
        kind: 'track',
        id: 'track-3',
        trackId: 'track-3',
        trackIndex: 2,
        groupKey: 'artist:a',
        parentGroupKeys: ['artist:a'],
      },
    ];

    expect(resolveMusicLibraryCardGridColumns(980, 1)).toBe(2);

    const layout = buildMusicLibraryCardVirtualLayout(rows, 980);

    expect(layout.blocks).toHaveLength(3);
    expect(layout.blocks[0]?.kind).toBe('group-header');
    expect(layout.blocks[1]?.kind).toBe('track-row');
    expect(layout.blocks[2]?.kind).toBe('track-row');
    if (layout.blocks[1]?.kind !== 'track-row' || layout.blocks[2]?.kind !== 'track-row') {
      throw new Error('expected grouped track-row blocks');
    }
    expect(layout.blocks[1].rows).toHaveLength(2);
    expect(layout.blocks[2].rows).toHaveLength(1);
  });

  it('returns only the blocks inside the visible viewport window', () => {
    const rows: MusicLibraryGroupedRow[] = Array.from({ length: 18 }, (_, index) => ({
      kind: 'track',
      id: `track-${index + 1}`,
      trackId: `track-${index + 1}`,
      trackIndex: index,
      parentGroupKeys: [],
    }));

    const layout = buildMusicLibraryCardVirtualLayout(rows, 980);
    const windowed = sliceMusicLibraryCardVirtualLayout(layout, 480, 90);

    expect(windowed.blocks.length).toBeLessThan(layout.blocks.length);
    expect(windowed.topSpacerPx).toBeGreaterThan(0);
    expect(windowed.bottomSpacerPx).toBeGreaterThanOrEqual(0);
  });
});
