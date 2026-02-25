import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BUILTIN_MAGNET_IDS,
  DEFAULT_ACTIVE_MAGNET_IDS,
  MINIMAL_ACTIVE_MAGNET_IDS,
  REQUIRED_MAGNET_IDS,
} from '../../constants/magnets';
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
import { getSystemAnchorsForActiveMagnets } from './systemLayouts';
import {
  magnetLayoutStoreApplyPatch,
  magnetLayoutStoreBootstrapFromLegacy,
  magnetLayoutStoreGetState,
  type MagnetLayoutStorePatch,
  type MagnetLayoutStoreState,
} from './layoutStore';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { readJson, usePersistentSetting } from '../storage';
import { createDefaultMagnetSpacesState, sanitizeMagnetSpacesState } from './spaces';
import { parsePerformanceRuntimeProfile } from '../../contracts/performanceControl';

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
  activeSpaceId: string;
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

const SPACE2_REQUIRED_PLATFORM_MAGNET_IDS = ['platform-magnet', 'btn-platform-login'] as const;

function resolveRuntimeDefaultActiveMagnetIds(
  fallback: ReadonlySet<string>
): ReadonlySet<string> {
  const runtimeProfile = parsePerformanceRuntimeProfile(
    readJson<unknown>(STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE, 'minimal'),
    'minimal'
  );
  return runtimeProfile === 'minimal' ? MINIMAL_ACTIVE_MAGNET_IDS : fallback;
}

function normalizeSpaceLayoutWithSystemAnchors(
  spaceId: string,
  layout: MagnetSpaceLayout
): { layout: MagnetSpaceLayout; changed: boolean } {
  const active = new Set(layout.activeMagnetIds);
  let changed = false;

  for (const id of REQUIRED_MAGNET_IDS) {
    if (active.has(id)) continue;
    active.add(id);
    changed = true;
  }

  if (spaceId === 'space2') {
    for (const id of SPACE2_REQUIRED_PLATFORM_MAGNET_IDS) {
      if (active.has(id)) continue;
      active.add(id);
      changed = true;
    }
  }

  const nextAnchorsByMagnetId: MagnetSpaceLayout['anchorsByMagnetId'] = {
    ...layout.anchorsByMagnetId,
  };

  const systemAnchors = getSystemAnchorsForActiveMagnets(spaceId, active);
  for (const [magnetId, anchors] of Object.entries(systemAnchors)) {
    const existing = nextAnchorsByMagnetId[magnetId];
    if (Array.isArray(existing) && existing.length > 0) continue;
    nextAnchorsByMagnetId[magnetId] = anchors;
    changed = true;
  }

  if (!changed) {
    return { layout, changed: false };
  }

  return {
    layout: {
      ...layout,
      activeMagnetIds: [...active],
      anchorsByMagnetId: nextAnchorsByMagnetId,
    },
    changed: true,
  };
}

