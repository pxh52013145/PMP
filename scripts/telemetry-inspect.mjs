#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const LEVEL_ORDER = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const DEFAULT_LEVELS = ['info', 'warn', 'error', 'fatal'];
const VERBOSE_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'];
const DEFAULT_LIMIT = 80;

const GENERAL_MODULE_IDS = [
  'startup',
  'navigation',
  'audio',
  'debug',
  'music-library',
  'music-platform',
  'magnet.platform',
  'playlists',
  'plugins',
  'extensions',
  'performance',
  'memory-governance',
  'windowing',
  'settings',
  'visualizer',
];

const MAGNET_MODULE_IDS = [
  'navigation',
  'magnet.platform',
  'music-platform',
  'performance',
  'memory-governance',
  'windowing',
  'audio',
  'playlists',
  'debug',
  'magnets',
  'vst',
  'visualizer',
];

const MAGNET_EVENT_PREFIXES = [
  'navigation.',
  'platform.',
  'music-platform.pack.',
  'music-platform.instance-auth.',
  'music-platform.facade.',
  'music-platform.sidecar.',
  'performance.',
  'memory-governance.',
  'background.gc.',
  'desktop-lyrics.',
  'play_queue.',
  'playlists.',
  'debug_button.',
  'layout.',
  'space.',
  'vst.',
  'visualizer.',
];

const PRESETS = {
  general: {
    moduleIds: GENERAL_MODULE_IDS,
    levels: DEFAULT_LEVELS,
    limit: 180,
  },
  magnets: {
    moduleIds: MAGNET_MODULE_IDS,
    eventPrefixes: MAGNET_EVENT_PREFIXES,
    levels: VERBOSE_LEVELS,
    limit: 220,
  },
  plugins: {
    eventPrefixes: ['plugin.'],
    levels: DEFAULT_LEVELS,
    limit: 180,
  },
  performance: {
    eventPrefixes: ['performance.'],
    levels: VERBOSE_LEVELS,
    limit: 180,
  },
};

function printHelp() {
  console.log(`Usage: node scripts/telemetry-inspect.mjs [options]

Options:
  --file <path>             Telemetry JSONL file. Defaults to common PMP app-data paths.
  --preset <name>           general, magnets, plugins, or performance. Default: general.
  --module <ids>            Comma-separated module ids. Overrides preset modules.
  --event-prefix <values>   Comma-separated event prefixes. Overrides preset prefixes.
  --level <levels>          Comma-separated levels, or min:<level>.
  --kind <kinds>            Comma-separated kinds.
  --search <text>           Case-insensitive text search across module/event/message/fields.
  --since-minutes <number>  Only include records newer than now minus this many minutes.
  --limit <number>          Recent matched records to show. Default: preset limit or 80.
  --format <text|json>      Output format. Default: text.
  --help                    Show this help.

Examples:
  node scripts/telemetry-inspect.mjs --preset plugins
  node scripts/telemetry-inspect.mjs --level warn,error,fatal --limit 40
  node scripts/telemetry-inspect.mjs --module music-platform --search netease
`);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const eqIndex = arg.indexOf('=');
    const key = eqIndex >= 0 ? arg.slice(2, eqIndex) : arg.slice(2);
    const value = eqIndex >= 0 ? arg.slice(eqIndex + 1) : argv[index + 1];

    if (key === 'help') {
      options.help = true;
      continue;
    }

    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    index += eqIndex >= 0 ? 0 : 1;
    options[key] = value;
  }
  return options;
}

function parseList(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseLimit(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid --limit value: ${value}`);
  }
  return Math.floor(parsed);
}

function parseSinceMinutes(value) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --since-minutes value: ${value}`);
  }
  return Date.now() - parsed * 60_000;
}

function expandLevels(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (trimmed.startsWith('min:')) {
    const minLevel = trimmed.slice(4);
    const minOrder = LEVEL_ORDER[minLevel];
    if (typeof minOrder !== 'number') {
      throw new Error(`Invalid telemetry level: ${minLevel}`);
    }
    return Object.entries(LEVEL_ORDER)
      .filter(([, order]) => order >= minOrder)
      .map(([level]) => level);
  }
  const levels = parseList(trimmed) ?? [];
  for (const level of levels) {
    if (typeof LEVEL_ORDER[level] !== 'number') {
      throw new Error(`Invalid telemetry level: ${level}`);
    }
  }
  return levels.length > 0 ? levels : fallback;
}

