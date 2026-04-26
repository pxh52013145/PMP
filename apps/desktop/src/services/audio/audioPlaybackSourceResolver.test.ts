import { beforeEach, describe, expect, it, vi } from 'vitest';

const preparePlatformPlaybackMock = vi.hoisted(() => vi.fn());

vi.mock('../../modules/music-platform/platformFacade', () => ({
  preparePlatformPlayback: preparePlatformPlaybackMock,
}));

import {
  AudioPlaybackSourceResolver,
  PlatformPlaybackFacadeProvider,
  toNativeAudioSourcePayload,
} from './audioPlaybackSourceResolver';
import type { Track } from './types';

function createTrack(input: Partial<Track>): Track {
  return {
    id: input.id ?? 'track-1',
    title: input.title ?? 'Track',
    path: input.path,
    filePath: input.filePath,
    originalPath: input.originalPath,
    comment: input.comment,
    artist: input.artist,
    duration: input.duration,
  };
}

describe('audioPlaybackSourceResolver', () => {
  beforeEach(() => {
    preparePlatformPlaybackMock.mockReset();
  });

  it('returns local-file for local tracks without platform identity', async () => {
    const resolver = new AudioPlaybackSourceResolver(new PlatformPlaybackFacadeProvider());
    const track = createTrack({
      filePath: 'D:/Music/track.mp3',
      path: 'D:/Music/track.mp3',
      originalPath: 'D:/Music/track.mp3',
    });

    const prepared = await resolver.prepare(track);

    expect(prepared).toEqual({
      kind: 'local-file',
      track,
      path: 'D:/Music/track.mp3',
    });
    expect(preparePlatformPlaybackMock).not.toHaveBeenCalled();
  });

  it('returns cache-file when platform prepare materializes an absolute cache path', async () => {
    preparePlatformPlaybackMock.mockResolvedValue({
      connectorId: 'connector.platform.netease',
      prepared: {
        sourceLocator: 'netease://song/1',
        streamUrl: 'https://cache.example/stream',
        cachePath: 'C:/Users/test/AppData/Local/PMP/cache/song-1.flac',
        durationSeconds: 123,
      },
    });

    const resolver = new AudioPlaybackSourceResolver(new PlatformPlaybackFacadeProvider());
    const hints: string[] = [];
    const track = createTrack({
      id: 'song-1',
      comment: 'netease://song/1',
      title: 'Cloud Song',
    });

    const prepared = await resolver.prepare(track, {
      recordStabilityHint: (reason) => {
        hints.push(reason);
      },
    });

    expect(hints).toEqual(['platform-cache-materializing']);
    expect(preparePlatformPlaybackMock).toHaveBeenCalledWith({
      connectorId: 'connector.platform.netease',
      sourceLocator: 'netease://song/1',
    });
    expect(prepared).toMatchObject({
      kind: 'cache-file',
      path: 'C:/Users/test/AppData/Local/PMP/cache/song-1.flac',
      connectorId: 'connector.platform.netease',
      sourceLocator: 'netease://song/1',
      track: {
        filePath: 'C:/Users/test/AppData/Local/PMP/cache/song-1.flac',
        path: 'C:/Users/test/AppData/Local/PMP/cache/song-1.flac',
        originalPath: 'netease://song/1',
        comment: 'netease://song/1',
        duration: 123,
      },
    });
  });

  it('returns remote-stream when platform prepare yields a stream url without an absolute cache path', async () => {
    preparePlatformPlaybackMock.mockResolvedValue({
      connectorId: 'connector.platform.netease',
      prepared: {
        sourceLocator: 'netease://song/1',
        streamUrl: 'https://cache.example/stream',
        cachePath: './relative-cache.flac',
      },
    });

    const resolver = new AudioPlaybackSourceResolver(new PlatformPlaybackFacadeProvider());
    const track = createTrack({
      id: 'song-1',
      comment: 'netease://song/1',
      title: 'Cloud Song',
    });

    const prepared = await resolver.prepare(track);

    expect(prepared).toMatchObject({
      kind: 'remote-stream',
      streamUrl: 'https://cache.example/stream',
      connectorId: 'connector.platform.netease',
      sourceLocator: 'netease://song/1',
      track: {
        path: 'netease://song/1',
        originalPath: 'netease://song/1',
        comment: 'netease://song/1',
      },
    });
    expect(toNativeAudioSourcePayload(prepared)).toEqual({
      kind: 'remote-stream',
      streamUrl: 'https://cache.example/stream',
      connectorId: 'connector.platform.netease',
      sourceLocator: 'netease://song/1',
    });
  });

  it('returns deferred when platform prepare fails', async () => {
    preparePlatformPlaybackMock.mockRejectedValue(new Error('prepare failed'));

    const resolver = new AudioPlaybackSourceResolver(new PlatformPlaybackFacadeProvider());
    const track = createTrack({
      id: 'song-1',
      comment: 'netease://song/1',
      title: 'Cloud Song',
    });

    const prepared = await resolver.prepare(track);

    expect(prepared).toEqual({
      kind: 'deferred',
      track,
      reason: 'platform-prepare-failed',
      connectorId: 'connector.platform.netease',
      sourceLocator: 'netease://song/1',
    });
  });
});
