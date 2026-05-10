import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { removeMagnetCatalogMagnet, upsertMagnetCatalogMagnet, useMagnetConfig } from '../../modules/magnets';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { useKernel } from '../../contexts/KernelContext';
import { GOVERNANCE_SERVICE_TOKEN } from '../../services/governance';
import { NAVIGATION_SERVICE_TOKEN } from '../../services/navigation';
import { useT } from '../../i18n';
import { listRegisteredMagnetRenderers } from '../../magnet-system/registry';
import { installPmpsShaderPackFromZipBytes, parsePmpsShaderPackFromZipBytes } from '../../shader-system/pmps';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import {
  openBuiltinPluginPageViaHostCapability,
  openBuiltinPluginWindowViaHostCapability,
  openBuiltinPluginVisualizerViaHostCapability,
} from '../../builtin-modules/builtinNavigationCapabilityBridge';
import { useConfirmDialog } from '../core/ConfirmDialog';
import { PmpButton, PmpCard, PmpCheckbox } from '../primitives';
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
import { INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN } from '../../magnet-system/plugins/installedExtensionRuntimeManager';
import { activateInstalledExtensionsForHostFile } from '../../magnet-system/plugins/installedExtensionHostFileActivation';
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
import type { PluginRuntimeResolution, PluginRuntimeSurfaceKind } from '../../magnet-system/plugins/runtime';
import {
  detachPluginDevSession,
  getPluginDevSessionsRevision,
  loadPluginDevSessions,
  refreshPluginDevSession,
  subscribePluginDevSessions,
  type PluginDevSessionRecord,
} from '../../magnet-system/plugins/devSessionRegistry';

function readInstalledExtensionDisplayName(record: InstalledHostExtensionRecord): string {
  return record.manifest.identity.displayName ?? record.manifest.identity.name;
}

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

