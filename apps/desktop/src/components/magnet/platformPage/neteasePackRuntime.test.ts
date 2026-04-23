import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error runtime pack entry is shipped as plain JS without repo ambient typings.
import { mountPage } from '../../../../../../resource/music-platform/packs/builtin/netease/runtime.js';

type AudioState = {
  playbackState?: string;
  currentTrack?: {
    resourceId?: string;
    title?: string;
    artist?: string;
    artistNames?: string;
  } | null;
  positionMs?: number;
};

function createTrack(resourceId: string, title: string, artist: string) {
  return {
    resourceId,
    title,
    artist,
  };
}

function createApiHarness() {
  let audioListener: ((state: AudioState) => void) | null = null;
  let currentAudioState: AudioState = {
    playbackState: 'paused',
    currentTrack: createTrack('track-1', 'Song A', 'Artist A'),
    positionMs: 0,
  };

  const invokeCapability = vi.fn(async (capabilityId: string, method: string) => {
    if (capabilityId === 'host.pmp.i18n' && method === 'getState') {
      return {
        ok: true,
        data: {
          activeLocale: 'en-US',
        },
      };
    }

    if (capabilityId === 'host.pmp.connector-auth' && method === 'getAuthSnapshot') {
      return {
        ok: true,
        data: {
          snapshot: {
            authState: 'authorized',
            availability: 'available',
            accountName: 'Tester',
          },
        },
      };
    }

    if (capabilityId === 'host.pmp.music-platform.workspace' && method === 'getWorkspaceModel') {
      return {
        ok: true,
        data: {
          model: {
            defaultPageId: 'recommended',
            pages: [
              { pageId: 'recommended', kind: 'recommended', title: 'Recommended', enabled: true },
              { pageId: 'instance', kind: 'workspace', title: 'Library', enabled: true },
              { pageId: 'search', kind: 'search', title: 'Search', enabled: true },
            ],
          },
        },
      };
    }

    if (capabilityId === 'host.pmp.music-platform.workspace' && method === 'listPages') {
      return {
        ok: true,
        data: {
          items: [
            { pageId: 'recommended', kind: 'recommended', title: 'Recommended', enabled: true },
            { pageId: 'instance', kind: 'workspace', title: 'Library', enabled: true },
            { pageId: 'search', kind: 'search', title: 'Search', enabled: true },
          ],
        },
      };
    }

    if (capabilityId === 'host.pmp.music-platform.workspace' && method === 'listCollections') {
      return {
        ok: true,
        data: {
          items: [
            { collectionId: 'playlist-1', title: 'Playlist 1', trackCount: 10 },
          ],
        },
      };
    }

    if (
      capabilityId === 'host.pmp.music-platform.workspace' &&
      method === 'listRecommendedCollections'
    ) {
      return {
        ok: true,
        data: {
          items: [
            { collectionId: 'recommended-1', title: 'Recommended 1', trackCount: 20 },
          ],
        },
      };
    }

    if (
      capabilityId === 'host.pmp.music-platform.workspace' &&
      method === 'listRecommendedResources'
    ) {
      return {
        ok: true,
        data: {
          page: {
            sourceKind: 'recommended',
            sourceId: 'recommended',
            pageNum: 1,
            pageSize: 1,
            total: 1,
            hasMore: false,
            items: [
              {
                resourceId: 'track-1',
                title: 'Song A',
                sourceLocator: 'netease:track:1',
                artistNames: 'Artist A',
                durationSeconds: 180,
              },
            ],
          },
        },
      };
    }

    if (capabilityId === 'host.pmp.music-platform.workspace' && method === 'listQualityState') {
      return {
        ok: true,
        data: {
          state: {
            currentKey: 'standard',
            currentLabel: 'Standard',
            options: [{ key: 'standard', label: 'Standard', available: true }],
          },
        },
      };
    }

    if (capabilityId === 'host.pmp.music-platform.workspace' && method === 'listCollectionResources') {
      return {
        ok: true,
        data: {
          page: {
            sourceKind: 'playlist',
            sourceId: 'playlist-1',
            pageNum: 1,
            pageSize: 1,
            total: 1,
            hasMore: false,
            items: [
              {
                resourceId: 'track-1',
                title: 'Song A',
                sourceLocator: 'netease:track:1',
                artistNames: 'Artist A',
                durationSeconds: 180,
              },
            ],
          },
        },
      };
    }

    if (capabilityId === 'host.pmp.music-platform.workspace' && method === 'searchResources') {
      return {
        ok: true,
        data: {
          page: {
            sourceKind: 'search',
            sourceId: 'keyword',
            pageNum: 1,
            pageSize: 0,
            total: 0,
            hasMore: false,
            items: [],
          },
        },
      };
    }

    if (capabilityId === 'host.pmp.music-platform.workspace' && method === 'preparePlayback') {
      return {
        ok: true,
        data: {
          prepared: {
            sourceLocator: 'netease:track:1',
            streamUrl: 'https://example.com/audio.mp3',
            cachePath: 'D:/cache/audio.mp3',
            resourceId: 'track-1',
          },
        },
      };
    }

    if (capabilityId === 'host.pmp.music-platform.workspace' && method === 'setQualityPreference') {
      return {
        ok: true,
        data: {
          state: {
            currentKey: 'standard',
            currentLabel: 'Standard',
            options: [{ key: 'standard', label: 'Standard', available: true }],
          },
        },
      };
    }

    throw new Error(`Unexpected capability call: ${capabilityId}.${method}`);
  });

  return {
    api: {
      host: {
        invokeCapability,
        getViewMountRequestSnapshot: () => ({
          mountMetadata: {
            connectorId: 'connector.platform.netease',
            instanceId: 'netease:imported-test',
            root: {
              viewId: 'netease.workspace.root',
            },
          },
        }),
      },
      audio: {
        getState: () => currentAudioState,
        onStateChange: (listener: (state: AudioState) => void) => {
          audioListener = listener;
          return () => {
            audioListener = null;
          };
        },
      },
    },
    emitAudio(nextState: AudioState) {
      currentAudioState = nextState;
      audioListener?.(nextState);
    },
    invokeCapability,
  };
}

