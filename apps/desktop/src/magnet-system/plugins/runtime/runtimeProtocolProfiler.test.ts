import { describe, expect, it } from 'vitest';
import { summarizeRuntimeProtocolRecords } from './runtimeProtocolProfiler';

describe('runtimeProtocolProfiler', () => {
  it('summarizes protocol records by channel, span duration, and operation count', () => {
    const summary = summarizeRuntimeProtocolRecords([
      {
        event: 'plugin.runtime.control.health.requested',
        traceId: 'trace-1',
        fields: {
          channel: 'control',
          protocolOp: 'runtime.health.request',
          durationMs: 12,
        },
      },
      {
        event: 'plugin.capability.data.stream-open.responded',
        traceId: 'trace-1',
        fields: {
          channel: 'data',
          protocolOp: 'stream.open.response',
          durationMs: 4,
        },
      },
      {
        event: 'plugin.capability.data.stream-data.sent',
        traceId: 'trace-1',
        fields: {
          channel: 'data',
          protocolOp: 'stream.data',
        },
      },
      {
        event: 'plugin.runtime.trace.snapshot.recorded',
        traceId: 'trace-1',
        fields: {
          channel: 'trace',
          protocolOp: 'runtime.trace.snapshot',
          durationMs: 2,
        },
      },
    ]);

    expect(summary.totalEvents).toBe(4);
    expect(summary.totalSpans).toBe(3);
    expect(summary.channels.control).toEqual({
      channel: 'control',
      eventCount: 1,
      spanCount: 1,
      totalDurationMs: 12,
      maxDurationMs: 12,
      averageDurationMs: 12,
      protocolOps: {
        'runtime.health.request': 1,
      },
    });
    expect(summary.channels.data).toEqual({
      channel: 'data',
      eventCount: 2,
      spanCount: 1,
      totalDurationMs: 4,
      maxDurationMs: 4,
      averageDurationMs: 4,
      protocolOps: {
        'stream.open.response': 1,
        'stream.data': 1,
      },
    });
    expect(summary.channels.trace).toEqual({
      channel: 'trace',
      eventCount: 1,
      spanCount: 1,
      totalDurationMs: 2,
      maxDurationMs: 2,
      averageDurationMs: 2,
      protocolOps: {
        'runtime.trace.snapshot': 1,
      },
    });
  });
});
