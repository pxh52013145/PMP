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
import { getTelemetryLogger } from '../../../services/telemetry/TelemetryService';
import {
  beginPlatformInstanceQrLogin,
  clearPlatformInstanceAuthCookies,
  installPlatformPackFromFile,
  listBuiltinPlatformCompatRegistrations,
  listPlatformConnectorDefinitions,
  listPlatformInstances,
  listPlatformRenderSelections,
  logoutPlatformInstance,
  pollPlatformInstanceQrLogin,
  refreshPlatformInstanceAuthSnapshot,
  reconcileBuiltinPlatformCompatRegistrations,
  resolvePlatformInstanceId,
  resolvePlatformConnectorTemplate,
  setPlatformRenderSelectionMounted,
  subscribePlatformConnectorCompatRegistrations,
  subscribePlatformConnectorDefinitions,
  subscribePlatformInstances,
  subscribePlatformRenderSelections,
  type PlatformInstanceAuthSnapshot,
  type PlatformConnectorDefinition,
  type PlatformConnectorId,
  type PlatformInstanceRecord,
  type PlatformInstanceQrLoginPollResult,
  type PlatformInstanceQrLoginSession,
  type PlatformRenderSelectionRecord,
  type PlatformCompatContractFile,
  persistPlatformLoginRegistry,
  readPlatformLoginRegistry,
  removePlatformLoginRegistryEntry,
  subscribePlatformLoginRegistry,
  upsertPlatformLoginRegistryEntry,
  type PlatformLoginRegistryEntry,
} from '../../../modules/music-platform';
import {
  getMusicPlatformNowMs,
  warnOnSlowMusicPlatformOperation,
} from '../../../modules/music-platform/platformDiagnostics';
import { normalizePlatformConnectorId } from '../../../modules/music-platform/platformConnectorModel';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';
import { buildMagnetVariantRenderers } from '../shared/magnetVariantCatalog';
import {
  buildPlatformAuthSnapshotMapByInstanceId,
  resolvePlatformRegistrationState,
  type PlatformRegistrationVisualState,
} from '../shared/platformRegistrationState';
import {
  PLATFORM_LOGIN_DEFAULT_QR_AUTO_POLL_INTERVAL_MS,
  PLATFORM_LOGIN_VARIANT_PRESETS,
  parsePlatformLoginSkinProps,
} from './platformLoginSkin';
import './PlatformLoginButton.css';

type PlatformLoginButtonRendererProps = {
  skinProps?: Record<string, unknown>;
};

type ConnectorVisualMeta = {
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
  iconAssetUrl?: string;
};

type ContextMenuState = {
  instanceId: string;
  connectorId: PlatformConnectorId;
  x: number;
  y: number;
} | null;

