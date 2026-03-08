import type { MusicLibraryBaseOrderField, MusicLibraryBaseViewProperty } from './baseQuery';

export type LocalTrackColumnId =
  | 'title'
  | 'artist'
  | 'album'
  | 'duration'
  | 'year'
  | 'genre'
  | 'trackNumber'
  | 'discNumber'
  | 'composer'
  | 'bitrate'
  | 'sampleRate'
  | 'format'
  | 'playCount'
  | 'lastPlayed'
  | 'rating'
  | 'fileSize'
  | 'dateAdded';

export type LocalTrackColumnConfig = {
  id: LocalTrackColumnId;
  visible: boolean;
  widthPx?: number;
};

export type LocalTrackColumnDefinition = {
  headerKey: string;
  defaultWidthPx: number;
  minWidthPx: number;
  maxWidthPx?: number;
  className: string;
  sortField?: MusicLibraryBaseOrderField;
};

export const LOCAL_TRACK_COLUMN_ORDER: LocalTrackColumnId[] = [
  'title',
  'artist',
  'album',
  'duration',
  'year',
  'genre',
  'trackNumber',
  'discNumber',
  'composer',
  'bitrate',
  'sampleRate',
  'format',
  'playCount',
  'lastPlayed',
  'rating',
  'fileSize',
  'dateAdded',
];

export const DEFAULT_VISIBLE_LOCAL_TRACK_COLUMNS = new Set<LocalTrackColumnId>([
  'title',
  'artist',
  'album',
  'duration',
]);

export const LOCAL_TRACK_COLUMN_DEFINITIONS: Record<LocalTrackColumnId, LocalTrackColumnDefinition> = {
  title: {
    headerKey: 'pages.music-library.tracks.header.title',
    defaultWidthPx: 280,
    minWidthPx: 160,
    maxWidthPx: 640,
    className: 'music-library-track-title',
    sortField: 'title',
  },
  artist: {
    headerKey: 'pages.music-library.tracks.header.artist',
    defaultWidthPx: 220,
    minWidthPx: 120,
    maxWidthPx: 520,
    className: 'music-library-track-artist',
    sortField: 'artist',
  },
  album: {
    headerKey: 'pages.music-library.tracks.header.album',
    defaultWidthPx: 220,
    minWidthPx: 120,
    maxWidthPx: 520,
    className: 'music-library-track-album',
    sortField: 'album',
  },
  duration: {
    headerKey: 'pages.music-library.tracks.header.duration',
    defaultWidthPx: 84,
    minWidthPx: 72,
    maxWidthPx: 140,
    className: 'music-library-track-duration',
    sortField: 'duration',
  },
  year: {
    headerKey: 'pages.music-library.columns.year',
    defaultWidthPx: 80,
    minWidthPx: 60,
    maxWidthPx: 120,
    className: 'music-library-track-meta music-library-track-meta-number',
    sortField: 'year',
  },
  genre: {
    headerKey: 'pages.music-library.columns.genre',
    defaultWidthPx: 160,
    minWidthPx: 100,
    maxWidthPx: 360,
    className: 'music-library-track-meta',
    sortField: 'genre',
  },
  trackNumber: {
    headerKey: 'pages.music-library.columns.trackNumber',
    defaultWidthPx: 84,
    minWidthPx: 68,
    maxWidthPx: 120,
    className: 'music-library-track-meta music-library-track-meta-number',
  },
  discNumber: {
    headerKey: 'pages.music-library.columns.discNumber',
    defaultWidthPx: 84,
    minWidthPx: 68,
    maxWidthPx: 120,
    className: 'music-library-track-meta music-library-track-meta-number',
  },
  composer: {
    headerKey: 'pages.music-library.columns.composer',
    defaultWidthPx: 180,
    minWidthPx: 120,
    maxWidthPx: 420,
    className: 'music-library-track-meta',
  },
  bitrate: {
    headerKey: 'pages.music-library.columns.bitrate',
    defaultWidthPx: 110,
    minWidthPx: 88,
    maxWidthPx: 160,
    className: 'music-library-track-meta music-library-track-meta-number',
  },
  sampleRate: {
    headerKey: 'pages.music-library.columns.sampleRate',
    defaultWidthPx: 126,
    minWidthPx: 96,
    maxWidthPx: 180,
    className: 'music-library-track-meta music-library-track-meta-number',
    sortField: 'sampleRate',
  },
  format: {
    headerKey: 'pages.music-library.columns.format',
    defaultWidthPx: 100,
    minWidthPx: 82,
    maxWidthPx: 160,
    className: 'music-library-track-meta music-library-track-meta-code',
    sortField: 'format',
  },
  playCount: {
    headerKey: 'pages.music-library.columns.playCount',
    defaultWidthPx: 100,
    minWidthPx: 76,
    maxWidthPx: 140,
    className: 'music-library-track-meta music-library-track-meta-number',
    sortField: 'playCount',
  },
  lastPlayed: {
    headerKey: 'pages.music-library.columns.lastPlayed',
    defaultWidthPx: 180,
    minWidthPx: 130,
    maxWidthPx: 360,
    className: 'music-library-track-meta',
    sortField: 'lastPlayed',
  },
  rating: {
    headerKey: 'pages.music-library.columns.rating',
    defaultWidthPx: 84,
    minWidthPx: 64,
    maxWidthPx: 120,
    className: 'music-library-track-meta music-library-track-meta-number',
    sortField: 'rating',
  },
  fileSize: {
    headerKey: 'pages.music-library.columns.fileSize',
    defaultWidthPx: 120,
    minWidthPx: 96,
    maxWidthPx: 180,
    className: 'music-library-track-meta music-library-track-meta-number',
    sortField: 'fileSize',
  },
  dateAdded: {
    headerKey: 'pages.music-library.columns.dateAdded',
    defaultWidthPx: 180,
    minWidthPx: 130,
    maxWidthPx: 360,
    className: 'music-library-track-meta',
    sortField: 'dateAdded',
  },
};

