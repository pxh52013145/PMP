import { getTelemetryLogger } from '../../../services/telemetry/TelemetryService';
import type { RuntimeCarrier, RuntimeKind } from '@pixel-matrix/plugin-platform-contracts';
import type { PluginLifecycleSourceKind } from '../pluginLifecycleTelemetry';

const telemetry = getTelemetryLogger('plugins', 'runtimeProtocolTracer');

export type RuntimeProtocolTraceContext = {
  pluginId: string;
  runtimeId: string;
  runtimeInstanceId: string;
  runtimeKind: RuntimeKind;
  carrier: RuntimeCarrier;
  channel: 'control';
  sourceKind?: PluginLifecycleSourceKind | null;
  hostLabel?: string | null;
  launcherId?: string | null;
  sessionTraceId: string;
};

export type RuntimeProtocolTraceSpan = {
  context: RuntimeProtocolTraceContext;
  event: string;
  spanId: string;
  traceId: string;
  startedAtMs: number;
};

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nowMs(): number {
  return Date.now();
}

function createTraceId(runtimeInstanceId: string): string {
  return `runtime-trace:${runtimeInstanceId}:${nowMs()}:${Math.random().toString(16).slice(2)}`;
}

function createSpanId(label: string): string {
  return `${label}:${nowMs()}:${Math.random().toString(16).slice(2)}`;
}

function buildFields(
  context: RuntimeProtocolTraceContext,
  options: {
    direction?: 'host->runtime' | 'runtime->host' | 'host';
    requestId?: string | null;
    protocolOp?: string | null;
    status?: string | null;
    extraFields?: Record<string, unknown>;
  } = {}
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    channel: context.channel,
    pluginId: context.pluginId,
    runtimeId: context.runtimeId,
    runtimeInstanceId: context.runtimeInstanceId,
    runtimeKind: context.runtimeKind,
    carrier: context.carrier,
    sourceKind: context.sourceKind ?? null,
    hostLabel: context.hostLabel ?? null,
    launcherId: context.launcherId ?? null,
    direction: options.direction ?? 'host',
    requestId: options.requestId ?? null,
    protocolOp: options.protocolOp ?? null,
    status: options.status ?? null,
  };

  if (options.extraFields) {
    Object.assign(fields, options.extraFields);
  }

  return fields;
}

export function createRuntimeProtocolTraceContext(input: {
  pluginId: string;
  runtimeId: string;
  runtimeInstanceId: string;
  runtimeKind: RuntimeKind;
  carrier: RuntimeCarrier;
  sourceKind?: PluginLifecycleSourceKind | null;
  hostLabel?: string | null;
  launcherId?: string | null;
}): RuntimeProtocolTraceContext {
  return {
    channel: 'control',
    pluginId: input.pluginId,
    runtimeId: input.runtimeId,
    runtimeInstanceId: input.runtimeInstanceId,
    runtimeKind: input.runtimeKind,
    carrier: input.carrier,
    sourceKind: input.sourceKind ?? null,
    hostLabel: normalizeString(input.hostLabel),
    launcherId: normalizeString(input.launcherId),
    sessionTraceId: createTraceId(input.runtimeInstanceId),
  };
}

export function traceRuntimeProtocolStep(
  context: RuntimeProtocolTraceContext,
  event: string,
  options: {
    traceId?: string | null;
    spanId?: string | null;
    direction?: 'host->runtime' | 'runtime->host' | 'host';
    requestId?: string | null;
    protocolOp?: string | null;
    status?: string | null;
    extraFields?: Record<string, unknown>;
  } = {}
): void {
  telemetry.debug(event, {
    traceId: options.traceId ?? context.sessionTraceId,
    spanId: options.spanId ?? undefined,
    fields: buildFields(context, options),
  });
}

export function startRuntimeProtocolSpan(
  context: RuntimeProtocolTraceContext,
  event: string,
  options: {
    traceId?: string | null;
    requestId?: string | null;
    direction?: 'host->runtime' | 'runtime->host' | 'host';
    protocolOp?: string | null;
    extraFields?: Record<string, unknown>;
  } = {}
): RuntimeProtocolTraceSpan {
  const spanId = createSpanId(event);
  const traceId = options.traceId ?? context.sessionTraceId;
  traceRuntimeProtocolStep(context, `${event}.start`, {
    traceId,
    spanId,
    direction: options.direction,
    requestId: options.requestId,
    protocolOp: options.protocolOp,
    status: 'start',
    extraFields: options.extraFields,
  });
  return {
    context,
    event,
    spanId,
    traceId,
    startedAtMs: nowMs(),
  };
}

export function completeRuntimeProtocolSpan(
  span: RuntimeProtocolTraceSpan,
  options: {
    direction?: 'host->runtime' | 'runtime->host' | 'host';
    requestId?: string | null;
    protocolOp?: string | null;
    status?: string | null;
    extraFields?: Record<string, unknown>;
  } = {}
): void {
  traceRuntimeProtocolStep(span.context, `${span.event}.completed`, {
    traceId: span.traceId,
    spanId: span.spanId,
    direction: options.direction,
    requestId: options.requestId,
    protocolOp: options.protocolOp,
    status: options.status ?? 'completed',
    extraFields: {
      durationMs: Math.max(0, nowMs() - span.startedAtMs),
      ...(options.extraFields ?? {}),
    },
  });
}

export function failRuntimeProtocolSpan(
  span: RuntimeProtocolTraceSpan,
  options: {
    eventSuffix?: 'failed' | 'timeout';
    direction?: 'host->runtime' | 'runtime->host' | 'host';
    requestId?: string | null;
    protocolOp?: string | null;
    extraFields?: Record<string, unknown>;
  } = {}
): void {
  const suffix = options.eventSuffix ?? 'failed';
  traceRuntimeProtocolStep(span.context, `${span.event}.${suffix}`, {
    traceId: span.traceId,
    spanId: span.spanId,
    direction: options.direction,
    requestId: options.requestId,
    protocolOp: options.protocolOp,
    status: suffix,
    extraFields: {
      durationMs: Math.max(0, nowMs() - span.startedAtMs),
      ...(options.extraFields ?? {}),
    },
  });
}
