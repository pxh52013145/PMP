import { createServiceToken } from '../../kernel';
import type { AudioEngineService } from '../../services/audio';
import type { CommandsService } from '../../services/commands';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import type { KeybindingsService } from '../../services/keybindings';
import type { NavigationService } from '../../services/navigation';
import {
  assertInstalledExtensionActivationAllowed,
  hasInstalledExtensionStartupActivation,
  readInstalledExtensionActivationError,
  type InstalledExtensionActivationTrigger,
} from './activationEvents';
import {
  loadInstalledExtensions,
  recordInstalledExtensionCrash,
  subscribeInstalledExtensions,
  type InstalledHostExtensionRecord,
} from './extensions';
import {
  readHostExtensionRuntimeRestartRequest,
  subscribeHostExtensionRuntimeRestart,
} from './hostExtensionRuntimeSupervisor';
import {
  INSTALLED_EXTENSION_COMMAND_LAUNCHERS,
  INSTALLED_EXTENSION_VIEW_LAUNCHERS,
} from './runtime/installedExtensionHostLaunchers';
import { runResolvedInstalledExtensionCommand } from './runtime/extensionCommandRuntime';
import { startInstalledExtensionStartupRuntime } from './runtime/extensionStartupRuntime';
import { resolveInstalledExtensionRuntime } from './runtime';
import type {
  PluginRuntimeLauncherId,
  PluginRuntimeResolution,
  PluginRuntimeSurfaceKind,
} from './runtime/types';
import {
  createPluginRuntimeResolveTelemetryContext,
  reportPluginRuntimeResolve,
} from './pluginLifecycleTelemetry';

const telemetry = getTelemetryLogger('extensions', 'installedExtensionRuntimeManager');

type StartupRuntimeHandle = Awaited<ReturnType<typeof startInstalledExtensionStartupRuntime>>;
type RestartListener = () => void;

export type InstalledExtensionRuntimeResolveOptions = {
  surfaceKind: PluginRuntimeSurfaceKind;
  supportedLauncherIds?: PluginRuntimeLauncherId[];
  preferCommandWorker?: boolean;
};

export type RunInstalledExtensionCommandOptions = {
  record: InstalledHostExtensionRecord;
  commandId: string;
  args?: unknown;
  hostLabel?: string;
  timeoutMs?: number;
};

export interface InstalledExtensionRuntimeManager {
  getRestartRevision: () => number;
  subscribeRestart: (listener: RestartListener) => () => void;
  getRestartToken: (pluginId: string) => number;
  readActivationError: (
    record: InstalledHostExtensionRecord,
    trigger: InstalledExtensionActivationTrigger
  ) => string | null;
  assertActivationAllowed: (
    record: InstalledHostExtensionRecord,
    trigger: InstalledExtensionActivationTrigger
  ) => void;
  resolveRuntime: (
    record: InstalledHostExtensionRecord,
    options: InstalledExtensionRuntimeResolveOptions
  ) => PluginRuntimeResolution;
  runCommand: (options: RunInstalledExtensionCommandOptions) => Promise<void>;
  start: () => void;
  dispose: () => void;
}

export const INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN =
  createServiceToken<InstalledExtensionRuntimeManager>('service.installed-extension-runtime-manager');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shouldAutoStartOnStartup(record: InstalledHostExtensionRecord): boolean {
  if (record.enabled === false) return false;
  return hasInstalledExtensionStartupActivation(record);
}

