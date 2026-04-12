import { APP_VERSION, HOST_API_VERSION } from '../../../constants/versions';
import type { CommandsService } from '../../../services/commands';
import type { KeybindingsService } from '../../../services/keybindings';
import { isTauriRuntime } from '../../../utils/tauriRuntime';
import {
  buildPmpmRuntimeActivateSnapshot,
  buildPmpmRuntimeInitSnapshot,
} from '../pmpmRuntimeBridgeSnapshot';
import {
  getInstalledPmpmPlugin,
  getPmpmPluginEffectivePermissions,
  quarantinePmpmPlugin,
  recordPmpmPermissionDenied,
  recordPmpmPluginCrash,
} from '../pmpm';
import { createPluginMountApi, type HostAudioService, type HostNavigation } from '../pluginHostApi';
import {
  createPluginSidecarTelemetryContext,
  reportPluginSidecarBridgeFailed,
  reportPluginSidecarProcessUnresponsive,
  type PluginLifecycleSourceKind,
} from '../pluginLifecycleTelemetry';
import { readPmpmPluginConfig, subscribePmpmPluginConfig } from '../pluginConfig';
import { assertPmpmSidecarRuntimeLaunchAllowed } from '../pmpmRuntime';
import { createRuntimeBridgeHostSession, type RuntimeBridgePort } from './runtimeBridgeHostSession';
import { bindHostRuntimeEventChannel, RUNTIME_EVENT_NAMES } from './runtimeEventChannel';
import { createTauriPmpmBridgeSidecarPortController } from './tauriSidecarPortController';
import type { RuntimeArtifactIntegrityDeps } from './runtimeArtifactIntegrity';

const STARTUP_TIMEOUT_MS = 3_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 20_000;

export interface RunPmpmBridgeSidecarCommandOptions {
  pluginId: string;
  runtimeId: string;
  entryPath: string;
  commandId: string;
  args?: unknown;
  hostLabel?: string;
  audioService: HostAudioService;
  commands?: CommandsService | null;
  navigation: HostNavigation;
  keybindings?: KeybindingsService | null;
  timeoutMs?: number;
}

export interface PmpmBridgeSidecarPortController {
  port: RuntimeBridgePort;
  dispose: (reason?: string) => Promise<void> | void;
}

export interface CreatePmpmBridgeSidecarPortControllerOptions {
  pluginId: string;
  runtimeId: string;
  runtimeInstanceId: string;
  entryPath: string;
  commandId: string;
  args?: unknown;
  timeoutMs: number;
  telemetry?: {
    sourceKind: PluginLifecycleSourceKind;
    hostLabel?: string | null;
    surfaceKind?: string | null;
    surfaceId?: string | null;
    cause?: string | null;
  };
}

export interface PmpmBridgeSidecarCommandRuntimeDeps {
  createPortController?: (
    options: CreatePmpmBridgeSidecarPortControllerOptions
  ) => Promise<PmpmBridgeSidecarPortController> | PmpmBridgeSidecarPortController;
  readArtifactBytes?: RuntimeArtifactIntegrityDeps['readArtifactBytes'];
  now?: () => number;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
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

export async function runPmpmBridgeSidecarCommand(
  options: RunPmpmBridgeSidecarCommandOptions,
  deps: PmpmBridgeSidecarCommandRuntimeDeps = {}
): Promise<void> {
  const hostLabel = options.hostLabel ?? 'PluginCommandSidecar';
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS));
  const now = deps.now ?? (() => Date.now());
  const createPortController = deps.createPortController ?? createDefaultBridgeController;

  const runtimeInstanceId = `${options.pluginId}:command:${now()}:${Math.random().toString(16).slice(2)}`;
  const sidecarTelemetryContext = createPluginSidecarTelemetryContext({
    pluginId: options.pluginId,
    sourceKind: 'pmpm',
    hostLabel,
    runtimeId: options.runtimeId,
    runtimeInstanceId,
    surfaceKind: 'command',
    surfaceId: options.commandId,
    cause: 'command',
  });
  const permissions = getPmpmPluginEffectivePermissions(options.pluginId);
  const plugin = getInstalledPmpmPlugin(options.pluginId);
  const initialConfig = readPmpmPluginConfig(options.pluginId);

  await assertPmpmSidecarRuntimeLaunchAllowed(
    {
      pluginId: options.pluginId,
      runtimeId: options.runtimeId,
      entryPath: options.entryPath,
    },
    {
      readArtifactBytes: deps.readArtifactBytes,
    }
  ).catch((error) => {
    reportPluginSidecarBridgeFailed(sidecarTelemetryContext, error, {
      extraFields: {
        stage: 'verify',
        timeoutMs,
      },
    });
    throw error;
  });

  const api = createPluginMountApi({
    pluginId: options.pluginId,
    hostLabel,
    sourceKind: 'pmpm',
    permissions,
    audioService: options.audioService,
    commands: options.commands,
    navigation: options.navigation,
    keybindings: options.keybindings,
  });

  const runtimeInit = buildPmpmRuntimeInitSnapshot({
    pluginId: options.pluginId,
    runtimeId: options.runtimeId,
    runtimeInstanceId,
    permissions,
    manifestPermissions: plugin?.manifest.permissions,
    deniedPermissions: plugin?.deniedPermissions,
    startupTimeoutMs: STARTUP_TIMEOUT_MS,
  });

  const activateBase = buildPmpmRuntimeActivateSnapshot({
    pluginId: options.pluginId,
    runtimeId: options.runtimeId,
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
      entryPath: options.entryPath,
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
            pluginId: options.pluginId,
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
      pluginId: options.pluginId,
      runtimeId: options.runtimeId,
      runtimeInstanceId,
      entryPath: options.entryPath,
      commandId: options.commandId,
      args: options.args,
      timeoutMs,
      telemetry: {
        sourceKind: 'pmpm',
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
    pluginId: options.pluginId,
    runtimeId: options.runtimeId,
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
      sourceKind: 'pmpm',
      launcherId: 'pxp.sidecar.native-process',
      hostLabel,
    },
    onRuntimeEvent: (message) => {
      const payload = asObject(message.payload) ?? {};

      if (message.eventName === RUNTIME_EVENT_NAMES.permissionDenied) {
        const capability = typeof payload.capability === 'string' ? payload.capability : '';
        const action = typeof payload.action === 'string' ? payload.action : '';
        if (capability && action) {
          recordPmpmPermissionDenied({
            pluginId: options.pluginId,
            hostLabel,
            capability,
            action,
          });
        }
        return;
      }

      if (message.eventName === RUNTIME_EVENT_NAMES.commandResult) {
        if (payload.ok === true) {
          settleCommand();
          return;
        }
        if (payload.ok === false) {
          failCommand(
            new Error(typeof payload.message === 'string' ? payload.message : 'Plugin command failed')
          );
        }
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
      ? (listener) => subscribePmpmPluginConfig(options.pluginId, listener)
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
  let crashRecorded = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const markCrash = (error: unknown) => {
    if (crashRecorded) return;
    crashRecorded = true;
    recordPmpmPluginCrash(options.pluginId, error, 'command');
  };

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        disposeReason = 'runtime-unresponsive';
        reportPluginSidecarProcessUnresponsive(sidecarTelemetryContext, {
          extraFields: {
            timeoutMs,
          },
        });
        quarantinePmpmPlugin(options.pluginId, {
          surface: 'command',
          message: `Plugin command timeout (${timeoutMs}ms)`,
          timeoutMs,
        });
        reject(new Error(`Plugin command timeout (${timeoutMs}ms)`));
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
      markCrash(error);
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
