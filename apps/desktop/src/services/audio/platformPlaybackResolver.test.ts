import { describe, expect, it, vi } from 'vitest';

vi.mock('../../modules/music-platform/connectorAuth', () => ({
  listPlatformConnectorDefinitions: vi.fn(() => [
    {
      connectorId: 'connector.platform.bilibili',
      workspaceKind: 'bilibili',
      enabled: true,
    },
    {
      connectorId: 'connector.platform.netease',
      workspaceKind: 'netease',
      enabled: true,
    },
    {
      connectorId: 'connector.platform.videohub',
      workspaceKind: 'videohub',
      enabled: true,
    },
  ]),
}));

import type { Track } from './types';
import {
  BILIBILI_PLATFORM_CONNECTOR_ID,
  NETEASE_PLATFORM_CONNECTOR_ID,
  resolvePlatformPlaybackIdentity,
} from './platformPlaybackResolver';

function createTrack(input: Partial<Track>): Track {
  return {
    id: input.id ?? 'track-1',
    title: input.title ?? 'Track',
    path: input.path,
    filePath: input.filePath,
    originalPath: input.originalPath,
    comment: input.comment,
    artist: input.artist,
  };
}

describe('platformPlaybackResolver', () => {
  it('resolves bilibili playback identity from prefixed ids and remote locators', () => {
    const identity = resolvePlatformPlaybackIdentity(
      createTrack({
        id: 'bilibili:video:BV1-test',
        originalPath: 'https://www.bilibili.com/video/BV1-test',
      })
    );

    expect(identity).toMatchObject({
      connectorId: BILIBILI_PLATFORM_CONNECTOR_ID,
      sourceLocator: 'https://www.bilibili.com/video/BV1-test',
    });
  });

  it('resolves netease playback identity from custom locator schemes', () => {
    const identity = resolvePlatformPlaybackIdentity(
      createTrack({
        id: 'song-1',
        comment: 'netease://song/1',
      })
    );

    expect(identity).toMatchObject({
      connectorId: NETEASE_PLATFORM_CONNECTOR_ID,
      sourceLocator: 'netease://song/1',
    });
  });

  it('resolves generic pack connectors from registered workspace kinds', () => {
    const identity = resolvePlatformPlaybackIdentity(
      createTrack({
        id: 'episode-42',
        originalPath: 'videohub://episode/42',
      })
    );

    expect(identity).toMatchObject({
      connectorId: 'connector.platform.videohub',
      sourceLocator: 'videohub://episode/42',
    });
  });

  it('does not misclassify local files as platform playback', () => {
    const identity = resolvePlatformPlaybackIdentity(
      createTrack({
        id: 'track-1',
        path: 'D:/Music/Netease Song.mp3',
        originalPath: 'D:/Music/Netease Song.mp3',
      })
    );

    expect(identity).toBeNull();
  });
});
