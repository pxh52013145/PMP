import { describe, expect, it } from 'vitest';
import {
  AudioPlaybackSourceResolver,
  resolvePreparedPlatformPlaybackSource,
} from './audioPlaybackSourceResolver';
import type { Track } from './types';

const TRACK: Track = {
  id: 'track-a',
  title: 'Track A',
  path: 'cloud://track-a',
  duration: 10,
};

const IDENTITY = {
  connectorId: 'cloud',
  sourceLocator: 'cloud://track-a',
  sourceKey: 'track-a',
  entryId: 'entry::cloud::track-a',
};

describe('resolvePreparedPlatformPlaybackSource', () => {
  it('uses remote stream playback instead of platform cache files', async () => {
    await expect(
      resolvePreparedPlatformPlaybackSource(
        TRACK,
        IDENTITY,
        {
          cachePath: 'C:\\cache\\track-a.flac',
          streamUrl: 'https://example.test/track-a.flac',
        }
      )
    ).resolves.toMatchObject({
      kind: 'remote-stream',
      streamUrl: 'https://example.test/track-a.flac',
      sourceLocator: 'cloud://track-a',
      track: {
        filePath: undefined,
        path: 'cloud://track-a',
      },
    });
  });

  it('keeps using remote stream when a cache path is present', async () => {
    await expect(
      resolvePreparedPlatformPlaybackSource(
        TRACK,
        IDENTITY,
        {
          cachePath: 'C:\\cache\\track-a.flac',
          streamUrl: 'https://example.test/track-a.flac',
          mimeType: 'audio/flac',
          seekable: true,
          rangeRequests: true,
        }
      )
    ).resolves.toMatchObject({
      kind: 'remote-stream',
      streamUrl: 'https://example.test/track-a.flac',
      sourceLocator: 'cloud://track-a',
      mimeType: 'audio/flac',
      seekable: true,
      rangeRequests: true,
    });
  });

  it('does not require cache readiness before remote stream playback', async () => {
    await expect(
      resolvePreparedPlatformPlaybackSource(
        TRACK,
        IDENTITY,
        {
          cachePath: 'C:\\cache\\track-a.flac',
          streamUrl: 'https://example.test/track-a.flac',
        }
      )
    ).resolves.toMatchObject({
      kind: 'remote-stream',
      streamUrl: 'https://example.test/track-a.flac',
    });
  });

  it('defers cache-only platform results instead of treating them as local audio', async () => {
    await expect(
      resolvePreparedPlatformPlaybackSource(
        TRACK,
        IDENTITY,
        {
          cachePath: 'C:\\cache\\track-a.flac',
        }
      )
    ).resolves.toMatchObject({
      kind: 'deferred',
      reason: 'cache-only-playback-disabled',
      sourceLocator: 'cloud://track-a',
    });
  });

  it('prepares inline platform playback fields as a remote stream', async () => {
    const resolver = new AudioPlaybackSourceResolver();

    await expect(
      resolver.prepare({
        ...TRACK,
        sourceLocator: 'netease://song/123',
        streamUrl: 'https://example.test/track-a.flac',
        cachePath: 'C:\\cache\\track-a.flac',
      } as Track & Record<string, unknown>)
    ).resolves.toMatchObject({
      kind: 'remote-stream',
      streamUrl: 'https://example.test/track-a.flac',
      sourceLocator: 'netease://song/123',
    });
  });
});
