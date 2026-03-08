import { afterEach, describe, expect, it } from 'vitest';
import { applyMusicLibraryBaseQuery } from '../baseQuery';
import {
  clearRegisteredMusicLibraryBaseFieldCapabilities,
  listMusicLibraryBaseFilterFieldIds,
  listMusicLibraryBaseGroupFieldIds,
  listMusicLibraryBaseOrderFieldIds,
  registerMusicLibraryBaseFieldCapabilities,
  resolveMusicLibraryBaseFieldLabel,
} from '../fieldCapabilities';

describe('fieldCapabilities', () => {
  afterEach(() => {
    clearRegisteredMusicLibraryBaseFieldCapabilities();
  });

  it('registers extension fields into filter, sort and group lists', () => {
    registerMusicLibraryBaseFieldCapabilities([
      {
        id: 'composerTag',
        label: 'Composer Tag',
        trackKey: 'composer',
        filterable: true,
        sortable: true,
        groupable: true,
      },
    ]);

    expect(listMusicLibraryBaseFilterFieldIds()).toContain('composerTag');
    expect(listMusicLibraryBaseOrderFieldIds()).toContain('composerTag');
    expect(listMusicLibraryBaseGroupFieldIds()).toContain('composerTag');
    expect(resolveMusicLibraryBaseFieldLabel('composerTag')).toBe('Composer Tag');
  });

  it('uses extension trackKey in fallback sorting', () => {
    registerMusicLibraryBaseFieldCapabilities([
      {
        id: 'composerTag',
        label: 'Composer Tag',
        trackKey: 'composer',
        sortable: true,
      },
    ]);

    const rows = applyMusicLibraryBaseQuery(
      [
        { id: 'track-1', title: 'A', composer: 'Zed' },
        { id: 'track-2', title: 'B', composer: 'Alpha' },
        { id: 'track-3', title: 'C', composer: 'Muse' },
      ],
      {
        filterOperator: 'and',
        filterGroups: [],
        groupByRules: [],
        sortRules: [{ id: 'sort-1', field: 'composerTag', order: 'asc' }],
      }
    );

    expect(rows.map((track) => track.id)).toEqual(['track-2', 'track-3', 'track-1']);
  });
});
