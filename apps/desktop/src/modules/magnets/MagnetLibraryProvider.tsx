import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BUILTIN_MAGNET_IDS, DEFAULT_ACTIVE_MAGNET_IDS, REQUIRED_MAGNET_IDS } from '../../constants/magnets';
import {
  STORAGE_KEYS,
  TAURI_EVENTS,
  broadcastDataUpdate,
  broadcastSignal,
  setupConfigSync,
} from '../../utils/windowCommunication';
import type { Magnet, PixelAnchor } from '../../types/pixel';
import { createDefaultMagnetLibrary } from './defaultLibrary';
import {
  applyMagnetConfig,
  cancelScheduledMagnetConfigSave,
  flushScheduledMagnetConfigSave,
  loadMagnetConfig,
  resolveMagnetConfigStorageKey,
  saveMagnetConfig,
  scheduleSaveMagnetConfig,
  type MagnetConfig,
  type MagnetStateConfig,
} from './config';
import {
  createDefaultMagnetCatalogState,
  ensureMagnetCatalogState,
  sanitizeMagnetCatalogState,
} from './catalog';
import {
  cancelScheduledMagnetSpaceLayoutSave,
  createDefaultMagnetSpaceLayout,
  deriveMagnetSpaceLayoutFromLegacyConfig,
  flushScheduledMagnetSpaceLayoutSave,
  loadMagnetSpaceLayout,
  saveMagnetSpaceLayout,
  scheduleSaveMagnetSpaceLayout,
  ensureMagnetSpaceLayout,
} from './layoutStorage';
import { resolveMagnetLayoutStorageKey, type MagnetSpaceLayout } from './layout';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { usePersistentSetting } from '../storage';
import { createDefaultMagnetSpacesState, sanitizeMagnetSpacesState } from './spaces';

export interface MagnetLibraryProviderProps {
  children: ReactNode;
  gridSize: { columns: number; rows: number };
  defaultActiveMagnetIds?: ReadonlySet<string>;
  autoSaveDebounceMs?: number;
  registerFlushHandler?: (handler: () => void) => () => void;
}

export interface MagnetConfigContextValue {
  defaultMagnetLibrary: Magnet[];
  magnetLibrary: Magnet[];
  activeMagnetIds: Set<string>;
  builtInMagnetIds: Set<string>;
  activeMagnets: Magnet[];
  updateMagnetAnchors: (magnetId: string, newAnchors: PixelAnchor[]) => void;
  activateMagnet: (magnetId: string) => void;
  deactivateMagnet: (magnetId: string) => void;
  setMagnetLibrary: React.Dispatch<React.SetStateAction<Magnet[]>>;
  setActiveMagnetIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  saveNow: () => void;
  reloadFromStorage: () => void;
}

const MagnetConfigContext = createContext<MagnetConfigContextValue | null>(null);

