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
