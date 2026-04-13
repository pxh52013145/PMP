import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContribution } from '../../contracts/contributions';
import { DEFAULT_TELEMETRY_POLICY, type TelemetryRecord } from '../../contracts/telemetry';
import { ContributionRegistry, ServiceRegistry } from '../../kernel';
import {
  setGlobalTelemetryService,
  type TelemetryService,
  type TelemetrySnapshot,
} from '../../services/telemetry';
import { createInstalledExtensionContributionsModule } from './extensionContributionsModule';
import { INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN } from './installedExtensionRuntimeManager';
import { SHELL_SURFACE_MANAGER_TOKEN, DefaultShellSurfaceManager } from './shellSurfaceManager';

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

type ShellSurfaceInvokeCall = {
  command: string;
  args?: Record<string, unknown>;
  telemetry?: Record<string, unknown>;
};

const harnessState = vi.hoisted(() => ({
  appDataRoot: `${process.cwd().replace(/\\/g, '/')}/.codex-tmp/vitest-shell-surface-smoke-appdata`,
  shellSurfaceCalls: [] as ShellSurfaceInvokeCall[],
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

async function clearAppDataRoot(): Promise<void> {
  await fs.rm(harnessState.appDataRoot, { recursive: true, force: true });
  await fs.mkdir(harnessState.appDataRoot, { recursive: true });
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function installShellSurfaceFixture(): Promise<void> {
  const manifestPath = path.resolve(
    process.cwd(),
    '../../community/plugins/shell-surface-demo/manifest.v2.json'
  );
  const extensionsModule = await import('./extensions');
  await extensionsModule.installInstalledExtensionFromFilePath(manifestPath);
}

vi.mock('../../utils/tauriRuntime', () => ({
  isTauriRuntime: () => true,
}));

vi.mock('../../utils/editorWindows', () => ({
  getMainWindowBounds: async () => ({
    x: 120,
    y: 80,
    width: 1280,
    height: 900,
  }),
}));

vi.mock('../../utils/windowCommunication', () => ({
    STORAGE_KEYS: {
      EXTENSIONS_V2: 'test:extensions-v2',
      EXTENSIONS_V2_AUDIT_LOG_V1: 'test:extensions-v2-audit-log-v1',
      EXTENSIONS_V2_RUNTIME_RESTART_V1: 'test:extensions-v2-runtime-restart-v1',
    },
  TAURI_EVENTS: {
    EXTENSIONS_V2_UPDATED: 'test:extensions-v2-updated',
  },
  broadcastSignal: vi.fn(async () => undefined),
  broadcastDataUpdate: vi.fn(async (storageKey: string, data: unknown) => {
    localStorage.setItem(storageKey, JSON.stringify(data));
  }),
  setupTauriListenerWithPayload: vi.fn(async () => () => {}),
  setupStorageListener: vi.fn(() => () => {}),
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
    if (dir === 22 && !normalized.startsWith('/') && !/^[a-zA-Z]:\//.test(normalized)) {
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
      args?: Record<string, unknown>,
      telemetry?: Record<string, unknown>
    ) => {
      if (command === 'plugin_read_install_source') {
        const target = normalizePath(String(args?.filePath ?? ''));
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
      }

      harnessState.shellSurfaceCalls.push({ command, args, telemetry });

      if (command === 'open_plugin_shell_surface') {
        return {
          status: 'ok',
        };
      }

      if (
        command === 'dismiss_plugin_shell_surface' ||
        command === 'destroy_plugin_shell_surface'
      ) {
        return undefined;
      }

      throw new Error(`Unexpected invoke command during shell-surface smoke: ${command}`);
    },
  };
});

describe('shell surface demo smoke', () => {
  beforeEach(async () => {
    harnessState.shellSurfaceCalls.length = 0;
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
    harnessState.shellSurfaceCalls.length = 0;
    localStorage.clear();
    await clearAppDataRoot();
    vi.restoreAllMocks();
  });

  it('runs install -> summon/focus -> dismiss -> capability-revoke cleanup for overlay and desktop widget shell surfaces', async () => {
    const telemetry = createTelemetryServiceSpy();
    setGlobalTelemetryService(telemetry.service);
    await installShellSurfaceFixture();

    const extensionsModule = await import('./extensions');
    const governanceModule = await import('./extensionsGovernance');
    const runtimeSupervisorModule = await import('./hostExtensionRuntimeSupervisor');

    const record = extensionsModule.getInstalledExtensionRecord('shell-surface-demo');
    expect(record).not.toBeNull();

    const contributions = new ContributionRegistry();
    const services = new ServiceRegistry();
    const manager = new DefaultShellSurfaceManager({
      enableBackgroundSync: true,
    });

    services.register(SHELL_SURFACE_MANAGER_TOKEN, manager);
    services.register(INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN, {
      runCommand: vi.fn(),
    } as never);

    manager.start();
    const module = createInstalledExtensionContributionsModule();
    const deactivate = module.activate({
      contributions,
      services,
      events: {} as never,
    });

    try {
      const overlayCommand = contributions.get<CommandContribution>(
        'command',
        'extv2:shell-surface-demo:shell-surface:demo-overlay:summon'
      );
      const widgetCommand = contributions.get<CommandContribution>(
        'command',
        'extv2:shell-surface-demo:shell-surface:demo-widget:summon'
      );

      expect(overlayCommand).not.toBeNull();
      expect(widgetCommand).not.toBeNull();

      await overlayCommand?.run();
      await overlayCommand?.run();
      await widgetCommand?.run();
      await widgetCommand?.run();

      expect(
        manager.listTrackedSurfaces().map((surface) => ({
          pluginId: surface.pluginId,
          surfaceId: surface.descriptor.id,
          surfaceType: surface.descriptor.surfaceType,
        }))
      ).toEqual([
        {
          pluginId: 'shell-surface-demo',
          surfaceId: 'demo-overlay',
          surfaceType: 'overlay',
        },
        {
          pluginId: 'shell-surface-demo',
          surfaceId: 'demo-widget',
          surfaceType: 'desktop-widget',
        },
      ]);

      await manager.dismissSurface({
        sourceKind: 'extv2',
        pluginId: 'shell-surface-demo',
        surfaceId: 'demo-overlay',
        surfaceType: 'overlay',
      });

      runtimeSupervisorModule.requestInstalledExtensionRuntimeRestart('shell-surface-demo', {
        reason: 'capability-revoke',
      });
      await flushAsyncWork();

      expect(manager.listTrackedSurfaces()).toEqual([]);
      expect(
        contributions.get(
          'command',
          'extv2:shell-surface-demo:shell-surface:demo-overlay:summon'
        )
      ).not.toBeNull();
      expect(governanceModule.readInstalledExtensionAuditLog().map((event) => event.type)).toEqual([
        'installed',
        'runtime-restart',
      ]);

      expect(harnessState.shellSurfaceCalls.map((entry) => entry.command)).toEqual([
        'open_plugin_shell_surface',
        'open_plugin_shell_surface',
        'open_plugin_shell_surface',
        'open_plugin_shell_surface',
        'dismiss_plugin_shell_surface',
        'destroy_plugin_shell_surface',
        'destroy_plugin_shell_surface',
      ]);

      expect(harnessState.shellSurfaceCalls[0]).toMatchObject({
        command: 'open_plugin_shell_surface',
        args: expect.objectContaining({
          sourceKind: 'extv2',
          pluginId: 'shell-surface-demo',
          surfaceId: 'demo-overlay',
          surfaceType: 'overlay',
          focusable: true,
          pointerPolicy: 'capture-input',
        }),
        telemetry: expect.objectContaining({
          event: 'window.plugin-shell-surface.open',
        }),
      });
      expect(harnessState.shellSurfaceCalls[1]).toMatchObject({
        command: 'open_plugin_shell_surface',
        args: expect.objectContaining({
          pluginId: 'shell-surface-demo',
          surfaceId: 'demo-overlay',
          surfaceType: 'overlay',
          focusable: true,
        }),
      });
      expect(harnessState.shellSurfaceCalls[2]).toMatchObject({
        command: 'open_plugin_shell_surface',
        args: expect.objectContaining({
          sourceKind: 'extv2',
          pluginId: 'shell-surface-demo',
          surfaceId: 'demo-widget',
          surfaceType: 'desktop-widget',
          focusable: true,
          pointerPolicy: 'capture-input',
        }),
      });
      expect(harnessState.shellSurfaceCalls[3]).toMatchObject({
        command: 'open_plugin_shell_surface',
        args: expect.objectContaining({
          pluginId: 'shell-surface-demo',
          surfaceId: 'demo-widget',
          surfaceType: 'desktop-widget',
          focusable: true,
        }),
      });
      expect(harnessState.shellSurfaceCalls[4]).toMatchObject({
        command: 'dismiss_plugin_shell_surface',
        args: {
          sourceKind: 'extv2',
          pluginId: 'shell-surface-demo',
          surfaceId: 'demo-overlay',
          surfaceType: 'overlay',
        },
        telemetry: expect.objectContaining({
          event: 'window.plugin-shell-surface.dismiss',
        }),
      });
      expect(harnessState.shellSurfaceCalls[5]).toMatchObject({
        command: 'destroy_plugin_shell_surface',
        args: {
          sourceKind: 'extv2',
          pluginId: 'shell-surface-demo',
          surfaceId: 'demo-overlay',
          surfaceType: 'overlay',
          reason: 'capability-revoke',
        },
        telemetry: expect.objectContaining({
          event: 'window.plugin-shell-surface.destroy',
        }),
      });
      expect(harnessState.shellSurfaceCalls[6]).toMatchObject({
        command: 'destroy_plugin_shell_surface',
        args: {
          sourceKind: 'extv2',
          pluginId: 'shell-surface-demo',
          surfaceId: 'demo-widget',
          surfaceType: 'desktop-widget',
          reason: 'capability-revoke',
        },
        telemetry: expect.objectContaining({
          event: 'window.plugin-shell-surface.destroy',
        }),
      });

      const cleanupEvents = telemetry.calls.filter(
        (entry) => entry.event === 'plugin.governance.cleanup.completed'
      );
      expect(cleanupEvents).toHaveLength(2);
      expect(cleanupEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: 'info',
            fields: expect.objectContaining({
              pluginId: 'shell-surface-demo',
              sourceKind: 'extv2',
              surfaceKind: 'overlay',
              surfaceId: 'demo-overlay',
              reason: 'capability-revoke',
              status: 'completed',
            }),
          }),
          expect.objectContaining({
            level: 'info',
            fields: expect.objectContaining({
              pluginId: 'shell-surface-demo',
              sourceKind: 'extv2',
              surfaceKind: 'desktop-widget',
              surfaceId: 'demo-widget',
              reason: 'capability-revoke',
              status: 'completed',
            }),
          }),
        ])
      );
    } finally {
      if (typeof deactivate === 'function') {
        deactivate();
      }
      manager.dispose();
    }
  });
});
