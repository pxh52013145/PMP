import { Track } from '../../services/audio';

export type MusicLibraryBaseView = 'table' | 'card';

export type MusicLibraryBaseField =
  | 'title'
  | 'artist'
  | 'album'
  | 'genre'
  | 'year'
  | 'duration'
  | 'rating'
  | 'playCount'
  | 'format';

export type MusicLibraryBaseOperator =
  | 'contains'
  | 'equals'
  | 'not_equals'
  | 'gte'
  | 'lte'
  | 'is_empty'
  | 'is_not_empty';

export type MusicLibraryBaseLogicalOperator = 'and' | 'or';

export type MusicLibraryBaseSortField = 'default' | MusicLibraryBaseField;
export type MusicLibraryBaseOrderField = Exclude<MusicLibraryBaseSortField, 'default'>;

export interface MusicLibraryBaseFilter {
  id: string;
  field: MusicLibraryBaseField;
  operator: MusicLibraryBaseOperator;
  value?: string;
}

export interface MusicLibraryBaseFilterGroup {
  id: string;
  operator: MusicLibraryBaseLogicalOperator;
  filters: MusicLibraryBaseFilter[];
}

export interface MusicLibraryBaseOrderRule {
  id: string;
  field: MusicLibraryBaseOrderField;
  order: 'asc' | 'desc';
}

export type MusicLibraryBaseSortRule = MusicLibraryBaseOrderRule;
export type MusicLibraryBaseGroupRule = MusicLibraryBaseOrderRule;

export interface MusicLibraryBaseQuery {
  filterOperator: MusicLibraryBaseLogicalOperator;
  filterGroups: MusicLibraryBaseFilterGroup[];
  groupByRules: MusicLibraryBaseGroupRule[];
  sortRules: MusicLibraryBaseSortRule[];
}

export interface MusicLibraryBaseViewProperty {
  id: string;
  visible: boolean;
  widthPx?: number;
}

export interface MusicLibraryBaseViewSchema {
  mode: MusicLibraryBaseView;
  properties: MusicLibraryBaseViewProperty[];
}

export interface MusicLibraryBaseSchema {
  version: 1;
  query: MusicLibraryBaseQuery;
  view: MusicLibraryBaseViewSchema;
}

const MUSIC_LIBRARY_BASE_FIELDS = new Set<MusicLibraryBaseField>([
  'title',
  'artist',
  'album',
  'genre',
  'year',
  'duration',
  'rating',
  'playCount',
  'format',
]);

const MUSIC_LIBRARY_BASE_OPERATORS = new Set<MusicLibraryBaseOperator>([
  'contains',
  'equals',
  'not_equals',
  'gte',
  'lte',
  'is_empty',
  'is_not_empty',
]);

const NUMERIC_FIELDS = new Set<MusicLibraryBaseField>(['year', 'duration', 'rating', 'playCount']);

const NATIVE_FILTER_FIELDS = new Set<MusicLibraryBaseField>([
  'title',
  'artist',
  'album',
  'genre',
  'duration',
  'playCount',
]);

const NATIVE_SORT_FIELDS = new Set<MusicLibraryBaseOrderField>([
  'title',
  'artist',
  'album',
  'genre',
  'duration',
  'playCount',
]);

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveTrackFieldValue(track: Track, field: MusicLibraryBaseField): string | number | undefined {
  switch (field) {
    case 'title':
      return track.title || '';
    case 'artist':
      return track.artist || '';
    case 'album':
      return track.album || '';
    case 'genre':
      return track.genre || '';
    case 'year':
      return typeof track.year === 'number' && Number.isFinite(track.year) ? track.year : undefined;
    case 'duration':
      return typeof track.duration === 'number' && Number.isFinite(track.duration)
        ? track.duration
        : undefined;
    case 'rating':
      return typeof track.rating === 'number' && Number.isFinite(track.rating) ? track.rating : undefined;
    case 'playCount':
      return typeof track.playCount === 'number' && Number.isFinite(track.playCount)
        ? track.playCount
        : undefined;
    case 'format': {
      const explicit = (track.format || track.codecName || '').trim();
      if (explicit.length > 0) return explicit;
      const path = (track.path || track.originalPath || '').trim();
      const ext = path.includes('.') ? path.split('.').pop()?.trim() ?? '' : '';
      return ext;
    }
    default:
      return undefined;
  }
}

