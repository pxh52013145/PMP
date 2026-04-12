import { afterEach, describe, expect, it } from 'vitest';
import type {
  InstalledExtensionRecord,
  PxpManifestV2,
} from '@pixel-matrix/plugin-platform-contracts';
import type { TelemetrySnapshot } from '../../services/telemetry';
import { setGlobalTelemetryService, type TelemetryService } from '../../services/telemetry';
import { DEFAULT_TELEMETRY_POLICY, type TelemetryRecord } from '../../contracts/telemetry';
import type { PluginRuntimeResolution } from './runtime/types';
import {
  completePluginGovernanceCleanup,
  completePluginGovernanceRevoke,
  completePluginSurfaceMount,
  createPluginSidecarTelemetryContext,
  createPluginRuntimeResolveTelemetryContext,
  createPluginSurfaceTelemetryContext,
  failPluginGovernanceCleanup,
  failPluginGovernanceRevoke,
  failPluginSurfaceMount,
  reportPluginSidecarBridgeFailed,
  reportPluginSidecarBridgeOpened,
  reportPluginSidecarProcessForcedTeardown,
  reportPluginSidecarProcessUnresponsive,
  reportPluginRuntimeResolve,
  startPluginGovernanceCleanup,
  startPluginGovernanceRevoke,
  startPluginSurfaceMount,
  timeoutPluginGovernanceRevoke,
} from './pluginLifecycleTelemetry';

type TelemetryCall = {
  moduleId: string;
  component: string | null | undefined;
  level: string;
  event: string;
  message?: string | null;
  fields?: Record<string, unknown>;
};

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
      frontendMinLevel: 'info',
      backendMinLevel: 'info',
      persistMinLevel: 'warn',
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
          fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined,
        });
      },
      trace: (event, options) =>
        calls.push({ moduleId, component, level: 'trace', event, message: options?.message ?? null, fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined }),
      debug: (event, options) =>
        calls.push({ moduleId, component, level: 'debug', event, message: options?.message ?? null, fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined }),
      info: (event, options) =>
        calls.push({ moduleId, component, level: 'info', event, message: options?.message ?? null, fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined }),
      warn: (event, options) =>
        calls.push({ moduleId, component, level: 'warn', event, message: options?.message ?? null, fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined }),
      error: (event, options) =>
        calls.push({ moduleId, component, level: 'error', event, message: options?.message ?? null, fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined }),
      fatal: (event, options) =>
        calls.push({ moduleId, component, level: 'fatal', event, message: options?.message ?? null, fields: (options?.fields as Record<string, unknown> | undefined) ?? undefined }),
      metric: (event, fields, options) =>
        calls.push({ moduleId, component, level: options?.level ?? 'info', event, message: options?.message ?? null, fields: fields as Record<string, unknown> }),
      startSpan: () => ({
        end: () => {},
      }),
    }),
    ingest: () => {},
    destroy: () => {},
  };

  return { calls, service };
}

afterEach(() => {
  setGlobalTelemetryService(null);
});

function createResolvedRuntimeResolution(): PluginRuntimeResolution {
  const manifest: PxpManifestV2 = {
    schemaVersion: '2.0',
    kind: 'extension',
    identity: {
      id: 'demo.plugin',
      publisher: 'pixel',
      version: '1.0.0',
      name: 'Demo Plugin',
    },
    hostTargets: [{ hostId: 'pmp' }],
    runtimes: [
      {
        runtimeId: 'worker.main',
        kind: 'extension-host',
        entry: 'dist/index.js',
      },
    ],
  };

  const installedRecord: InstalledExtensionRecord<PxpManifestV2> = {
    installedAt: 1,
    enabled: true,
    manifest,
    resolvedArtifacts: [
      {
        runtimeId: 'worker.main',
        path: 'C:/plugins/demo/dist/index.js',
      },
    ],
  };

  return {
    status: 'resolved',
    pluginId: 'demo.plugin',
    manifest,
    installedRecord,
    hostId: 'pmp',
    compatLayerIds: ['compat.pmpm'],
    issues: [],
    runtime: {
      runtimeId: 'worker.main',
      kind: 'extension-host',
      entry: 'dist/index.js',
    },
    launcher: {
      id: 'pxp.extension-host.worker',
      runtimeKinds: ['extension-host'],
      surfaceKinds: ['command'],
      availability: 'available',
      transport: 'worker',
      description: 'worker',
    },
    artifact: {
      runtimeId: 'worker.main',
      path: 'C:/plugins/demo/dist/index.js',
    },
    source: 'manifest-runtime',
  };
}

