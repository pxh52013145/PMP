import type {
  InstalledExtensionRecord,
  PxpManifestV2,
  RuntimeEntryDescriptor,
} from '@pixel-matrix/plugin-platform-contracts';
import {
  listLaunchersForRuntimeKind,
  getPluginRuntimeLauncher,
} from './launcherRegistry';
import type {
  BlockedPluginRuntime,
  PluginRuntimeArtifactResolution,
  PluginRuntimeLauncherDescriptor,
  PluginRuntimeResolution,
  PluginRuntimeResolverContext,
  ResolvedPluginRuntime,
} from './types';

const DEFAULT_HOST_ID = 'pmp';
const PMPM_COMPAT_LAYER_ID = 'compat.pmpm';

function normalizeCompatLayerIds(manifest: PxpManifestV2): string[] {
  return (manifest.compat ?? [])
    .map((entry) => entry.compatLayerId)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function matchesConstraint(
  value: string | null | undefined,
  allowed: string[] | undefined
): boolean {
  if (!allowed || allowed.length === 0) return true;
  if (!value) return true;
  return allowed.includes(value);
}

function resolveArtifact(
  record: InstalledExtensionRecord<PxpManifestV2>,
  runtime: RuntimeEntryDescriptor
): PluginRuntimeArtifactResolution {
  const artifact = record.resolvedArtifacts?.find((item) => item.runtimeId === runtime.runtimeId);
  if (artifact) {
    return {
      runtimeId: artifact.runtimeId,
      path: artifact.path,
      sha256: artifact.sha256,
    };
  }

  return {
    runtimeId: runtime.runtimeId,
    path: runtime.entry,
  };
}

function sortRuntimes(runtimes: RuntimeEntryDescriptor[]): RuntimeEntryDescriptor[] {
  return [...runtimes].sort((left, right) => {
    const priorityDiff = (right.priority ?? 0) - (left.priority ?? 0);
    if (priorityDiff !== 0) return priorityDiff;
    return left.runtimeId.localeCompare(right.runtimeId);
  });
}

function listCandidateLaunchers(
  runtime: RuntimeEntryDescriptor,
  context: Required<PluginRuntimeResolverContext>
): PluginRuntimeLauncherDescriptor[] {
  const requestedSurface = context.surfaceKind;
  const runtimeProvides = runtime.provides ?? [];
  const supportsPmpmCompat =
    runtimeProvides.includes(PMPM_COMPAT_LAYER_ID) || runtime.runtimeId.startsWith('compat.');

  const surfaceLaunchers = listLaunchersForRuntimeKind(runtime.kind).filter((launcher) =>
    requestedSurface ? launcher.surfaceKinds.includes(requestedSurface) : true
  );
  const genericLaunchers = surfaceLaunchers.filter((launcher) => !launcher.compatLayerId);
  const compatLaunchers = surfaceLaunchers.filter(
    (launcher) => launcher.compatLayerId === PMPM_COMPAT_LAYER_ID && supportsPmpmCompat
  );

  if (!supportsPmpmCompat) {
    return genericLaunchers;
  }

  const preferredCompatOrder = context.preferCompatSandbox
    ? ([
        getPluginRuntimeLauncher('compat.pmpm.webview-sandbox'),
        getPluginRuntimeLauncher('compat.pmpm.inline-module'),
      ] as const)
    : ([
        getPluginRuntimeLauncher('compat.pmpm.inline-module'),
        getPluginRuntimeLauncher('compat.pmpm.webview-sandbox'),
      ] as const);

  const orderedCompat = preferredCompatOrder.filter(
    (launcher): launcher is PluginRuntimeLauncherDescriptor => {
      if (!launcher) return false;
      return compatLaunchers.some((candidate) => candidate.id === launcher.id);
    }
  );

  if (context.surfaceKind === 'command' && context.preferCommandWorker) {
    return [...genericLaunchers, ...orderedCompat];
  }

  return [...orderedCompat, ...genericLaunchers];
}

function buildBlockedResolution(
  record: InstalledExtensionRecord<PxpManifestV2>,
  hostId: string,
  issues: string[],
  runtime?: RuntimeEntryDescriptor,
  candidateLaunchers: PluginRuntimeLauncherDescriptor[] = []
): BlockedPluginRuntime {
  return {
    status: 'blocked',
    pluginId: record.manifest.identity.id,
    manifest: record.manifest,
    installedRecord: record,
    hostId,
    compatLayerIds: normalizeCompatLayerIds(record.manifest),
    issues,
    runtime,
    candidateLaunchers,
  };
}

function buildResolvedRuntime(
  record: InstalledExtensionRecord<PxpManifestV2>,
  hostId: string,
  runtime: RuntimeEntryDescriptor,
  launcher: PluginRuntimeLauncherDescriptor,
  issues: string[]
): ResolvedPluginRuntime {
  return {
    status: 'resolved',
    pluginId: record.manifest.identity.id,
    manifest: record.manifest,
    installedRecord: record,
    hostId,
    compatLayerIds: normalizeCompatLayerIds(record.manifest),
    issues,
    runtime,
    launcher,
    artifact: resolveArtifact(record, runtime),
    source: launcher.compatLayerId ? 'compat-runtime' : 'manifest-runtime',
  };
}

export function resolveInstalledExtensionRuntime(
  record: InstalledExtensionRecord<PxpManifestV2>,
  context: PluginRuntimeResolverContext = {}
): PluginRuntimeResolution {
  const resolvedContext: Required<PluginRuntimeResolverContext> = {
    hostId: context.hostId ?? DEFAULT_HOST_ID,
    platform: context.platform ?? null,
    arch: context.arch ?? null,
    preferCompatSandbox: context.preferCompatSandbox ?? false,
    surfaceKind: context.surfaceKind ?? 'magnet',
    preferCommandWorker: context.preferCommandWorker ?? false,
  };

  const issues: string[] = [];
  const manifest = record.manifest;

  const requiredHostTargets = manifest.hostTargets.filter((target) => target.required !== false);
  if (requiredHostTargets.length > 0) {
    const matchesHost = requiredHostTargets.some(
      (target) => target.hostId === resolvedContext.hostId
    );
    if (!matchesHost) {
      return buildBlockedResolution(record, resolvedContext.hostId, [
        `Plugin does not target host "${resolvedContext.hostId}"`,
      ]);
    }
  }

  if (!Array.isArray(manifest.runtimes) || manifest.runtimes.length === 0) {
    return buildBlockedResolution(record, resolvedContext.hostId, [
      'Manifest does not declare any runtimes',
    ]);
  }

  const sortedRuntimes = sortRuntimes(manifest.runtimes);

  for (const runtime of sortedRuntimes) {
    if (!matchesConstraint(resolvedContext.platform, runtime.platform)) {
      issues.push(
        `Runtime "${runtime.runtimeId}" does not match platform "${resolvedContext.platform}"`
      );
      continue;
    }
    if (!matchesConstraint(resolvedContext.arch, runtime.arch)) {
      issues.push(`Runtime "${runtime.runtimeId}" does not match arch "${resolvedContext.arch}"`);
      continue;
    }

    const candidateLaunchers = listCandidateLaunchers(runtime, resolvedContext);
    if (candidateLaunchers.length === 0) {
      issues.push(`Runtime "${runtime.runtimeId}" has no compatible launcher`);
      continue;
    }

    const availableLauncher = candidateLaunchers.find(
      (launcher) => launcher.availability === 'available'
    );
    if (availableLauncher) {
      return buildResolvedRuntime(
        record,
        resolvedContext.hostId,
        runtime,
        availableLauncher,
        issues
      );
    }

    issues.push(
      `Runtime "${runtime.runtimeId}" only matches planned launchers: ${candidateLaunchers
        .map((launcher) => launcher.id)
        .join(', ')}`
    );
  }

  const fallbackRuntime = sortedRuntimes[0];
  const fallbackLaunchers = fallbackRuntime
    ? listCandidateLaunchers(fallbackRuntime, resolvedContext)
    : [];

  return buildBlockedResolution(
    record,
    resolvedContext.hostId,
    issues.length > 0 ? issues : ['No launchable runtime candidates found'],
    fallbackRuntime,
    fallbackLaunchers
  );
}
