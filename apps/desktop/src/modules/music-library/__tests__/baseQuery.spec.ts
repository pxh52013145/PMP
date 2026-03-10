import { afterEach, describe, expect, it } from 'vitest';
import {
  applyMusicLibraryBaseQuery,
  canUseNativeBaseFilter,
  canUseNativeBaseOrderRule,
} from '../baseQuery';
import { replaceMusicLibraryBaseFieldCapabilities } from '../fieldCapabilities';

describe('baseQuery', () => {
  afterEach(() => {
    replaceMusicLibraryBaseFieldCapabilities([], { source: 'extension' });
  });

  it('supports native ordering for database-backed metadata fields', () => {
    expect(canUseNativeBaseOrderRule({ id: 'rule-1', field: 'sampleRate', order: 'asc' })).toBe(true);
    expect(canUseNativeBaseOrderRule({ id: 'rule-2', field: 'fileSize', order: 'asc' })).toBe(true);
    expect(canUseNativeBaseOrderRule({ id: 'rule-3', field: 'dateAdded', order: 'asc' })).toBe(true);
    expect(canUseNativeBaseOrderRule({ id: 'rule-4', field: 'lastPlayed', order: 'asc' })).toBe(true);
    expect(canUseNativeBaseOrderRule({ id: 'rule-5', field: 'format', order: 'asc' })).toBe(true);
    expect(canUseNativeBaseOrderRule({ id: 'rule-6', field: 'year', order: 'asc' })).toBe(true);
  });

  it('supports native numeric filters for builtin database-backed metadata fields', () => {
    expect(
      canUseNativeBaseFilter({
        id: 'filter-year',
        field: 'year',
        operator: 'gte',
        value: '2020',
      })
    ).toBe(true);
  });

  it('recognizes dynamically registered native order fields', () => {
    replaceMusicLibraryBaseFieldCapabilities(
      [
        {
          id: 'moodLabel',
          label: 'Mood',
          kind: 'text',
          sortable: true,
          groupable: true,
          facetable: true,
          nativeSortField: 'moodLabel',
        },
      ],
      { source: 'extension' }
    );

    expect(canUseNativeBaseOrderRule({ id: 'rule-custom', field: 'moodLabel', order: 'asc' })).toBe(true);
  });

  it('sorts by sample rate and file size in fallback mode', () => {
    const rows = applyMusicLibraryBaseQuery(
      [
        { id: 'track-1', title: 'A', sampleRate: 48000, fileSize: 30 },
        { id: 'track-2', title: 'B', sampleRate: 44100, fileSize: 10 },
        { id: 'track-3', title: 'C', sampleRate: 96000, fileSize: 20 },
      ],
      {
        filterOperator: 'and',
        filterGroups: [],
        groupByRules: [],
        sortRules: [
          { id: 'sort-1', field: 'sampleRate', order: 'asc' },
          { id: 'sort-2', field: 'fileSize', order: 'desc' },
        ],
      }
    );

    expect(rows.map((track) => track.id)).toEqual(['track-2', 'track-1', 'track-3']);
  });

  it('uses dateAdded and addedAt as fallback-compatible ordering sources', () => {
    const rows = applyMusicLibraryBaseQuery(
      [
        { id: 'track-1', title: 'A', dateAdded: 1700000000000 },
        { id: 'track-2', title: 'B', addedAt: new Date('2024-01-03T00:00:00Z') },
        { id: 'track-3', title: 'C', lastPlayed: 1700000200000 },
      ],
      {
        filterOperator: 'and',
        filterGroups: [],
        groupByRules: [],
        sortRules: [{ id: 'sort-1', field: 'dateAdded', order: 'desc' }],
      }
    );

    expect(rows.map((track) => track.id)).toEqual(['track-2', 'track-1', 'track-3']);
  });

  it('pushes empty fallback values behind concrete values when sorting', () => {
    const rows = applyMusicLibraryBaseQuery(
      [
        { id: 'track-1', title: 'A' },
        { id: 'track-2', title: 'B', artist: 'Muse' },
        { id: 'track-3', title: 'C', artist: '' },
      ],
      {
        filterOperator: 'and',
        filterGroups: [],
        groupByRules: [],
        sortRules: [{ id: 'sort-1', field: 'artist', order: 'asc' }],
      }
    );

    expect(rows.map((track) => track.id)).toEqual(['track-2', 'track-1', 'track-3']);
  });
});