function createBlockedRuntimeResolution(): PluginRuntimeResolution {
  const manifest: PxpManifestV2 = {
    schemaVersion: '2.0',
    kind: 'extension',
    identity: {
      id: 'demo.plugin',
      publisher: 'pixel',
      version: '1.0.0',
      name: 'Demo Plugin',
    },
    hostTargets: [{ hostId: 'pmp' }],
    runtimes: [
      {
        runtimeId: 'webview.main',
        kind: 'webview',
        entry: 'dist/view.html',
      },
    ],
  };

  const installedRecord: InstalledExtensionRecord<PxpManifestV2> = {
    installedAt: 1,
    enabled: true,
    manifest,
  };

  return {
    status: 'blocked',
    pluginId: 'demo.plugin',
    manifest,
    installedRecord,
    hostId: 'pmp',
    compatLayerIds: [],
    issues: ['Runtime "webview.main" has no compatible launcher'],
    runtime: {
      runtimeId: 'webview.main',
      kind: 'webview',
      entry: 'dist/view.html',
    },
    candidateLaunchers: [],
  };
}

describe('pluginLifecycleTelemetry', () => {
  it('emits plugin.surface.mount start and completed events with a stable field contract', () => {
    const telemetry = createTelemetryServiceSpy();
    setGlobalTelemetryService(telemetry.service);

    const context = createPluginSurfaceTelemetryContext({
      pluginId: 'demo.plugin',
      sourceKind: 'pmpm',
      hostLabel: 'PmpmSandboxHost',
      launcherId: 'compat.pmpm.webview-sandbox',
      surfaceKind: 'page',
      surfaceId: 'demo-page',
    });

    const handle = startPluginSurfaceMount(context, {
      extraFields: {
        mountMode: 'sandbox',
      },
    });
    completePluginSurfaceMount(handle, {
      extraFields: {
        mountMode: 'sandbox',
      },
    });

    expect(telemetry.calls).toHaveLength(2);
    expect(telemetry.calls[0]).toMatchObject({
      moduleId: 'plugins',
      component: 'pluginLifecycleTelemetry',
      level: 'info',
      event: 'plugin.surface.mount.start',
      fields: expect.objectContaining({
        pluginId: 'demo.plugin',
        sourceKind: 'pmpm',
        launcherId: 'compat.pmpm.webview-sandbox',
        surfaceKind: 'page',
        surfaceId: 'demo-page',
        status: 'start',
        mountMode: 'sandbox',
      }),
    });
    expect(telemetry.calls[1]).toMatchObject({
      level: 'info',
      event: 'plugin.surface.mount.completed',
      fields: expect.objectContaining({
        pluginId: 'demo.plugin',
        surfaceKind: 'page',
        status: 'completed',
        mountMode: 'sandbox',
      }),
    });
    expect(telemetry.calls[1]?.fields?.durationMs).toEqual(expect.any(Number));
  });

  it('emits plugin.surface.mount.failed with failure details', () => {
    const telemetry = createTelemetryServiceSpy();
    setGlobalTelemetryService(telemetry.service);

    const context = createPluginSurfaceTelemetryContext({
      pluginId: 'demo.plugin',
      sourceKind: 'extv2',
      hostLabel: 'InstalledExtensionPageHost',
      launcherId: 'pxp.webview.host-frame',
      surfaceKind: 'page',
      surfaceId: 'demo-page',
    });

    const handle = startPluginSurfaceMount(context);
    failPluginSurfaceMount(handle, new Error('mount exploded'), {
      extraFields: {
        failureStage: 'runtime-event',
      },
    });

    expect(telemetry.calls).toHaveLength(2);
    expect(telemetry.calls[1]).toMatchObject({
      level: 'error',
      event: 'plugin.surface.mount.failed',
      message: 'mount exploded',
      fields: expect.objectContaining({
        pluginId: 'demo.plugin',
        sourceKind: 'extv2',
        launcherId: 'pxp.webview.host-frame',
        surfaceKind: 'page',
        surfaceId: 'demo-page',
        status: 'failed',
        failureStage: 'runtime-event',
      }),
    });
  });

  it('emits plugin.runtime.resolve start and completed events with the resolved contract fields', () => {
    const telemetry = createTelemetryServiceSpy();
    setGlobalTelemetryService(telemetry.service);

    const context = createPluginRuntimeResolveTelemetryContext({
      pluginId: 'demo.plugin',
      sourceKind: 'extv2',
      hostLabel: 'ExtensionCommand',
      surfaceKind: 'command',
      surfaceId: 'demo-command',
      cause: 'command',
    });

    reportPluginRuntimeResolve({
      context,
      resolution: createResolvedRuntimeResolution(),
      extraFields: {
        hostId: 'pmp',
        supportedLauncherIds: ['pxp.extension-host.worker'],
        preferCommandWorker: true,
      },
    });

    expect(telemetry.calls).toHaveLength(2);
    expect(telemetry.calls[0]).toMatchObject({
      level: 'info',
      event: 'plugin.runtime.resolve.start',
      fields: expect.objectContaining({
        pluginId: 'demo.plugin',
        sourceKind: 'extv2',
        surfaceKind: 'command',
        surfaceId: 'demo-command',
        cause: 'command',
        status: 'start',
        supportedLauncherIds: ['pxp.extension-host.worker'],
        preferCommandWorker: true,
      }),
    });
    expect(telemetry.calls[1]).toMatchObject({
      level: 'info',
      event: 'plugin.runtime.resolve.completed',
      fields: expect.objectContaining({
        pluginId: 'demo.plugin',
        resolutionStatus: 'resolved',
        runtimeId: 'worker.main',
        runtimeKind: 'extension-host',
        launcherId: 'pxp.extension-host.worker',
        runtimeSource: 'manifest-runtime',
        compatMode: 'fallback-available',
        status: 'completed',
      }),
    });
    expect(telemetry.calls[1]?.fields?.durationMs).toEqual(expect.any(Number));
  });

  it('emits plugin.runtime.resolve.failed when no compatible runtime launcher is available', () => {
    const telemetry = createTelemetryServiceSpy();
    setGlobalTelemetryService(telemetry.service);

    const context = createPluginRuntimeResolveTelemetryContext({
      pluginId: 'demo.plugin',
      sourceKind: 'pmpm',
      hostLabel: 'PmpmSandboxHost',
      surfaceKind: 'page',
      surfaceId: 'demo-page',
      cause: 'view',
    });

    reportPluginRuntimeResolve({
      context,
      resolution: createBlockedRuntimeResolution(),
      extraFields: {
        hostId: 'pmp',
        preferSandboxLauncher: true,
      },
    });

    expect(telemetry.calls).toHaveLength(2);
    expect(telemetry.calls[1]).toMatchObject({
      level: 'warn',
      event: 'plugin.runtime.resolve.failed',
      message: 'Runtime "webview.main" has no compatible launcher',
      fields: expect.objectContaining({
        pluginId: 'demo.plugin',
        sourceKind: 'pmpm',
        surfaceKind: 'page',
        surfaceId: 'demo-page',
        cause: 'view',
        resolutionStatus: 'blocked',
        runtimeId: 'webview.main',
        runtimeKind: 'webview',
        issueCount: 1,
        compatMode: 'none',
        status: 'failed',
        preferSandboxLauncher: true,
      }),
    });
  });

  it('emits plugin.sidecar bridge and process lifecycle events with stable fields', () => {
    const telemetry = createTelemetryServiceSpy();
    setGlobalTelemetryService(telemetry.service);

    const context = createPluginSidecarTelemetryContext({
      pluginId: 'demo.plugin',
      sourceKind: 'extv2',
      hostLabel: 'ExtensionCommandSidecar',
      runtimeId: 'sidecar.main',
      runtimeInstanceId: 'demo.plugin:command:1',
      surfaceKind: 'command',
      surfaceId: 'demo-command',
      cause: 'command',
    });

    reportPluginSidecarBridgeOpened(context, {
      extraFields: {
        sidecarSessionId: 'sidecar-session-1',
        timeoutMs: 2_000,
      },
    });
    reportPluginSidecarProcessUnresponsive(context, {
      extraFields: {
        timeoutMs: 2_000,
      },
    });
    reportPluginSidecarProcessForcedTeardown(context, {
      extraFields: {
        teardownReason: 'runtime-unresponsive',
      },
    });
    reportPluginSidecarBridgeFailed(context, new Error('bridge open failed'), {
      extraFields: {
        stage: 'open',
      },
    });

    expect(telemetry.calls.map((entry) => entry.event)).toEqual([
      'plugin.sidecar.bridge.opened',
      'plugin.sidecar.process.unresponsive',
      'plugin.sidecar.process.forced-teardown',
      'plugin.sidecar.bridge.failed',
    ]);
    expect(telemetry.calls[0]).toMatchObject({
      level: 'info',
      event: 'plugin.sidecar.bridge.opened',
      fields: expect.objectContaining({
        pluginId: 'demo.plugin',
        sourceKind: 'extv2',
        launcherId: 'pxp.sidecar.native-process',
        runtimeId: 'sidecar.main',
        runtimeInstanceId: 'demo.plugin:command:1',
        surfaceKind: 'command',
        surfaceId: 'demo-command',
        cause: 'command',
        status: 'opened',
        sidecarSessionId: 'sidecar-session-1',
      }),
    });
    expect(telemetry.calls[1]).toMatchObject({
      level: 'warn',
      event: 'plugin.sidecar.process.unresponsive',
      fields: expect.objectContaining({
        status: 'unresponsive',
        timeoutMs: 2_000,
      }),
    });
    expect(telemetry.calls[2]).toMatchObject({
      level: 'warn',
      event: 'plugin.sidecar.process.forced-teardown',
      fields: expect.objectContaining({
        status: 'forced-teardown',
        teardownReason: 'runtime-unresponsive',
      }),
    });
    expect(telemetry.calls[3]).toMatchObject({
      level: 'error',
      event: 'plugin.sidecar.bridge.failed',
      message: 'bridge open failed',
      fields: expect.objectContaining({
        status: 'failed',
        stage: 'open',
      }),
    });
  });

  it('emits governance revoke and cleanup events with stable contract fields', () => {
    const telemetry = createTelemetryServiceSpy();
    setGlobalTelemetryService(telemetry.service);

    const context = createPluginSurfaceTelemetryContext({
      pluginId: 'demo.plugin',
      sourceKind: 'extv2',
      hostLabel: 'InstalledExtensionPageHost',
      launcherId: 'pxp.webview.host-frame',
      surfaceKind: 'page',
      surfaceId: 'demo-page',
    });

    const revokeHandle = startPluginGovernanceRevoke(context, {
      extraFields: {
        requestId: 'runtime-revoke:1',
        capabilityIds: ['host.pmp.navigation'],
        reason: 'runtime-dispose',
      },
    });
    completePluginGovernanceRevoke(revokeHandle, {
      extraFields: {
        requestId: 'runtime-revoke:1',
        ignored: true,
      },
    });

    const revokeTimeoutHandle = startPluginGovernanceRevoke(context, {
      extraFields: {
        requestId: 'runtime-revoke:2',
      },
    });
    timeoutPluginGovernanceRevoke(revokeTimeoutHandle, new Error('revoke timeout'), {
      extraFields: {
        requestId: 'runtime-revoke:2',
        revokeTimeoutMs: 1_500,
      },
    });

    const revokeFailureHandle = startPluginGovernanceRevoke(context);
    failPluginGovernanceRevoke(revokeFailureHandle, new Error('revoke failed'), {
      extraFields: {
        requestId: 'runtime-revoke:3',
      },
    });

    const cleanupHandle = startPluginGovernanceCleanup(context, {
      extraFields: {
        reason: 'runtime-dispose',
      },
    });
    completePluginGovernanceCleanup(cleanupHandle, {
      extraFields: {
        reason: 'runtime-dispose',
      },
    });

    const cleanupFailureHandle = startPluginGovernanceCleanup(context);
    failPluginGovernanceCleanup(cleanupFailureHandle, new Error('cleanup failed'), {
      extraFields: {
        reason: 'runtime-crash',
      },
    });

    expect(
      telemetry.calls.map((entry) => entry.event).filter((event) => event.startsWith('plugin.governance.'))
    ).toEqual([
      'plugin.governance.revoke.start',
      'plugin.governance.revoke.completed',
      'plugin.governance.revoke.start',
      'plugin.governance.revoke.timeout',
      'plugin.governance.revoke.start',
      'plugin.governance.revoke.failed',
      'plugin.governance.cleanup.start',
      'plugin.governance.cleanup.completed',
      'plugin.governance.cleanup.start',
      'plugin.governance.cleanup.failed',
    ]);
    expect(telemetry.calls[1]).toMatchObject({
      level: 'info',
      event: 'plugin.governance.revoke.completed',
      fields: expect.objectContaining({
        pluginId: 'demo.plugin',
        requestId: 'runtime-revoke:1',
        ignored: true,
        status: 'completed',
      }),
    });
    expect(telemetry.calls[3]).toMatchObject({
      level: 'warn',
      event: 'plugin.governance.revoke.timeout',
      message: 'revoke timeout',
      fields: expect.objectContaining({
        requestId: 'runtime-revoke:2',
        revokeTimeoutMs: 1_500,
        status: 'timeout',
      }),
    });
    expect(telemetry.calls[5]).toMatchObject({
      level: 'error',
      event: 'plugin.governance.revoke.failed',
      message: 'revoke failed',
      fields: expect.objectContaining({
        requestId: 'runtime-revoke:3',
        status: 'failed',
      }),
    });
    expect(telemetry.calls[7]).toMatchObject({
      level: 'info',
      event: 'plugin.governance.cleanup.completed',
      fields: expect.objectContaining({
        reason: 'runtime-dispose',
        status: 'completed',
      }),
    });
    expect(telemetry.calls[9]).toMatchObject({
      level: 'error',
      event: 'plugin.governance.cleanup.failed',
      message: 'cleanup failed',
      fields: expect.objectContaining({
        reason: 'runtime-crash',
        status: 'failed',
      }),
    });
  });
});
