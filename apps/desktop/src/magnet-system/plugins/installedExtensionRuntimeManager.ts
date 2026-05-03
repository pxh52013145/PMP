import { createServiceToken, type ScopedEventBus } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import type { PluginSurfaceSourceKind } from '../../contracts/pluginSurfaceSource';
import type { AudioEngineService } from '../../services/audio';
import type { CommandsService } from '../../services/commands';
import type { KeybindingsService } from '../../services/keybindings';
import type { NavigationService } from '../../services/navigation';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { setupTauriListener, TAURI_EVENTS } from '../../utils/windowCommunication';
import type { HostNavigation } from './pluginHostApi';
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
  getPluginDevSessionRevisionToken,
  subscribePluginDevSessions,
} from './devSessionRegistry';
import {
  readHostExtensionRuntimeRestartRequest,
  subscribeHostExtensionRuntimeRestart,
} from './hostExtensionRuntimeSupervisor';
import {
  createPluginRuntimeResolveTelemetryContext,
  reportPluginRuntimeResolve,
} from './pluginLifecycleTelemetry';
import {
  INSTALLED_EXTENSION_COMMAND_LAUNCHERS,
  INSTALLED_EXTENSION_VIEW_LAUNCHERS,
} from './runtime/installedExtensionHostLaunchers';
import { runResolvedInstalledExtensionCommand } from './runtime/extensionCommandRuntime';
import {
  startInstalledExtensionBackgroundRuntime,
  startInstalledExtensionStartupRuntime,
  type InstalledExtensionBackgroundActivation,
} from './runtime/extensionStartupRuntime';
import { resolveInstalledExtensionRuntime } from './runtime';
import type {
  PluginRuntimeLauncherId,
  PluginRuntimeResolution,
  PluginRuntimeSurfaceKind,
} from './runtime/types';

const telemetry = getTelemetryLogger('extensions', 'installedExtensionRuntimeManager');

type ManagedRuntimeHandle = Awaited<ReturnType<typeof startInstalledExtensionStartupRuntime>>;
export type ManagedRuntimeMode = 'startup' | 'event';
export type ManagedRuntimeSnapshot = {
  pluginId: string;
  mode: ManagedRuntimeMode;
  runtimeInstanceId: string | null;
};
export type ManagedRuntimeSnapshotListener = (runtimes: ManagedRuntimeSnapshot[]) => void;
type ManagedRuntimeEntry = {
  handle: ManagedRuntimeHandle;
  mode: ManagedRuntimeMode;
};
type RestartListener = () => void;
type InstalledExtensionLifecycleSnapshot = {
  enabled: boolean;
  disabledReason: InstalledHostExtensionRecord['disabledReason'] | null;
  deniedCapabilitiesKey: string;
  startupActivation: boolean;
};
type EnsureBackgroundRuntimeOptions = {
  record: InstalledHostExtensionRecord;
  trigger: InstalledExtensionActivationTrigger;
  activation: InstalledExtensionBackgroundActivation;
  mode: ManagedRuntimeMode;
  hostLabel: string;
};
type ActivateMatchingExtensionsOptions = {
  trigger: InstalledExtensionActivationTrigger;
  activation: InstalledExtensionBackgroundActivation;
  hostLabel: string;
  skipPluginId?: string;
};

const BACKGROUND_RUNTIME_LAUNCHERS: readonly PluginRuntimeLauncherId[] = Object.freeze([
  'pxp.extension-host.worker',
]);

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

export type ActivateInstalledExtensionCapabilityOptions = {
  capabilityId: string;
  method?: string;
  requestKind?: 'invoke' | 'open-session' | 'open-stream' | 'close-session';
  sourcePluginId?: string;
  sourceKind?: 'extv2';
  hostLabel?: string;
};

export type ActivateInstalledExtensionHostEventOptions = {
  hostEventId: string;
  payload?: unknown;
  hostLabel?: string;
};

export type ActivateInstalledExtensionFileOptions = {
  fileType: string;
  filePath?: string;
  action?: string;
  hostLabel?: string;
};

