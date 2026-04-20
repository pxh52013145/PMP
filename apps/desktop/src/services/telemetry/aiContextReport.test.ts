import { describe, expect, it } from 'vitest';
import type { TelemetryQueryResult, TelemetryStatus } from '../../contracts/telemetry';
import {
  buildTelemetryAiContextReport,
  getDefaultTelemetryAiQuery,
  getPerformanceTelemetryAiQuery,
  getPluginTelemetryAiQuery,
  getTelemetryAiContextPreset,
} from './aiContextReport';

function createStatus(): TelemetryStatus {
  return {
    enabled: true,
    currentSessionId: 'session-1',
    queuedRecords: 0,
    flushedRecords: 10,
    droppedRecords: 0,
    currentFileBytes: 1024,
    currentFilePath: 'debug/telemetry/current-session.jsonl',
    frontendMinLevel: 'info',
    backendMinLevel: 'info',
    persistMinLevel: 'warn',
    lastError: null,
  };
}

function createQueryResult(): TelemetryQueryResult {
  return {
    status: createStatus(),
    scannedRecordCount: 3,
    matchedRecordCount: 1,
    firstMatchedTs: 100,
    lastMatchedTs: 100,
    records: [
      {
        ts: 100,
        level: 'info',
        kind: 'log',
        side: 'frontend',
        moduleId: 'plugins',
        event: 'plugin.governance.runtime-restart.requested',
        sessionId: 'session-1',
        component: 'hostExtensionRuntimeSupervisor',
        message: null,
        traceId: null,
        spanId: null,
        windowId: null,
        fields: {
          pluginId: 'demo.plugin',
          reason: 'manual',
        },
      },
    ],
    moduleCounts: [{ key: 'plugins', count: 1 }],
    levelCounts: [{ key: 'info', count: 1 }],
    eventCounts: [{ key: 'plugin.governance.runtime-restart.requested', count: 1 }],
  };
}

describe('aiContextReport', () => {
  it('exposes focused presets for plugin and performance telemetry queries', () => {
    expect(getDefaultTelemetryAiQuery().moduleIds).toEqual(
      expect.arrayContaining(['plugins', 'performance', 'music-platform', 'magnet.platform'])
    );
    expect(getPluginTelemetryAiQuery().eventPrefixes).toEqual(['plugin.']);
    expect(getPerformanceTelemetryAiQuery().eventPrefixes).toEqual(['performance.']);
    expect(getTelemetryAiContextPreset('plugins').fileStem).toBe('plugin-context');
    expect(getTelemetryAiContextPreset('performance').fileStem).toBe('performance-context');
  });

  it('renders event prefix filters in the generated report', () => {
    const report = buildTelemetryAiContextReport({
      query: {
        eventPrefixes: ['plugin.'],
        levels: ['info'],
        limit: 10,
      },
      result: createQueryResult(),
    });

    expect(report).toContain('- event_prefixes: plugin.');
    expect(report).toContain('plugin.governance.runtime-restart.requested');
  });
});