async function flushRuntime(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await vi.runOnlyPendingTimersAsync();
  await Promise.resolve();
  await Promise.resolve();
}

describe('netease pack runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'requestAnimationFrame',
      ((callback: FrameRequestCallback) =>
        window.setTimeout(() => callback(Date.now()), 0)) as typeof requestAnimationFrame
    );
    vi.stubGlobal(
      'cancelAnimationFrame',
      ((handle: number) => window.clearTimeout(handle)) as typeof cancelAnimationFrame
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('does not rerender the whole workspace for progress-only audio updates', async () => {
    const harness = createApiHarness();
    const container = document.createElement('div');
    document.body.appendChild(container);

    const dispose = mountPage(container, harness.api, 'netease.workspace.root');
    for (let index = 0; index < 6; index += 1) {
      await flushRuntime();
    }

    const initialGrid = container.querySelector('.netease-pack-grid');
    expect(initialGrid).toBeTruthy();
    expect(container.textContent).toContain('Song A');

    harness.emitAudio({
      playbackState: 'paused',
      currentTrack: createTrack('track-1', 'Song A', 'Artist A'),
      positionMs: 30_000,
    });
    await flushRuntime();

    expect(container.querySelector('.netease-pack-grid')).toBe(initialGrid);

    dispose();
  });

  it('rerenders when the visible audio summary changes', async () => {
    const harness = createApiHarness();
    const container = document.createElement('div');
    document.body.appendChild(container);

    const dispose = mountPage(container, harness.api, 'netease.workspace.root');
    for (let index = 0; index < 6; index += 1) {
      await flushRuntime();
    }

    const initialGrid = container.querySelector('.netease-pack-grid');
    expect(initialGrid).toBeTruthy();

    harness.emitAudio({
      playbackState: 'playing',
      currentTrack: createTrack('track-2', 'Song B', 'Artist B'),
      positionMs: 0,
    });
    await flushRuntime();

    const nextGrid = container.querySelector('.netease-pack-grid');
    expect(nextGrid).toBeTruthy();
    expect(nextGrid).not.toBe(initialGrid);
    expect(container.textContent).toContain('Song B');
    expect(container.textContent).toContain('playing');

    dispose();
  });
});
