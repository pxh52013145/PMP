import { afterEach, describe, expect, it } from 'vitest';
import {
  clearRegisteredMusicLibraryBaseFieldCapabilities,
  getMusicLibraryBaseFieldCapability,
} from '../fieldCapabilities';
import {
  createMusicLibraryFieldCapabilitiesFromNativeCatalog,
  registerMusicLibraryFieldCapabilitiesFromNativeCatalog,
} from '../fieldCatalog';

describe('fieldCatalog', () => {
  afterEach(() => {
    clearRegisteredMusicLibraryBaseFieldCapabilities();
  });

  it('maps native field catalog records into extension capabilities', () => {
    const definitions = createMusicLibraryFieldCapabilitiesFromNativeCatalog([
      {
        id: 'bitDepth',
        label: 'Bit Depth',
        kind: 'number',
        trackKey: 'bitDepth',
        columnName: 'bit_depth',
        sourceTable: 'local_tracks',
        declaredType: 'INTEGER',
        nullable: true,
        filterable: true,
        sortable: true,
        groupable: true,
        facetable: true,
        nativeFilterField: 'bitDepth',
        nativeSortField: 'bitDepth',
      },
    ]);

    expect(definitions).toEqual([
      {
        id: 'bitDepth',
        label: 'Bit Depth',
        kind: 'number',
        filterable: true,
        sortable: true,
        groupable: true,
        facetable: true,
        trackKey: 'bitDepth',
        nativeFilterField: 'bitDepth',
        nativeSortField: 'bitDepth',
      },
    ]);
  });

  it('registers native catalog fields as runtime native capabilities', () => {
    registerMusicLibraryFieldCapabilitiesFromNativeCatalog([
      {
        id: 'bitDepth',
        label: 'Bit Depth',
        kind: 'number',
        trackKey: 'bitDepth',
        columnName: 'bit_depth',
        sourceTable: 'local_tracks',
        declaredType: 'INTEGER',
        nullable: true,
        filterable: true,
        sortable: true,
        groupable: true,
        facetable: true,
        nativeFilterField: 'bitDepth',
        nativeSortField: 'bitDepth',
      },
    ]);

    expect(getMusicLibraryBaseFieldCapability('bitDepth')).toMatchObject({
      id: 'bitDepth',
      source: 'native-catalog',
      trackKey: 'bitDepth',
    });
  });
});
