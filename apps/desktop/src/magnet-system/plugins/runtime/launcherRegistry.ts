import type { RuntimeEntryDescriptor } from '@pixel-matrix/plugin-platform-contracts';
import type { PluginRuntimeLauncherDescriptor, PluginRuntimeLauncherId } from './types';

const PLUGIN_RUNTIME_LAUNCHERS: readonly PluginRuntimeLauncherDescriptor[] = Object.freeze([
  {
    id: 'compat.pmpm.inline-module',
    runtimeKinds: ['extension-host'],
    availability: 'available',
    transport: 'inline-module',
    compatLayerId: 'compat.pmpm',
    description: 'Current PMPM in-process module runtime',
  },
  {
    id: 'compat.pmpm.webview-sandbox',
    runtimeKinds: ['extension-host', 'webview'],
    availability: 'available',
    transport: 'webview-frame',
    compatLayerId: 'compat.pmpm',
    description: 'Current PMPM iframe sandbox runtime',
  },
  {
    id: 'pxp.webview.host-frame',
    runtimeKinds: ['webview'],
    availability: 'planned',
    transport: 'webview-frame',
    description: 'Future manifest-driven webview runtime host',
  },
  {
    id: 'pxp.extension-host.worker',
    runtimeKinds: ['extension-host'],
    availability: 'planned',
    transport: 'worker',
    description: 'Future manifest-driven extension-host launcher',
  },
  {
    id: 'pxp.sidecar.native-process',
    runtimeKinds: ['sidecar'],
    availability: 'planned',
    transport: 'sidecar-process',
    description: 'Future native sidecar launcher',
  },
]);

export function listPluginRuntimeLaunchers(): PluginRuntimeLauncherDescriptor[] {
  return [...PLUGIN_RUNTIME_LAUNCHERS];
}

export function getPluginRuntimeLauncher(
  launcherId: PluginRuntimeLauncherId
): PluginRuntimeLauncherDescriptor | null {
  return (
    PLUGIN_RUNTIME_LAUNCHERS.find((launcher) => launcher.id === launcherId) ?? null
  );
}

export function listLaunchersForRuntimeKind(
  runtimeKind: RuntimeEntryDescriptor['kind']
): PluginRuntimeLauncherDescriptor[] {
  return PLUGIN_RUNTIME_LAUNCHERS.filter((launcher) =>
    launcher.runtimeKinds.includes(runtimeKind)
  );
}
