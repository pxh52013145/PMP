import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ExternalLink,
  Eye,
  Link2,
  Play,
  RefreshCw,
  Unplug,
} from 'lucide-react';
import type { InstalledHostExtensionRecord } from '../../magnet-system/plugins/extensions';
import {
  getInstalledExtensionsRevision,
  loadInstalledExtensions,
  subscribeInstalledExtensions,
} from '../../magnet-system/plugins/extensions';
import type {
  PluginDevDeferredRuntimeKind,
  PluginDevProjectSource,
  PluginDevSessionMode,
  PluginDevSessionRecord,
  PluginDevSupportedRuntimeKind,
} from '../../magnet-system/plugins/devSessionRegistry';
import {
  clearPluginDevSessionLastError,
  createPluginDevProjectSourceFromPath,
  detachPluginDevSession,
  getPluginDevSessionsRevision,
  loadPluginDevSessions,
  refreshPluginDevSession,
  setPluginDevSessionLastError,
  subscribePluginDevSessions,
  upsertPluginDevSession,
} from '../../magnet-system/plugins/devSessionRegistry';
import {
  readPlatformPackDevSourceFromPath,
  type PlatformPackDevSource,
  type PlatformPackDevSourceStatus,
} from '../../modules/music-platform/platformPackDevSource';
import {
  bindPlatformPackDevInstance,
  detachPlatformPackDevInstanceBinding,
  getPlatformPackDevInstanceBindingsRevision,
  listPlatformPackDevInstanceBindings,
  reloadPlatformPackDevInstanceBinding,
  subscribePlatformPackDevInstanceBindings,
  type PlatformPackDevInstanceBindingRecord,
} from '../../modules/music-platform/platformPackDevBinding';
import {
  getActiveMusicPlatformInstanceId,
  getMusicPlatformActiveInstanceState,
  subscribeMusicPlatformActiveInstanceState,
} from '../../modules/music-platform/activeInstanceRegistry';
import {
  getPlatformRenderSelection,
  listPlatformRenderSelections,
  subscribePlatformRenderSelections,
} from '../../modules/music-platform/renderSelectionRegistry';
import {
  resolvePlatformRuntimeDescriptorByInstanceId,
  type PlatformRuntimeDescriptor,
} from '../../modules/music-platform/platformRuntimeDescriptor';
import { focusMusicPlatformWorkspaceInstance } from '../../modules/music-platform/platformWorkspaceFocus';
import { useT } from '../../i18n';
import { useKernel } from '../../contexts/KernelContext';
import {
  SPACE_RUNTIME_GOVERNANCE_SERVICE_TOKEN,
  type SpaceRuntimeGovernanceService,
} from '../../services/governance';
import type { RuntimeCapsuleState, RuntimeLifecycleParticipant } from '../../contracts/runtimeCapsule';
import { useMagnetConfig } from '../../modules/magnets/useMagnetConfig';
import { PmpButton } from '../primitives';
import { resolveInstalledExtensionRuntime } from '../../magnet-system/plugins/runtime';
import {
  INSTALLED_EXTENSION_COMMAND_LAUNCHERS,
  INSTALLED_EXTENSION_VIEW_LAUNCHERS,
} from '../../magnet-system/plugins/runtime/installedExtensionHostLaunchers';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import './PluginDevelopmentWorkspaceMagnet.css';

type RuntimePreviewEntry = {
  runtimeKind: 'webview' | 'extension-host';
  runtimeLabel: string;
  sourceLabel: string;
  path: string;
  issues: string[];
};

type WorkspaceProfile = 'manifest-v2' | 'platform-pack';

type SessionDraft = {
  pluginId: string;
  displayName: string;
  projectRoot: string;
  manifestPath: string;
  mode: PluginDevSessionMode;
  entryUrl: string;
  entryPath: string;
  runtimeKinds: PluginDevSupportedRuntimeKind[];
  supportedRuntimeKinds: PluginDevSupportedRuntimeKind[];
  deferredRuntimeKinds: PluginDevDeferredRuntimeKind[];
  installedRecord: InstalledHostExtensionRecord | null;
};

type PlatformPackPreviewStatus = {
  renderSelectionMounted: boolean;
  activeInstanceSelected: boolean;
  workspaceRouteResolved: boolean;
  runtimeImportUrlFromDev: boolean;
  workspacePath: string;
  workspaceRouteStatus: string;
  runtimeImportUrl: string | null;
  descriptor: PlatformRuntimeDescriptor | null;
};

function formatTimestamp(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '-';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '-';
  }
}

function readInstalledExtensionDisplayName(record: InstalledHostExtensionRecord): string {
  return record.manifest.identity.displayName ?? record.manifest.identity.name;
}

function buildDraftFromProjectSource(
  source: PluginDevProjectSource,
  session: PluginDevSessionRecord | null
): SessionDraft {
  return {
    pluginId: source.pluginId,
    displayName: source.displayName,
    projectRoot: source.projectRoot,
    manifestPath: source.manifestPath,
    mode: session?.mode ?? source.defaultMode,
    entryUrl: session?.entryUrl ?? '',
    entryPath: session?.entryPath ?? source.defaultEntryPath ?? '',
    runtimeKinds: session?.runtimeKinds ?? source.supportedRuntimeKinds,
    supportedRuntimeKinds: source.supportedRuntimeKinds,
    deferredRuntimeKinds: source.deferredRuntimeKinds,
    installedRecord: source.installedRecord,
  };
}

function buildDraftFromSession(
  session: PluginDevSessionRecord,
  installedRecord: InstalledHostExtensionRecord | null
): SessionDraft {
  const supportedRuntimeKinds = Array.from(
    new Set(
      (installedRecord?.manifest.runtimes ?? [])
        .map((runtime) => runtime.kind)
        .filter(
          (runtimeKind): runtimeKind is PluginDevSupportedRuntimeKind =>
            runtimeKind === 'webview' || runtimeKind === 'extension-host'
        )
    )
  );
  const deferredRuntimeKinds = Array.from(
    new Set(
      (installedRecord?.manifest.runtimes ?? [])
        .map((runtime) => runtime.kind)
        .filter(
          (runtimeKind): runtimeKind is PluginDevDeferredRuntimeKind =>
            runtimeKind === 'sidecar'
        )
    )
  );

  return {
    pluginId: session.pluginId,
    displayName:
      installedRecord?.manifest.identity.displayName ??
      installedRecord?.manifest.identity.name ??
      session.pluginId,
    projectRoot: session.projectRoot,
    manifestPath: session.manifestPath,
    mode: session.mode,
    entryUrl: session.entryUrl ?? '',
    entryPath: session.entryPath ?? '',
    runtimeKinds: session.runtimeKinds,
    supportedRuntimeKinds,
    deferredRuntimeKinds,
    installedRecord,
  };
}

