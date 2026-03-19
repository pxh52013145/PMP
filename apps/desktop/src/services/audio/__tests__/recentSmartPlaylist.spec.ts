import { describe, expect, it } from 'vitest';

import {
  applyRecentSmartPlaylistSnapshotToState,
  compactTrackForRecentPlaylist,
  mergeRecentSmartPlaylistTracks,
  serializeTrackForPlaylist,
  toPlaylistItemUpserts,
} from '../recentSmartPlaylist';

describe('recentSmartPlaylist', () => {
  it('compacts track payload for recent playlist cache', () => {
    const compacted = compactTrackForRecentPlaylist({
      id: 't1',
      title: 'Track 1',
      artist: 'Artist 1',
      album: 'Album 1',
      path: 'C:/Music/1.flac',
      quickFingerprint: 'abc',
      bitrate: 320,
    });

    expect(compacted.id).toBe('t1');
    expect(compacted.title).toBe('Track 1');
    expect(compacted.quickFingerprint).toBe('abc');
    expect((compacted as { bitrate?: number }).bitrate).toBeUndefined();
  });

  it('merges recent write entries in chronological order with dedup and limit', () => {
    const result = mergeRecentSmartPlaylistTracks({
      existingTracks: [
        { id: 'older', title: 'Older' },
        { id: 'keep', title: 'Keep' },
      ],
      bufferedEntries: [
        { track: { id: 'new-1', title: 'New 1' }, playedAtMs: 100 },
        { track: { id: 'keep', title: 'Keep Updated' }, playedAtMs: 150 },
        { track: { id: 'new-2', title: 'New 2' }, playedAtMs: 120 },
      ],
      limit: 3,
    });

    expect(result.latestPlayedAtMs).toBe(150);
    expect(result.tracks.map((item) => item.id)).toEqual(['keep', 'new-2', 'new-1']);
  });

  it('builds playlist upserts from serialized track payloads', () => {
    const items = toPlaylistItemUpserts({
      id: 'playlist-1',
      name: 'Playlist',
      tracks: [
        { id: 't1', title: 'Track 1', duration: 100 },
        { id: '', title: 'Invalid Track' },
      ],
      createdAt: 100,
      updatedAt: 100,
      trackCount: 2,
      totalDuration: 100,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.position).toBe(0);
    expect(items[0]?.snapshotTitle).toBe('Track 1');
    expect(typeof items[0]?.trackPayloadJson).toBe('string');
  });

  it('serializes playlist tracks without heavyweight runtime fields', () => {
    const payloadJson = serializeTrackForPlaylist({
      id: 't-heavy',
      title: 'Heavy Track',
      artist: 'Artist',
      filePath: 'C:/Music/heavy.flac',
      path: 'C:/Music/heavy.flac',
      coverUrl: `data:image/png;base64,${'a'.repeat(2048)}`,
      fileContent: new ArrayBuffer(2 * 1024 * 1024),
      lyrics: 'l'.repeat(16 * 1024),
      tags: ['tag-a', 'tag-b'],
      comment: 'drop-local-comment',
    });

    const payload = JSON.parse(payloadJson ?? '{}') as Record<string, unknown>;
    expect(payload.id).toBe('t-heavy');
    expect(payload.comment).toBeUndefined();
    expect(payload.fileContent).toBeUndefined();
    expect(payload.lyrics).toBeUndefined();
    expect(payload.tags).toBeUndefined();
    expect(payload.coverUrl).toBeUndefined();
  });

  it('keeps serialized source locators for platform-backed tracks', () => {
    const payloadJson = serializeTrackForPlaylist({
      id: 't-platform',
      title: 'Platform Track',
      filePath: 'C:/Cache/platform-track.m4a',
      path: 'C:/Cache/platform-track.m4a',
      originalPath: 'bilibili://video/BV1abc123',
      comment: 'bilibili://video/BV1abc123',
    });

    const payload = JSON.parse(payloadJson ?? '{}') as Record<string, unknown>;
    expect(payload.comment).toBe('bilibili://video/BV1abc123');
  });

  it('applies recent snapshot to playlist state and syncs current playlist', () => {
    const result = applyRecentSmartPlaylistSnapshotToState({
      playlists: [
        {
          id: 'smart-recently-played',
          name: '',
          tracks: [],
          kind: 'smart',
          readonly: true,
          createdAt: 10,
          updatedAt: 10,
          trackCount: 0,
          totalDuration: 0,
        },
      ],
      currentPlaylist: {
        id: 'smart-recently-played',
        name: 'Current',
        tracks: [],
        kind: 'smart',
        readonly: true,
        createdAt: 10,
        updatedAt: 10,
        trackCount: 0,
        totalDuration: 0,
      },
      tracks: [{ id: 't1', title: 'Track 1', duration: 120 }],
      updatedAtMs: 200,
      recentPlaylistId: 'smart-recently-played',
      recentPlaylistName: 'Recently Played',
      recentPlaylistLimit: 1000,
    });

    expect(result.playlists[0]?.name).toBe('Recently Played');
    expect(result.playlists[0]?.trackCount).toBe(1);
    expect(result.playlists[0]?.totalDuration).toBe(120);
    expect(result.currentPlaylist?.id).toBe('smart-recently-played');
    expect(result.currentPlaylist?.tracks).toHaveLength(0);
    expect(result.currentPlaylist?.tracksHydrated).toBe(false);
  });
});
