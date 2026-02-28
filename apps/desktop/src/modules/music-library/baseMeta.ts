import type {
  MusicLibraryBaseField,
  MusicLibraryBaseOperator,
} from './baseQuery';

export const MUSIC_LIBRARY_BASE_ORDER_RULE_FIELDS: MusicLibraryBaseField[] = [
  'title',
  'artist',
  'album',
  'genre',
  'duration',
  'year',
  'playCount',
  'rating',
  'format',
];

export const MUSIC_LIBRARY_BASE_FILTER_FIELDS: MusicLibraryBaseField[] = [
  'title',
  'artist',
  'album',
  'genre',
  'year',
  'duration',
  'rating',
  'playCount',
  'format',
];

export const MUSIC_LIBRARY_BASE_OPERATORS: MusicLibraryBaseOperator[] = [
  'contains',
  'equals',
  'not_equals',
  'gte',
  'lte',
  'is_empty',
  'is_not_empty',
];

export const MUSIC_LIBRARY_BASE_FIELD_LABEL_MAP: Record<MusicLibraryBaseField, string> = {
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  genre: 'Genre',
  year: 'Year',
  duration: 'Duration',
  rating: 'Rating',
  playCount: 'Play Count',
  format: 'Format',
};

export const MUSIC_LIBRARY_BASE_OPERATOR_LABEL_MAP: Record<MusicLibraryBaseOperator, string> = {
  contains: 'contains',
  equals: 'is',
  not_equals: 'is not',
  gte: '>=',
  lte: '<=',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
};
