import { describe, expect, it } from 'vitest';
import type { Track } from '../../services/audio';
import { compareMusicLibraryFieldValues, formatMusicLibraryFieldValue } from './fieldValue';

function track(overrides: Partial<Track>): Track {
  return {
    id: overrides.id ?? 'track',
    title: overrides.title ?? 'Title',
    path: overrides.path ?? 'C:/Music/track.flac',
    ...overrides,
  } as Track;
}

describe('music library field values', () => {
  it('sorts format by the file extension when metadata is missing', () => {
    const flac = track({ id: 'flac', path: 'C:/Music/a.FLAC' });
    const m4a = track({ id: 'm4a', path: 'C:/Music/b.m4a' });

    expect(compareMusicLibraryFieldValues(flac, m4a, 'format')).toBeLessThan(0);
    expect(formatMusicLibraryFieldValue(flac, 'format')).toBe('FLAC');
    expect(formatMusicLibraryFieldValue(m4a, 'format')).toBe('M4A');
  });

  it('sorts album text naturally after trimming and case folding', () => {
    const album2 = track({ id: 'album-2', album: '  Album 2 ' });
    const album10 = track({ id: 'album-10', album: 'album 10' });

    expect(compareMusicLibraryFieldValues(album2, album10, 'album')).toBeLessThan(0);
  });
});
