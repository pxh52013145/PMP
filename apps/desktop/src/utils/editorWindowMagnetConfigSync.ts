import { DEFAULT_ACTIVE_MAGNET_IDS, REQUIRED_MAGNET_IDS } from '../constants/magnets';
import { MATRIX_CONFIG } from '../constants/config';
import type { Magnet } from '../types/pixel';
import { readJson } from '../modules/storage';
import {
  applyMagnetConfig,
  createDefaultMagnetSpaceLayout,
  createDefaultMagnetSpacesState,
  createInitialMagnetSpaceTemplateLayout,
  ensureMagnetCatalogState,
  ensureMagnetSpaceLayout,
  loadMagnetConfig,
  magnetLayoutStoreBootstrap,
  magnetLayoutStoreGetState,
  patchMagnetStateConfigWithLayoutSnapshot,
  resolveMagnetConfigStorageKey,
  sanitizeMagnetSpacesState,
  type MagnetConfig,
  type MagnetLayoutStoreState,
  type MagnetSpaceLayout,
  type MagnetStateConfig,
} from '../modules/magnets';
import { STORAGE_KEYS } from './windowCommunication';

export type EditorMagnetConfigSnapshot = {
  activeSpaceId: string;
  magnetLibrary: Magnet[];
  activeMagnetIds: Set<string>;
};

export type LoadEditorMagnetConfigSnapshotOptions = {
  defaultMagnetLibrary: Magnet[];
  isTauri: boolean;
  defaultActiveMagnetIds?: ReadonlySet<string>;
  loadLayoutStoreState?: () => Promise<MagnetLayoutStoreState | null>;
};

export function readActiveMagnetSpaceIdFromStorage(): string {
  const raw = readJson(STORAGE_KEYS.MAGNET_SPACES, createDefaultMagnetSpacesState());
  return sanitizeMagnetSpacesState(raw).activeSpaceId;
}

async function loadDefaultLayoutStoreState(
  defaultActiveMagnetIds: ReadonlySet<string>
): Promise<MagnetLayoutStoreState | null> {
  const bootstrapped = await magnetLayoutStoreBootstrap(defaultActiveMagnetIds);
  return bootstrapped?.state ?? (await magnetLayoutStoreGetState());
}

function resolveLayoutFromStorage(
  defaultActiveMagnetIds: ReadonlySet<string>
): { activeSpaceId: string; layout: MagnetSpaceLayout } {
  const activeSpaceId = readActiveMagnetSpaceIdFromStorage();
  const layout = ensureMagnetSpaceLayout(activeSpaceId, {
    defaultActiveMagnetIds,
  }).layout;

  return { activeSpaceId, layout };
}

function resolveLayoutFromStore(
  store: MagnetLayoutStoreState,
  defaultActiveMagnetIds: ReadonlySet<string>
): { activeSpaceId: string; layout: MagnetSpaceLayout } {
  const activeSpaceId = store.spaces.activeSpaceId;
  const activeSpace = store.spaces.spaces.find((space) => space.id === activeSpaceId);
  const layout =
    store.layoutsBySpaceId[activeSpaceId] ??
    createInitialMagnetSpaceTemplateLayout(activeSpace?.seedTemplateId, defaultActiveMagnetIds) ??
    createDefaultMagnetSpaceLayout(activeSpaceId, defaultActiveMagnetIds);

  return { activeSpaceId, layout };
}

export async function loadEditorMagnetConfigSnapshot({
  defaultMagnetLibrary,
  isTauri,
  defaultActiveMagnetIds = DEFAULT_ACTIVE_MAGNET_IDS,
  loadLayoutStoreState = () => loadDefaultLayoutStoreState(defaultActiveMagnetIds),
}: LoadEditorMagnetConfigSnapshotOptions): Promise<EditorMagnetConfigSnapshot> {
  const storeLayout = isTauri ? await loadLayoutStoreState() : null;
  const { activeSpaceId, layout } = storeLayout
    ? resolveLayoutFromStore(storeLayout, defaultActiveMagnetIds)
    : resolveLayoutFromStorage(defaultActiveMagnetIds);

  const catalogMagnets = ensureMagnetCatalogState().state.magnets;
  const activeFromLayout = new Set(layout.activeMagnetIds);
  for (const id of REQUIRED_MAGNET_IDS) activeFromLayout.add(id);

  const configKey = resolveMagnetConfigStorageKey(activeSpaceId);
  const config = loadMagnetConfig(configKey);
  const baseConfig: MagnetConfig = config
    ? { ...config, customMagnets: catalogMagnets }
    : {
        version: '1.1.0',
        gridSize: { columns: MATRIX_CONFIG.COLUMNS, rows: MATRIX_CONFIG.ROWS },
        magnets: {},
        customMagnets: catalogMagnets,
      };

  const patchedMagnets: Record<string, MagnetStateConfig> = patchMagnetStateConfigWithLayoutSnapshot({
    magnets: [...defaultMagnetLibrary, ...catalogMagnets],
    currentStates: baseConfig.magnets,
    anchorsByMagnetId: layout.anchorsByMagnetId,
    activeMagnetIds: activeFromLayout,
  });

  const applied = applyMagnetConfig(
    {
      ...baseConfig,
      gridSize: { columns: MATRIX_CONFIG.COLUMNS, rows: MATRIX_CONFIG.ROWS },
      magnets: patchedMagnets,
    },
    defaultMagnetLibrary
  );
  return {
    activeSpaceId,
    magnetLibrary: applied.magnetLibrary,
    activeMagnetIds: activeFromLayout,
  };
}

export type EditorWindowMagnetConfigReloader = {
  requestReload: () => void;
  flushIfPending: () => void;
  dispose: () => void;
};

export type CreateEditorWindowMagnetConfigReloaderOptions = {
  reload: () => void | Promise<void>;
  isReady: () => boolean;
  delayMs?: number;
  onError?: (error: unknown) => void;
  setTimeoutFn?: (handler: () => void, timeout: number) => number;
  clearTimeoutFn?: (handle: number) => void;
};

export function createEditorWindowMagnetConfigReloader({
  reload,
  isReady,
  delayMs = 60,
  onError,
  setTimeoutFn = (handler, timeout) => window.setTimeout(handler, timeout),
  clearTimeoutFn = (handle) => window.clearTimeout(handle),
}: CreateEditorWindowMagnetConfigReloaderOptions): EditorWindowMagnetConfigReloader {
  let disposed = false;
  let pending = false;
  let inFlight = false;
  let timer: number | null = null;

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeoutFn(timer);
    timer = null;
  };

  const run = () => {
    timer = null;
    if (disposed) return;
    if (!isReady()) {
      pending = true;
      return;
    }
    if (inFlight) {
      pending = true;
      return;
    }

    pending = false;
    inFlight = true;
    void Promise.resolve(reload())
      .catch((error) => {
        onError?.(error);
      })
      .finally(() => {
        inFlight = false;
        if (!disposed && pending) {
          run();
        }
      });
  };

  const schedule = (timeout: number) => {
    if (disposed || timer !== null) return;
    timer = setTimeoutFn(run, timeout);
  };

  return {
    requestReload() {
      if (disposed) return;
      pending = true;
      if (!isReady() || inFlight) return;
      schedule(delayMs);
    },
    flushIfPending() {
      if (disposed || !pending || !isReady()) return;
      clearTimer();
      run();
    },
    dispose() {
      disposed = true;
      pending = false;
      clearTimer();
    },
  };
}
