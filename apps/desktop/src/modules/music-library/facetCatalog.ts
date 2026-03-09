import type { MusicLibraryBaseFieldId } from './fieldCapabilities';
import {
  registerMusicLibraryFacetCollectionDescriptors,
  type MusicLibraryCollectionFacetDescriptor,
} from './facetDescriptors';
import type { NativeLibraryFacetCatalogRecord } from './nativeLibraryDb';

export function createMusicLibraryFacetCollectionDescriptorsFromNativeCatalog(
  catalog: NativeLibraryFacetCatalogRecord[]
): MusicLibraryCollectionFacetDescriptor[] {
  return catalog.map((record) => ({
    id: record.id as MusicLibraryCollectionFacetDescriptor['id'],
    field: record.field as MusicLibraryBaseFieldId,
    label: record.label,
    kind: record.kind,
    nativeField: record.nativeField,
  }));
}

export function registerMusicLibraryFacetCollectionDescriptorsFromNativeCatalog(
  catalog: NativeLibraryFacetCatalogRecord[]
): MusicLibraryCollectionFacetDescriptor[] {
  const descriptors = createMusicLibraryFacetCollectionDescriptorsFromNativeCatalog(catalog);
  registerMusicLibraryFacetCollectionDescriptors(descriptors, { replace: true });
  return descriptors;
}
