import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Boxes,
  Bug,
  Code2,
  Library,
  PackagePlus,
  PanelsTopLeft,
  Paintbrush,
  Power,
  type LucideIcon,
} from 'lucide-react';
import {
  removeMagnetCatalogMagnet,
  upsertMagnetCatalogMagnet,
  useOptionalMagnetConfig,
  type MagnetConfigContextValue,
} from '../../modules/magnets';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { useKernel } from '../../contexts/KernelApiContext';
import { GOVERNANCE_SERVICE_TOKEN } from '../../services/governance';
import { NAVIGATION_SERVICE_TOKEN } from '../../services/navigation';
import { useT } from '../../i18n';
import { STORAGE_KEYS, TAURI_EVENTS, broadcastDataUpdate } from '../../utils/windowCommunication';
import {
  getMagnetRenderersRevision,
  listRegisteredMagnetRenderers,
  subscribeMagnetRenderers,
} from '../../magnet-system/registry';
import {
  getMagnetVariantsRevision,
  listMagnetVariants,
  subscribeMagnetVariants,
} from '../../magnet-system/variantRegistry';
import { REQUIRED_MAGNET_IDS } from '../../constants/magnets';
import { getMagnetDisplayName } from '../../modules/magnets/display';
import {
  installPmpsShaderPackFromZipBytes,
  parsePmpsShaderPackFromZipBytes,
} from '../../shader-system/pmps';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import { assignMagnetBindingFragment } from '../../themes/importAdapters';
import { parseThemePackFromZipBytes } from '../../themes/packs/pmpk';
import { parseVariantPresetFromText } from '../../themes/packs/pmpv';
import type { ThemeBindingFragment, ThemeImportCandidate } from '../../themes/types/themeImport';
import {
  openBuiltinPluginPageViaHostCapability,
  openBuiltinPluginWindowViaHostCapability,
  openBuiltinPluginVisualizerViaHostCapability,
  openBuiltinWindowViaHostCapability,
  navigateBuiltinViaHostCapability,
} from '../../builtin-modules/builtinNavigationCapabilityBridge';
import { useConfirmDialog } from '../core/ConfirmDialog';
import { PmpButton, PmpCard, PmpCheckbox, PmpChoiceButton } from '../primitives';
import {
  clearInstalledExtensionQuarantine,
  getInstalledExtensionRecord,
  getInstalledExtensionsRevision,
  installInstalledExtensionFromFilePath,
  listInstalledExtensionCapabilityBindings,
  loadInstalledExtensions,
  parseInstalledExtensionFromFilePath,
  clearInstalledExtensionLastError,
  setInstalledExtensionDeniedCapabilities,
  setInstalledExtensionEnabled,
  subscribeInstalledExtensions,
  uninstallInstalledExtension,
  type InstalledHostExtensionRecord,
} from '../../magnet-system/plugins/extensions';
import { parseExtensionPackFromZipBytes } from '../../magnet-system/plugins/packs/extensionPack';
import {
  cleanupExtensionPackMaterializedSource,
  commitExtensionPackExecutorPreview,
  dryRunExtensionPackExecutorPreview,
} from '../../magnet-system/plugins/packs/extensionPackExecutor';
import type { ExtensionPackMaterializedSource } from '../../magnet-system/plugins/packs/extensionPackExecutor';
import {
  parseExperiencePackFromZipBytes,
  type ExperiencePackExecutorPreview,
} from '../../magnet-system/plugins/packs/experiencePack';
import {
  cleanupExperiencePackExecutorDryRun,
  commitExperiencePackExecutorPreview,
  dryRunExperiencePackExecutorPreview,
} from '../../magnet-system/plugins/packs/experiencePackExecutor';
import type {
  InstallPlanEmbeddedResourceSource,
  InstallPlanExecutorDryRunResult,
} from '../../magnet-system/plugins/packs/installPlanExecutorTypes';
import { buildPackageImportPreviewText } from './PackageImportPreview';
import { resolveInstalledExtensionRuntime } from '../../magnet-system/plugins/runtime';
import {
  INSTALLED_EXTENSION_COMMAND_LAUNCHERS,
  INSTALLED_EXTENSION_VIEW_LAUNCHERS,
} from '../../magnet-system/plugins/runtime/installedExtensionHostLaunchers';
import {
  clearInstalledExtensionAuditLog,
  getInstalledExtensionAuditRevision,
  readInstalledExtensionAuditLog,
  subscribeInstalledExtensionAudit,
  type InstalledExtensionAuditEvent,
} from '../../magnet-system/plugins/extensionsGovernance';
import {
  createMagnetTemplateFromInstalledExtension,
  readInstalledExtensionPmpHostContributions,
  supportsInstalledExtensionMagnetSurface,
} from '../../magnet-system/plugins/installedExtensionHostPmp';
import type {
  PluginRuntimeResolution,
  PluginRuntimeSurfaceKind,
} from '../../magnet-system/plugins/runtime';
import {
  detachPluginDevSession,
  getPluginDevSessionsRevision,
  loadPluginDevSessions,
  refreshPluginDevSession,
  subscribePluginDevSessions,
  type PluginDevSessionRecord,
} from '../../magnet-system/plugins/devSessionRegistry';
import {
  PLUGIN_STUDIO_WORKSPACES,
  buildPluginStudioDiagnostics,
  buildPluginStudioMetrics,
  getPluginStudioDiagnosticAreaLabelKey,
  getPluginStudioDiagnosticSeverityLabelKey,
  readInstalledExtensionDisplayName,
  resolveMagnetRendererId,
  type PluginStudioDiagnostic,
  type PluginStudioWorkspaceId,
} from './pluginStudioModel';

const PLUGIN_STUDIO_WORKSPACE_ICONS: Record<PluginStudioWorkspaceId, LucideIcon> = {
  activation: Power,
  displays: PanelsTopLeft,
  installed: Boxes,
  'package-import': PackagePlus,
  developer: Code2,
  magnets: Library,
  appearance: Paintbrush,
  diagnostics: Bug,
};

function getInstalledExtensionPrimarySurfaceKind(
  record: InstalledHostExtensionRecord
): PluginRuntimeSurfaceKind {
  const hostContributions = readInstalledExtensionPmpHostContributions(record);

  if ((hostContributions?.settingsPanels?.length ?? 0) > 0) {
    return 'settings';
  }
  if ((hostContributions?.pages?.length ?? 0) > 0) {
    return 'page';
  }
  if ((hostContributions?.windows?.length ?? 0) > 0) {
    return 'window';
  }
  if ((hostContributions?.visualizers?.length ?? 0) > 0) {
    return 'visualizer';
  }
  if (hostContributions?.magnets) {
    return 'magnet';
  }
  if ((record.manifest.contributes?.core?.commands?.length ?? 0) > 0) {
    return 'command';
  }
  if ((record.manifest.contributes?.core?.keybindings?.length ?? 0) > 0) {
    return 'command';
  }
  return 'command';
}

function collectRegisteredRendererIds(
  additionalExtensions: InstalledHostExtensionRecord[] = []
): Set<string> {
  const rendererIds = new Set(listRegisteredMagnetRenderers().map((renderer) => renderer.id));
  for (const extension of additionalExtensions) {
    if (supportsInstalledExtensionMagnetSurface(extension)) {
      rendererIds.add(extension.manifest.identity.id);
    }
  }
  return rendererIds;
}

function formatInstalledExtensionAuditEvent(event: InstalledExtensionAuditEvent): string {
  if (event.type === 'permission-denied') {
    return `[denied] ${event.hostLabel} ${event.capability} ${event.action}`;
  }
  if (event.type === 'crash') {
    return `[crash:${event.surface}] ${event.message}`;
  }
  if (event.type === 'runtime-unresponsive') {
    return `[hang:${event.surface}] timeout=${event.timeoutMs}ms`;
  }
  if (event.type === 'quarantined') {
    return `[quarantined:${event.surface}] ${event.message}`;
  }
  if (event.type === 'quarantine-cleared') {
    return `[quarantine-cleared] ${event.reason ?? ''}`.trim();
  }
  if (event.type === 'runtime-restart') {
    return `[restart] ${event.reason ?? ''}`.trim();
  }
  if (event.type === 'enabled') {
    return '[enabled]';
  }
  if (event.type === 'disabled') {
    return `[disabled] ${event.reason ?? ''}`.trim();
  }
  if (event.type === 'capabilities-updated') {
    return `[capabilities] denied=${event.deniedCapabilities.join(',') || '(none)'}`;
  }
  if (event.type === 'installed') {
    return `[installed] ${event.publisher} ${event.version}${event.updated ? ' (updated)' : ''}`;
  }
  if (event.type === 'uninstalled') {
    return '[uninstalled]';
  }
  if (event.type === 'errors-cleared') {
    return '[errors-cleared]';
  }
  if (event.type === 'audio-input-adapter-provider-quarantined') {
    return `[audio-provider-quarantined] ${event.providerId} failures=${event.consecutiveFailures}`;
  }
  if (event.type === 'audio-input-adapter-provider-quarantine-cleared') {
    return `[audio-provider-quarantine-cleared] ${event.providerId ?? 'all'} ${event.reason}`;
  }
  if (event.type === 'audio-input-adapter-selected') {
    return `[audio-selected] ${event.adapterKind}:${event.adapterId} -> ${event.selectedInputId}`;
  }
  if (event.type === 'audio-input-adapter-fallback') {
    return `[audio-fallback] ${event.fromProviderId} -> ${event.toAdapterKind}:${event.toAdapterId}`;
  }
  if (event.type === 'audio-input-adapter-session-closed') {
    return `[audio-session-closed] ${event.sessionId} ${event.reason}`;
  }
  return '[event]';
}

function buildRuntimePresentation(
  t: (key: string, params?: Record<string, unknown>) => string,
  runtimeResolution: PluginRuntimeResolution | null
): {
  runtimeSourceLabel: string | null;
  runtimeProjectionTitle: string;
} {
  const runtimeSourceLabel =
    runtimeResolution?.status === 'resolved'
      ? runtimeResolution.source === 'dev-session'
        ? t('settings.plugins.tag.runtimeSourceDev')
        : t('settings.plugins.tag.runtimeSourceManifest')
      : null;

  if (!runtimeResolution) {
    return {
      runtimeSourceLabel,
      runtimeProjectionTitle: t('settings.plugins.tag.runtimeMissing'),
    };
  }

  if (runtimeResolution.status === 'resolved') {
    return {
      runtimeSourceLabel,
      runtimeProjectionTitle: [
        t('settings.plugins.tag.runtimeResolved', {
          runtimeId: runtimeResolution.runtime.runtimeId,
        }),
        runtimeSourceLabel,
        t('settings.plugins.tag.launcher', {
          launcherId: runtimeResolution.launcher.id,
        }),
        t('settings.plugins.tag.transport', {
          transport: runtimeResolution.launcher.transport,
        }),
        ...runtimeResolution.issues.map((issue) => t('settings.plugins.runtime.issue', { issue })),
      ]
        .filter((line): line is string => typeof line === 'string' && line.length > 0)
        .join('\n'),
    };
  }

  return {
    runtimeSourceLabel,
    runtimeProjectionTitle: [
      t('settings.plugins.tag.runtimeBlocked'),
      runtimeResolution.candidateLaunchers.length > 0
        ? t('settings.plugins.runtime.candidates', {
            launchers: runtimeResolution.candidateLaunchers
              .map((launcher) => launcher.id)
              .join(', '),
          })
        : null,
      ...runtimeResolution.issues.map((issue) => t('settings.plugins.runtime.issue', { issue })),
    ]
      .filter((line): line is string => typeof line === 'string' && line.length > 0)
      .join('\n'),
  };
}

function formatSettingsTimestamp(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '-';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '-';
  }
}

function formatDevSessionRestartSummary(
  t: (key: string, params?: Record<string, unknown>) => string,
  session: PluginDevSessionRecord
): string {
  if (!session.lastRestartReason) {
    return '-';
  }
  return t('settings.plugins.devSession.lastRestartValue', {
    reason: session.lastRestartReason,
    at: formatSettingsTimestamp(session.lastRestartAt),
  });
}

function formatDiagnosticLines(
  diagnostics: Array<{ severity: string; code: string; message: string }>
): string {
  return diagnostics
    .map((diagnostic) => `[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`)
    .join('\n');
}

