import type { Track } from '../../services/audio/types';
import type { MusicLibraryBaseSortRule } from './baseQuery';
import { compareMusicLibraryFieldValues } from './fieldValue';

export function createAlbumSortRules(): MusicLibraryBaseSortRule[] {
  return ['discNumber', 'trackNumber'].map((field) => ({
    id: `album-order-${field}`,
    field,
    order: 'asc',
  }));
}

export function compareAlbumTracks(left: Track, right: Track): number {
  return (
    compareMusicLibraryFieldValues(left, right, 'discNumber') ||
    compareMusicLibraryFieldValues(left, right, 'trackNumber') ||
    compareMusicLibraryFieldValues(left, right, 'title') ||
    left.id.localeCompare(right.id)
  );
}

export function formatAlbumTrackNumber(track: Track, index: number): string {
  const number = track.trackNumber;
  if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) {
    return String(index + 1);
  }
  return String(number);
}
