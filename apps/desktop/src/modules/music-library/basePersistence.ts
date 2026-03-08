import { readJson, writeJson } from '../storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import {
  createDefaultMusicLibraryBaseSchema,
  normalizeMusicLibraryBaseSchema,
  type MusicLibraryBaseQuery,
  type MusicLibraryBaseSchema,
  type MusicLibraryBaseView,
  type MusicLibraryBaseViewProperty,
} from './baseQuery';
import type { MusicLibraryExtensionFieldCapabilityInput } from './fieldCapabilities';

type BaseColumnShape = {
  id: string;
  visible: boolean;
  widthPx?: number;
};

export interface LoadMusicLibraryBaseStateOptions<ColumnConfig extends BaseColumnShape> {
  createDefaultColumns: () => ColumnConfig[];
  normalizeColumns: (input: unknown) => ColumnConfig[];
  applyBaseViewPropertiesToColumns: (properties: MusicLibraryBaseViewProperty[]) => ColumnConfig[];
}

export interface LoadedMusicLibraryBaseState<ColumnConfig extends BaseColumnShape> {
  schema: MusicLibraryBaseSchema;
  columns: ColumnConfig[];
}

export interface PersistMusicLibraryBaseStateOptions<ColumnConfig extends BaseColumnShape> {
  query: MusicLibraryBaseQuery;
  viewMode: MusicLibraryBaseView;
  columns: ColumnConfig[];
  debounceMs?: number;
}

function normalizePersistedFieldCapabilities(
  input: unknown
): MusicLibraryExtensionFieldCapabilityInput[] {
  if (!Array.isArray(input)) return [];

  const definitions: MusicLibraryExtensionFieldCapabilityInput[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Partial<MusicLibraryExtensionFieldCapabilityInput>;
    if (typeof candidate.id !== 'string' || candidate.id.trim().length === 0) continue;
    if (typeof candidate.label !== 'string' || candidate.label.trim().length === 0) continue;

    definitions.push({
      id: candidate.id.trim(),
      headerKey:
        typeof candidate.headerKey === 'string' && candidate.headerKey.trim().length > 0
          ? candidate.headerKey.trim()
          : undefined,
      label: candidate.label.trim(),
      kind: candidate.kind === 'number' ? 'number' : 'text',
      filterable: candidate.filterable !== false,
      sortable: candidate.sortable !== false,
      groupable: candidate.groupable === true,
      trackKey:
        typeof candidate.trackKey === 'string' && candidate.trackKey.trim().length > 0
          ? candidate.trackKey.trim()
          : undefined,
      nativeFilterField: candidate.nativeFilterField,
      nativeSortField: candidate.nativeSortField,
    });
  }

  return definitions;
}

export function loadMusicLibraryBaseState<ColumnConfig extends BaseColumnShape>(
  options: LoadMusicLibraryBaseStateOptions<ColumnConfig>
): LoadedMusicLibraryBaseState<ColumnConfig> {
  const storedBaseSchema = readJson<unknown>(STORAGE_KEYS.MUSIC_LIBRARY_BASE_SCHEMA_V1, null);

  if (storedBaseSchema) {
    const schema = normalizeMusicLibraryBaseSchema(storedBaseSchema);
    return {
      schema,
      columns: options.applyBaseViewPropertiesToColumns(schema.view.properties),
    };
  }

  const legacyColumns = readJson<unknown>(
    STORAGE_KEYS.MUSIC_LIBRARY_TRACK_COLUMNS_V1,
    options.createDefaultColumns()
  );

  return {
    schema: createDefaultMusicLibraryBaseSchema(),
    columns: options.normalizeColumns(legacyColumns),
  };
}

export function persistMusicLibraryBaseState<ColumnConfig extends BaseColumnShape>(
  options: PersistMusicLibraryBaseStateOptions<ColumnConfig>
): void {
  const debounceMs =
    typeof options.debounceMs === 'number' && Number.isFinite(options.debounceMs)
      ? Math.max(0, Math.floor(options.debounceMs))
      : 150;

  const schema: MusicLibraryBaseSchema = {
    version: 1,
    query: options.query,
    view: {
      mode: options.viewMode,
      properties: options.columns.map((column) => ({
        id: column.id,
        visible: column.visible,
        widthPx: column.widthPx,
      })),
    },
  };

  writeJson(STORAGE_KEYS.MUSIC_LIBRARY_BASE_SCHEMA_V1, schema, {
    mode: 'idle',
    debounceMs,
  });
}

export function loadMusicLibraryBaseFieldCapabilities(): MusicLibraryExtensionFieldCapabilityInput[] {
  const stored = readJson<unknown>(STORAGE_KEYS.MUSIC_LIBRARY_FIELD_CAPABILITIES_V1, []);
  return normalizePersistedFieldCapabilities(stored);
}

export function persistMusicLibraryBaseFieldCapabilities(
  definitions: MusicLibraryExtensionFieldCapabilityInput[],
  options?: { debounceMs?: number }
): void {
  const debounceMs =
    typeof options?.debounceMs === 'number' && Number.isFinite(options.debounceMs)
      ? Math.max(0, Math.floor(options.debounceMs))
      : 150;

  writeJson(
    STORAGE_KEYS.MUSIC_LIBRARY_FIELD_CAPABILITIES_V1,
    normalizePersistedFieldCapabilities(definitions),
    {
      mode: 'idle',
      debounceMs,
    }
  );
}
