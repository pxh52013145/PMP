import { Track } from '../../services/audio';
import {
  getMusicLibraryBaseFieldCapability,
  isMusicLibraryBaseFieldNumeric,
  type MusicLibraryBaseFieldId,
} from './fieldCapabilities';

const TIMESTAMP_MILLISECONDS_THRESHOLD = 10_000_000_000;

export type MusicLibraryFieldRawValue = string | number | Date | undefined;
export type MusicLibraryFieldComparableValue = string | number | undefined;
export type MusicLibraryFieldNullOrder = 'first' | 'last';
export type MusicLibraryFieldTimestampFormat = 'date' | 'datetime';

export interface MusicLibraryFieldComparisonOptions {
  nulls?: MusicLibraryFieldNullOrder;
  order?: 'asc' | 'desc';
}

export interface MusicLibraryTimestampFormattingOptions {
  emptyPlaceholder?: string;
  format?: MusicLibraryFieldTimestampFormat;
  locale?: string;
}

export interface MusicLibraryFieldFormattingOptions {
  emptyPlaceholder?: string;
  timestampFormat?: MusicLibraryFieldTimestampFormat;
  locale?: string;
}

function normalizeFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeTimestampNumber(value: number): number {
  return value > TIMESTAMP_MILLISECONDS_THRESHOLD ? value : value * 1000;
}

function isEmptyComparableValue(value: MusicLibraryFieldComparableValue): boolean {
  return value === undefined || (typeof value === 'string' && value.trim().length === 0);
}

function resolveTrackFormatValue(track: Track): string | undefined {
  const explicit = (track.format || track.codecName || '').trim();
  if (explicit.length > 0) {
    return explicit;
  }

  const path = (track.path || track.originalPath || '').trim();
  const extension = path.includes('.') ? path.split('.').pop()?.trim() ?? '' : '';
  return extension.length > 0 ? extension : undefined;
}

function stringifyNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '-';
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(value);
}

export function normalizeMusicLibraryFieldText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

export function normalizeMusicLibraryFieldNumber(value: unknown): number | undefined {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }
  return normalizeFiniteNumber(value);
}

export function normalizeMusicLibraryFieldTimestamp(value: unknown): number | undefined {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }

  const numeric = normalizeFiniteNumber(value);
  if (numeric === undefined) {
    return undefined;
  }

  if (numeric <= 0) {
    return undefined;
  }

  return normalizeTimestampNumber(numeric);
}