const CONNECTOR_VISUAL_META_BY_ICON_KEY: Record<string, Omit<ConnectorVisualMeta, 'iconAssetUrl'>> = {
  netease: { Icon: Disc3, color: '#ff6b87' },
  bilibili: { Icon: Tv, color: '#67c7ff' },
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

function isTerminalPollState(result: PlatformInstanceQrLoginPollResult | null): boolean {
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

function updateScopedValue<TRecord extends Record<string, unknown>>(
  setter: React.Dispatch<React.SetStateAction<TRecord>>,
  scopedKey: string,
  value: TRecord[string]
): void {
  setter((prev) => ({
    ...prev,
    [scopedKey]: value,
  } as TRecord));
}

function getConnectorVisualMeta(definition: PlatformConnectorDefinition): ConnectorVisualMeta {
  const template = resolvePlatformConnectorTemplate(definition);
  const fallbackIcon = template === 'video' ? Tv : template === 'music' ? Disc3 : Music;
  const builtinByIconKey = CONNECTOR_VISUAL_META_BY_ICON_KEY[definition.iconKey?.trim().toLowerCase() ?? ''];
  const builtinByConnectorId =
    CONNECTOR_VISUAL_META_BY_ICON_KEY[definition.connectorId.replace('connector.platform.', '')];
  const builtin = builtinByIconKey ?? builtinByConnectorId;
  return {
    Icon: builtin?.Icon ?? fallbackIcon,
    color: definition.accentColor || builtin?.color || '#a1a1aa',
    iconAssetUrl: definition.iconAssetUrl,
  };
}

function resolveStateHintKey(state: PlatformRegistrationVisualState): string {
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

async function waitForNextPaint(): Promise<void> {
  if (typeof window === 'undefined') {
    await Promise.resolve();
    return;
  }

  if (typeof window.requestAnimationFrame !== 'function') {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    return;
  }

  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
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

function buildPlatformLoginRegistryEntriesFingerprint(
  entries: PlatformLoginRegistryEntry[]
): string {
  return JSON.stringify(
    entries
      .map((entry) => ({
        instanceId: entry.instanceId,
        connectorId: entry.connectorId,
        enabled: entry.enabled !== false,
        addedAtMs: Number.isFinite(entry.addedAtMs) ? entry.addedAtMs : 0,
      }))
      .sort((left, right) => {
        const instanceCompare = left.instanceId.localeCompare(right.instanceId, 'zh-CN');
        if (instanceCompare !== 0) {
          return instanceCompare;
        }
        const connectorCompare = left.connectorId.localeCompare(right.connectorId, 'zh-CN');
        if (connectorCompare !== 0) {
          return connectorCompare;
        }
        return left.addedAtMs - right.addedAtMs;
      })
  );
}

function ConnectorGlyph({
  definition,
  compact = false,
}: {
  definition: PlatformConnectorDefinition;
  compact?: boolean;
}): JSX.Element {
  const { Icon, color, iconAssetUrl } = getConnectorVisualMeta(definition);
  const className = compact ? 'platform-login-glyph platform-login-glyph--compact' : 'platform-login-glyph';
  return (
    <ConnectorVisualIcon
      Icon={Icon}
      color={color}
      iconAssetUrl={iconAssetUrl}
      className={className}
      style={{ objectFit: 'contain' }}
    />
  );
}

function ConnectorVisualIcon({
  Icon,
  color,
  iconAssetUrl,
  className,
  style,
}: {
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
  iconAssetUrl?: string;
  className: string;
  style?: React.CSSProperties;
}): JSX.Element {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [iconAssetUrl]);

  if (iconAssetUrl && !imageFailed) {
    return (
      <img
        src={iconAssetUrl}
        alt=""
        aria-hidden
        className={className}
        style={style}
        onError={() => {
          setImageFailed(true);
        }}
      />
    );
  }

  return <Icon className={className} style={{ ...style, color }} />;
}

const PlatformLoginButtonDefaultRenderer: React.FC<PlatformLoginButtonRendererProps> = ({
  skinProps: rawSkinProps,
}) => {
  const skinProps = useMemo(() => parsePlatformLoginSkinProps(rawSkinProps), [rawSkinProps]);
  const t = useT();
  const telemetry = useMemo(
    () => getTelemetryLogger('magnet.platform-login', 'PlatformLoginButton'),
    []
  );

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const stripPopupRef = useRef<HTMLDivElement | null>(null);
  const authPopupRef = useRef<HTMLDivElement | null>(null);
  const registerPopupRef = useRef<HTMLDivElement | null>(null);
  const contextPopupRef = useRef<HTMLDivElement | null>(null);
  const contextAnchorRef = useRef<HTMLDivElement | null>(null);
  const connectorButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const platformPackInputRef = useRef<HTMLInputElement | null>(null);
  const registryHydratedRef = useRef(false);
  const registryEntriesFingerprintRef = useRef(
    buildPlatformLoginRegistryEntriesFingerprint([])
  );
  const lastSyncedRegistryFingerprintRef = useRef<string | null>(null);

  const [stripOpen, setStripOpen] = useState(false);
  const [registerMenuOpen, setRegisterMenuOpen] = useState(false);
  const [authPopupOpen, setAuthPopupOpen] = useState(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [contextMenuState, setContextMenuState] = useState<ContextMenuState>(null);
  const [busyInstanceId, setBusyInstanceId] = useState<string | null>(null);
  const [platformPackInstalling, setPlatformPackInstalling] = useState(false);
  const [platformPackInstallMessage, setPlatformPackInstallMessage] = useState<string | null>(null);
  const [platformDefinitions, setPlatformDefinitions] = useState<PlatformConnectorDefinition[]>([]);
  const [compatRegistrations, setCompatRegistrations] = useState<ReturnType<typeof listBuiltinPlatformCompatRegistrations>>([]);
  const preferredConnectorId = useMemo(
    () => resolvePreferredConnectorId(skinProps.defaultConnectorId, platformDefinitions),
    [platformDefinitions, skinProps.defaultConnectorId]
  );
  const platformDefinitionsById = useMemo(
    () => new Map(platformDefinitions.map((definition) => [definition.connectorId, definition])),
    [platformDefinitions]
  );
  const builtinCompatByConnectorId = useMemo(
    () => new Map(compatRegistrations.map((registration) => [registration.connectorId, registration])),
    [compatRegistrations]
  );

  const [registryEntries, setRegistryEntries] = useState<PlatformLoginRegistryEntry[]>([]);
  const [platformInstances, setPlatformInstances] = useState<PlatformInstanceRecord[]>([]);
  const [renderSelections, setRenderSelections] = useState<PlatformRenderSelectionRecord[]>([]);

  const [authSnapshotsByInstanceId, setAuthSnapshotsByInstanceId] = useState<Record<string, PlatformInstanceAuthSnapshot | null>>({});
  const [qrSessionsByInstanceId, setQrSessionsByInstanceId] = useState<Record<string, PlatformInstanceQrLoginSession | null>>({});
  const [pollResultsByInstanceId, setPollResultsByInstanceId] = useState<Record<string, PlatformInstanceQrLoginPollResult | null>>({});
  const [errorsByInstanceId, setErrorsByInstanceId] = useState<Record<string, string | null>>({});
  const [statusMessagesByInstanceId, setStatusMessagesByInstanceId] = useState<Record<string, string | null>>({});

  useEffect(() => {
    setPlatformDefinitions(listPlatformConnectorDefinitions());
    return subscribePlatformConnectorDefinitions((definitions) => {
      setPlatformDefinitions(definitions);
    });
  }, []);

  useEffect(() => {
    setCompatRegistrations(listBuiltinPlatformCompatRegistrations());
    return subscribePlatformConnectorCompatRegistrations((registrations) => {
      setCompatRegistrations(registrations);
    });
  }, []);

  const syncRegisteredContracts = useCallback((entries: PlatformLoginRegistryEntry[]) => {
    reconcileBuiltinPlatformCompatRegistrations(
      entries.filter((entry) => entry.enabled !== false).map((entry) => entry.connectorId)
    );
  }, []);

  const flushRegistryStateSideEffects = useCallback(
    (
      entries: PlatformLoginRegistryEntry[],
      fingerprint = buildPlatformLoginRegistryEntriesFingerprint(entries)
    ) => {
      if (lastSyncedRegistryFingerprintRef.current === fingerprint) {
        return;
      }
      lastSyncedRegistryFingerprintRef.current = fingerprint;
      syncRegisteredContracts(entries);
      void persistPlatformLoginRegistry(entries);
    },
    [syncRegisteredContracts]
  );

  const persistRegistryState = useCallback(
    (updater: (prev: PlatformLoginRegistryEntry[]) => PlatformLoginRegistryEntry[]) => {
      setRegistryEntries((prev) => {
        const next = updater(prev);
        const previousFingerprint = buildPlatformLoginRegistryEntriesFingerprint(prev);
        const nextFingerprint = buildPlatformLoginRegistryEntriesFingerprint(next);
        if (previousFingerprint === nextFingerprint) {
          return prev;
        }
        registryEntriesFingerprintRef.current = nextFingerprint;
        return next;
      });
    },
    []
  );

  const refreshRegistryState = useCallback(() => {
    const nextRegistryEntries = readPlatformLoginRegistry(
      platformDefinitions,
      preferredConnectorId,
      platformInstances
    );
    const nextFingerprint = buildPlatformLoginRegistryEntriesFingerprint(nextRegistryEntries);
    const currentFingerprint = registryEntriesFingerprintRef.current;
    registryHydratedRef.current = true;
    if (nextFingerprint === currentFingerprint) {
      flushRegistryStateSideEffects(nextRegistryEntries, nextFingerprint);
      return;
    }
    registryEntriesFingerprintRef.current = nextFingerprint;
    setRegistryEntries(nextRegistryEntries);
  }, [
    flushRegistryStateSideEffects,
    platformDefinitions,
    platformInstances,
    preferredConnectorId,
  ]);

  useEffect(() => {
    if (!registryHydratedRef.current) {
      return;
    }
    const fingerprint = buildPlatformLoginRegistryEntriesFingerprint(registryEntries);
    registryEntriesFingerprintRef.current = fingerprint;
    flushRegistryStateSideEffects(registryEntries, fingerprint);
  }, [flushRegistryStateSideEffects, registryEntries]);

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

  const refreshAuthSnapshot = useCallback(async (instanceId: string) => {
    const normalizedInstanceId = instanceId.trim();
    if (!normalizedInstanceId) return null;
    const snapshot = await refreshPlatformInstanceAuthSnapshot(normalizedInstanceId);
    updateScopedValue(setAuthSnapshotsByInstanceId, normalizedInstanceId, snapshot);
    return snapshot;
  }, []);

  useEffect(() => {
    setPlatformInstances(listPlatformInstances());
    return subscribePlatformInstances((instances) => {
      setPlatformInstances(instances);
    });
  }, []);

  useEffect(() => {
    setAuthSnapshotsByInstanceId(buildPlatformAuthSnapshotMapByInstanceId(platformInstances));
  }, [platformInstances]);

  useEffect(() => {
    setRenderSelections(listPlatformRenderSelections());
    return subscribePlatformRenderSelections((records) => {
      setRenderSelections(records);
    });
  }, []);

  const platformInstancesById = useMemo(
    () => new Map(platformInstances.map((instance) => [instance.instanceId, instance] as const)),
    [platformInstances]
  );
  const platformInstanceCountByConnectorId = useMemo(() => {
    const next = new Map<string, number>();
    for (const instance of platformInstances) {
      const connectorId =
        typeof instance.metadata?.connectorId === 'string' ? instance.metadata.connectorId : '';
      if (!connectorId) continue;
      next.set(connectorId, (next.get(connectorId) ?? 0) + 1);
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
          const instance = platformInstancesById.get(entry.instanceId) ?? null;
          const renderSelection = instance
            ? renderSelectionsByInstanceId.get(instance.instanceId) ?? null
            : null;
          return {
            entry,
            definition,
            snapshot: authSnapshotsByInstanceId[entry.instanceId] ?? null,
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
            snapshot: PlatformInstanceAuthSnapshot | null;
            instance: PlatformInstanceRecord | null;
            renderSelection: PlatformRenderSelectionRecord | null;
            builtinCompat: (typeof compatRegistrations)[number] | null;
          } => Boolean(item)
        ),
    [
      authSnapshotsByInstanceId,
      builtinCompatByConnectorId,
      platformDefinitionsById,
      platformInstancesById,
      registryEntries,
      renderSelectionsByInstanceId,
    ]
  );

  const unregisteredDefinitions = useMemo(() => {
    const registeredIds = new Set(registryEntries.map((entry) => entry.connectorId));
    return platformDefinitions.filter((definition) => !registeredIds.has(definition.connectorId));
  }, [platformDefinitions, registryEntries]);

  const preferredRegisteredInstanceId = useMemo(
    () =>
      registeredConnectors.find((item) => item.entry.connectorId === preferredConnectorId)?.entry
        .instanceId ?? registeredConnectors[0]?.entry.instanceId ?? null,
    [preferredConnectorId, registeredConnectors]
  );
  const activeRegisteredConnector =
    (selectedInstanceId
      ? registeredConnectors.find((item) => item.entry.instanceId === selectedInstanceId) ?? null
      : null) ?? null;
  const activeConnectorDefinition = activeRegisteredConnector
    ? platformDefinitionsById.get(activeRegisteredConnector.entry.connectorId) ?? null
    : null;
  const activeAuthSnapshot =
    (selectedInstanceId ? authSnapshotsByInstanceId[selectedInstanceId] : null) ?? null;
  const activeQrSession =
    (selectedInstanceId ? qrSessionsByInstanceId[selectedInstanceId] : null) ?? null;
  const activePollResult =
    (selectedInstanceId ? pollResultsByInstanceId[selectedInstanceId] : null) ?? null;
  const activeError = (selectedInstanceId ? errorsByInstanceId[selectedInstanceId] : null) ?? null;
  const activeStatusMessage =
    (selectedInstanceId ? statusMessagesByInstanceId[selectedInstanceId] : null) ?? null;
  const activeBusy = selectedInstanceId ? busyInstanceId === selectedInstanceId : false;

  const setInstanceMounted = useCallback(
    (instanceId: string, mounted: boolean) => {
      const normalizedInstanceId = instanceId.trim();
      if (!normalizedInstanceId) return;

      setPlatformRenderSelectionMounted(normalizedInstanceId, mounted);
      updateScopedValue(
        setStatusMessagesByInstanceId,
        normalizedInstanceId,
        t(mounted ? 'magnet.platform-login.tip.active' : 'magnet.platform-login.tip.inactive')
      );
    },
    [t]
  );

  useEffect(() => {
    if (!selectedInstanceId) {
      setSelectedInstanceId(preferredRegisteredInstanceId);
      return;
    }

    if (registryEntries.some((entry) => entry.instanceId === selectedInstanceId)) return;

    setSelectedInstanceId(preferredRegisteredInstanceId);
    setAuthPopupOpen(false);
    setContextMenuState(null);
  }, [preferredRegisteredInstanceId, registryEntries, selectedInstanceId]);

  useEffect(() => {
    for (const item of registeredConnectors) {
      if (authSnapshotsByInstanceId[item.entry.instanceId] !== undefined) continue;
      void refreshAuthSnapshot(item.entry.instanceId);
    }
  }, [authSnapshotsByInstanceId, refreshAuthSnapshot, registeredConnectors]);

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

  const setRegistryEntryRegistered = useCallback(
    (entry: Pick<PlatformLoginRegistryEntry, 'instanceId' | 'connectorId'>, enabled: boolean) => {
      persistRegistryState((prev) => upsertPlatformLoginRegistryEntry(prev, entry, enabled));
    },
    [persistRegistryState]
  );

  const removeRegistryEntry = useCallback(
    (entry: Pick<PlatformLoginRegistryEntry, 'instanceId' | 'connectorId'>) => {
      persistRegistryState((prev) => removePlatformLoginRegistryEntry(prev, entry.instanceId));
      updateScopedValue(
        setStatusMessagesByInstanceId,
        entry.instanceId,
        t('magnet.platform-login.status.registrationRemoved')
      );
      if (selectedInstanceId === entry.instanceId) {
        setAuthPopupOpen(false);
        setContextMenuState(null);
      }
    },
    [persistRegistryState, selectedInstanceId, t]
  );

  const openAuthPopup = useCallback((instanceId: string) => {
    setStripOpen(true);
    setRegisterMenuOpen(false);
    setContextMenuState(null);
    setSelectedInstanceId(instanceId);
    setAuthPopupOpen(true);
  }, []);

  const handleToggleStrip = useCallback(() => {
    const next = !stripOpen;
    setStripOpen(next);

    if (next) {
      if (skinProps.openAuthOnTrigger && preferredRegisteredInstanceId) {
        setSelectedInstanceId(preferredRegisteredInstanceId);
        setAuthPopupOpen(true);
      }
      return;
    }

    closeMenus();
  }, [closeMenus, preferredRegisteredInstanceId, skinProps.openAuthOnTrigger, stripOpen]);

  const handleConnectorActivate = useCallback(
    (item: {
      entry: PlatformLoginRegistryEntry;
      definition: PlatformConnectorDefinition;
      snapshot: PlatformInstanceAuthSnapshot | null;
      renderSelection: PlatformRenderSelectionRecord | null;
    }) => {
      const state = resolvePlatformRegistrationState(
        item.definition,
        item.snapshot,
        item.renderSelection
      );

      if (state === 'disabled') {
        updateScopedValue(
          setStatusMessagesByInstanceId,
          item.entry.instanceId,
          t('magnet.platform-login.status.comingSoon')
        );
        return;
      }

      openAuthPopup(item.entry.instanceId);
    },
    [openAuthPopup, t]
  );

  const handleConnectorContextMenu = useCallback(
    (
      event: React.MouseEvent<HTMLButtonElement>,
      entry: Pick<PlatformLoginRegistryEntry, 'instanceId' | 'connectorId'>
    ) => {
      event.preventDefault();
      setStripOpen(true);
      setRegisterMenuOpen(false);
      setAuthPopupOpen(false);
      setSelectedInstanceId(entry.instanceId);
      setContextMenuState({
        instanceId: entry.instanceId,
        connectorId: entry.connectorId,
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
        updateScopedValue(
          setStatusMessagesByInstanceId,
          definition.connectorId,
          t('magnet.platform-login.status.comingSoon')
        );
        return;
      }

      const builtinInstanceId = resolvePlatformInstanceId({
        connectorId: definition.connectorId,
      });
      if (!builtinInstanceId) {
        return;
      }

      const existingSnapshot =
        authSnapshotsByInstanceId[builtinInstanceId] ??
        (await refreshAuthSnapshot(builtinInstanceId));

      setRegistryEntryRegistered(
        {
          instanceId: builtinInstanceId,
          connectorId: definition.connectorId,
        },
        true
      );
      if (existingSnapshot?.authState === 'authorized') {
        setInstanceMounted(builtinInstanceId, true);
      } else {
        updateScopedValue(
          setStatusMessagesByInstanceId,
          builtinInstanceId,
          t('magnet.platform-login.status.registrationAdded')
        );
      }
      setRegisterMenuOpen(false);

      if (existingSnapshot?.authState !== 'authorized') {
        openAuthPopup(builtinInstanceId);
      }
    },
    [
      authSnapshotsByInstanceId,
      openAuthPopup,
      refreshAuthSnapshot,
      setInstanceMounted,
      setRegistryEntryRegistered,
      t,
    ]
  );

  const handlePlatformPackFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const file = input.files?.[0] ?? null;
      input.value = '';
      if (!file) return;

      const importStartedAtMs = getMusicPlatformNowMs();
      setPlatformPackInstalling(true);
      setPlatformPackInstallMessage(null);
      await waitForNextPaint();

      try {
        const registration = await installPlatformPackFromFile(file);
        const importedInstanceId =
          typeof registration.importedInstanceId === 'string'
            ? registration.importedInstanceId
            : resolvePlatformInstanceId({ connectorId: registration.connectorId });
        if (!importedInstanceId) {
          throw new Error('Imported platform instance registration is unavailable');
        }
        const connectorInstanceCount =
          platformInstanceCountByConnectorId.get(registration.connectorId) ?? 0;
        setRegistryEntryRegistered(
          {
            instanceId: importedInstanceId,
            connectorId: registration.connectorId,
          },
          true
        );
        const importedName =
          registration.definition.displayName || registration.compat.contract.platform.displayName;
        if (connectorInstanceCount > 1) {
          setPlatformPackInstallMessage(
            t('magnet.platform-login.pack.import.success', {
              name: importedName,
            })
          );
        } else {
          setPlatformPackInstallMessage(
            t('magnet.platform-login.pack.import.success', {
              name: importedName,
            })
          );
        }
        setSelectedInstanceId(importedInstanceId);
        setRegisterMenuOpen(false);

        const snapshot = await refreshAuthSnapshot(importedInstanceId);
        if (snapshot?.authState === 'authorized') {
          setInstanceMounted(importedInstanceId, true);
        } else {
          openAuthPopup(importedInstanceId);
        }
      } catch (error) {
        telemetry.warn('platform-login.pack.import.failed', {
          message: error instanceof Error ? error.message : String(error),
          fields: {
            fileName: file.name,
            fileSize: file.size,
          },
        });
        setPlatformPackInstallMessage(
          t('magnet.platform-login.pack.import.failed', {
            message: error instanceof Error ? error.message : String(error),
          })
        );
      } finally {
        warnOnSlowMusicPlatformOperation({
          logger: telemetry,
          event: 'platform-login.pack.import.slow',
          startedAtMs: importStartedAtMs,
          fields: {
            fileName: file.name,
            fileSize: file.size,
          },
        });
        setPlatformPackInstalling(false);
      }
    },
    [
      openAuthPopup,
      platformInstanceCountByConnectorId,
      refreshAuthSnapshot,
      setInstanceMounted,
      setRegistryEntryRegistered,
      t,
      telemetry,
    ]
  );

  const runPoll = useCallback(
    async (instanceId: string, sessionId?: string) => {
      const targetSessionId = (
        sessionId ?? qrSessionsByInstanceId[instanceId]?.sessionId ?? ''
      ).trim();
      if (!targetSessionId || busyInstanceId) return;

      setBusyInstanceId(instanceId);
      try {
        const result = await pollPlatformInstanceQrLogin(instanceId, targetSessionId);
        updateScopedValue(setPollResultsByInstanceId, instanceId, result);
        updateScopedValue(setErrorsByInstanceId, instanceId, null);

        if (!result) {
          updateScopedValue(
            setErrorsByInstanceId,
            instanceId,
            t('magnet.platform-login.error.pollFailed')
          );
          return;
        }

        if (result.authState === 'authorized') {
          const resolvedConnectorId =
            normalizePlatformConnectorId(result.connectorId) ??
            normalizePlatformConnectorId(
              platformInstancesById.get(instanceId)?.metadata?.connectorId
            );
          if (resolvedConnectorId) {
            setRegistryEntryRegistered(
              {
                instanceId,
                connectorId: resolvedConnectorId,
              },
              true
            );
          }
          setInstanceMounted(instanceId, true);
          updateScopedValue(
            setStatusMessagesByInstanceId,
            instanceId,
            t('magnet.platform-login.status.authorized', {
              accountUid: result.accountUid ?? '-',
            })
          );
          updateScopedValue(setQrSessionsByInstanceId, instanceId, null);
          await refreshAuthSnapshot(instanceId);
          return;
        }

        if (isTerminalPollState(result)) {
          updateScopedValue(setQrSessionsByInstanceId, instanceId, null);
          updateScopedValue(
            setStatusMessagesByInstanceId,
            instanceId,
            t('magnet.platform-login.status.pollState', {
              state: result.state,
              message: result.stateMessage,
            })
          );
          await refreshAuthSnapshot(instanceId);
        }
      } catch (error) {
        updateScopedValue(
          setErrorsByInstanceId,
          instanceId,
          error instanceof Error ? error.message : t('magnet.platform-login.error.pollFailed')
        );
      } finally {
        setBusyInstanceId(null);
      }
    },
    [
      busyInstanceId,
      platformInstancesById,
      qrSessionsByInstanceId,
      refreshAuthSnapshot,
      setInstanceMounted,
      setRegistryEntryRegistered,
      t,
    ]
  );

  useEffect(() => {
    if (!authPopupOpen || !selectedInstanceId || !activeQrSession?.sessionId) return;

    const timer = window.setInterval(() => {
      void runPoll(selectedInstanceId, activeQrSession.sessionId);
    }, skinProps.qrAutoPollIntervalMs || PLATFORM_LOGIN_DEFAULT_QR_AUTO_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeQrSession?.sessionId, authPopupOpen, runPoll, selectedInstanceId, skinProps.qrAutoPollIntervalMs]);

  const handleGenerateQr = useCallback(async () => {
    if (!selectedInstanceId || activeBusy) return;
    setBusyInstanceId(selectedInstanceId);

    try {
      const session = await beginPlatformInstanceQrLogin(selectedInstanceId);
      if (!session) {
        updateScopedValue(
          setErrorsByInstanceId,
          selectedInstanceId,
          t('magnet.platform-login.error.generateFailed')
        );
        return;
      }

      updateScopedValue(setQrSessionsByInstanceId, selectedInstanceId, session);
      updateScopedValue(setPollResultsByInstanceId, selectedInstanceId, null);
      updateScopedValue(setErrorsByInstanceId, selectedInstanceId, null);
      updateScopedValue(
        setStatusMessagesByInstanceId,
        selectedInstanceId,
        t('magnet.platform-login.status.generated')
      );
      await refreshAuthSnapshot(selectedInstanceId);
    } catch (error) {
      updateScopedValue(
        setErrorsByInstanceId,
        selectedInstanceId,
        error instanceof Error ? error.message : t('magnet.platform-login.error.generateFailed')
      );
    } finally {
      setBusyInstanceId(null);
    }
  }, [activeBusy, refreshAuthSnapshot, selectedInstanceId, t]);

  const handleRefreshInstance = useCallback(
    async (instanceId: string) => {
      if (busyInstanceId) return;
      setBusyInstanceId(instanceId);
      try {
        await refreshAuthSnapshot(instanceId);
        updateScopedValue(
          setStatusMessagesByInstanceId,
          instanceId,
          t('magnet.platform-login.status.refreshed')
        );
      } catch (error) {
        updateScopedValue(
          setErrorsByInstanceId,
          instanceId,
          error instanceof Error ? error.message : t('magnet.platform-login.error.refreshFailed')
        );
      } finally {
        setBusyInstanceId(null);
      }
    },
    [busyInstanceId, refreshAuthSnapshot, t]
  );

  const handleLogout = useCallback(
    async (instanceId: string) => {
      if (busyInstanceId) return;
      setBusyInstanceId(instanceId);

      try {
        const snapshot = await logoutPlatformInstance(instanceId);
        updateScopedValue(setAuthSnapshotsByInstanceId, instanceId, snapshot);
        updateScopedValue(setQrSessionsByInstanceId, instanceId, null);
        updateScopedValue(setPollResultsByInstanceId, instanceId, null);
        updateScopedValue(setErrorsByInstanceId, instanceId, null);
        updateScopedValue(
          setStatusMessagesByInstanceId,
          instanceId,
          t('magnet.platform-login.status.loggedOut')
        );
      } catch (error) {
        updateScopedValue(
          setErrorsByInstanceId,
          instanceId,
          error instanceof Error ? error.message : t('magnet.platform-login.error.logoutFailed')
        );
      } finally {
        setBusyInstanceId(null);
      }
    },
    [busyInstanceId, t]
  );

  const handleClearCookies = useCallback(
    async (instanceId: string) => {
      if (busyInstanceId) return;
      setBusyInstanceId(instanceId);

      try {
        const snapshot = await clearPlatformInstanceAuthCookies(instanceId);
        updateScopedValue(setAuthSnapshotsByInstanceId, instanceId, snapshot);
        updateScopedValue(setQrSessionsByInstanceId, instanceId, null);
        updateScopedValue(setPollResultsByInstanceId, instanceId, null);
        updateScopedValue(setErrorsByInstanceId, instanceId, null);
        updateScopedValue(
          setStatusMessagesByInstanceId,
          instanceId,
          t('magnet.platform-login.status.cookiesCleared')
        );
      } catch (error) {
        updateScopedValue(
          setErrorsByInstanceId,
          instanceId,
          error instanceof Error ? error.message : t('magnet.platform-login.error.clearCookiesFailed')
        );
      } finally {
        setBusyInstanceId(null);
      }
    },
    [busyInstanceId, t]
  );

  const activeConnectorLabel = activeConnectorDefinition
    ? activeRegisteredConnector?.instance?.displayName ?? t(activeConnectorDefinition.labelKey)
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
    ? registeredConnectors.find((item) => item.entry.instanceId === contextMenuState.instanceId) ?? null
    : null;
  const contextMenuStateType =
    contextMenuConnector &&
    resolvePlatformRegistrationState(
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
          {registeredConnectors.map((item) => {
            const { definition, snapshot, renderSelection } = item;
            const visualState = resolvePlatformRegistrationState(
              definition,
              snapshot,
              renderSelection
            );
            const tooltipTitle = `${t(definition.labelKey)}\n${item.instance?.displayName ?? definition.displayName}\n${t(resolveStateHintKey(visualState))}`;

            return (
              <button
                key={item.entry.instanceId}
                type="button"
                ref={(node) => {
                  connectorButtonRefs.current[item.entry.instanceId] = node;
                }}
                className={`platform-login-connector-button platform-login-connector-button--${visualState}`}
                title={tooltipTitle}
                onClick={() => handleConnectorActivate(item)}
                onContextMenu={(event) => handleConnectorContextMenu(event, item.entry)}
              >
                <ConnectorGlyph definition={definition} />
                <span className={`platform-login-connector-dot platform-login-connector-dot--${visualState}`} />
                <span className="platform-login-connector-tooltip" role="tooltip">
                  <span className="platform-login-connector-tooltip-title">
                    {item.instance?.displayName ?? t(definition.labelKey)}
                  </span>
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

        <div className="platform-login-pack-import">
          <input
            ref={platformPackInputRef}
            type="file"
            accept=".pmpp,.zip,application/zip"
            onChange={handlePlatformPackFileChange}
            className="platform-login-pack-input"
          />
          <button
            type="button"
            className="platform-login-pack-trigger"
            onClick={() => platformPackInputRef.current?.click()}
            disabled={platformPackInstalling}
          >
            {platformPackInstalling
              ? t('common.state.loading')
              : t('magnet.platform-login.pack.import.action')}
          </button>
          {platformPackInstallMessage ? (
            <div className="platform-login-pack-message">{platformPackInstallMessage}</div>
          ) : null}
        </div>
      </CollisionAwarePopup>

      <CollisionAwarePopup
        ref={authPopupRef}
        open={authPopupOpen && Boolean(activeConnectorDefinition)}
        anchorRef={{
          current:
            (selectedInstanceId ? connectorButtonRefs.current[selectedInstanceId] : null) ??
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
                  if (selectedInstanceId) {
                    void runPoll(selectedInstanceId);
                  }
                }}
                disabled={activeBusy || !activeQrSession || !selectedInstanceId}
              >
                {t('magnet.platform-login.action.poll')}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selectedInstanceId) {
                    void handleRefreshInstance(selectedInstanceId);
                  }
                }}
                disabled={activeBusy || !selectedInstanceId}
              >
                {t('magnet.platform-login.action.refresh')}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selectedInstanceId) {
                    void handleClearCookies(selectedInstanceId);
                  }
                }}
                disabled={activeBusy || !selectedInstanceId}
              >
                {t('magnet.platform-login.action.clearCookies')}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selectedInstanceId) {
                    void handleLogout(selectedInstanceId);
                  }
                }}
                disabled={activeBusy || !selectedInstanceId}
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
                  updateScopedValue(
                    setStatusMessagesByInstanceId,
                    contextMenuConnector.entry.instanceId,
                    t('magnet.platform-login.status.comingSoon')
                  );
                  return;
                }
                openAuthPopup(contextMenuConnector.entry.instanceId);
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
                void handleRefreshInstance(contextMenuConnector.entry.instanceId);
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
                  setInstanceMounted(
                    contextMenuConnector.entry.instanceId,
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
                void handleLogout(contextMenuConnector.entry.instanceId);
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
                void handleClearCookies(contextMenuConnector.entry.instanceId);
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
                removeRegistryEntry(contextMenuConnector.entry);
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
