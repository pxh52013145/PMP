import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearRegisteredMusicLibraryBaseFieldCapabilities,
  registerMusicLibraryBaseFieldCapabilities,
} from '../fieldCapabilities';
import {
  clearRegisteredMusicLibraryFacetCollectionDescriptors,
  getMusicLibraryFacetCollectionDescriptor,
  listMusicLibraryFacetCollectionDescriptors,
  registerMusicLibraryFacetCollectionDescriptors,
  resolveMusicLibraryFieldFacetDescriptor,
  subscribeMusicLibraryFacetCollectionDescriptors,
} from '../facetDescriptors';

describe('facetDescriptors', () => {
  afterEach(() => {
    clearRegisteredMusicLibraryBaseFieldCapabilities();
    clearRegisteredMusicLibraryFacetCollectionDescriptors();
  });

  it('exposes collection descriptors with album summary support', () => {
    expect(listMusicLibraryFacetCollectionDescriptors().map((item) => item.id)).toEqual([
      'artists',
      'genres',
      'albums',
    ]);
    expect(getMusicLibraryFacetCollectionDescriptor('albums')).toMatchObject({
      id: 'albums',
      field: 'album',
      kind: 'album-summaries',
      nativeField: 'album',
    });
  });

  it('resolves builtin facetable fields into text facet descriptors', () => {
    expect(resolveMusicLibraryFieldFacetDescriptor('artist')).toMatchObject({
      id: 'field:artist',
      field: 'artist',
      label: 'Artist',
      kind: 'text-values',
      nativeField: 'artist',
    });
    expect(resolveMusicLibraryFieldFacetDescriptor('duration')).toBeNull();
  });

  it('resolves registered facetable extension fields with native mapping', () => {
    registerMusicLibraryBaseFieldCapabilities(
      [
        {
          id: 'moodTag',
          label: 'Mood Tag',
          trackKey: 'mood',
          filterable: true,
          groupable: true,
          facetable: true,
          nativeFilterField: 'mood',
        },
      ],
      { source: 'native-catalog' }
    );

    expect(resolveMusicLibraryFieldFacetDescriptor('moodTag')).toMatchObject({
      id: 'field:moodTag',
      field: 'moodTag',
      label: 'Mood Tag',
      kind: 'text-values',
      nativeField: 'mood',
    });
  });

  it('notifies facet descriptor listeners when runtime catalog changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMusicLibraryFacetCollectionDescriptors(listener);

    registerMusicLibraryFacetCollectionDescriptors([
      {
        id: 'moods',
        field: 'genre',
        label: 'Moods',
        kind: 'text-values',
        nativeField: 'mood',
      },
    ]);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
