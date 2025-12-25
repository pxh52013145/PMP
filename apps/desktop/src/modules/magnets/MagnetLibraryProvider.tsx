import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BUILTIN_MAGNET_IDS, DEFAULT_ACTIVE_MAGNET_IDS } from '../../constants/magnets';
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
} from './config';
import { createInitialMagnetState } from './state';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { usePersistentSetting } from '../storage';

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
  const [workbenchLayoutId] = usePersistentSetting(STORAGE_KEYS.WORKBENCH_LAYOUT_ID, '', {
    format: 'string',
  });
  const magnetConfigStorageKey = useMemo(
    () => resolveMagnetConfigStorageKey(workbenchLayoutId),
    [workbenchLayoutId]
  );

  const initialRef = useRef<ReturnType<typeof createInitialMagnetState> | null>(null);
  if (!initialRef.current) {
    initialRef.current = createInitialMagnetState(defaultMagnetLibrary, {
      defaultActiveMagnetIds,
      storageKey: magnetConfigStorageKey,
    });
  }

  const [magnetLibrary, setMagnetLibrary] = useState<Magnet[]>(() => initialRef.current!.magnetLibrary);
  const [activeMagnetIds, setActiveMagnetIds] = useState<Set<string>>(() => initialRef.current!.activeMagnetIds);

  const activeMagnets = useMemo(() => {
    return magnetLibrary.filter((m) => activeMagnetIds.has(m.id));
  }, [magnetLibrary, activeMagnetIds]);

  const reloadFromStorage = useCallback(() => {
    suppressNextAutoSaveRef.current = true;
    cancelScheduledMagnetConfigSave();
    const config =
      loadMagnetConfig(magnetConfigStorageKey) ??
      (magnetConfigStorageKey !== STORAGE_KEYS.CONFIG ? loadMagnetConfig(STORAGE_KEYS.CONFIG) : null);
    if (config) {
      const applied = applyMagnetConfig(config, defaultMagnetLibrary);
      setMagnetLibrary(applied.magnetLibrary);
      setActiveMagnetIds(applied.activeMagnetIds);
      return;
    }

    const fallback = createInitialMagnetState(defaultMagnetLibrary, { defaultActiveMagnetIds });
    setMagnetLibrary(fallback.magnetLibrary);
    setActiveMagnetIds(fallback.activeMagnetIds);
  }, [defaultActiveMagnetIds, defaultMagnetLibrary, magnetConfigStorageKey]);

  const saveNow = useCallback(() => {
    cancelScheduledMagnetConfigSave();
    saveMagnetConfig(magnetLibrary, activeMagnetIds, gridSize, defaultMagnetLibrary, magnetConfigStorageKey);
  }, [activeMagnetIds, defaultMagnetLibrary, gridSize, magnetLibrary, magnetConfigStorageKey]);

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
    setActiveMagnetIds((prev) => {
      const next = new Set(prev);
      next.delete(magnetId);
      return next;
    });
  }, []);

  useEffect(() => {
    void broadcastDataUpdate(STORAGE_KEYS.BUILTIN_MAGNETS, [...builtInMagnetIds]);
  }, [builtInMagnetIds]);

  useEffect(() => {
    if (suppressNextAutoSaveRef.current) {
      suppressNextAutoSaveRef.current = false;
      return;
    }

    scheduleSaveMagnetConfig(magnetLibrary, activeMagnetIds, gridSize, defaultMagnetLibrary, {
      debounceMs: autoSaveDebounceMs,
      storageKey: magnetConfigStorageKey,
      afterSave: () => {
        if (!isTauriRuntime()) return;
        void broadcastSignal(TAURI_EVENTS.MAGNET_LIBRARY_UPDATED);
      },
    });
  }, [
    activeMagnetIds,
    autoSaveDebounceMs,
    defaultMagnetLibrary,
    gridSize,
    magnetConfigStorageKey,
    magnetLibrary,
  ]);

  const lastConfigKeyRef = useRef(magnetConfigStorageKey);
  useEffect(() => {
    const previousKey = lastConfigKeyRef.current;
    if (previousKey === magnetConfigStorageKey) return;

    try {
      flushScheduledMagnetConfigSave();
      saveMagnetConfig(magnetLibrary, activeMagnetIds, gridSize, defaultMagnetLibrary, previousKey);
    } catch (error) {
      console.warn(`[magnets] Failed to persist config before switching key "${previousKey}"`, error);
    }

    lastConfigKeyRef.current = magnetConfigStorageKey;
    reloadFromStorage();
  }, [
    activeMagnetIds,
    defaultMagnetLibrary,
    gridSize,
    magnetConfigStorageKey,
    magnetLibrary,
    reloadFromStorage,
  ]);

  useEffect(() => {
    if (!registerFlushHandler) return;
    return registerFlushHandler(() => {
      flushScheduledMagnetConfigSave();
    });
  }, [registerFlushHandler]);

  useEffect(() => {
    return () => {
      flushScheduledMagnetConfigSave();
    };
  }, []);

  useEffect(() => {
    const cleanupPromise = setupConfigSync(
      [magnetConfigStorageKey],
      [TAURI_EVENTS.MAGNET_LIBRARY_UPDATED, TAURI_EVENTS.MAGNET_ACTIVATED, TAURI_EVENTS.MAGNET_DEACTIVATED],
      reloadFromStorage
    );
    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [magnetConfigStorageKey, reloadFromStorage]);

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
