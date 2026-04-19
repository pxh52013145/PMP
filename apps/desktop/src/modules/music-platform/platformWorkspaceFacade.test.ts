import { beforeEach, describe, expect, it, vi } from 'vitest';

const { callerMock, createCallerMock } = vi.hoisted(() => {
  const callerMock = vi.fn();
  return {
    callerMock,
    createCallerMock: vi.fn(() => callerMock),
  };
});

vi.mock('./connectorAuth', async () => {
  const actual = await vi.importActual<typeof import('./connectorAuth')>('./connectorAuth');
  return {
    ...actual,
    getPlatformConnectorDefinition: vi.fn(() => ({
      displayName: 'Netease Cloud Music',
    })),
  };
});

vi.mock('./platformConnectorFacadeCore', async () => {
  const actual =
    await vi.importActual<typeof import('./platformConnectorFacadeCore')>(
      './platformConnectorFacadeCore'
    );
  return {
    ...actual,
    createPlatformConnectorFacadeCaller: createCallerMock,
  };
});

import { listPlatformWorkspaceRecommendedCollections } from './platformWorkspaceFacade';

type FacadeCall = {
  bindingId: string;
  method: string;
  runtimeBucket: string;
  map: (value: unknown) => unknown;
};

describe('platformWorkspaceFacade', () => {
  beforeEach(() => {
    callerMock.mockReset();
    createCallerMock.mockClear();
  });

  it('requests recommended playlists instead of daily resources for recommendation channels', async () => {
    callerMock.mockImplementation(async (options: FacadeCall) => {
      expect(options.bindingId).toBe('host.pmp.platform-instance.recommendations');
      expect(options.method).toBe('listRecommendedPlaylists');
      expect(options.runtimeBucket).toBe('recommendations');

      return options.map({
        items: [
          {
            playlistId: 'daily-mix',
            title: 'Daily Mix',
            trackCount: 12,
            coverUrl: 'https://example.test/cover.jpg',
          },
        ],
      });
    });

    const result = await listPlatformWorkspaceRecommendedCollections({
      connectorId: 'connector.platform.netease',
      instanceId: 'netease:builtin',
      forceRefresh: true,
    });

    expect(createCallerMock).toHaveBeenCalledWith({
      connectorId: 'connector.platform.netease',
      displayName: 'Netease Cloud Music',
    });
    expect(result).toEqual([
      {
        collectionId: 'daily-mix',
        title: 'Daily Mix',
        trackCount: 12,
        coverUrl: 'https://example.test/cover.jpg',
        updatedAtMs: undefined,
      },
    ]);
  });
});
