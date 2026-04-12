import type { RuntimeHello } from '@pixel-matrix/plugin-platform-contracts';
import { APP_VERSION, HOST_API_VERSION } from '../../../constants/versions';
import type { PluginSurfaceSourceKind } from '../../../contracts/pluginSurfaceSource';
import type { CommandsService } from '../../../services/commands';
import type { KeybindingsService } from '../../../services/keybindings';
import { isTauriRuntime } from '../../../utils/tauriRuntime';
import {
  buildPmpmRuntimeActivateSnapshot,
  buildPmpmRuntimeHelloSnapshot,
  buildPmpmRuntimeInitSnapshot,
} from '../pmpmRuntimeBridgeSnapshot';
import {
  disableInstalledExtensionByPolicy,
  listInstalledExtensionCompatPermissions,
  quarantineInstalledExtension,
  recordInstalledExtensionCrash,
  type InstalledHostExtensionRecord,
} from '../extensions';
import { recordInstalledExtensionPermissionDenied } from '../extensionsGovernance';
import {
  createPluginSidecarTelemetryContext,
  reportPluginSidecarBridgeFailed,
  reportPluginSidecarProcessUnresponsive,
} from '../pluginLifecycleTelemetry';
import { createPluginMountApi, type HostAudioService, type HostNavigation } from '../pluginHostApi';
import { readPmpmPluginConfig, subscribePmpmPluginConfig } from '../pluginConfig';
import type {
  CreatePmpmBridgeSidecarPortControllerOptions,
  PmpmBridgeSidecarPortController,
} from './sidecarCommandRuntime';
import { createRuntimeBridgeHostSession } from './runtimeBridgeHostSession';
import { bindHostRuntimeEventChannel, RUNTIME_EVENT_NAMES } from './runtimeEventChannel';
import { createTauriPmpmBridgeSidecarPortController } from './tauriSidecarPortController';
import { createInstalledExtensionEntryUrl } from './installedExtensionRuntimeAssets';
import {
  assertRuntimeArtifactIntegrity,
  type RuntimeArtifactIntegrityDeps,
} from './runtimeArtifactIntegrity';
import {
  buildWorkerBootstrapSource,
  buildWorkerPort,
  type WorkerEventListener,
  type WorkerLike,
} from './workerCommandRuntime';
import { isResolvedPluginRuntime, type PluginRuntimeResolution } from './types';

const STARTUP_TIMEOUT_MS = 3_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 20_000;

