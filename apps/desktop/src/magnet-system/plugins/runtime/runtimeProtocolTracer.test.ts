import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TELEMETRY_POLICY,
  type TelemetryRecord,
} from '../../../contracts/telemetry';
import {
  setGlobalTelemetryService,
  type TelemetryService,
  type TelemetrySnapshot,
} from '../../../services/telemetry';
import {
  completeRuntimeProtocolSpan,
  createRuntimeProtocolTraceContext,
  failRuntimeProtocolSpan,
  startRuntimeProtocolSpan,
  traceRuntimeProtocolStep,
} from './runtimeProtocolTracer';

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

function createTelemetryServiceSpy(): {
  calls: TelemetryCall[];
  service: TelemetryService;
} {
  const calls: TelemetryCall[] = [];
  const snapshot: TelemetrySnapshot = {
    policy: {
      ...DEFAULT_TELEMETRY_POLICY,
      frontendMinLevel: 'debug',
      backendMinLevel: 'warn',
      retention: {
        ...DEFAULT_TELEMETRY_POLICY.retention,
      },
      modules: {},
    },
    status: {
      enabled: true,
      currentSessionId: 'session-1',
      queuedRecords: 0,
      flushedRecords: 0,
      droppedRecords: 0,
      currentFileBytes: 0,
      currentFilePath: null,
      frontendMinLevel: 'debug',
      backendMinLevel: 'warn',
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
      metric: () => {},
      startSpan: () => ({
        end: () => {},
      }),
    }),
    ingest: () => {},
    destroy: () => {},
  };

  return { calls, service };
}

function createTraceContext() {
  return createRuntimeProtocolTraceContext({
    pluginId: 'sidecar-capability-demo',
    runtimeId: 'sidecar.main',
    runtimeInstanceId: 'runtime-instance-1',
    runtimeKind: 'sidecar',
    carrier: 'native-process',
    sourceKind: 'extv2',
    hostLabel: 'SidecarCapabilityDemo',
    launcherId: 'pxp.sidecar.native-process',
  });
}

