import type { MusicLibraryExtensionFieldCapabilityInput } from './fieldCapabilities';
import {
  replaceMusicLibraryBaseFieldCapabilities,
  type MusicLibraryResolvedFieldCapability,
} from './fieldCapabilities';
import type { NativeLibraryTrackFieldCatalogRecord } from './nativeLibraryDb';

export function createMusicLibraryFieldCapabilitiesFromNativeCatalog(
  catalog: NativeLibraryTrackFieldCatalogRecord[]
): MusicLibraryExtensionFieldCapabilityInput[] {
  return catalog.map((field) => ({
    id: field.id,
    label: field.label,
    kind: field.kind,
    filterable: field.filterable,
    sortable: field.sortable,
    groupable: field.groupable,
    facetable: field.facetable,
    trackKey: field.trackKey,
    nativeFilterField: field.nativeFilterField,
    nativeSortField: field.nativeSortField,
  }));
}

export function registerMusicLibraryFieldCapabilitiesFromNativeCatalog(
  catalog: NativeLibraryTrackFieldCatalogRecord[]
): MusicLibraryExtensionFieldCapabilityInput[] {
  const definitions = createMusicLibraryFieldCapabilitiesFromNativeCatalog(catalog);
  replaceMusicLibraryBaseFieldCapabilities(definitions, {
    source: 'native-catalog',
  });
  return definitions;
}

export function isMusicLibraryRuntimeFieldCapability(
  field: MusicLibraryResolvedFieldCapability
): boolean {
  return field.source === 'native-catalog' || field.source === 'runtime-discovered';
}