function resolvePromptSpaceModeAsCreateNewSpaces(
  preview: ExperiencePackExecutorPreview
): ExperiencePackExecutorPreview {
  return {
    ...preview,
    plan: {
      ...preview.plan,
      steps: preview.plan.steps.map((step) =>
        step.kind === 'apply-space-layout' && step.mode === 'prompt'
          ? { ...step, mode: 'create-new-spaces' }
          : step
      ),
    },
  };
}

type PackageImportReport = {
  id: string;
  kind: 'manifest-v2' | 'pmpe' | 'pmpex' | 'pmpt' | 'pmpk-theme' | 'pmpv' | 'pmps';
  title: string;
  status: 'ready' | 'installed' | 'blocked' | 'cancelled';
  detail: string;
  diagnostics: Array<{ severity: string; code: string; message: string }>;
  createdAt: number;
};

type StagedContractPackage = {
  id: string;
  kind: PackageImportReport['kind'];
  title: string;
  version?: string;
  status: 'ready' | 'needs-input';
  detail: string;
  diagnostics: PackageImportReport['diagnostics'];
  apply: () => Promise<boolean>;
  discard: () => Promise<void>;
};

function getPackageReportStatusKey(status: PackageImportReport['status']): string {
  switch (status) {
    case 'ready':
      return 'settings.plugins.studio.package.report.status.ready';
    case 'installed':
      return 'settings.plugins.studio.package.report.status.installed';
    case 'blocked':
      return 'settings.plugins.studio.package.report.status.blocked';
    case 'cancelled':
      return 'settings.plugins.studio.package.report.status.cancelled';
    default:
      return 'settings.plugins.studio.package.report.status.blocked';
  }
}

function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function parseThemeContract(text: string): ThemeImportCandidate {
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('theme must be an object');
  }
  const candidate = value as Record<string, unknown>;
  for (const field of ['id', 'name', 'version'] as const) {
    if (typeof candidate[field] !== 'string' || candidate[field].trim().length === 0) {
      throw new Error(`theme.${field} is required`);
    }
  }
  for (const field of ['pixel', 'background', 'fonts'] as const) {
    const part = candidate[field];
    if (!part || typeof part !== 'object' || Array.isArray(part)) {
      throw new Error(`theme.${field} must be an object`);
    }
  }
  return value as ThemeImportCandidate;
}

export type PluginRegistrationMagnetContext = Pick<
  MagnetConfigContextValue,
  'activeMagnetIds' | 'activateMagnet' | 'deactivateMagnet' | 'magnetLibrary' | 'setMagnetLibrary'
>;

export type PluginsSettingsPanelProps = {
  magnetContext?: PluginRegistrationMagnetContext;
  embeddedInRegistrationCenter?: boolean;
  onOpenAppearanceWorkbench?: () => void;
};

