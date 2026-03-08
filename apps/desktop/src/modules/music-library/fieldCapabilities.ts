import type {
  NativeLibraryTrackFilterField,
  NativeLibraryTrackSortField,
} from './nativeLibraryDb';

export type MusicLibraryBaseFieldKind = 'text' | 'number';

type MusicLibraryBuiltinFieldCapability = {
  headerKey: string;
  label: string;
  kind: MusicLibraryBaseFieldKind;
  filterable: boolean;
  sortable: boolean;
  groupable: boolean;
  trackKey?: string;
  nativeFilterField?: NativeLibraryTrackFilterField;
  nativeSortField?: NativeLibraryTrackSortField;
};

export type MusicLibraryExtensionFieldCapabilityInput = {
  id: string;
  headerKey?: string;
  label: string;
  kind?: MusicLibraryBaseFieldKind;
  filterable?: boolean;
  sortable?: boolean;
  groupable?: boolean;
  trackKey?: string;
  nativeFilterField?: NativeLibraryTrackFilterField;
  nativeSortField?: NativeLibraryTrackSortField;
};

export type MusicLibraryResolvedFieldCapability = {
  id: string;
  headerKey?: string;
  label: string;
  kind: MusicLibraryBaseFieldKind;
  filterable: boolean;
  sortable: boolean;
  groupable: boolean;
  trackKey?: string;
  nativeFilterField?: NativeLibraryTrackFilterField;
  nativeSortField?: NativeLibraryTrackSortField;
  source: 'builtin' | 'extension';
};

export const MUSIC_LIBRARY_BASE_FIELD_DEFINITIONS = {
  title: {
    headerKey: 'pages.music-library.tracks.header.title',
    label: 'Title',
    kind: 'text',
    filterable: true,
    sortable: true,
    groupable: false,
    nativeFilterField: 'title',
    nativeSortField: 'title',
  },
  artist: {
    headerKey: 'pages.music-library.tracks.header.artist',
    label: 'Artist',
    kind: 'text',
    filterable: true,
    sortable: true,
    groupable: true,
    nativeFilterField: 'artist',
    nativeSortField: 'artist',
  },
  album: {
    headerKey: 'pages.music-library.tracks.header.album',
    label: 'Album',
    kind: 'text',
    filterable: true,
    sortable: true,
    groupable: true,
    nativeFilterField: 'album',
    nativeSortField: 'album',
  },
  genre: {
    headerKey: 'pages.music-library.columns.genre',
    label: 'Genre',
    kind: 'text',
    filterable: true,
    sortable: true,
    groupable: true,
    nativeFilterField: 'genre',
    nativeSortField: 'genre',
  },
  year: {
    headerKey: 'pages.music-library.columns.year',
    label: 'Year',
    kind: 'number',
    filterable: true,
    sortable: true,
    groupable: true,
  },
  duration: {
    headerKey: 'pages.music-library.tracks.header.duration',
    label: 'Duration',
    kind: 'number',
    filterable: true,
    sortable: true,
    groupable: false,
    nativeFilterField: 'durationSeconds',
    nativeSortField: 'durationSeconds',
  },
  sampleRate: {
    headerKey: 'pages.music-library.columns.sampleRate',
    label: 'Sample Rate',
    kind: 'number',
    filterable: false,
    sortable: true,
    groupable: false,
    nativeSortField: 'sampleRate',
  },
  fileSize: {
    headerKey: 'pages.music-library.columns.fileSize',
    label: 'File Size',
    kind: 'number',
    filterable: false,
    sortable: true,
    groupable: false,
    nativeSortField: 'fileSize',
  },
  dateAdded: {
    headerKey: 'pages.music-library.columns.dateAdded',
    label: 'Date Added',
    kind: 'number',
    filterable: false,
    sortable: true,
    groupable: false,
    nativeSortField: 'updatedAtMs',
  },
  lastPlayed: {
    headerKey: 'pages.music-library.columns.lastPlayed',
    label: 'Last Played',
    kind: 'number',
    filterable: false,
    sortable: true,
    groupable: false,
    nativeSortField: 'lastPlayedAtMs',
  },
  rating: {
    headerKey: 'pages.music-library.columns.rating',
    label: 'Rating',
    kind: 'number',
    filterable: true,
    sortable: true,
    groupable: false,
  },
  playCount: {
    headerKey: 'pages.music-library.columns.playCount',
    label: 'Play Count',
    kind: 'number',
    filterable: true,
    sortable: true,
    groupable: false,
    nativeFilterField: 'playCount',
    nativeSortField: 'playCount',
  },
  format: {
    headerKey: 'pages.music-library.columns.format',
    label: 'Format',
    kind: 'text',
    filterable: true,
    sortable: true,
    groupable: true,
  },
} as const satisfies Record<string, MusicLibraryBuiltinFieldCapability>;

