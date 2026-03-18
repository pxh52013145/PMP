import { describe, expect, it } from 'vitest';
import { compactTrackForPlaylistState, compactTrackForQueueState } from '../trackStateProjection';

describe('trackStateProjection queue projection', () => {
  it('keeps only queue-critical fields for local playback', () => {
    const projected = compactTrackForQueueState({
      id: 'track-1',
      title: 'Example',
      artist: 'Artist',
      album: 'Album',
      duration: 123,
      filePath: 'C:\\Music\\example.flac',
      path: 'C:\\Music\\example.flac',
      originalPath: 'C:\\Music\\example.flac',
      libraryPathId: 'lib-1',
      coverKey: 'cover-1-thumb-96px',
      coverUrl: 'pmp://cover/cover-1-thumb-96px',
      replayGainTrackGainDb: -4.2,
      replayGainAlbumGainDb: -3.1,
      comment: 'should-drop-for-local-queue',
      genre: 'Electronic',
      sampleRate: 96000,
      playCount: 42,
      codecName: 'flac',
      format: 'flac',
      fileSize: 1024,
      year: 2025,
    });

    expect(projected).toEqual({
      id: 'track-1',
      title: 'Example',
      artist: 'Artist',
      album: 'Album',
      duration: 123,
      filePath: 'C:\\Music\\example.flac',
      originalPath: 'C:\\Music\\example.flac',
      libraryPathId: 'lib-1',
      replayGainTrackGainDb: -4.2,
      replayGainAlbumGainDb: -3.1,
    });
    expect(projected.comment).toBeUndefined();
    expect(projected.path).toBeUndefined();
    expect(projected.coverKey).toBeUndefined();
    expect(projected.coverUrl).toBeUndefined();
    expect('genre' in projected).toBe(false);
    expect('sampleRate' in projected).toBe(false);
    expect('playCount' in projected).toBe(false);
    expect('codecName' in projected).toBe(false);
    expect('format' in projected).toBe(false);
    expect('fileSize' in projected).toBe(false);
    expect('year' in projected).toBe(false);
  });

  it('keeps platform locator comments when queue entries need replay resolution', () => {
    const projected = compactTrackForQueueState({
      id: 'track-platform-1',
      title: 'Platform Track',
      filePath: 'C:\\Cache\\bilibili-track.m4a',
      path: 'C:\\Cache\\bilibili-track.m4a',
      originalPath: 'bilibili://video/BV1abc123',
      comment: 'bilibili://video/BV1abc123',
    });

    expect(projected.comment).toBe('bilibili://video/BV1abc123');
  });

  it('drops oversized embedded cover urls but keeps non-absolute file handles', () => {
    const fileHandle = {} as FileSystemFileHandle;
    const projected = compactTrackForQueueState({
      id: 'track-2',
      title: 'Relative',
      path: 'relative/song.mp3',
      coverUrl: `data:image/png;base64,${'a'.repeat(20_000)}`,
      fileHandle,
    });

    expect(projected.coverUrl).toBeUndefined();
    expect(projected.fileHandle).toBe(fileHandle);
  });
});

describe('trackStateProjection playlist projection', () => {
  it('keeps playlist-runtime fields and drops heavyweight metadata', () => {
    const projected = compactTrackForPlaylistState({
      id: 'playlist-track-1',
      title: 'Playlist Track',
      artist: 'Artist',
      album: 'Album',
      duration: 245,
      filePath: 'C:\\Music\\playlist-track.flac',
      path: 'C:\\Music\\playlist-track.flac',
      originalPath: 'C:\\Music\\playlist-track.flac',
      libraryPathId: 'lib-9',
      coverKey: 'cover-9-thumb-96px',
      coverUrl: 'pmp://cover/cover-9-thumb-96px?size=small',
      replayGainTrackGainDb: -6.2,
      replayGainAlbumGainDb: -4.8,
      comment: 'drop-local-comment',
      albumArtist: 'Album Artist',
      quickFingerprint: 'qf2:abcdef1234567890',
      genre: 'Ambient',
      sampleRate: 96000,
      fileSize: 1234567,
      lyrics: 'x'.repeat(4096),
      fileContent: new ArrayBuffer(1024 * 1024),
    });

    expect(projected).toEqual({
      id: 'playlist-track-1',
      title: 'Playlist Track',
      artist: 'Artist',
      album: 'Album',
      duration: 245,
      filePath: 'C:\\Music\\playlist-track.flac',
      originalPath: 'C:\\Music\\playlist-track.flac',
      libraryPathId: 'lib-9',
      coverKey: 'cover-9-thumb-96px',
      coverUrl: 'pmp://cover/cover-9-thumb-96px?size=small',
      replayGainTrackGainDb: -6.2,
      replayGainAlbumGainDb: -4.8,
    });
    expect(projected.comment).toBeUndefined();
    expect(projected.path).toBeUndefined();
    expect(projected.quickFingerprint).toBeUndefined();
    expect(projected.genre).toBeUndefined();
    expect(projected.sampleRate).toBeUndefined();
    expect(projected.fileSize).toBeUndefined();
    expect(projected.lyrics).toBeUndefined();
    expect(projected.fileContent).toBeUndefined();
  });

  it('keeps platform locators for playlist hydration and preserves lightweight cover pointers', () => {
    const projected = compactTrackForPlaylistState({
      id: 'playlist-platform-1',
      title: 'Platform Playlist Track',
      filePath: 'C:\\Cache\\bilibili-track.m4a',
      path: 'C:\\Cache\\bilibili-track.m4a',
      originalPath: 'bilibili://video/BV1abc123',
      comment: 'bilibili://video/BV1abc123',
      coverKey: 'platform-cover-thumb-96px',
      coverUrl: 'https://example.com/cover.jpg',
    });

    expect(projected.comment).toBe('bilibili://video/BV1abc123');
    expect(projected.coverKey).toBe('platform-cover-thumb-96px');
    expect(projected.coverUrl).toBe('https://example.com/cover.jpg');
  });
});
