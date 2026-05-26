import type { TelemetryReadSessionResult, TelemetryRecord } from '../../contracts/telemetry';
import type { ProcessPerfTotalsSnapshot } from '../../modules/debug/processPerf';

type ScenarioStageId = 'startup' | 'open-playlist' | 'queue-add' | 'track-switch' | 'queue-clear';

type ScenarioStageDefinition = {
  id: ScenarioStageId;
  label: string;
  eventMatchers: readonly string[];
  fallbackToFirstRecord?: boolean;
};

type ScenarioStageMarker = {
  id: ScenarioStageId;
  label: string;
  record: TelemetryRecord | null;
  index: number | null;
  sincePreviousMs: number | null;
  sinceStartupMs: number | null;
};

const MAX_TIMELINE_RECORDS = 240;
const MAX_SNAPSHOT_RECORDS = 24;

const RELEVANT_MODULE_IDS = new Set([
  'startup',
  'kernel',
  'lifecycle',
  'navigation',
  'playlists',
  'music-library',
  'audio',
  'windowing',
  'settings',
  'visualizer',
  'storage',
  'memory-governance',
]);

const STAGE_DEFINITIONS: readonly ScenarioStageDefinition[] = [
  {
    id: 'startup',
    label: '启动',
    eventMatchers: [
      'startup.bootstrap.begin',
      'startup.root.resolved',
      'startup.root.rendered',
      'kernel.runtime.created',
      'kernel.modules.activated',
    ],
    fallbackToFirstRecord: true,
  },
  {
    id: 'open-playlist',
    label: '打开歌单',
    eventMatchers: [
      'playlists.overlay.opened',
      'playlists.overlay.opened.snapshot',
      'playlists.selection.changed',
      'playlists.selection.changed.snapshot',
      'playlists.hydrate.start',
      'audio.playlist.hydrate.start',
      'audio.playlist.hydrate.completed',
    ],
  },
  {
    id: 'queue-add',
    label: '加入队列',
    eventMatchers: [
      'playlists.playlist.add-to-queue',
      'playlists.playlist.add-to-queue.snapshot',
      'audio.queue.add.playlist',
      'audio.queue.add.playlist.snapshot',
      'audio.queue.add',
      'audio.queue.add.snapshot',
      'audio.queue.sync.flush',
    ],
  },
  {
    id: 'track-switch',
    label: '切歌',
    eventMatchers: [
      'playlists.track.play.start',
      'music-library.play-track',
      'audio.track.switch.start',
      'audio.track.switch.completed',
      'audio.track.switch.completed.snapshot',
    ],
  },
  {
    id: 'queue-clear',
    label: '清空队列',
    eventMatchers: ['audio.queue.clear', 'audio.queue.clear.snapshot'],
  },
] as const;

function formatBytesToMb(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return (value / 1024 / 1024).toFixed(1);
}

function formatTimestamp(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return 'n/a';
  return new Date(ts).toISOString();
}