export const LEFT_ALIGNED_LOCAL_TRACK_COLUMNS = new Set<LocalTrackColumnId>(['title', 'artist', 'album']);

const DEFAULT_LOCAL_TRACK_COLUMN_SETTINGS: LocalTrackColumnConfig[] = LOCAL_TRACK_COLUMN_ORDER.map((id) => ({
  id,
  visible: DEFAULT_VISIBLE_LOCAL_TRACK_COLUMNS.has(id),
  widthPx: LOCAL_TRACK_COLUMN_DEFINITIONS[id].defaultWidthPx,
}));

export function cloneDefaultLocalTrackColumnSettings(): LocalTrackColumnConfig[] {
  return DEFAULT_LOCAL_TRACK_COLUMN_SETTINGS.map((item) => ({ ...item }));
}

export function resolveMusicLibraryBaseFieldFromLocalTrackColumn(
  columnId: LocalTrackColumnId
): MusicLibraryBaseOrderField | null {
  return LOCAL_TRACK_COLUMN_DEFINITIONS[columnId].sortField ?? null;
}

function isLocalTrackColumnId(value: unknown): value is LocalTrackColumnId {
  return typeof value === 'string' && LOCAL_TRACK_COLUMN_ORDER.includes(value as LocalTrackColumnId);
}

export function normalizeLocalTrackColumnWidth(columnId: LocalTrackColumnId, widthPx: unknown): number {
  const definition = LOCAL_TRACK_COLUMN_DEFINITIONS[columnId];
  const fallback = definition.defaultWidthPx;
  if (typeof widthPx !== 'number' || !Number.isFinite(widthPx)) {
    return fallback;
  }

  const rounded = Math.round(widthPx);
  const min = definition.minWidthPx;
  const max = definition.maxWidthPx;

  if (typeof max === 'number') {
    return Math.min(max, Math.max(min, rounded));
  }
  return Math.max(min, rounded);
}

export function normalizeLocalTrackColumnSettings(input: unknown): LocalTrackColumnConfig[] {
  const orderedIds: LocalTrackColumnId[] = [];
  const visibilityMap = new Map<LocalTrackColumnId, boolean>();
  const widthMap = new Map<LocalTrackColumnId, number>();
  let hasExplicitVisibility = false;

  if (Array.isArray(input)) {
    for (const item of input) {
      if (isLocalTrackColumnId(item)) {
        if (!orderedIds.includes(item)) orderedIds.push(item);
        visibilityMap.set(item, true);
        continue;
      }

      if (!item || typeof item !== 'object') continue;
      const rawId = (item as { id?: unknown }).id;
      if (!isLocalTrackColumnId(rawId)) continue;
      if (!orderedIds.includes(rawId)) orderedIds.push(rawId);
      const rawVisible = (item as { visible?: unknown }).visible;
      const visible = typeof rawVisible === 'boolean' ? rawVisible : true;
      const rawWidthPx = (item as { widthPx?: unknown }).widthPx;
      visibilityMap.set(rawId, visible);
      widthMap.set(rawId, normalizeLocalTrackColumnWidth(rawId, rawWidthPx));
      hasExplicitVisibility = true;
    }
  }

  if (orderedIds.length === 0) {
    return cloneDefaultLocalTrackColumnSettings();
  }

  for (const id of LOCAL_TRACK_COLUMN_ORDER) {
    if (!orderedIds.includes(id)) {
      orderedIds.push(id);
    }
  }

  const useImplicitVisibleOnly = !hasExplicitVisibility;
  const normalized = orderedIds.map((id) => {
    const persistedVisible = visibilityMap.get(id);
    const visible =
      persistedVisible ??
      (useImplicitVisibleOnly ? false : DEFAULT_VISIBLE_LOCAL_TRACK_COLUMNS.has(id));
    return {
      id,
      visible,
      widthPx: widthMap.get(id) ?? LOCAL_TRACK_COLUMN_DEFINITIONS[id].defaultWidthPx,
    };
  });

  if (normalized.some((item) => item.visible)) {
    return normalized;
  }

  return normalized.map((item) =>
    item.id === 'title'
      ? {
          ...item,
          visible: true,
        }
      : item
  );
}

export function applyBaseViewPropertiesToLocalTrackColumns(
  properties: MusicLibraryBaseViewProperty[]
): LocalTrackColumnConfig[] {
  if (!Array.isArray(properties) || properties.length === 0) {
    return cloneDefaultLocalTrackColumnSettings();
  }

  return normalizeLocalTrackColumnSettings(
    properties
      .filter((property) => isLocalTrackColumnId(property.id))
      .map((property) => ({
        id: property.id,
        visible: property.visible,
        widthPx: property.widthPx,
      }))
  );
}
