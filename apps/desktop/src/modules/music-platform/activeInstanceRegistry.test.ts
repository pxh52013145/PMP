import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  instances: [] as Array<{ instanceId: string; metadata?: { connectorId?: string } }>,
  importedInstances: [] as Array<{ instanceId: string; connectorId: string }>,
  storedState: null as Record<string, unknown> | null,
  instanceListeners: new Set<() => void>(),
  importedInstanceListeners: new Set<() => void>(),
  storageListeners: [] as Array<() => void>,
  broadcastDataUpdate: vi.fn(async (_storageKey: string, data: Record<string, unknown>) => {
    state.storedState = { ...data };
  }),
}));

vi.mock('../storage', () => ({
  readJson: (_key: string, fallback: unknown) => state.storedState ?? fallback,
}));

vi.mock('../../utils/windowCommunication', () => ({
  STORAGE_KEYS: {
    MUSIC_PLATFORM_ACTIVE_INSTANCE_V1: 'pixel-matrix-music-platform-active-instance-v1',
  },
  TAURI_EVENTS: {
    MUSIC_PLATFORM_ACTIVE_INSTANCE_UPDATED: 'music-platform-active-instance-updated',
  },
  broadcastDataUpdate: (
    storageKey: string,
    data: Record<string, unknown>,
    _tauriEvent?: string
  ) => state.broadcastDataUpdate(storageKey, data),
  setupDualListener: async (
    _storageKeys: string[],
    _tauriEvents: string[],
    listener: () => void
  ) => {
    state.storageListeners.push(listener);
    return () => {
      const index = state.storageListeners.indexOf(listener);
      if (index >= 0) {
        state.storageListeners.splice(index, 1);
      }
    };
  },
}));

vi.mock('./instanceRegistry', () => ({
  listPlatformInstances: () => state.instances,
  subscribePlatformInstances: (listener: () => void) => {
    state.instanceListeners.add(listener);
    return () => {
      state.instanceListeners.delete(listener);
    };
  },
}));

vi.mock('./platformImportedInstanceRegistry', () => ({
  listPlatformImportedInstanceRecords: () => state.importedInstances,
  subscribePlatformImportedInstanceRecords: async (listener: () => void) => {
    state.importedInstanceListeners.add(listener);
    return () => {
      state.importedInstanceListeners.delete(listener);
    };
  },
}));

describe('activeInstanceRegistry', () => {
  beforeEach(() => {
    vi.resetModules();
    state.instances = [];
    state.importedInstances = [];
    state.storedState = null;
    state.instanceListeners.clear();
    state.importedInstanceListeners.clear();
    state.storageListeners = [];
    state.broadcastDataUpdate.mockClear();
  });

  it('persists a shared active instance selection and connector pin', async () => {
    state.instances = [
      {
        instanceId: 'netease:imported-a',
        metadata: {
          connectorId: 'connector.platform.netease',
        },
      },
    ];

    const registry = await import('./activeInstanceRegistry');
    await registry.setActiveMusicPlatformInstance({
      instanceId: 'netease:imported-a',
      connectorId: 'connector.platform.netease',
    });

    expect(registry.getActiveMusicPlatformInstanceId()).toBe('netease:imported-a');
    expect(
      registry.getActiveMusicPlatformInstanceId({
        connectorId: 'connector.platform.netease',
      })
    ).toBe('netease:imported-a');
    expect(state.broadcastDataUpdate).toHaveBeenLastCalledWith(
      'pixel-matrix-music-platform-active-instance-v1',
      expect.objectContaining({
        currentInstanceId: 'netease:imported-a',
        connectorInstanceIds: {
          'connector.platform.netease': 'netease:imported-a',
        },
      })
    );
  });

  it('keeps imported-instance selections alive before the instance registry catches up', async () => {
    state.importedInstances = [
      {
        instanceId: 'netease:imported-a',
        connectorId: 'connector.platform.netease',
      },
    ];
    state.storedState = {
      currentInstanceId: 'netease:imported-a',
      connectorInstanceIds: {
        'connector.platform.netease': 'netease:imported-a',
      },
    };

    const registry = await import('./activeInstanceRegistry');

    expect(registry.getMusicPlatformActiveInstanceState()).toEqual({
      currentInstanceId: 'netease:imported-a',
      connectorInstanceIds: {
        'connector.platform.netease': 'netease:imported-a',
      },
    });
  });

  it('sanitizes stale selections when the selected instance disappears', async () => {
    state.instances = [
      {
        instanceId: 'netease:imported-a',
        metadata: {
          connectorId: 'connector.platform.netease',
        },
      },
    ];
    state.storedState = {
      currentInstanceId: 'netease:imported-a',
      connectorInstanceIds: {
        'connector.platform.netease': 'netease:imported-a',
      },
    };

    const registry = await import('./activeInstanceRegistry');
    expect(registry.getActiveMusicPlatformInstanceId()).toBe('netease:imported-a');

    state.instances = [];
    state.instanceListeners.forEach((listener) => {
      listener();
    });

    expect(registry.getMusicPlatformActiveInstanceState()).toEqual({
      currentInstanceId: null,
      connectorInstanceIds: {},
    });
    expect(state.broadcastDataUpdate).toHaveBeenCalledWith(
      'pixel-matrix-music-platform-active-instance-v1',
      {
        currentInstanceId: null,
        connectorInstanceIds: {},
      }
    );
  });
});
