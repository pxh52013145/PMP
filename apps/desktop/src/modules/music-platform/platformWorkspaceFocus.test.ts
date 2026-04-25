import type { PlatformInstanceRecord } from '@pixel-matrix/plugin-platform-contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  instance: null as PlatformInstanceRecord | null,
  setActiveMusicPlatformInstance: vi.fn(async () => undefined),
  setPlatformRenderSelectionMounted: vi.fn(),
}));

vi.mock('../../utils/tauriRuntime', () => ({
  isTauriRuntime: () => false,
}));

vi.mock('../../utils/windowCommunication', () => ({
  STORAGE_KEYS: {
    MAGNET_SPACES: 'pixel-matrix-magnet-spaces-v1',
    MAGNET_SPACE_LAYOUT: 'pixel-matrix-magnet-space-layout-v1',
  },
  TAURI_EVENTS: {
    MAGNET_SPACES_UPDATED: 'magnet-spaces-updated',
  },
  broadcastDataUpdate: async (key: string, data: unknown) => {
    localStorage.setItem(key, JSON.stringify(data));
  },
}));

vi.mock('./instanceRegistry', () => ({
  getPlatformInstance: () => mocks.instance,
}));

vi.mock('./activeInstanceRegistry', () => ({
  setActiveMusicPlatformInstance: mocks.setActiveMusicPlatformInstance,
}));

vi.mock('./renderSelectionRegistry', () => ({
  setPlatformRenderSelectionMounted: mocks.setPlatformRenderSelectionMounted,
}));

function createPlatformInstance(): PlatformInstanceRecord {
  return {
    instanceId: 'demo:dev-1',
    platformId: 'demo',
    instanceLabel: 'Demo',
    displayName: 'Demo',
    staticIcon: 'demo',
    account: {},
    auth: {
      status: 'authorized',
    },
    capabilities: {
      playlists: false,
      favorites: false,
      dailyRecommendations: false,
      search: false,
      quality: false,
      navigation: false,
      settings: false,
      pages: true,
    },
    registrations: {
      navigationIds: [],
      settingsIds: [],
      pageIds: [],
    },
    availability: 'available',
    metadata: {
      connectorId: 'connector.platform.demo',
    },
  };
}

describe('platform workspace focus', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    mocks.instance = createPlatformInstance();
    mocks.setActiveMusicPlatformInstance.mockClear();
    mocks.setPlatformRenderSelectionMounted.mockClear();
  });

  it('mounts the instance and switches to the existing platform workspace space', async () => {
    const focus = await import('./platformWorkspaceFocus');

    await expect(
      focus.focusMusicPlatformWorkspaceInstance({
        instanceId: 'demo:dev-1',
        connectorId: 'connector.platform.demo',
      })
    ).resolves.toMatchObject({
      instanceId: 'demo:dev-1',
      connectorId: 'connector.platform.demo',
      targetSpaceId: 'space2',
    });

    expect(mocks.setPlatformRenderSelectionMounted).toHaveBeenCalledWith(
      'demo:dev-1',
      true
    );
    expect(mocks.setActiveMusicPlatformInstance).toHaveBeenCalledWith({
      instanceId: 'demo:dev-1',
      connectorId: 'connector.platform.demo',
    });

    const spaces = JSON.parse(
      localStorage.getItem('pixel-matrix-magnet-spaces-v1') ?? '{}'
    ) as { activeSpaceId?: string };
    expect(spaces.activeSpaceId).toBe('space2');
  });
});