function normalizeFilterInput(raw: unknown): MusicLibraryBaseFilter | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<MusicLibraryBaseFilter>;
  if (!candidate.id || typeof candidate.id !== 'string') return null;
  if (!candidate.field || !MUSIC_LIBRARY_BASE_FIELDS.has(candidate.field)) return null;
  if (!candidate.operator || !MUSIC_LIBRARY_BASE_OPERATORS.has(candidate.operator)) return null;

  const needsValue =
    candidate.operator === 'contains' ||
    candidate.operator === 'equals' ||
    candidate.operator === 'not_equals' ||
    candidate.operator === 'gte' ||
    candidate.operator === 'lte';

  const normalizedValue =
    typeof candidate.value === 'string' && candidate.value.trim().length > 0
      ? candidate.value.trim()
      : undefined;

  if (needsValue && !normalizedValue) return null;

  return {
    id: candidate.id,
    field: candidate.field,
    operator: candidate.operator,
    value: needsValue ? normalizedValue : undefined,
  };
}

function normalizeOrderRuleInput(raw: unknown): MusicLibraryBaseOrderRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<MusicLibraryBaseOrderRule>;
  if (!candidate.id || typeof candidate.id !== 'string') return null;
  if (!candidate.field || !NATIVE_SORT_FIELDS.has(candidate.field)) return null;
  const order = candidate.order === 'desc' ? 'desc' : 'asc';

  return {
    id: candidate.id,
    field: candidate.field,
    order,
  };
}

function normalizePropertiesInput(raw: unknown): MusicLibraryBaseViewProperty[] {
  if (!Array.isArray(raw)) return [];

  const result: MusicLibraryBaseViewProperty[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Partial<MusicLibraryBaseViewProperty>;
    if (!candidate.id || typeof candidate.id !== 'string') continue;
    if (typeof candidate.visible !== 'boolean') continue;

    const widthPx =
      typeof candidate.widthPx === 'number' && Number.isFinite(candidate.widthPx) && candidate.widthPx > 0
        ? candidate.widthPx
        : undefined;

    result.push({
      id: candidate.id,
      visible: candidate.visible,
      widthPx,
    });
  }

  return result;
}

function normalizeLogicalOperatorInput(raw: unknown): MusicLibraryBaseLogicalOperator {
  return raw === 'or' ? 'or' : 'and';
}

function normalizeFilterGroupInput(raw: unknown): MusicLibraryBaseFilterGroup | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<MusicLibraryBaseFilterGroup>;
  if (!candidate.id || typeof candidate.id !== 'string') return null;

  const filters = Array.isArray(candidate.filters)
    ? candidate.filters
        .map(normalizeFilterInput)
        .filter((item): item is MusicLibraryBaseFilter => item != null)
        .slice(0, 20)
    : [];

  return {
    id: candidate.id,
    operator: normalizeLogicalOperatorInput(candidate.operator),
    filters,
  };
}

function flattenFilterGroups(groups: MusicLibraryBaseFilterGroup[]): MusicLibraryBaseFilter[] {
  const flattened: MusicLibraryBaseFilter[] = [];
  for (const group of groups) {
    for (const filter of group.filters) {
      flattened.push(filter);
      if (flattened.length >= 100) return flattened;
    }
  }
  return flattened;
}

