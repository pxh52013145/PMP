import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyMusicLibraryBaseQuery } from '../baseQuery';
import {
  clearRegisteredMusicLibraryBaseFieldCapabilities,
  getMusicLibraryBaseNativeFilterField,
  getMusicLibraryBaseNativeSortField,
  listMusicLibraryBaseFilterFieldIds,
  listMusicLibraryBaseGroupFieldIds,
  listMusicLibraryBaseOrderFieldIds,
  listRegisteredMusicLibraryBaseFieldCapabilities,
  registerMusicLibraryBaseFieldCapabilities,
  resolveMusicLibraryBaseFieldHeaderKey,
  resolveMusicLibraryBaseFieldLabel,
  subscribeMusicLibraryBaseFieldCapabilities,
} from '../fieldCapabilities';
import { registerMusicLibraryFieldCapabilitiesFromNativeCatalog } from '../fieldCatalog';

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

  it('maps builtin year and format fields to native local DB columns', () => {
    expect(getMusicLibraryBaseNativeFilterField('format')).toBe('format');
    expect(getMusicLibraryBaseNativeSortField('format')).toBe('format');
    expect(getMusicLibraryBaseNativeFilterField('year')).toBe('year');
    expect(getMusicLibraryBaseNativeSortField('year')).toBe('year');
  });

  it('hides internal native catalog fields from base UI lists and localizes useful ones', () => {
    registerMusicLibraryBaseFieldCapabilities(
      [
        {
          id: 'libraryPathId',
          label: 'Source Id',
          trackKey: 'libraryPathId',
          filterable: true,
          sortable: true,
          groupable: true,
        },
        {
          id: 'bitDepth',
          label: 'Bit Depth',
          trackKey: 'bitDepth',
          filterable: true,
          sortable: true,
          groupable: true,
        },
      ],
      { source: 'native-catalog' }
    );

    expect(listMusicLibraryBaseGroupFieldIds()).not.toContain('libraryPathId');
    expect(listMusicLibraryBaseOrderFieldIds()).toContain('bitDepth');
    expect(resolveMusicLibraryBaseFieldHeaderKey('bitDepth')).toBe(
      'pages.music-library.columns.bitDepth'
    );
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

  it('does not persist runtime native or discovered field sources', () => {
    registerMusicLibraryBaseFieldCapabilities(
      [
        {
          id: 'nativeBitDepth',
          label: 'Native Bit Depth',
          trackKey: 'bitDepth',
          sortable: true,
        },
      ],
      { source: 'native-catalog' }
    );

    registerMusicLibraryBaseFieldCapabilities(
      [
        {
          id: 'detectedMood',
          label: 'Detected Mood',
          trackKey: 'mood',
          sortable: true,
        },
      ],
      { source: 'runtime-discovered' }
    );

    registerMusicLibraryBaseFieldCapabilities([
      {
        id: 'persistedComposer',
        label: 'Persisted Composer',
        trackKey: 'composer',
        sortable: true,
      },
    ]);

    expect(listMusicLibraryBaseOrderFieldIds()).toEqual(
      expect.arrayContaining(['nativeBitDepth', 'detectedMood', 'persistedComposer'])
    );
    expect(listRegisteredMusicLibraryBaseFieldCapabilities().map((field) => field.id)).toEqual([
      'persistedComposer',
    ]);
  });

  it('does not notify when native catalog replacement is identical', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMusicLibraryBaseFieldCapabilities(listener);

    const catalog = [
      {
        id: 'moodLabel',
        label: 'Mood Label',
        kind: 'text' as const,
        trackKey: 'moodLabel',
        columnName: 'mood_label',
        sourceTable: 'local_tracks',
        declaredType: 'TEXT',
        nullable: true,
        filterable: true,
        sortable: true,
        groupable: true,
        facetable: true,
        nativeFilterField: 'moodLabel',
        nativeSortField: 'moodLabel',
      },
    ];

    registerMusicLibraryFieldCapabilitiesFromNativeCatalog(catalog);
    registerMusicLibraryFieldCapabilitiesFromNativeCatalog(catalog);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
