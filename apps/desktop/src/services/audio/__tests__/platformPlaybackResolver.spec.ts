import { describe, expect, it } from 'vitest';

import {
  BILIBILI_PLATFORM_CONNECTOR_ID,
  buildStablePlatformEntryId,
  isBilibiliSourceLocator,
  resolvePlatformPlaybackIdentity,
} from '../platformPlaybackResolver';

describe('platformPlaybackResolver', () => {
  it('detects bilibili source locators in common forms', () => {
    expect(isBilibiliSourceLocator('bilibili://video/BV1abc123')).toBe(true);
    expect(isBilibiliSourceLocator('https://www.bilibili.com/video/BV1abc123')).toBe(true);
    expect(isBilibiliSourceLocator('https://api.example.com/play?bvid=BV1abc123')).toBe(true);
    expect(isBilibiliSourceLocator('C:/Music/local-track.flac')).toBe(false);
  });

  it('builds stable platform entry id regardless of input casing', () => {
    const first = buildStablePlatformEntryId('Connector.Platform.Bilibili', 'BV1ABC123');
    const second = buildStablePlatformEntryId('connector.platform.bilibili', 'bv1abc123');
    expect(first).toBe(second);
    expect(first.startsWith('entry::platform::connector.platform.bilibili::')).toBe(true);
  });

  it('resolves bilibili playback identity from track source locator', () => {
    const identity = resolvePlatformPlaybackIdentity({
      id: 'track-local-id',
      title: 'Demo',
      originalPath: 'bilibili://video/BV1abc123',
      comment: 'https://www.bilibili.com/video/BV1xyz987',
      path: 'C:/Music/cache.m4a',
    });

    expect(identity).not.toBeNull();
    expect(identity?.connectorId).toBe(BILIBILI_PLATFORM_CONNECTOR_ID);
    expect(identity?.sourceLocator).toBe('bilibili://video/BV1abc123');
    expect(identity?.sourceKey).toBe('bilibili://video/BV1abc123');
    expect(identity?.entryId.startsWith('entry::platform::connector.platform.bilibili::')).toBe(true);
  });

  it('returns null for non-platform local tracks', () => {
    const identity = resolvePlatformPlaybackIdentity({
      id: 'local-track-1',
      title: 'Local',
      path: 'C:/Music/local.flac',
      filePath: 'C:/Music/local.flac',
    });

    expect(identity).toBeNull();
  });
});
