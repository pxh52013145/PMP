import { describe, expect, it } from 'vitest';
import type { Track } from '../../services/audio/types';
import { compareAlbumTracks, createAlbumSortRules, formatAlbumTrackNumber } from './albumOrder';
import { applyMusicLibraryBaseQuery, normalizeMusicLibraryBaseSchema } from './baseQuery';
import { createMusicLibraryBaseQuickFilterState } from './baseState';

const tracks: Track[] = [
  { id: 'd2t1', title: 'A', album: 'Album', discNumber: 2, trackNumber: 1 },
  { id: 'd1t10', title: 'B', album: 'Album', discNumber: 1, trackNumber: 10 },
  { id: 'd1t2', title: 'C', album: 'Album', discNumber: 1, trackNumber: 2 },
  { id: 'd1t1', title: 'Z', album: 'Album', discNumber: 1, trackNumber: 1 },
];

describe('album order', () => {
  it('orders discs before numeric track numbers regardless of title', () => {
    expect([...tracks].sort(compareAlbumTracks).map((track) => track.id)).toEqual([
      'd1t1', 'd1t2', 'd1t10', 'd2t1',
    ]);
  });

  it('keeps the album quick-filter order after schema normalization', () => {
    const filter = createMusicLibraryBaseQuickFilterState('album', 'Album')!;
    const schema = normalizeMusicLibraryBaseSchema({
      version: 1,
      query: {
        filterOperator: filter.filterJoinOperator,
        filterGroups: filter.filterGroups,
        groupByRules: [],
        sortRules: createAlbumSortRules(),
      },
      view: { mode: 'table', properties: [] },
    });
    const result = applyMusicLibraryBaseQuery([
      ...tracks,
      { id: 'other', title: 'Other', album: 'Other', trackNumber: 1 },
    ], schema.query);
    expect(result.map((track) => track.id)).toEqual(['d1t1', 'd1t2', 'd1t10', 'd2t1']);
  });

  it('handles single-disc albums without disc tags and puts missing track numbers last', () => {
    const input: Track[] = [
      { id: 'unknown', title: 'A' },
      { id: 'ten', title: 'B', trackNumber: 10 },
      { id: 'two', title: 'Z', trackNumber: 2 },
    ];
    expect(input.sort(compareAlbumTracks).map((track) => track.id)).toEqual(['two', 'ten', 'unknown']);
  });

  it('falls back to natural title order when no sequence tags exist', () => {
    const input: Track[] = [
      { id: 'ten', title: '10 - Song' },
      { id: 'two', title: '2 - Song' },
    ];
    expect(input.sort(compareAlbumTracks).map((track) => track.id)).toEqual(['two', 'ten']);
  });

  it('shows the real track number, including gaps, and falls back to a row number', () => {
    expect(formatAlbumTrackNumber({ id: 'a', title: 'A', trackNumber: 7 }, 0)).toBe('7');
    for (const trackNumber of [undefined, 0, -1, NaN, Infinity, 1.5]) {
      expect(formatAlbumTrackNumber({ id: 'a', title: 'A', trackNumber }, 3)).toBe('4');
    }
  });
});
