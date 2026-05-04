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
  patchMagnetStateConfigWithLayoutSnapshot,
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
  flushScheduledMagnetSpaceLayoutSave,
  saveMagnetSpaceLayout,
  scheduleSaveMagnetSpaceLayout,
  ensureMagnetSpaceLayout,
} from './layoutStorage';
import { resolveMagnetLayoutStorageKey, type MagnetSpaceLayout } from './layout';
import { getSystemAnchorsForActiveMagnets } from './systemLayouts';
import {
  magnetLayoutStoreApplyPatch,
  magnetLayoutStoreBootstrap,
  magnetLayoutStoreGetState,
  type MagnetLayoutStorePatch,
  type MagnetLayoutStoreState,
} from './layoutStore';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { readJson, usePersistentSetting } from '../storage';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { createDefaultMagnetSpacesState, sanitizeMagnetSpacesState } from './spaces';
import { createInitialMagnetSpaceTemplateLayout } from './spaceTemplates';
import { parsePerformanceRuntimeProfile } from '../../contracts/performanceControl';
import type { SpaceRuntimeGovernanceService } from '../../services/governance';
import type { RuntimeCapsuleManagerService } from '../../services/runtime-capsules';

const telemetry = getTelemetryLogger('magnets', 'MagnetLibraryProvider');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface MagnetLibraryProviderProps {
  children: ReactNode;
  gridSize: { columns: number; rows: number };
  defaultActiveMagnetIds?: ReadonlySet<string>;
  autoSaveDebounceMs?: number;
  registerFlushHandler?: (handler: () => void) => () => void;
  spaceRuntimeGovernance?: SpaceRuntimeGovernanceService | null;
  runtimeCapsuleManager?: RuntimeCapsuleManagerService | null;
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

type MagnetRuntimeAssociation = {
  spaceId: string;
  resourceId: string;
  isBackground: boolean;
  requireActivatedBackground: boolean;
};

type MagnetRuntimeCapabilityLease = {
  leaseKey: string;
  magnetId: string;
  capabilityId: string;
  spaceId: string;
};

type LoadedMagnetSpaceSnapshot = {
  activeSpaceId: string;
  magnetLibrary: Magnet[];
  activeMagnetIds: Set<string>;
  layout: MagnetSpaceLayout;
  configKey: string;
  layoutKey: string;
};

function resolveMagnetRuntimeAssociation(
  magnet: Magnet,
  activeSpaceId: string
): MagnetRuntimeAssociation | null {
  const runtime = magnet.runtime;
  if (!runtime) return null;
  if (
    runtime.memoryTier !== 'heavy' &&
    runtime.releaseOnSpaceExit !== true &&
    runtime.backgroundCapable !== true
  ) {
    return null;
  }

  const spaceId = (runtime.spaceId ?? activeSpaceId).trim();
  if (!spaceId) return null;

  const isBackground = spaceId !== activeSpaceId;
  if (isBackground && runtime.backgroundCapable !== true) {
    return null;
  }

  return {
    spaceId,
    resourceId: `magnet:${magnet.id}`,
    isBackground,
    requireActivatedBackground: runtime.backgroundAfterFirstActivationOnly !== false,
  };
}

export function MagnetLibraryProvider({
  children,
  gridSize,
  defaultActiveMagnetIds = DEFAULT_ACTIVE_MAGNET_IDS,
  autoSaveDebounceMs = 500,
  registerFlushHandler,
  spaceRuntimeGovernance = null,
  runtimeCapsuleManager = null,
}: MagnetLibraryProviderProps) {
  const runtimeDefaultActiveMagnetIds = useMemo(
    () => resolveRuntimeDefaultActiveMagnetIds(defaultActiveMagnetIds),
    [defaultActiveMagnetIds]
  );
  const defaultMagnetLibrary = useMemo(() => createDefaultMagnetLibrary(), []);
  const builtInMagnetIds = useMemo(() => new Set(BUILTIN_MAGNET_IDS), []);
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const suppressNextAutoSaveRef = useRef(false);
  const runtimeCapabilityLeaseIdsRef = useRef(new Map<string, string>());

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
  const targetActiveSpaceId = magnetSpaces.activeSpaceId;
  const [activeSpaceId, setActiveSpaceId] = useState(() => targetActiveSpaceId);

  useEffect(() => {
    if (!spaceRuntimeGovernance) return;
    const snapshot = spaceRuntimeGovernance.collectSnapshot();
    if (snapshot.activeSpaceId === activeSpaceId) return;
    spaceRuntimeGovernance.warmSpace(activeSpaceId);
    spaceRuntimeGovernance.activateSpace(activeSpaceId);
  }, [activeSpaceId, spaceRuntimeGovernance]);

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

  const resolveDefaultActiveMagnetIdsForSpace = useCallback((spaceId: string): Set<string> => {
    const seed = spaceId === 'space1' ? runtimeDefaultActiveMagnetIds : REQUIRED_MAGNET_IDS;
    const next = new Set(seed);
    for (const id of REQUIRED_MAGNET_IDS) next.add(id);
    return next;
  }, [runtimeDefaultActiveMagnetIds]);

  const resolvedDefaultActiveMagnetIds = useMemo(
    () => resolveDefaultActiveMagnetIdsForSpace(activeSpaceId),
    [activeSpaceId, resolveDefaultActiveMagnetIdsForSpace]
  );
  const activeSpaceSeedTemplateId = useMemo(
    () => magnetSpaces.spaces.find((space) => space.id === activeSpaceId)?.seedTemplateId,
    [activeSpaceId, magnetSpaces.spaces]
  );

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
      const bootstrapped = await magnetLayoutStoreBootstrap(runtimeDefaultActiveMagnetIds);
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
    const primaryConfig = loadMagnetConfig(magnetConfigStorageKey);
    const layout = ensureMagnetSpaceLayout(activeSpaceId, {
      defaultActiveMagnetIds: resolvedDefaultActiveMagnetIds,
      seedTemplateId: activeSpaceSeedTemplateId,
    }).layout;

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

  const activeRuntimeAssociations = useMemo(
    () =>
      activeMagnets
        .map((magnet) => resolveMagnetRuntimeAssociation(magnet, activeSpaceId))
        .filter((association): association is MagnetRuntimeAssociation => association !== null),
    [activeMagnets, activeSpaceId]
  );

  useEffect(() => {
    if (!spaceRuntimeGovernance || activeRuntimeAssociations.length === 0) return;

    const releases: Array<() => void> = [];
    for (const association of activeRuntimeAssociations) {
      if (
        association.isBackground &&
        association.requireActivatedBackground &&
        !spaceRuntimeGovernance.canRunBackground(association.spaceId)
      ) {
        continue;
      }

      releases.push(
        spaceRuntimeGovernance.retainSpaceAssociation(
          association.spaceId,
          association.resourceId
        )
      );
    }

    return () => {
      for (const release of releases) {
        release();
      }
    };
  }, [activeRuntimeAssociations, spaceRuntimeGovernance]);

  const activeRuntimeCapabilityLeases = useMemo<MagnetRuntimeCapabilityLease[]>(() => {
    const leases: MagnetRuntimeCapabilityLease[] = [];
    for (const magnet of activeMagnets) {
      const capabilities = magnet.runtime?.capabilities;
      if (!Array.isArray(capabilities) || capabilities.length === 0) continue;
      const spaceId = (magnet.runtime?.spaceId ?? activeSpaceId).trim();
      if (!spaceId) continue;
      for (const capabilityId of capabilities) {
        const normalizedCapabilityId = capabilityId.trim();
        if (!normalizedCapabilityId) continue;
        leases.push({
          leaseKey: ['magnet', spaceId, magnet.id, normalizedCapabilityId].join(':'),
          magnetId: magnet.id,
          capabilityId: normalizedCapabilityId,
          spaceId,
        });
      }
    }
    return leases;
  }, [activeMagnets, activeSpaceId]);

  useEffect(() => {
    if (!runtimeCapsuleManager) return;

    const desiredLeaseKeys = new Set<string>();
    for (const lease of activeRuntimeCapabilityLeases) {
      desiredLeaseKeys.add(lease.leaseKey);
      const existingLeaseId = runtimeCapabilityLeaseIdsRef.current.get(lease.leaseKey);
      if (existingLeaseId) {
        const renewed = runtimeCapsuleManager.renewLease(existingLeaseId, {
          reason: {
            spaceId: lease.spaceId,
            capabilityId: lease.capabilityId,
            detail: 'magnet runtime capability lease renewed',
          },
        });
        if (renewed) continue;
        runtimeCapabilityLeaseIdsRef.current.delete(lease.leaseKey);
      }

      const acquired = runtimeCapsuleManager.acquireLease({
        capabilityId: lease.capabilityId,
        leaseKey: lease.leaseKey,
        ownerKind: 'magnet',
        ownerId: lease.magnetId,
        reason: {
          spaceId: lease.spaceId,
          capabilityId: lease.capabilityId,
        },
      });
      if (acquired) {
        runtimeCapabilityLeaseIdsRef.current.set(lease.leaseKey, acquired.id);
      }
    }

    for (const [leaseKey, leaseId] of runtimeCapabilityLeaseIdsRef.current) {
      if (desiredLeaseKeys.has(leaseKey)) continue;
      runtimeCapsuleManager.releaseLease(leaseId, {
        kind: 'lease-expired',
        detail: 'magnet runtime capability lease released',
      });
      runtimeCapabilityLeaseIdsRef.current.delete(leaseKey);
    }
  }, [activeRuntimeCapabilityLeases, runtimeCapsuleManager]);

  useEffect(() => {
    if (!runtimeCapsuleManager) return;
    const runtimeCapabilityLeaseIds = runtimeCapabilityLeaseIdsRef.current;
    return () => {
      for (const leaseId of runtimeCapabilityLeaseIds.values()) {
        runtimeCapsuleManager.releaseLease(leaseId, {
          kind: 'lease-expired',
          detail: 'magnet runtime capability lease released',
        });
      }
      runtimeCapabilityLeaseIds.clear();
    };
  }, [runtimeCapsuleManager]);

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

  const loadTauriLayoutStoreState = useCallback(async (): Promise<MagnetLayoutStoreState | null> => {
    if (!isTauri) return null;
    const bootstrapped = await magnetLayoutStoreBootstrap(runtimeDefaultActiveMagnetIds);
    const store = bootstrapped?.state ?? (await magnetLayoutStoreGetState());
    if (!store) return null;

    layoutStoreRevisionRef.current = store.revision;
    setLayoutStoreState(store);
    return store;
  }, [isTauri, runtimeDefaultActiveMagnetIds]);

  const buildLoadedSpaceSnapshot = useCallback(
    (args: { activeSpaceId: string; layout: MagnetSpaceLayout }): LoadedMagnetSpaceSnapshot => {
      const catalogMagnets = ensureMagnetCatalogState().state.magnets;
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
      const patchedMagnets: Record<string, MagnetStateConfig> = patchMagnetStateConfigWithLayoutSnapshot({
        magnets: baseLibrary,
        currentStates: baseConfig.magnets,
        anchorsByMagnetId: normalizedLayout.anchorsByMagnetId,
        activeMagnetIds: activeFromLayout,
      });

      const baselineApplied = applyMagnetConfig(
        { ...baseConfig, gridSize, magnets: baseConfig.magnets },
        defaultMagnetLibrary
      );
      const applied = applyMagnetConfig(
        { ...baseConfig, gridSize, magnets: patchedMagnets },
        defaultMagnetLibrary
      );
      const baselineActive = new Set(baselineApplied.activeMagnetIds);
      for (const id of REQUIRED_MAGNET_IDS) baselineActive.add(id);
      const ensuredActive = new Set(applied.activeMagnetIds);
      for (const id of REQUIRED_MAGNET_IDS) ensuredActive.add(id);
      const shouldPersistNormalizedConfig =
        JSON.stringify(baselineApplied.magnetLibrary) !== JSON.stringify(applied.magnetLibrary) ||
        JSON.stringify([...baselineActive].sort()) !== JSON.stringify([...ensuredActive].sort());
      if (shouldPersistNormalizedConfig) {
        saveMagnetConfig(applied.magnetLibrary, ensuredActive, gridSize, defaultMagnetLibrary, configKey);
      }

      return {
        activeSpaceId: args.activeSpaceId,
        magnetLibrary: applied.magnetLibrary,
        activeMagnetIds: ensuredActive,
        layout: normalizedLayout,
        configKey,
        layoutKey: resolveMagnetLayoutStorageKey(args.activeSpaceId),
      };
    },
    [defaultMagnetLibrary, gridSize]
  );

  const applyLoadedSpaceSnapshot = useCallback((snapshot: LoadedMagnetSpaceSnapshot) => {
    suppressNextAutoSaveRef.current = true;
    loadedConfigKeyRef.current = snapshot.configKey;
    loadedLayoutKeyRef.current = snapshot.layoutKey;
    setMagnetLibrary(snapshot.magnetLibrary);
    setActiveMagnetIds(snapshot.activeMagnetIds);
    setActiveSpaceId(snapshot.activeSpaceId);
  }, []);

  const loadSpaceSnapshot = useCallback(
    async (
      spaceId: string,
      preloadedStore: MagnetLayoutStoreState | null = null
    ): Promise<LoadedMagnetSpaceSnapshot | null> => {
      const normalizedSpaceId = spaceId.trim();
      if (!normalizedSpaceId) return null;
      const defaultActive = resolveDefaultActiveMagnetIdsForSpace(normalizedSpaceId);
      const seedTemplateId = magnetSpaces.spaces.find(
        (space) => space.id === normalizedSpaceId
      )?.seedTemplateId;

      if (!isTauri) {
        const layoutResult = ensureMagnetSpaceLayout(normalizedSpaceId, {
          defaultActiveMagnetIds: defaultActive,
          seedTemplateId,
        });
        const normalized = normalizeSpaceLayoutWithSystemAnchors(normalizedSpaceId, layoutResult.layout);
        if (normalized.changed) {
          saveMagnetSpaceLayout(normalized.layout, layoutResult.storageKey);
        }
        return buildLoadedSpaceSnapshot({
          activeSpaceId: normalizedSpaceId,
          layout: normalized.layout,
        });
      }

      const store = preloadedStore ?? (await loadTauriLayoutStoreState());
      if (!store) return null;

      layoutStoreRevisionRef.current = store.revision;
      setLayoutStoreState(store);

      const layout =
        store.layoutsBySpaceId[normalizedSpaceId] ??
        createInitialMagnetSpaceTemplateLayout(seedTemplateId, defaultActive) ??
        createDefaultMagnetSpaceLayout(normalizedSpaceId, defaultActive);

      const normalized = normalizeSpaceLayoutWithSystemAnchors(normalizedSpaceId, layout);
      if (normalized.changed) {
        void applyLayoutStorePatch(
          [{ kind: 'setSpaceLayout', spaceId: normalizedSpaceId, layout: normalized.layout }],
          'normalize:space-layout-system-anchors'
        );
      }

      return buildLoadedSpaceSnapshot({
        activeSpaceId: normalizedSpaceId,
        layout: normalized.layout,
      });
    },
    [
      applyLayoutStorePatch,
      buildLoadedSpaceSnapshot,
      isTauri,
      loadTauriLayoutStoreState,
      magnetSpaces.spaces,
      resolveDefaultActiveMagnetIdsForSpace,
    ]
  );

  const persistLoadedMagnetState = useCallback(() => {
    const configKey = loadedConfigKeyRef.current;
    saveMagnetConfig(magnetLibrary, activeMagnetIds, gridSize, defaultMagnetLibrary, configKey);
    if (isTauri) return;

    const layout = buildLayoutSnapshot(magnetLibrary, activeMagnetIds);
    saveMagnetSpaceLayout(layout, loadedLayoutKeyRef.current);
  }, [
    activeMagnetIds,
    buildLayoutSnapshot,
    defaultMagnetLibrary,
    gridSize,
    isTauri,
    magnetLibrary,
  ]);

  const stagedSwitchRequestRef = useRef(0);
  const stagedSwitchTargetRef = useRef<string | null>(null);
  const stagedSwitchToSpace = useCallback(
    async (nextSpaceId: string, preloadedStore: MagnetLayoutStoreState | null = null): Promise<void> => {
      const normalizedNextSpaceId = nextSpaceId.trim();
      if (!normalizedNextSpaceId || normalizedNextSpaceId === activeSpaceId) return;
      if (stagedSwitchTargetRef.current === normalizedNextSpaceId) return;

      const requestId = stagedSwitchRequestRef.current + 1;
      stagedSwitchRequestRef.current = requestId;
      stagedSwitchTargetRef.current = normalizedNextSpaceId;

      cancelScheduledMagnetConfigSave();
      cancelScheduledMagnetSpaceLayoutSave();

      try {
        persistLoadedMagnetState();
      } catch (error) {
        telemetry.warn('magnets.space_switch.persist_previous.failed', {
          message: readErrorMessage(error),
          fields: {
            fromSpaceId: activeSpaceId,
            toSpaceId: normalizedNextSpaceId,
          },
        });
      }

      spaceRuntimeGovernance?.warmSpace(normalizedNextSpaceId);
      let snapshot: LoadedMagnetSpaceSnapshot | null = null;
      try {
        snapshot = await loadSpaceSnapshot(normalizedNextSpaceId, preloadedStore);
      } catch (error) {
        telemetry.warn('magnets.space_switch.load_next.failed', {
          message: readErrorMessage(error),
          fields: {
            fromSpaceId: activeSpaceId,
            toSpaceId: normalizedNextSpaceId,
          },
        });
      }
      if (!snapshot || stagedSwitchRequestRef.current !== requestId) {
        if (stagedSwitchTargetRef.current === normalizedNextSpaceId) {
          stagedSwitchTargetRef.current = null;
        }
        return;
      }

      spaceRuntimeGovernance?.activateSpace(normalizedNextSpaceId);
      applyLoadedSpaceSnapshot(snapshot);
      if (stagedSwitchTargetRef.current === normalizedNextSpaceId) {
        stagedSwitchTargetRef.current = null;
      }

      telemetry.info('magnets.space_switch.staged', {
        fields: {
          fromSpaceId: activeSpaceId,
          toSpaceId: normalizedNextSpaceId,
          activeMagnetCount: snapshot.activeMagnetIds.size,
        },
      });
    },
    [
      activeSpaceId,
      applyLoadedSpaceSnapshot,
      loadSpaceSnapshot,
      persistLoadedMagnetState,
      spaceRuntimeGovernance,
    ]
  );

  const reloadFromStorage = useCallback(() => {
    cancelScheduledMagnetConfigSave();
    cancelScheduledMagnetSpaceLayoutSave();

    if (!isTauri) {
      if (targetActiveSpaceId !== activeSpaceId) {
        void stagedSwitchToSpace(targetActiveSpaceId);
        return;
      }

      void loadSpaceSnapshot(activeSpaceId).then((snapshot) => {
        if (snapshot) applyLoadedSpaceSnapshot(snapshot);
      });
      return;
    }

    void (async () => {
      const store = await loadTauriLayoutStoreState();
      if (!store) return;

      const storeActiveSpaceId = store.spaces.activeSpaceId;
      if (storeActiveSpaceId !== activeSpaceId) {
        await stagedSwitchToSpace(storeActiveSpaceId, store);
        return;
      }

      const snapshot = await loadSpaceSnapshot(storeActiveSpaceId, store);
      if (snapshot) applyLoadedSpaceSnapshot(snapshot);
    })();
  }, [
    activeSpaceId,
    applyLoadedSpaceSnapshot,
    isTauri,
    loadSpaceSnapshot,
    loadTauriLayoutStoreState,
    stagedSwitchToSpace,
    targetActiveSpaceId,
  ]);

  const didInitialReloadRef = useRef(false);
  useEffect(() => {
    if (didInitialReloadRef.current) return;
    didInitialReloadRef.current = true;
    reloadFromStorage();
  }, [reloadFromStorage]);

  useEffect(() => {
    if (targetActiveSpaceId === activeSpaceId) return;
    void stagedSwitchToSpace(targetActiveSpaceId);
  }, [activeSpaceId, stagedSwitchToSpace, targetActiveSpaceId]);

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
      telemetry.warn('magnets.persist_before_key_switch.failed', {
        message: readErrorMessage(error),
        fields: {
          loadedKey,
          nextKey: magnetConfigStorageKey,
        },
      });
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