export function MagnetLibraryProvider({
  children,
  gridSize,
  defaultActiveMagnetIds = DEFAULT_ACTIVE_MAGNET_IDS,
  autoSaveDebounceMs = 500,
  registerFlushHandler,
}: MagnetLibraryProviderProps) {
  const runtimeDefaultActiveMagnetIds = useMemo(
    () => resolveRuntimeDefaultActiveMagnetIds(defaultActiveMagnetIds),
    [defaultActiveMagnetIds]
  );
  const defaultMagnetLibrary = useMemo(() => createDefaultMagnetLibrary(), []);
  const builtInMagnetIds = useMemo(() => new Set(BUILTIN_MAGNET_IDS), []);
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const suppressNextAutoSaveRef = useRef(false);

  const [layoutStoreState, setLayoutStoreState] = useState<MagnetLayoutStoreState | null>(null);
  const layoutStoreRevisionRef = useRef(0);

  const defaultSpacesState = useMemo(() => createDefaultMagnetSpacesState(), []);
  const [magnetSpacesRaw] = usePersistentSetting(STORAGE_KEYS.MAGNET_SPACES, defaultSpacesState, {
    format: 'json',
  });
  const magnetSpacesFromStorage = useMemo(() => sanitizeMagnetSpacesState(magnetSpacesRaw), [magnetSpacesRaw]);
  const magnetSpaces = useMemo(() => {
    if (isTauri && layoutStoreState) return layoutStoreState.spaces;
    return magnetSpacesFromStorage;
  }, [isTauri, layoutStoreState, magnetSpacesFromStorage]);
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
    const seed = activeSpaceId === 'space1' ? runtimeDefaultActiveMagnetIds : REQUIRED_MAGNET_IDS;
    const next = new Set(seed);
    for (const id of REQUIRED_MAGNET_IDS) next.add(id);
    return next;
  }, [activeSpaceId, runtimeDefaultActiveMagnetIds]);

  const defaultCatalogState = useMemo(() => createDefaultMagnetCatalogState(), []);
  const [catalogRaw] = usePersistentSetting(STORAGE_KEYS.MAGNET_CATALOG, defaultCatalogState, {
    format: 'json',
  });
  const customMagnetsCatalog = useMemo(() => {
    return sanitizeMagnetCatalogState(catalogRaw).magnets;
  }, [catalogRaw]);

  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;

    const run = async () => {
      const bootstrapped = await magnetLayoutStoreBootstrapFromLegacy(runtimeDefaultActiveMagnetIds);
      const state = bootstrapped?.state ?? (await magnetLayoutStoreGetState());
      if (disposed || !state) return;
      layoutStoreRevisionRef.current = state.revision;
      setLayoutStoreState(state);
    };

    void run();

    return () => {
      disposed = true;
    };
  }, [isTauri, runtimeDefaultActiveMagnetIds]);

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

  const applyLayoutStorePatch = useCallback(
    async (patches: MagnetLayoutStorePatch[], reason: string): Promise<void> => {
      if (!isTauri) return;
      let expectedRevision = layoutStoreRevisionRef.current;
      const maxRetries = 2;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const attemptReason = attempt === 0 ? reason : `${reason}:retry${attempt === 1 ? '' : attempt}`;
        const response = await magnetLayoutStoreApplyPatch({ expectedRevision, patches, reason: attemptReason });
        if (!response) return;

        layoutStoreRevisionRef.current = response.state.revision;
        setLayoutStoreState(response.state);

        if (response.ok) return;
        if (response.error?.code !== 'revisionConflict') return;

        const retryRevision = response.state.revision;
        if (retryRevision <= 0 || retryRevision === expectedRevision) return;
        expectedRevision = retryRevision;
      }
    },
    [isTauri]
  );

  const reloadFromStorage = useCallback(() => {
    suppressNextAutoSaveRef.current = true;
    cancelScheduledMagnetConfigSave();
    cancelScheduledMagnetSpaceLayoutSave();

    const applySnapshot = (args: {
      activeSpaceId: string;
      spaceIds: string[];
      layout: MagnetSpaceLayout;
    }) => {
      const catalogMagnets = ensureMagnetCatalogState(args.spaceIds).state.magnets;

      const normalizedLayout = normalizeSpaceLayoutWithSystemAnchors(args.activeSpaceId, args.layout).layout;

      const activeFromLayout = new Set(normalizedLayout.activeMagnetIds);
      for (const id of REQUIRED_MAGNET_IDS) activeFromLayout.add(id);

      const configKey = resolveMagnetConfigStorageKey(args.activeSpaceId);
      const primaryConfig = loadMagnetConfig(configKey);
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
          anchors:
            normalizedLayout.anchorsByMagnetId[magnet.id] ?? existing?.anchors ?? magnet.anchors,
          isActive: activeFromLayout.has(magnet.id),
        };
      }

      const applied = applyMagnetConfig(
        { ...baseConfig, gridSize, magnets: patchedMagnets },
        defaultMagnetLibrary
      );
      const ensuredActive = new Set(applied.activeMagnetIds);
      for (const id of REQUIRED_MAGNET_IDS) ensuredActive.add(id);

      loadedConfigKeyRef.current = configKey;
      loadedLayoutKeyRef.current = resolveMagnetLayoutStorageKey(args.activeSpaceId);

      setMagnetLibrary(applied.magnetLibrary);
      setActiveMagnetIds(ensuredActive);
    };

    if (!isTauri) {
      const spaceIds = magnetSpaces.spaces.map((s) => s.id);
      const layoutResult = ensureMagnetSpaceLayout(activeSpaceId, {
        defaultActiveMagnetIds: resolvedDefaultActiveMagnetIds,
      });
      applySnapshot({ activeSpaceId, spaceIds, layout: layoutResult.layout });
      loadedLayoutKeyRef.current = layoutResult.storageKey;
      return;
    }

    void (async () => {
      const bootstrapped = await magnetLayoutStoreBootstrapFromLegacy(runtimeDefaultActiveMagnetIds);
      const store = bootstrapped?.state ?? (await magnetLayoutStoreGetState());
      if (!store) return;

      layoutStoreRevisionRef.current = store.revision;
      setLayoutStoreState(store);

      const storeSpaces = store.spaces;
      const storeActiveSpaceId = storeSpaces.activeSpaceId;
      const spaceIds = storeSpaces.spaces.map((s) => s.id);

      const defaultActiveSeed =
        storeActiveSpaceId === 'space1' ? runtimeDefaultActiveMagnetIds : REQUIRED_MAGNET_IDS;
      const resolvedActive = new Set(defaultActiveSeed);
      for (const id of REQUIRED_MAGNET_IDS) resolvedActive.add(id);

      const layout =
        store.layoutsBySpaceId[storeActiveSpaceId] ?? createDefaultMagnetSpaceLayout(storeActiveSpaceId, resolvedActive);

      const normalized = normalizeSpaceLayoutWithSystemAnchors(storeActiveSpaceId, layout);
      if (normalized.changed) {
        void applyLayoutStorePatch(
          [{ kind: 'setSpaceLayout', spaceId: storeActiveSpaceId, layout: normalized.layout }],
          'migrate:space-layout-system-anchors'
        );
      }

      applySnapshot({ activeSpaceId: storeActiveSpaceId, spaceIds, layout: normalized.layout });
    })();
  }, [
    activeSpaceId,
    applyLayoutStorePatch,
    defaultMagnetLibrary,
    gridSize,
    magnetSpaces.spaces,
    resolvedDefaultActiveMagnetIds,
    runtimeDefaultActiveMagnetIds,
    isTauri,
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
    saveMagnetConfig(magnetLibrary, activeMagnetIds, gridSize, defaultMagnetLibrary, configKey);
    const layout = buildLayoutSnapshot(magnetLibrary, activeMagnetIds);

    if (isTauri) {
      void applyLayoutStorePatch([{ kind: 'setSpaceLayout', spaceId: activeSpaceId, layout }], 'saveNow');
      return;
    }

    const layoutKey = loadedLayoutKeyRef.current;
    saveMagnetSpaceLayout(layout, layoutKey);
  }, [
    activeMagnetIds,
    activeSpaceId,
    applyLayoutStorePatch,
    buildLayoutSnapshot,
    defaultMagnetLibrary,
    gridSize,
    isTauri,
    magnetLibrary,
  ]);

  const updateMagnetAnchors = useCallback((magnetId: string, newAnchors: PixelAnchor[]) => {
    setMagnetLibrary((prev) => prev.map((m) => (m.id === magnetId ? { ...m, anchors: newAnchors } : m)));
    if (!isTauri) return;
    void applyLayoutStorePatch(
      [{ kind: 'updateMagnetAnchors', spaceId: activeSpaceId, magnetId, anchors: newAnchors }],
      'updateMagnetAnchors'
    );
  }, [activeSpaceId, applyLayoutStorePatch, isTauri]);

  const activateMagnet = useCallback((magnetId: string) => {
    setActiveMagnetIds((prev) => {
      const next = new Set(prev);
      next.add(magnetId);
      return next;
    });
    if (!isTauri) return;
    void applyLayoutStorePatch([{ kind: 'setMagnetActive', spaceId: activeSpaceId, magnetId, active: true }], 'activateMagnet');
  }, [activeSpaceId, applyLayoutStorePatch, isTauri]);

  const deactivateMagnet = useCallback((magnetId: string) => {
    if (REQUIRED_MAGNET_IDS.has(magnetId)) return;
    setActiveMagnetIds((prev) => {
      const next = new Set(prev);
      next.delete(magnetId);
      return next;
    });
    if (!isTauri) return;
    void applyLayoutStorePatch(
      [{ kind: 'setMagnetActive', spaceId: activeSpaceId, magnetId, active: false }],
      'deactivateMagnet'
    );
  }, [activeSpaceId, applyLayoutStorePatch, isTauri]);

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

    if (!isTauri) {
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
    }

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
    isTauri,
    magnetLibrary,
  ]);

  useEffect(() => {
    const loadedKey = loadedConfigKeyRef.current;
    const loadedLayoutKey = loadedLayoutKeyRef.current;
    if (loadedKey === magnetConfigStorageKey && loadedLayoutKey === magnetLayoutStorageKey) return;
    try {
      flushScheduledMagnetConfigSave();
      if (!isTauri) {
        flushScheduledMagnetSpaceLayoutSave();
      }
      saveMagnetConfig(magnetLibrary, activeMagnetIds, gridSize, defaultMagnetLibrary, loadedKey);
      if (!isTauri) {
        const layout = buildLayoutSnapshot(magnetLibrary, activeMagnetIds);
        saveMagnetSpaceLayout(layout, loadedLayoutKey);
      }
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
    isTauri,
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
    activeSpaceId,
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
