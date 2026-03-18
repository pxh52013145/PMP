import { describe, expect, it } from 'vitest';

import {
  partitionPlaylistCoverUrlsForRelease,
  pruneResolvedPlaylistCoverMap,
  resolvePlaylistCoverUrl,
  resolvePlaylistTrackIndexes,
} from '../runtimeProjection';

describe('runtimeProjection', () => {
  it('filters and sorts playlist tracks as lightweight index arrays', () => {
    const indexes = resolvePlaylistTrackIndexes({
      tracks: [
        { id: 't-1', title: 'Gamma', artist: 'Zulu', album: 'A', duration: 240 },
        { id: 't-2', title: 'Alpha', artist: 'Beta', album: 'B', duration: 120 },
        { id: 't-3', title: 'Alphabet', artist: 'Delta', album: 'C', duration: 180 },
      ],
      searchQuery: 'alp',
      sortField: 'title',
      sortDirection: 'asc',
    });

    expect(indexes).toEqual([1, 2]);
  });

  it('returns default-order indexes without allocating entry objects', () => {
    const indexes = resolvePlaylistTrackIndexes({
      tracks: [
        { id: 't-1', title: 'First' },
        { id: 't-2', title: 'Second' },
      ],
      searchQuery: '',
      sortField: 'default',
      sortDirection: 'asc',
    });

    expect(indexes).toEqual([0, 1]);
  });

  it('prefers explicit and resolved playlist cover urls before scanning track heads', () => {
    expect(
      resolvePlaylistCoverUrl(
        {
          id: 'playlist-1',
          name: 'Playlist 1',
          coverUrl: 'https://example.com/explicit.jpg',
          tracks: [{ id: 't-1', title: 'Track 1', coverUrl: 'https://example.com/track.jpg' }],
          createdAt: 1,
          updatedAt: 1,
        },
        'https://example.com/runtime.jpg'
      )
    ).toBe('https://example.com/explicit.jpg');

    expect(
      resolvePlaylistCoverUrl(
        {
          id: 'playlist-2',
          name: 'Playlist 2',
          tracks: [{ id: 't-2', title: 'Track 2', coverUrl: 'https://example.com/track.jpg' }],
          createdAt: 1,
          updatedAt: 1,
        },
        'https://example.com/runtime.jpg'
      )
    ).toBe('https://example.com/runtime.jpg');
  });

  it('scans only playlist head tracks for fallback cover and skips smart playlists', () => {
    expect(
      resolvePlaylistCoverUrl({
        id: 'playlist-3',
        name: 'Playlist 3',
        tracks: [
          { id: 't-1', title: 'Track 1' },
          { id: 't-2', title: 'Track 2', coverUrl: 'https://example.com/head.jpg' },
          { id: 't-3', title: 'Track 3', coverUrl: 'https://example.com/late.jpg' },
        ],
        createdAt: 1,
        updatedAt: 1,
      })
    ).toBe('https://example.com/head.jpg');

    expect(
      resolvePlaylistCoverUrl({
        id: 'smart-1',
        name: 'Smart',
        kind: 'smart',
        tracks: [{ id: 't-1', title: 'Track 1', coverUrl: 'https://example.com/head.jpg' }],
        createdAt: 1,
        updatedAt: 1,
      })
    ).toBe('');
  });

  it('prunes off-window playlist cover urls and returns released runtime resources', () => {
    const result = pruneResolvedPlaylistCoverMap(
      {
        'playlist-1': 'blob:cover-1',
        'playlist-2': 'pmp://cover/playlist-2-thumb-96px',
        'playlist-3': 'https://example.com/cover-3.jpg',
      },
      ['playlist-2', 'playlist-3']
    );

    expect(result.changed).toBe(true);
    expect(result.nextMap).toEqual({
      'playlist-2': 'pmp://cover/playlist-2-thumb-96px',
      'playlist-3': 'https://example.com/cover-3.jpg',
    });
    expect(result.releasedUrls).toEqual(['blob:cover-1']);
  });

  it('releases only page-owned blob covers while keeping service-managed urls tracked', () => {
    const result = partitionPlaylistCoverUrlsForRelease([
      ' blob:cover-1 ',
      'pmp://cover/playlist-2-thumb-96px',
      'https://example.com/cover-3.jpg',
      'blob:cover-1',
      '',
    ]);

    expect(result.trackedUrls).toEqual([
      'blob:cover-1',
      'pmp://cover/playlist-2-thumb-96px',
      'https://example.com/cover-3.jpg',
    ]);
    expect(result.pageOwnedUrls).toEqual(['blob:cover-1']);
  });
});