export function PluginsSettingsPanel({
  magnetContext,
  embeddedInRegistrationCenter = false,
  onOpenAppearanceWorkbench,
}: PluginsSettingsPanelProps = {}) {
  const kernel = useKernel();
  const t = useT();
  const { theme, applyTheme } = useTheme();
  const governance = kernel.services.getOptional(GOVERNANCE_SERVICE_TOKEN);
  const navigationService = kernel.services.get(NAVIGATION_SERVICE_TOKEN);
  const inheritedMagnetContext = useOptionalMagnetConfig();
  const resolvedMagnetContext = magnetContext ?? inheritedMagnetContext;
  if (!resolvedMagnetContext) {
    throw new Error(
      'PluginsSettingsPanel requires a magnetContext or a surrounding MagnetLibraryProvider'
    );
  }
  const { activeMagnetIds, activateMagnet, deactivateMagnet, magnetLibrary, setMagnetLibrary } =
    resolvedMagnetContext;
  const isTauri = isTauriRuntime();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspace] =
    useState<PluginStudioWorkspaceId>('package-import');
  const [selectedMagnetId, setSelectedMagnetId] = useState<string | null>(null);
  const [packageReports, setPackageReports] = useState<PackageImportReport[]>([]);
  const [stagedPackages, setStagedPackages] = useState<StagedContractPackage[]>([]);
  const stagedPackagesRef = useRef<StagedContractPackage[]>([]);
  stagedPackagesRef.current = stagedPackages;
  const extensionStoreRevision = useSyncExternalStore(
    subscribeInstalledExtensions,
    getInstalledExtensionsRevision,
    getInstalledExtensionsRevision
  );
  const extensionAuditRevision = useSyncExternalStore(
    subscribeInstalledExtensionAudit,
    getInstalledExtensionAuditRevision,
    getInstalledExtensionAuditRevision
  );
  const devSessionRevision = useSyncExternalStore(
    subscribePluginDevSessions,
    getPluginDevSessionsRevision,
    getPluginDevSessionsRevision
  );
  const rendererRegistryRevision = useSyncExternalStore(
    subscribeMagnetRenderers,
    getMagnetRenderersRevision,
    getMagnetRenderersRevision
  );
  const variantRegistryRevision = useSyncExternalStore(
    subscribeMagnetVariants,
    getMagnetVariantsRevision,
    getMagnetVariantsRevision
  );

  const installedExtensionsV2 = useMemo(() => {
    void extensionStoreRevision;
    return loadInstalledExtensions();
  }, [extensionStoreRevision]);
  const displayExtensions = useMemo(
    () =>
      installedExtensionsV2.filter((record) => {
        if (record.enabled === false || record.disabledReason === 'quarantine') return false;
        const host = readInstalledExtensionPmpHostContributions(record);
        return Boolean(
          host?.pages?.length ||
            host?.windows?.length ||
            host?.visualizers?.length ||
            supportsInstalledExtensionMagnetSurface(record)
        );
      }),
    [installedExtensionsV2]
  );

  const installedExtensionAuditLog = useMemo(() => {
    void extensionAuditRevision;
    return readInstalledExtensionAuditLog();
  }, [extensionAuditRevision]);
  const pluginDevSessions = useMemo(() => {
    void devSessionRevision;
    return loadPluginDevSessions();
  }, [devSessionRevision]);
  const pluginDevSessionById = useMemo(
    () => new Map(pluginDevSessions.map((session) => [session.pluginId, session] as const)),
    [pluginDevSessions]
  );
  const registeredRenderers = useMemo(() => {
    void rendererRegistryRevision;
    return listRegisteredMagnetRenderers();
  }, [rendererRegistryRevision]);
  const variantsByRendererId = useMemo(() => {
    void variantRegistryRevision;
    const entries = registeredRenderers.map(
      (renderer) => [renderer.id, listMagnetVariants(renderer.id)] as const
    );
    return new Map(entries);
  }, [registeredRenderers, variantRegistryRevision]);

  const runtimeResolutionByExtensionId = useMemo(() => {
    void devSessionRevision;
    return new Map(
      installedExtensionsV2.map((record) => {
        const surfaceKind = getInstalledExtensionPrimarySurfaceKind(record);
        const supportedLauncherIds =
          surfaceKind === 'command'
            ? [...INSTALLED_EXTENSION_COMMAND_LAUNCHERS]
            : [...INSTALLED_EXTENSION_VIEW_LAUNCHERS];

        return [
          record.manifest.identity.id,
          resolveInstalledExtensionRuntime(record, {
            hostId: 'pmp',
            surfaceKind,
            preferCommandWorker: surfaceKind === 'command',
            supportedLauncherIds,
          }),
        ] as const;
      })
    );
  }, [devSessionRevision, installedExtensionsV2]);

  const selectedMagnet = useMemo(() => {
    if (selectedMagnetId) {
      const found = magnetLibrary.find((magnet) => magnet.id === selectedMagnetId);
      if (found) return found;
    }
    return magnetLibrary[0] ?? null;
  }, [magnetLibrary, selectedMagnetId]);

  useEffect(() => {
    if (!selectedMagnet && selectedMagnetId !== null) {
      setSelectedMagnetId(null);
      return;
    }
    if (selectedMagnet && selectedMagnet.id !== selectedMagnetId) {
      setSelectedMagnetId(selectedMagnet.id);
    }
  }, [selectedMagnet, selectedMagnetId]);

  const studioDiagnostics = useMemo(
    () =>
      buildPluginStudioDiagnostics({
        installedExtensions: installedExtensionsV2,
        runtimeResolutionByExtensionId,
        devSessions: pluginDevSessions,
        auditLog: installedExtensionAuditLog,
        magnetLibrary,
        activeMagnetIds,
        registeredRenderers,
        variantsByRendererId,
      }),
    [
      activeMagnetIds,
      installedExtensionAuditLog,
      installedExtensionsV2,
      magnetLibrary,
      pluginDevSessions,
      registeredRenderers,
      runtimeResolutionByExtensionId,
      variantsByRendererId,
    ]
  );

  const studioMetrics = useMemo(
    () =>
      buildPluginStudioMetrics({
        installedExtensions: installedExtensionsV2,
        devSessions: pluginDevSessions,
        magnetLibrary,
        activeMagnetIds,
        diagnostics: studioDiagnostics,
      }),
    [activeMagnetIds, installedExtensionsV2, magnetLibrary, pluginDevSessions, studioDiagnostics]
  );

  const selectedMagnetRendererId = selectedMagnet ? resolveMagnetRendererId(selectedMagnet) : null;
  const selectedMagnetDisplayName = selectedMagnet ? getMagnetDisplayName(selectedMagnet, t) : null;
  const selectedMagnetVariants = selectedMagnetRendererId
    ? (variantsByRendererId.get(selectedMagnetRendererId) ?? [])
    : [];

  const restartInstalledExtensionRuntime = useCallback(
    (pluginId: string, reason: string) => {
      governance?.restartInstalledExtensionRuntime(pluginId, { reason });
    },
    [governance]
  );

  const pushPackageReport = useCallback((report: Omit<PackageImportReport, 'id' | 'createdAt'>) => {
    setPackageReports((current) =>
      [
        {
          ...report,
          id: `${Date.now()}:${report.kind}:${current.length}`,
          createdAt: Date.now(),
        },
        ...current,
      ].slice(0, 8)
    );
  }, []);

  const stageContractPackage = useCallback(
    (staged: Omit<StagedContractPackage, 'id'>) => {
      const item: StagedContractPackage = {
        ...staged,
        id: `${Date.now()}:${staged.kind}:${Math.random().toString(36).slice(2, 8)}`,
      };
      setStagedPackages((current) => [item, ...current]);
      return item;
    },
    []
  );

  const handleApplyStagedPackage = useCallback(
    async (stagedId: string) => {
      if (busy) return;
      const staged = stagedPackages.find((item) => item.id === stagedId);
      if (!staged) return;

      setBusy(true);
      setError(null);
      try {
        const applied = await staged.apply();
        if (applied) {
          setStagedPackages((current) => current.filter((item) => item.id !== stagedId));
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [busy, stagedPackages]
  );

  const handleDiscardStagedPackage = useCallback(
    async (stagedId: string) => {
      if (busy) return;
      const staged = stagedPackages.find((item) => item.id === stagedId);
      if (!staged) return;

      setBusy(true);
      setError(null);
      try {
        await staged.discard();
        setStagedPackages((current) => current.filter((item) => item.id !== stagedId));
        pushPackageReport({
          kind: staged.kind,
          title: staged.title,
          status: 'cancelled',
          detail: t('settings.plugins.studio.package.report.cancelledByUser'),
          diagnostics: staged.diagnostics,
        });
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [busy, pushPackageReport, stagedPackages, t]
  );

  useEffect(
    () => () => {
      for (const staged of stagedPackagesRef.current) {
        void staged.discard();
      }
    },
    []
  );

  const openInstalledExtensionPage = useCallback(
    async (pluginId: string, pageId: string) => {
      setError(null);
      try {
        await openBuiltinPluginPageViaHostCapability(
          navigationService,
          {
            pluginId,
            pageId,
            sourceKind: 'extv2',
          },
          'settings.plugins:open-installed-extension-page'
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [navigationService]
  );

  const openInstalledExtensionVisualizer = useCallback(
    async (pluginId: string, visualizerId: string) => {
      setError(null);
      try {
        await openBuiltinPluginVisualizerViaHostCapability(
          navigationService,
          {
            pluginId,
            visualizerId,
            sourceKind: 'extv2',
          },
          'settings.plugins:open-installed-extension-visualizer'
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [navigationService]
  );

  const openInstalledExtensionWindow = useCallback(
    async (options: {
      pluginId: string;
      windowId: string;
      title: string;
      width?: number;
      height?: number;
    }) => {
      setError(null);
      try {
        await openBuiltinPluginWindowViaHostCapability(
          navigationService,
          {
            sourceKind: 'extv2',
            pluginId: options.pluginId,
            windowId: options.windowId,
            title: options.title,
            width: options.width,
            height: options.height,
          },
          'settings.plugins:open-installed-extension-window'
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [navigationService]
  );

  const addInstalledExtensionMagnetToCurrentSpace = useCallback(
    (record: InstalledHostExtensionRecord) => {
      if (!supportsInstalledExtensionMagnetSurface(record)) {
        return;
      }

      setError(null);
      const magnet = createMagnetTemplateFromInstalledExtension(record);
      upsertMagnetCatalogMagnet(magnet);
      setMagnetLibrary((prev) => {
        if (prev.some((item) => item.id === magnet.id)) {
          return prev;
        }
        return [...prev, magnet];
      });
      activateMagnet(magnet.id);
    },
    [activateMagnet, setMagnetLibrary]
  );

  const handleStageAppearanceContract = useCallback(async () => {
    if (!isTauri) {
      setError(t('settings.plugins.v2.install.requireTauri'));
      return;
    }
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const [dialog, fs] = await Promise.all([
        import('@tauri-apps/api/dialog'),
        import('@tauri-apps/api/fs'),
      ]);
      const selected = await dialog.open({
        multiple: false,
        filters: [
          {
            name: t('settings.plugins.studio.registration.appearanceFilter'),
            extensions: ['pmpt', 'pmpk', 'pmpv', 'pmps'],
          },
        ],
      });
      if (!selected) return;
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof filePath !== 'string') {
        throw new Error(t('settings.plugins.v2.install.error.invalidFilePath'));
      }
      const extension = filePath.split('.').pop()?.toLowerCase();

      if (extension === 'pmpt') {
        const parsed = parseThemeContract(await fs.readTextFile(filePath));
        const detail = t('settings.plugins.studio.registration.contractSummary', {
          type: '.pmpt',
          id: parsed.id,
          version: parsed.version,
        });
        stageContractPackage({
          kind: 'pmpt',
          title: parsed.name,
          version: parsed.version,
          status: 'ready',
          detail,
          diagnostics: [],
          discard: async () => undefined,
          apply: async () => {
            const ok = await confirm({
              title: t('settings.plugins.studio.activation.confirm.title'),
              message: detail,
              confirmText: t('common.action.apply'),
              cancelText: t('common.action.cancel'),
            });
            if (!ok) return false;
            await applyTheme(parsed);
            pushPackageReport({
              kind: 'pmpt',
              title: parsed.name,
              status: 'installed',
              detail: t('settings.plugins.studio.package.report.contractApplied', {
                type: '.pmpt',
                id: parsed.id,
              }),
              diagnostics: [],
            });
            return true;
          },
        });
        return;
      }

      if (extension === 'pmpv') {
        const parsed = parseVariantPresetFromText(await fs.readTextFile(filePath));
        const detail = t('settings.plugins.studio.registration.variantSummary', {
          id: parsed.metadata.id,
          version: parsed.metadata.version,
          rendererId: parsed.target.rendererId,
        });
        stageContractPackage({
          kind: 'pmpv',
          title: parsed.metadata.name,
          version: parsed.metadata.version,
          status: 'ready',
          detail,
          diagnostics: [],
          discard: async () => undefined,
          apply: async () => {
            const ok = await confirm({
              title: t('settings.plugins.studio.activation.confirm.title'),
              message: detail,
              confirmText: t('common.action.apply'),
              cancelText: t('common.action.cancel'),
            });
            if (!ok) return false;
            await applyTheme(
              assignMagnetBindingFragment(
                theme,
                parsed.target.rendererId,
                parsed.fragment as ThemeBindingFragment
              )
            );
            pushPackageReport({
              kind: 'pmpv',
              title: parsed.metadata.name,
              status: 'installed',
              detail: t('settings.plugins.studio.package.report.contractApplied', {
                type: '.pmpv',
                id: parsed.metadata.id,
              }),
              diagnostics: [],
            });
            return true;
          },
        });
        return;
      }

      const bytes = new Uint8Array(await fs.readBinaryFile(filePath));
      if (extension === 'pmps') {
        const parsed = await parsePmpsShaderPackFromZipBytes(bytes);
        const metadata = parsed.manifest.metadata;
        const detail = t('settings.plugins.studio.registration.contractSummary', {
          type: '.pmps',
          id: metadata.id,
          version: metadata.version,
        });
        stageContractPackage({
          kind: 'pmps',
          title: metadata.name,
          version: metadata.version,
          status: 'ready',
          detail,
          diagnostics: [],
          discard: async () => undefined,
          apply: async () => {
            const ok = await confirm({
              title: t('settings.plugins.studio.activation.confirm.title'),
              message: detail,
              confirmText: t('common.action.apply'),
              cancelText: t('common.action.cancel'),
            });
            if (!ok) return false;
            await installPmpsShaderPackFromZipBytes(bytes);
            pushPackageReport({
              kind: 'pmps',
              title: metadata.name,
              status: 'installed',
              detail: t('settings.plugins.studio.package.report.contractApplied', {
                type: '.pmps',
                id: metadata.id,
              }),
              diagnostics: [],
            });
            return true;
          },
        });
        return;
      }

      if (extension === 'pmpk') {
        const parsed = await parseThemePackFromZipBytes(bytes);
        if (!parsed.entryThemeText) {
          throw new Error(t('settings.plugins.studio.registration.themePackMissingTheme'));
        }
        const themeContract = parseThemeContract(parsed.entryThemeText);
        const metadata = parsed.manifest.metadata;
        const detail = t('settings.plugins.studio.registration.themePackSummary', {
          id: metadata.id,
          version: metadata.version,
          dependencies: parsed.dependencies.length,
        });
        stageContractPackage({
          kind: 'pmpk-theme',
          title: metadata.name,
          version: metadata.version,
          status: 'ready',
          detail,
          diagnostics: parsed.dependencies
            .filter((dependency) => Boolean(dependency.bundleMetaError))
            .map((dependency) => ({
              severity: 'warning',
              code: 'theme-pack.dependency.invalid',
              message: `${dependency.id}: ${dependency.bundleMetaError}`,
            })),
          discard: async () => undefined,
          apply: async () => {
            const ok = await confirm({
              title: t('settings.plugins.studio.activation.confirm.title'),
              message: detail,
              confirmText: t('common.action.apply'),
              cancelText: t('common.action.cancel'),
            });
            if (!ok) return false;
            for (const dependency of parsed.dependencies) {
              if (dependency.bundleBytes && !dependency.bundleMetaError) {
                await installPmpsShaderPackFromZipBytes(dependency.bundleBytes);
              }
            }
            await applyTheme(themeContract);
            pushPackageReport({
              kind: 'pmpk-theme',
              title: metadata.name,
              status: 'installed',
              detail: t('settings.plugins.studio.package.report.contractApplied', {
                type: '.pmpk',
                id: metadata.id,
              }),
              diagnostics: [],
            });
            return true;
          },
        });
        return;
      }

      throw new Error(t('settings.plugins.studio.registration.unsupportedContract'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      pushPackageReport({
        kind: 'pmpt',
        title: t('settings.plugins.studio.registration.appearanceContract'),
        status: 'blocked',
        detail: message,
        diagnostics: [],
      });
    } finally {
      setBusy(false);
    }
  }, [applyTheme, busy, confirm, isTauri, pushPackageReport, stageContractPackage, t, theme]);

  const handleStageManifestV2 = useCallback(async () => {
    if (!isTauri) {
      setError(t('settings.plugins.v2.install.requireTauri'));
      return;
    }
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const dialog = await import('@tauri-apps/api/dialog');
      const selected = await dialog.open({
        multiple: false,
        filters: [
          { name: t('settings.plugins.v2.install.filePickerFilter'), extensions: ['json'] },
        ],
      });
      if (!selected) return;
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof filePath !== 'string') {
        throw new Error(t('settings.plugins.v2.install.error.invalidFilePath'));
      }

      const parsed = await parseInstalledExtensionFromFilePath(filePath);
      const isUpdate = Boolean(getInstalledExtensionRecord(parsed.manifest.identity.id));
      const contributesMagnet = supportsInstalledExtensionMagnetSurface(parsed);
      if (
        contributesMagnet &&
        !isUpdate &&
        magnetLibrary.some((magnet) => magnet.id === parsed.manifest.identity.id)
      ) {
        throw new Error(
          t('settings.plugins.v2.install.error.magnetIdExists', {
            id: parsed.manifest.identity.id,
          })
        );
      }
      const capabilities = listInstalledExtensionCapabilityBindings(parsed);
      const confirmText = [
        t('settings.plugins.v2.install.confirm.extension', {
          name: readInstalledExtensionDisplayName(parsed),
        }),
        t('settings.plugins.v2.install.confirm.idVersion', {
          id: parsed.manifest.identity.id,
          version: parsed.manifest.identity.version,
        }),
        t('settings.plugins.v2.install.confirm.publisher', {
          publisher: parsed.manifest.identity.publisher,
        }),
        parsed.manifest.identity.description
          ? t('settings.plugins.v2.install.confirm.description', {
              description: parsed.manifest.identity.description,
            })
          : null,
        '',
        t('settings.plugins.v2.install.confirm.hostTargets', {
          targets: parsed.manifest.hostTargets.map((target) => target.hostId).join(', '),
        }),
        t('settings.plugins.v2.install.confirm.runtimes', {
          runtimes: parsed.manifest.runtimes.map((runtime) => runtime.runtimeId).join(', '),
        }),
        '',
        t('settings.plugins.v2.install.confirm.capabilitiesTitle'),
        capabilities.length > 0
          ? capabilities.map((binding) => `- ${binding.capabilityId}`).join('\n')
          : t('settings.plugins.v2.install.confirm.capabilitiesNone'),
        '',
        isUpdate
          ? t('settings.plugins.v2.install.confirm.updatePrompt')
          : t('settings.plugins.v2.install.confirm.prompt'),
      ]
        .filter((line): line is string => typeof line === 'string' && line.length > 0)
        .join('\n');

      stageContractPackage({
        kind: 'manifest-v2',
        title: readInstalledExtensionDisplayName(parsed),
        version: parsed.manifest.identity.version,
        status: 'ready',
        detail: confirmText,
        diagnostics: [],
        discard: async () => undefined,
        apply: async () => {
          const ok = await confirm({
            title: t('settings.plugins.v2.install.confirm.title'),
            message: confirmText,
            confirmText: t('common.action.install'),
            cancelText: t('common.action.cancel'),
          });
          if (!ok) return false;

          const installed = await installInstalledExtensionFromFilePath(filePath);
          pushPackageReport({
            kind: 'manifest-v2',
            title: readInstalledExtensionDisplayName(installed),
            status: 'installed',
            detail: t('settings.plugins.studio.package.report.manifestInstalled', {
              id: installed.manifest.identity.id,
              version: installed.manifest.identity.version,
            }),
            diagnostics: [],
          });
          if (supportsInstalledExtensionMagnetSurface(installed)) {
            const template = createMagnetTemplateFromInstalledExtension(installed);
            upsertMagnetCatalogMagnet(template);
            setMagnetLibrary((current) =>
              current.some((magnet) => magnet.id === installed.manifest.identity.id)
                ? current
                : [...current, template]
            );
          }
          return true;
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      pushPackageReport({
        kind: 'manifest-v2',
        title: t('settings.plugins.studio.package.report.manifestTitle'),
        status: 'blocked',
        detail: message,
        diagnostics: [],
      });
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    confirm,
    isTauri,
    magnetLibrary,
    pushPackageReport,
    stageContractPackage,
    setMagnetLibrary,
    t,
  ]);

  const handleStageExtensionPack = useCallback(async () => {
    if (!isTauri) {
      setError(t('settings.plugins.v2.install.requireTauri'));
      return;
    }
    if (busy) return;

    setBusy(true);
    setError(null);
    let pendingMaterializedSource: ExtensionPackMaterializedSource | null = null;

    try {
      const [dialog, fs] = await Promise.all([
        import('@tauri-apps/api/dialog'),
        import('@tauri-apps/api/fs'),
      ]);
      const selected = await dialog.open({
        multiple: false,
        filters: [
          { name: t('settings.plugins.pmpe.install.filePickerFilter'), extensions: ['pmpe'] },
        ],
      });
      if (!selected) return;
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof filePath !== 'string') {
        throw new Error(t('settings.plugins.pmpe.install.error.invalidFilePath'));
      }

      const packBytes = await fs.readBinaryFile(filePath);
      const parsed = await parseExtensionPackFromZipBytes(new Uint8Array(packBytes));
      const previewRecord: InstalledHostExtensionRecord = {
        manifest: parsed.extensionManifest,
        installedAt: Date.now(),
        packageDigest: parsed.executorPreview.installSource.packageDigest,
        enabled: true,
      };
      const isUpdate = Boolean(getInstalledExtensionRecord(parsed.extensionManifest.identity.id));
      const contributesMagnet = supportsInstalledExtensionMagnetSurface(previewRecord);
      if (
        contributesMagnet &&
        !isUpdate &&
        magnetLibrary.some((magnet) => magnet.id === parsed.extensionManifest.identity.id)
      ) {
        throw new Error(
          t('settings.plugins.v2.install.error.magnetIdExists', {
            id: parsed.extensionManifest.identity.id,
          })
        );
      }

      const dryRun = await dryRunExtensionPackExecutorPreview(parsed.executorPreview);
      pendingMaterializedSource = dryRun.materializedSource;
      if (dryRun.status !== 'ready') {
        throw new Error(
          t('settings.plugins.pmpe.install.error.dryRunBlocked', {
            diagnostics: formatDiagnosticLines(dryRun.diagnostics),
          })
        );
      }
      const capabilities = listInstalledExtensionCapabilityBindings(previewRecord);
      const confirmText = [
        t('settings.plugins.pmpe.install.confirm.package', {
          name: parsed.manifest.metadata.name,
          id: parsed.manifest.metadata.id,
          version: parsed.manifest.metadata.version,
        }),
        t('settings.plugins.v2.install.confirm.extension', {
          name: readInstalledExtensionDisplayName(previewRecord),
        }),
        t('settings.plugins.v2.install.confirm.idVersion', {
          id: parsed.extensionManifest.identity.id,
          version: parsed.extensionManifest.identity.version,
        }),
        t('settings.plugins.v2.install.confirm.publisher', {
          publisher: parsed.extensionManifest.identity.publisher,
        }),
        parsed.extensionManifest.identity.description
          ? t('settings.plugins.v2.install.confirm.description', {
              description: parsed.extensionManifest.identity.description,
            })
          : null,
        '',
        t('settings.plugins.v2.install.confirm.hostTargets', {
          targets: parsed.extensionManifest.hostTargets.map((target) => target.hostId).join(', '),
        }),
        t('settings.plugins.v2.install.confirm.runtimes', {
          runtimes: parsed.extensionManifest.runtimes
            .map((runtime) => runtime.runtimeId)
            .join(', '),
        }),
        t('settings.plugins.pmpe.install.confirm.dryRun', {
          files: dryRun.materializedSource.fileCount,
          bytes: dryRun.materializedSource.totalBytes,
        }),
        '',
        t('settings.plugins.v2.install.confirm.capabilitiesTitle'),
        capabilities.length > 0
          ? capabilities.map((binding) => `- ${binding.capabilityId}`).join('\n')
          : t('settings.plugins.v2.install.confirm.capabilitiesNone'),
        '',
        isUpdate
          ? t('settings.plugins.v2.install.confirm.updatePrompt')
          : t('settings.plugins.v2.install.confirm.prompt'),
      ]
        .filter((line): line is string => typeof line === 'string' && line.length > 0)
        .join('\n');

      let consumed = false;
      stageContractPackage({
        kind: 'pmpe',
        title: parsed.manifest.metadata.name,
        version: parsed.manifest.metadata.version,
        status: 'ready',
        detail: confirmText,
        diagnostics: dryRun.diagnostics,
        discard: async () => {
          if (consumed) return;
          consumed = true;
          await cleanupExtensionPackMaterializedSource(dryRun.materializedSource);
        },
        apply: async () => {
          const ok = await confirm({
            title: t('settings.plugins.pmpe.install.confirm.title'),
            message: confirmText,
            confirmText: t('common.action.install'),
            cancelText: t('common.action.cancel'),
          });
          if (!ok) return false;

          const commit = await commitExtensionPackExecutorPreview(parsed.executorPreview, {
            dryRun,
          });
          if (commit.status !== 'installed' || !commit.installedExtension) {
            throw new Error(
              t('settings.plugins.pmpe.install.error.commitBlocked', {
                diagnostics: formatDiagnosticLines(commit.diagnostics),
              })
            );
          }
          consumed = true;
          const installed = commit.installedExtension;
          pushPackageReport({
            kind: 'pmpe',
            title: parsed.manifest.metadata.name,
            status: 'installed',
            detail: t('settings.plugins.studio.package.report.pmpeInstalled', {
              id: installed.manifest.identity.id,
              version: installed.manifest.identity.version,
            }),
            diagnostics: commit.diagnostics,
          });
          if (supportsInstalledExtensionMagnetSurface(installed)) {
            const template = createMagnetTemplateFromInstalledExtension(installed);
            upsertMagnetCatalogMagnet(template);
            setMagnetLibrary((current) =>
              current.some((magnet) => magnet.id === installed.manifest.identity.id)
                ? current
                : [...current, template]
            );
          }
          return true;
        },
      });
      pendingMaterializedSource = null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      pushPackageReport({
        kind: 'pmpe',
        title: t('settings.plugins.studio.package.report.pmpeTitle'),
        status: 'blocked',
        detail: message,
        diagnostics: [],
      });
    } finally {
      await cleanupExtensionPackMaterializedSource(pendingMaterializedSource);
      setBusy(false);
    }
  }, [
    busy,
    confirm,
    isTauri,
    magnetLibrary,
    pushPackageReport,
    setMagnetLibrary,
    stageContractPackage,
    t,
  ]);

  const handleStageExperiencePack = useCallback(async () => {
    if (!isTauri) {
      setError(t('settings.plugins.v2.install.requireTauri'));
      return;
    }
    if (busy) return;

    setBusy(true);
    setError(null);
    let pendingDryRun: InstallPlanExecutorDryRunResult | null = null;

    try {
      const [dialog, fs] = await Promise.all([
        import('@tauri-apps/api/dialog'),
        import('@tauri-apps/api/fs'),
      ]);
      const selected = await dialog.open({
        multiple: false,
        filters: [
          { name: t('settings.plugins.pmpex.install.filePickerFilter'), extensions: ['pmpex'] },
        ],
      });
      if (!selected) return;
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof filePath !== 'string') {
        throw new Error(t('settings.plugins.pmpex.install.error.invalidFilePath'));
      }

      const packBytes = await fs.readBinaryFile(filePath);
      const parsed = await parseExperiencePackFromZipBytes(new Uint8Array(packBytes));
      const executorPreview = parsed.executorPreview;
      const previewRecords: InstalledHostExtensionRecord[] = Object.values(
        executorPreview.extensionPacksByStepId
      ).map((extensionPack) => ({
        manifest: extensionPack.extensionManifest,
        installedAt: Date.now(),
        packageDigest: extensionPack.executorPreview.installSource.packageDigest,
        enabled: true,
      }));

      for (const record of previewRecords) {
        const pluginId = record.manifest.identity.id;
        const isUpdate = Boolean(getInstalledExtensionRecord(pluginId));
        const contributesMagnet = supportsInstalledExtensionMagnetSurface(record);
        if (
          contributesMagnet &&
          !isUpdate &&
          magnetLibrary.some((magnet) => magnet.id === pluginId)
        ) {
          throw new Error(
            t('settings.plugins.v2.install.error.magnetIdExists', {
              id: pluginId,
            })
          );
        }
      }

      const createExecutorContext = () => ({
        currentTheme: theme,
        applyTheme,
        magnetLibrary,
        registeredRendererIds: collectRegisteredRendererIds(previewRecords),
        dryRunResource: async (source: InstallPlanEmbeddedResourceSource) => {
          const parsedResource = await parsePmpsShaderPackFromZipBytes(source.bytes);
          return {
            id: parsedResource.manifest.metadata.id,
            version: parsedResource.manifest.metadata.version,
          };
        },
        commitResource: async (source: InstallPlanEmbeddedResourceSource) =>
          await installPmpsShaderPackFromZipBytes(source.bytes),
      });

      const dryRun = await dryRunExperiencePackExecutorPreview(
        executorPreview,
        createExecutorContext()
      );
      pendingDryRun = dryRun;

      const canResolveAsCreateNewSpaces = parsed.plan.steps.some(
        (step) => step.kind === 'apply-space-layout' && step.mode === 'prompt'
      );
      if (dryRun.status === 'pending-user-input' && !canResolveAsCreateNewSpaces) {
        throw new Error(
          t('settings.plugins.pmpex.install.error.pendingUserInput', {
            diagnostics: formatDiagnosticLines(dryRun.diagnostics),
          })
        );
      }
      if (dryRun.status !== 'ready' && dryRun.status !== 'pending-user-input') {
        throw new Error(
          t('settings.plugins.pmpex.install.error.dryRunBlocked', {
            diagnostics: formatDiagnosticLines(dryRun.diagnostics),
          })
        );
      }
      const confirmText = [
        buildPackageImportPreviewText(parsed.plan, t),
        '',
        t('settings.plugins.pmpex.install.confirm.dryRun', {
          steps: dryRun.stepResults.length,
          extensions: parsed.executorPreview.summary.extensionCount,
          resources: parsed.executorPreview.summary.resourceCount,
        }),
        '',
        t('settings.plugins.pmpex.install.confirm.prompt'),
      ].join('\n');

      let currentDryRun = dryRun;
      let currentExecutorPreview = executorPreview;
      let consumed = false;
      stageContractPackage({
        kind: 'pmpex',
        title: parsed.plan.summary.title,
        status: dryRun.status === 'ready' ? 'ready' : 'needs-input',
        detail: confirmText,
        diagnostics: dryRun.diagnostics,
        discard: async () => {
          if (consumed) return;
          consumed = true;
          await cleanupExperiencePackExecutorDryRun(currentDryRun);
        },
        apply: async () => {
          if (currentDryRun.status === 'pending-user-input') {
            const resolveSpaces = await confirm({
              title: t('settings.plugins.pmpex.install.spacePrompt.title'),
              message: t('settings.plugins.pmpex.install.spacePrompt.message', {
                diagnostics: formatDiagnosticLines(currentDryRun.diagnostics),
              }),
              confirmText: t('settings.plugins.pmpex.install.spacePrompt.createNew'),
              cancelText: t('common.action.cancel'),
            });
            if (!resolveSpaces) return false;

            await cleanupExperiencePackExecutorDryRun(currentDryRun);
            currentExecutorPreview = resolvePromptSpaceModeAsCreateNewSpaces(
              currentExecutorPreview
            );
            currentDryRun = await dryRunExperiencePackExecutorPreview(
              currentExecutorPreview,
              createExecutorContext()
            );
            if (currentDryRun.status !== 'ready') {
              throw new Error(
                t('settings.plugins.pmpex.install.error.dryRunBlocked', {
                  diagnostics: formatDiagnosticLines(currentDryRun.diagnostics),
                })
              );
            }
          }

          const ok = await confirm({
            title: t('settings.plugins.pmpex.install.confirm.title'),
            message: confirmText,
            confirmText: t('common.action.install'),
            cancelText: t('common.action.cancel'),
          });
          if (!ok) return false;

          const commit = await commitExperiencePackExecutorPreview(currentExecutorPreview, {
            ...createExecutorContext(),
            dryRun: currentDryRun,
          });
          if (commit.status !== 'committed') {
            throw new Error(
              t('settings.plugins.pmpex.install.error.commitBlocked', {
                diagnostics: formatDiagnosticLines(commit.diagnostics),
              })
            );
          }
          consumed = true;
          pushPackageReport({
            kind: 'pmpex',
            title: parsed.plan.summary.title,
            status: 'installed',
            detail: t('settings.plugins.studio.package.report.pmpexInstalled', {
              steps: commit.stepResults.length,
              extensions: commit.installedExtensions.length,
            }),
            diagnostics: commit.diagnostics,
          });

          for (const installed of commit.installedExtensions) {
            if (!supportsInstalledExtensionMagnetSurface(installed)) continue;
            const template = createMagnetTemplateFromInstalledExtension(installed);
            upsertMagnetCatalogMagnet(template);
            setMagnetLibrary((current) =>
              current.some((magnet) => magnet.id === installed.manifest.identity.id)
                ? current
                : [...current, template]
            );
          }
          return true;
        },
      });
      pendingDryRun = null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      pushPackageReport({
        kind: 'pmpex',
        title: t('settings.plugins.studio.package.report.pmpexTitle'),
        status: 'blocked',
        detail: message,
        diagnostics: [],
      });
    } finally {
      await cleanupExperiencePackExecutorDryRun(pendingDryRun);
      setBusy(false);
    }
  }, [
    applyTheme,
    busy,
    confirm,
    isTauri,
    magnetLibrary,
    pushPackageReport,
    setMagnetLibrary,
    stageContractPackage,
    t,
    theme,
  ]);

  const handleUninstallManifestV2 = useCallback(
    async (pluginId: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);

      try {
        const isActive = activeMagnetIds.has(pluginId);
        const ok = await confirm({
          title: t('settings.plugins.v2.uninstall.confirm.title'),
          message: t('settings.plugins.v2.uninstall.confirm.message', { id: pluginId }),
          confirmText: t('common.action.uninstall'),
          cancelText: t('common.action.cancel'),
          danger: true,
        });
        if (!ok) return;

        if (isActive) {
          deactivateMagnet(pluginId);
        }

        uninstallInstalledExtension(pluginId);
        restartInstalledExtensionRuntime(pluginId, 'uninstall');
        clearInstalledExtensionAuditLog(pluginId);
        removeMagnetCatalogMagnet(pluginId);
        if (magnetLibrary.some((magnet) => magnet.id === pluginId)) {
          setMagnetLibrary((prev) => prev.filter((magnet) => magnet.id !== pluginId));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [
      activeMagnetIds,
      busy,
      confirm,
      deactivateMagnet,
      magnetLibrary,
      restartInstalledExtensionRuntime,
      setMagnetLibrary,
      t,
    ]
  );

  const handleToggleManifestV2Enabled = useCallback(
    async (pluginId: string, enabled: boolean) => {
      if (busy) return;
      setBusy(true);
      setError(null);

      try {
        if (!enabled && activeMagnetIds.has(pluginId)) {
          const ok = await confirm({
            title: t('settings.plugins.disable.confirm.title'),
            message: t('settings.plugins.disable.confirm.message', { id: pluginId }),
            confirmText: t('common.action.disable'),
            cancelText: t('common.action.cancel'),
            danger: true,
          });
          if (!ok) return;
        }

        setInstalledExtensionEnabled(pluginId, enabled);
        restartInstalledExtensionRuntime(pluginId, enabled ? 'enabled' : 'disabled');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [activeMagnetIds, busy, confirm, restartInstalledExtensionRuntime, t]
  );

  const handleOpenBuiltinWindow = useCallback(
    async (windowId: 'editor:library' | 'editor:registration') => {
      setError(null);
      try {
        await openBuiltinWindowViaHostCapability(
          navigationService,
          { windowId },
          `settings.plugins.studio:open-${windowId}`
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [navigationService]
  );

  const handleOpenMagnetLibrary = useCallback(
    async (magnetId?: string | null) => {
      try {
        await handleOpenBuiltinWindow('editor:library');
        if (!magnetId) return;

        await broadcastDataUpdate(
          STORAGE_KEYS.MAGNET_LIBRARY_FOCUS_REQUEST_V1,
          {
            requestId: `${Date.now()}:${magnetId}`,
            magnetId,
            createdAt: Date.now(),
          },
          TAURI_EVENTS.MAGNET_LIBRARY_FOCUS_REQUESTED
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [handleOpenBuiltinWindow]
  );

  const handleOpenDebugCenter = useCallback(async () => {
    setError(null);
    try {
      await navigateBuiltinViaHostCapability(
        navigationService,
        'debug',
        { tab: 'debug-center' },
        'settings.plugins.studio:open-debug-center'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [navigationService]);

  const visibleStudioWorkspaces = PLUGIN_STUDIO_WORKSPACES;
  const activeWorkspaceDefinition =
    visibleStudioWorkspaces.find((workspace) => workspace.id === activeWorkspace) ??
    visibleStudioWorkspaces[0];

  return (
    <PmpCard
      className={`settings-card settings-plugin-studio ${embeddedInRegistrationCenter ? 'settings-plugin-studio--embedded' : ''}`}
      surfaceId="primitive.card.settings"
    >
      {error && <div className="settings-inline-error">{error}</div>}

      <div className="settings-card-header settings-plugin-studio-header">
        <div>
          <p className="settings-card-label">{t('settings.plugins.studio.title')}</p>
          <p className="settings-card-desc">{t('settings.plugins.studio.desc')}</p>
        </div>
        <div className="settings-plugin-studio-header-actions">
          {!embeddedInRegistrationCenter ? (
            <PmpButton
              type="button"
              className="settings-action-btn settings-plugin-studio-primary-action"
              variant="primary"
              onClick={() => setActiveWorkspace('package-import')}
            >
              <PackagePlus size={15} aria-hidden="true" />
              {t('settings.plugins.studio.action.registerPackage')}
            </PmpButton>
          ) : null}
          {!embeddedInRegistrationCenter ? (
            <>
              <PmpButton
                type="button"
                className="settings-action-btn"
                variant="default"
                onClick={() => void handleOpenMagnetLibrary()}
              >
                <Library size={15} aria-hidden="true" />
                {t('settings.plugins.studio.action.openMagnetLibrary')}
              </PmpButton>
              <PmpButton
                type="button"
                className="settings-action-btn"
                variant="default"
                onClick={() => void handleOpenDebugCenter()}
              >
                <Bug size={15} aria-hidden="true" />
                {t('settings.plugins.studio.action.openDebugCenter')}
              </PmpButton>
              <PmpButton
                type="button"
                className="settings-action-btn"
                variant="default"
                onClick={() => void handleOpenBuiltinWindow('editor:registration')}
              >
                {t('settings.plugins.studio.action.openThemeEditor')}
              </PmpButton>
            </>
          ) : null}
        </div>
      </div>

      {!embeddedInRegistrationCenter ? (
        <>
          <div className="settings-plugin-studio-metrics">
            {studioMetrics.map((metric) => (
              <div key={metric.id} className="settings-plugin-studio-metric">
                <span>{t(metric.labelKey)}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
          <div className="settings-param-divider settings-param-divider--compact" />
        </>
      ) : null}

      <div className="settings-plugin-studio-shell">
        <nav className="settings-plugin-studio-nav" aria-label={t('settings.plugins.studio.title')}>
          {visibleStudioWorkspaces.map((workspace) => (
            (() => {
              const WorkspaceIcon = PLUGIN_STUDIO_WORKSPACE_ICONS[workspace.id];
              return (
                <PmpChoiceButton
                  key={workspace.id}
                  type="button"
                  className="settings-plugin-studio-nav-item"
                  variant="settings"
                  active={activeWorkspace === workspace.id}
                  onClick={() => setActiveWorkspace(workspace.id)}
                  aria-label={t(workspace.titleKey)}
                  title={t(workspace.descKey)}
                >
                  <WorkspaceIcon
                    className="settings-plugin-studio-nav-icon"
                    size={15}
                    aria-hidden="true"
                  />
                  <span>{t(workspace.titleKey)}</span>
                  <small>{t(workspace.descKey)}</small>
                </PmpChoiceButton>
              );
            })()
          ))}
        </nav>

        <section className="settings-plugin-studio-panel">
          <div className="settings-plugin-studio-panel-head">
            <div>
              <p className="settings-content-meta">
                {t('settings.plugins.studio.kicker').toUpperCase()}
              </p>
              <h3>{t(activeWorkspaceDefinition.titleKey)}</h3>
              <p>{t(activeWorkspaceDefinition.descKey)}</p>
            </div>
          </div>

          {activeWorkspace === 'activation' ? (
            <div className="settings-plugin-studio-stack">
              <div className="settings-plugin-studio-section-title">
                {t('settings.plugins.studio.activation.pending')}
              </div>
              {stagedPackages.length === 0 ? (
                <div className="settings-card-note">
                  {t('settings.plugins.studio.activation.empty')}
                </div>
              ) : (
                <div className="settings-plugin-studio-report-list">
                  {stagedPackages.map((staged) => (
                    <div key={staged.id} className="settings-plugin-studio-report">
                      <div>
                        <strong>{staged.title}</strong>
                        <span className="settings-plugin-subtitle">
                          {' '}
                          {staged.kind}
                          {staged.version ? ` · ${staged.version}` : ''}
                        </span>
                      </div>
                      <div className="settings-plugin-tags">
                        <span className="settings-plugin-tag">
                          {staged.status === 'ready'
                            ? t('settings.plugins.studio.activation.ready')
                            : t('settings.plugins.studio.activation.needsInput')}
                        </span>
                      </div>
                      <div className="settings-plugin-desc">{staged.detail}</div>
                      {staged.diagnostics.length > 0 ? (
                        <pre className="settings-plugin-studio-code">
                          {formatDiagnosticLines(staged.diagnostics)}
                        </pre>
                      ) : null}
                      <div className="settings-plugin-studio-toolbar">
                        <PmpButton
                          type="button"
                          className="settings-action-btn settings-plugin-studio-primary-action"
                          variant="primary"
                          disabled={busy}
                          onClick={() => void handleApplyStagedPackage(staged.id)}
                        >
                          {t('settings.plugins.studio.activation.apply')}
                        </PmpButton>
                        <PmpButton
                          type="button"
                          className="settings-action-btn"
                          variant="default"
                          disabled={busy}
                          onClick={() => void handleDiscardStagedPackage(staged.id)}
                        >
                          {t('settings.plugins.studio.activation.discard')}
                        </PmpButton>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="settings-plugin-studio-section-title">
                {t('settings.plugins.studio.activation.installed')}
              </div>
              {installedExtensionsV2.length === 0 ? (
                <div className="settings-card-note">{t('settings.plugins.v2.empty')}</div>
              ) : (
                <div className="settings-plugin-studio-list">
                  {installedExtensionsV2.map((record) => {
                    const identity = record.manifest.identity;
                    const enabled = record.enabled !== false;
                    return (
                      <div key={identity.id} className="settings-plugin-item">
                        <div className="settings-plugin-info">
                          <div className="settings-plugin-title">
                            {readInstalledExtensionDisplayName(record)}
                          </div>
                          <div className="settings-plugin-subtitle">
                            {identity.id} · {identity.version}
                          </div>
                        </div>
                        <div className="settings-plugin-actions">
                          <PmpButton
                            type="button"
                            className="settings-action-btn"
                            variant="default"
                            disabled={
                              busy || (!enabled && record.disabledReason === 'quarantine')
                            }
                            onClick={() =>
                              void handleToggleManifestV2Enabled(identity.id, !enabled)
                            }
                          >
                            {enabled ? t('common.action.disable') : t('common.action.enable')}
                          </PmpButton>
                          <PmpButton
                            type="button"
                            className="settings-danger-btn"
                            variant="danger"
                            disabled={busy}
                            onClick={() => void handleUninstallManifestV2(identity.id)}
                          >
                            {t('common.action.uninstall')}
                          </PmpButton>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {packageReports.length > 0 ? (
                <>
                  <div className="settings-plugin-studio-section-title">
                    {t('settings.plugins.studio.package.reports')}
                  </div>
                  <div className="settings-plugin-studio-report-list">
                    {packageReports.map((report) => (
                      <div key={report.id} className="settings-plugin-studio-report">
                        <strong>{report.title}</strong>
                        <div className="settings-plugin-desc">{report.detail}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {activeWorkspace === 'displays' ? (
            <div className="settings-plugin-studio-stack">
              <div className="settings-plugin-studio-toolbar">
                <PmpButton
                  type="button"
                  className="settings-action-btn"
                  variant="default"
                  onClick={() => void handleOpenMagnetLibrary()}
                >
                  <Library size={15} aria-hidden="true" />
                  {t('settings.plugins.studio.action.openMagnetLibrary')}
                </PmpButton>
                {onOpenAppearanceWorkbench ? (
                  <PmpButton
                    type="button"
                    className="settings-action-btn"
                    variant="default"
                    onClick={onOpenAppearanceWorkbench}
                  >
                    <Paintbrush size={15} aria-hidden="true" />
                    {t('settings.plugins.studio.action.openAppearanceWorkbench')}
                  </PmpButton>
                ) : null}
              </div>
              {displayExtensions.length === 0 ? (
                <div className="settings-plugin-studio-empty">
                  <div className="settings-plugin-studio-empty-copy">
                    <strong>{t('settings.plugins.studio.displays.empty.title')}</strong>
                    <p>{t('settings.plugins.studio.displays.empty.desc')}</p>
                    <PmpButton
                      type="button"
                      className="settings-action-btn settings-plugin-studio-primary-action"
                      variant="primary"
                      onClick={() => setActiveWorkspace('package-import')}
                    >
                      <PackagePlus size={15} aria-hidden="true" />
                      {t('settings.plugins.studio.action.registerPackage')}
                    </PmpButton>
                  </div>
                </div>
              ) : (
                <div className="settings-plugin-studio-list">
                  {displayExtensions.map((record) => {
                    const identity = record.manifest.identity;
                    const host = readInstalledExtensionPmpHostContributions(record);
                    const primaryPage = host?.pages?.length === 1 ? host.pages[0] : null;
                    const primaryWindow = host?.windows?.length === 1 ? host.windows[0] : null;
                    const primaryVisualizer =
                      host?.visualizers?.length === 1 ? host.visualizers[0] : null;
                    return (
                      <div key={identity.id} className="settings-plugin-item">
                        <div className="settings-plugin-info">
                          <div className="settings-plugin-title">
                            {readInstalledExtensionDisplayName(record)}
                          </div>
                          <div className="settings-plugin-subtitle">{identity.id}</div>
                          <div className="settings-plugin-tags">
                            {(host?.pages ?? []).map((page) => (
                              <span key={`page:${page.id}`} className="settings-plugin-tag">
                                {page.title}
                              </span>
                            ))}
                            {(host?.windows ?? []).map((window) => (
                              <span key={`window:${window.id}`} className="settings-plugin-tag">
                                {window.title}
                              </span>
                            ))}
                            {(host?.visualizers ?? []).map((visualizer) => (
                              <span
                                key={`visualizer:${visualizer.id}`}
                                className="settings-plugin-tag"
                              >
                                {visualizer.title}
                              </span>
                            ))}
                            {host?.magnets ? (
                              <span className="settings-plugin-tag">Magnet</span>
                            ) : null}
                          </div>
                        </div>
                        <div className="settings-plugin-actions">
                          {primaryPage ? (
                            <PmpButton
                              type="button"
                              className="settings-action-btn"
                              variant="default"
                              onClick={() => openInstalledExtensionPage(identity.id, primaryPage.id)}
                            >
                              {t('common.action.open')} {primaryPage.title}
                            </PmpButton>
                          ) : null}
                          {primaryWindow ? (
                            <PmpButton
                              type="button"
                              className="settings-action-btn"
                              variant="default"
                              onClick={() =>
                                void openInstalledExtensionWindow({
                                  pluginId: identity.id,
                                  windowId: primaryWindow.id,
                                  title: `${readInstalledExtensionDisplayName(record)}: ${primaryWindow.title}`,
                                  width: primaryWindow.width,
                                  height: primaryWindow.height,
                                })
                              }
                            >
                              {t('common.action.open')} {primaryWindow.title}
                            </PmpButton>
                          ) : null}
                          {primaryVisualizer ? (
                            <PmpButton
                              type="button"
                              className="settings-action-btn"
                              variant="default"
                              onClick={() =>
                                openInstalledExtensionVisualizer(
                                  identity.id,
                                  primaryVisualizer.id
                                )
                              }
                            >
                              {t('common.action.open')} {primaryVisualizer.title}
                            </PmpButton>
                          ) : null}
                          {supportsInstalledExtensionMagnetSurface(record) ? (
                            <PmpButton
                              type="button"
                              className="settings-action-btn"
                              variant="default"
                              onClick={() => addInstalledExtensionMagnetToCurrentSpace(record)}
                            >
                              {t('settings.plugins.v2.action.addMagnet')}
                            </PmpButton>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {activeWorkspace === 'installed' ? (
            <div className="settings-plugin-list settings-plugin-studio-list">
              {installedExtensionsV2.length === 0 ? (
                embeddedInRegistrationCenter ? (
                  <div className="settings-plugin-studio-empty">
                    <div className="settings-plugin-studio-empty-copy">
                      <strong>{t('settings.plugins.studio.installed.empty.title')}</strong>
                      <p>{t('settings.plugins.studio.installed.empty.desc')}</p>
                      <PmpButton
                        type="button"
                        className="settings-action-btn settings-plugin-studio-primary-action"
                        variant="primary"
                        onClick={() => setActiveWorkspace('package-import')}
                      >
                        <PackagePlus size={15} aria-hidden="true" />
                        {t('settings.plugins.studio.action.registerPackage')}
                      </PmpButton>
                    </div>
                  </div>
                ) : (
                  <div className="settings-card-note">{t('settings.plugins.v2.empty')}</div>
                )
              ) : (
                installedExtensionsV2.map((record) => {
                  const identity = record.manifest.identity;
                  const runtimeResolution = runtimeResolutionByExtensionId.get(identity.id) ?? null;
                  const devSession = pluginDevSessionById.get(identity.id) ?? null;
                  const hostContributions = readInstalledExtensionPmpHostContributions(record);
                  const capabilityBindings = listInstalledExtensionCapabilityBindings(record);
                  const deniedCapabilities = record.deniedCapabilities ?? [];
                  const deniedCapabilitySet = new Set(deniedCapabilities);
                  const enabled = record.enabled ?? true;
                  const isActive = activeMagnetIds.has(identity.id);
                  const displayName = readInstalledExtensionDisplayName(record);
                  const panels = hostContributions?.settingsPanels?.length ?? 0;
                  const pages = hostContributions?.pages?.length ?? 0;
                  const windows = hostContributions?.windows?.length ?? 0;
                  const visualizers = hostContributions?.visualizers?.length ?? 0;
                  const magnets = hostContributions?.magnets ? 1 : 0;
                  const { runtimeSourceLabel, runtimeProjectionTitle } = buildRuntimePresentation(
                    t,
                    runtimeResolution
                  );
                  const commands = record.manifest.contributes?.core?.commands?.length ?? 0;
                  const keybindings = record.manifest.contributes?.core?.keybindings?.length ?? 0;
                  const extensionAudit = installedExtensionAuditLog
                    .filter((event) => event.pluginId === identity.id)
                    .slice(-8)
                    .reverse();
                  const primaryPage = pages === 1 ? (hostContributions?.pages?.[0] ?? null) : null;
                  const primaryWindow =
                    windows === 1 ? (hostContributions?.windows?.[0] ?? null) : null;
                  const primaryVisualizer =
                    visualizers === 1 ? (hostContributions?.visualizers?.[0] ?? null) : null;
                  const canAddMagnet = magnets > 0 && !isActive;

                  return (
                    <div key={identity.id} className="settings-plugin-item">
                      <div className="settings-plugin-meta">
                        <div className="settings-plugin-title">
                          {displayName}{' '}
                          <span className="settings-plugin-subtitle">
                            ({identity.id}@{identity.version})
                          </span>
                        </div>

                        {identity.description && (
                          <div className="settings-plugin-desc">{identity.description}</div>
                        )}

                        <div className="settings-plugin-tags">
                          <span className="settings-plugin-tag">
                            {enabled
                              ? t('settings.plugins.tag.enabled')
                              : t('settings.plugins.tag.disabled')}
                          </span>
                          <span className="settings-plugin-tag">
                            {t('settings.plugins.v2.tag.publisher', {
                              publisher: identity.publisher,
                            })}
                          </span>
                          <span className="settings-plugin-tag" title={runtimeProjectionTitle}>
                            {runtimeResolution?.status === 'resolved'
                              ? t('settings.plugins.tag.runtimeResolved', {
                                  runtimeId: runtimeResolution.runtime.runtimeId,
                                })
                              : runtimeResolution
                                ? t('settings.plugins.tag.runtimeBlocked')
                                : t('settings.plugins.tag.runtimeMissing')}
                          </span>
                          {runtimeResolution?.status === 'resolved' ? (
                            <span className="settings-plugin-tag" title={runtimeProjectionTitle}>
                              {t('settings.plugins.tag.launcher', {
                                launcherId: runtimeResolution.launcher.id,
                              })}
                            </span>
                          ) : null}
                          {runtimeSourceLabel ? (
                            <span className="settings-plugin-tag" title={runtimeProjectionTitle}>
                              {runtimeSourceLabel}
                            </span>
                          ) : null}
                          {commands > 0 && (
                            <span className="settings-plugin-tag">
                              {t('settings.plugins.tag.commandsCount', { count: commands })}
                            </span>
                          )}
                          {keybindings > 0 && (
                            <span className="settings-plugin-tag">
                              {t('settings.plugins.v2.tag.keybindingsCount', {
                                count: keybindings,
                              })}
                            </span>
                          )}
                          {panels > 0 && (
                            <span className="settings-plugin-tag">
                              {t('settings.plugins.tag.settingsPanelsCount', { count: panels })}
                            </span>
                          )}
                          {pages > 0 && (
                            <span className="settings-plugin-tag">
                              {t('settings.plugins.tag.pagesCount', { count: pages })}
                            </span>
                          )}
                          {windows > 0 && (
                            <span className="settings-plugin-tag">
                              {t('settings.plugins.tag.windowsCount', { count: windows })}
                            </span>
                          )}
                          {visualizers > 0 && (
                            <span className="settings-plugin-tag">
                              {t('settings.plugins.tag.visualizersCount', { count: visualizers })}
                            </span>
                          )}
                          {magnets > 0 && (
                            <span className="settings-plugin-tag">
                              {t('settings.plugins.tag.magnetsCount', { count: magnets })}
                            </span>
                          )}
                          {record.disabledReason === 'quarantine' ? (
                            <span className="settings-plugin-tag settings-plugin-tag--warning">
                              {t('settings.plugins.studio.tag.quarantined')}
                            </span>
                          ) : null}
                        </div>

                        <div className="settings-plugin-studio-columns">
                          <div className="settings-plugin-permissions">
                            <div>{t('settings.plugins.v2.capabilities.label')}</div>
                            {capabilityBindings.length === 0 ? (
                              <div className="settings-row-desc">
                                {t('settings.plugins.v2.capabilities.none')}
                              </div>
                            ) : (
                              <div className="settings-row-desc-list settings-row-meta">
                                {capabilityBindings.map((binding) => (
                                  <PmpCheckbox
                                    key={binding.capabilityId}
                                    className="settings-checkbox settings-plugin-permission-line"
                                    variant="settings"
                                    checked={binding.granted}
                                    disabled={busy}
                                    onCheckedChange={(nextGranted) => {
                                      const nextDenied = new Set(deniedCapabilitySet);
                                      if (nextGranted) nextDenied.delete(binding.capabilityId);
                                      else nextDenied.add(binding.capabilityId);
                                      setInstalledExtensionDeniedCapabilities(
                                        identity.id,
                                        Array.from(nextDenied)
                                      );
                                      restartInstalledExtensionRuntime(
                                        identity.id,
                                        'capabilities-updated'
                                      );
                                    }}
                                  >
                                    <span>
                                      {binding.capabilityId}
                                      {binding.granted
                                        ? ''
                                        : ` (${t('settings.plugins.v2.capabilities.denied')})`}
                                    </span>
                                  </PmpCheckbox>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="settings-plugin-permissions">
                            <div>{t('settings.plugins.studio.installed.runtimeAudit')}</div>
                            <div className="settings-row-desc-list settings-row-meta">
                              <div title={runtimeProjectionTitle}>
                                {runtimeProjectionTitle || t('settings.plugins.tag.runtimeMissing')}
                              </div>
                              {devSession ? (
                                <div>
                                  {t('settings.plugins.devSession.effectiveSource', {
                                    source: t('settings.plugins.tag.runtimeSourceDev'),
                                  })}
                                </div>
                              ) : null}
                              {extensionAudit.length > 0 ? (
                                <div>
                                  {t('settings.plugins.audit.summary', {
                                    count: extensionAudit.length,
                                  })}
                                </div>
                              ) : (
                                <div>{t('settings.plugins.studio.audit.empty')}</div>
                              )}
                            </div>
                          </div>
                        </div>

                        {record.lastError && (
                          <div className="settings-plugin-error" title={record.lastError}>
                            {record.lastError}
                          </div>
                        )}

                        {extensionAudit.length > 0 && (
                          <details className="settings-plugin-details">
                            <summary className="settings-plugin-details-summary">
                              {t('settings.plugins.audit.summary', {
                                count: extensionAudit.length,
                              })}
                            </summary>
                            <div className="settings-plugin-details-content">
                              {extensionAudit.map((event, idx) => (
                                <div key={idx}>{formatInstalledExtensionAuditEvent(event)}</div>
                              ))}
                            </div>
                            <div className="settings-plugin-details-actions">
                              <PmpButton
                                type="button"
                                className="settings-action-btn"
                                variant="default"
                                onClick={() => clearInstalledExtensionAuditLog(identity.id)}
                                disabled={busy}
                              >
                                {t('common.action.clear')}
                              </PmpButton>
                            </div>
                          </details>
                        )}
                      </div>

                      <div className="settings-plugin-actions">
                        {primaryPage && (
                          <PmpButton
                            type="button"
                            className="settings-action-btn"
                            variant="default"
                            disabled={busy}
                            onClick={() => openInstalledExtensionPage(identity.id, primaryPage.id)}
                            title={primaryPage.description ?? undefined}
                          >
                            {t('common.action.open')} {primaryPage.title}
                          </PmpButton>
                        )}

                        {primaryVisualizer && (
                          <PmpButton
                            type="button"
                            className="settings-action-btn"
                            variant="default"
                            disabled={busy}
                            onClick={() =>
                              openInstalledExtensionVisualizer(identity.id, primaryVisualizer.id)
                            }
                            title={primaryVisualizer.description ?? undefined}
                          >
                            {t('common.action.open')} {primaryVisualizer.title}
                          </PmpButton>
                        )}

                        {primaryWindow && (
                          <PmpButton
                            type="button"
                            className="settings-action-btn"
                            variant="default"
                            disabled={busy}
                            onClick={() =>
                              void openInstalledExtensionWindow({
                                pluginId: identity.id,
                                windowId: primaryWindow.id,
                                title: `${displayName}: ${primaryWindow.title}`,
                                width: primaryWindow.width,
                                height: primaryWindow.height,
                              })
                            }
                            title={primaryWindow.description ?? undefined}
                          >
                            {t('common.action.open')} {primaryWindow.title}
                          </PmpButton>
                        )}

                        {canAddMagnet && (
                          <PmpButton
                            type="button"
                            className="settings-action-btn"
                            variant="default"
                            disabled={busy}
                            onClick={() => addInstalledExtensionMagnetToCurrentSpace(record)}
                            title={t('settings.plugins.v2.action.addMagnet.title')}
                          >
                            {t('settings.plugins.v2.action.addMagnet')}
                          </PmpButton>
                        )}

                        {record.disabledReason === 'quarantine' && (
                          <PmpButton
                            type="button"
                            className="settings-action-btn"
                            variant="default"
                            disabled={busy}
                            onClick={() => clearInstalledExtensionQuarantine(identity.id)}
                            title={t('settings.plugins.v2.action.clearQuarantine.title')}
                          >
                            {t('settings.plugins.v2.action.clearQuarantine')}
                          </PmpButton>
                        )}

                        <PmpButton
                          type="button"
                          className="settings-action-btn"
                          variant="default"
                          disabled={busy || (!enabled && record.disabledReason === 'quarantine')}
                          onClick={() => void handleToggleManifestV2Enabled(identity.id, !enabled)}
                          title={
                            enabled
                              ? t('settings.plugins.action.disable.title')
                              : t('settings.plugins.action.enable.title')
                          }
                        >
                          {enabled ? t('common.action.disable') : t('common.action.enable')}
                        </PmpButton>

                        {record.lastError && (
                          <PmpButton
                            type="button"
                            className="settings-action-btn"
                            variant="default"
                            disabled={busy}
                            onClick={() => clearInstalledExtensionLastError(identity.id)}
                            title={t('settings.plugins.v2.action.clearError.title')}
                          >
                            {t('settings.plugins.v2.action.clearError')}
                          </PmpButton>
                        )}

                        <PmpButton
                          type="button"
                          className="settings-action-btn"
                          variant="default"
                          disabled={busy || record.disabledReason === 'quarantine'}
                          onClick={() => restartInstalledExtensionRuntime(identity.id, 'manual')}
                          title={t('settings.plugins.v2.action.restart.title')}
                        >
                          {t('common.action.restart')}
                        </PmpButton>

                        <PmpButton
                          type="button"
                          className="settings-danger-btn"
                          variant="danger"
                          disabled={busy}
                          onClick={() => void handleUninstallManifestV2(identity.id)}
                          title={
                            isActive
                              ? t('settings.plugins.action.uninstall.title.magnetActive')
                              : t('settings.plugins.v2.action.uninstall.title')
                          }
                        >
                          {t('common.action.uninstall')}
                        </PmpButton>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : null}

          {activeWorkspace === 'package-import' ? (
            <div className="settings-plugin-studio-stack">
              <div className="settings-plugin-studio-toolbar">
                <PmpButton
                  className="settings-action-btn"
                  variant="default"
                  onClick={() => void handleStageManifestV2()}
                  disabled={busy}
                >
                  {t('settings.plugins.studio.registration.loadManifest')}
                </PmpButton>
                <PmpButton
                  className="settings-action-btn"
                  variant="default"
                  onClick={() => void handleStageExtensionPack()}
                  disabled={busy}
                >
                  {t('settings.plugins.studio.registration.loadPmpe')}
                </PmpButton>
                <PmpButton
                  className="settings-action-btn"
                  variant="default"
                  onClick={() => void handleStageExperiencePack()}
                  disabled={busy}
                >
                  {t('settings.plugins.studio.registration.loadPmpex')}
                </PmpButton>
                <PmpButton
                  className="settings-action-btn"
                  variant="default"
                  onClick={() => void handleStageAppearanceContract()}
                  disabled={busy}
                >
                  <Paintbrush size={15} aria-hidden="true" />
                  {t('settings.plugins.studio.registration.loadAppearance')}
                </PmpButton>
              </div>

              <div className="settings-plugin-studio-note">
                {t('settings.plugins.studio.registration.boundary')}
              </div>

              <div className="settings-plugin-studio-section-title">
                {t('settings.plugins.studio.registration.loaded')}
              </div>
              {stagedPackages.length === 0 ? (
                <div className="settings-card-note">
                  {t('settings.plugins.studio.registration.empty')}
                </div>
              ) : (
                <div className="settings-plugin-studio-report-list">
                  {stagedPackages.map((staged) => (
                    <div key={staged.id} className="settings-plugin-studio-report">
                      <div>
                        <strong>{staged.title}</strong>
                        <span className="settings-plugin-subtitle">
                          {' '}
                          {staged.kind}
                          {staged.version ? ` · ${staged.version}` : ''}
                        </span>
                      </div>
                      <span className="settings-plugin-tag">
                        {t('settings.plugins.studio.registration.loadedStatus')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {stagedPackages.length > 0 ? (
                <div className="settings-plugin-studio-toolbar">
                  <PmpButton
                    type="button"
                    className="settings-action-btn settings-plugin-studio-primary-action"
                    variant="primary"
                    onClick={() => setActiveWorkspace('activation')}
                  >
                    {t('settings.plugins.studio.registration.reviewActivation')}
                  </PmpButton>
                </div>
              ) : null}
            </div>
          ) : null}

          {activeWorkspace === 'developer' ? (
            <div className="settings-plugin-list settings-plugin-studio-list">
              {installedExtensionsV2.length === 0 && pluginDevSessions.length === 0 ? (
                <div className="settings-card-note">
                  {t('settings.plugins.studio.developer.empty')}
                </div>
              ) : (
                installedExtensionsV2.map((record) => {
                  const identity = record.manifest.identity;
                  const displayName = readInstalledExtensionDisplayName(record);
                  const runtimeResolution = runtimeResolutionByExtensionId.get(identity.id) ?? null;
                  const devSession = pluginDevSessionById.get(identity.id) ?? null;
                  const hostContributions = readInstalledExtensionPmpHostContributions(record);
                  const primaryPage =
                    hostContributions?.pages?.length === 1 ? hostContributions.pages[0] : null;
                  const primaryWindow =
                    hostContributions?.windows?.length === 1 ? hostContributions.windows[0] : null;
                  const primaryVisualizer =
                    hostContributions?.visualizers?.length === 1
                      ? hostContributions.visualizers[0]
                      : null;
                  const { runtimeProjectionTitle, runtimeSourceLabel } = buildRuntimePresentation(
                    t,
                    runtimeResolution
                  );

                  return (
                    <div key={identity.id} className="settings-plugin-item">
                      <div className="settings-plugin-meta">
                        <div className="settings-plugin-title">{displayName}</div>
                        <div className="settings-plugin-tags">
                          <span className="settings-plugin-tag">{identity.id}</span>
                          <span className="settings-plugin-tag" title={runtimeProjectionTitle}>
                            {runtimeResolution?.status === 'resolved'
                              ? t('settings.plugins.tag.runtimeResolved', {
                                  runtimeId: runtimeResolution.runtime.runtimeId,
                                })
                              : runtimeResolution
                                ? t('settings.plugins.tag.runtimeBlocked')
                                : t('settings.plugins.tag.runtimeMissing')}
                          </span>
                          {runtimeResolution?.status === 'resolved' ? (
                            <span className="settings-plugin-tag">
                              {t('settings.plugins.tag.launcher', {
                                launcherId: runtimeResolution.launcher.id,
                              })}
                            </span>
                          ) : null}
                          {runtimeSourceLabel ? (
                            <span className="settings-plugin-tag">{runtimeSourceLabel}</span>
                          ) : null}
                        </div>

                        <div className="settings-plugin-studio-definition-grid">
                          <span>{t('settings.plugins.studio.developer.devSource')}</span>
                          <strong>{devSession?.projectRoot ?? '-'}</strong>
                          <span>{t('settings.plugins.studio.developer.surfaceKind')}</span>
                          <strong>{getInstalledExtensionPrimarySurfaceKind(record)}</strong>
                          <span>{t('settings.plugins.studio.developer.effectiveRuntime')}</span>
                          <strong title={runtimeProjectionTitle}>
                            {runtimeResolution?.status === 'resolved'
                              ? runtimeResolution.artifact.path
                              : runtimeProjectionTitle}
                          </strong>
                          <span>{t('settings.plugins.studio.developer.lastRestart')}</span>
                          <strong>
                            {devSession ? formatDevSessionRestartSummary(t, devSession) : '-'}
                          </strong>
                        </div>

                        {devSession?.lastError ? (
                          <div className="settings-plugin-error" title={devSession.lastError}>
                            {t('settings.plugins.devSession.lastError', {
                              message: devSession.lastError,
                            })}
                          </div>
                        ) : null}
                      </div>

                      <div className="settings-plugin-actions">
                        <PmpButton
                          type="button"
                          className="settings-action-btn"
                          variant="default"
                          disabled={busy || record.disabledReason === 'quarantine'}
                          onClick={() => restartInstalledExtensionRuntime(identity.id, 'manual')}
                        >
                          {t('common.action.restart')}
                        </PmpButton>
                        {devSession ? (
                          <PmpButton
                            type="button"
                            className="settings-action-btn"
                            variant="default"
                            disabled={busy}
                            onClick={() => refreshPluginDevSession(identity.id)}
                          >
                            {t('settings.plugins.devSession.action.refresh')}
                          </PmpButton>
                        ) : null}
                        {primaryPage ? (
                          <PmpButton
                            type="button"
                            className="settings-action-btn"
                            variant="default"
                            disabled={busy}
                            onClick={() => openInstalledExtensionPage(identity.id, primaryPage.id)}
                          >
                            {t('common.action.open')} {primaryPage.title}
                          </PmpButton>
                        ) : null}
                        {primaryVisualizer ? (
                          <PmpButton
                            type="button"
                            className="settings-action-btn"
                            variant="default"
                            disabled={busy}
                            onClick={() =>
                              openInstalledExtensionVisualizer(identity.id, primaryVisualizer.id)
                            }
                          >
                            {t('common.action.open')} {primaryVisualizer.title}
                          </PmpButton>
                        ) : null}
                        {primaryWindow ? (
                          <PmpButton
                            type="button"
                            className="settings-action-btn"
                            variant="default"
                            disabled={busy}
                            onClick={() =>
                              void openInstalledExtensionWindow({
                                pluginId: identity.id,
                                windowId: primaryWindow.id,
                                title: `${displayName}: ${primaryWindow.title}`,
                                width: primaryWindow.width,
                                height: primaryWindow.height,
                              })
                            }
                          >
                            {t('common.action.open')} {primaryWindow.title}
                          </PmpButton>
                        ) : null}
                        {record.lastError ? (
                          <PmpButton
                            type="button"
                            className="settings-action-btn"
                            variant="default"
                            disabled={busy}
                            onClick={() => clearInstalledExtensionLastError(identity.id)}
                          >
                            {t('settings.plugins.v2.action.clearError')}
                          </PmpButton>
                        ) : null}
                        <PmpButton
                          type="button"
                          className="settings-action-btn"
                          variant="default"
                          disabled={busy}
                          onClick={() => clearInstalledExtensionAuditLog(identity.id)}
                        >
                          {t('settings.plugins.studio.action.clearAudit')}
                        </PmpButton>
                        {devSession ? (
                          <PmpButton
                            type="button"
                            className="settings-danger-btn"
                            variant="danger"
                            disabled={busy}
                            onClick={() => detachPluginDevSession(identity.id)}
                          >
                            {t('settings.plugins.devSession.action.detach')}
                          </PmpButton>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : null}

          {activeWorkspace === 'magnets' ? (
            <div className="settings-plugin-studio-two-pane">
              <div className="settings-plugin-studio-listbox">
                <div className="settings-plugin-studio-toolbar">
                  <PmpButton
                    type="button"
                    className="settings-action-btn"
                    variant="default"
                    onClick={() => void handleOpenMagnetLibrary()}
                  >
                    {t('settings.plugins.studio.action.openMagnetLibrary')}
                  </PmpButton>
                </div>
                {magnetLibrary.map((magnet) => {
                  const rendererId = resolveMagnetRendererId(magnet);
                  const magnetName = getMagnetDisplayName(magnet, t);
                  return (
                    <button
                      key={magnet.id}
                      type="button"
                      className="settings-plugin-studio-listbox-item"
                      data-active={selectedMagnet?.id === magnet.id ? 'true' : 'false'}
                      onClick={() => setSelectedMagnetId(magnet.id)}
                    >
                      <span>{magnetName}</span>
                      <small>
                        {magnet.id} · {rendererId}
                      </small>
                    </button>
                  );
                })}
              </div>

              <div className="settings-plugin-studio-detail">
                {selectedMagnet ? (
                  <>
                    <div className="settings-plugin-title">{selectedMagnetDisplayName}</div>
                    <div className="settings-plugin-tags">
                      <span className="settings-plugin-tag">{selectedMagnet.id}</span>
                      <span className="settings-plugin-tag">
                        {activeMagnetIds.has(selectedMagnet.id)
                          ? t('settings.plugins.studio.magnets.active')
                          : t('settings.plugins.studio.magnets.inactive')}
                      </span>
                      <span className="settings-plugin-tag">
                        {t('settings.plugins.studio.magnets.renderer', {
                          rendererId: selectedMagnetRendererId,
                        })}
                      </span>
                      <span className="settings-plugin-tag">
                        {t('settings.plugins.studio.magnets.variant', {
                          variant: selectedMagnet.variant ?? '-',
                        })}
                      </span>
                    </div>

                    <div className="settings-plugin-studio-toolbar">
                      {activeMagnetIds.has(selectedMagnet.id) ? (
                        <PmpButton
                          type="button"
                          className="settings-action-btn"
                          variant="default"
                          disabled={busy || REQUIRED_MAGNET_IDS.has(selectedMagnet.id)}
                          onClick={() => deactivateMagnet(selectedMagnet.id)}
                        >
                          {t('common.action.disable')}
                        </PmpButton>
                      ) : (
                        <PmpButton
                          type="button"
                          className="settings-action-btn"
                          variant="default"
                          disabled={busy}
                          onClick={() => activateMagnet(selectedMagnet.id)}
                        >
                          {t('common.action.enable')}
                        </PmpButton>
                      )}
                    </div>

                    <div className="settings-card-note">
                      {t('settings.plugins.studio.magnets.variantManagedInLibrary')}
                    </div>

                    <div className="settings-plugin-studio-definition-grid">
                      <span>{t('settings.plugins.studio.magnets.anchorType')}</span>
                      <strong>{selectedMagnet.anchorType}</strong>
                      <span>{t('settings.plugins.studio.magnets.footprint')}</span>
                      <strong>
                        {selectedMagnet.gridFootprint
                          ? `${selectedMagnet.gridFootprint.width}x${selectedMagnet.gridFootprint.height}`
                          : t('settings.plugins.studio.magnets.anchorCount', {
                              count: selectedMagnet.anchors.length,
                            })}
                      </strong>
                      <span>{t('settings.plugins.studio.appearance.variantCatalog')}</span>
                      <strong>
                        {t('settings.plugins.studio.appearance.variantCount', {
                          count: selectedMagnetVariants.length,
                        })}
                      </strong>
                    </div>

                    <div className="settings-plugin-studio-code-grid">
                      <div>
                        <div className="settings-plugin-studio-section-title">
                          {t('settings.plugins.studio.magnets.anchors')}
                        </div>
                        <pre className="settings-plugin-studio-code">
                          {safeJsonStringify(selectedMagnet.anchors)}
                        </pre>
                      </div>
                      <div>
                        <div className="settings-plugin-studio-section-title">
                          {t('settings.plugins.studio.magnets.bounds')}
                        </div>
                        <pre className="settings-plugin-studio-code">
                          {safeJsonStringify(selectedMagnet.bounds)}
                        </pre>
                      </div>
                      <div>
                        <div className="settings-plugin-studio-section-title">
                          {t('settings.plugins.studio.magnets.chrome')}
                        </div>
                        <pre className="settings-plugin-studio-code">
                          {safeJsonStringify(selectedMagnet.chrome ?? {})}
                        </pre>
                      </div>
                      <div>
                        <div className="settings-plugin-studio-section-title">
                          {t('settings.plugins.studio.appearance.skinProps')}
                        </div>
                        <pre className="settings-plugin-studio-code">
                          {safeJsonStringify(selectedMagnet.skinProps ?? {})}
                        </pre>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="settings-card-note">
                    {t('settings.plugins.studio.magnets.empty')}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {activeWorkspace === 'appearance' ? (
            <div className="settings-plugin-studio-stack">
              {selectedMagnet ? (
                <>
                  <div className="settings-plugin-studio-definition-grid">
                    <span>{t('settings.plugins.studio.appearance.selectedMagnet')}</span>
                    <strong>{selectedMagnet.id}</strong>
                    <span>{t('settings.plugins.studio.appearance.themeBinding')}</span>
                    <strong>{selectedMagnet ? `magnet.${selectedMagnet.id}` : '-'}</strong>
                    <span>{t('settings.plugins.studio.appearance.renderer')}</span>
                    <strong>{selectedMagnetRendererId ?? '-'}</strong>
                    <span>{t('settings.plugins.studio.appearance.variant')}</span>
                    <strong>
                      {selectedMagnet.variant ??
                        t('settings.plugins.studio.appearance.variantDefault')}
                    </strong>
                    <span>{t('settings.plugins.studio.appearance.variantCatalog')}</span>
                    <strong>
                      {t('settings.plugins.studio.appearance.variantCount', {
                        count: selectedMagnetVariants.length,
                      })}
                    </strong>
                  </div>

                  <div className="settings-plugin-studio-toolbar">
                    <PmpButton
                      type="button"
                      className="settings-action-btn"
                      variant="default"
                      onClick={() => void handleOpenBuiltinWindow('editor:registration')}
                    >
                      {t('settings.plugins.studio.appearance.openThemeBinding')}
                    </PmpButton>
                  </div>

                  <div>
                    <div className="settings-plugin-studio-section-title">
                      {t('settings.plugins.studio.appearance.skinProps')}
                    </div>
                    <pre className="settings-plugin-studio-code">
                      {safeJsonStringify(selectedMagnet.skinProps ?? {})}
                    </pre>
                  </div>
                </>
              ) : (
                <div className="settings-card-note">
                  {t('settings.plugins.studio.magnets.empty')}
                </div>
              )}

              <div className="settings-plugin-studio-section-title">
                {t('settings.plugins.studio.appearance.renderers')}
              </div>
              <div className="settings-plugin-studio-renderer-list">
                {registeredRenderers.map((renderer) => {
                  const variants = variantsByRendererId.get(renderer.id) ?? [];
                  return (
                    <div key={renderer.id} className="settings-plugin-studio-renderer">
                      <div>
                        <strong>{renderer.id}</strong>
                        <span className="settings-plugin-subtitle">
                          {' '}
                          {renderer.source ?? 'builtin'} · {renderer.group ?? '-'}
                        </span>
                      </div>
                      <div className="settings-plugin-tags">
                        <span className="settings-plugin-tag">
                          {t('settings.plugins.studio.appearance.variantCount', {
                            count: variants.length,
                          })}
                        </span>
                        {variants.map((variant) => (
                          <span key={variant.id} className="settings-plugin-tag">
                            {variant.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {activeWorkspace === 'diagnostics' ? (
            <div className="settings-plugin-studio-stack">
              <div className="settings-plugin-studio-toolbar">
                <PmpButton
                  type="button"
                  className="settings-action-btn"
                  variant="default"
                  onClick={() => void handleOpenDebugCenter()}
                >
                  {t('settings.plugins.studio.action.openDebugCenter')}
                </PmpButton>
              </div>

              <div className="settings-plugin-studio-diagnostic-list">
                {studioDiagnostics.map((diagnostic: PluginStudioDiagnostic) => (
                  <div
                    key={diagnostic.id}
                    className="settings-plugin-studio-diagnostic"
                    data-severity={diagnostic.severity}
                  >
                    <div>
                      <strong>{t(diagnostic.titleKey, diagnostic.params)}</strong>
                      <span className="settings-plugin-subtitle">
                        {' '}
                        {t(getPluginStudioDiagnosticAreaLabelKey(diagnostic.area))} ·{' '}
                        {t(getPluginStudioDiagnosticSeverityLabelKey(diagnostic.severity))}
                      </span>
                    </div>
                    <div className="settings-plugin-desc">
                      {t(diagnostic.messageKey, diagnostic.params)}
                    </div>
                  </div>
                ))}
              </div>

              {packageReports.length > 0 ? (
                <>
                  <div className="settings-plugin-studio-section-title">
                    {t('settings.plugins.studio.package.reports')}
                  </div>
                  <div className="settings-plugin-studio-report-list">
                    {packageReports.slice(0, 4).map((report) => (
                      <div key={report.id} className="settings-plugin-studio-report">
                        <div>
                          <strong>{report.title}</strong>
                          <span className="settings-plugin-subtitle">
                            {' '}
                            {report.kind} · {t(getPackageReportStatusKey(report.status))}
                          </span>
                        </div>
                        <div className="settings-plugin-desc">{report.detail}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
      {confirmDialog}
    </PmpCard>
  );
}
