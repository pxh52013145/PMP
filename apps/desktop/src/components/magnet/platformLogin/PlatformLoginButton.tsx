import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Disc3,
  LogOut,
  MoreHorizontal,
  Music,
  Plus,
  QrCode,
  RefreshCw,
  Tv,
  X,
} from 'lucide-react';

import { CollisionAwarePopup } from '../../core/CollisionAwarePopup';
import { useT } from '../../../i18n';
import {
  beginPlatformQrLogin,
  clearPlatformConnectorCookies,
  getPlatformConnectorAuthSnapshot,
  listBuiltinPlatformCompatRegistrations,
  listPlatformConnectorAuthSnapshots,
  listPlatformConnectorDefinitions,
  listPlatformInstances,
  listPlatformRenderSelections,
  logoutPlatformConnector,
  pollPlatformQrLogin,
  reconcileBuiltinPlatformCompatRegistrations,
  setPlatformRenderSelectionMounted,
  subscribePlatformConnectorAuthChanged,
  subscribePlatformInstances,
  subscribePlatformRenderSelections,
  type PlatformConnectorAuthSnapshot,
  type PlatformConnectorDefinition,
  type PlatformConnectorId,
  type PlatformInstanceRecord,
  type PlatformQrLoginPollResult,
  type PlatformQrLoginSession,
  type PlatformRenderSelectionRecord,
  type PlatformCompatContractFile,
  persistPlatformLoginRegistry,
  readPlatformLoginRegistry,
  removePlatformLoginRegistryEntry,
  subscribePlatformLoginRegistry,
  upsertPlatformLoginRegistryEntry,
  type PlatformLoginRegistryEntry,
} from '../../../modules/music-platform';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';
import { buildMagnetVariantRenderers } from '../shared/magnetVariantCatalog';
import {
  PLATFORM_LOGIN_DEFAULT_QR_AUTO_POLL_INTERVAL_MS,
  PLATFORM_LOGIN_VARIANT_PRESETS,
  parsePlatformLoginSkinProps,
} from './platformLoginSkin';
import './PlatformLoginButton.css';

type PlatformLoginButtonRendererProps = {
  skinProps?: Record<string, unknown>;
};

type ManagedConnectorState = 'active' | 'inactive' | 'pending' | 'unauthorized' | 'disabled';

type ConnectorVisualMeta = {
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
};

type ContextMenuState = {
  connectorId: PlatformConnectorId;
  x: number;
  y: number;
} | null;

const CONNECTOR_VISUAL_META: Partial<Record<PlatformConnectorId, ConnectorVisualMeta>> = {
  'connector.platform.netease': { Icon: Disc3, color: '#ff6b87' },
  'connector.platform.bilibili': { Icon: Tv, color: '#67c7ff' },
  'connector.platform.qqmusic': { Icon: Music, color: '#56db8d' },
};

function toAuthLabelKey(authState: string): string {
  const normalized = authState.trim().toLowerCase();
  switch (normalized) {
    case 'pending':
    case 'authorized':
    case 'expired':
    case 'revoked':
    case 'error':
      return `magnet.platform-login.auth.${normalized}`;
    default:
      return 'magnet.platform-login.auth.unauthorized';
  }
}

function toAvailabilityLabelKey(availability: string): string {
  const normalized = availability.trim().toLowerCase();
  switch (normalized) {
    case 'available':
    case 'degraded':
    case 'unavailable':
      return `magnet.platform-login.availability.${normalized}`;
    default:
      return 'magnet.platform-login.availability.unknown';
  }
}

function isTerminalPollState(result: PlatformQrLoginPollResult | null): boolean {
  if (!result) return false;
  const normalized = result.state.trim().toLowerCase();
  return normalized === 'authorized' || normalized === 'expired' || normalized === 'failed';
}

function resolvePreferredConnectorId(
  requestedConnectorId: string | undefined,
  definitions: PlatformConnectorDefinition[]
): PlatformConnectorId | null {
  if (definitions.length === 0) return null;
  if (!requestedConnectorId) return definitions[0]?.connectorId ?? null;

  const normalizedRequested = requestedConnectorId.trim().toLowerCase();
  const exactMatch =
    definitions.find((definition) => definition.connectorId.trim().toLowerCase() === normalizedRequested)
      ?.connectorId ??
    definitions.find((definition) =>
      definition.connectorId.trim().toLowerCase().endsWith(`.${normalizedRequested}`)
    )?.connectorId;

  return exactMatch ?? definitions[0]?.connectorId ?? null;
}

function updateConnectorScopedValue<TRecord extends Record<string, unknown>>(
  setter: React.Dispatch<React.SetStateAction<TRecord>>,
  connectorId: string,
  value: TRecord[string]
): void {
  setter((prev) => ({
    ...prev,
    [connectorId]: value,
  } as TRecord));
}

function getConnectorVisualMeta(definition: PlatformConnectorDefinition): ConnectorVisualMeta {
  return CONNECTOR_VISUAL_META[definition.connectorId] ?? { Icon: Music, color: '#a1a1aa' };
}

function resolveManagedConnectorState(
  definition: PlatformConnectorDefinition,
  snapshot: PlatformConnectorAuthSnapshot | null | undefined,
  renderSelection?: PlatformRenderSelectionRecord | null
): ManagedConnectorState {
  if (!definition.enabled || definition.authFlow !== 'qr') return 'disabled';
  const normalized = snapshot?.authState?.trim().toLowerCase() ?? 'unauthorized';
  if (normalized === 'pending') return 'pending';
  if (normalized === 'authorized') {
    return renderSelection?.mounted ? 'active' : 'inactive';
  }
  return 'unauthorized';
}

