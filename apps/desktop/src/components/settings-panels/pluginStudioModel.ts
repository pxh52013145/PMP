import type { Magnet } from '../../types/pixel';
import type { MagnetRendererDefinition } from '../../magnet-system/registry';
import type { MagnetVariantDefinition } from '../../magnet-system/variantRegistry';
import type { InstalledHostExtensionRecord } from '../../magnet-system/plugins/extensions';
import type { InstalledExtensionAuditEvent } from '../../magnet-system/plugins/extensionsGovernance';
import type { PluginRuntimeResolution } from '../../magnet-system/plugins/runtime';
import type { PluginDevSessionRecord } from '../../magnet-system/plugins/devSessionRegistry';

export type PluginStudioWorkspaceId =
  | 'activation'
  | 'displays'
  | 'installed'
  | 'package-import'
  | 'developer'
  | 'magnets'
  | 'appearance'
  | 'diagnostics';

export type PluginStudioDiagnosticSeverity = 'error' | 'warning' | 'info';

export type PluginStudioDiagnosticArea =
  | 'extension'
  | 'package'
  | 'runtime'
  | 'magnet'
  | 'theme'
  | 'profile'
  | 'layout'
  | 'diagnostics';

export interface PluginStudioWorkspaceDefinition {
  id: PluginStudioWorkspaceId;
  titleKey: string;
  descKey: string;
}

export interface PluginStudioDiagnostic {
  id: string;
  area: PluginStudioDiagnosticArea;
  severity: PluginStudioDiagnosticSeverity;
  titleKey: string;
  messageKey: string;
  params?: Record<string, unknown>;
  subjectId?: string;
}

export interface PluginStudioOverviewMetric {
  id: string;
  labelKey: string;
  value: number;
}

export interface BuildPluginStudioDiagnosticsInput {
  installedExtensions: readonly InstalledHostExtensionRecord[];
  runtimeResolutionByExtensionId: ReadonlyMap<string, PluginRuntimeResolution | null>;
  devSessions: readonly PluginDevSessionRecord[];
  auditLog: readonly InstalledExtensionAuditEvent[];
  magnetLibrary: readonly Magnet[];
  activeMagnetIds: ReadonlySet<string>;
  registeredRenderers: readonly MagnetRendererDefinition[];
  variantsByRendererId: ReadonlyMap<string, readonly MagnetVariantDefinition[]>;
}

export interface BuildPluginStudioMetricsInput {
  installedExtensions: readonly InstalledHostExtensionRecord[];
  devSessions: readonly PluginDevSessionRecord[];
  magnetLibrary: readonly Magnet[];
  activeMagnetIds: ReadonlySet<string>;
  diagnostics: readonly PluginStudioDiagnostic[];
}

export const PLUGIN_STUDIO_WORKSPACES: readonly PluginStudioWorkspaceDefinition[] = [
  {
    id: 'package-import',
    titleKey: 'settings.plugins.studio.nav.packageImport',
    descKey: 'settings.plugins.studio.nav.packageImport.desc',
  },
  {
    id: 'activation',
    titleKey: 'settings.plugins.studio.nav.activation',
    descKey: 'settings.plugins.studio.nav.activation.desc',
  },
  {
    id: 'displays',
    titleKey: 'settings.plugins.studio.nav.displays',
    descKey: 'settings.plugins.studio.nav.displays.desc',
  },
] as const;

export function resolveMagnetRendererId(magnet: Pick<Magnet, 'id' | 'renderer'>): string {
  return magnet.renderer?.trim() || magnet.id;
}

export function applyMagnetVariantToLibrary(
  magnetLibrary: readonly Magnet[],
  magnetId: string,
  variantId: string | null
): Magnet[] {
  return magnetLibrary.map((magnet) => {
    if (magnet.id !== magnetId) return magnet;
    const normalizedVariant = variantId?.trim();
    if (normalizedVariant) return { ...magnet, variant: normalizedVariant };
    const nextMagnet = { ...magnet };
    delete nextMagnet.variant;
    return nextMagnet;
  });
}

export function applyMagnetSkinPropsToLibrary(
  magnetLibrary: readonly Magnet[],
  magnetId: string,
  skinProps: Record<string, unknown> | null
): Magnet[] {
  return magnetLibrary.map((magnet) => {
    if (magnet.id !== magnetId) return magnet;
    if (skinProps && Object.keys(skinProps).length > 0) return { ...magnet, skinProps };
    const nextMagnet = { ...magnet };
    delete nextMagnet.skinProps;
    return nextMagnet;
  });
}