export function formatMusicLibraryDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatMusicLibraryFileSize(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatMusicLibraryTimestamp(
  value: unknown,
  options: MusicLibraryTimestampFormattingOptions = {}
): string {
  const placeholder = options.emptyPlaceholder ?? '-';
  const timestampMs = normalizeMusicLibraryFieldTimestamp(value);
  if (timestampMs === undefined) {
    return placeholder;
  }

  const date = new Date(timestampMs);
  if (!Number.isFinite(date.getTime())) {
    return placeholder;
  }

  if (options.format === 'datetime') {
    return date.toLocaleString(options.locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

export function getMusicLibraryFieldRawValue(
  track: Track,
  field: MusicLibraryBaseFieldId
): MusicLibraryFieldRawValue {
  switch (field) {
    case 'title':
      return track.title || undefined;
    case 'artist':
      return track.artist || undefined;
    case 'album':
      return track.album || undefined;
    case 'genre':
      return track.genre || undefined;
    case 'year':
      return typeof track.year === 'number' && Number.isFinite(track.year) ? track.year : undefined;
    case 'duration':
      return typeof track.duration === 'number' && Number.isFinite(track.duration)
        ? track.duration
        : undefined;
    case 'sampleRate':
      return typeof track.sampleRate === 'number' && Number.isFinite(track.sampleRate)
        ? track.sampleRate
        : undefined;
    case 'fileSize':
      return typeof track.fileSize === 'number' && Number.isFinite(track.fileSize)
        ? track.fileSize
        : undefined;
    case 'dateAdded':
      return track.dateAdded ?? track.addedAt;
    case 'lastPlayed':
      return track.lastPlayed;
    case 'rating':
      return typeof track.rating === 'number' && Number.isFinite(track.rating) ? track.rating : undefined;
    case 'playCount':
      return typeof track.playCount === 'number' && Number.isFinite(track.playCount)
        ? track.playCount
        : undefined;
    case 'format':
      return resolveTrackFormatValue(track);
    default:
      break;
  }

  const capability = getMusicLibraryBaseFieldCapability(field);
  const trackKey = capability?.trackKey ?? field;
  const dynamicValue = (track as unknown as Record<string, unknown>)[trackKey];

  if (typeof dynamicValue === 'number' || typeof dynamicValue === 'string') {
    return dynamicValue;
  }

  if (typeof dynamicValue === 'boolean') {
    return dynamicValue ? 'true' : 'false';
  }

  if (Array.isArray(dynamicValue)) {
    const joined = dynamicValue
      .map((item) => {
        if (typeof item === 'string') {
          const trimmed = item.trim();
          return trimmed.length > 0 ? trimmed : undefined;
        }
        if (typeof item === 'number') {
          return Number.isFinite(item) ? String(item) : undefined;
        }
        if (typeof item === 'boolean') {
          return item ? 'true' : 'false';
        }
        return undefined;
      })
      .filter((item): item is string => typeof item === 'string' && item.length > 0)
      .join(', ');

    return joined.length > 0 ? joined : undefined;
  }

  if (dynamicValue instanceof Date && Number.isFinite(dynamicValue.getTime())) {
    return dynamicValue;
  }

  return undefined;
}

export function getMusicLibraryFieldComparableValue(
  track: Track,
  field: MusicLibraryBaseFieldId
): MusicLibraryFieldComparableValue {
  const rawValue = getMusicLibraryFieldRawValue(track, field);

  if (rawValue instanceof Date) {
    return normalizeMusicLibraryFieldTimestamp(rawValue);
  }

  if (typeof rawValue === 'number') {
    if (!Number.isFinite(rawValue)) {
      return undefined;
    }

    if (field === 'dateAdded' || field === 'lastPlayed') {
      return normalizeMusicLibraryFieldTimestamp(rawValue);
    }

    return rawValue;
  }

  if (typeof rawValue !== 'string') {
    return undefined;
  }

  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (isMusicLibraryBaseFieldNumeric(field)) {
    return normalizeMusicLibraryFieldNumber(trimmed);
  }

  return trimmed;
}

export function formatMusicLibraryFieldValue(
  track: Track,
  field: MusicLibraryBaseFieldId,
  options: MusicLibraryFieldFormattingOptions = {}
): string {
  const placeholder = options.emptyPlaceholder ?? '-';
  const rawValue = getMusicLibraryFieldRawValue(track, field);

  switch (field) {
    case 'duration':
      return typeof rawValue === 'number' && Number.isFinite(rawValue)
        ? formatMusicLibraryDuration(rawValue)
        : placeholder;
    case 'sampleRate':
      return typeof rawValue === 'number' && Number.isFinite(rawValue)
        ? `${Math.max(0, Math.round(rawValue))} Hz`
        : placeholder;
    case 'fileSize':
      return typeof rawValue === 'number' && Number.isFinite(rawValue)
        ? formatMusicLibraryFileSize(Math.max(0, rawValue))
        : placeholder;
    case 'dateAdded':
    case 'lastPlayed':
      return formatMusicLibraryTimestamp(rawValue, {
        emptyPlaceholder: placeholder,
        format: options.timestampFormat,
        locale: options.locale,
      });
    case 'rating':
    case 'playCount':
      return typeof rawValue === 'number' && Number.isFinite(rawValue)
        ? String(Math.max(0, Math.floor(rawValue)))
        : placeholder;
    case 'format': {
      const comparable = getMusicLibraryFieldComparableValue(track, field);
      return typeof comparable === 'string' ? comparable.toUpperCase() : placeholder;
    }
    default:
      break;
  }

  if (rawValue instanceof Date) {
    return formatMusicLibraryTimestamp(rawValue, {
      emptyPlaceholder: placeholder,
      format: options.timestampFormat,
      locale: options.locale,
    });
  }

  if (typeof rawValue === 'number') {
    return Number.isFinite(rawValue) ? stringifyNumber(rawValue) : placeholder;
  }

  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    return trimmed.length > 0 ? trimmed : placeholder;
  }

  return placeholder;
}

export function compareMusicLibraryFieldValues(
  leftTrack: Track,
  rightTrack: Track,
  field: MusicLibraryBaseFieldId,
  options: MusicLibraryFieldComparisonOptions = {}
): number {
  const nulls = options.nulls ?? 'last';
  const order = options.order ?? 'asc';
  const leftValue = getMusicLibraryFieldComparableValue(leftTrack, field);
  const rightValue = getMusicLibraryFieldComparableValue(rightTrack, field);
  const leftEmpty = isEmptyComparableValue(leftValue);
  const rightEmpty = isEmptyComparableValue(rightValue);

  if (leftEmpty || rightEmpty) {
    if (leftEmpty && rightEmpty) {
      return 0;
    }
    return leftEmpty ? (nulls === 'first' ? -1 : 1) : nulls === 'first' ? 1 : -1;
  }

  let result = 0;
  if (isMusicLibraryBaseFieldNumeric(field)) {
    const leftNumber = normalizeMusicLibraryFieldNumber(leftValue) ?? 0;
    const rightNumber = normalizeMusicLibraryFieldNumber(rightValue) ?? 0;
    result = leftNumber - rightNumber;
  } else {
    result = normalizeMusicLibraryFieldText(leftValue).localeCompare(
      normalizeMusicLibraryFieldText(rightValue),
      undefined,
      {
        numeric: true,
        sensitivity: 'base',
      }
    );
  }

  return order === 'desc' ? -result : result;
}
