import { afterEach, describe, expect, it } from 'vitest';
import {
  clearRegisteredMusicLibraryBaseFieldCapabilities,
  registerMusicLibraryBaseFieldCapabilities,
} from '../fieldCapabilities';
import {
  compareMusicLibraryFieldValues,
  formatMusicLibraryFieldValue,
  formatMusicLibraryTimestamp,
  getMusicLibraryFieldComparableValue,
} from '../fieldValue';

describe('fieldValue', () => {
  afterEach(() => {
    clearRegisteredMusicLibraryBaseFieldCapabilities();
  });

  it('formats builtin metadata fields from a single helper layer', () => {
    const addedAtMs = Date.parse('2024-01-02T03:04:00Z');
    const lastPlayedMs = Date.parse('2024-02-03T04:05:00Z');
    const track = {
      id: 'track-1',
      title: 'A',
      duration: 125,
      fileSize: 1536,
      sampleRate: 48000,
      format: 'flac',
      dateAdded: Math.floor(addedAtMs / 1000),
      lastPlayed: lastPlayedMs,
    };

    expect(getMusicLibraryFieldComparableValue(track, 'dateAdded')).toBe(addedAtMs);
    expect(formatMusicLibraryFieldValue(track, 'duration')).toBe('2:05');
    expect(formatMusicLibraryFieldValue(track, 'fileSize')).toBe('1.5 KB');
    expect(formatMusicLibraryFieldValue(track, 'sampleRate')).toBe('48000 Hz');
    expect(formatMusicLibraryFieldValue(track, 'format')).toBe('FLAC');
    expect(formatMusicLibraryFieldValue(track, 'dateAdded')).toBe('2024-01-02');
    expect(formatMusicLibraryFieldValue(track, 'lastPlayed')).toBe('2024-02-03');
  });

  it('supports extension trackKey values for string, numeric-string and Date fields', () => {
    const ingestedAt = new Date('2024-03-04T05:06:00Z');

    registerMusicLibraryBaseFieldCapabilities([
      {
        id: 'composerTag',
        label: 'Composer Tag',
        trackKey: 'composer',
        sortable: true,
      },
      {
        id: 'customRank',
        label: 'Custom Rank',
        kind: 'number',
        trackKey: 'rank',
        sortable: true,
      },
      {
        id: 'ingestedAt',
        label: 'Ingested At',
        kind: 'number',
        trackKey: 'ingestedAt',
        sortable: true,
      },
    ]);

    const track = {
      id: 'track-1',
      title: 'A',
      composer: 'Muse',
      rank: '42',
      ingestedAt,
    };

    expect(getMusicLibraryFieldComparableValue(track, 'composerTag')).toBe('Muse');
    expect(getMusicLibraryFieldComparableValue(track, 'customRank')).toBe(42);
    expect(getMusicLibraryFieldComparableValue(track, 'ingestedAt')).toBe(ingestedAt.getTime());
    expect(formatMusicLibraryFieldValue(track, 'composerTag')).toBe('Muse');
    expect(formatMusicLibraryFieldValue(track, 'customRank')).toBe('42');
    expect(formatMusicLibraryFieldValue(track, 'ingestedAt')).toBe('2024-03-04');
  });

  it('prefers createdAtMs for builtin dateAdded when native schema fields are present', () => {
    const createdAtMs = Date.parse('2024-05-06T07:08:00Z');
    const track = {
      id: 'track-native-date-added',
      title: 'A',
      createdAtMs,
      updatedAtMs: Date.parse('2024-06-07T08:09:00Z'),
    };

    expect(getMusicLibraryFieldComparableValue(track, 'dateAdded')).toBe(createdAtMs);
    expect(formatMusicLibraryFieldValue(track, 'dateAdded')).toBe('2024-05-06');
  });

  it('formats native timestamp-like dynamic fields through the shared field layer', () => {
    registerMusicLibraryBaseFieldCapabilities([
      {
        id: 'updatedAtMs',
        label: 'Updated At',
        kind: 'number',
        trackKey: 'updatedAtMs',
        sortable: true,
      },
    ]);

    const updatedAtMs = Date.parse('2024-06-07T08:09:00Z');
    const track = {
      id: 'track-updated-at',
      title: 'A',
      updatedAtMs,
    };

    expect(getMusicLibraryFieldComparableValue(track, 'updatedAtMs')).toBe(updatedAtMs);
    expect(formatMusicLibraryFieldValue(track, 'updatedAtMs')).toBe('2024-06-07');
  });

  it('formats extension boolean and array values through the shared field layer', () => {
    registerMusicLibraryBaseFieldCapabilities([
      {
        id: 'customFlag',
        label: 'Custom Flag',
        trackKey: 'customFlag',
        sortable: true,
      },
      {
        id: 'tagsText',
        label: 'Tags Text',
        trackKey: 'tags',
        sortable: true,
      },
    ]);

    const track = {
      id: 'track-1',
      title: 'A',
      customFlag: true,
      tags: ['rock', 'alt'],
    };

    expect(getMusicLibraryFieldComparableValue(track, 'customFlag')).toBe('true');
    expect(getMusicLibraryFieldComparableValue(track, 'tagsText')).toBe('rock, alt');
    expect(formatMusicLibraryFieldValue(track, 'customFlag')).toBe('true');
    expect(formatMusicLibraryFieldValue(track, 'tagsText')).toBe('rock, alt');
  });

  it('keeps empty values ordered after concrete values by default', () => {
    const emptyTrack = { id: 'track-1', title: 'A' };
    const valuedTrack = { id: 'track-2', title: 'B', artist: 'Muse' };

    expect(compareMusicLibraryFieldValues(emptyTrack, valuedTrack, 'artist')).toBeGreaterThan(0);
    expect(
      compareMusicLibraryFieldValues(emptyTrack, valuedTrack, 'artist', { nulls: 'first' })
    ).toBeLessThan(0);
  });

  it('formats datetime timestamps when requested', () => {
    const value = Date.parse('2024-04-05T06:07:00Z');
    const formatted = formatMusicLibraryTimestamp(value, {
      emptyPlaceholder: '-',
      format: 'datetime',
      locale: 'en-US',
    });

    expect(formatted).not.toBe('-');
    expect(formatted).toContain('2024');
  });
});