function readRuntimePreviewEntries(
  t: (key: string, params?: Record<string, unknown>) => string,
  installedRecord: InstalledHostExtensionRecord | null
): RuntimePreviewEntry[] {
  if (!installedRecord) return [];

  const entries: RuntimePreviewEntry[] = [];
  const runtimeKinds = new Set(installedRecord.manifest.runtimes.map((runtime) => runtime.kind));

  if (runtimeKinds.has('webview')) {
    const resolution = resolveInstalledExtensionRuntime(installedRecord, {
      hostId: 'pmp',
      surfaceKind: 'page',
      supportedLauncherIds: [...INSTALLED_EXTENSION_VIEW_LAUNCHERS],
    });
    if (resolution.status === 'resolved') {
      entries.push({
        runtimeKind: 'webview',
        runtimeLabel: t('magnet.pluginDevelopmentWorkspace.runtime.webview'),
        sourceLabel:
          resolution.source === 'dev-session'
            ? t('magnet.pluginDevelopmentWorkspace.runtime.source.dev')
            : t('magnet.pluginDevelopmentWorkspace.runtime.source.installed'),
        path: resolution.artifact.path,
        issues: resolution.issues,
      });
    }
  }

  if (runtimeKinds.has('extension-host')) {
    const resolution = resolveInstalledExtensionRuntime(installedRecord, {
      hostId: 'pmp',
      surfaceKind: 'command',
      preferCommandWorker: true,
      supportedLauncherIds: [...INSTALLED_EXTENSION_COMMAND_LAUNCHERS],
    });
    if (resolution.status === 'resolved') {
      entries.push({
        runtimeKind: 'extension-host',
        runtimeLabel: t('magnet.pluginDevelopmentWorkspace.runtime.worker'),
        sourceLabel:
          resolution.source === 'dev-session'
            ? t('magnet.pluginDevelopmentWorkspace.runtime.source.dev')
            : t('magnet.pluginDevelopmentWorkspace.runtime.source.installed'),
        path: resolution.artifact.path,
        issues: resolution.issues,
      });
    }
  }

  return entries;
}

function formatPlatformPackStatusLabel(
  t: (key: string, params?: Record<string, unknown>) => string,
  status: PlatformPackDevSourceStatus
): string {
  switch (status) {
    case 'ready':
      return t('magnet.pluginDevelopmentWorkspace.platformPack.status.ready');
    case 'degraded':
      return t('magnet.pluginDevelopmentWorkspace.platformPack.status.degraded');
    case 'error':
      return t('magnet.pluginDevelopmentWorkspace.platformPack.status.error');
  }
}

function readPlatformPackDisplayName(source: PlatformPackDevSource): string {
  return source.manifest?.metadata.name ?? source.manifest?.metadata.id ?? source.rootDir;
}

function readPlatformPackBindingDisplayName(
  record: PlatformPackDevInstanceBindingRecord | null
): string {
  return record?.displayName ?? record?.packId ?? '-';
}

function readPlatformPackSourceBlockingError(source: PlatformPackDevSource | null): string | null {
  if (!source || source.status === 'ready') return null;
  return (
    source.diagnostics.find((diagnostic) => diagnostic.severity === 'error')?.message ??
    source.diagnostics[0]?.message ??
    null
  );
}

function getPlatformRenderSelectionSnapshot(): string {
  return JSON.stringify(
    listPlatformRenderSelections().map((record) => ({
      instanceId: record.instanceId,
      mounted: record.mounted,
      mountedAtMs: record.mountedAtMs ?? null,
      order: record.order ?? null,
    }))
  );
}

function getMusicPlatformActiveInstanceSnapshot(): string {
  return JSON.stringify(getMusicPlatformActiveInstanceState());
}

function readPlatformPackPreviewStatus(
  record: PlatformPackDevInstanceBindingRecord | null
): PlatformPackPreviewStatus {
  if (!record) {
    return {
      renderSelectionMounted: false,
      activeInstanceSelected: false,
      workspaceRouteResolved: false,
      runtimeImportUrlFromDev: false,
      workspacePath: 'none',
      workspaceRouteStatus: 'blocked',
      runtimeImportUrl: null,
      descriptor: null,
    };
  }

  const descriptor = resolvePlatformRuntimeDescriptorByInstanceId(record.instanceId);
  const workspaceMount = descriptor?.workspaceMount ?? null;
  const workspaceRouting = descriptor?.workspaceRouting ?? null;
  const runtimeImportUrl = workspaceMount?.runtimeImportUrl ?? null;
  const source = workspaceMount?.source ?? '';

  return {
    renderSelectionMounted:
      getPlatformRenderSelection(record.instanceId)?.mounted === true,
    activeInstanceSelected:
      getActiveMusicPlatformInstanceId({ connectorId: record.connectorId }) ===
      record.instanceId,
    workspaceRouteResolved:
      workspaceRouting?.path === 'pack' &&
      workspaceRouting.status === 'active' &&
      workspaceRouting.packWorkspaceReady === true &&
      workspaceMount?.installationId === record.installationId,
    runtimeImportUrlFromDev:
      workspaceMount?.installationId === record.installationId &&
      source.startsWith('platform-pack-dev') &&
      Boolean(runtimeImportUrl),
    workspacePath: workspaceRouting?.path ?? 'none',
    workspaceRouteStatus: workspaceRouting?.status ?? 'blocked',
    runtimeImportUrl,
    descriptor,
  };
}

