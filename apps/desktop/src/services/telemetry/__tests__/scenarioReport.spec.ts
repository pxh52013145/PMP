import { describe, expect, it } from 'vitest';
import type { TelemetryReadSessionResult } from '../../../contracts/telemetry';
import { buildTelemetryScenarioReport } from '../scenarioReport';

function makeSession(records: TelemetryReadSessionResult['records']): TelemetryReadSessionResult {
  return {
    status: {
      enabled: true,
      currentSessionId: 'session-1',
      queuedRecords: 0,
      flushedRecords: records.length,
      droppedRecords: 0,
      currentFileBytes: 1024,
      currentFilePath: 'd:/tmp/current-session.jsonl',
      frontendMinLevel: 'info',
      backendMinLevel: 'info',
      persistMinLevel: 'warn',
      lastError: null,
    },
    recordCount: records.length,
    records,
  };
}

describe('buildTelemetryScenarioReport', () => {
  it('renders stage markers in order for the target scenario', () => {
    const report = buildTelemetryScenarioReport({
      session: makeSession([
        {
          ts: 100,
          level: 'info',
          kind: 'log',
          side: 'frontend',
          moduleId: 'startup',
          event: 'startup.root.rendered',
          sessionId: 'session-1',
        },
        {
          ts: 200,
          level: 'info',
          kind: 'snapshot',
          side: 'frontend',
          moduleId: 'playlists',
          event: 'playlists.selection.changed.snapshot',
          sessionId: 'session-1',
        },
        {
          ts: 300,
          level: 'info',
          kind: 'snapshot',
          side: 'frontend',
          moduleId: 'audio',
          event: 'audio.queue.add.playlist.snapshot',
          sessionId: 'session-1',
        },
        {
          ts: 500,
          level: 'info',
          kind: 'log',
          side: 'frontend',
          moduleId: 'audio',
          event: 'audio.track.switch.completed',
          sessionId: 'session-1',
        },
        {
          ts: 800,
          level: 'info',
          kind: 'log',
          side: 'frontend',
          moduleId: 'audio',
          event: 'audio.queue.clear',
          sessionId: 'session-1',
        },
      ]),
    });

    expect(report).toContain('# PMP Telemetry Scenario Report');
    expect(report).toContain('| 启动 | startup.root.rendered |');
    expect(report).toContain('| 打开歌单 | playlists.selection.changed.snapshot |');
    expect(report).toContain('| 加入队列 | audio.queue.add.playlist.snapshot |');
    expect(report).toContain('| 切歌 | audio.track.switch.completed |');
    expect(report).toContain('| 清空队列 | audio.queue.clear |');
    expect(report).toContain('## Scenario Snapshots');
    expect(report).toContain('playlists.selection.changed.snapshot');
  });

  it('keeps missing stages explicit when the session is incomplete', () => {
    const report = buildTelemetryScenarioReport({
      session: makeSession([
        {
          ts: 100,
          level: 'info',
          kind: 'log',
          side: 'frontend',
          moduleId: 'startup',
          event: 'startup.root.rendered',
          sessionId: 'session-1',
        },
      ]),
    });

    expect(report).toContain('| 打开歌单 | missing | missing |');
    expect(report).toContain('| 清空队列 | missing | missing |');
    expect(report).toContain('- no snapshot records');
  });
});
