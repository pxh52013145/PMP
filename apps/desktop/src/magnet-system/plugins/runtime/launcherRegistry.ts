import type { RuntimeEntryDescriptor } from '@pixel-matrix/plugin-platform-contracts';
import type { PluginRuntimeLauncherDescriptor, PluginRuntimeLauncherId } from './types';

const PLUGIN_RUNTIME_LAUNCHERS: readonly PluginRuntimeLauncherDescriptor[] = Object.freeze([
  {
    id: 'pxp.webview.host-frame',
    runtimeKinds: ['webview'],
    surfaceKinds: ['magnet', 'settings', 'page', 'visualizer', 'window', 'overlay', 'desktop-widget'],
    availability: 'available',
    transport: 'webview-frame',
    description: 'Manifest-v2 webview runtime host for long-lived view surfaces',
  },
  {
    id: 'pxp.extension-host.worker',
    runtimeKinds: ['extension-host'],
    surfaceKinds: ['command'],
    availability: 'available',
    transport: 'worker',
    description: 'Dedicated worker launcher for command-oriented extension-host runtimes',
  },
  {
    id: 'pxp.sidecar.native-process',
    runtimeKinds: ['sidecar'],
    surfaceKinds: ['command'],
    availability: 'available',
    transport: 'sidecar-process',
    description: 'Native sidecar launcher for command-oriented sidecar runtimes',
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