function matchesFilter(track: Track, filter: MusicLibraryBaseFilter): boolean {
  const fieldValue = resolveTrackFieldValue(track, filter.field);

  if (filter.operator === 'is_empty') {
    if (fieldValue === undefined || fieldValue === null) return true;
    if (typeof fieldValue === 'number') return !Number.isFinite(fieldValue);
    return normalizeText(fieldValue).length === 0;
  }

  if (filter.operator === 'is_not_empty') {
    if (fieldValue === undefined || fieldValue === null) return false;
    if (typeof fieldValue === 'number') return Number.isFinite(fieldValue);
    return normalizeText(fieldValue).length > 0;
  }

  if (NUMERIC_FIELDS.has(filter.field)) {
    const left = normalizeNumber(fieldValue);
    const right = normalizeNumber(filter.value);
    if (left === undefined || right === undefined) return false;

    if (filter.operator === 'equals') return left === right;
    if (filter.operator === 'not_equals') return left !== right;
    if (filter.operator === 'gte') return left >= right;
    if (filter.operator === 'lte') return left <= right;
    return false;
  }

  const leftText = normalizeText(fieldValue);
  const rightText = normalizeText(filter.value);

  if (filter.operator === 'contains') {
    if (rightText.length === 0) return true;
    return leftText.includes(rightText);
  }

  if (filter.operator === 'equals') return leftText === rightText;
  if (filter.operator === 'not_equals') return leftText !== rightText;
  return false;
}

function matchesFilterGroup(track: Track, group: MusicLibraryBaseFilterGroup): boolean {
  if (group.filters.length === 0) return true;
  if (group.operator === 'or') {
    return group.filters.some((filter) => matchesFilter(track, filter));
  }
  return group.filters.every((filter) => matchesFilter(track, filter));
}

function compareByRule(leftTrack: Track, rightTrack: Track, rule: MusicLibraryBaseOrderRule): number {
  const left = resolveTrackFieldValue(leftTrack, rule.field);
  const right = resolveTrackFieldValue(rightTrack, rule.field);

  let result = 0;
  if (NUMERIC_FIELDS.has(rule.field)) {
    const leftNumber = normalizeNumber(left) ?? 0;
    const rightNumber = normalizeNumber(right) ?? 0;
    result = leftNumber - rightNumber;
  } else {
    const leftText = normalizeText(left);
    const rightText = normalizeText(right);
    result = leftText.localeCompare(rightText);
  }

  return rule.order === 'asc' ? result : -result;
}

function mergeOrderRules(
  groupByRules: MusicLibraryBaseGroupRule[],
  sortRules: MusicLibraryBaseSortRule[]
): MusicLibraryBaseOrderRule[] {
  const merged: MusicLibraryBaseOrderRule[] = [];
  const seenFields = new Set<MusicLibraryBaseOrderField>();

  for (const rule of [...groupByRules, ...sortRules]) {
    if (seenFields.has(rule.field)) continue;
    seenFields.add(rule.field);
    merged.push(rule);
  }

  return merged;
}

export function createDefaultMusicLibraryBaseFilterGroup(
  id: string = `filter-group-${Date.now()}`
): MusicLibraryBaseFilterGroup {
  return {
    id,
    operator: 'and',
    filters: [],
  };
}

export function createDefaultMusicLibraryBaseSchema(): MusicLibraryBaseSchema {
  return {
    version: 1,
    query: {
      filterOperator: 'and',
      filterGroups: [],
      groupByRules: [],
      sortRules: [],
    },
    view: {
      mode: 'table',
      properties: [],
    },
  };
}