function matchesStageEvent(record: TelemetryRecord, matchers: readonly string[]): boolean {
  return matchers.includes(record.event);
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return `[${value.slice(0, 4).map(formatFieldValue).join(', ')}${value.length > 4 ? ', ...' : ''}]`;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function summarizeRecordFields(record: TelemetryRecord): string {
  const fields = record.fields ? Object.entries(record.fields).slice(0, 4) : [];
  if (fields.length === 0) return '';
  return fields.map(([key, value]) => `${key}=${formatFieldValue(value)}`).join(', ');
}

function buildScenarioStageMarkers(records: TelemetryRecord[]): ScenarioStageMarker[] {
  const markers: ScenarioStageMarker[] = [];
  let searchStartIndex = 0;
  let startupTs: number | null = null;
  let previousTs: number | null = null;

  for (const definition of STAGE_DEFINITIONS) {
    let matchedIndex = -1;
    for (let index = searchStartIndex; index < records.length; index += 1) {
      if (matchesStageEvent(records[index] as TelemetryRecord, definition.eventMatchers)) {
        matchedIndex = index;
        break;
      }
    }

    if (matchedIndex < 0 && definition.fallbackToFirstRecord && records.length > 0) {
      matchedIndex = 0;
    }

    const record = matchedIndex >= 0 ? (records[matchedIndex] as TelemetryRecord) : null;
    const currentTs = record?.ts ?? null;

    if (definition.id === 'startup' && currentTs !== null) {
      startupTs = currentTs;
    }

    markers.push({
      id: definition.id,
      label: definition.label,
      record,
      index: matchedIndex >= 0 ? matchedIndex : null,
      sincePreviousMs:
        currentTs !== null && previousTs !== null ? Math.max(0, currentTs - previousTs) : null,
      sinceStartupMs:
        currentTs !== null && startupTs !== null ? Math.max(0, currentTs - startupTs) : null,
    });

    if (matchedIndex >= 0) {
      searchStartIndex = matchedIndex + 1;
      previousTs = currentTs;
    }
  }

  return markers;
}

function buildModuleCounts(records: TelemetryRecord[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const record of records) {
    counts.set(record.moduleId, (counts.get(record.moduleId) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1]);
}

function buildRelevantTimeline(records: TelemetryRecord[]): TelemetryRecord[] {
  const filtered = records.filter((record) => RELEVANT_MODULE_IDS.has(record.moduleId));
  if (filtered.length <= MAX_TIMELINE_RECORDS) return filtered;
  return filtered.slice(filtered.length - MAX_TIMELINE_RECORDS);
}

function buildScenarioSnapshots(records: TelemetryRecord[]): TelemetryRecord[] {
  return records.filter(
    (record) => RELEVANT_MODULE_IDS.has(record.moduleId) && record.kind === 'snapshot'
  );
}

function renderPerfSnapshot(perfTotals: ProcessPerfTotalsSnapshot | null | undefined): string[] {
  if (!perfTotals) {
    return ['- unavailable'];
  }

  return [
    `- captured_at: ${formatTimestamp(perfTotals.timestampMs)}`,
    `- webview2_memory_mb: ${formatBytesToMb(perfTotals.totals.webview2PrivateWorkingSetBytes)}`,
    `- webview2_private_mb: ${formatBytesToMb(perfTotals.totals.webview2PrivateBytes)}`,
    `- webview2_working_set_mb: ${formatBytesToMb(perfTotals.totals.webview2WorkingSetBytes)}`,
    `- tree_memory_mb: ${formatBytesToMb(perfTotals.totals.privateWorkingSetBytes)}`,
    `- tree_private_mb: ${formatBytesToMb(perfTotals.totals.privateBytes)}`,
    `- tree_working_set_mb: ${formatBytesToMb(perfTotals.totals.workingSetBytes)}`,
    `- webview2_cpu_percent: ${
      typeof perfTotals.totals.webview2CpuPercent === 'number'
        ? perfTotals.totals.webview2CpuPercent.toFixed(1)
        : 'n/a'
    }`,
  ];
}

export function buildTelemetryScenarioReport(input: {
  session: TelemetryReadSessionResult;
  perfTotals?: ProcessPerfTotalsSnapshot | null;
}): string {
  const records = input.session.records.slice().sort((left, right) => left.ts - right.ts);
  const relevantTimeline = buildRelevantTimeline(records);
  const scenarioSnapshots = buildScenarioSnapshots(records);
  const markers = buildScenarioStageMarkers(records);
  const moduleCounts = buildModuleCounts(relevantTimeline);
  const firstTs = records[0]?.ts ?? null;
  const lastTs = records[records.length - 1]?.ts ?? null;

  const lines: string[] = [
    '# PMP Telemetry Scenario Report',
    '',
    '## Session',
    '',
    `- session_id: ${input.session.status.currentSessionId}`,
    `- record_count: ${input.session.recordCount}`,
    `- first_record_at: ${formatTimestamp(firstTs ?? 0)}`,
    `- last_record_at: ${formatTimestamp(lastTs ?? 0)}`,
    `- current_file_path: ${input.session.status.currentFilePath ?? 'n/a'}`,
    `- current_file_mb: ${formatBytesToMb(input.session.status.currentFileBytes)}`,
    `- flushed_records: ${input.session.status.flushedRecords}`,
    `- dropped_records: ${input.session.status.droppedRecords}`,
    '',
    '## Stage Markers',
    '',
    '| stage | event | at | since_previous_ms | since_startup_ms |',
    '| --- | --- | --- | ---: | ---: |',
    ...markers.map((marker) =>
      `| ${marker.label} | ${marker.record?.event ?? 'missing'} | ${
        marker.record ? formatTimestamp(marker.record.ts) : 'missing'
      } | ${marker.sincePreviousMs ?? 'n/a'} | ${marker.sinceStartupMs ?? 'n/a'} |`
    ),
    '',
    '## Export-Time Process Snapshot',
    '',
    ...renderPerfSnapshot(input.perfTotals),
    '',
    '## Relevant Module Counts',
    '',
    ...(moduleCounts.length > 0
      ? moduleCounts.slice(0, 12).map(([moduleId, count]) => `- ${moduleId}: ${count}`)
      : ['- unavailable']),
    '',
    '## Scenario Snapshots',
    '',
    ...(scenarioSnapshots.length > 0
      ? scenarioSnapshots.slice(-MAX_SNAPSHOT_RECORDS).map((record) => {
          const fieldSummary = summarizeRecordFields(record);
          const message = record.message?.trim() ? ` | ${record.message.trim()}` : '';
          const fields = fieldSummary ? ` | ${fieldSummary}` : '';
          return `- ${formatTimestamp(record.ts)} | ${record.moduleId} | ${record.event}${message}${fields}`;
        })
      : ['- no snapshot records']),
    '',
    '## Timeline',
    '',
    ...(relevantTimeline.length > 0
      ? relevantTimeline.map((record) => {
          const fieldSummary = summarizeRecordFields(record);
          const message = record.message?.trim() ? ` | ${record.message.trim()}` : '';
          const fields = fieldSummary ? ` | ${fieldSummary}` : '';
          return `- ${formatTimestamp(record.ts)} | ${record.level.toUpperCase()} | ${record.moduleId} | ${record.event}${message}${fields}`;
        })
      : ['- no relevant telemetry records']),
    '',
  ];

  return lines.join('\n');
}
