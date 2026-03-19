import { describe, expect, it } from 'vitest';

import { buildTelemetryAiContextReport, getDefaultTelemetryAiQuery } from '../aiContextReport';

describe('aiContextReport', () => {
  it('builds a bounded markdown report for AI consumption', () => {
    const query = getDefaultTelemetryAiQuery();
    const report = buildTelemetryAiContextReport({
      query,
      result: {
        status: {
          enabled: true,
          currentSessionId: 'session-1',
          queuedRecords: 0,
          flushedRecords: 20,
          droppedRecords: 0,
          currentFileBytes: 1024,
          currentFilePath: 'debug/telemetry/current-session.jsonl',
          frontendMinLevel: 'info',
          backendMinLevel: 'info',
          persistMinLevel: 'warn',
          lastError: null,
        },
        scannedRecordCount: 20,
        matchedRecordCount: 2,
        firstMatchedTs: 1000,
        lastMatchedTs: 2000,
        records: [
          {
            ts: 1000,
            level: 'info',
            kind: 'log',
            side: 'frontend',
            moduleId: 'playlists',
            event: 'playlists.overlay.opened',
            sessionId: 'session-1',
            component: 'Playlists',
            message: null,
            traceId: null,
            spanId: null,
            windowId: null,
            fields: {
              playlistId: 'recent',
            },
          },
          {
            ts: 2000,
            level: 'warn',
            kind: 'snapshot',
            side: 'frontend',
            moduleId: 'audio',
            event: 'audio.track.switch.failed',
            sessionId: 'session-1',
            component: 'NativeAudioService',
            message: 'load failed',
            traceId: null,
            spanId: null,
            windowId: null,
            fields: {
              queueLength: 208,
            },
          },
        ],
        moduleCounts: [
          { key: 'audio', count: 1 },
          { key: 'playlists', count: 1 },
        ],
        levelCounts: [
          { key: 'info', count: 1 },
          { key: 'warn', count: 1 },
        ],
        eventCounts: [
          { key: 'audio.track.switch.failed', count: 1 },
          { key: 'playlists.overlay.opened', count: 1 },
        ],
      },
      perfTotals: {
        timestampMs: 2500,
        sampleIntervalMs: null,
        cpuCount: 8,
        rootPid: 1234,
        systemMemory: null,
        totals: {
          workingSetBytes: 300 * 1024 * 1024,
          privateBytes: 400 * 1024 * 1024,
          cpuPercent: null,
          appWorkingSetBytes: 0,
          appPrivateBytes: 0,
          appCpuPercent: null,
          webview2PrivateBytes: 220 * 1024 * 1024,
          webview2WorkingSetBytes: 180 * 1024 * 1024,
          webview2CpuPercent: 12.5,
          otherWorkingSetBytes: 0,
          otherPrivateBytes: 0,
          otherCpuPercent: null,
        },
      },
    });

    expect(report).toContain('# PMP Telemetry AI Context');
    expect(report).toContain('session_id: session-1');
    expect(report).toContain('matched_record_count: 2');
    expect(report).toContain('audio.track.switch.failed');
    expect(report).toContain('playlistId=recent');
    expect(report).toContain('queueLength=208');
  });
});
