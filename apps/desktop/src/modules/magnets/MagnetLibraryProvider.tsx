import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BUILTIN_MAGNET_IDS, DEFAULT_ACTIVE_MAGNET_IDS } from '../../constants/magnets';
import { STORAGE_KEYS, TAURI_EVENTS, broadcastDataUpdate, setupConfigSync } from '../../utils/windowCommunication';
import type { Magnet, PixelAnchor } from '../../types/pixel';
import { createDefaultMagnetLibrary } from './defaultLibrary';
import {
  applyMagnetConfig,
  cancelScheduledMagnetConfigSave,
  loadMagnetConfig,
  saveMagnetConfig,
  scheduleSaveMagnetConfig,
} from './config';
import { createInitialMagnetState } from './state';

export interface MagnetLibraryProviderProps {
  children: ReactNode;
  gridSize: { columns: number; rows: number };
  defaultActiveMagnetIds?: ReadonlySet<string>;
  autoSaveDebounceMs?: number;
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
}: MagnetLibraryProviderProps) {
  const defaultMagnetLibrary = useMemo(() => createDefaultMagnetLibrary(), []);
  const builtInMagnetIds = useMemo(() => new Set(BUILTIN_MAGNET_IDS), []);

  const initialize = useCallback(() => {
    return createInitialMagnetState(defaultMagnetLibrary, { defaultActiveMagnetIds });
  }, [defaultMagnetLibrary, defaultActiveMagnetIds]);

  const [magnetLibrary, setMagnetLibrary] = useState<Magnet[]>(() => initialize().magnetLibrary);
  const [activeMagnetIds, setActiveMagnetIds] = useState<Set<string>>(() => initialize().activeMagnetIds);

  const activeMagnets = useMemo(() => {
    return magnetLibrary.filter((m) => activeMagnetIds.has(m.id));
  }, [magnetLibrary, activeMagnetIds]);

  const reloadFromStorage = useCallback(() => {
    cancelScheduledMagnetConfigSave();
    const config = loadMagnetConfig();
    if (config) {
      const applied = applyMagnetConfig(config, defaultMagnetLibrary);
      setMagnetLibrary(applied.magnetLibrary);
      setActiveMagnetIds(applied.activeMagnetIds);
      return;
    }

    const fallback = createInitialMagnetState(defaultMagnetLibrary, { defaultActiveMagnetIds });
    setMagnetLibrary(fallback.magnetLibrary);
    setActiveMagnetIds(fallback.activeMagnetIds);
  }, [defaultActiveMagnetIds, defaultMagnetLibrary]);

  const saveNow = useCallback(() => {
    cancelScheduledMagnetConfigSave();
    saveMagnetConfig(magnetLibrary, activeMagnetIds, gridSize, defaultMagnetLibrary);
  }, [activeMagnetIds, defaultMagnetLibrary, gridSize, magnetLibrary]);

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
    scheduleSaveMagnetConfig(magnetLibrary, activeMagnetIds, gridSize, defaultMagnetLibrary, {
      debounceMs: autoSaveDebounceMs,
    });
    return () => cancelScheduledMagnetConfigSave();
  }, [activeMagnetIds, autoSaveDebounceMs, defaultMagnetLibrary, gridSize, magnetLibrary]);

  useEffect(() => {
    const cleanupPromise = setupConfigSync(
      [STORAGE_KEYS.CONFIG],
      [TAURI_EVENTS.MAGNET_LIBRARY_UPDATED, TAURI_EVENTS.MAGNET_ACTIVATED, TAURI_EVENTS.MAGNET_DEACTIVATED],
      reloadFromStorage
    );
    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [reloadFromStorage]);

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
