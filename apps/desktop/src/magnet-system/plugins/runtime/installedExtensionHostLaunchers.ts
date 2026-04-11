import type { PluginRuntimeLauncherId } from './types';

export const INSTALLED_EXTENSION_COMMAND_LAUNCHERS: readonly PluginRuntimeLauncherId[] =
  Object.freeze(['pxp.extension-host.worker', 'pxp.sidecar.native-process']);

export const INSTALLED_EXTENSION_VIEW_LAUNCHERS: readonly PluginRuntimeLauncherId[] = Object.freeze([
  'pxp.webview.host-frame',
]);