export function readInstalledExtensionDisplayName(record: InstalledHostExtensionRecord): string {
  return record.manifest.identity.displayName ?? record.manifest.identity.name;
}

export function getPluginStudioDiagnosticAreaLabelKey(
  area: PluginStudioDiagnosticArea
): string {
  switch (area) {
    case 'extension':
      return 'settings.plugins.studio.diagnostics.area.extension';
    case 'package':
      return 'settings.plugins.studio.diagnostics.area.package';
    case 'runtime':
      return 'settings.plugins.studio.diagnostics.area.runtime';
    case 'magnet':
      return 'settings.plugins.studio.diagnostics.area.magnet';
    case 'theme':
      return 'settings.plugins.studio.diagnostics.area.theme';
    case 'profile':
      return 'settings.plugins.studio.diagnostics.area.profile';
    case 'layout':
      return 'settings.plugins.studio.diagnostics.area.layout';
    case 'diagnostics':
      return 'settings.plugins.studio.diagnostics.area.diagnostics';
    default:
      return 'settings.plugins.studio.diagnostics.area.diagnostics';
  }
}

export function getPluginStudioDiagnosticSeverityLabelKey(
  severity: PluginStudioDiagnosticSeverity
): string {
  switch (severity) {
    case 'error':
      return 'settings.plugins.studio.diagnostics.severity.error';
    case 'warning':
      return 'settings.plugins.studio.diagnostics.severity.warning';
    case 'info':
      return 'settings.plugins.studio.diagnostics.severity.info';
    default:
      return 'settings.plugins.studio.diagnostics.severity.info';
  }
}

export function buildPluginStudioMetrics({
  installedExtensions,
  devSessions,
  magnetLibrary,
  activeMagnetIds,
  diagnostics,
}: BuildPluginStudioMetricsInput): PluginStudioOverviewMetric[] {
  return [
    {
      id: 'installed',
      labelKey: 'settings.plugins.studio.metric.installed',
      value: installedExtensions.length,
    },
    {
      id: 'enabled',
      labelKey: 'settings.plugins.studio.metric.enabled',
      value: installedExtensions.filter((record) => record.enabled !== false).length,
    },
    {
      id: 'devSessions',
      labelKey: 'settings.plugins.studio.metric.devSessions',
      value: devSessions.length,
    },
    {
      id: 'activeMagnets',
      labelKey: 'settings.plugins.studio.metric.activeMagnets',
      value: magnetLibrary.filter((magnet) => activeMagnetIds.has(magnet.id)).length,
    },
    {
      id: 'diagnostics',
      labelKey: 'settings.plugins.studio.metric.diagnostics',
      value: diagnostics.filter((diagnostic) => diagnostic.severity !== 'info').length,
    },
  ];
}

