import type {
  TelemetryQueryInput,
  TelemetryQueryResult,
  TelemetryRecord,
} from '../../contracts/telemetry';
import type { ProcessPerfTotalsSnapshot } from '../../modules/debug/processPerf';

const DEFAULT_AI_MODULE_IDS = [
  'startup',
  'navigation',
  'audio',
  'music-library',
  'playlists',
  'memory-governance',
  'windowing',
  'settings',
  'visualizer',
] as const;

const DEFAULT_AI_LEVELS = ['info', 'warn', 'error', 'fatal'] as const;
const DEFAULT_AI_LIMIT = 180;
const MAX_RECENT_RECORDS = 80;

function formatTimestamp(ts: number | null | undefined): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return 'n/a';
  return new Date(ts).toISOString();
}

function formatBytesToMb(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return (value / 1024 / 1024).toFixed(1);
}

function formatQueryList(value: readonly string[] | null | undefined): string {
  if (!Array.isArray(value) || value.length === 0) return 'all';
  return value.join(', ');
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

function summarizeRecord(record: TelemetryRecord): string {
  const fields = record.fields ? Object.entries(record.fields).slice(0, 6) : [];
  const fieldsText =
    fields.length > 0
      ? ` | ${fields.map(([key, value]) => `${key}=${formatFieldValue(value)}`).join(', ')}`
      : '';
  return `${formatTimestamp(record.ts)} | ${record.level} | ${record.moduleId} | ${record.event}${
    record.component ? ` | ${record.component}` : ''
  }${record.message ? ` | ${record.message}` : ''}${fieldsText}`;
}

function renderPerfTotals(perfTotals: ProcessPerfTotalsSnapshot | null | undefined): string[] {
  if (!perfTotals) {
    return ['- unavailable'];
  }

  return [
    `- captured_at: ${formatTimestamp(perfTotals.timestampMs)}`,
    `- webview2_private_mb: ${formatBytesToMb(perfTotals.totals.webview2PrivateBytes)}`,
    `- webview2_working_set_mb: ${formatBytesToMb(perfTotals.totals.webview2WorkingSetBytes)}`,
    `- tree_private_mb: ${formatBytesToMb(perfTotals.totals.privateBytes)}`,
    `- tree_working_set_mb: ${formatBytesToMb(perfTotals.totals.workingSetBytes)}`,
    `- webview2_cpu_percent: ${
      typeof perfTotals.totals.webview2CpuPercent === 'number'
        ? perfTotals.totals.webview2CpuPercent.toFixed(1)
        : 'n/a'
    }`,
  ];
}

export function getDefaultTelemetryAiQuery(): TelemetryQueryInput {
  return {
    moduleIds: [...DEFAULT_AI_MODULE_IDS],
    levels: [...DEFAULT_AI_LEVELS],
    limit: DEFAULT_AI_LIMIT,
  };
}

export function buildTelemetryAiContextReport(input: {
  query: TelemetryQueryInput;
  result: TelemetryQueryResult;
  perfTotals?: ProcessPerfTotalsSnapshot | null;
}): string {
  const recentRecords =
    input.result.records.length <= MAX_RECENT_RECORDS
      ? input.result.records
      : input.result.records.slice(input.result.records.length - MAX_RECENT_RECORDS);

  const lines: string[] = [
    '# PMP Telemetry AI Context',
    '',
    '## Session',
    '',
    `- session_id: ${input.result.status.currentSessionId}`,
    `- scanned_record_count: ${input.result.scannedRecordCount}`,
    `- matched_record_count: ${input.result.matchedRecordCount}`,
    `- first_matched_at: ${formatTimestamp(input.result.firstMatchedTs)}`,
    `- last_matched_at: ${formatTimestamp(input.result.lastMatchedTs)}`,
    `- current_file_path: ${input.result.status.currentFilePath ?? 'n/a'}`,
    `- current_file_mb: ${formatBytesToMb(input.result.status.currentFileBytes)}`,
    '',
    '## Query',
    '',
    `- modules: ${formatQueryList(input.query.moduleIds ?? null)}`,
    `- levels: ${formatQueryList(input.query.levels ?? null)}`,
    `- kinds: ${formatQueryList(input.query.kinds ?? null)}`,
    `- search_text: ${input.query.searchText?.trim() || 'none'}`,
    `- from_ts: ${formatTimestamp(input.query.fromTs ?? null)}`,
    `- to_ts: ${formatTimestamp(input.query.toTs ?? null)}`,
    `- limit: ${typeof input.query.limit === 'number' ? input.query.limit : DEFAULT_AI_LIMIT}`,
    '',
    '## Process Snapshot',
    '',
    ...renderPerfTotals(input.perfTotals),
    '',
    '## Top Modules',
    '',
    ...(input.result.moduleCounts.length > 0
      ? input.result.moduleCounts.map((item) => `- ${item.key}: ${item.count}`)
      : ['- unavailable']),
    '',
    '## Top Levels',
    '',
    ...(input.result.levelCounts.length > 0
      ? input.result.levelCounts.map((item) => `- ${item.key}: ${item.count}`)
      : ['- unavailable']),
    '',
    '## Top Events',
    '',
    ...(input.result.eventCounts.length > 0
      ? input.result.eventCounts.map((item) => `- ${item.key}: ${item.count}`)
      : ['- unavailable']),
    '',
    '## Recent Matched Records',
    '',
    ...(recentRecords.length > 0
      ? recentRecords.map((record) => `- ${summarizeRecord(record)}`)
      : ['- unavailable']),
  ];

  return `${lines.join('\n')}\n`;
}
