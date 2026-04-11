import type { PluginRuntimeResolution, PluginRuntimeSurfaceKind } from './types';
import { resolveInstalledExtensionRuntime } from './runtimeResolver';
import { isResolvedPluginRuntime } from './types';
import { getInstalledPmpmExtensionRecord } from '../pmpm';

export function resolveInstalledPmpmPluginRuntime(
  pluginId: string,
  options: {
    preferSandbox?: boolean;
    surfaceKind?: PluginRuntimeSurfaceKind;
    preferCommandWorker?: boolean;
  } = {}
): PluginRuntimeResolution | null {
  const record = getInstalledPmpmExtensionRecord(pluginId);
  if (!record) return null;

  return resolveInstalledExtensionRuntime(record, {
    hostId: 'pmp',
    preferSandboxLauncher: options.preferSandbox ?? false,
    surfaceKind: options.surfaceKind,
    preferCommandWorker: options.preferCommandWorker ?? false,
  });
}

export function shouldUsePmpmSandboxLauncher(
  resolution: PluginRuntimeResolution | null | undefined
): boolean {
  return isResolvedPluginRuntime(resolution) && resolution.launcher.id === 'compat.pmpm.webview-sandbox';
}

export function shouldUsePmpmInlineModuleLauncher(
  resolution: PluginRuntimeResolution | null | undefined
): boolean {
  return isResolvedPluginRuntime(resolution) && resolution.launcher.id === 'compat.pmpm.inline-module';
}

export function getPluginRuntimeResolutionError(
  resolution: PluginRuntimeResolution | null | undefined
): string | null {
  if (!resolution) return 'Plugin runtime record not found';
  if (resolution.status === 'resolved') return null;
  return resolution.issues[0] ?? 'No compatible runtime launcher is available';
}
