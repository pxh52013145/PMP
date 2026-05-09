import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_ACTIVE_MAGNET_IDS, REQUIRED_MAGNET_IDS } from '../constants/magnets';
import { MATRIX_CONFIG } from '../constants/config';
import { writeJson } from '../modules/storage';
import {
  createDefaultMagnetLibrary,
  createDefaultMagnetSpacesState,
  resolveMagnetConfigStorageKey,
  type MagnetLayoutStoreState,
  type MagnetSpaceLayout,
} from '../modules/magnets';
import { saveConfig } from './configManager';
import {
  createEditorWindowMagnetConfigReloader,
  loadEditorMagnetConfigSnapshot,
} from './editorWindowMagnetConfigSync';
import { STORAGE_KEYS } from './windowCommunication';

function activeIdsWithRequired(...ids: string[]): string[] {
  return [...new Set([...REQUIRED_MAGNET_IDS, ...ids])];
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createEditorWindowMagnetConfigReloader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps an inactive-window update pending and flushes it when sync is ready', async () => {
    let ready = false;
    const reload = vi.fn();
    const reloader = createEditorWindowMagnetConfigReloader({
      isReady: () => ready,
      reload,
    });

    reloader.requestReload();
    vi.advanceTimersByTime(120);
    await flushMicrotasks();

    expect(reload).not.toHaveBeenCalled();

    ready = true;
    reloader.flushIfPending();
    await flushMicrotasks();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reruns after an in-flight reload when another update arrives', async () => {
    const reloadControl: { resolve?: () => void } = {};
    const reload = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          reloadControl.resolve = resolve;
        })
    );
    const reloader = createEditorWindowMagnetConfigReloader({
      isReady: () => true,
      reload,
    });

    reloader.requestReload();
    vi.advanceTimersByTime(60);
    await flushMicrotasks();
    expect(reload).toHaveBeenCalledTimes(1);

    reloader.requestReload();
    vi.advanceTimersByTime(60);
    await flushMicrotasks();
    expect(reload).toHaveBeenCalledTimes(1);

    const finishReload = reloadControl.resolve;
    if (!finishReload) throw new Error('Expected the first reload to be in flight.');
    finishReload();
    await flushMicrotasks();
    vi.advanceTimersByTime(0);
    await flushMicrotasks();

    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('clears a scheduled reload on dispose', async () => {
    const reload = vi.fn();
    const reloader = createEditorWindowMagnetConfigReloader({
      isReady: () => true,
      reload,
    });

    reloader.requestReload();
    reloader.dispose();
    vi.advanceTimersByTime(120);
    await flushMicrotasks();

    expect(reload).not.toHaveBeenCalled();
  });
});

describe('loadEditorMagnetConfigSnapshot', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('uses the current Tauri layout-store space active ids instead of stale per-space config', async () => {
    const defaultMagnetLibrary = createDefaultMagnetLibrary();
    const spaces = createDefaultMagnetSpacesState(1);
    const staleConfigActiveIds = new Set(activeIdsWithRequired('btn-debug'));
    const currentLayout: MagnetSpaceLayout = {
      version: 1,
      activeMagnetIds: activeIdsWithRequired('audio-visualizer'),
      anchorsByMagnetId: {},
    };
    const store: MagnetLayoutStoreState = {
      version: 1,
      revision: 7,
      spaces: { ...spaces, activeSpaceId: 'space2' },
      layoutsBySpaceId: {
        space2: currentLayout,
      },
      presetsBySpaceId: {},
      historyBySpaceId: {},
    };

    writeJson(STORAGE_KEYS.MAGNET_SPACES, { ...spaces, activeSpaceId: 'space1' });
    saveConfig(
      defaultMagnetLibrary,
      staleConfigActiveIds,
      { columns: MATRIX_CONFIG.COLUMNS, rows: MATRIX_CONFIG.ROWS },
      defaultMagnetLibrary,
      resolveMagnetConfigStorageKey('space2'),
      { includeCustomMagnets: false }
    );

    const snapshot = await loadEditorMagnetConfigSnapshot({
      defaultMagnetLibrary,
      isTauri: true,
      defaultActiveMagnetIds: DEFAULT_ACTIVE_MAGNET_IDS,
      loadLayoutStoreState: async () => store,
    });

    expect(snapshot.activeSpaceId).toBe('space2');
    expect(snapshot.activeMagnetIds.has('audio-visualizer')).toBe(true);
    expect(snapshot.activeMagnetIds.has('btn-debug')).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.MAGNET_SPACE_LAYOUT)).toBeNull();
  });
});