export interface RunResolvedInstalledExtensionCommandOptions {
  record: InstalledHostExtensionRecord;
  resolution: PluginRuntimeResolution | null | undefined;
  commandId: string;
  args?: unknown;
  hostLabel?: string;
  audioService: HostAudioService;
  commands?: CommandsService | null;
  navigation: HostNavigation;
  keybindings?: KeybindingsService | null;
  timeoutMs?: number;
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

export interface InstalledExtensionCommandRuntimeDeps {
  createPortController?: (
    options: CreatePmpmBridgeSidecarPortControllerOptions
  ) => Promise<PmpmBridgeSidecarPortController> | PmpmBridgeSidecarPortController;
  readArtifactBytes?: RuntimeArtifactIntegrityDeps['readArtifactBytes'];
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

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeFsPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function readUnsupportedLauncherError(
  resolution: PluginRuntimeResolution | null | undefined
): string {
  if (!resolution) return 'Installed extension runtime record not found';
  if (resolution.status !== 'resolved') {
    return resolution.issues[0] ?? 'No compatible runtime launcher is available';
  }
  return `Resolved runtime launcher is not wired for manifest-v2 commands: ${resolution.launcher.id}`;
}

function createMissingBridgeController(): never {
  throw new Error('Native sidecar runtime bridge is not configured');
}

function createDefaultBridgeController(
  options: CreatePmpmBridgeSidecarPortControllerOptions
): Promise<PmpmBridgeSidecarPortController> | PmpmBridgeSidecarPortController {
  if (isTauriRuntime()) {
    return createTauriPmpmBridgeSidecarPortController(options);
  }
  return createMissingBridgeController();
}

async function assertInstalledExtensionSidecarLaunchAllowed(
  record: InstalledHostExtensionRecord,
  runtimeId: string,
  entryPath: string,
  deps: RuntimeArtifactIntegrityDeps = {}
): Promise<void> {
  const pluginId = record.manifest.identity.id;
  const artifact = record.resolvedArtifacts?.find((item) => item.runtimeId === runtimeId) ?? null;
  if (!artifact) return;

  if (normalizeFsPath(artifact.path) !== normalizeFsPath(entryPath)) {
    const message = `Installed extension runtime artifact mismatch: expected ${artifact.path}, got ${entryPath}`;
    disableInstalledExtensionByPolicy(pluginId, message);
    throw new Error(message);
  }

  try {
    await assertRuntimeArtifactIntegrity(
      {
        artifactPath: entryPath,
        expectedSha256: artifact.sha256,
      },
      deps
    );
  } catch (error) {
    const message = readErrorMessage(error);
    disableInstalledExtensionByPolicy(pluginId, message);
    throw new Error(message);
  }
}

async function runInstalledExtensionWorkerCommand(
  options: RunResolvedInstalledExtensionCommandOptions,
  deps: InstalledExtensionCommandRuntimeDeps
): Promise<void> {
  if (!isResolvedPluginRuntime(options.resolution)) {
    throw new Error(readUnsupportedLauncherError(options.resolution));
  }

  const record = options.record;
  const pluginId = record.manifest.identity.id;
  const runtimeId = options.resolution.runtime.runtimeId;
  const entryPath = options.resolution.artifact.path;
  const hostLabel = options.hostLabel ?? 'ExtensionCommandWorker';
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS));
  const now = deps.now ?? (() => Date.now());
  const createObjectUrl = deps.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeObjectUrl = deps.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));
  const createEntryUrl = deps.createEntryUrl ?? createInstalledExtensionEntryUrl;

  const runtimeInstanceId = `${pluginId}:command:${now()}:${Math.random().toString(16).slice(2)}`;
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

  const activateBase = buildPmpmRuntimeActivateSnapshot({
    pluginId,
    runtimeId,
    runtimeInstanceId,
    kind: 'command',
    surfaceId: options.commandId,
    commandArgs: options.args,
  });

  const runtimeActivate = {
    ...activateBase,
    payload: {
      ...(asObject(activateBase.payload) ?? {}),
      commandId: options.commandId,
      args: options.args,
      entryUrl: await Promise.resolve(createEntryUrl(entryPath)),
      permissions: Array.from(permissions),
      initialConfig,
      initialAudioState: permissions.has('api:audio-state') ? options.audioService.getState() : null,
      initialAudioSpectrum:
        permissions.has('api:audio-visual') && typeof api.visualizer.getSpectrum === 'function'
          ? api.visualizer.getSpectrum()
          : null,
      initialAudioSpectrumFramePre:
        permissions.has('api:audio-visual') && typeof api.visualizer.getSpectrumFrame === 'function'
          ? api.visualizer.getSpectrumFrame({ tap: 'pre-dsp' })
          : null,
      initialAudioSpectrumFramePost:
        permissions.has('api:audio-visual') && typeof api.visualizer.getSpectrumFrame === 'function'
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
    { type: 'module', name: `extv2-bridge:${pluginId}:${options.commandId}` },
    runtimeHello
  );

  const { port, dispose: disposePort } = buildWorkerPort(worker);
  let settleCommand!: () => void;
  let failCommand!: (error: Error) => void;
  const commandResult = new Promise<void>((resolve, reject) => {
    settleCommand = resolve;
    failCommand = reject;
  });

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
    requestTimeoutMs: timeoutMs,
    telemetry: {
      sourceKind: 'extv2',
      launcherId: 'pxp.extension-host.worker',
      hostLabel,
    },
    onRuntimeEvent: (message) => {
      const payload = asObject(message.payload) ?? {};
      if (message.eventName === RUNTIME_EVENT_NAMES.permissionDenied) {
        const capability = typeof payload.capability === 'string' ? payload.capability : '';
        const action = typeof payload.action === 'string' ? payload.action : '';
        if (capability && action) {
          recordInstalledExtensionPermissionDenied({
            pluginId,
            hostLabel,
            capability,
            action,
          });
        }
        return;
      }
      if (message.eventName !== RUNTIME_EVENT_NAMES.commandResult) {
        return;
      }
      if (payload.ok === true) {
        settleCommand();
        return;
      }
      if (payload.ok === false) {
        failCommand(
          new Error(
            typeof payload.message === 'string'
              ? payload.message
              : 'Installed extension command failed'
          )
        );
      }
    },
    onRuntimeCrash: (error) => {
      failCommand(error);
    },
  });

  const onWorkerError: WorkerEventListener = (event) => {
    const value =
      event.error instanceof Error
        ? event.error.message
        : event.error ?? event.message ?? 'Installed extension worker error';
    failCommand(new Error(String(value)));
  };
  worker.addEventListener('error', onWorkerError);

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
      permissions.has('api:audio-visual') && typeof api.visualizer.getSpectrumFrame === 'function'
        ? (eventOptions) => api.visualizer.getSpectrumFrame(eventOptions)
        : undefined,
  });

  let disposeReason = 'runtime-command-finished';
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        disposeReason = 'runtime-unresponsive';
        quarantineInstalledExtension(pluginId, {
          surface: 'command',
          message: `Installed extension command timeout (${timeoutMs}ms)`,
          timeoutMs,
        });
        reject(new Error(`Installed extension command timeout (${timeoutMs}ms)`));
      }, timeoutMs);
    });

    await Promise.race([
      (async () => {
        await session.start();
        await commandResult;
      })(),
      timeoutPromise,
    ]);
  } catch (error) {
    if (disposeReason !== 'runtime-unresponsive') {
      disposeReason = 'runtime-crash';
      recordInstalledExtensionCrash(pluginId, error);
    }
    throw error;
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
    disposeRuntimeEvents();
    worker.removeEventListener('error', onWorkerError);
    await session.dispose(disposeReason);
    disposePort();
    worker.terminate();
    revokeObjectUrl(workerUrl);
  }
}

