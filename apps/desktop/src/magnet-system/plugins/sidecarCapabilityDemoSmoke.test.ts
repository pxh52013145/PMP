import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TELEMETRY_POLICY, type TelemetryRecord } from '../../contracts/telemetry';
import {
  setGlobalTelemetryService,
  type TelemetryService,
  type TelemetrySnapshot,
} from '../../services/telemetry';
import {
  createPluginSidecarTelemetryContext,
  reportPluginSidecarBridgeOpened,
  reportPluginSidecarProcessForcedTeardown,
} from './pluginLifecycleTelemetry';
import type { InstalledHostExtensionRecord } from './extensions';
import type { HostAudioService, HostNavigation } from './pluginHostApi';
import type {
  CreateRuntimeSidecarPortControllerOptions,
  RuntimeSidecarPortController,
} from './runtime/runtimeSidecarPort';
import type { RuntimeBridgeTransportMessage } from './runtime/runtimeBridgeHostSession';
import type { ResolvedPluginRuntime } from './runtime/types';

type TelemetryCall = {
  moduleId: string;
  component: string | null | undefined;
  level: string;
  event: string;
  message?: string | null;
  traceId?: string | null;
  spanId?: string | null;
  fields?: Record<string, unknown>;
};

type RealSidecarHarness = {
  createPortController: (
    options: CreateRuntimeSidecarPortControllerOptions
  ) => Promise<RuntimeSidecarPortController>;
  disposeAll: () => Promise<void>;
  lastPid: () => number | null;
  disposeReasons: string[];
};

const harnessState = vi.hoisted(() => ({
  appDataRoot: `${process.cwd().replace(/\\/g, '/')}/.codex-tmp/vitest-sidecar-smoke-appdata`,
}));

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function createTelemetryServiceSpy(): {
  calls: TelemetryCall[];
  service: TelemetryService;
} {
  const calls: TelemetryCall[] = [];
  const snapshot: TelemetrySnapshot = {
    policy: { ...DEFAULT_TELEMETRY_POLICY },
    status: {
      enabled: true,
      currentSessionId: 'session-1',
      queuedRecords: 0,
      flushedRecords: 0,
      droppedRecords: 0,
      currentFileBytes: 0,
      currentFilePath: null,
      frontendMinLevel: 'trace',
      backendMinLevel: 'trace',
      persistMinLevel: 'trace',
      lastError: null,
    },
    tail: [] as TelemetryRecord[],
    bufferedRecords: 0,
    queueDroppedRecords: 0,
    tailDroppedRecords: 0,
    transportAvailable: true,
    bootstrapState: 'ready',
    lastFlushAtMs: null,
    lastBootstrapAtMs: null,
  };

  const service: TelemetryService = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    refreshRuntime: async () => snapshot,
    clearSession: async () => {},
    flushNow: async () => {},
    getLogger: (moduleId, component) => ({
      log: (level, event, options) => {
        calls.push({
          moduleId,
          component,
          level,
          event,
          message: options?.message ?? null,
          traceId: options?.traceId ?? null,
          spanId: options?.spanId ?? null,
          fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined,
        });
      },
      trace: (event, options) =>
        calls.push({
          moduleId,
          component,
          level: 'trace',
          event,
          message: options?.message ?? null,
          traceId: options?.traceId ?? null,
          spanId: options?.spanId ?? null,
          fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined,
        }),
      debug: (event, options) =>
        calls.push({
          moduleId,
          component,
          level: 'debug',
          event,
          message: options?.message ?? null,
          traceId: options?.traceId ?? null,
          spanId: options?.spanId ?? null,
          fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined,
        }),
      info: (event, options) =>
        calls.push({
          moduleId,
          component,
          level: 'info',
          event,
          message: options?.message ?? null,
          traceId: options?.traceId ?? null,
          spanId: options?.spanId ?? null,
          fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined,
        }),
      warn: (event, options) =>
        calls.push({
          moduleId,
          component,
          level: 'warn',
          event,
          message: options?.message ?? null,
          traceId: options?.traceId ?? null,
          spanId: options?.spanId ?? null,
          fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined,
        }),
      error: (event, options) =>
        calls.push({
          moduleId,
          component,
          level: 'error',
          event,
          message: options?.message ?? null,
          traceId: options?.traceId ?? null,
          spanId: options?.spanId ?? null,
          fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined,
        }),
      fatal: (event, options) =>
        calls.push({
          moduleId,
          component,
          level: 'fatal',
          event,
          message: options?.message ?? null,
          traceId: options?.traceId ?? null,
          spanId: options?.spanId ?? null,
          fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined,
        }),
      metric: (event, fields, options) =>
        calls.push({
          moduleId,
          component,
          level: options?.level ?? 'info',
          event,
          message: options?.message ?? null,
          traceId: options?.traceId ?? null,
          spanId: options?.spanId ?? null,
          fields: fields as Record<string, unknown>,
        }),
      startSpan: () => ({
        end: () => {},
      }),
    }),
    ingest: () => {},
    destroy: () => {},
  };

  return { calls, service };
}