export function normalizeMusicLibraryBaseSchema(input: unknown): MusicLibraryBaseSchema {
  const defaults = createDefaultMusicLibraryBaseSchema();
  if (!input || typeof input !== 'object') return defaults;

  const raw = input as Partial<MusicLibraryBaseSchema> & {
    query?: Partial<MusicLibraryBaseQuery> & { filters?: unknown[] };
  };
  const rawQuery = raw.query;
  const rawView = raw.view;

  const normalizedFilterGroups = Array.isArray(rawQuery?.filterGroups)
    ? rawQuery.filterGroups
        .map(normalizeFilterGroupInput)
        .filter((item): item is MusicLibraryBaseFilterGroup => item != null)
        .slice(0, 20)
    : [];

  const legacyFilters = Array.isArray(rawQuery?.filters)
    ? rawQuery.filters
        .map(normalizeFilterInput)
        .filter((item): item is MusicLibraryBaseFilter => item != null)
        .slice(0, 100)
    : [];

  const filterGroups: MusicLibraryBaseFilterGroup[] =
    normalizedFilterGroups.length > 0
      ? normalizedFilterGroups
      : legacyFilters.length > 0
        ? [
            {
              id: 'legacy-filter-group-1',
              operator: 'and' as const,
              filters: legacyFilters,
            },
          ]
        : [];

  const groupByRules = Array.isArray(rawQuery?.groupByRules)
    ? rawQuery?.groupByRules
        .map(normalizeOrderRuleInput)
        .filter((item): item is MusicLibraryBaseGroupRule => item != null)
    : [];

  const sortRules = Array.isArray(rawQuery?.sortRules)
    ? rawQuery?.sortRules
        .map(normalizeOrderRuleInput)
        .filter((item): item is MusicLibraryBaseSortRule => item != null)
    : [];

  const mode = rawView?.mode === 'card' ? 'card' : 'table';
  const properties = normalizePropertiesInput(rawView?.properties);

  return {
    version: 1,
    query: {
      filterOperator: normalizeLogicalOperatorInput(rawQuery?.filterOperator),
      filterGroups,
      groupByRules,
      sortRules,
    },
    view: {
      mode,
      properties,
    },
  };
}

export function applyMusicLibraryBaseQuery(tracks: Track[], query: MusicLibraryBaseQuery): Track[] {
  let result = tracks;

  const effectiveGroups = query.filterGroups.filter((group) => group.filters.length > 0);
  if (effectiveGroups.length > 0) {
    result = result.filter((track) => {
      if (query.filterOperator === 'or') {
        return effectiveGroups.some((group) => matchesFilterGroup(track, group));
      }
      return effectiveGroups.every((group) => matchesFilterGroup(track, group));
    });
  }

  const orderRules = mergeOrderRules(query.groupByRules, query.sortRules);
  if (orderRules.length === 0) return result;

  const sorted = [...result];
  sorted.sort((left, right) => {
    for (const rule of orderRules) {
      const value = compareByRule(left, right, rule);
      if (value !== 0) return value;
    }
    return left.id.localeCompare(right.id);
  });
  return sorted;
}

export function canUseNativeBaseFilter(filter: MusicLibraryBaseFilter): boolean {
  if (!NATIVE_FILTER_FIELDS.has(filter.field)) return false;
  const numericField = filter.field === 'duration' || filter.field === 'playCount';

  if (numericField) {
    return (
      filter.operator === 'equals' ||
      filter.operator === 'not_equals' ||
      filter.operator === 'gte' ||
      filter.operator === 'lte' ||
      filter.operator === 'is_empty' ||
      filter.operator === 'is_not_empty'
    );
  }

  return (
    filter.operator === 'contains' ||
    filter.operator === 'equals' ||
    filter.operator === 'not_equals' ||
    filter.operator === 'is_empty' ||
    filter.operator === 'is_not_empty'
  );
}

export function canUseNativeBaseFilterGroup(group: MusicLibraryBaseFilterGroup): boolean {
  return group.filters.every((filter) => canUseNativeBaseFilter(filter));
}

export function canUseNativeBaseSort(field: MusicLibraryBaseSortField): boolean {
  if (field === 'default') return true;
  return NATIVE_SORT_FIELDS.has(field);
}

export function canUseNativeBaseOrderRule(rule: MusicLibraryBaseOrderRule): boolean {
  return NATIVE_SORT_FIELDS.has(rule.field);
}

export function flattenMusicLibraryBaseFilters(query: MusicLibraryBaseQuery): MusicLibraryBaseFilter[] {
  return flattenFilterGroups(query.filterGroups);
}