async function runInstalledExtensionSidecarCommand(
  options: RunResolvedInstalledExtensionCommandOptions,
  deps: InstalledExtensionCommandRuntimeDeps
): Promise<void> {
  if (!isResolvedPluginRuntime(options.resolution)) {
    throw new Error(readUnsupportedLauncherError(options.resolution));
  }

  const record = options.record;
  const pluginId = record.manifest.identity.id;
  const runtimeId = options.resolution.runtime.runtimeId;
  const entryPath = options.resolution.artifact.path;
  const hostLabel = options.hostLabel ?? 'ExtensionCommandSidecar';
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS));
  const now = deps.now ?? (() => Date.now());
  const createPortController = deps.createPortController ?? createDefaultBridgeController;

  const runtimeInstanceId = `${pluginId}:command:${now()}:${Math.random().toString(16).slice(2)}`;
  const sidecarTelemetryContext = createPluginSidecarTelemetryContext({
    pluginId,
    sourceKind: 'extv2',
    hostLabel,
    runtimeId,
    runtimeInstanceId,
    surfaceKind: 'command',
    surfaceId: options.commandId,
    cause: 'command',
  });
  const permissions = new Set(listInstalledExtensionCompatPermissions(record));
  const initialConfig = readPmpmPluginConfig(pluginId, 'extv2');

  await assertInstalledExtensionSidecarLaunchAllowed(record, runtimeId, entryPath, {
    readArtifactBytes: deps.readArtifactBytes,
  }).catch((error) => {
    reportPluginSidecarBridgeFailed(sidecarTelemetryContext, error, {
      extraFields: {
        stage: 'verify',
        timeoutMs,
      },
    });
    throw error;
  });

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

  const runtimeInit = buildPmpmRuntimeInitSnapshot({
    pluginId,
    runtimeId,
    runtimeInstanceId,
    permissions,
    manifestPermissions: Array.from(permissions),
    startupTimeoutMs: STARTUP_TIMEOUT_MS,
  });

  const activateBase = buildPmpmRuntimeActivateSnapshot({
    pluginId,
    runtimeId,
    runtimeInstanceId,
    kind: 'command',
    surfaceId: options.commandId,
    commandArgs: options.args,
  });

  const runtimeActivate = {
    ...activateBase,
    payload: {
      ...(asObject(activateBase.payload) ?? {}),
      commandId: options.commandId,
      args: options.args,
      entryPath,
      permissions: Array.from(permissions),
      initialConfig,
      initialAudioState: permissions.has('api:audio-state') ? options.audioService.getState() : null,
      initialAudioSpectrum:
        permissions.has('api:audio-visual') && typeof api.visualizer.getSpectrum === 'function'
          ? api.visualizer.getSpectrum()
          : null,
      initialAudioSpectrumFramePre:
        permissions.has('api:audio-visual') && typeof api.visualizer.getSpectrumFrame === 'function'
          ? api.visualizer.getSpectrumFrame({ tap: 'pre-dsp' })
          : null,
      initialAudioSpectrumFramePost:
        permissions.has('api:audio-visual') && typeof api.visualizer.getSpectrumFrame === 'function'
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

  const controller = await Promise.resolve(
    createPortController({
      pluginId,
      runtimeId,
      runtimeInstanceId,
      entryPath,
      commandId: options.commandId,
      args: options.args,
      timeoutMs,
      telemetry: {
        sourceKind: 'extv2',
        hostLabel,
        surfaceKind: 'command',
        surfaceId: options.commandId,
        cause: 'command',
      },
    })
  ).catch((error) => {
    reportPluginSidecarBridgeFailed(sidecarTelemetryContext, error, {
      extraFields: {
        stage: 'open',
        timeoutMs,
      },
    });
    throw error;
  });

  let settleCommand!: () => void;
  let failCommand!: (error: Error) => void;
  const commandResult = new Promise<void>((resolve, reject) => {
    settleCommand = resolve;
    failCommand = reject;
  });

  const session = createRuntimeBridgeHostSession({
    pluginId,
    runtimeId,
    runtimeInstanceId,
    runtimeKind: 'sidecar',
    carrier: 'native-process',
    api,
    permissions,
    port: controller.port,
    runtimeInit,
    runtimeActivate,
    startupTimeoutMs: STARTUP_TIMEOUT_MS,
    requestTimeoutMs: timeoutMs,
    telemetry: {
      sourceKind: 'extv2',
      launcherId: 'pxp.sidecar.native-process',
      hostLabel,
    },
    onRuntimeEvent: (message) => {
      const payload = asObject(message.payload) ?? {};
      if (message.eventName === RUNTIME_EVENT_NAMES.permissionDenied) {
        const capability = typeof payload.capability === 'string' ? payload.capability : '';
        const action = typeof payload.action === 'string' ? payload.action : '';
        if (capability && action) {
          recordInstalledExtensionPermissionDenied({
            pluginId,
            hostLabel,
            capability,
            action,
          });
        }
        return;
      }
      if (message.eventName !== RUNTIME_EVENT_NAMES.commandResult) {
        return;
      }
      if (payload.ok === true) {
        settleCommand();
        return;
      }
      if (payload.ok === false) {
        failCommand(
          new Error(
            typeof payload.message === 'string'
              ? payload.message
              : 'Installed extension command failed'
          )
        );
      }
    },
    onRuntimeCrash: (error) => {
      failCommand(error);
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
      permissions.has('api:audio-visual') && typeof api.visualizer.getSpectrumFrame === 'function'
        ? (eventOptions) => api.visualizer.getSpectrumFrame(eventOptions)
        : undefined,
  });

  let disposeReason = 'runtime-command-finished';
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        disposeReason = 'runtime-unresponsive';
        reportPluginSidecarProcessUnresponsive(sidecarTelemetryContext, {
          extraFields: {
            timeoutMs,
          },
        });
        quarantineInstalledExtension(pluginId, {
          surface: 'command',
          message: `Installed extension command timeout (${timeoutMs}ms)`,
          timeoutMs,
        });
        reject(new Error(`Installed extension command timeout (${timeoutMs}ms)`));
      }, timeoutMs);
    });

    await Promise.race([
      (async () => {
        await session.start();
        await commandResult;
      })(),
      timeoutPromise,
    ]);
  } catch (error) {
    if (disposeReason !== 'runtime-unresponsive') {
      disposeReason = 'runtime-crash';
      recordInstalledExtensionCrash(pluginId, error);
    }
    throw error;
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
    disposeRuntimeEvents();
    await session.dispose(disposeReason);
    await Promise.resolve(controller.dispose(disposeReason));
  }
}

export async function runResolvedInstalledExtensionCommand(
  options: RunResolvedInstalledExtensionCommandOptions,
  deps: InstalledExtensionCommandRuntimeDeps = {}
): Promise<void> {
  if (!isResolvedPluginRuntime(options.resolution)) {
    throw new Error(readUnsupportedLauncherError(options.resolution));
  }

  switch (options.resolution.launcher.id) {
    case 'pxp.extension-host.worker':
      await runInstalledExtensionWorkerCommand(options, deps);
      return;
    case 'pxp.sidecar.native-process':
      await runInstalledExtensionSidecarCommand(options, deps);
      return;
    default:
      throw new Error(readUnsupportedLauncherError(options.resolution));
  }
}
