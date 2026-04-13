import type {
  InstalledExtensionRecord,
  PxpManifestV2,
  RuntimeEntryDescriptor,
} from '@pixel-matrix/plugin-platform-contracts';

export type PluginRuntimeSurfaceKind =
  | 'magnet'
  | 'settings'
  | 'page'
  | 'visualizer'
  | 'window'
  | 'overlay'
  | 'desktop-widget'
  | 'command';

export type PluginRuntimeLauncherId =
  | 'pxp.webview.host-frame'
  | 'pxp.extension-host.worker'
  | 'pxp.sidecar.native-process';

export type PluginRuntimeLauncherAvailability = 'available' | 'planned';

export type PluginRuntimeLauncherTransport =
  | 'inline-module'
  | 'webview-frame'
  | 'worker'
  | 'sidecar-process';

export interface PluginRuntimeLauncherDescriptor {
  id: PluginRuntimeLauncherId;
  runtimeKinds: RuntimeEntryDescriptor['kind'][];
  surfaceKinds: PluginRuntimeSurfaceKind[];
  availability: PluginRuntimeLauncherAvailability;
  transport: PluginRuntimeLauncherTransport;
  description: string;
}

export interface PluginRuntimeResolverContext {
  hostId?: string;
  platform?: string | null;
  arch?: string | null;
  surfaceKind?: PluginRuntimeSurfaceKind;
  preferCommandWorker?: boolean;
  supportedLauncherIds?: PluginRuntimeLauncherId[];
}

export interface PluginRuntimeArtifactResolution {
  runtimeId: string;
  path: string;
  sha256?: string;
}

export interface PluginRuntimeResolutionBase {
  pluginId: string;
  manifest: PxpManifestV2;
  installedRecord: InstalledExtensionRecord<PxpManifestV2>;
  hostId: string;
  issues: string[];
}

export interface ResolvedPluginRuntime extends PluginRuntimeResolutionBase {
  status: 'resolved';
  runtime: RuntimeEntryDescriptor;
  launcher: PluginRuntimeLauncherDescriptor;
  artifact: PluginRuntimeArtifactResolution;
  source: 'manifest-runtime';
}

export interface BlockedPluginRuntime extends PluginRuntimeResolutionBase {
  status: 'blocked';
  runtime?: RuntimeEntryDescriptor;
  candidateLaunchers: PluginRuntimeLauncherDescriptor[];
}

export type PluginRuntimeResolution = ResolvedPluginRuntime | BlockedPluginRuntime;

export function isResolvedPluginRuntime(
  resolution: PluginRuntimeResolution | null | undefined
): resolution is ResolvedPluginRuntime {
  return resolution?.status === 'resolved';
}
