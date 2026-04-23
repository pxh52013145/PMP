import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  instances: [] as Array<{ instanceId: string }>,
  storedSelections: [] as Array<Record<string, unknown>>,
  instanceListeners: new Set<() => void>(),
  storageListeners: [] as Array<() => void>,
  broadcastDataUpdate: vi.fn(
    async (_storageKey: string, data: Array<Record<string, unknown>>) => {
      state.storedSelections = data.map((item) => ({ ...item }));
    }
  ),
}));

vi.mock('../storage', () => ({
  readJson: (_key: string, fallback: unknown) =>
    Array.isArray(state.storedSelections) ? state.storedSelections : fallback,
}));

vi.mock('../../utils/windowCommunication', () => ({
  STORAGE_KEYS: {
    PLATFORM_RENDER_SELECTIONS_V1: 'pixel-matrix-platform-render-selections-v1',
  },
  TAURI_EVENTS: {
    PLATFORM_RENDER_SELECTIONS_UPDATED: 'platform-render-selections-updated',
  },
  broadcastDataUpdate: (
    storageKey: string,
    data: Array<Record<string, unknown>>,
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

describe('renderSelectionRegistry', () => {
  beforeEach(() => {
    vi.resetModules();
    state.instances = [];
    state.storedSelections = [];
    state.instanceListeners.clear();
    state.storageListeners = [];
    state.broadcastDataUpdate.mockClear();
  });

  it('restores persisted hidden entry state on bootstrap', async () => {
    state.instances = [{ instanceId: 'qqmusic:imported-1' }];
    state.storedSelections = [
      {
        instanceId: 'qqmusic:imported-1',
        mounted: false,
        order: 0,
      },
    ];

    const registry = await import('./renderSelectionRegistry');

    expect(registry.listPlatformRenderSelections()).toEqual([
      expect.objectContaining({
        instanceId: 'qqmusic:imported-1',
        mounted: false,
        order: 0,
      }),
    ]);
    expect(state.broadcastDataUpdate).not.toHaveBeenCalled();
  });

  it('creates new instance entries as hidden until the user explicitly mounts them', async () => {
    state.instances = [{ instanceId: 'qqmusic:imported-1' }];

    const registry = await import('./renderSelectionRegistry');

    expect(registry.listPlatformRenderSelections()).toEqual([
      expect.objectContaining({
        instanceId: 'qqmusic:imported-1',
        mounted: false,
        order: 0,
      }),
    ]);
    expect(state.broadcastDataUpdate).toHaveBeenCalledWith(
      'pixel-matrix-platform-render-selections-v1',
      expect.arrayContaining([
        expect.objectContaining({
          instanceId: 'qqmusic:imported-1',
          mounted: false,
        }),
      ])
    );
  });

  it('persists show/hide updates for platform entry visibility', async () => {
    state.instances = [{ instanceId: 'qqmusic:imported-1' }];

    const registry = await import('./renderSelectionRegistry');

    registry.setPlatformRenderSelectionMounted('qqmusic:imported-1', false);

    expect(state.broadcastDataUpdate).toHaveBeenLastCalledWith(
      'pixel-matrix-platform-render-selections-v1',
      expect.arrayContaining([
        expect.objectContaining({
          instanceId: 'qqmusic:imported-1',
          mounted: false,
        }),
      ])
    );
    expect(registry.getPlatformRenderSelection('qqmusic:imported-1')?.mounted).toBe(false);
  });

  it('does not rebroadcast when the mounted state is already unchanged', async () => {
    state.instances = [{ instanceId: 'qqmusic:imported-1' }];

    const registry = await import('./renderSelectionRegistry');
    registry.listPlatformRenderSelections();
    state.broadcastDataUpdate.mockClear();

    registry.setPlatformRenderSelectionMounted('qqmusic:imported-1', false);

    expect(state.broadcastDataUpdate).not.toHaveBeenCalled();
    expect(registry.getPlatformRenderSelection('qqmusic:imported-1')?.mounted).toBe(false);
  });

  it('hydrates external storage updates back into the live registry', async () => {
    state.instances = [{ instanceId: 'qqmusic:imported-1' }];
    state.storedSelections = [
      {
        instanceId: 'qqmusic:imported-1',
        mounted: true,
        order: 0,
      },
    ];

    const registry = await import('./renderSelectionRegistry');
    registry.listPlatformRenderSelections();
    await Promise.resolve();

    state.storedSelections = [
      {
        instanceId: 'qqmusic:imported-1',
        mounted: false,
        order: 0,
      },
    ];
    state.storageListeners[0]?.();

    expect(registry.getPlatformRenderSelection('qqmusic:imported-1')?.mounted).toBe(false);
  });

  it('inspects persisted storage without forcing live registry initialization', async () => {
    state.storedSelections = [
      {
        instanceId: 'qqmusic:imported-1',
        mounted: false,
        mountedAtMs: 123,
        order: 2,
      },
    ];

    const registry = await import('./renderSelectionRegistry');

    expect(registry.inspectPlatformRenderSelectionPersistence()).toEqual({
      initialized: false,
      live: [],
      persisted: [
        expect.objectContaining({
          instanceId: 'qqmusic:imported-1',
          mounted: false,
          mountedAtMs: 123,
          order: 2,
        }),
      ],
    });
    expect(state.broadcastDataUpdate).not.toHaveBeenCalled();
  });
});