export const PluginDevelopmentWorkspaceMagnet = memo(
  function PluginDevelopmentWorkspaceMagnet() {
    const t = useT();
    const kernel = useKernel();
    const { activeSpaceId } = useMagnetConfig();
    const spaceRuntimeGovernance = kernel.services.getOptional(
      SPACE_RUNTIME_GOVERNANCE_SERVICE_TOKEN
    ) as SpaceRuntimeGovernanceService | null;
    const isTauri = isTauriRuntime();
    const lifecycleStateRef = useRef<RuntimeCapsuleState>('active');
    const participantDetailRef = useRef<Record<string, unknown>>({});
    const installedRevision = useSyncExternalStore(
      subscribeInstalledExtensions,
      getInstalledExtensionsRevision,
      getInstalledExtensionsRevision
    );
    const devSessionsRevision = useSyncExternalStore(
      subscribePluginDevSessions,
      getPluginDevSessionsRevision,
      getPluginDevSessionsRevision
    );
    const platformPackBindingRevision = useSyncExternalStore(
      subscribePlatformPackDevInstanceBindings,
      getPlatformPackDevInstanceBindingsRevision,
      getPlatformPackDevInstanceBindingsRevision
    );
    const platformRenderSelectionSnapshot = useSyncExternalStore(
      (listener) => subscribePlatformRenderSelections(() => listener()),
      getPlatformRenderSelectionSnapshot,
      getPlatformRenderSelectionSnapshot
    );
    const musicPlatformActiveInstanceSnapshot = useSyncExternalStore(
      subscribeMusicPlatformActiveInstanceState,
      getMusicPlatformActiveInstanceSnapshot,
      getMusicPlatformActiveInstanceSnapshot
    );

    const installedExtensions = useMemo(() => {
      void installedRevision;
      return loadInstalledExtensions();
    }, [installedRevision]);
    const devSessions = useMemo(() => {
      void devSessionsRevision;
      return loadPluginDevSessions();
    }, [devSessionsRevision]);
    const platformPackBindings = useMemo(() => {
      void platformPackBindingRevision;
      return listPlatformPackDevInstanceBindings();
    }, [platformPackBindingRevision]);

    const installedByPluginId = useMemo(
      () =>
        new Map(
          installedExtensions.map((record) => [record.manifest.identity.id, record] as const)
        ),
      [installedExtensions]
    );
    const sessionsByPluginId = useMemo(
      () => new Map(devSessions.map((session) => [session.pluginId, session] as const)),
      [devSessions]
    );

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [workspaceProfile, setWorkspaceProfile] =
      useState<WorkspaceProfile>('manifest-v2');
    const [platformPackSource, setPlatformPackSource] =
      useState<PlatformPackDevSource | null>(null);
    const [selectedPlatformPackInstanceId, setSelectedPlatformPackInstanceId] =
      useState<string | null>(() => platformPackBindings[0]?.instanceId ?? null);
    const [selectedPluginId, setSelectedPluginId] = useState<string | null>(
      () => devSessions[0]?.pluginId ?? null
    );
    const [draft, setDraft] = useState<SessionDraft | null>(null);

    const selectedSession =
      (selectedPluginId ? sessionsByPluginId.get(selectedPluginId) : null) ?? null;
    const selectedPlatformPackBinding =
      (selectedPlatformPackInstanceId
        ? platformPackBindings.find(
            (record) => record.instanceId === selectedPlatformPackInstanceId
          )
        : null) ?? null;
    const platformPackSourceConnectorId =
      platformPackSource?.manifest?.connector.connectorId.trim().toLowerCase() ?? null;
    const platformPackBindingForSource = useMemo(
      () =>
        platformPackSourceConnectorId
          ? platformPackBindings.find(
              (record) => record.connectorId === platformPackSourceConnectorId
            ) ?? null
          : null,
      [platformPackBindings, platformPackSourceConnectorId]
    );
    const activePlatformPackBinding =
      platformPackBindingForSource ?? selectedPlatformPackBinding ?? platformPackBindings[0] ?? null;
    const activePlatformPackPreviewStatus = useMemo(() => {
      void platformRenderSelectionSnapshot;
      void musicPlatformActiveInstanceSnapshot;
      return readPlatformPackPreviewStatus(activePlatformPackBinding);
    }, [
      activePlatformPackBinding,
      musicPlatformActiveInstanceSnapshot,
      platformRenderSelectionSnapshot,
    ]);
    const platformPackBlockingError = readPlatformPackSourceBlockingError(platformPackSource);

    const currentDraft = useMemo(() => {
      if (draft && draft.pluginId === selectedPluginId) {
        return draft;
      }
      if (!selectedSession) return draft;
      return buildDraftFromSession(
        selectedSession,
        installedByPluginId.get(selectedSession.pluginId) ?? null
      );
    }, [draft, installedByPluginId, selectedPluginId, selectedSession]);

    useEffect(() => {
      if (!selectedPluginId) {
        if (devSessions[0]?.pluginId) {
          setSelectedPluginId(devSessions[0].pluginId);
        }
        return;
      }
      if (sessionsByPluginId.has(selectedPluginId)) {
        return;
      }
      if (draft?.pluginId === selectedPluginId) {
        return;
      }
      setSelectedPluginId(devSessions[0]?.pluginId ?? null);
    }, [devSessions, draft?.pluginId, selectedPluginId, sessionsByPluginId]);

    useEffect(() => {
      if (!selectedPlatformPackInstanceId) {
        setSelectedPlatformPackInstanceId(platformPackBindings[0]?.instanceId ?? null);
        return;
      }
      if (
        platformPackBindings.some(
          (record) => record.instanceId === selectedPlatformPackInstanceId
        )
      ) {
        return;
      }
      setSelectedPlatformPackInstanceId(platformPackBindings[0]?.instanceId ?? null);
    }, [platformPackBindings, selectedPlatformPackInstanceId]);

    const runtimePreviewEntries = useMemo(() => {
      return readRuntimePreviewEntries(
        t,
        currentDraft?.installedRecord ??
          (selectedPluginId ? installedByPluginId.get(selectedPluginId) ?? null : null)
      );
    }, [currentDraft?.installedRecord, installedByPluginId, selectedPluginId, t]);

    const participantDetail = useMemo<Record<string, unknown>>(
      () => ({
        workspaceProfile,
        selectedPluginId,
        selectedPlatformPackInstanceId,
        installedExtensionCount: installedExtensions.length,
        devSessionCount: devSessions.length,
        platformPackBindingCount: platformPackBindings.length,
        runtimePreviewCount: runtimePreviewEntries.length,
        hasDraft: draft !== null,
        hasPlatformPackSource: platformPackSource !== null,
        platformPackStatus: platformPackSource?.status ?? null,
        platformPackBlocked: platformPackBlockingError !== null,
        busy,
      }),
      [
        busy,
        devSessions.length,
        draft,
        installedExtensions.length,
        platformPackBindings.length,
        platformPackBlockingError,
        platformPackSource,
        runtimePreviewEntries.length,
        selectedPlatformPackInstanceId,
        selectedPluginId,
        workspaceProfile,
      ]
    );

    useEffect(() => {
      participantDetailRef.current = participantDetail;
    }, [participantDetail]);

    useEffect(() => {
      if (!spaceRuntimeGovernance) return;
      lifecycleStateRef.current = 'active';

      const participant: RuntimeLifecycleParticipant = {
        id: 'plugin-development-workspace',
        capsuleId: 'plugin.runtime',
        onWarm: () => {
          lifecycleStateRef.current = 'warming';
        },
        onFreeze: () => {
          lifecycleStateRef.current = 'frozen';
          setBusy(false);
        },
        onTeardown: () => {
          lifecycleStateRef.current = 'tearing_down';
          setBusy(false);
          setDraft(null);
          setError(null);
          setPlatformPackSource(null);
        },
        collectSnapshot: () => ({
          id: 'plugin-development-workspace',
          capsuleId: 'plugin.runtime',
          state: lifecycleStateRef.current,
          listeners: 5,
          detail: participantDetailRef.current,
        }),
      };

      return spaceRuntimeGovernance.registerParticipant(activeSpaceId, participant);
    }, [activeSpaceId, spaceRuntimeGovernance]);

    const handleChoosePluginProject = useCallback(async () => {
      if (busy) return;
      if (!isTauri) {
        setError(t('magnet.pluginDevelopmentWorkspace.error.requireTauri'));
        return;
      }
      setBusy(true);
      setError(null);

      try {
        const dialog = await import('@tauri-apps/api/dialog');
        const selected = await dialog.open({
          directory: true,
          multiple: false,
        });
        if (!selected) return;
        const filePath = Array.isArray(selected) ? selected[0] : selected;
        if (typeof filePath !== 'string') {
          throw new Error(t('magnet.pluginDevelopmentWorkspace.error.invalidProjectPath'));
        }

        const projectSource = await createPluginDevProjectSourceFromPath(filePath);
        const existingSession = sessionsByPluginId.get(projectSource.pluginId) ?? null;

        if (projectSource.supportedRuntimeKinds.length === 0) {
          throw new Error(
            t('magnet.pluginDevelopmentWorkspace.error.noSupportedRuntime', {
              pluginId: projectSource.pluginId,
            })
          );
        }

        const nextDraft = buildDraftFromProjectSource(projectSource, existingSession);
        setSelectedPluginId(projectSource.pluginId);
        setDraft(nextDraft);

        if (!projectSource.installedRecord) {
          setError(
            t('magnet.pluginDevelopmentWorkspace.error.installRequired', {
              pluginId: projectSource.pluginId,
            })
          );
        }
      } catch (projectError) {
        setError(projectError instanceof Error ? projectError.message : String(projectError));
      } finally {
        setBusy(false);
      }
    }, [busy, isTauri, sessionsByPluginId, t]);

    const handleChoosePlatformPackProject = useCallback(async () => {
      if (busy) return;
      if (!isTauri) {
        setError(t('magnet.pluginDevelopmentWorkspace.error.requireTauri'));
        return;
      }
      setBusy(true);
      setError(null);

      try {
        const dialog = await import('@tauri-apps/api/dialog');
        const selected = await dialog.open({
          directory: true,
          multiple: false,
        });
        if (!selected) return;
        const filePath = Array.isArray(selected) ? selected[0] : selected;
        if (typeof filePath !== 'string') {
          throw new Error(t('magnet.pluginDevelopmentWorkspace.error.invalidProjectPath'));
        }

        const source = await readPlatformPackDevSourceFromPath(filePath);
        setPlatformPackSource(source);
      } catch (packError) {
        setError(packError instanceof Error ? packError.message : String(packError));
      } finally {
        setBusy(false);
      }
    }, [busy, isTauri, t]);

    const handleReloadPlatformPackSource = useCallback(async () => {
      if (busy || !platformPackSource) return;
      setBusy(true);
      setError(null);

      try {
        const source = await readPlatformPackDevSourceFromPath(platformPackSource.rootDir);
        setPlatformPackSource(source);
      } catch (packError) {
        setError(packError instanceof Error ? packError.message : String(packError));
      } finally {
        setBusy(false);
      }
    }, [busy, platformPackSource]);

    const handleBindPlatformPackDevInstance = useCallback(async () => {
      if (busy || !platformPackSource) return;
      setBusy(true);
      setError(null);

      try {
        const result = await bindPlatformPackDevInstance(platformPackSource);
        setSelectedPlatformPackInstanceId(result.record.instanceId);
        setPlatformPackSource(result.source);
      } catch (bindError) {
        setError(bindError instanceof Error ? bindError.message : String(bindError));
      } finally {
        setBusy(false);
      }
    }, [busy, platformPackSource]);

    const handleReloadPlatformPackBinding = useCallback(
      async (record: PlatformPackDevInstanceBindingRecord) => {
        if (busy) return;
        setBusy(true);
        setError(null);

        try {
          const result = await reloadPlatformPackDevInstanceBinding(record);
          setSelectedPlatformPackInstanceId(result.record.instanceId);
          setPlatformPackSource(result.source);
        } catch (reloadError) {
          setError(reloadError instanceof Error ? reloadError.message : String(reloadError));
        } finally {
          setBusy(false);
        }
      },
      [busy]
    );

    const handleDetachPlatformPackBinding = useCallback(
      async (record: PlatformPackDevInstanceBindingRecord) => {
        if (busy) return;
        setBusy(true);
        setError(null);

        try {
          await detachPlatformPackDevInstanceBinding(record.instanceId);
          if (selectedPlatformPackInstanceId === record.instanceId) {
            setSelectedPlatformPackInstanceId(null);
          }
        } catch (detachError) {
          setError(detachError instanceof Error ? detachError.message : String(detachError));
        } finally {
          setBusy(false);
        }
      },
      [busy, selectedPlatformPackInstanceId]
    );

    const handleOpenPlatformWorkspace = useCallback(
      async (record: PlatformPackDevInstanceBindingRecord) => {
        if (busy) return;
        setBusy(true);
        setError(null);

        try {
          await focusMusicPlatformWorkspaceInstance({
            instanceId: record.instanceId,
            connectorId: record.connectorId,
          });
        } catch (focusError) {
          setError(focusError instanceof Error ? focusError.message : String(focusError));
        } finally {
          setBusy(false);
        }
      },
      [busy]
    );

    const handleSessionAction = useCallback(
      async (pluginId: string, action: 'refresh' | 'restart' | 'detach' | 'clear-error') => {
        if (busy) return;
        setBusy(true);
        setError(null);

        try {
          if (action === 'refresh') {
            refreshPluginDevSession(pluginId, { reason: 'dev-session-refresh' });
            return;
          }
          if (action === 'restart') {
            refreshPluginDevSession(pluginId, { reason: 'dev-session-restart' });
            return;
          }
          if (action === 'detach') {
            detachPluginDevSession(pluginId, { requestRestartReason: 'dev-session-detached' });
            if (selectedPluginId === pluginId) {
              setSelectedPluginId(null);
            }
            return;
          }
          clearPluginDevSessionLastError(pluginId);
        } catch (sessionError) {
          setError(sessionError instanceof Error ? sessionError.message : String(sessionError));
        } finally {
          setBusy(false);
        }
      },
      [busy, selectedPluginId]
    );

    const handleAttachOrUpdate = useCallback(async () => {
      if (busy || !currentDraft) return;
      setBusy(true);
      setError(null);

      try {
        upsertPluginDevSession({
          pluginId: currentDraft.pluginId,
          projectRoot: currentDraft.projectRoot,
          manifestPath: currentDraft.manifestPath,
          mode: currentDraft.mode,
          entryUrl: currentDraft.entryUrl,
          entryPath: currentDraft.entryPath,
          runtimeKinds: currentDraft.runtimeKinds,
          lastError: null,
        });
      } catch (sessionError) {
        if (currentDraft.pluginId) {
          setPluginDevSessionLastError(currentDraft.pluginId, sessionError);
        }
        setError(sessionError instanceof Error ? sessionError.message : String(sessionError));
      } finally {
        setBusy(false);
      }
    }, [busy, currentDraft]);

    const sessionCards = useMemo(() => {
      return devSessions.map((session) => {
        const installedRecord = installedByPluginId.get(session.pluginId) ?? null;
        return {
          session,
          displayName: installedRecord
            ? readInstalledExtensionDisplayName(installedRecord)
            : session.pluginId,
          installedRecord,
        };
      });
    }, [devSessions, installedByPluginId]);

    return (
      <div className="plugin-dev-workspace">
        <div className="plugin-dev-workspace__header">
          <div>
            <div className="plugin-dev-workspace__eyebrow">
              {t('magnet.pluginDevelopmentWorkspace.eyebrow')}
            </div>
            <h3 className="plugin-dev-workspace__title">
              {t('magnet.pluginDevelopmentWorkspace.title')}
            </h3>
            <p className="plugin-dev-workspace__subtitle">
              {t('magnet.pluginDevelopmentWorkspace.subtitle')}
            </p>
            <div
              className="plugin-dev-workspace__profile-switch"
              role="tablist"
              aria-label={t('magnet.pluginDevelopmentWorkspace.profile.ariaLabel')}
            >
              <button
                type="button"
                role="tab"
                aria-selected={workspaceProfile === 'manifest-v2'}
                className={[
                  'plugin-dev-workspace__profile-tab',
                  workspaceProfile === 'manifest-v2'
                    ? 'plugin-dev-workspace__profile-tab--active'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setWorkspaceProfile('manifest-v2')}
              >
                {t('magnet.pluginDevelopmentWorkspace.profile.manifestV2')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={workspaceProfile === 'platform-pack'}
                className={[
                  'plugin-dev-workspace__profile-tab',
                  workspaceProfile === 'platform-pack'
                    ? 'plugin-dev-workspace__profile-tab--active'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setWorkspaceProfile('platform-pack')}
              >
                {t('magnet.pluginDevelopmentWorkspace.profile.platformPack')}
              </button>
            </div>
          </div>
          <PmpButton
            type="button"
            variant="primary"
            onClick={() =>
              void (workspaceProfile === 'manifest-v2'
                ? handleChoosePluginProject()
                : handleChoosePlatformPackProject())
            }
            disabled={busy}
          >
            {workspaceProfile === 'manifest-v2'
              ? t('magnet.pluginDevelopmentWorkspace.action.selectProject')
              : t('magnet.pluginDevelopmentWorkspace.action.selectPlatformPack')}
          </PmpButton>
        </div>

        {error ? <div className="plugin-dev-workspace__error">{error}</div> : null}

        <div className="plugin-dev-workspace__body">
          <section className="plugin-dev-workspace__section plugin-dev-workspace__section--sessions">
            <div className="plugin-dev-workspace__section-title">
              {workspaceProfile === 'manifest-v2'
                ? t('magnet.pluginDevelopmentWorkspace.section.sessions')
                : t('magnet.pluginDevelopmentWorkspace.section.platformPackSource')}
            </div>
            {workspaceProfile === 'manifest-v2' ? (
              sessionCards.length === 0 ? (
                <div className="plugin-dev-workspace__empty">
                  {t('magnet.pluginDevelopmentWorkspace.empty')}
                </div>
              ) : (
                <div className="plugin-dev-workspace__session-list">
                  {sessionCards.map(({ session, displayName, installedRecord }) => (
                    <div
                      key={session.pluginId}
                      role="button"
                      tabIndex={0}
                      className={[
                        'plugin-dev-workspace__session-card',
                        selectedPluginId === session.pluginId
                          ? 'plugin-dev-workspace__session-card--active'
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => {
                        setSelectedPluginId(session.pluginId);
                        setDraft(buildDraftFromSession(session, installedRecord));
                        setError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') {
                          return;
                        }
                        event.preventDefault();
                        setSelectedPluginId(session.pluginId);
                        setDraft(buildDraftFromSession(session, installedRecord));
                        setError(null);
                      }}
                    >
                      <div className="plugin-dev-workspace__session-card-header">
                        <span>{displayName}</span>
                        <span className="plugin-dev-workspace__tag">
                          {session.mode === 'entry-url'
                            ? t('magnet.pluginDevelopmentWorkspace.mode.entryUrl')
                            : t('magnet.pluginDevelopmentWorkspace.mode.entryPath')}
                        </span>
                      </div>
                      <div className="plugin-dev-workspace__session-meta">{session.pluginId}</div>
                      <div
                        className="plugin-dev-workspace__session-path"
                        title={session.projectRoot}
                      >
                        {session.projectRoot}
                      </div>
                      <div className="plugin-dev-workspace__session-meta">
                        {t('magnet.pluginDevelopmentWorkspace.session.runtimeKinds', {
                          kinds: session.runtimeKinds.join(', '),
                        })}
                      </div>
                      <div className="plugin-dev-workspace__session-actions">
                        <PmpButton
                          type="button"
                          variant="default"
                          disabled={busy}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleSessionAction(session.pluginId, 'refresh');
                          }}
                        >
                          {t('common.action.refresh')}
                        </PmpButton>
                        <PmpButton
                          type="button"
                          variant="default"
                          disabled={busy}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleSessionAction(session.pluginId, 'restart');
                          }}
                        >
                          {t('common.action.restart')}
                        </PmpButton>
                        <PmpButton
                          type="button"
                          variant="danger"
                          disabled={busy}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleSessionAction(session.pluginId, 'detach');
                          }}
                        >
                          {t('common.action.detach')}
                        </PmpButton>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : platformPackSource || platformPackBindings.length > 0 ? (
              <div className="plugin-dev-workspace__session-list">
                {platformPackSource ? (
                  <div className="plugin-dev-workspace__session-card plugin-dev-workspace__session-card--active">
                    <div className="plugin-dev-workspace__session-card-header">
                      <span>{readPlatformPackDisplayName(platformPackSource)}</span>
                      <span className="plugin-dev-workspace__tag">
                        {formatPlatformPackStatusLabel(t, platformPackSource.status)}
                      </span>
                    </div>
                    <div className="plugin-dev-workspace__session-meta">
                      {platformPackSource.manifest?.connector.connectorId ?? '-'}
                    </div>
                    <div
                      className="plugin-dev-workspace__session-path"
                      title={platformPackSource.rootDir}
                    >
                      {platformPackSource.rootDir}
                    </div>
                    <div className="plugin-dev-workspace__session-meta">
                      {t('magnet.pluginDevelopmentWorkspace.platformPack.diagnosticCount', {
                        count: platformPackSource.diagnostics.length,
                      })}
                    </div>
                    <div className="plugin-dev-workspace__session-actions">
                      <PmpButton
                        type="button"
                        variant="primary"
                        disabled={busy}
                        onClick={() =>
                          void handleOpenPlatformWorkspace(activePlatformPackBinding)
                        }
                      >
                        <ExternalLink size={14} />
                        {t('magnet.pluginDevelopmentWorkspace.action.openPlatformWorkspace')}
                      </PmpButton>
                      <PmpButton
                        type="button"
                        variant="default"
                        disabled={busy}
                        onClick={() =>
                          void (platformPackBindingForSource
                            ? handleReloadPlatformPackBinding(platformPackBindingForSource)
                            : handleReloadPlatformPackSource())
                        }
                      >
                        <RefreshCw size={14} />
                        {t('magnet.pluginDevelopmentWorkspace.action.reloadPack')}
                      </PmpButton>
                      <PmpButton
                        type="button"
                        variant="primary"
                        disabled={
                          busy ||
                          platformPackSource.status !== 'ready' ||
                          Boolean(platformPackBlockingError)
                        }
                        onClick={() => void handleBindPlatformPackDevInstance()}
                      >
                        <Link2 size={14} />
                        {platformPackBindingForSource
                          ? t('magnet.pluginDevelopmentWorkspace.action.updateDevInstance')
                          : t('magnet.pluginDevelopmentWorkspace.action.bindDevInstance')}
                      </PmpButton>
                    </div>
                  </div>
                ) : null}
                {platformPackBindings.map((record) => (
                  <button
                    key={record.instanceId}
                    type="button"
                    className={[
                      'plugin-dev-workspace__session-card',
                      activePlatformPackBinding?.instanceId === record.instanceId
                        ? 'plugin-dev-workspace__session-card--active'
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => {
                      setSelectedPlatformPackInstanceId(record.instanceId);
                      setError(null);
                    }}
                  >
                    <div className="plugin-dev-workspace__session-card-header">
                      <span>{record.displayName}</span>
                      <span
                        className={[
                          'plugin-dev-workspace__tag',
                          record.status === 'error'
                            ? 'plugin-dev-workspace__tag--error'
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {t(
                          record.status === 'error'
                            ? 'magnet.pluginDevelopmentWorkspace.platformPack.binding.error'
                            : 'magnet.pluginDevelopmentWorkspace.platformPack.binding.bound'
                        )}
                      </span>
                    </div>
                    <div className="plugin-dev-workspace__session-meta">
                      {record.connectorId}
                    </div>
                    <div className="plugin-dev-workspace__session-path" title={record.rootDir}>
                      {record.rootDir}
                    </div>
                    <div className="plugin-dev-workspace__session-meta">
                      {t('magnet.pluginDevelopmentWorkspace.platformPack.binding.revision', {
                        revision: record.revision,
                      })}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="plugin-dev-workspace__empty">
                {t('magnet.pluginDevelopmentWorkspace.platformPack.empty')}
              </div>
            )}
          </section>

          <section className="plugin-dev-workspace__section plugin-dev-workspace__section--editor">
            <div className="plugin-dev-workspace__section-title">
              {workspaceProfile === 'manifest-v2'
                ? t('magnet.pluginDevelopmentWorkspace.section.editor')
                : t('magnet.pluginDevelopmentWorkspace.section.platformPackContract')}
            </div>

            {workspaceProfile === 'manifest-v2' ? (
              currentDraft ? (
                <>
                <div className="plugin-dev-workspace__field-grid">
                  <label className="plugin-dev-workspace__field">
                    <span>{t('magnet.pluginDevelopmentWorkspace.label.plugin')}</span>
                    <input value={currentDraft.pluginId} readOnly />
                  </label>
                  <label className="plugin-dev-workspace__field">
                    <span>{t('magnet.pluginDevelopmentWorkspace.label.mode')}</span>
                    <select
                      value={currentDraft.mode}
                      onChange={(event) =>
                        setDraft((previous) =>
                          previous
                            ? {
                                ...previous,
                                mode: event.target.value === 'entry-url' ? 'entry-url' : 'entry-path',
                              }
                            : previous
                        )
                      }
                    >
                      <option value="entry-url">
                        {t('magnet.pluginDevelopmentWorkspace.mode.entryUrl')}
                      </option>
                      <option value="entry-path">
                        {t('magnet.pluginDevelopmentWorkspace.mode.entryPath')}
                      </option>
                    </select>
                  </label>
                  <label className="plugin-dev-workspace__field plugin-dev-workspace__field--wide">
                    <span>{t('magnet.pluginDevelopmentWorkspace.label.projectRoot')}</span>
                    <input value={currentDraft.projectRoot} readOnly />
                  </label>
                  <label className="plugin-dev-workspace__field plugin-dev-workspace__field--wide">
                    <span>{t('magnet.pluginDevelopmentWorkspace.label.manifestPath')}</span>
                    <input value={currentDraft.manifestPath} readOnly />
                  </label>
                  <label className="plugin-dev-workspace__field plugin-dev-workspace__field--wide">
                    <span>{t('magnet.pluginDevelopmentWorkspace.label.entryUrl')}</span>
                    <input
                      value={currentDraft.entryUrl}
                      placeholder="http://localhost:5173"
                      onChange={(event) =>
                        setDraft((previous) =>
                          previous ? { ...previous, entryUrl: event.target.value } : previous
                        )
                      }
                    />
                  </label>
                  <label className="plugin-dev-workspace__field plugin-dev-workspace__field--wide">
                    <span>{t('magnet.pluginDevelopmentWorkspace.label.entryPath')}</span>
                    <input
                      value={currentDraft.entryPath}
                      placeholder="dist/index.js"
                      onChange={(event) =>
                        setDraft((previous) =>
                          previous ? { ...previous, entryPath: event.target.value } : previous
                        )
                      }
                    />
                  </label>
                </div>

                <div className="plugin-dev-workspace__field">
                  <span>{t('magnet.pluginDevelopmentWorkspace.label.runtimeKinds')}</span>
                  <div className="plugin-dev-workspace__runtime-kind-list">
                    {currentDraft.supportedRuntimeKinds.map((runtimeKind) => (
                      <label
                        key={runtimeKind}
                        className="plugin-dev-workspace__runtime-kind"
                      >
                        <input
                          type="checkbox"
                          checked={currentDraft.runtimeKinds.includes(runtimeKind)}
                          onChange={(event) =>
                            setDraft((previous) => {
                              if (!previous) return previous;
                              const nextKinds = event.target.checked
                                ? Array.from(new Set([...previous.runtimeKinds, runtimeKind]))
                                : previous.runtimeKinds.filter((item) => item !== runtimeKind);
                              return { ...previous, runtimeKinds: nextKinds };
                            })
                          }
                        />
                        <span>{runtimeKind}</span>
                      </label>
                    ))}
                  </div>
                  {currentDraft.deferredRuntimeKinds.length > 0 ? (
                    <div className="plugin-dev-workspace__note">
                      {t('magnet.pluginDevelopmentWorkspace.support.sidecarDeferred', {
                        kinds: currentDraft.deferredRuntimeKinds.join(', '),
                      })}
                    </div>
                  ) : null}
                  {!currentDraft.installedRecord ? (
                    <div className="plugin-dev-workspace__note plugin-dev-workspace__note--warning">
                      {t('magnet.pluginDevelopmentWorkspace.error.installRequired', {
                        pluginId: currentDraft.pluginId,
                      })}
                    </div>
                  ) : null}
                </div>

                <div className="plugin-dev-workspace__editor-actions">
                  <PmpButton
                    type="button"
                    variant="primary"
                    disabled={
                      busy ||
                      !currentDraft.installedRecord ||
                      currentDraft.runtimeKinds.length === 0 ||
                      (!currentDraft.entryUrl.trim() && !currentDraft.entryPath.trim())
                    }
                    onClick={() => void handleAttachOrUpdate()}
                  >
                    {t('common.action.save')}
                  </PmpButton>
                  {selectedSession ? (
                    <>
                      <PmpButton
                        type="button"
                        variant="default"
                        disabled={busy}
                        onClick={() =>
                          void handleSessionAction(selectedSession.pluginId, 'refresh')
                        }
                      >
                        {t('common.action.refresh')}
                      </PmpButton>
                      <PmpButton
                        type="button"
                        variant="default"
                        disabled={busy}
                        onClick={() =>
                          void handleSessionAction(selectedSession.pluginId, 'restart')
                        }
                      >
                        {t('common.action.restart')}
                      </PmpButton>
                      <PmpButton
                        type="button"
                        variant="danger"
                        disabled={busy}
                        onClick={() =>
                          void handleSessionAction(selectedSession.pluginId, 'detach')
                        }
                      >
                        {t('common.action.detach')}
                      </PmpButton>
                    </>
                  ) : null}
                </div>
                </>
              ) : (
                <div className="plugin-dev-workspace__empty">
                  {t('magnet.pluginDevelopmentWorkspace.editorHint')}
                </div>
              )
            ) : platformPackSource ? (
              <>
                <div className="plugin-dev-workspace__field-grid">
                  <label className="plugin-dev-workspace__field">
                    <span>{t('magnet.pluginDevelopmentWorkspace.label.pack')}</span>
                    <input value={readPlatformPackDisplayName(platformPackSource)} readOnly />
                  </label>
                  <label className="plugin-dev-workspace__field">
                    <span>{t('magnet.pluginDevelopmentWorkspace.label.version')}</span>
                    <input value={platformPackSource.manifest?.metadata.version ?? '-'} readOnly />
                  </label>
                  <label className="plugin-dev-workspace__field plugin-dev-workspace__field--wide">
                    <span>{t('magnet.pluginDevelopmentWorkspace.label.connectorId')}</span>
                    <input
                      value={platformPackSource.manifest?.connector.connectorId ?? '-'}
                      readOnly
                    />
                  </label>
                  <label className="plugin-dev-workspace__field plugin-dev-workspace__field--wide">
                    <span>{t('magnet.pluginDevelopmentWorkspace.label.manifestPath')}</span>
                    <input value={platformPackSource.manifestPath} readOnly />
                  </label>
                  <label className="plugin-dev-workspace__field plugin-dev-workspace__field--wide">
                    <span>{t('magnet.pluginDevelopmentWorkspace.label.contractPath')}</span>
                    <input value={platformPackSource.contractPath ?? '-'} readOnly />
                  </label>
                  <label className="plugin-dev-workspace__field plugin-dev-workspace__field--wide">
                    <span>{t('magnet.pluginDevelopmentWorkspace.label.runtimePath')}</span>
                    <input value={platformPackSource.runtimePath ?? '-'} readOnly />
                  </label>
                  <label className="plugin-dev-workspace__field plugin-dev-workspace__field--wide">
                    <span>{t('magnet.pluginDevelopmentWorkspace.label.iconPath')}</span>
                    <input value={platformPackSource.iconPath ?? '-'} readOnly />
                  </label>
                  <label className="plugin-dev-workspace__field plugin-dev-workspace__field--wide">
                    <span>{t('magnet.pluginDevelopmentWorkspace.label.sidecarPath')}</span>
                    <input value={platformPackSource.sidecarPath ?? '-'} readOnly />
                  </label>
                </div>
                {platformPackBlockingError ? (
                  <div className="plugin-dev-workspace__note plugin-dev-workspace__note--warning">
                    {platformPackBlockingError}
                  </div>
                ) : null}
                <div className="plugin-dev-workspace__editor-actions">
                  <PmpButton
                    type="button"
                    variant="primary"
                    disabled={
                      busy ||
                      platformPackSource.status !== 'ready' ||
                      Boolean(platformPackBlockingError)
                    }
                    onClick={() => void handleBindPlatformPackDevInstance()}
                  >
                    <Play size={14} />
                    {platformPackBindingForSource
                      ? t('magnet.pluginDevelopmentWorkspace.action.updateDevInstance')
                      : t('magnet.pluginDevelopmentWorkspace.action.bindDevInstance')}
                  </PmpButton>
                  {platformPackBindingForSource ? (
                    <>
                      <PmpButton
                        type="button"
                        variant="default"
                        disabled={busy}
                        onClick={() =>
                          void handleReloadPlatformPackBinding(platformPackBindingForSource)
                        }
                      >
                        <RefreshCw size={14} />
                        {t('magnet.pluginDevelopmentWorkspace.action.reloadPack')}
                      </PmpButton>
                      <PmpButton
                        type="button"
                        variant="default"
                        disabled={busy}
                        onClick={() =>
                          void handleOpenPlatformWorkspace(platformPackBindingForSource)
                        }
                      >
                        <ExternalLink size={14} />
                        {t('magnet.pluginDevelopmentWorkspace.action.openPlatformWorkspace')}
                      </PmpButton>
                      <PmpButton
                        type="button"
                        variant="danger"
                        disabled={busy}
                        onClick={() =>
                          void handleDetachPlatformPackBinding(platformPackBindingForSource)
                        }
                      >
                        <Unplug size={14} />
                        {t('common.action.detach')}
                      </PmpButton>
                    </>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="plugin-dev-workspace__empty">
                {t('magnet.pluginDevelopmentWorkspace.platformPack.empty')}
              </div>
            )}
          </section>

          <section className="plugin-dev-workspace__section plugin-dev-workspace__section--runtime">
            <div className="plugin-dev-workspace__section-title">
              {workspaceProfile === 'manifest-v2'
                ? t('magnet.pluginDevelopmentWorkspace.section.runtime')
                : t('magnet.pluginDevelopmentWorkspace.section.platformPackPreview')}
            </div>

            {workspaceProfile === 'manifest-v2' ? (
              selectedSession ? (
              <>
                <div className="plugin-dev-workspace__facts">
                  <div>
                    <span>{t('magnet.pluginDevelopmentWorkspace.label.updatedAt')}</span>
                    <strong>{formatTimestamp(selectedSession.updatedAt)}</strong>
                  </div>
                  <div>
                    <span>{t('magnet.pluginDevelopmentWorkspace.label.lastRestart')}</span>
                    <strong>
                      {selectedSession.lastRestartReason
                        ? t('magnet.pluginDevelopmentWorkspace.runtime.lastRestartValue', {
                            reason: selectedSession.lastRestartReason,
                            at: formatTimestamp(selectedSession.lastRestartAt),
                          })
                        : '-'}
                    </strong>
                  </div>
                  <div>
                    <span>{t('magnet.pluginDevelopmentWorkspace.label.lastError')}</span>
                    <strong>{selectedSession.lastError || '-'}</strong>
                  </div>
                </div>

                {selectedSession.lastError ? (
                  <div className="plugin-dev-workspace__editor-actions">
                    <PmpButton
                      type="button"
                      variant="default"
                      disabled={busy}
                      onClick={() =>
                        void handleSessionAction(selectedSession.pluginId, 'clear-error')
                      }
                    >
                      {t('common.action.clear')}
                    </PmpButton>
                  </div>
                ) : null}

                {runtimePreviewEntries.length > 0 ? (
                  <div className="plugin-dev-workspace__runtime-list">
                    {runtimePreviewEntries.map((entry) => (
                      <div key={entry.runtimeKind} className="plugin-dev-workspace__runtime-card">
                        <div className="plugin-dev-workspace__runtime-header">
                          <span>{entry.runtimeLabel}</span>
                          <span className="plugin-dev-workspace__tag">{entry.sourceLabel}</span>
                        </div>
                        <code className="plugin-dev-workspace__runtime-path">{entry.path}</code>
                        {entry.issues.length > 0 ? (
                          <div className="plugin-dev-workspace__runtime-issues">
                            {entry.issues.map((issue) => (
                              <div key={issue}>{issue}</div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="plugin-dev-workspace__empty">
                    {t('magnet.pluginDevelopmentWorkspace.runtime.empty')}
                  </div>
                )}
                </>
              ) : (
                <div className="plugin-dev-workspace__empty">
                  {t('magnet.pluginDevelopmentWorkspace.runtimeHint')}
                </div>
              )
            ) : platformPackSource || activePlatformPackBinding ? (
              <>
                <div className="plugin-dev-workspace__facts">
                  <div>
                    <span>{t('magnet.pluginDevelopmentWorkspace.label.status')}</span>
                    <strong>
                      {platformPackSource
                        ? formatPlatformPackStatusLabel(t, platformPackSource.status)
                        : activePlatformPackBinding?.status ?? '-'}
                    </strong>
                  </div>
                  <div>
                    <span>{t('magnet.pluginDevelopmentWorkspace.label.boundInstance')}</span>
                    <strong>
                      {activePlatformPackBinding?.instanceId ??
                        t('magnet.pluginDevelopmentWorkspace.platformPack.binding.unbound')}
                    </strong>
                  </div>
                  <div>
                    <span>{t('magnet.pluginDevelopmentWorkspace.label.revision')}</span>
                    <strong>{activePlatformPackBinding?.revision ?? '-'}</strong>
                  </div>
                </div>

                <div className="plugin-dev-workspace__preview">
                  <div className="plugin-dev-workspace__preview-header">
                    <Eye size={16} />
                    <span>{t('magnet.pluginDevelopmentWorkspace.platformPack.preview.title')}</span>
                  </div>
                  <div className="plugin-dev-workspace__preview-steps">
                    <div className="plugin-dev-workspace__preview-step">
                      <span className="plugin-dev-workspace__preview-dot plugin-dev-workspace__preview-dot--ready" />
                      <div>
                        <strong>
                          {t('magnet.pluginDevelopmentWorkspace.platformPack.preview.source')}
                        </strong>
                        <span>
                          {platformPackSource
                            ? formatPlatformPackStatusLabel(t, platformPackSource.status)
                            : readPlatformPackBindingDisplayName(activePlatformPackBinding)}
                        </span>
                      </div>
                    </div>
                    <div className="plugin-dev-workspace__preview-step">
                      <span
                        className={[
                          'plugin-dev-workspace__preview-dot',
                          activePlatformPackBinding
                            ? 'plugin-dev-workspace__preview-dot--ready'
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      />
                      <div>
                        <strong>
                          {t('magnet.pluginDevelopmentWorkspace.platformPack.preview.binding')}
                        </strong>
                        <span>
                          {activePlatformPackBinding
                            ? t('magnet.pluginDevelopmentWorkspace.platformPack.preview.bindingReady', {
                                instanceId: activePlatformPackBinding.instanceId,
                              })
                            : t('magnet.pluginDevelopmentWorkspace.platformPack.preview.bindingWaiting')}
                        </span>
                      </div>
                    </div>
                    <div className="plugin-dev-workspace__preview-step">
                      <span
                        className={[
                          'plugin-dev-workspace__preview-dot',
                          activePlatformPackPreviewStatus.renderSelectionMounted
                            ? 'plugin-dev-workspace__preview-dot--ready'
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      />
                      <div>
                        <strong>
                          {t('magnet.pluginDevelopmentWorkspace.platformPack.preview.renderSelection')}
                        </strong>
                        <span>
                          {activePlatformPackPreviewStatus.renderSelectionMounted
                            ? t('magnet.pluginDevelopmentWorkspace.platformPack.preview.renderSelectionMounted')
                            : t('magnet.pluginDevelopmentWorkspace.platformPack.preview.renderSelectionWaiting')}
                        </span>
                      </div>
                    </div>
                    <div className="plugin-dev-workspace__preview-step">
                      <span
                        className={[
                          'plugin-dev-workspace__preview-dot',
                          activePlatformPackPreviewStatus.activeInstanceSelected
                            ? 'plugin-dev-workspace__preview-dot--ready'
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      />
                      <div>
                        <strong>
                          {t('magnet.pluginDevelopmentWorkspace.platformPack.preview.activeInstance')}
                        </strong>
                        <span>
                          {activePlatformPackPreviewStatus.activeInstanceSelected
                            ? t('magnet.pluginDevelopmentWorkspace.platformPack.preview.activeInstanceReady')
                            : t('magnet.pluginDevelopmentWorkspace.platformPack.preview.activeInstanceWaiting')}
                        </span>
                      </div>
                    </div>
                    <div className="plugin-dev-workspace__preview-step">
                      <span
                        className={[
                          'plugin-dev-workspace__preview-dot',
                          activePlatformPackPreviewStatus.workspaceRouteResolved
                            ? 'plugin-dev-workspace__preview-dot--ready'
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      />
                      <div>
                        <strong>
                          {t('magnet.pluginDevelopmentWorkspace.platformPack.preview.workspace')}
                        </strong>
                        <span>
                          {activePlatformPackPreviewStatus.workspaceRouteResolved
                            ? t('magnet.pluginDevelopmentWorkspace.platformPack.preview.workspaceReady', {
                                path: activePlatformPackPreviewStatus.workspacePath,
                                status: activePlatformPackPreviewStatus.workspaceRouteStatus,
                              })
                            : t('magnet.pluginDevelopmentWorkspace.platformPack.preview.workspaceWaiting')}
                        </span>
                      </div>
                    </div>
                    <div className="plugin-dev-workspace__preview-step">
                      <span
                        className={[
                          'plugin-dev-workspace__preview-dot',
                          activePlatformPackPreviewStatus.runtimeImportUrlFromDev
                            ? 'plugin-dev-workspace__preview-dot--ready'
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      />
                      <div>
                        <strong>
                          {t('magnet.pluginDevelopmentWorkspace.platformPack.preview.runtimeSource')}
                        </strong>
                        <span>
                          {activePlatformPackPreviewStatus.runtimeImportUrlFromDev
                            ? t('magnet.pluginDevelopmentWorkspace.platformPack.preview.runtimeSourceReady')
                            : t('magnet.pluginDevelopmentWorkspace.platformPack.preview.runtimeSourceWaiting')}
                        </span>
                        {activePlatformPackPreviewStatus.runtimeImportUrl ? (
                          <code className="plugin-dev-workspace__preview-code">
                            {activePlatformPackPreviewStatus.runtimeImportUrl}
                          </code>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {activePlatformPackBinding ? (
                    <div className="plugin-dev-workspace__session-actions">
                      <PmpButton
                        type="button"
                        variant="primary"
                        disabled={busy}
                        onClick={() =>
                          void handleOpenPlatformWorkspace(activePlatformPackBinding)
                        }
                      >
                        <ExternalLink size={14} />
                        {t('magnet.pluginDevelopmentWorkspace.action.openPlatformWorkspace')}
                      </PmpButton>
                      <PmpButton
                        type="button"
                        variant="default"
                        disabled={busy}
                        onClick={() =>
                          void handleReloadPlatformPackBinding(activePlatformPackBinding)
                        }
                      >
                        <RefreshCw size={14} />
                        {t('magnet.pluginDevelopmentWorkspace.action.reloadPack')}
                      </PmpButton>
                      <PmpButton
                        type="button"
                        variant="danger"
                        disabled={busy}
                        onClick={() =>
                          void handleDetachPlatformPackBinding(activePlatformPackBinding)
                        }
                      >
                        <Unplug size={14} />
                        {t('common.action.detach')}
                      </PmpButton>
                    </div>
                  ) : null}
                </div>

                {activePlatformPackBinding?.reloadHistory.length ? (
                  <div className="plugin-dev-workspace__reload-history">
                    <div className="plugin-dev-workspace__preview-header">
                      <RefreshCw size={16} />
                      <span>
                        {t('magnet.pluginDevelopmentWorkspace.platformPack.reloadHistory.title')}
                      </span>
                    </div>
                    <div className="plugin-dev-workspace__runtime-list">
                      {activePlatformPackBinding.reloadHistory.slice(0, 4).map((entry) => (
                        <div
                          key={`${entry.at}:${entry.revision}:${entry.status}`}
                          className="plugin-dev-workspace__runtime-card"
                        >
                          <div className="plugin-dev-workspace__runtime-header">
                            <span>
                              {t('magnet.pluginDevelopmentWorkspace.platformPack.reloadHistory.item', {
                                revision: entry.revision,
                                at: formatTimestamp(entry.at),
                              })}
                            </span>
                            <span
                              className={[
                                'plugin-dev-workspace__tag',
                                entry.status === 'error'
                                  ? 'plugin-dev-workspace__tag--error'
                                  : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                            >
                              {entry.status === 'error'
                                ? t('magnet.pluginDevelopmentWorkspace.platformPack.reloadHistory.error')
                                : t('magnet.pluginDevelopmentWorkspace.platformPack.reloadHistory.success')}
                            </span>
                          </div>
                          {entry.message ? (
                            <div className="plugin-dev-workspace__runtime-issues">
                              {entry.message}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="plugin-dev-workspace__runtime-list">
                  {platformPackSource && platformPackSource.diagnostics.length > 0 ? (
                    platformPackSource.diagnostics.map((diagnostic) => (
                      <div key={diagnostic.code} className="plugin-dev-workspace__runtime-card">
                        <div className="plugin-dev-workspace__runtime-header">
                          <span>{diagnostic.code}</span>
                          <span
                            className={[
                              'plugin-dev-workspace__tag',
                              `plugin-dev-workspace__tag--${diagnostic.severity}`,
                            ].join(' ')}
                          >
                            {diagnostic.severity}
                          </span>
                        </div>
                        <div className="plugin-dev-workspace__runtime-issues">
                          {diagnostic.message}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="plugin-dev-workspace__empty">
                      {activePlatformPackBinding?.lastError ??
                        t('magnet.pluginDevelopmentWorkspace.platformPack.diagnosticsEmpty')}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="plugin-dev-workspace__empty">
                {t('magnet.pluginDevelopmentWorkspace.platformPack.empty')}
              </div>
            )}
          </section>
        </div>
      </div>
    );
  }
);
