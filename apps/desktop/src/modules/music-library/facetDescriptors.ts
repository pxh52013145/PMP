import {
  canFacetMusicLibraryBaseField,
  getMusicLibraryBaseFieldCapability,
  type MusicLibraryBaseFieldId,
} from './fieldCapabilities';

export type MusicLibraryFacetDescriptorKind = 'text-values' | 'album-summaries';

type MusicLibraryBuiltinFacetCollectionId = 'artists' | 'genres' | 'albums';
type MusicLibraryDynamicFacetCollectionId = string & {
  readonly __musicLibraryFacetCollectionIdBrand?: unique symbol;
};

export type MusicLibraryFacetCollectionId =
  | MusicLibraryBuiltinFacetCollectionId
  | MusicLibraryDynamicFacetCollectionId;

export interface MusicLibraryFieldFacetDescriptor {
  id: string;
  field: MusicLibraryBaseFieldId;
  label: string;
  kind: 'text-values';
  nativeField: string;
}

export interface MusicLibraryCollectionFacetDescriptor {
  id: MusicLibraryFacetCollectionId;
  field: MusicLibraryBaseFieldId;
  label: string;
  kind: MusicLibraryFacetDescriptorKind;
  nativeField?: string;
}

const DEFAULT_MUSIC_LIBRARY_COLLECTION_FACET_DESCRIPTORS: Record<
  MusicLibraryBuiltinFacetCollectionId,
  MusicLibraryCollectionFacetDescriptor
> = {
  artists: {
    id: 'artists',
    field: 'artist',
    label: 'Artist',
    kind: 'text-values',
    nativeField: 'artist',
  },
  genres: {
    id: 'genres',
    field: 'genre',
    label: 'Genre',
    kind: 'text-values',
    nativeField: 'genre',
  },
  albums: {
    id: 'albums',
    field: 'album',
    label: 'Album',
    kind: 'album-summaries',
    nativeField: 'album',
  },
};

const runtimeCollectionFacetDescriptors = new Map<string, MusicLibraryCollectionFacetDescriptor>();
const facetCollectionDescriptorListeners = new Set<() => void>();

function notifyFacetCollectionDescriptorListeners(): void {
  facetCollectionDescriptorListeners.forEach((listener) => {
    listener();
  });
}

function areFacetCollectionDescriptorMapsEqual(
  left: Map<string, MusicLibraryCollectionFacetDescriptor>,
  right: Map<string, MusicLibraryCollectionFacetDescriptor>
): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left.entries()) {
    const candidate = right.get(key);
    if (
      !candidate ||
      candidate.field !== value.field ||
      candidate.label !== value.label ||
      candidate.kind !== value.kind ||
      candidate.nativeField !== value.nativeField
    ) {
      return false;
    }
  }
  return true;
}

export function clearRegisteredMusicLibraryFacetCollectionDescriptors(): void {
  if (runtimeCollectionFacetDescriptors.size === 0) return;
  runtimeCollectionFacetDescriptors.clear();
  notifyFacetCollectionDescriptorListeners();
}

export function registerMusicLibraryFacetCollectionDescriptors(
  descriptors: MusicLibraryCollectionFacetDescriptor[],
  options?: { replace?: boolean }
): void {
  if (options?.replace) {
    const nextMap = new Map<string, MusicLibraryCollectionFacetDescriptor>();
    descriptors.forEach((descriptor) => {
      nextMap.set(descriptor.id, descriptor);
    });

    if (areFacetCollectionDescriptorMapsEqual(runtimeCollectionFacetDescriptors, nextMap)) {
      return;
    }

    runtimeCollectionFacetDescriptors.clear();
    nextMap.forEach((descriptor, id) => {
      runtimeCollectionFacetDescriptors.set(id, descriptor);
    });
    notifyFacetCollectionDescriptorListeners();
    return;
  }

  let changed = false;
  descriptors.forEach((descriptor) => {
    const previous = runtimeCollectionFacetDescriptors.get(descriptor.id);
    if (
      !previous ||
      previous.field !== descriptor.field ||
      previous.label !== descriptor.label ||
      previous.kind !== descriptor.kind ||
      previous.nativeField !== descriptor.nativeField
    ) {
      changed = true;
    }
    runtimeCollectionFacetDescriptors.set(descriptor.id, descriptor);
  });

  if (changed) {
    notifyFacetCollectionDescriptorListeners();
  }
}

export function subscribeMusicLibraryFacetCollectionDescriptors(
  listener: () => void
): () => void {
  facetCollectionDescriptorListeners.add(listener);
  return () => {
    facetCollectionDescriptorListeners.delete(listener);
  };
}

export function listMusicLibraryFacetCollectionDescriptors(): MusicLibraryCollectionFacetDescriptor[] {
  const merged = new Map<string, MusicLibraryCollectionFacetDescriptor>();
  Object.values(DEFAULT_MUSIC_LIBRARY_COLLECTION_FACET_DESCRIPTORS).forEach((descriptor) => {
    merged.set(descriptor.id, descriptor);
  });
  runtimeCollectionFacetDescriptors.forEach((descriptor, id) => {
    merged.set(id, descriptor);
  });
  return Array.from(merged.values());
}

export function getMusicLibraryFacetCollectionDescriptor(
  id: MusicLibraryFacetCollectionId
): MusicLibraryCollectionFacetDescriptor | null {
  return (
    runtimeCollectionFacetDescriptors.get(id) ??
    DEFAULT_MUSIC_LIBRARY_COLLECTION_FACET_DESCRIPTORS[
      id as MusicLibraryBuiltinFacetCollectionId
    ] ??
    null
  );
}

export function resolveMusicLibraryFieldFacetDescriptor(
  field: MusicLibraryBaseFieldId
): MusicLibraryFieldFacetDescriptor | null {
  if (!canFacetMusicLibraryBaseField(field)) {
    return null;
  }

  const capability = getMusicLibraryBaseFieldCapability(field);
  if (!capability) {
    return null;
  }

  const nativeField = capability.nativeFilterField ?? capability.trackKey ?? capability.id;
  const normalizedField = nativeField.trim();
  if (!normalizedField) {
    return null;
  }

  return {
    id: `field:${capability.id}`,
    field: capability.id,
    label: capability.label,
    kind: 'text-values',
    nativeField: normalizedField,
  };
}