function createStubAudioService(): HostAudioService {
  return {
    getState: () => ({ playbackState: 'paused' }),
    onStateChange: () => () => {},
    onTimeUpdate: () => () => {},
    onEnded: () => () => {},
    onLoadProgress: () => () => {},
    onError: () => () => {},
    play: async () => undefined,
    pause: async () => undefined,
    stop: () => undefined,
    seek: () => undefined,
    setVolume: () => undefined,
    toggleMute: () => undefined,
    playNext: async () => undefined,
    playPrevious: async () => undefined,
    playTrackAtIndex: async () => undefined,
    getFrequencyData: () => Uint8Array.from([1, 2, 3]),
    getSpectrumFrame: () => ({
      frameId: 1,
      tap: 'post-dsp',
      sampleRate: 48_000,
      bins: Uint8Array.from([1, 2, 3]),
      timestampMs: Date.now(),
    }),
  };
}

function createStubNavigation(): HostNavigation {
  return {
    navigateTo: () => undefined,
    goBack: () => undefined,
    getSnapshot: () => ({
      currentPage: { type: 'music-library' },
      history: [{ type: 'music-library' }],
      currentIndex: 0,
    }),
    subscribe: () => () => {},
  };
}

function isProcessAlive(pid: number | null): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function createRealSidecarHarness(): RealSidecarHarness {
  const controllers = new Set<{
    child: ChildProcessWithoutNullStreams;
    dispose: (reason?: string) => Promise<void>;
  }>();
  const disposeReasons: string[] = [];
  let mostRecentPid: number | null = null;

  const createPortController = async (
    options: CreateRuntimeSidecarPortControllerOptions
  ): Promise<RuntimeSidecarPortController> => {
    const listeners = new Set<(message: RuntimeBridgeTransportMessage) => void>();
    const buffered: RuntimeBridgeTransportMessage[] = [];
    const telemetryContext = createPluginSidecarTelemetryContext({
      pluginId: options.pluginId,
      sourceKind: options.telemetry?.sourceKind ?? 'extv2',
      hostLabel: options.telemetry?.hostLabel,
      runtimeId: options.runtimeId,
      runtimeInstanceId: options.runtimeInstanceId,
      surfaceKind: options.telemetry?.surfaceKind,
      surfaceId: options.telemetry?.surfaceId,
      cause: options.telemetry?.cause,
    });
    const child = spawn(process.execPath, [options.entryPath], {
      cwd: path.dirname(options.entryPath),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PXP_PLUGIN_ID: options.pluginId,
        PXP_RUNTIME_ID: options.runtimeId,
        PXP_RUNTIME_INSTANCE_ID: options.runtimeInstanceId,
        PXP_COMMAND_ID: options.commandId,
        PXP_COMMAND_ARGS_JSON: JSON.stringify(options.args ?? null),
      },
    });
    mostRecentPid = child.pid ?? null;

    let closed = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const exitPromise = once(child, 'exit').catch(() => undefined);

    const emitMessage = (message: RuntimeBridgeTransportMessage) => {
      if (closed) return;
      if (listeners.size === 0) {
        buffered.push(message);
        return;
      }
      for (const listener of Array.from(listeners)) {
        listener(message);
      }
    };

    const emitFatalRuntimeError = (message: string) => {
      emitMessage({
        bridgeVersion: '1.0',
        op: 'runtime.error',
        pluginId: options.pluginId,
        runtimeId: options.runtimeId,
        runtimeInstanceId: options.runtimeInstanceId,
        fatal: true,
        message,
      });
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      while (stdoutBuffer.includes('\n')) {
        const newlineIndex = stdoutBuffer.indexOf('\n');
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (!line) continue;
        try {
          emitMessage(JSON.parse(line) as RuntimeBridgeTransportMessage);
        } catch (error) {
          emitFatalRuntimeError(
            `invalid sidecar bridge message: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrBuffer += chunk;
    });

    child.on('error', (error) => {
      emitFatalRuntimeError(error.message);
    });

    child.on('exit', (code, signal) => {
      if (closed) return;
      emitFatalRuntimeError(
        stderrBuffer.trim() ||
          `sidecar process exited before host cleanup (code=${code ?? 'null'}, signal=${signal ?? 'null'})`
      );
    });

    reportPluginSidecarBridgeOpened(telemetryContext, {
      extraFields: {
        sidecarSessionId: `${options.runtimeInstanceId}:${child.pid ?? 'pending'}`,
        timeoutMs: options.timeoutMs,
        pid: child.pid ?? null,
      },
    });

    const dispose = async (reason = 'runtime-command-finished') => {
      if (closed) return;
      closed = true;
      disposeReasons.push(reason);

      if (reason === 'runtime-unresponsive' || reason.startsWith('runtime-crash')) {
        reportPluginSidecarProcessForcedTeardown(telemetryContext, {
          extraFields: {
            sidecarSessionId: `${options.runtimeInstanceId}:${child.pid ?? 'pending'}`,
            teardownReason: reason,
            timeoutMs: options.timeoutMs,
            pid: child.pid ?? null,
          },
        });
      }

      if (!child.stdin.destroyed) {
        child.stdin.end();
      }
      if (child.exitCode === null && !child.killed) {
        try {
          child.kill();
        } catch {
          // ignore
        }
      }

      await Promise.race([
        exitPromise,
        new Promise((resolve) => setTimeout(resolve, 750)),
      ]);

      if (child.exitCode === null && !child.killed) {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        await exitPromise;
      }

      controllers.delete(controllerState);
    };

    const controllerState = { child, dispose };
    controllers.add(controllerState);

    return {
      port: {
        postMessage: (message: RuntimeBridgeTransportMessage) => {
          if (closed || child.stdin.destroyed) {
            throw new Error('Real sidecar harness is already closed');
          }
          child.stdin.write(`${JSON.stringify(message)}\n`);
        },
        onMessage: (listener: (message: RuntimeBridgeTransportMessage) => void) => {
          listeners.add(listener);
          if (buffered.length > 0) {
            const pending = buffered.splice(0, buffered.length);
            for (const message of pending) {
              listener(message);
            }
          }
          return () => {
            listeners.delete(listener);
          };
        },
      },
      dispose,
    };
  };

  return {
    createPortController,
    disposeAll: async () => {
      for (const controller of Array.from(controllers)) {
        await controller.dispose('test-dispose');
      }
    },
    lastPid: () => mostRecentPid,
    disposeReasons,
  };
}

async function clearAppDataRoot(): Promise<void> {
  await fs.rm(harnessState.appDataRoot, { recursive: true, force: true });
  await fs.mkdir(harnessState.appDataRoot, { recursive: true });
}

async function loadResolvedSidecarRuntime(): Promise<{
  record: InstalledHostExtensionRecord;
  resolution: ResolvedPluginRuntime;
}> {
  const manifestPath = path.resolve(
    process.cwd(),
    '../../fixtures/community-plugins/sidecar-capability-demo/manifest.v2.json'
  );
  const extensionsModule = await import('./extensions');
  const runtimeModule = await import('./runtime');

  await extensionsModule.installInstalledExtensionFromFilePath(manifestPath);
  const record = extensionsModule.getInstalledExtensionRecord('sidecar-capability-demo');
  if (!record) {
    throw new Error('Failed to install sidecar-capability-demo fixture');
  }

  const resolution = runtimeModule.resolveInstalledExtensionRuntime(record, {
    hostId: 'pmp',
    surfaceKind: 'command',
  });
  if (resolution.status !== 'resolved') {
    throw new Error(`Sidecar demo did not resolve: ${resolution.issues.join('; ')}`);
  }

  return {
    record,
    resolution,
  };
}

vi.mock('../../utils/tauriRuntime', () => ({
  isTauriRuntime: () => true,
}));

vi.mock('../../utils/windowCommunication', () => ({
    STORAGE_KEYS: {
      EXTENSIONS_V2: 'test:extensions-v2',
      EXTENSIONS_V2_AUDIT_LOG_V1: 'test:extensions-v2-audit-log-v1',
      EXTENSIONS_V2_RUNTIME_RESTART_V1: 'test:extensions-v2-runtime-restart-v1',
    },
    TAURI_EVENTS: {
      EXTENSIONS_V2_UPDATED: 'test:extensions-v2-updated',
      EXTENSIONS_CONFIG_UPDATED: 'test:extensions-config-updated',
    },
  broadcastSignal: vi.fn(async () => undefined),
  broadcastDataUpdate: vi.fn(async (storageKey: string, data: unknown) => {
    localStorage.setItem(storageKey, JSON.stringify(data));
  }),
  setupTauriListenerWithPayload: vi.fn(async () => () => {}),
  setupStorageListener: vi.fn(() => () => {}),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(async () => undefined),
  listen: vi.fn(async () => () => {}),
}));

vi.mock('@tauri-apps/api/path', async () => {
  const nodePath = await import('node:path');
  return {
    appDataDir: async () => harnessState.appDataRoot,
    join: async (...parts: string[]) => normalizePath(nodePath.join(...parts)),
    dirname: async (filePath: string) => normalizePath(nodePath.dirname(filePath)),
    basename: async (filePath: string) => nodePath.basename(filePath),
  };
});

vi.mock('@tauri-apps/api/fs', async () => {
  const nodeFs = await import('node:fs/promises');
  const nodePath = await import('node:path');
  const resolveTarget = (target: string, dir?: number) => {
    const normalized = normalizePath(target);
    if (
      dir === 22 &&
      !normalized.startsWith('/') &&
      !/^[a-zA-Z]:\//.test(normalized)
    ) {
      return nodePath.resolve(harnessState.appDataRoot, normalized);
    }
    return nodePath.resolve(target);
  };

  return {
    BaseDirectory: {
      AppData: 22,
    },
    createDir: async (target: string, options?: { dir?: number; recursive?: boolean }) => {
      await nodeFs.mkdir(resolveTarget(target, options?.dir), {
        recursive: options?.recursive ?? false,
      });
    },
    writeBinaryFile: async (
      file: string | { path: string; contents: Uint8Array },
      options?: { dir?: number }
    ) => {
      const target = typeof file === 'string' ? file : file.path;
      const contents =
        typeof file === 'string' ? new Uint8Array() : new Uint8Array(file.contents);
      const absolutePath = resolveTarget(target, options?.dir);
      await nodeFs.mkdir(nodePath.dirname(absolutePath), { recursive: true });
      await nodeFs.writeFile(absolutePath, Buffer.from(contents));
    },
    readBinaryFile: async (target: string, options?: { dir?: number }) =>
      new Uint8Array(await nodeFs.readFile(resolveTarget(target, options?.dir))),
    readTextFile: async (target: string, options?: { dir?: number }) =>
      nodeFs.readFile(resolveTarget(target, options?.dir), 'utf8'),
    readDir: async () => [],
    exists: async (target: string, options?: { dir?: number }) => {
      try {
        await nodeFs.access(resolveTarget(target, options?.dir));
        return true;
      } catch {
        return false;
      }
    },
    removeDir: async (target: string, options?: { recursive?: boolean }) => {
      await nodeFs.rm(resolveTarget(target), {
        recursive: options?.recursive ?? false,
        force: true,
      });
    },
  };
});

vi.mock('../../services/telemetry/tauriInvokeTelemetry', async () => {
  const nodeFs = await import('node:fs/promises');
  const nodePath = await import('node:path');

  async function walk(rootDir: string): Promise<string[]> {
    const entries = await nodeFs.readdir(rootDir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const absolutePath = nodePath.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walk(absolutePath)));
        continue;
      }
      if (entry.isFile()) {
        files.push(absolutePath);
      }
    }
    return files.sort((left, right) => left.localeCompare(right));
  }

  return {
    invokeWithTelemetry: async (
      command: string,
      args?: {
        artifactPath?: string;
        expectedSha256?: string;
        filePath?: string;
      }
    ) => {
      if (command === 'plugin_verify_runtime_artifact_integrity') {
        return {
          artifactPath: normalizePath(args?.artifactPath ?? ''),
          sha256: args?.expectedSha256 ?? '',
        };
      }

      if (command !== 'plugin_read_install_source') {
        throw new Error(`Unexpected invoke command during smoke test: ${command}`);
      }

      const target = normalizePath(args?.filePath ?? '');
      const manifestPath = target.endsWith('/manifest.v2.json')
        ? target
        : normalizePath(nodePath.join(target, 'manifest.v2.json'));
      const rootDir = normalizePath(nodePath.dirname(manifestPath));
      const manifestRaw = await nodeFs.readFile(manifestPath, 'utf8');
      const files = await Promise.all(
        (await walk(rootDir)).map(async (absolutePath) => ({
          relativePath: normalizePath(nodePath.relative(rootDir, absolutePath)),
          bytes: Array.from(await nodeFs.readFile(absolutePath)),
        }))
      );

      return {
        manifestPath,
        rootDir,
        manifestRaw,
        files,
      };
    },
  };
});

describe('sidecar capability demo smoke', () => {
  beforeEach(async () => {
    localStorage.clear();
    setGlobalTelemetryService(null);
    vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(
      async (_algorithm: AlgorithmIdentifier, data: BufferSource) => {
        const view = ArrayBuffer.isView(data)
          ? new Uint8Array(
              data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
            )
          : new Uint8Array(data);
        const digest = createHash('sha256').update(Buffer.from(view)).digest();
        const out = Uint8Array.from(digest);
        return out.buffer.slice(0) as ArrayBuffer;
      }
    );
    await clearAppDataRoot();
  });

  afterEach(async () => {
    setGlobalTelemetryService(null);
    localStorage.clear();
    await clearAppDataRoot();
    vi.restoreAllMocks();
  });

  it(
    'runs install -> resolve -> command execute -> cleanup with a real Node sidecar process',
    async () => {
    const telemetry = createTelemetryServiceSpy();
    const sidecar = createRealSidecarHarness();
    setGlobalTelemetryService(telemetry.service);

    const { record, resolution } = await loadResolvedSidecarRuntime();
    const runtimeModule = await import('./runtime/extensionCommandRuntime');
    const governanceModule = await import('./extensionsGovernance');

    await expect(
      runtimeModule.runResolvedInstalledExtensionCommand(
        {
          record,
          resolution,
          commandId: 'sidecar-capability-demo.smoke',
          audioService: createStubAudioService(),
          navigation: createStubNavigation(),
          timeoutMs: 2_000,
        },
        {
          createPortController: sidecar.createPortController,
        }
      )
    ).resolves.toBeUndefined();

    const pid = sidecar.lastPid();
    await sidecar.disposeAll();

    expect(resolution.launcher.id).toBe('pxp.sidecar.native-process');
    expect(sidecar.disposeReasons).toContain('runtime-command-finished');
    expect(isProcessAlive(pid)).toBe(false);
    expect(governanceModule.readInstalledExtensionAuditLog().map((event) => event.type)).toEqual([
      'installed',
    ]);
    expect(telemetry.calls.find((entry) => entry.event === 'plugin.sidecar.bridge.opened')).toMatchObject({
      level: 'info',
      fields: expect.objectContaining({
        pluginId: 'sidecar-capability-demo',
        status: 'opened',
      }),
    });
    expect(
      telemetry.calls.find(
        (entry) => entry.event === 'plugin.capability.protocol.capability-invoke-request.start'
      )
    ).toMatchObject({
      level: 'debug',
      fields: expect.objectContaining({
        pluginId: 'sidecar-capability-demo',
        protocolOp: 'capability.invoke.request',
        capabilityId: 'core.capability-registry',
        method: 'list',
      }),
    });
    expect(
      telemetry.calls.find(
        (entry) => entry.event === 'plugin.capability.protocol.capability-invoke-response.sent'
      )
    ).toMatchObject({
      level: 'debug',
      fields: expect.objectContaining({
        pluginId: 'sidecar-capability-demo',
        protocolOp: 'capability.invoke.response',
        ok: true,
      }),
    });
    expect(
      telemetry.calls.find((entry) => entry.event === 'plugin.governance.control.cleanup.completed')
    ).toMatchObject({
      level: 'debug',
      fields: expect.objectContaining({
        pluginId: 'sidecar-capability-demo',
        protocolOp: 'runtime.dispose',
        reason: 'runtime-command-finished',
        status: 'terminated',
      }),
    });
    },
    20_000
  );

  it(
    'records activate hang -> runtime-unresponsive -> forced teardown with quarantine audit',
    async () => {
    const telemetry = createTelemetryServiceSpy();
    const sidecar = createRealSidecarHarness();
    setGlobalTelemetryService(telemetry.service);

    const { record, resolution } = await loadResolvedSidecarRuntime();
    const runtimeModule = await import('./runtime/extensionCommandRuntime');
    const extensionsModule = await import('./extensions');
    const governanceModule = await import('./extensionsGovernance');

    await expect(
      runtimeModule.runResolvedInstalledExtensionCommand(
        {
          record,
          resolution,
          commandId: 'sidecar-capability-demo.smoke',
          args: { mode: 'hang-on-activate' },
          audioService: createStubAudioService(),
          navigation: createStubNavigation(),
          timeoutMs: 150,
        },
        {
          createPortController: sidecar.createPortController,
        }
      )
    ).rejects.toThrow('Installed extension command timeout (150ms)');

    const pid = sidecar.lastPid();
    await sidecar.disposeAll();

    expect(sidecar.disposeReasons).toContain('runtime-unresponsive');
    expect(isProcessAlive(pid)).toBe(false);
    expect(governanceModule.readInstalledExtensionAuditLog().map((event) => event.type)).toEqual([
      'installed',
      'runtime-unresponsive',
      'quarantined',
    ]);
    expect(extensionsModule.getInstalledExtensionRecord('sidecar-capability-demo')).toMatchObject({
      enabled: false,
      disabledReason: 'quarantine',
    });
    expect(
      telemetry.calls.find((entry) => entry.event === 'plugin.sidecar.process.unresponsive')
    ).toMatchObject({
      level: 'warn',
      fields: expect.objectContaining({
        pluginId: 'sidecar-capability-demo',
        timeoutMs: 150,
        status: 'unresponsive',
      }),
    });
    expect(
      telemetry.calls.find((entry) => entry.event === 'plugin.sidecar.process.forced-teardown')
    ).toMatchObject({
      level: 'warn',
      fields: expect.objectContaining({
        pluginId: 'sidecar-capability-demo',
        teardownReason: 'runtime-unresponsive',
        status: 'forced-teardown',
      }),
    });
    expect(
      telemetry.calls.find((entry) => entry.event === 'plugin.governance.control.cleanup.completed')
    ).toMatchObject({
      level: 'debug',
      fields: expect.objectContaining({
        pluginId: 'sidecar-capability-demo',
        reason: 'runtime-unresponsive',
        protocolOp: 'runtime.dispose',
        status: 'terminated',
      }),
    });
    },
    20_000
  );

  it(
    'records fatal crash cleanup and forced teardown for the real sidecar process',
    async () => {
    const telemetry = createTelemetryServiceSpy();
    const sidecar = createRealSidecarHarness();
    setGlobalTelemetryService(telemetry.service);

    const { record, resolution } = await loadResolvedSidecarRuntime();
    const runtimeModule = await import('./runtime/extensionCommandRuntime');
    const governanceModule = await import('./extensionsGovernance');

    await expect(
      runtimeModule.runResolvedInstalledExtensionCommand(
        {
          record,
          resolution,
          commandId: 'sidecar-capability-demo.smoke',
          args: { mode: 'fatal-crash' },
          audioService: createStubAudioService(),
          navigation: createStubNavigation(),
          timeoutMs: 2_000,
        },
        {
          createPortController: sidecar.createPortController,
        }
      )
    ).rejects.toThrow('sidecar capability demo fatal crash after capability.invoke.response');

    const pid = sidecar.lastPid();
    await sidecar.disposeAll();

    expect(sidecar.disposeReasons).toContain('runtime-crash');
    expect(isProcessAlive(pid)).toBe(false);
    expect(governanceModule.readInstalledExtensionAuditLog().map((event) => event.type)).toEqual([
      'installed',
      'crash',
    ]);
    expect(
      telemetry.calls.find((entry) => entry.event === 'plugin.runtime.control.error.received')
    ).toMatchObject({
      level: 'debug',
      fields: expect.objectContaining({
        pluginId: 'sidecar-capability-demo',
        protocolOp: 'runtime.error',
        status: 'crashed',
      }),
    });
    expect(
      telemetry.calls.find((entry) => entry.event === 'plugin.governance.control.forced-teardown.completed')
    ).toMatchObject({
      level: 'debug',
      fields: expect.objectContaining({
        pluginId: 'sidecar-capability-demo',
        protocolOp: 'runtime.cleanup.forced',
        failureKind: 'crash',
        status: 'forced-teardown',
      }),
    });
    expect(
      telemetry.calls.find((entry) => entry.event === 'plugin.sidecar.process.forced-teardown')
    ).toMatchObject({
      level: 'warn',
      fields: expect.objectContaining({
        pluginId: 'sidecar-capability-demo',
        teardownReason: 'runtime-crash',
        status: 'forced-teardown',
      }),
    });
    expect(
      telemetry.calls.find((entry) => entry.event === 'plugin.governance.control.cleanup.completed')
    ).toMatchObject({
      level: 'debug',
      fields: expect.objectContaining({
        pluginId: 'sidecar-capability-demo',
        reason: 'runtime-crash',
        protocolOp: 'runtime.dispose',
        status: 'terminated',
      }),
    });
    },
    20_000
  );
});