export type MusicLibraryBuiltinFieldKey = keyof typeof MUSIC_LIBRARY_BASE_FIELD_DEFINITIONS;
export type MusicLibraryBaseFieldId = MusicLibraryBuiltinFieldKey | (string & {});
export type MusicLibraryBaseFieldKey = MusicLibraryBuiltinFieldKey;

const extensionFieldDefinitions = new Map<string, MusicLibraryResolvedFieldCapability>();
const fieldCapabilityListeners = new Set<() => void>();

function notifyFieldCapabilityListeners(): void {
  for (const listener of fieldCapabilityListeners) {
    listener();
  }
}

function normalizeMusicLibraryBaseFieldId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toResolvedBuiltinFieldCapability(
  id: MusicLibraryBuiltinFieldKey
): MusicLibraryResolvedFieldCapability {
  const definition = MUSIC_LIBRARY_BASE_FIELD_DEFINITIONS[id];
  return {
    id,
    ...definition,
    source: 'builtin',
  };
}

function normalizeExtensionFieldCapability(
  input: MusicLibraryExtensionFieldCapabilityInput
): MusicLibraryResolvedFieldCapability | null {
  const id = normalizeMusicLibraryBaseFieldId(input.id);
  if (!id) return null;
  if (id in MUSIC_LIBRARY_BASE_FIELD_DEFINITIONS) return null;
  const label = input.label.trim();
  if (!label) return null;

  return {
    id,
    headerKey: typeof input.headerKey === 'string' && input.headerKey.trim() ? input.headerKey.trim() : undefined,
    label,
    kind: input.kind === 'number' ? 'number' : 'text',
    filterable: input.filterable !== false,
    sortable: input.sortable !== false,
    groupable: input.groupable === true,
    trackKey:
      typeof input.trackKey === 'string' && input.trackKey.trim().length > 0
        ? input.trackKey.trim()
        : id,
    nativeFilterField: input.nativeFilterField,
    nativeSortField: input.nativeSortField,
    source: 'extension',
  };
}

export const MUSIC_LIBRARY_BASE_FIELD_KEYS = Object.keys(
  MUSIC_LIBRARY_BASE_FIELD_DEFINITIONS
) as MusicLibraryBaseFieldKey[];

export const MUSIC_LIBRARY_BASE_NUMERIC_FIELDS = MUSIC_LIBRARY_BASE_FIELD_KEYS.filter(
  (field) => MUSIC_LIBRARY_BASE_FIELD_DEFINITIONS[field].kind === 'number'
);

export const MUSIC_LIBRARY_BASE_FILTER_FIELD_KEYS = MUSIC_LIBRARY_BASE_FIELD_KEYS.filter(
  (field) => MUSIC_LIBRARY_BASE_FIELD_DEFINITIONS[field].filterable
);

export const MUSIC_LIBRARY_BASE_ORDER_FIELD_KEYS = MUSIC_LIBRARY_BASE_FIELD_KEYS.filter(
  (field) => MUSIC_LIBRARY_BASE_FIELD_DEFINITIONS[field].sortable
);

export const MUSIC_LIBRARY_BASE_GROUP_FIELD_KEYS = MUSIC_LIBRARY_BASE_FIELD_KEYS.filter(
  (field) => MUSIC_LIBRARY_BASE_FIELD_DEFINITIONS[field].groupable
);

export function registerMusicLibraryBaseFieldCapabilities(
  definitions: MusicLibraryExtensionFieldCapabilityInput[]
): void {
  let changed = false;
  for (const definition of definitions) {
    const normalized = normalizeExtensionFieldCapability(definition);
    if (!normalized) continue;
    const previous = extensionFieldDefinitions.get(normalized.id);
    if (previous && JSON.stringify(previous) === JSON.stringify(normalized)) {
      continue;
    }
    extensionFieldDefinitions.set(normalized.id, normalized);
    changed = true;
  }
  if (changed) notifyFieldCapabilityListeners();
}