function getDefaultTelemetryPathCandidates() {
  const candidates = [];
  const appData = process.env.APPDATA;
  const localAppData = process.env.LOCALAPPDATA;
  const home = os.homedir();
  const tails = ['debug', 'telemetry', 'current-session.jsonl'];

  if (process.env.PMP_TELEMETRY_FILE) {
    candidates.push(process.env.PMP_TELEMETRY_FILE);
  }
  if (appData) {
    candidates.push(path.join(appData, 'com.pixelmatrix.player', ...tails));
    candidates.push(path.join(appData, 'Pixel Matrix Player', ...tails));
  }
  if (localAppData) {
    candidates.push(path.join(localAppData, 'com.pixelmatrix.player', ...tails));
    candidates.push(path.join(localAppData, 'Pixel Matrix Player', ...tails));
  }
  if (home) {
    candidates.push(path.join(home, 'AppData', 'Roaming', 'com.pixelmatrix.player', ...tails));
    candidates.push(path.join(home, 'AppData', 'Roaming', 'Pixel Matrix Player', ...tails));
  }

  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveTelemetryFile(explicitFile) {
  if (explicitFile) {
    return path.resolve(explicitFile);
  }

  const candidates = getDefaultTelemetryPathCandidates();
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  const message = [
    'Telemetry session file not found. Pass --file <path> or set PMP_TELEMETRY_FILE.',
    '',
    'Checked:',
    ...candidates.map((candidate) => `- ${candidate}`),
  ].join('\n');
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRecord(value) {
  if (!isRecord(value)) return null;
  const moduleId = typeof value.moduleId === 'string' ? value.moduleId.trim() : '';
  const event = typeof value.event === 'string' ? value.event.trim() : '';
  const sessionId = typeof value.sessionId === 'string' ? value.sessionId.trim() : '';
  if (!moduleId || !event || !sessionId) return null;

  return {
    ts: typeof value.ts === 'number' && Number.isFinite(value.ts) ? value.ts : 0,
    level: typeof LEVEL_ORDER[value.level] === 'number' ? value.level : 'info',
    kind: typeof value.kind === 'string' ? value.kind : 'log',
    side: value.side === 'backend' ? 'backend' : 'frontend',
    moduleId,
    event,
    sessionId,
    component: typeof value.component === 'string' ? value.component : null,
    message: typeof value.message === 'string' ? value.message : null,
    traceId: typeof value.traceId === 'string' ? value.traceId : null,
    spanId: typeof value.spanId === 'string' ? value.spanId : null,
    windowId: typeof value.windowId === 'string' ? value.windowId : null,
    fields: isRecord(value.fields) ? value.fields : null,
  };
}

async function readJsonlRecords(filePath) {
  const content = await readFile(filePath, 'utf8');
  const records = [];
  let invalidLineCount = 0;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = normalizeRecord(JSON.parse(trimmed));
      if (record) {
        records.push(record);
      } else {
        invalidLineCount += 1;
      }
    } catch {
      invalidLineCount += 1;
    }
  }

  return { records, invalidLineCount };
}

function stringifyFields(fields) {
  if (!fields) return '';
  try {
    return JSON.stringify(fields);
  } catch {
    return String(fields);
  }
}

function buildSearchText(record) {
  return [
    record.side,
    record.level,
    record.kind,
    record.moduleId,
    record.event,
    record.component,
    record.message,
    stringifyFields(record.fields),
  ]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .join(' | ')
    .toLowerCase();
}

function matchesQuery(record, query) {
  if (query.fromTs !== undefined && record.ts < query.fromTs) return false;
  if (query.toTs !== undefined && record.ts > query.toTs) return false;
  if (query.moduleIds?.length > 0 && !query.moduleIds.includes(record.moduleId)) return false;
  if (
    query.eventPrefixes?.length > 0 &&
    !query.eventPrefixes.some((prefix) => record.event.startsWith(prefix))
  ) {
    return false;
  }
  if (query.levels?.length > 0 && !query.levels.includes(record.level)) return false;
  if (query.kinds?.length > 0 && !query.kinds.includes(record.kind)) return false;
  if (query.searchText && !buildSearchText(record).includes(query.searchText.toLowerCase())) {
    return false;
  }
  return true;
}