export function buildPluginStudioDiagnostics({
  installedExtensions,
  runtimeResolutionByExtensionId,
  devSessions,
  auditLog,
  magnetLibrary,
  activeMagnetIds,
  registeredRenderers,
  variantsByRendererId,
}: BuildPluginStudioDiagnosticsInput): PluginStudioDiagnostic[] {
  const diagnostics: PluginStudioDiagnostic[] = [];
  const rendererIds = new Set(registeredRenderers.map((renderer) => renderer.id));

  for (const record of installedExtensions) {
    const pluginId = record.manifest.identity.id;
    const displayName = readInstalledExtensionDisplayName(record);
    const runtimeResolution = runtimeResolutionByExtensionId.get(pluginId) ?? null;

    if (record.disabledReason === 'quarantine') {
      diagnostics.push({
        id: `extension:${pluginId}:quarantine`,
        area: 'extension',
        severity: 'warning',
        titleKey: 'settings.plugins.studio.diagnostics.extensionQuarantined.title',
        messageKey: 'settings.plugins.studio.diagnostics.extensionQuarantined.message',
        params: { id: pluginId, name: displayName },
        subjectId: pluginId,
      });
    }

    if (record.lastError) {
      diagnostics.push({
        id: `extension:${pluginId}:lastError`,
        area: 'runtime',
        severity: 'error',
        titleKey: 'settings.plugins.studio.diagnostics.extensionError.title',
        messageKey: 'settings.plugins.studio.diagnostics.extensionError.message',
        params: { id: pluginId, name: displayName, message: record.lastError },
        subjectId: pluginId,
      });
    }

    if (runtimeResolution?.status === 'blocked') {
      diagnostics.push({
        id: `extension:${pluginId}:runtimeBlocked`,
        area: 'runtime',
        severity: 'warning',
        titleKey: 'settings.plugins.studio.diagnostics.runtimeBlocked.title',
        messageKey: 'settings.plugins.studio.diagnostics.runtimeBlocked.message',
        params: {
          id: pluginId,
          name: displayName,
          issues: runtimeResolution.issues.join(', ') || '-',
        },
        subjectId: pluginId,
      });
    } else if (!runtimeResolution) {
      diagnostics.push({
        id: `extension:${pluginId}:runtimeMissing`,
        area: 'runtime',
        severity: 'warning',
        titleKey: 'settings.plugins.studio.diagnostics.runtimeMissing.title',
        messageKey: 'settings.plugins.studio.diagnostics.runtimeMissing.message',
        params: { id: pluginId, name: displayName },
        subjectId: pluginId,
      });
    }
  }

  for (const session of devSessions) {
    if (!session.lastError) continue;
    diagnostics.push({
      id: `dev-session:${session.pluginId}:lastError`,
      area: 'runtime',
      severity: 'error',
      titleKey: 'settings.plugins.studio.diagnostics.devSessionError.title',
      messageKey: 'settings.plugins.studio.diagnostics.devSessionError.message',
      params: { id: session.pluginId, message: session.lastError },
      subjectId: session.pluginId,
    });
  }

  const latestAuditByPluginId = new Map<string, InstalledExtensionAuditEvent>();
  for (const event of auditLog) {
    latestAuditByPluginId.set(event.pluginId, event);
  }
  for (const [pluginId, event] of latestAuditByPluginId) {
    if (event.type !== 'crash' && event.type !== 'runtime-unresponsive') continue;
    diagnostics.push({
      id: `audit:${pluginId}:${event.type}`,
      area: 'runtime',
      severity: event.type === 'crash' ? 'error' : 'warning',
      titleKey:
        event.type === 'crash'
          ? 'settings.plugins.studio.diagnostics.auditCrash.title'
          : 'settings.plugins.studio.diagnostics.auditUnresponsive.title',
      messageKey:
        event.type === 'crash'
          ? 'settings.plugins.studio.diagnostics.auditCrash.message'
          : 'settings.plugins.studio.diagnostics.auditUnresponsive.message',
      params: {
        id: pluginId,
        surface: event.surface,
        message: event.type === 'crash' ? event.message : String(event.timeoutMs),
      },
      subjectId: pluginId,
    });
  }

  for (const magnet of magnetLibrary) {
    const rendererId = resolveMagnetRendererId(magnet);
    const variantOptions = variantsByRendererId.get(rendererId) ?? [];
    if (!rendererIds.has(rendererId)) {
      diagnostics.push({
        id: `magnet:${magnet.id}:missingRenderer`,
        area: 'magnet',
        severity: activeMagnetIds.has(magnet.id) ? 'error' : 'warning',
        titleKey: 'settings.plugins.studio.diagnostics.missingRenderer.title',
        messageKey: 'settings.plugins.studio.diagnostics.missingRenderer.message',
        params: { id: magnet.id, rendererId },
        subjectId: magnet.id,
      });
    }

    if (
      magnet.variant &&
      variantOptions.length > 0 &&
      !variantOptions.some((variant) => variant.id === magnet.variant)
    ) {
      diagnostics.push({
        id: `magnet:${magnet.id}:unknownVariant`,
        area: 'magnet',
        severity: 'warning',
        titleKey: 'settings.plugins.studio.diagnostics.unknownVariant.title',
        messageKey: 'settings.plugins.studio.diagnostics.unknownVariant.message',
        params: { id: magnet.id, rendererId, variant: magnet.variant },
        subjectId: magnet.id,
      });
    }

    if (
      activeMagnetIds.has(magnet.id) &&
      (!Array.isArray(magnet.anchors) || magnet.anchors.length === 0) &&
      !magnet.gridFootprint
    ) {
      diagnostics.push({
        id: `magnet:${magnet.id}:missingAnchors`,
        area: 'layout',
        severity: 'error',
        titleKey: 'settings.plugins.studio.diagnostics.missingAnchors.title',
        messageKey: 'settings.plugins.studio.diagnostics.missingAnchors.message',
        params: { id: magnet.id },
        subjectId: magnet.id,
      });
    }
  }

  if (diagnostics.length === 0) {
    diagnostics.push({
      id: 'studio:clean',
      area: 'diagnostics',
      severity: 'info',
      titleKey: 'settings.plugins.studio.diagnostics.clean.title',
      messageKey: 'settings.plugins.studio.diagnostics.clean.message',
    });
  }

  return diagnostics;
}
