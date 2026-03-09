import { registerMusicLibraryFieldCapabilitiesFromNativeCatalog } from './fieldCatalog';
import { registerMusicLibraryFacetCollectionDescriptorsFromNativeCatalog } from './facetCatalog';
import type { NativeLibrarySchemaEnvelope } from './nativeLibraryDb';

export interface MusicLibraryNativeSchemaRegistration {
  fieldCapabilities: ReturnType<typeof registerMusicLibraryFieldCapabilitiesFromNativeCatalog>;
  facetCollections: ReturnType<typeof registerMusicLibraryFacetCollectionDescriptorsFromNativeCatalog>;
}

export function registerMusicLibrarySchemaFromNativeEnvelope(
  envelope: NativeLibrarySchemaEnvelope
): MusicLibraryNativeSchemaRegistration {
  return {
    fieldCapabilities: registerMusicLibraryFieldCapabilitiesFromNativeCatalog(envelope.trackFields),
    facetCollections: registerMusicLibraryFacetCollectionDescriptorsFromNativeCatalog(
      envelope.facetCollections
    ),
  };
}
