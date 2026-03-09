import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearRegisteredMusicLibraryFacetCollectionDescriptors,
  getMusicLibraryFacetCollectionDescriptor,
  subscribeMusicLibraryFacetCollectionDescriptors,
} from '../facetDescriptors';
import {
  createMusicLibraryFacetCollectionDescriptorsFromNativeCatalog,
  registerMusicLibraryFacetCollectionDescriptorsFromNativeCatalog,
} from '../facetCatalog';
import type { NativeLibraryFacetCatalogRecord } from '../nativeLibraryDb';

describe('facetCatalog', () => {
  afterEach(() => {
    clearRegisteredMusicLibraryFacetCollectionDescriptors();
  });

  it('maps native facet catalog records into collection descriptors', () => {
    const descriptors = createMusicLibraryFacetCollectionDescriptorsFromNativeCatalog([
      {
        id: 'artists',
        field: 'artist',
        label: 'Artist',
        kind: 'text-values',
        nativeField: 'artist',
      },
      {
        id: 'albums',
        field: 'album',
        label: 'Album',
        kind: 'album-summaries',
        nativeField: 'album',
      },
    ]);

    expect(descriptors).toEqual([
      {
        id: 'artists',
        field: 'artist',
        label: 'Artist',
        kind: 'text-values',
        nativeField: 'artist',
      },
      {
        id: 'albums',
        field: 'album',
        label: 'Album',
        kind: 'album-summaries',
        nativeField: 'album',
      },
    ]);
  });

  it('registers native facet catalog into runtime collection descriptors', () => {
    registerMusicLibraryFacetCollectionDescriptorsFromNativeCatalog([
      {
        id: 'artists',
        field: 'artist',
        label: 'Performer',
        kind: 'text-values',
        nativeField: 'artist',
      },
    ]);

    expect(getMusicLibraryFacetCollectionDescriptor('artists')).toMatchObject({
      id: 'artists',
      label: 'Performer',
      kind: 'text-values',
      nativeField: 'artist',
    });
  });

  it('does not notify when native facet replacement is identical', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMusicLibraryFacetCollectionDescriptors(listener);

    const catalog: NativeLibraryFacetCatalogRecord[] = [
      {
        id: 'artists',
        field: 'artist',
        label: 'Artist',
        kind: 'text-values',
        nativeField: 'artist',
      },
    ];

    registerMusicLibraryFacetCollectionDescriptorsFromNativeCatalog(catalog);
    registerMusicLibraryFacetCollectionDescriptorsFromNativeCatalog(catalog);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
