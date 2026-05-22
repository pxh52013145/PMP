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
  facetable?: boolean;
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
  facetable?: boolean;
  trackKey?: string;
  nativeFilterField?: NativeLibraryTrackFilterField;
  nativeSortField?: NativeLibraryTrackSortField;
};

export type MusicLibraryCustomFieldCapabilitySource =
  | 'extension'
  | 'native-catalog'
  | 'runtime-discovered';

export type MusicLibraryResolvedFieldCapability = {
  id: string;
  headerKey?: string;
  label: string;
  kind: MusicLibraryBaseFieldKind;
  filterable: boolean;
  sortable: boolean;
  groupable: boolean;
  facetable: boolean;
  trackKey?: string;
  nativeFilterField?: NativeLibraryTrackFilterField;
  nativeSortField?: NativeLibraryTrackSortField;
  source: 'builtin' | MusicLibraryCustomFieldCapabilitySource;
};

function resolveMusicLibraryFieldFacetable(
  capability: Pick<
    MusicLibraryExtensionFieldCapabilityInput,
    'kind' | 'filterable' | 'groupable' | 'facetable'
  >
): boolean {
  if (typeof capability.facetable === 'boolean') {
    return capability.facetable;
  }
  const kind = capability.kind === 'number' ? 'number' : 'text';
  const filterable = capability.filterable !== false;
  const groupable = capability.groupable === true;
  return kind === 'text' && (filterable || groupable);
}

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
    nativeFilterField: 'year',
    nativeSortField: 'year',
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
    nativeSortField: 'createdAtMs',
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
    nativeFilterField: 'format',
    nativeSortField: 'format',
  },
} as const satisfies Record<string, MusicLibraryBuiltinFieldCapability>;

export type MusicLibraryBuiltinFieldKey = keyof typeof MUSIC_LIBRARY_BASE_FIELD_DEFINITIONS;
type MusicLibraryDynamicFieldId = string & {
  readonly __musicLibraryDynamicFieldIdBrand?: unique symbol;
};

const MUSIC_LIBRARY_HIDDEN_BASE_UI_FIELD_IDS = new Set<string>([
  'id',
  'sourceId',
  'libraryPathId',
  'filePath',
  'path',
  'originalPath',
  'quickFingerprint',
  'mtimeMs',
  'metadataScannedAtMs',
  'coverKey',
  'coverUrl',
  'replayGainTrackGainDb',
  'replayGainAlbumGainDb',
  'status',
  'updatedAtMs',
  'lastSeenAtMs',
  'createdAtMs',
  'addedAt',
]);

const MUSIC_LIBRARY_RUNTIME_FIELD_HEADER_KEY_MAP: Record<string, string> = {
  bitDepth: 'pages.music-library.columns.bitDepth',
};

export type MusicLibraryBaseFieldId = MusicLibraryBuiltinFieldKey | MusicLibraryDynamicFieldId;
export type MusicLibraryBaseFieldKey = MusicLibraryBuiltinFieldKey;

const persistedFieldDefinitions = new Map<string, MusicLibraryResolvedFieldCapability>();
const nativeCatalogFieldDefinitions = new Map<string, MusicLibraryResolvedFieldCapability>();
const runtimeDiscoveredFieldDefinitions = new Map<string, MusicLibraryResolvedFieldCapability>();
const fieldCapabilityListeners = new Set<() => void>();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    persistedFieldDefinitions.clear();
    nativeCatalogFieldDefinitions.clear();
    runtimeDiscoveredFieldDefinitions.clear();
    fieldCapabilityListeners.clear();
  });
}

function getCustomFieldCapabilityMap(
  source: MusicLibraryCustomFieldCapabilitySource
): Map<string, MusicLibraryResolvedFieldCapability> {
  switch (source) {
    case 'native-catalog':
      return nativeCatalogFieldDefinitions;
    case 'runtime-discovered':
      return runtimeDiscoveredFieldDefinitions;
    case 'extension':
    default:
      return persistedFieldDefinitions;
  }
}

function listCustomFieldCapabilityMapsInPriorityOrder(): Map<
  string,
  MusicLibraryResolvedFieldCapability
>[] {
  return [persistedFieldDefinitions, nativeCatalogFieldDefinitions, runtimeDiscoveredFieldDefinitions];
}

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
    facetable: resolveMusicLibraryFieldFacetable(definition),
    source: 'builtin',
  };
}


function areFieldCapabilityMapsEqual(
  left: Map<string, MusicLibraryResolvedFieldCapability>,
  right: Map<string, MusicLibraryResolvedFieldCapability>
): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left.entries()) {
    const candidate = right.get(key);
    if (!candidate || JSON.stringify(candidate) !== JSON.stringify(value)) {
      return false;
    }
  }
  return true;
}

function normalizeExtensionFieldCapability(
  input: MusicLibraryExtensionFieldCapabilityInput,
  source: MusicLibraryCustomFieldCapabilitySource
): MusicLibraryResolvedFieldCapability | null {
  const id = normalizeMusicLibraryBaseFieldId(input.id);
  if (!id) return null;
  if (id in MUSIC_LIBRARY_BASE_FIELD_DEFINITIONS) return null;
  const label = input.label.trim();
  if (!label) return null;

  return {
    id,
    headerKey:
      typeof input.headerKey === 'string' && input.headerKey.trim()
        ? input.headerKey.trim()
        : MUSIC_LIBRARY_RUNTIME_FIELD_HEADER_KEY_MAP[id],
    label,
    kind: input.kind === 'number' ? 'number' : 'text',
    filterable: input.filterable !== false,
    sortable: input.sortable !== false,
    groupable: input.groupable === true,
    facetable: resolveMusicLibraryFieldFacetable(input),
    trackKey:
      typeof input.trackKey === 'string' && input.trackKey.trim().length > 0
        ? input.trackKey.trim()
        : id,
    nativeFilterField: input.nativeFilterField,
    nativeSortField: input.nativeSortField,
    source,
  };
}