export interface InstalledExtensionRuntimeManager {
  getRestartRevision: () => number;
  subscribeRestart: (listener: RestartListener) => () => void;
  getRestartToken: (pluginId: string) => number;
  listManagedRuntimes: () => ManagedRuntimeSnapshot[];
  subscribeManagedRuntimes: (listener: ManagedRuntimeSnapshotListener) => () => void;
  cleanupManagedRuntimes: (reason?: string) => Promise<number>;
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
  activateForCapability: (options: ActivateInstalledExtensionCapabilityOptions) => Promise<void>;
  activateForHostEvent: (options: ActivateInstalledExtensionHostEventOptions) => Promise<void>;
  activateForFile: (options: ActivateInstalledExtensionFileOptions) => Promise<void>;
  start: () => void;
  dispose: () => void;
}

export const INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN =
  createServiceToken<InstalledExtensionRuntimeManager>('service.installed-extension-runtime-manager');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function shouldAutoStartOnStartup(record: InstalledHostExtensionRecord): boolean {
  if (record.enabled === false) return false;
  return hasInstalledExtensionStartupActivation(record);
}

function normalizeDeniedCapabilities(record: InstalledHostExtensionRecord): string {
  return [...(record.deniedCapabilities ?? [])]
    .filter((capabilityId): capabilityId is string => typeof capabilityId === 'string')
    .map((capabilityId) => capabilityId.trim())
    .filter((capabilityId) => capabilityId.length > 0)
    .sort((left, right) => left.localeCompare(right))
    .join('\n');
}

function createLifecycleSnapshot(
  record: InstalledHostExtensionRecord
): InstalledExtensionLifecycleSnapshot {
  return {
    enabled: record.enabled !== false,
    disabledReason: record.disabledReason ?? null,
    deniedCapabilitiesKey: normalizeDeniedCapabilities(record),
    startupActivation: hasInstalledExtensionStartupActivation(record),
  };
}

function readLifecycleRestartReason(
  previous: InstalledExtensionLifecycleSnapshot,
  next: InstalledExtensionLifecycleSnapshot
): string | null {
  if (previous.deniedCapabilitiesKey !== next.deniedCapabilitiesKey) {
    return 'capabilities-updated';
  }

  if (previous.enabled !== next.enabled) {
    if (next.enabled) {
      return 'extension-enabled';
    }
    if (next.disabledReason === 'quarantine') {
      return 'extension-quarantined';
    }
    if (next.disabledReason === 'policy') {
      return 'extension-policy-disabled';
    }
    return 'extension-disabled';
  }

  if (previous.disabledReason !== next.disabledReason) {
    if (next.disabledReason === 'quarantine') {
      return 'extension-quarantined';
    }
    if (next.disabledReason === 'policy') {
      return 'extension-policy-disabled';
    }
    if (!next.enabled) {
      return 'extension-disabled';
    }
    return 'extension-enabled';
  }

  if (previous.startupActivation !== next.startupActivation) {
    return next.startupActivation
      ? 'startup-activation-enabled'
      : 'startup-activation-disabled';
  }

  return null;
}

function buildActivationSurfaceId(
  trigger: InstalledExtensionActivationTrigger
): string | null {
  switch (trigger.cause) {
    case 'startup':
      return null;
    case 'command':
      return trigger.commandId;
    case 'view':
      return trigger.viewId;
    case 'capability':
      return trigger.capabilityId;
    case 'host':
      return trigger.hostEventId;
    case 'file':
      return trigger.fileType;
    default: {
      const exhaustive: never = trigger;
      return String(exhaustive);
    }
  }
}

function buildDisabledReason(
  record: InstalledHostExtensionRecord | null
): string {
  if (!record) {
    return 'extension-removed';
  }

  if (record.disabledReason === 'quarantine') {
    return 'extension-quarantined';
  }

  if (record.disabledReason === 'policy') {
    return 'extension-policy-disabled';
  }

  return 'extension-disabled';
}

