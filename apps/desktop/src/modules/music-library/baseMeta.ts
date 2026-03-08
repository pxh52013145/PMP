import type {
  MusicLibraryBaseField,
  MusicLibraryBaseOperator,
} from './baseQuery';
import {
  MUSIC_LIBRARY_BASE_FIELD_DEFINITIONS,
  MUSIC_LIBRARY_BASE_FILTER_FIELD_KEYS,
  MUSIC_LIBRARY_BASE_GROUP_FIELD_KEYS,
  MUSIC_LIBRARY_BASE_ORDER_FIELD_KEYS,
} from './fieldCapabilities';

export const MUSIC_LIBRARY_BASE_FIELD_HEADER_KEY_MAP = Object.fromEntries(
  Object.entries(MUSIC_LIBRARY_BASE_FIELD_DEFINITIONS).map(([field, definition]) => [
    field,
    definition.headerKey,
  ])
) as Record<MusicLibraryBaseField, string>;

export const MUSIC_LIBRARY_BASE_ORDER_RULE_FIELDS =
  MUSIC_LIBRARY_BASE_ORDER_FIELD_KEYS as MusicLibraryBaseField[];

export const MUSIC_LIBRARY_BASE_GROUP_RULE_FIELDS =
  MUSIC_LIBRARY_BASE_GROUP_FIELD_KEYS as MusicLibraryBaseField[];

export const MUSIC_LIBRARY_BASE_FILTER_FIELDS =
  MUSIC_LIBRARY_BASE_FILTER_FIELD_KEYS as MusicLibraryBaseField[];

export const MUSIC_LIBRARY_BASE_OPERATORS: MusicLibraryBaseOperator[] = [
  'contains',
  'equals',
  'not_equals',
  'gte',
  'lte',
  'is_empty',
  'is_not_empty',
];

export const MUSIC_LIBRARY_BASE_FIELD_LABEL_MAP = Object.fromEntries(
  Object.entries(MUSIC_LIBRARY_BASE_FIELD_DEFINITIONS).map(([field, definition]) => [
    field,
    definition.label,
  ])
) as Record<MusicLibraryBaseField, string>;

export const MUSIC_LIBRARY_BASE_OPERATOR_LABEL_MAP: Record<MusicLibraryBaseOperator, string> = {
  contains: 'contains',
  equals: 'is',
  not_equals: 'is not',
  gte: '>=',
  lte: '<=',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
};
