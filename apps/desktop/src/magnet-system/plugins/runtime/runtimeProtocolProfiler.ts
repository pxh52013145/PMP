import type { RuntimeProtocolChannel } from './runtimeProtocolTracer';

export interface RuntimeProtocolProfilerRecord {
  event: string;
  traceId?: string | null;
  spanId?: string | null;
  fields?: Record<string, unknown>;
}

export interface RuntimeProtocolProfilerChannelSummary {
  channel: RuntimeProtocolChannel;
  eventCount: number;
  spanCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
  averageDurationMs: number;
  protocolOps: Record<string, number>;
}

export interface RuntimeProtocolProfilerSummary {
  totalEvents: number;
  totalSpans: number;
  channels: Record<RuntimeProtocolChannel, RuntimeProtocolProfilerChannelSummary>;
}

function createEmptyChannelSummary(
  channel: RuntimeProtocolChannel
): RuntimeProtocolProfilerChannelSummary {
  return {
    channel,
    eventCount: 0,
    spanCount: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    averageDurationMs: 0,
    protocolOps: {},
  };
}

function asChannel(value: unknown): RuntimeProtocolChannel | null {
  return value === 'control' || value === 'data' || value === 'trace' ? value : null;
}

function asDuration(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function asProtocolOp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function summarizeRuntimeProtocolRecords(
  records: RuntimeProtocolProfilerRecord[]
): RuntimeProtocolProfilerSummary {
  const channels: Record<RuntimeProtocolChannel, RuntimeProtocolProfilerChannelSummary> = {
    control: createEmptyChannelSummary('control'),
    data: createEmptyChannelSummary('data'),
    trace: createEmptyChannelSummary('trace'),
  };

  let totalEvents = 0;
  let totalSpans = 0;

  for (const record of records) {
    const channel = asChannel(record.fields?.channel);
    if (!channel) {
      continue;
    }

    const summary = channels[channel];
    summary.eventCount += 1;
    totalEvents += 1;

    const durationMs = asDuration(record.fields?.durationMs);
    if (durationMs !== null) {
      summary.spanCount += 1;
      summary.totalDurationMs += durationMs;
      summary.maxDurationMs = Math.max(summary.maxDurationMs, durationMs);
      totalSpans += 1;
    }

    const protocolOp = asProtocolOp(record.fields?.protocolOp);
    if (protocolOp) {
      summary.protocolOps[protocolOp] = (summary.protocolOps[protocolOp] ?? 0) + 1;
    }
  }

  for (const channel of Object.keys(channels) as RuntimeProtocolChannel[]) {
    const summary = channels[channel];
    summary.averageDurationMs =
      summary.spanCount > 0 ? summary.totalDurationMs / summary.spanCount : 0;
  }

  return {
    totalEvents,
    totalSpans,
    channels,
  };
}