function resolveStateHintKey(state: ManagedConnectorState): string {
  switch (state) {
    case 'active':
      return 'magnet.platform-login.tip.active';
    case 'inactive':
      return 'magnet.platform-login.tip.inactive';
    case 'pending':
      return 'magnet.platform-login.tip.pending';
    case 'disabled':
      return 'magnet.platform-login.tip.disabled';
    default:
      return 'magnet.platform-login.tip.unauthorized';
  }
}

function listCapabilityLabelKeys(contract: PlatformCompatContractFile | null): string[] {
  if (!contract) return [];

  const capabilityLabelKeys: string[] = [];
  if (contract.capabilities.playlists) {
    capabilityLabelKeys.push('magnet.platform.compat.capability.playlists');
  }
  if (contract.capabilities.favorites) {
    capabilityLabelKeys.push('magnet.platform.compat.capability.favorites');
  }
  if (contract.capabilities.dailyRecommendations) {
    capabilityLabelKeys.push('magnet.platform.compat.capability.dailyRecommendations');
  }
  if (contract.capabilities.search) {
    capabilityLabelKeys.push('magnet.platform.compat.capability.search');
  }
  if (contract.capabilities.quality) {
    capabilityLabelKeys.push('magnet.platform.compat.capability.quality');
  }
  if (contract.capabilities.pages) {
    capabilityLabelKeys.push('magnet.platform.compat.capability.pages');
  }

  return capabilityLabelKeys;
}

function ConnectorGlyph({
  definition,
  compact = false,
}: {
  definition: PlatformConnectorDefinition;
  compact?: boolean;
}): JSX.Element {
  const { Icon, color } = getConnectorVisualMeta(definition);
  return <Icon className={compact ? 'platform-login-glyph platform-login-glyph--compact' : 'platform-login-glyph'} style={{ color }} />;
}

