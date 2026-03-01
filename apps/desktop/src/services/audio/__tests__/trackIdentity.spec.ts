import { describe, expect, it } from 'vitest';
import type { Track } from '../types';
import {
  getTrackPathForIdentity,
  isSameTrackByIdentityOrPath,
  normalizeTrackIdentityForCompare,
  normalizeTrackPathForCompare,
  prependTrackWithDedup,
} from '../trackIdentity';

const createTrack = (partial: Partial<Track>): Track => ({
  id: partial.id ?? 'track-1',
  title: partial.title ?? 'Track',
  artist: partial.artist,
  album: partial.album,
  duration: partial.duration,
  path: partial.path,
  filePath: partial.filePath,
  originalPath: partial.originalPath,
});

describe('trackIdentity', () => {
  it('normalizes comparable path across file uri and separators', () => {
    const normalized = normalizeTrackPathForCompare('file:///C:/Music\\Hello.mp3');
    expect(normalized).toBe('c:/music/hello.mp3');
  });

  it('resolves track path with fallback precedence', () => {
    const track = createTrack({
      filePath: '',
      path: 'C:/Music/path.mp3',
      originalPath: 'C:/Music/original.mp3',
    });
    expect(getTrackPathForIdentity(track)).toBe('C:/Music/path.mp3');
  });

  it('builds stable identity preferring id', () => {
    const track = createTrack({
      id: 'TRACK-ABC',
      originalPath: 'bilibili://video/BV1abc123',
      filePath: 'C:/Music/track.mp3',
    });
    expect(normalizeTrackIdentityForCompare(track)).toBe('id:track-abc');
  });

  it('matches same track by normalized path when identity missing', () => {
    const a = createTrack({
      id: '',
      title: '',
      filePath: 'C:\\Music\\same.mp3',
    });
    const b = createTrack({
      id: '',
      title: '',
      filePath: 'file:///C:/Music/same.mp3',
    });
    expect(isSameTrackByIdentityOrPath(a, b)).toBe(true);
  });

  it('prepends incoming track and removes duplicated previous entries', () => {
    const existing = createTrack({
      id: 'track-dup',
      title: 'Old Version',
      duration: 100,
      filePath: 'C:/Music/old.mp3',
      path: 'C:/Music/old.mp3',
    });
    const another = createTrack({
      id: 'track-other',
      title: 'Other',
      duration: 120,
      filePath: 'C:/Music/other.mp3',
      path: 'C:/Music/other.mp3',
    });
    const incoming = createTrack({
      id: 'track-dup',
      title: 'New Version',
      duration: 180,
      filePath: 'C:/Music/new.mp3',
      path: 'C:/Music/new.mp3',
    });

    const result = prependTrackWithDedup([existing, another], incoming);
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe('track-dup');
    expect(result[0]?.title).toBe('New Version');
    expect(result[1]?.id).toBe('track-other');
  });
});

