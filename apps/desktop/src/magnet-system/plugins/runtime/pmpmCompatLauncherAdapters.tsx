import type { CommandsService } from '../../../services/commands';
import type { KeybindingsService } from '../../../services/keybindings';
import { getPmpmPluginEffectivePermissions } from '../pmpm';
import { PmpmSandboxHost, type PmpmSandboxSurface } from '../PmpmSandboxHost';
import {
  createPluginMountApi,
  type HostAudioService,
  type HostNavigation,
  type PluginMountApi,
} from '../pluginHostApi';
import { runPmpmSandboxedCommand } from '../pmpmSandboxCommandRunner';
import { ensurePmpmPluginRuntime, type PmpmPluginRuntime } from '../pmpmRuntime';
import { runPmpmBridgeWorkerCommand } from './workerCommandRuntime';
import { runPmpmBridgeSidecarCommand } from './sidecarCommandRuntime';
import type { PluginRuntimeResolution } from './types';
import { isResolvedPluginRuntime } from './types';

export interface PmpmResolvedLauncherSurfaceProps {
  pluginId: string;
  hostLabel: string;
  surface: PmpmSandboxSurface;
  mountContext?: unknown;
}

export interface PmpmInlineSurfaceMountOptions extends PmpmResolvedLauncherSurfaceProps {
  container: HTMLElement;
  api: PluginMountApi;
}

export interface RunResolvedPmpmPluginCommandOptions {
  pluginId: string;
  resolution: PluginRuntimeResolution | null | undefined;
  commandId: string;
  args?: unknown;
  hostLabel?: string;
  audioService: HostAudioService;
  commands?: CommandsService | null;
  navigation: HostNavigation;
  keybindings?: KeybindingsService | null;
  timeoutMs?: number;
}

type InlineResolvedPmpmLauncherAdapter = {
  mode: 'inline';
  launcherId: 'compat.pmpm.inline-module';
  mountSurface: (options: PmpmInlineSurfaceMountOptions) => Promise<void | (() => void)>;
  runCommand: (options: RunResolvedPmpmPluginCommandOptions) => Promise<void>;
};

type SandboxResolvedPmpmLauncherAdapter = {
  mode: 'sandbox';
  launcherId: 'compat.pmpm.webview-sandbox';
  renderSurface: (props: PmpmResolvedLauncherSurfaceProps) => JSX.Element;
  runCommand: (options: RunResolvedPmpmPluginCommandOptions) => Promise<void>;
};

type WorkerResolvedPmpmLauncherAdapter = {
  mode: 'worker';
  launcherId: 'pxp.extension-host.worker';
  runCommand: (options: RunResolvedPmpmPluginCommandOptions) => Promise<void>;
};

type SidecarResolvedPmpmLauncherAdapter = {
  mode: 'sidecar';
  launcherId: 'pxp.sidecar.native-process';
  runCommand: (options: RunResolvedPmpmPluginCommandOptions) => Promise<void>;
};

export type ResolvedPmpmLauncherAdapter =
  | InlineResolvedPmpmLauncherAdapter
  | SandboxResolvedPmpmLauncherAdapter
  | WorkerResolvedPmpmLauncherAdapter
  | SidecarResolvedPmpmLauncherAdapter;

function readUnsupportedLauncherError(
  resolution: PluginRuntimeResolution | null | undefined
): string {
  if (!resolution) return 'Plugin runtime record not found';
  if (resolution.status !== 'resolved') {
    return resolution.issues[0] ?? 'No compatible runtime launcher is available';
  }
  return `Resolved runtime launcher is not wired: ${resolution.launcher.id}`;
}

function mountInlineSurfaceWithRuntime(
  runtime: PmpmPluginRuntime,
  options: PmpmInlineSurfaceMountOptions
): void | (() => void) {
  switch (options.surface.kind) {
    case 'magnet':
      return runtime.mount(options.container, options.api, options.mountContext);
    case 'settings': {
      const mount = runtime.mountSettings;
      if (typeof mount !== 'function') {
        throw new Error('Plugin entry must export `mountSettings(container, api, panelId?)`');
      }
      return mount(options.container, options.api, options.surface.panelId);
    }
    case 'page': {
      const mount = runtime.mountPage;
      if (typeof mount !== 'function') {
        throw new Error('Plugin entry must export `mountPage(container, api, pageId)`');
      }
      return mount(options.container, options.api, options.surface.pageId);
    }
    case 'visualizer': {
      const mount = runtime.mountVisualizer;
      if (typeof mount !== 'function') {
        throw new Error('Plugin entry must export `mountVisualizer(container, api, visualizerId)`');
      }
      return mount(options.container, options.api, options.surface.visualizerId);
    }
    case 'window': {
      const mount = runtime.mountWindow;
      if (typeof mount !== 'function') {
        throw new Error('Plugin entry must export `mountWindow(container, api, windowId)`');
      }
      return mount(options.container, options.api, options.surface.windowId);
    }
  }
}

