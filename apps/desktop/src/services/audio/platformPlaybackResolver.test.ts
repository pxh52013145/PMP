import { describe, expect, it } from 'vitest';
import {
  NETEASE_PLATFORM_CONNECTOR_ID,
  resolvePlatformPlaybackIdentity,
} from './platformPlaybackResolver';
import type { Track } from './types';

function createTrack(overrides: Partial<Track> & Record<string, unknown> = {}): Track {
  return {
    id: 'track-a',
    title: 'Track A',
    path: 'C:\\cache\\track-a.flac',
    ...overrides,
  };
}

describe('resolvePlatformPlaybackIdentity', () => {
  it('recognizes platform source locator dynamic fields on cached tracks', () => {
    const identity = resolvePlatformPlaybackIdentity(createTrack({
      sourceLocator: 'netease://song/123',
      streamUrl: 'https://example.test/track-a.flac',
      cachePath: 'C:\\cache\\track-a.flac',
    }));

    expect(identity).toMatchObject({
      connectorId: NETEASE_PLATFORM_CONNECTOR_ID,
      sourceLocator: 'netease://song/123',
      sourceKey: 'netease://song/123',
    });
  });

  it('leaves ordinary local files on the local playback path', () => {
    expect(resolvePlatformPlaybackIdentity(createTrack())).toBeNull();
  });

  it('does not treat a stale cache path alone as platform playback', () => {
    expect(resolvePlatformPlaybackIdentity(createTrack({
      path: 'D:\\music\\local.flac',
      filePath: 'D:\\music\\local.flac',
      cachePath: 'C:\\cache\\old-local-copy.flac',
    }))).toBeNull();
  });
});