function isMusicLibraryBaseUiFieldHidden(
  capability: Pick<MusicLibraryResolvedFieldCapability, 'id' | 'trackKey' | 'source'>
): boolean {
  if (capability.source === 'builtin') return false;

  if (MUSIC_LIBRARY_HIDDEN_BASE_UI_FIELD_IDS.has(capability.id)) {
    return true;
  }

  return (
    typeof capability.trackKey === 'string' &&
    MUSIC_LIBRARY_HIDDEN_BASE_UI_FIELD_IDS.has(capability.trackKey)
  );
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
  definitions: MusicLibraryExtensionFieldCapabilityInput[],
  options?: { source?: MusicLibraryCustomFieldCapabilitySource }
): void {
  const source = options?.source ?? 'extension';
  const targetMap = getCustomFieldCapabilityMap(source);
  let changed = false;
  for (const definition of definitions) {
    const normalized = normalizeExtensionFieldCapability(definition, source);
    if (!normalized) continue;
    const previous = targetMap.get(normalized.id);
    if (previous && JSON.stringify(previous) === JSON.stringify(normalized)) {
      continue;
    }
    targetMap.set(normalized.id, normalized);
    changed = true;
  }
  if (changed) notifyFieldCapabilityListeners();
}

export function replaceMusicLibraryBaseFieldCapabilities(
  definitions: MusicLibraryExtensionFieldCapabilityInput[],
  options?: { source?: MusicLibraryCustomFieldCapabilitySource }
): void {
  const source = options?.source ?? 'extension';
  const targetMap = getCustomFieldCapabilityMap(source);
  const nextMap = new Map<string, MusicLibraryResolvedFieldCapability>();

  for (const definition of definitions) {
    const normalized = normalizeExtensionFieldCapability(definition, source);
    if (!normalized) continue;
    nextMap.set(normalized.id, normalized);
  }

  if (areFieldCapabilityMapsEqual(targetMap, nextMap)) {
    return;
  }

  targetMap.clear();
  nextMap.forEach((value, key) => {
    targetMap.set(key, value);
  });
  notifyFieldCapabilityListeners();
}

export function unregisterMusicLibraryBaseFieldCapability(
  field: string,
  options?: { source?: MusicLibraryCustomFieldCapabilitySource }
): void {
  const normalized = normalizeMusicLibraryBaseFieldId(field);
  if (!normalized) return;
  const source = options?.source;
  let changed = false;

  if (source) {
    changed = getCustomFieldCapabilityMap(source).delete(normalized);
  } else {
    for (const map of listCustomFieldCapabilityMapsInPriorityOrder()) {
      changed = map.delete(normalized) || changed;
    }
  }

  if (changed) {
    notifyFieldCapabilityListeners();
  }
}

export function clearRegisteredMusicLibraryBaseFieldCapabilities(
  options?: { source?: MusicLibraryCustomFieldCapabilitySource }
): void {
  const source = options?.source;
  let changed = false;

  if (source) {
    const targetMap = getCustomFieldCapabilityMap(source);
    if (targetMap.size > 0) {
      targetMap.clear();
      changed = true;
    }
  } else {
    for (const map of listCustomFieldCapabilityMapsInPriorityOrder()) {
      if (map.size === 0) continue;
      map.clear();
      changed = true;
    }
  }

  if (!changed) return;
  notifyFieldCapabilityListeners();
}

export function subscribeMusicLibraryBaseFieldCapabilities(listener: () => void): () => void {
  fieldCapabilityListeners.add(listener);
  return () => {
    fieldCapabilityListeners.delete(listener);
  };
}

export function listMusicLibraryBaseFieldCapabilities(): MusicLibraryResolvedFieldCapability[] {
  const customById = new Map<string, MusicLibraryResolvedFieldCapability>();
  for (const map of listCustomFieldCapabilityMapsInPriorityOrder()) {
    for (const [fieldId, capability] of map.entries()) {
      if (customById.has(fieldId)) continue;
      if (isMusicLibraryBaseUiFieldHidden(capability)) continue;
      customById.set(fieldId, capability);
    }
  }

  return [
    ...MUSIC_LIBRARY_BASE_FIELD_KEYS.map((field) => toResolvedBuiltinFieldCapability(field)),
    ...customById.values(),
  ];
}

export function isMusicLibraryBaseFieldVisibleInBaseUi(field: MusicLibraryBaseFieldId): boolean {
  const capability = getMusicLibraryBaseFieldCapability(field);
  if (!capability) return false;
  return !isMusicLibraryBaseUiFieldHidden(capability);
}

export function listRegisteredMusicLibraryBaseFieldCapabilities(): MusicLibraryExtensionFieldCapabilityInput[] {
  return [...persistedFieldDefinitions.values()].map((field) => ({
    id: field.id,
    headerKey: field.headerKey,
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

export function canFacetMusicLibraryBaseField(field: MusicLibraryBaseFieldId): boolean {
  return getMusicLibraryBaseFieldCapability(field)?.facetable === true;
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
  for (const map of listCustomFieldCapabilityMapsInPriorityOrder()) {
    const capability = map.get(normalized);
    if (capability) return capability;
  }
  return null;
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