export function MagnetLibraryProvider({
  children,
  gridSize,
  defaultActiveMagnetIds = DEFAULT_ACTIVE_MAGNET_IDS,
  autoSaveDebounceMs = 500,
  registerFlushHandler,
}: MagnetLibraryProviderProps) {
  const defaultMagnetLibrary = useMemo(() => createDefaultMagnetLibrary(), []);
  const builtInMagnetIds = useMemo(() => new Set(BUILTIN_MAGNET_IDS), []);
  const suppressNextAutoSaveRef = useRef(false);
  const defaultSpacesState = useMemo(() => createDefaultMagnetSpacesState(), []);
  const [magnetSpacesRaw] = usePersistentSetting(STORAGE_KEYS.MAGNET_SPACES, defaultSpacesState, {
    format: 'json',
  });
  const magnetSpaces = useMemo(
    () => sanitizeMagnetSpacesState(magnetSpacesRaw),
    [magnetSpacesRaw]
  );
  const activeSpaceId = magnetSpaces.activeSpaceId;
  const magnetConfigStorageKey = useMemo(
    () => resolveMagnetConfigStorageKey(activeSpaceId),
    [activeSpaceId]
  );
  const magnetLayoutStorageKey = useMemo(
    () => resolveMagnetLayoutStorageKey(activeSpaceId),
    [activeSpaceId]
  );
  // Tracks the storage key for the *currently loaded* magnet state (magnetLibrary/activeMagnetIds).
  // This must not be updated until the new space config has been loaded, otherwise we may accidentally
  // persist the previous space state into the next space key (or vice versa).
  const loadedConfigKeyRef = useRef(magnetConfigStorageKey);
  const loadedLayoutKeyRef = useRef(magnetLayoutStorageKey);

  const resolvedDefaultActiveMagnetIds = useMemo(() => {
    const seed = activeSpaceId === 'space1' ? defaultActiveMagnetIds : REQUIRED_MAGNET_IDS;
    const next = new Set(seed);
    for (const id of REQUIRED_MAGNET_IDS) next.add(id);
    return next;
  }, [activeSpaceId, defaultActiveMagnetIds]);

  const defaultCatalogState = useMemo(() => createDefaultMagnetCatalogState(), []);
  const [catalogRaw] = usePersistentSetting(STORAGE_KEYS.MAGNET_CATALOG, defaultCatalogState, {
    format: 'json',
  });
  const customMagnetsCatalog = useMemo(() => {
    return sanitizeMagnetCatalogState(catalogRaw).magnets;
  }, [catalogRaw]);

  const initialRef = useRef<{
    magnetLibrary: Magnet[];
    activeMagnetIds: Set<string>;
    layout: MagnetSpaceLayout;
  } | null>(null);
  if (!initialRef.current) {
    const maybeLayout = loadMagnetSpaceLayout(magnetLayoutStorageKey);
    const primaryConfig = loadMagnetConfig(magnetConfigStorageKey);
    const layout =
      maybeLayout ??
      (primaryConfig
        ? deriveMagnetSpaceLayoutFromLegacyConfig(activeSpaceId, primaryConfig, {
            defaultActiveMagnetIds: resolvedDefaultActiveMagnetIds,
          })
        : createDefaultMagnetSpaceLayout(activeSpaceId, resolvedDefaultActiveMagnetIds));

    const activeFromLayout = new Set(layout.activeMagnetIds);
    for (const id of REQUIRED_MAGNET_IDS) activeFromLayout.add(id);

    const baseLibrary = [...defaultMagnetLibrary, ...customMagnetsCatalog];
    const baseConfig: MagnetConfig = primaryConfig
      ? { ...primaryConfig, customMagnets: customMagnetsCatalog, gridSize }
      : {
          version: '1.1.0',
          gridSize,
          magnets: {} as Record<string, MagnetStateConfig>,
          customMagnets: customMagnetsCatalog,
        };

    const patchedMagnets: Record<string, MagnetStateConfig> = { ...baseConfig.magnets };
    for (const magnet of baseLibrary) {
      const existing = patchedMagnets[magnet.id];
      patchedMagnets[magnet.id] = {
        ...(existing ?? { anchors: magnet.anchors, isActive: false }),
        anchors: layout.anchorsByMagnetId[magnet.id] ?? existing?.anchors ?? magnet.anchors,
        isActive: activeFromLayout.has(magnet.id),
      };
    }

    const applied = applyMagnetConfig(
      { ...baseConfig, gridSize, magnets: patchedMagnets },
      defaultMagnetLibrary
    );
    const ensuredActive = new Set(applied.activeMagnetIds);
    for (const id of REQUIRED_MAGNET_IDS) ensuredActive.add(id);

    loadedConfigKeyRef.current = magnetConfigStorageKey;
    loadedLayoutKeyRef.current = magnetLayoutStorageKey;

    initialRef.current = {
      magnetLibrary: applied.magnetLibrary,
      activeMagnetIds: ensuredActive,
      layout,
    };
  }

  const [magnetLibrary, setMagnetLibrary] = useState<Magnet[]>(() => initialRef.current!.magnetLibrary);
  const [activeMagnetIds, setActiveMagnetIds] = useState<Set<string>>(() => initialRef.current!.activeMagnetIds);

  const activeMagnets = useMemo(() => {
    return magnetLibrary.filter((m) => activeMagnetIds.has(m.id));
  }, [magnetLibrary, activeMagnetIds]);

  const buildLayoutSnapshot = useCallback(
    (library: Magnet[], activeIds: Set<string>): MagnetSpaceLayout => {
      const active = new Set(activeIds);
      for (const id of REQUIRED_MAGNET_IDS) active.add(id);

      const anchorsByMagnetId: Record<string, PixelAnchor[]> = {};
      for (const magnet of library) {
        if (!Array.isArray(magnet.anchors) || magnet.anchors.length === 0) continue;
        anchorsByMagnetId[magnet.id] = magnet.anchors;
      }

      return {
        version: 1,
        activeMagnetIds: [...active],
        anchorsByMagnetId,
      };
    },
    []
  );

  const reloadFromStorage = useCallback(() => {
    suppressNextAutoSaveRef.current = true;
    cancelScheduledMagnetConfigSave();
    cancelScheduledMagnetSpaceLayoutSave();

    const spaceIds = magnetSpaces.spaces.map((s) => s.id);
    const catalogMagnets = ensureMagnetCatalogState(spaceIds).state.magnets;

    const layoutResult = ensureMagnetSpaceLayout(activeSpaceId, {
      defaultActiveMagnetIds: resolvedDefaultActiveMagnetIds,
    });
    const layout = layoutResult.layout;
    const activeFromLayout = new Set(layout.activeMagnetIds);
    for (const id of REQUIRED_MAGNET_IDS) activeFromLayout.add(id);

    const primaryConfig = loadMagnetConfig(magnetConfigStorageKey);
    const baseConfig: MagnetConfig = primaryConfig
      ? { ...primaryConfig, customMagnets: catalogMagnets, gridSize }
      : {
          version: '1.1.0',
          gridSize,
          magnets: {} as Record<string, MagnetStateConfig>,
          customMagnets: catalogMagnets,
        };

    const baseLibrary = [...defaultMagnetLibrary, ...catalogMagnets];
    const patchedMagnets: Record<string, MagnetStateConfig> = { ...baseConfig.magnets };
    for (const magnet of baseLibrary) {
      const existing = patchedMagnets[magnet.id];
      patchedMagnets[magnet.id] = {
        ...(existing ?? { anchors: magnet.anchors, isActive: false }),
        anchors: layout.anchorsByMagnetId[magnet.id] ?? existing?.anchors ?? magnet.anchors,
        isActive: activeFromLayout.has(magnet.id),
      };
    }

    const applied = applyMagnetConfig(
      { ...baseConfig, gridSize, magnets: patchedMagnets },
      defaultMagnetLibrary
    );
    const ensuredActive = new Set(applied.activeMagnetIds);
    for (const id of REQUIRED_MAGNET_IDS) ensuredActive.add(id);

    loadedConfigKeyRef.current = magnetConfigStorageKey;
    loadedLayoutKeyRef.current = layoutResult.storageKey;

    setMagnetLibrary(applied.magnetLibrary);
    setActiveMagnetIds(ensuredActive);
  }, [
    activeSpaceId,
    defaultMagnetLibrary,
    gridSize,
    magnetConfigStorageKey,
    magnetSpaces.spaces,
    resolvedDefaultActiveMagnetIds,
  ]);

  const didInitialReloadRef = useRef(false);
  useEffect(() => {
    if (didInitialReloadRef.current) return;
    didInitialReloadRef.current = true;
    reloadFromStorage();
  }, [reloadFromStorage]);

  const saveNow = useCallback(() => {
    cancelScheduledMagnetConfigSave();
    cancelScheduledMagnetSpaceLayoutSave();
    const configKey = loadedConfigKeyRef.current;
    const layoutKey = loadedLayoutKeyRef.current;
    saveMagnetConfig(magnetLibrary, activeMagnetIds, gridSize, defaultMagnetLibrary, configKey);
    const layout = buildLayoutSnapshot(magnetLibrary, activeMagnetIds);
    saveMagnetSpaceLayout(layout, layoutKey);
  }, [activeMagnetIds, buildLayoutSnapshot, defaultMagnetLibrary, gridSize, magnetLibrary]);

  const updateMagnetAnchors = useCallback((magnetId: string, newAnchors: PixelAnchor[]) => {
    setMagnetLibrary((prev) => prev.map((m) => (m.id === magnetId ? { ...m, anchors: newAnchors } : m)));
  }, []);

  const activateMagnet = useCallback((magnetId: string) => {
    setActiveMagnetIds((prev) => {
      const next = new Set(prev);
      next.add(magnetId);
      return next;
    });
  }, []);

  const deactivateMagnet = useCallback((magnetId: string) => {
    if (REQUIRED_MAGNET_IDS.has(magnetId)) return;
    setActiveMagnetIds((prev) => {
      const next = new Set(prev);
      next.delete(magnetId);
      return next;
    });
  }, []);

  useEffect(() => {
    const missing: string[] = [];
    for (const id of REQUIRED_MAGNET_IDS) {
      if (!activeMagnetIds.has(id)) missing.push(id);
    }
    if (missing.length === 0) return;

    setActiveMagnetIds((prev) => {
      const next = new Set(prev);
      for (const id of missing) next.add(id);
      return next;
    });
  }, [activeMagnetIds]);

  useEffect(() => {
    void broadcastDataUpdate(STORAGE_KEYS.BUILTIN_MAGNETS, [...builtInMagnetIds]);
  }, [builtInMagnetIds]);

  useEffect(() => {
    if (suppressNextAutoSaveRef.current) {
      suppressNextAutoSaveRef.current = false;
      return;
    }

    const layoutKey = loadedLayoutKeyRef.current;
    const layout = buildLayoutSnapshot(magnetLibrary, activeMagnetIds);
    scheduleSaveMagnetSpaceLayout(layout, {
      debounceMs: autoSaveDebounceMs,
      storageKey: layoutKey,
      afterSave: () => {
        if (!isTauriRuntime()) return;
        void broadcastSignal(TAURI_EVENTS.MAGNET_LIBRARY_UPDATED);
      },
    });

    const storageKey = loadedConfigKeyRef.current;
    scheduleSaveMagnetConfig(magnetLibrary, activeMagnetIds, gridSize, defaultMagnetLibrary, {
      debounceMs: autoSaveDebounceMs,
      storageKey,
    });
  }, [
    activeMagnetIds,
    autoSaveDebounceMs,
    buildLayoutSnapshot,
    defaultMagnetLibrary,
    gridSize,
    magnetLibrary,
  ]);

  useEffect(() => {
    const loadedKey = loadedConfigKeyRef.current;
    const loadedLayoutKey = loadedLayoutKeyRef.current;
    if (loadedKey === magnetConfigStorageKey && loadedLayoutKey === magnetLayoutStorageKey) return;
    try {
      flushScheduledMagnetConfigSave();
      flushScheduledMagnetSpaceLayoutSave();
      saveMagnetConfig(magnetLibrary, activeMagnetIds, gridSize, defaultMagnetLibrary, loadedKey);
      const layout = buildLayoutSnapshot(magnetLibrary, activeMagnetIds);
      saveMagnetSpaceLayout(layout, loadedLayoutKey);
    } catch (error) {
      console.warn(`[magnets] Failed to persist config before switching key "${loadedKey}"`, error);
    }

    reloadFromStorage();
  }, [
    activeMagnetIds,
    buildLayoutSnapshot,
    defaultMagnetLibrary,
    gridSize,
    magnetConfigStorageKey,
    magnetLayoutStorageKey,
    magnetLibrary,
    reloadFromStorage,
  ]);

  useEffect(() => {
    if (!registerFlushHandler) return;
    return registerFlushHandler(() => {
      flushScheduledMagnetConfigSave();
      flushScheduledMagnetSpaceLayoutSave();
    });
  }, [registerFlushHandler]);

  useEffect(() => {
    return () => {
      flushScheduledMagnetConfigSave();
      flushScheduledMagnetSpaceLayoutSave();
    };
  }, []);

  useEffect(() => {
    const cleanupPromise = setupConfigSync(
      [STORAGE_KEYS.MAGNET_SPACES, STORAGE_KEYS.MAGNET_CATALOG, magnetConfigStorageKey, magnetLayoutStorageKey],
      [
        TAURI_EVENTS.MAGNET_LIBRARY_UPDATED,
        TAURI_EVENTS.MAGNET_ACTIVATED,
        TAURI_EVENTS.MAGNET_DEACTIVATED,
        TAURI_EVENTS.MAGNET_SPACES_UPDATED,
      ],
      reloadFromStorage
    );
    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [magnetConfigStorageKey, magnetLayoutStorageKey, reloadFromStorage]);

  const value: MagnetConfigContextValue = {
    defaultMagnetLibrary,
    magnetLibrary,
    activeMagnetIds,
    builtInMagnetIds,
    activeMagnets,
    updateMagnetAnchors,
    activateMagnet,
    deactivateMagnet,
    setMagnetLibrary,
    setActiveMagnetIds,
    saveNow,
    reloadFromStorage,
  };

  return <MagnetConfigContext.Provider value={value}>{children}</MagnetConfigContext.Provider>;
}

export function useMagnetConfig(): MagnetConfigContextValue {
  const context = useContext(MagnetConfigContext);
  if (!context) {
    throw new Error('useMagnetConfig must be used within MagnetLibraryProvider');
  }
  return context;
}
