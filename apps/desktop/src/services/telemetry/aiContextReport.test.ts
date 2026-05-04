import { describe, expect, it } from 'vitest';
import type { TelemetryQueryResult, TelemetryStatus } from '../../contracts/telemetry';
import {
  buildTelemetryDiagnosticContextReport,
  getDefaultTelemetryDiagnosticQuery,
  getMagnetTelemetryDiagnosticQuery,
  getPerformanceTelemetryDiagnosticQuery,
  getPluginTelemetryDiagnosticQuery,
  getTelemetryDiagnosticContextPreset,
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

describe('telemetry diagnostic context report', () => {
  it('exposes focused presets for plugin and performance telemetry queries', () => {
    expect(getDefaultTelemetryDiagnosticQuery().moduleIds).toEqual(
      expect.arrayContaining(['plugins', 'performance', 'music-platform', 'magnet.platform'])
    );
    expect(getMagnetTelemetryDiagnosticQuery().moduleIds).toEqual(
      expect.arrayContaining(['magnet.platform', 'playlists', 'debug', 'vst'])
    );
    expect(getPluginTelemetryDiagnosticQuery().eventPrefixes).toEqual(['plugin.']);
    expect(getPerformanceTelemetryDiagnosticQuery().eventPrefixes).toEqual(['performance.']);
    expect(getTelemetryDiagnosticContextPreset('general').fileStem).toBe('diagnostic-context');
    expect(getTelemetryDiagnosticContextPreset('magnets').fileStem).toBe('magnet-context');
    expect(getTelemetryDiagnosticContextPreset('plugins').fileStem).toBe('plugin-context');
    expect(getTelemetryDiagnosticContextPreset('performance').fileStem).toBe('performance-context');
  });

  it('renders event prefix filters in the generated report', () => {
    const report = buildTelemetryDiagnosticContextReport({
      query: {
        eventPrefixes: ['plugin.'],
        levels: ['info'],
        limit: 10,
      },
      result: createQueryResult(),
    });

    expect(report).toContain('# PMP Telemetry Diagnostic Context');
    expect(report).toContain('- event_prefixes: plugin.');
    expect(report).toContain('plugin.governance.runtime-restart.requested');
  });
});