export class DefaultInstalledExtensionRuntimeManager
  implements InstalledExtensionRuntimeManager
{
  private readonly restartListeners = new Set<RestartListener>();
  private readonly managedRuntimeListeners = new Set<ManagedRuntimeSnapshotListener>();
  private readonly runtimeHandles = new Map<string, ManagedRuntimeEntry>();
  private readonly inflightStarts = new Map<string, Promise<void>>();
  private readonly lifecycleTokens = new Map<string, number>();
  private readonly lifecycleSnapshots = new Map<string, InstalledExtensionLifecycleSnapshot>();
  private readonly devSessionTokens = new Map<string, string | null>();
  private restartRevision = 0;
  private lastRestartAt = 0;
  private lastLifecycleTokenAt = 0;
  private disposeInstalledSync: (() => void) | null = null;
  private disposeDevSessionSync: (() => void) | null = null;
  private disposeRestartSync: (() => void) | null = null;
  private disposeHostEventSync: (() => void) | null = null;
  private started = false;
  private disposed = false;

  constructor(
    private readonly deps: {
      audioEngine: AudioEngineService;
      commands: CommandsService | null;
      navigation: NavigationService;
      keybindings: KeybindingsService | null;
      events: ScopedEventBus<AppEvents>;
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
    const request = readHostExtensionRuntimeRestartRequest();
    const supervisorToken =
      request && request.pluginId === pluginId ? request.at : 0;
    const lifecycleToken = this.lifecycleTokens.get(pluginId) ?? 0;
    return Math.max(supervisorToken, lifecycleToken);
  };

  listManagedRuntimes = (): ManagedRuntimeSnapshot[] => {
    return Array.from(this.runtimeHandles.entries())
      .map(([pluginId, entry]) => ({
        pluginId,
        mode: entry.mode,
        runtimeInstanceId:
          typeof entry.handle.runtimeInstanceId === 'string'
            ? entry.handle.runtimeInstanceId
            : null,
      }))
      .sort((left, right) => left.pluginId.localeCompare(right.pluginId));
  };

  subscribeManagedRuntimes = (
    listener: ManagedRuntimeSnapshotListener
  ): (() => void) => {
    this.managedRuntimeListeners.add(listener);
    listener(this.listManagedRuntimes());
    return () => {
      this.managedRuntimeListeners.delete(listener);
    };
  };

  cleanupManagedRuntimes = async (
    reason: string = 'runtime-capsule-reclaim'
  ): Promise<number> => {
    const pluginIds = Array.from(this.runtimeHandles.keys());
    if (pluginIds.length === 0) return 0;

    await Promise.allSettled(
      pluginIds.map((pluginId) => this.stopRuntime(pluginId, reason))
    );
    for (const pluginId of pluginIds) {
      this.bumpLifecycleToken(pluginId);
    }
    this.notifyRestartListeners();
    return pluginIds.length - this.runtimeHandles.size;
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
    const hostNavigation = this.createHostNavigation();

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
        navigation: hostNavigation,
        keybindings: this.deps.keybindings,
        timeoutMs: options.timeoutMs,
        onHostCapabilityActivity: (activity: {
          capabilityId: string;
          method: string;
          payload?: unknown;
          requestKind: 'invoke' | 'open-session' | 'open-stream' | 'close-session';
          sourcePluginId: string;
          sourceKind: PluginSurfaceSourceKind;
          hostLabel: string;
        }) => {
          void this.activateForCapability({
            capabilityId: activity.capabilityId,
            method: activity.method,
            requestKind: activity.requestKind,
            sourcePluginId: activity.sourcePluginId,
            sourceKind: activity.sourceKind,
            hostLabel: activity.hostLabel,
          });
        },
      });
    } catch (error) {
      recordInstalledExtensionCrash(pluginId, error);
      throw error;
    }
  };

  activateForCapability = async (
    options: ActivateInstalledExtensionCapabilityOptions
  ): Promise<void> => {
    if (this.disposed) return;

    const capabilityId = normalizeNonEmptyString(options.capabilityId);
    if (!capabilityId) return;

    await this.activateMatchingExtensions({
      trigger: {
        cause: 'capability',
        capabilityId,
      },
      activation: {
        cause: 'capability',
        activationEvent: `onCapability:${capabilityId}`,
        surface: 'capability',
        payload: {
          capabilityId,
          method: normalizeNonEmptyString(options.method) ?? null,
          requestKind: options.requestKind ?? 'invoke',
          sourcePluginId: normalizeNonEmptyString(options.sourcePluginId) ?? null,
          sourceKind: options.sourceKind ?? null,
          hostLabel: normalizeNonEmptyString(options.hostLabel) ?? null,
        },
      },
      hostLabel: options.hostLabel ?? 'ExtensionCapabilityActivation',
      skipPluginId: normalizeNonEmptyString(options.sourcePluginId) ?? undefined,
    });
  };

  activateForHostEvent = async (
    options: ActivateInstalledExtensionHostEventOptions
  ): Promise<void> => {
    if (this.disposed) return;

    const hostEventId = normalizeNonEmptyString(options.hostEventId);
    if (!hostEventId) return;

    await this.activateMatchingExtensions({
      trigger: {
        cause: 'host',
        hostEventId,
      },
      activation: {
        cause: 'host-event',
        activationEvent: `onHost:${hostEventId}`,
        surface: 'host',
        payload: {
          hostEventId,
          eventPayload: options.payload ?? null,
        },
      },
      hostLabel: options.hostLabel ?? 'ExtensionHostEventActivation',
    });
  };

  activateForFile = async (
    options: ActivateInstalledExtensionFileOptions
  ): Promise<void> => {
    if (this.disposed) return;

    const fileType = normalizeNonEmptyString(options.fileType)?.toLowerCase();
    if (!fileType) return;

    await this.activateMatchingExtensions({
      trigger: {
        cause: 'file',
        fileType,
      },
      activation: {
        cause: 'file',
        activationEvent: `onFile:${fileType}`,
        surface: 'file',
        payload: {
          fileType,
          filePath: normalizeNonEmptyString(options.filePath) ?? null,
          action: normalizeNonEmptyString(options.action) ?? null,
        },
      },
      hostLabel: options.hostLabel ?? 'ExtensionFileActivation',
    });
  };

  start = (): void => {
    if (this.started || this.disposed) return;
    this.started = true;

    this.syncStartupRuntimes();
    this.disposeInstalledSync = subscribeInstalledExtensions(this.syncStartupRuntimes);
    this.disposeDevSessionSync = subscribePluginDevSessions(this.syncStartupRuntimes);
    this.disposeRestartSync = subscribeHostExtensionRuntimeRestart(this.handleRestartSignal);
    this.disposeHostEventSync = this.attachHostEventSources();
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
      this.disposeDevSessionSync?.();
    } catch (error) {
      telemetry.warn('extension.runtime_manager.unsubscribe_dev_sessions_failed', {
        message: readErrorMessage(error),
      });
    }
    this.disposeDevSessionSync = null;

    try {
      this.disposeRestartSync?.();
    } catch (error) {
      telemetry.warn('extension.runtime_manager.unsubscribe_restart_failed', {
        message: readErrorMessage(error),
      });
    }
    this.disposeRestartSync = null;

    try {
      this.disposeHostEventSync?.();
    } catch (error) {
      telemetry.warn('extension.runtime_manager.unsubscribe_host_events_failed', {
        message: readErrorMessage(error),
      });
    }
    this.disposeHostEventSync = null;

    for (const pluginId of Array.from(this.runtimeHandles.keys())) {
      void this.stopRuntime(pluginId, 'module-dispose');
    }
  };

  private createHostNavigation = (): HostNavigation => {
    return {
      navigateTo: (page, params) => this.deps.navigation.navigateTo(page, params),
      goBack: () => this.deps.navigation.goBack(),
      getSnapshot: () => this.deps.navigation.getSnapshot(),
      subscribe: (cb) =>
        this.deps.events.on('navigation/changed', (payload) => {
          cb(payload);
        }),
    };
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

  private emitManagedRuntimesChanged(): void {
    if (this.managedRuntimeListeners.size === 0) return;
    const snapshot = this.listManagedRuntimes();
    for (const listener of Array.from(this.managedRuntimeListeners)) {
      try {
        listener(snapshot);
      } catch (error) {
        telemetry.warn('extension.runtime_manager.managed_runtime_listener_failed', {
          message: readErrorMessage(error),
        });
      }
    }
  }

  private bumpLifecycleToken = (pluginId: string): void => {
    const now = Date.now();
    const nextToken =
      now > this.lastLifecycleTokenAt ? now : this.lastLifecycleTokenAt + 1;
    this.lastLifecycleTokenAt = nextToken;
    this.lifecycleTokens.set(pluginId, nextToken);
  };

  private readInstalledRecord = (pluginId: string): InstalledHostExtensionRecord | null => {
    return (
      loadInstalledExtensions().find(
        (record) => record.manifest.identity.id === pluginId
      ) ?? null
    );
  };

  private readManagedRuntimeInvalidationReason = (
    pluginId: string,
    mode: ManagedRuntimeMode,
    trigger: InstalledExtensionActivationTrigger
  ): string | null => {
    if (this.disposed) {
      return 'module-dispose';
    }

    const currentRecord = this.readInstalledRecord(pluginId);
    if (!currentRecord) {
      return 'extension-removed';
    }

    if (currentRecord.enabled === false) {
      return buildDisabledReason(currentRecord);
    }

    if (mode === 'startup' && !shouldAutoStartOnStartup(currentRecord)) {
      return 'startup-activation-disabled';
    }

    const activationError = this.readActivationError(currentRecord, trigger);
    if (activationError) {
      return 'activation-invalidated';
    }

    return null;
  };

  private stopRuntime = async (pluginId: string, reason: string): Promise<void> => {
    const entry = this.runtimeHandles.get(pluginId);
    this.runtimeHandles.delete(pluginId);
    if (!entry) return;
    this.emitManagedRuntimesChanged();

    try {
      await entry.handle.dispose(reason);
    } catch (error) {
      telemetry.warn('extension.runtime_manager.dispose_failed', {
        message: readErrorMessage(error),
        fields: { pluginId, reason },
      });
    }
  };

  private ensureStartupRuntime = async (record: InstalledHostExtensionRecord): Promise<void> => {
    await this.ensureBackgroundRuntime({
      record,
      trigger: { cause: 'startup' },
      activation: {
        cause: 'startup',
        activationEvent: 'onStartup',
        surface: 'startup',
      },
      mode: 'startup',
      hostLabel: 'ExtensionStartupWorker',
    });
  };

  private ensureBackgroundRuntime = async (
    options: EnsureBackgroundRuntimeOptions
  ): Promise<void> => {
    if (this.disposed) return;

    const pluginId = options.record.manifest.identity.id;
    const existingEntry = this.runtimeHandles.get(pluginId);
    if (existingEntry) {
      if (options.mode === 'startup' && existingEntry.mode === 'event') {
        existingEntry.mode = 'startup';
        this.emitManagedRuntimesChanged();
      }
      return;
    }

    const inflightStart = this.inflightStarts.get(pluginId);
    if (inflightStart) {
      await inflightStart;
      const currentEntry = this.runtimeHandles.get(pluginId);
      if (currentEntry && options.mode === 'startup' && currentEntry.mode === 'event') {
        currentEntry.mode = 'startup';
        this.emitManagedRuntimesChanged();
      }
      return;
    }

    const startPromise = (async () => {
      const resolution = this.resolveRuntime(options.record, {
        surfaceKind: 'command',
        preferCommandWorker: true,
        supportedLauncherIds: [...BACKGROUND_RUNTIME_LAUNCHERS],
      });

      reportPluginRuntimeResolve({
        context: createPluginRuntimeResolveTelemetryContext({
          pluginId,
          sourceKind: 'extv2',
          hostLabel: options.hostLabel,
          surfaceKind: options.activation.surface,
          surfaceId: buildActivationSurfaceId(options.trigger),
          cause: options.activation.cause,
        }),
        resolution,
        extraFields: {
          hostId: 'pmp',
          supportedLauncherIds: [...BACKGROUND_RUNTIME_LAUNCHERS],
          preferCommandWorker: true,
        },
      });

      if (resolution.status !== 'resolved') {
        return;
      }

      const sharedRuntimeOptions = {
        record: options.record,
        resolution,
        hostLabel: options.hostLabel,
        audioService: this.deps.audioEngine.getSnapshot().audioService,
        commands: this.deps.commands,
        navigation: this.createHostNavigation(),
        keybindings: this.deps.keybindings,
        onHostCapabilityActivity: (activity: {
          capabilityId: string;
          method: string;
          payload?: unknown;
          requestKind: 'invoke' | 'open-session' | 'open-stream' | 'close-session';
          sourcePluginId: string;
          sourceKind: PluginSurfaceSourceKind;
          hostLabel: string;
        }) => {
          void this.activateForCapability({
            capabilityId: activity.capabilityId,
            method: activity.method,
            requestKind: activity.requestKind,
            sourcePluginId: activity.sourcePluginId,
            sourceKind: activity.sourceKind,
            hostLabel: activity.hostLabel,
          });
        },
      };

      const handle =
        options.mode === 'startup'
          ? await startInstalledExtensionStartupRuntime(sharedRuntimeOptions)
          : await startInstalledExtensionBackgroundRuntime({
              ...sharedRuntimeOptions,
              activation: options.activation,
            });

      const staleReason = this.readManagedRuntimeInvalidationReason(
        pluginId,
        options.mode,
        options.trigger
      );
      if (staleReason) {
        await handle.dispose(staleReason);
        return;
      }

      const currentEntry = this.runtimeHandles.get(pluginId);
      if (currentEntry) {
        if (options.mode === 'startup' && currentEntry.mode === 'event') {
          currentEntry.mode = 'startup';
          this.emitManagedRuntimesChanged();
        }
        await handle.dispose('duplicate-runtime');
        return;
      }

      this.runtimeHandles.set(pluginId, {
        handle,
        mode: options.mode,
      });
      this.emitManagedRuntimesChanged();
    })()
      .catch((error) => {
        telemetry.error('extension.runtime_manager.background_start_failed', {
          message: readErrorMessage(error),
          fields: {
            pluginId,
            activationCause: options.activation.cause,
            activationEvent: options.activation.activationEvent,
          },
        });
      })
      .finally(() => {
        this.inflightStarts.delete(pluginId);
      });

    this.inflightStarts.set(pluginId, startPromise);
    await startPromise;
  };

  private activateMatchingExtensions = async (
    options: ActivateMatchingExtensionsOptions
  ): Promise<void> => {
    if (this.disposed) return;

    const tasks: Promise<void>[] = [];
    for (const record of loadInstalledExtensions()) {
      const pluginId = record.manifest.identity.id;
      if (record.enabled === false) continue;
      if (options.skipPluginId && pluginId === options.skipPluginId) continue;

      const activationError = this.readActivationError(record, options.trigger);
      if (activationError) {
        continue;
      }

      tasks.push(
        this.ensureBackgroundRuntime({
          record,
          trigger: options.trigger,
          activation: options.activation,
          mode: 'event',
          hostLabel: options.hostLabel,
        })
      );
    }

    if (tasks.length === 0) return;
    await Promise.allSettled(tasks);
  };

  private attachHostEventSources = (): (() => void) => {
    const disposers: Array<() => void> = [];
    let cleanedUp = false;

    const addDisposer = (dispose: () => void) => {
      if (cleanedUp) {
        try {
          dispose();
        } catch {
          // ignore
        }
        return;
      }
      disposers.push(dispose);
    };

    addDisposer(
      this.deps.events.on('navigation/changed', (payload) => {
        void this.activateForHostEvent({
          hostEventId: 'navigation.changed',
          payload,
          hostLabel: 'ExtensionHostEventActivation',
        });
      })
    );

    addDisposer(
      this.deps.events.on('audio/stateChanged', (payload) => {
        void this.activateForHostEvent({
          hostEventId: 'audio.state-changed',
          payload,
          hostLabel: 'ExtensionHostEventActivation',
        });
      })
    );

    addDisposer(
      this.deps.events.on('audio/error', (payload) => {
        void this.activateForHostEvent({
          hostEventId: 'audio.error',
          payload,
          hostLabel: 'ExtensionHostEventActivation',
        });
      })
    );

    const attachTauriSource = (eventName: string, hostEventId: string) => {
      void setupTauriListener(eventName, () => {
        void this.activateForHostEvent({
          hostEventId,
          hostLabel: 'ExtensionHostEventActivation',
        });
      })
        .then((dispose) => {
          addDisposer(dispose);
        })
        .catch((error) => {
          telemetry.warn('extension.runtime_manager.host_event_listener_failed', {
            message: readErrorMessage(error),
            fields: {
              eventName,
              hostEventId,
            },
          });
        });
    };

    attachTauriSource(TAURI_EVENTS.MAIN_WINDOW_HIDDEN, 'window.main.hidden');
    attachTauriSource(TAURI_EVENTS.MAIN_WINDOW_SHOWN, 'window.main.shown');
    attachTauriSource(
      TAURI_EVENTS.MAIN_WINDOW_CLOSE_REQUESTED,
      'window.main.close-requested'
    );

    return () => {
      cleanedUp = true;
      for (const dispose of disposers.splice(0)) {
        try {
          dispose();
        } catch {
          // ignore
        }
      }
    };
  };

  private syncStartupRuntimes = (): void => {
    if (this.disposed) return;

    const installed = loadInstalledExtensions();
    const installedIds = new Set<string>();
    const nextLifecycleSnapshots = new Map<string, InstalledExtensionLifecycleSnapshot>();
    const nextDevSessionTokens = new Map<string, string | null>();
    const lifecycleRestartReasons = new Map<string, string>();

    for (const record of installed) {
      const pluginId = record.manifest.identity.id;
      installedIds.add(pluginId);

      const nextSnapshot = createLifecycleSnapshot(record);
      const previousSnapshot = this.lifecycleSnapshots.get(pluginId);
      nextLifecycleSnapshots.set(pluginId, nextSnapshot);
      const nextDevSessionToken = getPluginDevSessionRevisionToken(pluginId);
      nextDevSessionTokens.set(pluginId, nextDevSessionToken);

      if (!previousSnapshot) {
        continue;
      }

      const reason = readLifecycleRestartReason(previousSnapshot, nextSnapshot);
      if (!reason) {
        // Continue checking dev-session invalidations below.
      } else {
        lifecycleRestartReasons.set(pluginId, reason);
        this.bumpLifecycleToken(pluginId);
      }

      if (
        this.devSessionTokens.has(pluginId) &&
        this.devSessionTokens.get(pluginId) !== nextDevSessionToken
      ) {
        lifecycleRestartReasons.set(
          pluginId,
          nextDevSessionToken ? 'dev-session-updated' : 'dev-session-detached'
        );
        this.bumpLifecycleToken(pluginId);
      }
    }

    for (const pluginId of Array.from(this.lifecycleSnapshots.keys())) {
      if (nextLifecycleSnapshots.has(pluginId)) continue;
      this.lifecycleTokens.delete(pluginId);
    }

    this.lifecycleSnapshots.clear();
    for (const [pluginId, snapshot] of nextLifecycleSnapshots.entries()) {
      this.lifecycleSnapshots.set(pluginId, snapshot);
    }
    this.devSessionTokens.clear();
    for (const [pluginId, token] of nextDevSessionTokens.entries()) {
      this.devSessionTokens.set(pluginId, token);
    }

    const startupEligibleIds = new Set(
      installed
        .filter((record) => shouldAutoStartOnStartup(record))
        .map((record) => record.manifest.identity.id)
    );

    const stopTasks: Promise<void>[] = [];
    for (const [pluginId, entry] of Array.from(this.runtimeHandles.entries())) {
      const lifecycleReason = lifecycleRestartReasons.get(pluginId);
      if (lifecycleReason) {
        stopTasks.push(this.stopRuntime(pluginId, lifecycleReason));
        continue;
      }

      if (!installedIds.has(pluginId)) {
        stopTasks.push(this.stopRuntime(pluginId, 'extension-removed'));
        continue;
      }

      if (entry.mode === 'startup' && !startupEligibleIds.has(pluginId)) {
        stopTasks.push(this.stopRuntime(pluginId, 'startup-activation-disabled'));
      }
    }

    if (lifecycleRestartReasons.size > 0) {
      this.notifyRestartListeners();
    }

    const ensureRuntimes = () => {
      if (this.disposed) return;
      for (const record of installed) {
        if (!shouldAutoStartOnStartup(record)) continue;
        void this.ensureStartupRuntime(record);
      }
    };

    if (stopTasks.length > 0) {
      void Promise.allSettled(stopTasks).then(() => {
        ensureRuntimes();
      });
      return;
    }

    ensureRuntimes();
  };

  private handleRestartSignal = (): void => {
    const restart = readHostExtensionRuntimeRestartRequest();
    if (!restart || restart.at <= this.lastRestartAt) return;
    this.lastRestartAt = restart.at;
    this.notifyRestartListeners();
    void this.stopRuntime(restart.pluginId, restart.reason ?? 'runtime-restart').finally(() => {
      this.syncStartupRuntimes();
    });
  };
}
