import { afterEach, describe, expect, it } from 'vitest';
import {
  clearRegisteredMusicLibraryBaseFieldCapabilities,
  getMusicLibraryBaseFieldCapability,
} from '../fieldCapabilities';
import {
  clearRegisteredMusicLibraryFacetCollectionDescriptors,
  getMusicLibraryFacetCollectionDescriptor,
} from '../facetDescriptors';
import { registerMusicLibrarySchemaFromNativeEnvelope } from '../schemaEnvelope';

describe('schemaEnvelope', () => {
  afterEach(() => {
    clearRegisteredMusicLibraryBaseFieldCapabilities();
    clearRegisteredMusicLibraryFacetCollectionDescriptors();
  });

  it('registers field capabilities and facet collections from a native envelope', () => {
    const result = registerMusicLibrarySchemaFromNativeEnvelope({
      schemaVersion: 8,
      generatedAtMs: 1700000000,
      schemaFingerprint: 'schema-fp-1',
      sourceTables: [
        {
          name: 'local_tracks',
          columnCount: 3,
          schemaHash: 'table-fp-1',
          columns: ['id', 'mood_label'],
        },
      ],
      trackFields: [
        {
          id: 'moodLabel',
          label: 'Mood Label',
          kind: 'text',
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
      ],
      facetCollections: [
        {
          id: 'albums',
          field: 'album',
          label: 'Album',
          kind: 'album-summaries',
          nativeField: 'album',
        },
      ],
    });

    expect(result.fieldCapabilities[0]).toMatchObject({
      id: 'moodLabel',
      facetable: true,
    });
    expect(getMusicLibraryBaseFieldCapability('moodLabel')).toMatchObject({
      id: 'moodLabel',
      source: 'native-catalog',
    });
    expect(getMusicLibraryFacetCollectionDescriptor('albums')).toMatchObject({
      id: 'albums',
      kind: 'album-summaries',
    });
  });
});