const INLINE_RESOLVED_PMPM_LAUNCHER_ADAPTER: InlineResolvedPmpmLauncherAdapter = {
  mode: 'inline',
  launcherId: 'compat.pmpm.inline-module',
  mountSurface: async (options) => {
    const runtime = await ensurePmpmPluginRuntime(options.pluginId);
    return mountInlineSurfaceWithRuntime(runtime, options);
  },
  runCommand: async (options) => {
    const permissions = getPmpmPluginEffectivePermissions(options.pluginId);
    const api = createPluginMountApi({
      pluginId: options.pluginId,
      hostLabel: options.hostLabel ?? 'PluginCommand',
      permissions,
      audioService: options.audioService,
      commands: options.commands,
      navigation: options.navigation,
      keybindings: options.keybindings,
    });

    const runtime = await ensurePmpmPluginRuntime(options.pluginId);
    const runCommand = runtime.runCommand;
    if (typeof runCommand !== 'function') {
      throw new Error('Plugin entry must export `runCommand(api, commandId, args?)`');
    }
    await runCommand(api, options.commandId, options.args);
  },
};

const SANDBOX_RESOLVED_PMPM_LAUNCHER_ADAPTER: SandboxResolvedPmpmLauncherAdapter = {
  mode: 'sandbox',
  launcherId: 'compat.pmpm.webview-sandbox',
  renderSurface: (props) => (
    <PmpmSandboxHost
      pluginId={props.pluginId}
      hostLabel={props.hostLabel}
      mountContext={props.mountContext}
      {...props.surface}
    />
  ),
  runCommand: async (options) => {
    await runPmpmSandboxedCommand({
      pluginId: options.pluginId,
      commandId: options.commandId,
      args: options.args,
      hostLabel: options.hostLabel,
      audioService: options.audioService,
      commands: options.commands,
      navigation: options.navigation,
      keybindings: options.keybindings,
      timeoutMs: options.timeoutMs,
    });
  },
};

const WORKER_RESOLVED_PMPM_LAUNCHER_ADAPTER: WorkerResolvedPmpmLauncherAdapter = {
  mode: 'worker',
  launcherId: 'pxp.extension-host.worker',
  runCommand: async (options) => {
    const runtimeId =
      options.resolution && options.resolution.status === 'resolved'
        ? options.resolution.runtime.runtimeId
        : 'compat.pmpm.main';

    await runPmpmBridgeWorkerCommand({
      pluginId: options.pluginId,
      runtimeId,
      commandId: options.commandId,
      args: options.args,
      hostLabel: options.hostLabel,
      audioService: options.audioService,
      commands: options.commands,
      navigation: options.navigation,
      keybindings: options.keybindings,
      timeoutMs: options.timeoutMs,
    });
  },
};

const SIDECAR_RESOLVED_PMPM_LAUNCHER_ADAPTER: SidecarResolvedPmpmLauncherAdapter = {
  mode: 'sidecar',
  launcherId: 'pxp.sidecar.native-process',
  runCommand: async (options) => {
    const runtimeId =
      options.resolution && options.resolution.status === 'resolved'
        ? options.resolution.runtime.runtimeId
        : 'sidecar.main';
    const entryPath =
      options.resolution && options.resolution.status === 'resolved'
        ? options.resolution.artifact.path
        : 'bin/sidecar';

    await runPmpmBridgeSidecarCommand({
      pluginId: options.pluginId,
      runtimeId,
      entryPath,
      commandId: options.commandId,
      args: options.args,
      hostLabel: options.hostLabel,
      audioService: options.audioService,
      commands: options.commands,
      navigation: options.navigation,
      keybindings: options.keybindings,
      timeoutMs: options.timeoutMs,
    });
  },
};

export function getResolvedPmpmLauncherAdapter(
  resolution: PluginRuntimeResolution | null | undefined
): ResolvedPmpmLauncherAdapter | null {
  if (!isResolvedPluginRuntime(resolution)) return null;

  switch (resolution.launcher.id) {
    case 'compat.pmpm.inline-module':
      return INLINE_RESOLVED_PMPM_LAUNCHER_ADAPTER;
    case 'compat.pmpm.webview-sandbox':
      return SANDBOX_RESOLVED_PMPM_LAUNCHER_ADAPTER;
    case 'pxp.extension-host.worker':
      return WORKER_RESOLVED_PMPM_LAUNCHER_ADAPTER;
    case 'pxp.sidecar.native-process':
      return SIDECAR_RESOLVED_PMPM_LAUNCHER_ADAPTER;
    default:
      return null;
  }
}

export function getResolvedPmpmLauncherAdapterError(
  resolution: PluginRuntimeResolution | null | undefined
): string | null {
  if (getResolvedPmpmLauncherAdapter(resolution)) return null;
  return readUnsupportedLauncherError(resolution);
}

export async function runResolvedPmpmPluginCommand(
  options: RunResolvedPmpmPluginCommandOptions
): Promise<void> {
  const adapter = getResolvedPmpmLauncherAdapter(options.resolution);
  if (!adapter) {
    throw new Error(readUnsupportedLauncherError(options.resolution));
  }
  await adapter.runCommand(options);
}