describe('runtimeProtocolTracer', () => {
  afterEach(() => {
    setGlobalTelemetryService(null);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('emits control-channel trace envelopes with stable runtime identity fields', () => {
    const telemetry = createTelemetryServiceSpy();
    setGlobalTelemetryService(telemetry.service);
    const context = createTraceContext();

    traceRuntimeProtocolStep(context, 'plugin.runtime.control.health.requested', {
      direction: 'host->runtime',
      requestId: 'health-1',
      protocolOp: 'runtime.health.request',
      status: 'queued',
      extraFields: {
        ready: false,
      },
    });

    expect(telemetry.calls).toHaveLength(1);
    expect(telemetry.calls[0]).toMatchObject({
      moduleId: 'plugins',
      component: 'runtimeProtocolTracer',
      level: 'debug',
      event: 'plugin.runtime.control.health.requested',
      traceId: expect.any(String),
      fields: expect.objectContaining({
        channel: 'control',
        pluginId: 'sidecar-capability-demo',
        runtimeId: 'sidecar.main',
        runtimeInstanceId: 'runtime-instance-1',
        runtimeKind: 'sidecar',
        carrier: 'native-process',
        sourceKind: 'extv2',
        hostLabel: 'SidecarCapabilityDemo',
        launcherId: 'pxp.sidecar.native-process',
        direction: 'host->runtime',
        requestId: 'health-1',
        protocolOp: 'runtime.health.request',
        status: 'queued',
        ready: false,
      }),
    });
  });

  it('records an invoke -> response/error control timeline with shared trace and span ids', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T12:00:00.000Z'));

    const telemetry = createTelemetryServiceSpy();
    setGlobalTelemetryService(telemetry.service);
    const context = createTraceContext();

    const invokeSpan = startRuntimeProtocolSpan(context, 'plugin.capability.control.invoke', {
      requestId: 'invoke-1',
      direction: 'host->runtime',
      protocolOp: 'capability.invoke.request',
      extraFields: {
        capabilityId: 'host.pmp.navigation',
        method: 'navigateTo',
      },
    });
    vi.advanceTimersByTime(25);
    completeRuntimeProtocolSpan(invokeSpan, {
      requestId: 'invoke-1',
      direction: 'runtime->host',
      protocolOp: 'capability.invoke.response',
      status: 'completed',
      extraFields: {
        capabilityId: 'host.pmp.navigation',
        method: 'navigateTo',
      },
    });

    const failedInvokeSpan = startRuntimeProtocolSpan(context, 'plugin.capability.control.invoke', {
      requestId: 'invoke-2',
      direction: 'host->runtime',
      protocolOp: 'capability.invoke.request',
      extraFields: {
        capabilityId: 'host.pmp.navigation',
        method: 'navigateTo',
      },
    });
    vi.advanceTimersByTime(40);
    failRuntimeProtocolSpan(failedInvokeSpan, {
      requestId: 'invoke-2',
      direction: 'runtime->host',
      protocolOp: 'capability.invoke.error',
      extraFields: {
        capabilityId: 'host.pmp.navigation',
        method: 'navigateTo',
        message: 'navigation denied',
      },
    });

    expect(telemetry.calls.map((entry) => entry.event)).toEqual([
      'plugin.capability.control.invoke.start',
      'plugin.capability.control.invoke.completed',
      'plugin.capability.control.invoke.start',
      'plugin.capability.control.invoke.failed',
    ]);
    expect(telemetry.calls[0]).toMatchObject({
      traceId: expect.any(String),
      spanId: expect.any(String),
      fields: expect.objectContaining({
        channel: 'control',
        requestId: 'invoke-1',
        protocolOp: 'capability.invoke.request',
        status: 'start',
      }),
    });
    expect(telemetry.calls[1]).toMatchObject({
      traceId: telemetry.calls[0]?.traceId,
      spanId: telemetry.calls[0]?.spanId,
      fields: expect.objectContaining({
        channel: 'control',
        requestId: 'invoke-1',
        protocolOp: 'capability.invoke.response',
        status: 'completed',
        durationMs: 25,
      }),
    });
    expect(telemetry.calls[3]).toMatchObject({
      traceId: telemetry.calls[2]?.traceId,
      spanId: telemetry.calls[2]?.spanId,
      fields: expect.objectContaining({
        channel: 'control',
        requestId: 'invoke-2',
        protocolOp: 'capability.invoke.error',
        status: 'failed',
        durationMs: 40,
        message: 'navigation denied',
      }),
    });
  });

  it('records revoke -> cleanup and crash -> forced teardown control timelines', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T12:00:00.000Z'));

    const telemetry = createTelemetryServiceSpy();
    setGlobalTelemetryService(telemetry.service);
    const context = createTraceContext();

    const revokeSpan = startRuntimeProtocolSpan(context, 'plugin.governance.control.revoke', {
      requestId: 'revoke-1',
      direction: 'host->runtime',
      protocolOp: 'runtime.capabilities.revoke',
      extraFields: {
        capabilityIds: ['host.pmp.navigation'],
        reason: 'runtime-unresponsive',
      },
    });
    vi.advanceTimersByTime(15);
    failRuntimeProtocolSpan(revokeSpan, {
      eventSuffix: 'timeout',
      requestId: 'revoke-1',
      direction: 'host',
      protocolOp: 'runtime.capabilities.revoke',
      extraFields: {
        capabilityIds: ['host.pmp.navigation'],
        reason: 'runtime-unresponsive',
      },
    });

    const cleanupSpan = startRuntimeProtocolSpan(context, 'plugin.governance.control.cleanup', {
      traceId: revokeSpan.traceId,
      direction: 'host',
      protocolOp: 'runtime.dispose',
      extraFields: {
        reason: 'runtime-unresponsive',
      },
    });
    vi.advanceTimersByTime(20);
    completeRuntimeProtocolSpan(cleanupSpan, {
      direction: 'host',
      protocolOp: 'runtime.dispose',
      status: 'terminated',
      extraFields: {
        reason: 'runtime-unresponsive',
      },
    });

    traceRuntimeProtocolStep(context, 'plugin.runtime.control.error.received', {
      traceId: revokeSpan.traceId,
      direction: 'runtime->host',
      protocolOp: 'runtime.error',
      status: 'crashed',
      extraFields: {
        message: 'sidecar crashed',
      },
    });

    const forcedTeardownSpan = startRuntimeProtocolSpan(
      context,
      'plugin.governance.control.forced-teardown',
      {
        traceId: revokeSpan.traceId,
        direction: 'host',
        protocolOp: 'runtime.cleanup.forced',
        extraFields: {
          failureKind: 'crash',
          reason: 'runtime-crash:sidecar crashed',
        },
      }
    );
    vi.advanceTimersByTime(8);
    completeRuntimeProtocolSpan(forcedTeardownSpan, {
      direction: 'host',
      protocolOp: 'runtime.cleanup.forced',
      status: 'forced-teardown',
      extraFields: {
        failureKind: 'crash',
        reason: 'runtime-crash:sidecar crashed',
        state: 'crashed',
      },
    });

    expect(telemetry.calls.map((entry) => entry.event)).toEqual([
      'plugin.governance.control.revoke.start',
      'plugin.governance.control.revoke.timeout',
      'plugin.governance.control.cleanup.start',
      'plugin.governance.control.cleanup.completed',
      'plugin.runtime.control.error.received',
      'plugin.governance.control.forced-teardown.start',
      'plugin.governance.control.forced-teardown.completed',
    ]);
    for (const call of telemetry.calls) {
      expect(call.fields?.channel).toBe('control');
      expect(call.traceId).toBe(revokeSpan.traceId);
    }
    expect(telemetry.calls[1]).toMatchObject({
      fields: expect.objectContaining({
        requestId: 'revoke-1',
        status: 'timeout',
        durationMs: 15,
      }),
    });
    expect(telemetry.calls[3]).toMatchObject({
      fields: expect.objectContaining({
        protocolOp: 'runtime.dispose',
        status: 'terminated',
        durationMs: 20,
      }),
    });
    expect(telemetry.calls[6]).toMatchObject({
      fields: expect.objectContaining({
        protocolOp: 'runtime.cleanup.forced',
        status: 'forced-teardown',
        failureKind: 'crash',
        state: 'crashed',
        durationMs: 8,
      }),
    });
  });
});
