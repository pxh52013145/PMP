import type { RuntimeActivate, RuntimeHello } from '@pixel-matrix/plugin-platform-contracts';
import { APP_VERSION, HOST_API_VERSION } from '../../../constants/versions';
import type { PluginSurfaceSourceKind } from '../../../contracts/pluginSurfaceSource';
import type { CommandsService } from '../../../services/commands';
import type { KeybindingsService } from '../../../services/keybindings';
import { isTauriRuntime } from '../../../utils/tauriRuntime';
import {
  buildPmpmRuntimeHelloSnapshot,
  buildPmpmRuntimeInitSnapshot,
} from '../pmpmRuntimeBridgeSnapshot';
import {
  listInstalledExtensionCompatPermissions,
  quarantineInstalledExtension,
  recordInstalledExtensionCrash,
  type InstalledHostExtensionRecord,
} from '../extensions';
import { recordInstalledExtensionPermissionDenied } from '../extensionsGovernance';
import { createPluginMountApi, type HostAudioService, type HostNavigation } from '../pluginHostApi';
import { readPmpmPluginConfig, subscribePmpmPluginConfig } from '../pluginConfig';
import { createRuntimeBridgeHostSession } from './runtimeBridgeHostSession';
import { bindHostRuntimeEventChannel, RUNTIME_EVENT_NAMES } from './runtimeEventChannel';
import { createInstalledExtensionEntryUrl } from './installedExtensionRuntimeAssets';
import {
  buildWorkerBootstrapSource,
  buildWorkerPort,
  type WorkerEventListener,
  type WorkerLike,
} from './workerCommandRuntime';
import { isResolvedPluginRuntime, type PluginRuntimeResolution } from './types';

const STARTUP_TIMEOUT_MS = 3_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

export type InstalledExtensionBackgroundActivation =
  | {
      cause: 'startup';
      activationEvent: 'onStartup';
      surface: 'startup';
      payload?: Record<string, unknown>;
    }
  | {
      cause: 'capability';
      activationEvent: `onCapability:${string}`;
      surface: 'capability';
      payload?: Record<string, unknown>;
    }
  | {
      cause: 'host-event';
      activationEvent: `onHost:${string}`;
      surface: 'host';
      payload?: Record<string, unknown>;
    }
  | {
      cause: 'file';
      activationEvent: `onFile:${string}`;
      surface: 'file';
      payload?: Record<string, unknown>;
    };

export interface StartInstalledExtensionStartupRuntimeOptions {
  record: InstalledHostExtensionRecord;
  resolution: PluginRuntimeResolution | null | undefined;
  hostLabel?: string;
  audioService: HostAudioService;
  commands?: CommandsService | null;
  navigation: HostNavigation;
  keybindings?: KeybindingsService | null;
  requestTimeoutMs?: number;
  onHostCapabilityActivity?: (activity: {
    capabilityId: string;
    method: string;
    payload?: unknown;
    requestKind: 'invoke' | 'open-session' | 'open-stream' | 'close-session';
    sourcePluginId: string;
    sourceKind: PluginSurfaceSourceKind;
    hostLabel: string;
  }) => void;
}

export interface StartInstalledExtensionBackgroundRuntimeOptions
  extends StartInstalledExtensionStartupRuntimeOptions {
  activation: InstalledExtensionBackgroundActivation;
}

export interface InstalledExtensionStartupRuntimeHandle {
  runtimeInstanceId: string;
  dispose: (reason?: string) => Promise<void>;
}

export type InstalledExtensionBackgroundRuntimeHandle = InstalledExtensionStartupRuntimeHandle;

export interface InstalledExtensionStartupRuntimeDeps {
  createWorker?: (
    scriptUrl: string,
    options: { type: 'module'; name?: string },
    runtimeHello: RuntimeHello
  ) => WorkerLike;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  createEntryUrl?: (entryPath: string) => Promise<string> | string;
  now?: () => number;
}

export type InstalledExtensionBackgroundRuntimeDeps = InstalledExtensionStartupRuntimeDeps;

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readUnsupportedLauncherError(
  resolution: PluginRuntimeResolution | null | undefined
): string {
  if (!resolution) return 'Installed extension runtime record not found';
  if (resolution.status !== 'resolved') {
    return resolution.issues[0] ?? 'No compatible runtime launcher is available';
  }
  return `Resolved runtime launcher is not wired for manifest-v2 background activation: ${resolution.launcher.id}`;
}

