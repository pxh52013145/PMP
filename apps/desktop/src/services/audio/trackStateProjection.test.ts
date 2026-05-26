import { describe, expect, it } from 'vitest';
import { resolvePlatformPlaybackIdentity } from './platformPlaybackResolver';
import { compactTrackForQueueState, compactTrackForState } from './trackStateProjection';
import type { Track } from './types';

function createPlatformTrack(): Track & Record<string, unknown> {
  return {
    id: 'track-a',
    title: 'Track A',
    filePath: 'C:\\cache\\track-a.flac',
    path: 'C:\\cache\\track-a.flac',
    sourceLocator: 'netease://song/123',
    streamUrl: 'https://example.test/track-a.flac',
    cachePath: 'C:\\cache\\track-a.flac',
    connectorId: 'connector.platform.netease',
    duration: 10,
  };
}

describe('trackStateProjection', () => {
  it('preserves platform playback identity fields in queue state', () => {
    const compacted = compactTrackForQueueState(createPlatformTrack()) as Track &
      Record<string, unknown>;

    expect(compacted.sourceLocator).toBe('netease://song/123');
    expect(compacted.streamUrl).toBe('https://example.test/track-a.flac');
    expect(compacted.connectorId).toBe('connector.platform.netease');
    expect(resolvePlatformPlaybackIdentity(compacted)).toMatchObject({
      connectorId: 'connector.platform.netease',
      sourceLocator: 'netease://song/123',
    });
  });

  it('preserves platform playback identity fields in current track state', () => {
    const compacted = compactTrackForState(createPlatformTrack()) as Track &
      Record<string, unknown>;

    expect(compacted.sourceLocator).toBe('netease://song/123');
    expect(compacted.streamUrl).toBe('https://example.test/track-a.flac');
  });
});