const PlatformLoginButtonDefaultRenderer: React.FC<PlatformLoginButtonRendererProps> = ({
  skinProps: rawSkinProps,
}) => {
  const skinProps = useMemo(() => parsePlatformLoginSkinProps(rawSkinProps), [rawSkinProps]);
  const t = useT();

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const stripPopupRef = useRef<HTMLDivElement | null>(null);
  const authPopupRef = useRef<HTMLDivElement | null>(null);
  const registerPopupRef = useRef<HTMLDivElement | null>(null);
  const contextPopupRef = useRef<HTMLDivElement | null>(null);
  const contextAnchorRef = useRef<HTMLDivElement | null>(null);
  const connectorButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const [stripOpen, setStripOpen] = useState(false);
  const [registerMenuOpen, setRegisterMenuOpen] = useState(false);
  const [authPopupOpen, setAuthPopupOpen] = useState(false);
  const [selectedConnectorId, setSelectedConnectorId] = useState<PlatformConnectorId | null>(null);
  const [contextMenuState, setContextMenuState] = useState<ContextMenuState>(null);
  const [busyConnectorId, setBusyConnectorId] = useState<string | null>(null);

  const platformDefinitions = useMemo(() => listPlatformConnectorDefinitions(), []);
  const builtinCompatRegistrations = useMemo(() => listBuiltinPlatformCompatRegistrations(), []);
  const preferredConnectorId = useMemo(
    () => resolvePreferredConnectorId(skinProps.defaultConnectorId, platformDefinitions),
    [platformDefinitions, skinProps.defaultConnectorId]
  );
  const platformDefinitionsById = useMemo(
    () => new Map(platformDefinitions.map((definition) => [definition.connectorId, definition])),
    [platformDefinitions]
  );
  const builtinCompatByConnectorId = useMemo(
    () => new Map(builtinCompatRegistrations.map((registration) => [registration.connectorId, registration])),
    [builtinCompatRegistrations]
  );

  const [registryEntries, setRegistryEntries] = useState<PlatformLoginRegistryEntry[]>(() =>
    readPlatformLoginRegistry(platformDefinitions, preferredConnectorId)
  );
  const [platformInstances, setPlatformInstances] = useState<PlatformInstanceRecord[]>(() =>
    listPlatformInstances()
  );
  const [renderSelections, setRenderSelections] = useState<PlatformRenderSelectionRecord[]>(() =>
    listPlatformRenderSelections()
  );

  const [authSnapshotsByConnectorId, setAuthSnapshotsByConnectorId] = useState<Record<string, PlatformConnectorAuthSnapshot | null>>({});
  const [qrSessionsByConnectorId, setQrSessionsByConnectorId] = useState<Record<string, PlatformQrLoginSession | null>>({});
  const [pollResultsByConnectorId, setPollResultsByConnectorId] = useState<Record<string, PlatformQrLoginPollResult | null>>({});
  const [errorsByConnectorId, setErrorsByConnectorId] = useState<Record<string, string | null>>({});
  const [statusMessagesByConnectorId, setStatusMessagesByConnectorId] = useState<Record<string, string | null>>({});

  const syncRegisteredContracts = useCallback((entries: PlatformLoginRegistryEntry[]) => {
    reconcileBuiltinPlatformCompatRegistrations(
      entries.filter((entry) => entry.enabled !== false).map((entry) => entry.connectorId)
    );
  }, []);

  const persistRegistryState = useCallback(
    (updater: (prev: PlatformLoginRegistryEntry[]) => PlatformLoginRegistryEntry[]) => {
      setRegistryEntries((prev) => {
        const next = updater(prev);
        syncRegisteredContracts(next);
        void persistPlatformLoginRegistry(next);
        return next;
      });
    },
    [syncRegisteredContracts]
  );

  const refreshRegistryState = useCallback(() => {
    const nextRegistryEntries = readPlatformLoginRegistry(platformDefinitions, preferredConnectorId);
    syncRegisteredContracts(nextRegistryEntries);
    setRegistryEntries(nextRegistryEntries);
  }, [platformDefinitions, preferredConnectorId, syncRegisteredContracts]);

  useEffect(() => {
    refreshRegistryState();
  }, [refreshRegistryState]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe = () => {};

    void subscribePlatformLoginRegistry(() => {
      if (!disposed) {
        refreshRegistryState();
      }
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
        return;
      }
      unsubscribe = cleanup;
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [refreshRegistryState]);

  const refreshAuthSnapshot = useCallback(async (connectorId: PlatformConnectorId) => {
    const snapshot = await getPlatformConnectorAuthSnapshot(connectorId);
    updateConnectorScopedValue(setAuthSnapshotsByConnectorId, connectorId, snapshot);
    return snapshot;
  }, []);

  const refreshAllAuthSnapshots = useCallback(async () => {
    const snapshots = await listPlatformConnectorAuthSnapshots();
    setAuthSnapshotsByConnectorId((prev) => {
      const next = { ...prev };
      for (const snapshot of snapshots) {
        next[snapshot.connectorId] = snapshot;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    void refreshAllAuthSnapshots();

    const unsubscribe = subscribePlatformConnectorAuthChanged((snapshot) => {
      updateConnectorScopedValue(setAuthSnapshotsByConnectorId, snapshot.connectorId, snapshot);
    });

    return () => {
      unsubscribe();
    };
  }, [refreshAllAuthSnapshots]);

  useEffect(() => {
    setPlatformInstances(listPlatformInstances());
    return subscribePlatformInstances((instances) => {
      setPlatformInstances(instances);
    });
  }, []);

  useEffect(() => {
    setRenderSelections(listPlatformRenderSelections());
    return subscribePlatformRenderSelections((records) => {
      setRenderSelections(records);
    });
  }, []);

  const platformInstancesByConnectorId = useMemo(() => {
    const next = new Map<string, PlatformInstanceRecord>();
    for (const instance of platformInstances) {
      const connectorId =
        typeof instance.metadata?.connectorId === 'string' ? instance.metadata.connectorId : '';
      if (!connectorId) continue;
      next.set(connectorId, instance);
    }
    return next;
  }, [platformInstances]);

  const renderSelectionsByInstanceId = useMemo(
    () => new Map(renderSelections.map((record) => [record.instanceId, record])),
    [renderSelections]
  );

  const registeredConnectors = useMemo(
    () =>
      registryEntries
        .map((entry) => {
          const definition = platformDefinitionsById.get(entry.connectorId);
          if (!definition) return null;
          const instance = platformInstancesByConnectorId.get(entry.connectorId) ?? null;
          const renderSelection = instance
            ? renderSelectionsByInstanceId.get(instance.instanceId) ?? null
            : null;
          return {
            entry,
            definition,
            snapshot: authSnapshotsByConnectorId[entry.connectorId] ?? null,
            instance,
            renderSelection,
            builtinCompat: builtinCompatByConnectorId.get(entry.connectorId) ?? null,
          };
        })
        .filter(
          (
            item
          ): item is {
            entry: PlatformLoginRegistryEntry;
            definition: PlatformConnectorDefinition;
            snapshot: PlatformConnectorAuthSnapshot | null;
            instance: PlatformInstanceRecord | null;
            renderSelection: PlatformRenderSelectionRecord | null;
            builtinCompat: (typeof builtinCompatRegistrations)[number] | null;
          } => Boolean(item)
        ),
    [
      authSnapshotsByConnectorId,
      builtinCompatByConnectorId,
      platformDefinitionsById,
      platformInstancesByConnectorId,
      registryEntries,
      renderSelectionsByInstanceId,
    ]
  );

  const unregisteredDefinitions = useMemo(() => {
    const registeredIds = new Set(registryEntries.map((entry) => entry.connectorId));
    return platformDefinitions.filter((definition) => !registeredIds.has(definition.connectorId));
  }, [platformDefinitions, registryEntries]);

  const activeConnectorDefinition = selectedConnectorId
    ? platformDefinitionsById.get(selectedConnectorId) ?? null
    : null;
  const activeAuthSnapshot =
    (selectedConnectorId ? authSnapshotsByConnectorId[selectedConnectorId] : null) ?? null;
  const activeQrSession =
    (selectedConnectorId ? qrSessionsByConnectorId[selectedConnectorId] : null) ?? null;
  const activePollResult =
    (selectedConnectorId ? pollResultsByConnectorId[selectedConnectorId] : null) ?? null;
  const activeError = (selectedConnectorId ? errorsByConnectorId[selectedConnectorId] : null) ?? null;
  const activeStatusMessage =
    (selectedConnectorId ? statusMessagesByConnectorId[selectedConnectorId] : null) ?? null;
  const activeBusy = selectedConnectorId ? busyConnectorId === selectedConnectorId : false;

  const setBuiltinConnectorMounted = useCallback(
    (connectorId: PlatformConnectorId, mounted: boolean) => {
      const builtinRegistration = builtinCompatByConnectorId.get(connectorId);
      if (!builtinRegistration) return;

      setPlatformRenderSelectionMounted(`${builtinRegistration.platformId}:builtin`, mounted);
      updateConnectorScopedValue(
        setStatusMessagesByConnectorId,
        connectorId,
        t(mounted ? 'magnet.platform-login.tip.active' : 'magnet.platform-login.tip.inactive')
      );
    },
    [builtinCompatByConnectorId, t]
  );

  useEffect(() => {
    if (!selectedConnectorId) {
      setSelectedConnectorId(preferredConnectorId);
      return;
    }

    if (registryEntries.some((entry) => entry.connectorId === selectedConnectorId)) return;

    setSelectedConnectorId(registryEntries[0]?.connectorId ?? preferredConnectorId ?? null);
    setAuthPopupOpen(false);
    setContextMenuState(null);
  }, [preferredConnectorId, registryEntries, selectedConnectorId]);

  useEffect(() => {
    for (const item of registeredConnectors) {
      if (authSnapshotsByConnectorId[item.entry.connectorId] !== undefined) continue;
      void refreshAuthSnapshot(item.entry.connectorId);
    }
  }, [authSnapshotsByConnectorId, refreshAuthSnapshot, registeredConnectors]);

  const closeMenus = useCallback(() => {
    setRegisterMenuOpen(false);
    setAuthPopupOpen(false);
    setContextMenuState(null);
  }, []);

  const closeAll = useCallback(() => {
    closeMenus();
    setStripOpen(false);
  }, [closeMenus]);

  useEffect(() => {
    if (!stripOpen && !registerMenuOpen && !authPopupOpen && !contextMenuState) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (stripPopupRef.current?.contains(target)) return;
      if (registerPopupRef.current?.contains(target)) return;
      if (authPopupRef.current?.contains(target)) return;
      if (contextPopupRef.current?.contains(target)) return;
      if (contextAnchorRef.current?.contains(target)) return;
      closeAll();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAll();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [authPopupOpen, closeAll, contextMenuState, registerMenuOpen, stripOpen]);

  const setConnectorRegistered = useCallback(
    (connectorId: PlatformConnectorId, enabled: boolean) => {
      persistRegistryState((prev) => upsertPlatformLoginRegistryEntry(prev, connectorId, enabled));
    },
    [persistRegistryState]
  );

  const removeConnectorRegistration = useCallback(
    (connectorId: PlatformConnectorId) => {
      persistRegistryState((prev) => removePlatformLoginRegistryEntry(prev, connectorId));
      updateConnectorScopedValue(
        setStatusMessagesByConnectorId,
        connectorId,
        t('magnet.platform-login.status.registrationRemoved')
      );
      if (selectedConnectorId === connectorId) {
        setAuthPopupOpen(false);
        setContextMenuState(null);
      }
    },
    [persistRegistryState, selectedConnectorId, t]
  );

  const openAuthPopup = useCallback((connectorId: PlatformConnectorId) => {
    setStripOpen(true);
    setRegisterMenuOpen(false);
    setContextMenuState(null);
    setSelectedConnectorId(connectorId);
    setAuthPopupOpen(true);
  }, []);

  const handleToggleStrip = useCallback(() => {
    setStripOpen((prev) => {
      const next = !prev;
      if (next) {
        if (skinProps.openAuthOnTrigger && preferredConnectorId) {
          setSelectedConnectorId(preferredConnectorId);
          setAuthPopupOpen(true);
        }
        return true;
      }

      closeMenus();
      return false;
    });
  }, [closeMenus, preferredConnectorId, skinProps.openAuthOnTrigger]);

  const handleConnectorActivate = useCallback(
    (definition: PlatformConnectorDefinition) => {
      const snapshot = authSnapshotsByConnectorId[definition.connectorId] ?? null;
      const instance = platformInstancesByConnectorId.get(definition.connectorId) ?? null;
      const renderSelection = instance
        ? renderSelectionsByInstanceId.get(instance.instanceId) ?? null
        : null;
      const state = resolveManagedConnectorState(definition, snapshot, renderSelection);

      if (state === 'disabled') {
        updateConnectorScopedValue(
          setStatusMessagesByConnectorId,
          definition.connectorId,
          t('magnet.platform-login.status.comingSoon')
        );
        return;
      }

      openAuthPopup(definition.connectorId);
    },
    [
      authSnapshotsByConnectorId,
      openAuthPopup,
      platformInstancesByConnectorId,
      renderSelectionsByInstanceId,
      t,
    ]
  );

  const handleConnectorContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, connectorId: PlatformConnectorId) => {
      event.preventDefault();
      setStripOpen(true);
      setRegisterMenuOpen(false);
      setAuthPopupOpen(false);
      setSelectedConnectorId(connectorId);
      setContextMenuState({
        connectorId,
        x: event.clientX,
        y: event.clientY,
      });
    },
    []
  );

  const handleRegisterMenuToggle = useCallback(() => {
    setStripOpen(true);
    setAuthPopupOpen(false);
    setContextMenuState(null);
    setRegisterMenuOpen((prev) => !prev);
  }, []);

  const handleRegisterConnector = useCallback(
    async (definition: PlatformConnectorDefinition) => {
      if (!definition.enabled || definition.authFlow !== 'qr') {
        updateConnectorScopedValue(
          setStatusMessagesByConnectorId,
          definition.connectorId,
          t('magnet.platform-login.status.comingSoon')
        );
        return;
      }

      const existingSnapshot =
        authSnapshotsByConnectorId[definition.connectorId] ?? (await refreshAuthSnapshot(definition.connectorId));

      setConnectorRegistered(definition.connectorId, true);
      if (existingSnapshot?.authState === 'authorized') {
        setBuiltinConnectorMounted(definition.connectorId, true);
      } else {
        updateConnectorScopedValue(
          setStatusMessagesByConnectorId,
          definition.connectorId,
          t('magnet.platform-login.status.registrationAdded')
        );
      }
      setRegisterMenuOpen(false);

      if (existingSnapshot?.authState !== 'authorized') {
        openAuthPopup(definition.connectorId);
      }
    },
    [
      authSnapshotsByConnectorId,
      openAuthPopup,
      refreshAuthSnapshot,
      setBuiltinConnectorMounted,
      setConnectorRegistered,
      t,
    ]
  );

  const runPoll = useCallback(
    async (connectorId: PlatformConnectorId, sessionId?: string) => {
      const targetSessionId = (sessionId ?? qrSessionsByConnectorId[connectorId]?.sessionId ?? '').trim();
      if (!targetSessionId || busyConnectorId) return;

      setBusyConnectorId(connectorId);
      try {
        const result = await pollPlatformQrLogin(connectorId, targetSessionId);
        updateConnectorScopedValue(setPollResultsByConnectorId, connectorId, result);
        updateConnectorScopedValue(setErrorsByConnectorId, connectorId, null);

        if (!result) {
          updateConnectorScopedValue(
            setErrorsByConnectorId,
            connectorId,
            t('magnet.platform-login.error.pollFailed')
          );
          return;
        }

        if (result.authState === 'authorized') {
          setConnectorRegistered(connectorId, true);
          setBuiltinConnectorMounted(connectorId, true);
          updateConnectorScopedValue(
            setStatusMessagesByConnectorId,
            connectorId,
            t('magnet.platform-login.status.authorized', {
              accountUid: result.accountUid ?? '-',
            })
          );
          updateConnectorScopedValue(setQrSessionsByConnectorId, connectorId, null);
          await refreshAuthSnapshot(connectorId);
          return;
        }

        if (isTerminalPollState(result)) {
          updateConnectorScopedValue(setQrSessionsByConnectorId, connectorId, null);
          updateConnectorScopedValue(
            setStatusMessagesByConnectorId,
            connectorId,
            t('magnet.platform-login.status.pollState', {
              state: result.state,
              message: result.stateMessage,
            })
          );
          await refreshAuthSnapshot(connectorId);
        }
      } catch (error) {
        updateConnectorScopedValue(
          setErrorsByConnectorId,
          connectorId,
          error instanceof Error ? error.message : t('magnet.platform-login.error.pollFailed')
        );
      } finally {
        setBusyConnectorId(null);
      }
    },
    [
      busyConnectorId,
      qrSessionsByConnectorId,
      refreshAuthSnapshot,
      setBuiltinConnectorMounted,
      setConnectorRegistered,
      t,
    ]
  );

  useEffect(() => {
    if (!authPopupOpen || !selectedConnectorId || !activeQrSession?.sessionId) return;

    const timer = window.setInterval(() => {
      void runPoll(selectedConnectorId, activeQrSession.sessionId);
    }, skinProps.qrAutoPollIntervalMs || PLATFORM_LOGIN_DEFAULT_QR_AUTO_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeQrSession?.sessionId, authPopupOpen, runPoll, selectedConnectorId, skinProps.qrAutoPollIntervalMs]);

  const handleGenerateQr = useCallback(async () => {
    if (!selectedConnectorId || activeBusy) return;
    setBusyConnectorId(selectedConnectorId);

    try {
      const session = await beginPlatformQrLogin(selectedConnectorId);
      if (!session) {
        updateConnectorScopedValue(
          setErrorsByConnectorId,
          selectedConnectorId,
          t('magnet.platform-login.error.generateFailed')
        );
        return;
      }

      updateConnectorScopedValue(setQrSessionsByConnectorId, selectedConnectorId, session);
      updateConnectorScopedValue(setPollResultsByConnectorId, selectedConnectorId, null);
      updateConnectorScopedValue(setErrorsByConnectorId, selectedConnectorId, null);
      updateConnectorScopedValue(
        setStatusMessagesByConnectorId,
        selectedConnectorId,
        t('magnet.platform-login.status.generated')
      );
      await refreshAuthSnapshot(selectedConnectorId);
    } catch (error) {
      updateConnectorScopedValue(
        setErrorsByConnectorId,
        selectedConnectorId,
        error instanceof Error ? error.message : t('magnet.platform-login.error.generateFailed')
      );
    } finally {
      setBusyConnectorId(null);
    }
  }, [activeBusy, refreshAuthSnapshot, selectedConnectorId, t]);

  const handleRefreshConnector = useCallback(
    async (connectorId: PlatformConnectorId) => {
      if (busyConnectorId) return;
      setBusyConnectorId(connectorId);
      try {
        await refreshAuthSnapshot(connectorId);
        updateConnectorScopedValue(
          setStatusMessagesByConnectorId,
          connectorId,
          t('magnet.platform-login.status.refreshed')
        );
      } catch (error) {
        updateConnectorScopedValue(
          setErrorsByConnectorId,
          connectorId,
          error instanceof Error ? error.message : t('magnet.platform-login.error.refreshFailed')
        );
      } finally {
        setBusyConnectorId(null);
      }
    },
    [busyConnectorId, refreshAuthSnapshot, t]
  );

  const handleLogout = useCallback(
    async (connectorId: PlatformConnectorId) => {
      if (busyConnectorId) return;
      setBusyConnectorId(connectorId);

      try {
        const snapshot = await logoutPlatformConnector(connectorId);
        updateConnectorScopedValue(setAuthSnapshotsByConnectorId, connectorId, snapshot);
        updateConnectorScopedValue(setQrSessionsByConnectorId, connectorId, null);
        updateConnectorScopedValue(setPollResultsByConnectorId, connectorId, null);
        updateConnectorScopedValue(setErrorsByConnectorId, connectorId, null);
        updateConnectorScopedValue(
          setStatusMessagesByConnectorId,
          connectorId,
          t('magnet.platform-login.status.loggedOut')
        );
      } catch (error) {
        updateConnectorScopedValue(
          setErrorsByConnectorId,
          connectorId,
          error instanceof Error ? error.message : t('magnet.platform-login.error.logoutFailed')
        );
      } finally {
        setBusyConnectorId(null);
      }
    },
    [busyConnectorId, t]
  );

  const handleClearCookies = useCallback(
    async (connectorId: PlatformConnectorId) => {
      if (busyConnectorId) return;
      setBusyConnectorId(connectorId);

      try {
        const snapshot = await clearPlatformConnectorCookies(connectorId);
        updateConnectorScopedValue(setAuthSnapshotsByConnectorId, connectorId, snapshot);
        updateConnectorScopedValue(setQrSessionsByConnectorId, connectorId, null);
        updateConnectorScopedValue(setPollResultsByConnectorId, connectorId, null);
        updateConnectorScopedValue(setErrorsByConnectorId, connectorId, null);
        updateConnectorScopedValue(
          setStatusMessagesByConnectorId,
          connectorId,
          t('magnet.platform-login.status.cookiesCleared')
        );
      } catch (error) {
        updateConnectorScopedValue(
          setErrorsByConnectorId,
          connectorId,
          error instanceof Error ? error.message : t('magnet.platform-login.error.clearCookiesFailed')
        );
      } finally {
        setBusyConnectorId(null);
      }
    },
    [busyConnectorId, t]
  );

  const activeConnectorLabel = activeConnectorDefinition
    ? t(activeConnectorDefinition.labelKey)
    : t('magnet.platform-login.trigger.title');
  const authStateLabel = useMemo(
    () => t(toAuthLabelKey(activeAuthSnapshot?.authState ?? 'unauthorized')),
    [activeAuthSnapshot?.authState, t]
  );
  const availabilityLabel = useMemo(
    () => t(toAvailabilityLabelKey(activeAuthSnapshot?.availability ?? 'unknown')),
    [activeAuthSnapshot?.availability, t]
  );

  const contextMenuConnector = contextMenuState
    ? registeredConnectors.find((item) => item.entry.connectorId === contextMenuState.connectorId) ?? null
    : null;
  const contextMenuStateType =
    contextMenuConnector &&
    resolveManagedConnectorState(
      contextMenuConnector.definition,
      contextMenuConnector.snapshot,
      contextMenuConnector.renderSelection
    );

  return (
    <>
      <div className="platform-login-magnet" ref={rootRef}>
        <div className="platform-login-shell">
          <button
            type="button"
            ref={triggerButtonRef}
            className={`platform-login-trigger${stripOpen ? ' platform-login-trigger--open' : ''}`}
            title={t('magnet.platform-login.trigger.title')}
            onClick={handleToggleStrip}
          >
            <QrCode className="platform-login-trigger-icon" />
          </button>
        </div>
      </div>

      <CollisionAwarePopup
        ref={stripPopupRef}
        open={stripOpen}
        anchorRef={triggerButtonRef}
        placement="right-center"
        offset={12}
        viewportPadding={10}
        className="platform-login-strip-popup"
        role="dialog"
      >
        <div className="platform-login-strip">
          {registeredConnectors.map(({ definition, snapshot, renderSelection }) => {
            const visualState = resolveManagedConnectorState(definition, snapshot, renderSelection);
            const tooltipTitle = `${t(definition.labelKey)}\n${t(resolveStateHintKey(visualState))}`;

            return (
              <button
                key={definition.connectorId}
                type="button"
                ref={(node) => {
                  connectorButtonRefs.current[definition.connectorId] = node;
                }}
                className={`platform-login-connector-button platform-login-connector-button--${visualState}`}
                title={tooltipTitle}
                onClick={() => handleConnectorActivate(definition)}
                onContextMenu={(event) => handleConnectorContextMenu(event, definition.connectorId)}
              >
                <ConnectorGlyph definition={definition} />
                <span className={`platform-login-connector-dot platform-login-connector-dot--${visualState}`} />
                <span className="platform-login-connector-tooltip" role="tooltip">
                  <span className="platform-login-connector-tooltip-title">{t(definition.labelKey)}</span>
                  <span className="platform-login-connector-tooltip-subtitle">
                    {t(resolveStateHintKey(visualState))}
                  </span>
                </span>
              </button>
            );
          })}

          <button
            type="button"
            ref={moreButtonRef}
            className={`platform-login-more-button${registerMenuOpen ? ' platform-login-more-button--open' : ''}`}
            title={t('magnet.platform-login.action.register')}
            onClick={handleRegisterMenuToggle}
          >
            <MoreHorizontal className="platform-login-more-icon" />
          </button>
        </div>
      </CollisionAwarePopup>

      <CollisionAwarePopup
        ref={registerPopupRef}
        open={registerMenuOpen}
        anchorRef={{ current: moreButtonRef.current }}
        placement="bottom-start"
        offset={10}
        viewportPadding={10}
        className="platform-login-menu-popup"
        role="dialog"
      >
        {skinProps.showSelectorTitle ? (
          <div className="platform-login-menu-title">{t('magnet.platform-login.add.title')}</div>
        ) : null}

        {unregisteredDefinitions.length > 0 ? (
          <div className="platform-login-register-list">
            {unregisteredDefinitions.map((definition) => (
              <button
                key={definition.connectorId}
                type="button"
                className="platform-login-register-item"
                disabled={!definition.enabled || definition.authFlow !== 'qr'}
                onClick={() => {
                  void handleRegisterConnector(definition);
                }}
              >
                <ConnectorGlyph definition={definition} compact />
                <span className="platform-login-register-copy">
                  <span className="platform-login-register-label">{t(definition.labelKey)}</span>
                  <span className="platform-login-register-hint">
                    {definition.enabled && definition.authFlow === 'qr'
                      ? t('magnet.platform-login.add.ready')
                      : t('magnet.platform-login.status.comingSoon')}
                  </span>
                  {(() => {
                    const builtinCompat = builtinCompatByConnectorId.get(definition.connectorId) ?? null;
                    const capabilityLabelKeys = listCapabilityLabelKeys(builtinCompat?.contract ?? null);
                    if (!builtinCompat || capabilityLabelKeys.length === 0) return null;

                    return (
                      <span className="platform-login-register-meta">
                        <span className="platform-login-register-tag">
                          {t('magnet.platform.contract.version', {
                            version: builtinCompat.contract.contractVersion,
                          })}
                        </span>
                        {capabilityLabelKeys.map((labelKey) => (
                          <span
                            key={`${definition.connectorId}:${labelKey}`}
                            className="platform-login-register-tag"
                          >
                            {t(labelKey)}
                          </span>
                        ))}
                      </span>
                    );
                  })()}
                </span>
                <Plus className="platform-login-register-plus" />
              </button>
            ))}
          </div>
        ) : (
          <div className="platform-login-empty-state">{t('magnet.platform-login.add.empty')}</div>
        )}
      </CollisionAwarePopup>

      <CollisionAwarePopup
        ref={authPopupRef}
        open={authPopupOpen && Boolean(activeConnectorDefinition)}
        anchorRef={{
          current:
            (selectedConnectorId ? connectorButtonRefs.current[selectedConnectorId] : null) ??
            triggerButtonRef.current ??
            rootRef.current,
        }}
        placement="bottom-start"
        offset={12}
        viewportPadding={10}
        className="platform-login-auth-popup"
        role="dialog"
      >
        {activeConnectorDefinition ? (
          <>
            <div className="platform-login-auth-header">
              <div className="platform-login-auth-brand">
                <ConnectorGlyph definition={activeConnectorDefinition} compact />
                <div className="platform-login-auth-copy">
                  <div className="platform-login-auth-title">
                    {t('magnet.platform-login.popup.title', {
                      platform: activeConnectorLabel,
                    })}
                  </div>
                  <div className="platform-login-auth-state-line">
                    {t('magnet.platform-login.auth.line', {
                      state: authStateLabel,
                      accountUid: activeAuthSnapshot?.accountUid ?? '-',
                    })}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="platform-login-inline-close"
                onClick={() => setAuthPopupOpen(false)}
                title={t('common.action.close')}
              >
                <X className="platform-login-inline-close-icon" />
              </button>
            </div>

            <p className="platform-login-auth-line">
              {t('magnet.platform-login.availability.line', {
                availability: availabilityLabel,
                message:
                  activeAuthSnapshot?.availabilityMessage ??
                  t('magnet.platform-login.availability.none'),
              })}
            </p>

            <div className="platform-login-actions">
              <button type="button" onClick={() => void handleGenerateQr()} disabled={activeBusy}>
                {t('magnet.platform-login.action.generate')}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selectedConnectorId) {
                    void runPoll(selectedConnectorId);
                  }
                }}
                disabled={activeBusy || !activeQrSession || !selectedConnectorId}
              >
                {t('magnet.platform-login.action.poll')}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selectedConnectorId) {
                    void handleRefreshConnector(selectedConnectorId);
                  }
                }}
                disabled={activeBusy || !selectedConnectorId}
              >
                {t('magnet.platform-login.action.refresh')}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selectedConnectorId) {
                    void handleClearCookies(selectedConnectorId);
                  }
                }}
                disabled={activeBusy || !selectedConnectorId}
              >
                {t('magnet.platform-login.action.clearCookies')}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selectedConnectorId) {
                    void handleLogout(selectedConnectorId);
                  }
                }}
                disabled={activeBusy || !selectedConnectorId}
              >
                {t('magnet.platform-login.action.logout')}
              </button>
            </div>

            {activeQrSession ? (
              <div className="platform-login-qr-card">
                <img
                  src={activeQrSession.qrImageDataUrl}
                  alt={t('magnet.platform-login.qr.alt')}
                  className="platform-login-qr-image"
                />
                <p className="platform-login-qr-hint">{t('magnet.platform-login.qr.hint')}</p>
                <p className="platform-login-qr-expire">
                  {t('magnet.platform-login.qr.expiresAt', {
                    expiresAt: new Date(activeQrSession.expiresAtMs).toLocaleString(),
                  })}
                </p>
              </div>
            ) : (
              <p className="platform-login-empty-state">{t('magnet.platform-login.qr.empty')}</p>
            )}

            {activePollResult ? (
              <p className="platform-login-poll-result">
                {t('magnet.platform-login.status.pollState', {
                  state: activePollResult.state,
                  message: activePollResult.stateMessage,
                })}
              </p>
            ) : null}

            {activeStatusMessage ? <p className="platform-login-status">{activeStatusMessage}</p> : null}
            {activeError ? <p className="platform-login-error">{activeError}</p> : null}
          </>
        ) : null}
      </CollisionAwarePopup>

      {contextMenuState ? (
        <div
          ref={contextAnchorRef}
          style={{
            position: 'fixed',
            left: contextMenuState.x,
            top: contextMenuState.y,
            width: 1,
            height: 1,
            pointerEvents: 'none',
          }}
        />
      ) : null}

      <CollisionAwarePopup
        ref={contextPopupRef}
        open={Boolean(contextMenuState && contextMenuConnector)}
        anchorRef={{ current: contextAnchorRef.current }}
        placement="bottom-start"
        offset={6}
        viewportPadding={10}
        className="platform-login-menu-popup"
        role="dialog"
      >
        {contextMenuConnector ? (
          <>
            <div className="platform-login-menu-title">
              {t('magnet.platform-login.manage.title', {
                platform: t(contextMenuConnector.definition.labelKey),
              })}
            </div>

            <button
              type="button"
              className="platform-login-menu-action"
              onClick={() => {
                setContextMenuState(null);
                if (contextMenuStateType === 'disabled') {
                  updateConnectorScopedValue(
                    setStatusMessagesByConnectorId,
                    contextMenuConnector.definition.connectorId,
                    t('magnet.platform-login.status.comingSoon')
                  );
                  return;
                }
                openAuthPopup(contextMenuConnector.definition.connectorId);
              }}
            >
              <span className="platform-login-menu-action-icon" aria-hidden="true">
                <QrCode className="platform-login-menu-action-icon-svg" />
              </span>
              <span>
                {t(
                  contextMenuStateType === 'unauthorized'
                    ? 'magnet.platform-login.action.login'
                    : 'magnet.platform-login.action.viewStatus'
                )}
              </span>
            </button>

            <button
              type="button"
              className="platform-login-menu-action"
              onClick={() => {
                setContextMenuState(null);
                void handleRefreshConnector(contextMenuConnector.definition.connectorId);
              }}
            >
              <span className="platform-login-menu-action-icon" aria-hidden="true">
                <RefreshCw className="platform-login-menu-action-icon-svg" />
              </span>
              <span>{t('magnet.platform-login.action.refresh')}</span>
            </button>

            {(contextMenuStateType === 'active' || contextMenuStateType === 'inactive') ? (
              <button
                type="button"
                className="platform-login-menu-action"
                onClick={() => {
                  setContextMenuState(null);
                  setBuiltinConnectorMounted(
                    contextMenuConnector.definition.connectorId,
                    contextMenuStateType !== 'active'
                  );
                }}
              >
                <span className="platform-login-menu-action-icon" aria-hidden="true">
                  {contextMenuStateType === 'active' ? (
                    <X className="platform-login-menu-action-icon-svg" />
                  ) : (
                    <Check className="platform-login-menu-action-icon-svg" />
                  )}
                </span>
                <span>
                  {t(
                    contextMenuStateType === 'active'
                      ? 'magnet.platform-login.action.deactivate'
                      : 'magnet.platform-login.action.activate'
                  )}
                </span>
              </button>
            ) : null}

            <button
              type="button"
              className="platform-login-menu-action"
              onClick={() => {
                setContextMenuState(null);
                void handleLogout(contextMenuConnector.definition.connectorId);
              }}
            >
              <span className="platform-login-menu-action-icon" aria-hidden="true">
                <LogOut className="platform-login-menu-action-icon-svg" />
              </span>
              <span>{t('magnet.platform-login.action.logout')}</span>
            </button>

            <button
              type="button"
              className="platform-login-menu-action"
              onClick={() => {
                setContextMenuState(null);
                void handleClearCookies(contextMenuConnector.definition.connectorId);
              }}
            >
              <span className="platform-login-menu-action-icon" aria-hidden="true">
                <X className="platform-login-menu-action-icon-svg" />
              </span>
              <span>{t('magnet.platform-login.action.clearCookies')}</span>
            </button>

            <div className="platform-login-menu-separator" />

            <button
              type="button"
              className="platform-login-menu-action platform-login-menu-action--danger"
              onClick={() => {
                setContextMenuState(null);
                removeConnectorRegistration(contextMenuConnector.definition.connectorId);
              }}
            >
              <span className="platform-login-menu-action-icon" aria-hidden="true">
                <X className="platform-login-menu-action-icon-svg" />
              </span>
              <span>{t('magnet.platform-login.action.removeRegistration')}</span>
            </button>
          </>
        ) : null}
      </CollisionAwarePopup>
    </>
  );
};

const PLATFORM_LOGIN_RENDERERS = {
  ...buildMagnetVariantRenderers(PlatformLoginButtonDefaultRenderer, PLATFORM_LOGIN_VARIANT_PRESETS),
} satisfies Record<string, React.ComponentType<PlatformLoginButtonRendererProps>>;

export const PlatformLoginButton: React.FC = () => {
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('btn-platform-login', PLATFORM_LOGIN_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  return <Renderer skinProps={skin.props} />;
};