function readWorkerErrorMessage(error: unknown): string {
  return error instanceof Error ? error.stack || error.message : String(error);
}

export async function startInstalledExtensionBackgroundRuntime(
  options: StartInstalledExtensionBackgroundRuntimeOptions,
  deps: InstalledExtensionBackgroundRuntimeDeps = {}
): Promise<InstalledExtensionBackgroundRuntimeHandle> {
  if (!isResolvedPluginRuntime(options.resolution)) {
    throw new Error(readUnsupportedLauncherError(options.resolution));
  }

  if (options.resolution.launcher.id !== 'pxp.extension-host.worker') {
    throw new Error(readUnsupportedLauncherError(options.resolution));
  }

  const record = options.record;
  const pluginId = record.manifest.identity.id;
  const runtimeId = options.resolution.runtime.runtimeId;
  const entryPath = options.resolution.artifact.path;
  const hostLabel = options.hostLabel ?? 'ExtensionStartupWorker';
  const requestTimeoutMs = Math.max(
    1,
    Math.floor(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)
  );
  const now = deps.now ?? (() => Date.now());
  const createObjectUrl = deps.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeObjectUrl = deps.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));
  const createEntryUrl = deps.createEntryUrl ?? createInstalledExtensionEntryUrl;
  const activation = options.activation;

  const runtimeInstanceId = `${pluginId}:${activation.cause}:${now()}:${Math.random()
    .toString(16)
    .slice(2)}`;
  const permissions = new Set(listInstalledExtensionCompatPermissions(record));
  const initialConfig = readPmpmPluginConfig(pluginId, 'extv2');

  const api = createPluginMountApi({
    pluginId,
    hostLabel,
    sourceKind: 'extv2',
    permissions,
    audioService: options.audioService,
    commands: options.commands,
    navigation: options.navigation,
    keybindings: options.keybindings,
    onHostCapabilityActivity: options.onHostCapabilityActivity,
  });

  const runtimeHello = buildPmpmRuntimeHelloSnapshot({
    pluginId,
    runtimeId,
    runtimeInstanceId,
    runtimeKind: 'extension-host',
    carrier: 'dedicated-worker',
    supportsViewMount: false,
  });

  const runtimeInit = buildPmpmRuntimeInitSnapshot({
    pluginId,
    runtimeId,
    runtimeInstanceId,
    permissions,
    manifestPermissions: Array.from(permissions),
    startupTimeoutMs: STARTUP_TIMEOUT_MS,
  });

  const runtimeActivate: RuntimeActivate = {
    bridgeVersion: runtimeInit.bridgeVersion,
    op: 'runtime.activate',
    pluginId,
    runtimeId,
    runtimeInstanceId,
    cause: activation.cause,
    payload: {
      activationEvent: activation.activationEvent,
      ...(activation.payload ?? {}),
      entryUrl: await Promise.resolve(createEntryUrl(entryPath)),
      permissions: Array.from(permissions),
      initialConfig,
      initialAudioState: permissions.has('api:audio-state') ? options.audioService.getState() : null,
      initialAudioSpectrum:
        permissions.has('api:audio-visual') && typeof api.visualizer.getSpectrum === 'function'
          ? api.visualizer.getSpectrum()
          : null,
      initialAudioSpectrumFramePre:
        permissions.has('api:audio-visual') &&
        typeof api.visualizer.getSpectrumFrame === 'function'
          ? api.visualizer.getSpectrumFrame({ tap: 'pre-dsp' })
          : null,
      initialAudioSpectrumFramePost:
        permissions.has('api:audio-visual') &&
        typeof api.visualizer.getSpectrumFrame === 'function'
          ? api.visualizer.getSpectrumFrame({ tap: 'post-dsp' })
          : null,
      initialNavigation:
        permissions.has('api:navigation') && typeof options.navigation.getSnapshot === 'function'
          ? options.navigation.getSnapshot()
          : null,
      hostInfo: permissions.has('api:host')
        ? {
            pluginId,
            hostLabel,
            hostApiVersion: HOST_API_VERSION,
            appVersion: APP_VERSION,
            runtime: isTauriRuntime() ? 'tauri' : 'web',
          }
        : null,
    },
  };

  const workerSource = buildWorkerBootstrapSource(runtimeHello);
  const workerUrl = createObjectUrl(new Blob([workerSource], { type: 'text/javascript' }));
  const createWorker =
    deps.createWorker ??
    ((scriptUrl: string, workerOptions: { type: 'module'; name?: string }) =>
      new Worker(scriptUrl, workerOptions) as unknown as WorkerLike);
  const worker = createWorker(
    workerUrl,
    { type: 'module', name: `extv2-background:${pluginId}:${activation.cause}` },
    runtimeHello
  );

  const { port, dispose: disposePort } = buildWorkerPort(worker);
  let disposed = false;
  let disposePromise: Promise<void> | null = null;

  const session = createRuntimeBridgeHostSession({
    pluginId,
    runtimeId,
    runtimeInstanceId,
    runtimeKind: 'extension-host',
    carrier: 'dedicated-worker',
    api,
    permissions,
    port,
    runtimeInit,
    runtimeActivate,
    startupTimeoutMs: STARTUP_TIMEOUT_MS,
    requestTimeoutMs,
    telemetry: {
      sourceKind: 'extv2',
      launcherId: 'pxp.extension-host.worker',
      hostLabel,
    },
    onRuntimeEvent: (message) => {
      if (message.eventName !== RUNTIME_EVENT_NAMES.permissionDenied) {
        return;
      }
      const payload = asObject(message.payload) ?? {};
      const capability = typeof payload.capability === 'string' ? payload.capability : '';
      const action = typeof payload.action === 'string' ? payload.action : '';
      if (!capability || !action) return;
      recordInstalledExtensionPermissionDenied({
        pluginId,
        hostLabel,
        capability,
        action,
      });
    },
  });

  const disposeRuntimeEvents = bindHostRuntimeEventChannel({
    permissions,
    audioService: options.audioService,
    navigation: options.navigation,
    emitRuntimeEvent: (eventName, payload) => session.emitRuntimeEvent(eventName, payload),
    subscribeConfig: permissions.has('storage:local')
      ? (listener) => subscribePmpmPluginConfig(pluginId, listener, 'extv2')
      : undefined,
    getSpectrum:
      permissions.has('api:audio-visual') && typeof api.visualizer.getSpectrum === 'function'
        ? () => api.visualizer.getSpectrum()
        : undefined,
    getSpectrumFrame:
      permissions.has('api:audio-visual') &&
      typeof api.visualizer.getSpectrumFrame === 'function'
        ? (eventOptions) => api.visualizer.getSpectrumFrame(eventOptions)
        : undefined,
  });

  const cleanup = async (reason = 'runtime-dispose'): Promise<void> => {
    if (disposePromise) {
      return await disposePromise;
    }

    disposed = true;
    disposePromise = (async () => {
      disposeRuntimeEvents();
      worker.removeEventListener('error', onWorkerError);
      if (reason !== 'runtime-crash') {
        try {
          await session.revokeCapabilities(undefined, reason, {
            timeoutMs: Math.min(1_500, requestTimeoutMs),
          });
        } catch {
          // Governance telemetry is emitted by the shared runtime bridge session.
        }
      }
      await session.dispose(reason);
      disposePort();
      worker.terminate();
      revokeObjectUrl(workerUrl);
    })();

    return await disposePromise;
  };

  const onWorkerError: WorkerEventListener = (event) => {
    if (disposed) return;
    const message = readWorkerErrorMessage(event.error ?? event.message ?? 'Installed extension worker error');
    recordInstalledExtensionCrash(pluginId, new Error(message), activation.surface);
    void cleanup('runtime-crash');
  };

  worker.addEventListener('error', onWorkerError);

  try {
    await session.start();
    return {
      runtimeInstanceId,
      dispose: cleanup,
    };
  } catch (error) {
    const message = readWorkerErrorMessage(error);
    if (message.toLowerCase().includes('timeout') || message.toLowerCase().includes('unresponsive')) {
      quarantineInstalledExtension(pluginId, {
        surface: activation.surface,
        message,
      });
    } else {
      recordInstalledExtensionCrash(pluginId, error, activation.surface);
    }
    await cleanup('runtime-crash');
    throw error;
  }
}

export async function startInstalledExtensionStartupRuntime(
  options: StartInstalledExtensionStartupRuntimeOptions,
  deps: InstalledExtensionStartupRuntimeDeps = {}
): Promise<InstalledExtensionStartupRuntimeHandle> {
  return await startInstalledExtensionBackgroundRuntime(
    {
      ...options,
      activation: {
        cause: 'startup',
        activationEvent: 'onStartup',
        surface: 'startup',
      },
    },
    deps
  );
}
