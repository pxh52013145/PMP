import { describe, expect, it } from 'vitest';
import { parseNavigationParams } from '../navigationParams';

describe('parseNavigationParams', () => {
  it('parses track params', () => {
    expect(parseNavigationParams('track', undefined)).toBeUndefined();
    expect(parseNavigationParams('track', {})).toBeUndefined();
    expect(parseNavigationParams('track', { trackId: 'Bad_ID' })).toBeUndefined();
    expect(parseNavigationParams('track', { track: { id: 1, title: 'x' } })).toBeUndefined();

    expect(parseNavigationParams('track', { trackId: 't1' })).toEqual({ trackId: 't1' });

    const legacyParsed = parseNavigationParams('track', { track: { id: 't1', title: 'Song' } });
    expect(legacyParsed).toEqual({ trackId: 't1' });
  });

  it('parses album params and filters invalid tracks', () => {
    expect(parseNavigationParams('album', undefined)).toBeUndefined();
    expect(parseNavigationParams('album', { artist: 'A' })).toBeUndefined();

    const parsed = parseNavigationParams('album', {
      albumName: 'Album',
      artist: 'Artist',
      tracks: [{ id: '1', title: 'One' }, { id: 2, title: 'Bad' }],
    });
    expect(parsed?.albumName).toBe('Album');
    expect(parsed?.artist).toBe('Artist');
    expect(parsed?.tracks?.map((t) => t.id)).toEqual(['1']);
  });

  it('parses plugin page params with safe ids', () => {
    expect(parseNavigationParams('plugin-page', { pluginId: 'Bad_ID', pageId: 'a' })).toBeUndefined();
    expect(parseNavigationParams('plugin-page', { pluginId: 'p1', pageId: 'page' })).toEqual({
      pluginId: 'p1',
      pageId: 'page',
    });
  });
});