export class DefaultInstalledExtensionRuntimeManager
  implements InstalledExtensionRuntimeManager
{
  private readonly restartListeners = new Set<RestartListener>();
  private readonly runtimeHandles = new Map<string, StartupRuntimeHandle>();
  private readonly inflightStarts = new Map<string, Promise<void>>();
  private restartRevision = 0;
  private lastRestartAt = 0;
  private disposeInstalledSync: (() => void) | null = null;
  private disposeRestartSync: (() => void) | null = null;
  private started = false;
  private disposed = false;

  constructor(
    private readonly deps: {
      audioEngine: AudioEngineService;
      commands: CommandsService | null;
      navigation: NavigationService;
      keybindings: KeybindingsService | null;
    }
  ) {}

  getRestartRevision = (): number => {
    return this.restartRevision;
  };

  subscribeRestart = (listener: RestartListener): (() => void) => {
    this.restartListeners.add(listener);
    return () => {
      this.restartListeners.delete(listener);
    };
  };

  getRestartToken = (pluginId: string): number => {
    const request = readHostExtensionRuntimeRestartRequest('extv2');
    if (!request) return 0;
    if (request.pluginId !== pluginId) return 0;
    return request.at;
  };

  readActivationError = (
    record: InstalledHostExtensionRecord,
    trigger: InstalledExtensionActivationTrigger
  ): string | null => {
    return readInstalledExtensionActivationError(record, trigger);
  };

  assertActivationAllowed = (
    record: InstalledHostExtensionRecord,
    trigger: InstalledExtensionActivationTrigger
  ): void => {
    assertInstalledExtensionActivationAllowed(record, trigger);
  };

  resolveRuntime = (
    record: InstalledHostExtensionRecord,
    options: InstalledExtensionRuntimeResolveOptions
  ): PluginRuntimeResolution => {
    const supportedLauncherIds =
      options.supportedLauncherIds ??
      (options.surfaceKind === 'command'
        ? [...INSTALLED_EXTENSION_COMMAND_LAUNCHERS]
        : [...INSTALLED_EXTENSION_VIEW_LAUNCHERS]);

    return resolveInstalledExtensionRuntime(record, {
      hostId: 'pmp',
      surfaceKind: options.surfaceKind,
      preferCommandWorker:
        options.preferCommandWorker ?? options.surfaceKind === 'command',
      supportedLauncherIds,
    });
  };

  runCommand = async (options: RunInstalledExtensionCommandOptions): Promise<void> => {
    const { record, commandId } = options;
    const pluginId = record.manifest.identity.id;

    try {
      this.assertActivationAllowed(record, {
        cause: 'command',
        commandId,
      });

      const resolution = this.resolveRuntime(record, {
        surfaceKind: 'command',
        preferCommandWorker: true,
        supportedLauncherIds: [...INSTALLED_EXTENSION_COMMAND_LAUNCHERS],
      });
      reportPluginRuntimeResolve({
        context: createPluginRuntimeResolveTelemetryContext({
          pluginId,
          sourceKind: 'extv2',
          hostLabel: options.hostLabel ?? 'ExtensionCommand',
          surfaceKind: 'command',
          surfaceId: commandId,
          cause: 'command',
        }),
        resolution,
        extraFields: {
          hostId: 'pmp',
          supportedLauncherIds: [...INSTALLED_EXTENSION_COMMAND_LAUNCHERS],
          preferCommandWorker: true,
        },
      });

      await runResolvedInstalledExtensionCommand({
        record,
        resolution,
        commandId,
        args: options.args,
        hostLabel: options.hostLabel ?? 'ExtensionCommand',
        audioService: this.deps.audioEngine.getSnapshot().audioService,
        commands: this.deps.commands,
        navigation: this.deps.navigation,
        keybindings: this.deps.keybindings,
        timeoutMs: options.timeoutMs,
      });
    } catch (error) {
      recordInstalledExtensionCrash(pluginId, error);
      throw error;
    }
  };

  start = (): void => {
    if (this.started || this.disposed) return;
    this.started = true;

    this.syncStartupRuntimes();
    this.disposeInstalledSync = subscribeInstalledExtensions(this.syncStartupRuntimes);
    this.disposeRestartSync = subscribeHostExtensionRuntimeRestart(this.handleRestartSignal);
  };

  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.started = false;

    try {
      this.disposeInstalledSync?.();
    } catch (error) {
      telemetry.warn('extension.runtime_manager.unsubscribe_installed_failed', {
        message: readErrorMessage(error),
      });
    }
    this.disposeInstalledSync = null;

    try {
      this.disposeRestartSync?.();
    } catch (error) {
      telemetry.warn('extension.runtime_manager.unsubscribe_restart_failed', {
        message: readErrorMessage(error),
      });
    }
    this.disposeRestartSync = null;

    for (const pluginId of Array.from(this.runtimeHandles.keys())) {
      void this.stopRuntime(pluginId, 'module-dispose');
    }
    this.runtimeHandles.clear();
  };

  private notifyRestartListeners = (): void => {
    this.restartRevision += 1;
    for (const listener of Array.from(this.restartListeners)) {
      try {
        listener();
      } catch (error) {
        telemetry.warn('extension.runtime_manager.restart_listener_failed', {
          message: readErrorMessage(error),
        });
      }
    }
  };

  private stopRuntime = async (pluginId: string, reason: string): Promise<void> => {
    const handle = this.runtimeHandles.get(pluginId);
    this.runtimeHandles.delete(pluginId);
    if (!handle) return;
    try {
      await handle.dispose(reason);
    } catch (error) {
      telemetry.warn('extension.runtime_manager.dispose_failed', {
        message: readErrorMessage(error),
        fields: { pluginId, reason },
      });
    }
  };

  private ensureStartupRuntime = async (record: InstalledHostExtensionRecord): Promise<void> => {
    const pluginId = record.manifest.identity.id;
    if (this.runtimeHandles.has(pluginId)) return;

    const activationError = this.readActivationError(record, { cause: 'startup' });
    if (activationError) {
      telemetry.warn('extension.runtime_manager.startup_activation_blocked', {
        message: activationError,
        fields: { pluginId },
      });
      return;
    }

    if (this.inflightStarts.has(pluginId)) {
      await this.inflightStarts.get(pluginId);
      return;
    }

    const startPromise = (async () => {
      const resolution = this.resolveRuntime(record, {
        surfaceKind: 'command',
        preferCommandWorker: true,
        supportedLauncherIds: ['pxp.extension-host.worker'],
      });
      reportPluginRuntimeResolve({
        context: createPluginRuntimeResolveTelemetryContext({
          pluginId,
          sourceKind: 'extv2',
          hostLabel: 'ExtensionStartupWorker',
          cause: 'startup',
        }),
        resolution,
        extraFields: {
          hostId: 'pmp',
          supportedLauncherIds: ['pxp.extension-host.worker'],
          preferCommandWorker: true,
        },
      });

      if (resolution.status !== 'resolved') {
        return;
      }

      const handle = await startInstalledExtensionStartupRuntime({
        record,
        resolution,
        hostLabel: 'ExtensionStartupWorker',
        audioService: this.deps.audioEngine.getSnapshot().audioService,
        commands: this.deps.commands,
        navigation: this.deps.navigation,
        keybindings: this.deps.keybindings,
      });
      this.runtimeHandles.set(pluginId, handle);
    })()
      .catch((error) => {
        telemetry.error('extension.runtime_manager.startup_start_failed', {
          message: readErrorMessage(error),
          fields: { pluginId },
        });
      })
      .finally(() => {
        this.inflightStarts.delete(pluginId);
      });

    this.inflightStarts.set(pluginId, startPromise);
    await startPromise;
  };

  private syncStartupRuntimes = (): void => {
    const installed = loadInstalledExtensions();
    const nextPluginIds = new Set(
      installed
        .filter((record) => shouldAutoStartOnStartup(record))
        .map((record) => record.manifest.identity.id)
    );

    for (const pluginId of Array.from(this.runtimeHandles.keys())) {
      if (nextPluginIds.has(pluginId)) continue;
      void this.stopRuntime(pluginId, 'startup-activation-disabled');
    }

    for (const record of installed) {
      if (!shouldAutoStartOnStartup(record)) continue;
      void this.ensureStartupRuntime(record);
    }
  };

  private handleRestartSignal = (): void => {
    const restart = readHostExtensionRuntimeRestartRequest('extv2');
    if (!restart || restart.at <= this.lastRestartAt) return;
    this.lastRestartAt = restart.at;
    this.notifyRestartListeners();
    void this.stopRuntime(restart.pluginId, restart.reason ?? 'runtime-restart').finally(() => {
      this.syncStartupRuntimes();
    });
  };
}