export function PluginsSettingsPanel() {
  const kernel = useKernel();
  const t = useT();
  const { theme, applyTheme } = useTheme();
  const governance = kernel.services.getOptional(GOVERNANCE_SERVICE_TOKEN);
  const navigationService = kernel.services.get(NAVIGATION_SERVICE_TOKEN);
  const installedExtensionRuntimeManager = kernel.services.get(
    INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN
  );
  const { activeMagnetIds, activateMagnet, deactivateMagnet, magnetLibrary, setMagnetLibrary } =
    useMagnetConfig();
  const isTauri = isTauriRuntime();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const installedExtensionsV2 = useMemo(() => {
    void extensionStoreRevision;
    return loadInstalledExtensions();
  }, [extensionStoreRevision]);

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

  const restartInstalledExtensionRuntime = useCallback(
    (pluginId: string, reason: string) => {
      governance?.restartInstalledExtensionRuntime(pluginId, { reason });
    },
    [governance]
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

  const handleInstallManifestV2 = useCallback(async () => {
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
        filters: [{ name: t('settings.plugins.v2.install.filePickerFilter'), extensions: ['json'] }],
      });
      if (!selected) return;
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof filePath !== 'string') {
        throw new Error(t('settings.plugins.v2.install.error.invalidFilePath'));
      }

      void activateInstalledExtensionsForHostFile(installedExtensionRuntimeManager, {
        filePath,
        action: 'selected',
        hostLabel: 'PluginsSettingsPanel',
      });

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

      const ok = await confirm({
        title: t('settings.plugins.v2.install.confirm.title'),
        message: confirmText,
        confirmText: t('common.action.install'),
        cancelText: t('common.action.cancel'),
      });
      if (!ok) return;

      const installed = await installInstalledExtensionFromFilePath(filePath);
      if (supportsInstalledExtensionMagnetSurface(installed)) {
        const template = createMagnetTemplateFromInstalledExtension(installed);
        upsertMagnetCatalogMagnet(template);

        if (!magnetLibrary.some((magnet) => magnet.id === installed.manifest.identity.id)) {
          setMagnetLibrary((prev) => [...prev, template]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    confirm,
    installedExtensionRuntimeManager,
    isTauri,
    magnetLibrary,
    setMagnetLibrary,
    t,
  ]);

  const handleInstallExtensionPack = useCallback(async () => {
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
        filters: [{ name: t('settings.plugins.pmpe.install.filePickerFilter'), extensions: ['pmpe'] }],
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
          runtimes: parsed.extensionManifest.runtimes.map((runtime) => runtime.runtimeId).join(', '),
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

      const ok = await confirm({
        title: t('settings.plugins.pmpe.install.confirm.title'),
        message: confirmText,
        confirmText: t('common.action.install'),
        cancelText: t('common.action.cancel'),
      });
      if (!ok) return;

      const commit = await commitExtensionPackExecutorPreview(parsed.executorPreview, { dryRun });
      pendingMaterializedSource = null;
      if (commit.status !== 'installed' || !commit.installedExtension) {
        throw new Error(
          t('settings.plugins.pmpe.install.error.commitBlocked', {
            diagnostics: formatDiagnosticLines(commit.diagnostics),
          })
        );
      }

      const installed = commit.installedExtension;
      if (supportsInstalledExtensionMagnetSurface(installed)) {
        const template = createMagnetTemplateFromInstalledExtension(installed);
        upsertMagnetCatalogMagnet(template);

        if (!magnetLibrary.some((magnet) => magnet.id === installed.manifest.identity.id)) {
          setMagnetLibrary((prev) => [...prev, template]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      await cleanupExtensionPackMaterializedSource(pendingMaterializedSource);
      setBusy(false);
    }
  }, [busy, confirm, isTauri, magnetLibrary, setMagnetLibrary, t]);

  const handleInstallExperiencePack = useCallback(async () => {
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
        filters: [{ name: t('settings.plugins.pmpex.install.filePickerFilter'), extensions: ['pmpex'] }],
      });
      if (!selected) return;
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof filePath !== 'string') {
        throw new Error(t('settings.plugins.pmpex.install.error.invalidFilePath'));
      }

      const packBytes = await fs.readBinaryFile(filePath);
      const parsed = await parseExperiencePackFromZipBytes(new Uint8Array(packBytes));
      let executorPreview = parsed.executorPreview;
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

      let dryRun = await dryRunExperiencePackExecutorPreview(executorPreview, createExecutorContext());
      pendingDryRun = dryRun;

      if (dryRun.status === 'pending-user-input') {
        const canResolveAsCreateNewSpaces = parsed.plan.steps.some(
          (step) => step.kind === 'apply-space-layout' && step.mode === 'prompt'
        );
        if (!canResolveAsCreateNewSpaces) {
          throw new Error(
            t('settings.plugins.pmpex.install.error.pendingUserInput', {
              diagnostics: formatDiagnosticLines(dryRun.diagnostics),
            })
          );
        }

        const ok = await confirm({
          title: t('settings.plugins.pmpex.install.spacePrompt.title'),
          message: t('settings.plugins.pmpex.install.spacePrompt.message', {
            diagnostics: formatDiagnosticLines(dryRun.diagnostics),
          }),
          confirmText: t('settings.plugins.pmpex.install.spacePrompt.createNew'),
          cancelText: t('common.action.cancel'),
        });
        if (!ok) return;

        await cleanupExperiencePackExecutorDryRun(dryRun);
        executorPreview = resolvePromptSpaceModeAsCreateNewSpaces(executorPreview);
        dryRun = await dryRunExperiencePackExecutorPreview(executorPreview, createExecutorContext());
        pendingDryRun = dryRun;
      }
      if (dryRun.status !== 'ready') {
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

      const ok = await confirm({
        title: t('settings.plugins.pmpex.install.confirm.title'),
        message: confirmText,
        confirmText: t('common.action.install'),
        cancelText: t('common.action.cancel'),
      });
      if (!ok) return;

      const commit = await commitExperiencePackExecutorPreview(executorPreview, {
        ...createExecutorContext(),
        dryRun,
      });
      pendingDryRun = null;

      if (commit.status !== 'committed') {
        throw new Error(
          t('settings.plugins.pmpex.install.error.commitBlocked', {
            diagnostics: formatDiagnosticLines(commit.diagnostics),
          })
        );
      }

      for (const installed of commit.installedExtensions) {
        if (supportsInstalledExtensionMagnetSurface(installed)) {
          const template = createMagnetTemplateFromInstalledExtension(installed);
          upsertMagnetCatalogMagnet(template);

          if (!magnetLibrary.some((magnet) => magnet.id === installed.manifest.identity.id)) {
            setMagnetLibrary((prev) =>
              prev.some((magnet) => magnet.id === installed.manifest.identity.id)
                ? prev
                : [...prev, template]
            );
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
    setMagnetLibrary,
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

  return (
    <PmpCard className="settings-card" surfaceId="primitive.card.settings">
      {error && <div className="settings-inline-error">{error}</div>}
      <div className="settings-card-header" style={{ marginTop: 20 }}>
        <div>
          <p className="settings-card-label">{t('settings.plugins.v2.label')}</p>
          <p className="settings-card-desc">{t('settings.plugins.v2.desc')}</p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <PmpButton
            className="settings-action-btn"
            variant="default"
            onClick={() => void handleInstallManifestV2()}
            disabled={busy}
          >
            {t('settings.plugins.v2.action.install')}
          </PmpButton>
          <PmpButton
            className="settings-action-btn"
            variant="default"
            onClick={() => void handleInstallExtensionPack()}
            disabled={busy}
          >
            {t('settings.plugins.pmpe.action.install')}
          </PmpButton>
          <PmpButton
            className="settings-action-btn"
            variant="default"
            onClick={() => void handleInstallExperiencePack()}
            disabled={busy}
          >
            {t('settings.plugins.pmpex.action.install')}
          </PmpButton>
        </div>
      </div>

      <div className="settings-plugin-list">
        {installedExtensionsV2.length === 0 ? (
          <div className="settings-card-note">{t('settings.plugins.v2.empty')}</div>
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
            const { runtimeSourceLabel, runtimeProjectionTitle } =
              buildRuntimePresentation(t, runtimeResolution);
            const commands = record.manifest.contributes?.core?.commands?.length ?? 0;
            const keybindings = record.manifest.contributes?.core?.keybindings?.length ?? 0;
            const extensionAudit = installedExtensionAuditLog
              .filter((event) => event.pluginId === identity.id)
              .slice(-8)
              .reverse();
            const primaryPage = pages === 1 ? hostContributions?.pages?.[0] ?? null : null;
            const primaryWindow = windows === 1 ? hostContributions?.windows?.[0] ?? null : null;
            const primaryVisualizer =
              visualizers === 1 ? hostContributions?.visualizers?.[0] ?? null : null;
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
                      {enabled ? t('settings.plugins.tag.enabled') : t('settings.plugins.tag.disabled')}
                    </span>
                    <span className="settings-plugin-tag">
                      {t('settings.plugins.v2.tag.publisher', { publisher: identity.publisher })}
                    </span>
                    {runtimeResolution?.status === 'resolved' ? (
                      <>
                        <span className="settings-plugin-tag" title={runtimeProjectionTitle}>
                          {t('settings.plugins.tag.runtimeResolved', {
                            runtimeId: runtimeResolution.runtime.runtimeId,
                          })}
                        </span>
                        <span className="settings-plugin-tag" title={runtimeProjectionTitle}>
                          {t('settings.plugins.tag.launcher', {
                            launcherId: runtimeResolution.launcher.id,
                          })}
                        </span>
                        {runtimeSourceLabel ? (
                          <span className="settings-plugin-tag" title={runtimeProjectionTitle}>
                            {runtimeSourceLabel}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <span className="settings-plugin-tag" title={runtimeProjectionTitle}>
                          {runtimeResolution
                            ? t('settings.plugins.tag.runtimeBlocked')
                            : t('settings.plugins.tag.runtimeMissing')}
                        </span>
                      </>
                    )}
                    {commands > 0 && (
                      <span className="settings-plugin-tag">
                        {t('settings.plugins.tag.commandsCount', { count: commands })}
                      </span>
                    )}
                    {keybindings > 0 && (
                      <span className="settings-plugin-tag">
                        {t('settings.plugins.v2.tag.keybindingsCount', { count: keybindings })}
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
                  </div>

                  <div className="settings-plugin-permissions">
                    <div>{t('settings.plugins.v2.capabilities.label')}</div>
                    {capabilityBindings.length === 0 ? (
                      <div className="settings-row-desc">{t('settings.plugins.v2.capabilities.none')}</div>
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

                  {devSession ? (
                    <div className="settings-plugin-permissions">
                      <div>{t('settings.plugins.devSession.label')}</div>
                      <div className="settings-row-desc-list settings-row-meta">
                        <div>
                          {t('settings.plugins.devSession.projectRoot', {
                            path: devSession.projectRoot,
                          })}
                        </div>
                        <div>
                          {t('settings.plugins.devSession.mode', {
                            mode:
                              devSession.mode === 'entry-url'
                                ? t('settings.plugins.devSession.mode.entryUrl')
                                : t('settings.plugins.devSession.mode.entryPath'),
                          })}
                        </div>
                        <div>
                          {t('settings.plugins.devSession.runtimeKinds', {
                            kinds: devSession.runtimeKinds.join(', '),
                          })}
                        </div>
                        <div>
                          {t('settings.plugins.devSession.effectiveSource', {
                            source:
                              runtimeSourceLabel ??
                              (devSession
                                ? t('settings.plugins.tag.runtimeSourceDev')
                                : t('settings.plugins.tag.runtimeSourceManifest')),
                          })}
                        </div>
                        {runtimeResolution?.status === 'resolved' ? (
                          <div
                            className="settings-row-desc"
                            title={runtimeResolution.artifact.path}
                          >
                            {t('settings.plugins.devSession.effectivePath', {
                              path: runtimeResolution.artifact.path,
                            })}
                          </div>
                        ) : null}
                        <div>
                          {t('settings.plugins.devSession.lastRestart', {
                            value: formatDevSessionRestartSummary(t, devSession),
                          })}
                        </div>
                        <div>
                          {t('settings.plugins.devSession.updatedAt', {
                            value: formatSettingsTimestamp(devSession.updatedAt),
                          })}
                        </div>
                        {devSession.lastError ? (
                          <div className="settings-plugin-error" title={devSession.lastError}>
                            {t('settings.plugins.devSession.lastError', {
                              message: devSession.lastError,
                            })}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {record.lastError && (
                    <div className="settings-plugin-error" title={record.lastError}>
                      {record.lastError}
                    </div>
                  )}

                  {extensionAudit.length > 0 && (
                    <details className="settings-plugin-details">
                      <summary className="settings-plugin-details-summary">
                        {t('settings.plugins.audit.summary', { count: extensionAudit.length })}
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

                  {devSession ? (
                    <PmpButton
                      type="button"
                      className="settings-action-btn"
                      variant="default"
                      disabled={busy}
                      onClick={() => refreshPluginDevSession(identity.id)}
                      title={t('settings.plugins.devSession.action.refresh.title')}
                    >
                      {t('settings.plugins.devSession.action.refresh')}
                    </PmpButton>
                  ) : null}

                  {devSession ? (
                    <PmpButton
                      type="button"
                      className="settings-action-btn"
                      variant="danger"
                      disabled={busy}
                      onClick={() => detachPluginDevSession(identity.id)}
                      title={t('settings.plugins.devSession.action.detach.title')}
                    >
                      {t('settings.plugins.devSession.action.detach')}
                    </PmpButton>
                  ) : null}

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
      {confirmDialog}
    </PmpCard>
  );
}