export function unregisterMusicLibraryBaseFieldCapability(field: string): void {
  const normalized = normalizeMusicLibraryBaseFieldId(field);
  if (!normalized) return;
  if (extensionFieldDefinitions.delete(normalized)) {
    notifyFieldCapabilityListeners();
  }
}

export function clearRegisteredMusicLibraryBaseFieldCapabilities(): void {
  if (extensionFieldDefinitions.size === 0) return;
  extensionFieldDefinitions.clear();
  notifyFieldCapabilityListeners();
}

export function subscribeMusicLibraryBaseFieldCapabilities(listener: () => void): () => void {
  fieldCapabilityListeners.add(listener);
  return () => {
    fieldCapabilityListeners.delete(listener);
  };
}

export function listMusicLibraryBaseFieldCapabilities(): MusicLibraryResolvedFieldCapability[] {
  return [
    ...MUSIC_LIBRARY_BASE_FIELD_KEYS.map((field) => toResolvedBuiltinFieldCapability(field)),
    ...extensionFieldDefinitions.values(),
  ];
}

export function listRegisteredMusicLibraryBaseFieldCapabilities(): MusicLibraryExtensionFieldCapabilityInput[] {
  return [...extensionFieldDefinitions.values()].map((field) => ({
    id: field.id,
    headerKey: field.headerKey,
    label: field.label,
    kind: field.kind,
    filterable: field.filterable,
    sortable: field.sortable,
    groupable: field.groupable,
    trackKey: field.trackKey,
    nativeFilterField: field.nativeFilterField,
    nativeSortField: field.nativeSortField,
  }));
}

export function listMusicLibraryBaseOrderFieldIds(): MusicLibraryBaseFieldId[] {
  return listMusicLibraryBaseFieldCapabilities()
    .filter((field) => field.sortable)
    .map((field) => field.id);
}

export function listMusicLibraryBaseGroupFieldIds(): MusicLibraryBaseFieldId[] {
  return listMusicLibraryBaseFieldCapabilities()
    .filter((field) => field.groupable)
    .map((field) => field.id);
}

export function listMusicLibraryBaseFilterFieldIds(): MusicLibraryBaseFieldId[] {
  return listMusicLibraryBaseFieldCapabilities()
    .filter((field) => field.filterable)
    .map((field) => field.id);
}

export function isMusicLibraryBaseFieldNumeric(field: MusicLibraryBaseFieldId): boolean {
  return getMusicLibraryBaseFieldCapability(field)?.kind === 'number';
}

export function getMusicLibraryBaseFieldCapability(
  field: MusicLibraryBaseFieldId
): MusicLibraryResolvedFieldCapability | null {
  const normalized = normalizeMusicLibraryBaseFieldId(field);
  if (!normalized) return null;
  if (normalized in MUSIC_LIBRARY_BASE_FIELD_DEFINITIONS) {
    return toResolvedBuiltinFieldCapability(normalized as MusicLibraryBuiltinFieldKey);
  }
  return extensionFieldDefinitions.get(normalized) ?? null;
}

export function resolveMusicLibraryBaseFieldLabel(field: MusicLibraryBaseFieldId): string {
  return getMusicLibraryBaseFieldCapability(field)?.label ?? String(field);
}

export function resolveMusicLibraryBaseFieldHeaderKey(
  field: MusicLibraryBaseFieldId
): string | undefined {
  return getMusicLibraryBaseFieldCapability(field)?.headerKey;
}

export function getMusicLibraryBaseNativeFilterField(
  field: MusicLibraryBaseFieldId
): NativeLibraryTrackFilterField | null {
  const capability = getMusicLibraryBaseFieldCapability(field);
  if (!capability) return null;
  return 'nativeFilterField' in capability ? capability.nativeFilterField ?? null : null;
}

export function getMusicLibraryBaseNativeSortField(
  field: MusicLibraryBaseFieldId
): NativeLibraryTrackSortField | null {
  const capability = getMusicLibraryBaseFieldCapability(field);
  if (!capability) return null;
  return 'nativeSortField' in capability ? capability.nativeSortField ?? null : null;
}