function countBy(records, selector) {
  const counts = new Map();
  for (const record of records) {
    const key = selector(record);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function formatTimestamp(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return 'n/a';
  return new Date(ts).toISOString();
}

function formatList(values) {
  return values?.length > 0 ? values.join(', ') : 'all';
}

function formatFieldValue(value) {
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

function summarizeRecord(record) {
  const fields = record.fields ? Object.entries(record.fields).slice(0, 5) : [];
  const fieldsText =
    fields.length > 0
      ? ` | ${fields.map(([key, value]) => `${key}=${formatFieldValue(value)}`).join(', ')}`
      : '';
  return `${formatTimestamp(record.ts)} | ${record.level} | ${record.side} | ${record.moduleId} | ${record.event}${
    record.component ? ` | ${record.component}` : ''
  }${record.message ? ` | ${record.message}` : ''}${fieldsText}`;
}

function buildQuery(options) {
  const presetName = options.preset ?? 'general';
  const preset = PRESETS[presetName];
  if (!preset) {
    throw new Error(`Unknown preset "${presetName}". Expected: ${Object.keys(PRESETS).join(', ')}`);
  }

  return {
    preset: presetName,
    moduleIds: parseList(options.module) ?? preset.moduleIds,
    eventPrefixes: parseList(options['event-prefix']) ?? preset.eventPrefixes,
    levels: expandLevels(options.level, preset.levels),
    kinds: parseList(options.kind),
    searchText: typeof options.search === 'string' ? options.search.trim() : undefined,
    fromTs: parseSinceMinutes(options['since-minutes']),
    limit: parseLimit(options.limit, preset.limit ?? DEFAULT_LIMIT),
  };
}

function buildResult(records, query, invalidLineCount, filePath) {
  const matched = records.filter((record) => matchesQuery(record, query));
  const limitedRecords = matched.slice(-query.limit);
  const firstMatchedTs = matched[0]?.ts ?? null;
  const lastMatchedTs = matched[matched.length - 1]?.ts ?? null;

  return {
    filePath,
    preset: query.preset,
    scannedRecordCount: records.length,
    invalidLineCount,
    matchedRecordCount: matched.length,
    returnedRecordCount: limitedRecords.length,
    firstMatchedTs,
    lastMatchedTs,
    query: {
      moduleIds: query.moduleIds ?? null,
      eventPrefixes: query.eventPrefixes ?? null,
      levels: query.levels ?? null,
      kinds: query.kinds ?? null,
      searchText: query.searchText ?? null,
      fromTs: query.fromTs ?? null,
      limit: query.limit,
    },
    moduleCounts: countBy(matched, (record) => record.moduleId).slice(0, 12),
    levelCounts: countBy(matched, (record) => record.level),
    eventCounts: countBy(matched, (record) => record.event).slice(0, 16),
    records: limitedRecords,
  };
}

function renderBuckets(title, buckets) {
  if (buckets.length === 0) {
    return [`${title}:`, '- none'];
  }
  return [`${title}:`, ...buckets.map((bucket) => `- ${bucket.key}: ${bucket.count}`)];
}

function renderText(result) {
  const lines = [
    'PMP Telemetry Inspection',
    '',
    `file: ${result.filePath}`,
    `preset: ${result.preset}`,
    `scanned: ${result.scannedRecordCount}`,
    `invalid_lines: ${result.invalidLineCount}`,
    `matched: ${result.matchedRecordCount}`,
    `returned: ${result.returnedRecordCount}`,
    `window: ${formatTimestamp(result.firstMatchedTs)} -> ${formatTimestamp(result.lastMatchedTs)}`,
    '',
    'Filters:',
    `- modules: ${formatList(result.query.moduleIds)}`,
    `- event_prefixes: ${formatList(result.query.eventPrefixes)}`,
    `- levels: ${formatList(result.query.levels)}`,
    `- kinds: ${formatList(result.query.kinds)}`,
    `- search_text: ${result.query.searchText || 'none'}`,
    `- from_ts: ${formatTimestamp(result.query.fromTs)}`,
    `- limit: ${result.query.limit}`,
    '',
    ...renderBuckets('Top Modules', result.moduleCounts),
    '',
    ...renderBuckets('Top Levels', result.levelCounts),
    '',
    ...renderBuckets('Top Events', result.eventCounts),
    '',
    'Recent Records (newest first):',
  ];

  if (result.records.length === 0) {
    lines.push('- none');
  } else {
    for (const record of result.records.slice().reverse()) {
      lines.push(`- ${summarizeRecord(record)}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const filePath = await resolveTelemetryFile(options.file);
  const query = buildQuery(options);
  const { records, invalidLineCount } = await readJsonlRecords(filePath);
  const result = buildResult(records, query, invalidLineCount, filePath);

  if ((options.format ?? 'text') === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (options.format && options.format !== 'text') {
    throw new Error(`Unknown --format value: ${options.format}`);
  }

  process.stdout.write(renderText(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
