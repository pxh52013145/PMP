export const TELEMETRY_LEVELS = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
] as const;

export const TELEMETRY_KINDS = [
  'log',
  'metric',
  'span-start',
  'span-end',
  'snapshot',
  'audit',
] as const;

export const TELEMETRY_SIDES = ['frontend', 'backend'] as const;

export type TelemetryLevel = (typeof TELEMETRY_LEVELS)[number];
export type TelemetryKind = (typeof TELEMETRY_KINDS)[number];
export type TelemetrySide = (typeof TELEMETRY_SIDES)[number];

export type TelemetryFields = Record<string, unknown>;

export type TelemetryModulePolicy = {
  enabled?: boolean;
  level?: TelemetryLevel;
  persist?: boolean;
  perf?: boolean;
  realtimeVerbose?: boolean;
};

export type TelemetryRetentionPolicy = {
  maxTotalBytes: number;
  errorDays: number;
  infoDays: number;
  debugCurrentSessionOnly: boolean;
};

export type TelemetryPolicy = {
  enabled: boolean;
  uiTailEnabled: boolean;
  frontendMinLevel: TelemetryLevel;
  backendMinLevel: TelemetryLevel;
  persistMinLevel: TelemetryLevel;
  batchFlushMs: number;
  batchMaxItems: number;
  perfSamplingMs: number;
  retention: TelemetryRetentionPolicy;
  modules: Record<string, TelemetryModulePolicy>;
};

export type TelemetryRecord = {
  ts: number;
  level: TelemetryLevel;
  kind: TelemetryKind;
  side: TelemetrySide;
  moduleId: string;
  event: string;
  sessionId: string;
  component?: string | null;
  message?: string | null;
  traceId?: string | null;
  spanId?: string | null;
  windowId?: string | null;
  fields?: TelemetryFields | null;
};

export type TelemetryStatus = {
  enabled: boolean;
  currentSessionId: string;
  queuedRecords: number;
  flushedRecords: number;
  droppedRecords: number;
  currentFileBytes: number;
  currentFilePath: string | null;
  frontendMinLevel: TelemetryLevel;
  backendMinLevel: TelemetryLevel;
  persistMinLevel: TelemetryLevel;
  lastError: string | null;
};

export type TelemetryIngestBatchResult = {
  acceptedCount: number;
  droppedCount: number;
  status: TelemetryStatus;
};

export type TelemetryClearSessionResult = {
  previousSessionId: string;
  status: TelemetryStatus;
};

export type TelemetryReadSessionResult = {
  status: TelemetryStatus;
  recordCount: number;
  records: TelemetryRecord[];
};

export type TelemetryQueryInput = {
  moduleIds?: string[] | null;
  eventPrefixes?: string[] | null;
  levels?: TelemetryLevel[] | null;
  kinds?: TelemetryKind[] | null;
  searchText?: string | null;
  fromTs?: number | null;
  toTs?: number | null;
  limit?: number | null;
};

export type TelemetryCountBucket = {
  key: string;
  count: number;
};

export type TelemetryQueryResult = {
  status: TelemetryStatus;
  scannedRecordCount: number;
  matchedRecordCount: number;
  firstMatchedTs: number | null;
  lastMatchedTs: number | null;
  records: TelemetryRecord[];
  moduleCounts: TelemetryCountBucket[];
  levelCounts: TelemetryCountBucket[];
  eventCounts: TelemetryCountBucket[];
};

export type TelemetryRecentRecordsResult = {
  status: TelemetryStatus;
  recordCount: number;
  records: TelemetryRecord[];
};

export type TelemetryExportBundle = {
  schemaVersion: 1;
  generatedAtMs: number;
  sessionId: string;
  status: TelemetryStatus;
  query: TelemetryQueryInput;
  queryResult: TelemetryQueryResult;
  debugConfig: unknown | null;
  envSnapshot: Record<string, string | null>;
  backendModules: unknown[];
  registeredCommands: string[];
  processPerfTotals: unknown | null;
  errors: string[];
};

const TELEMETRY_LEVEL_ORDER: Record<TelemetryLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export const DEFAULT_TELEMETRY_POLICY: TelemetryPolicy = {
  enabled: true,
  uiTailEnabled: true,
  frontendMinLevel: 'info',
  backendMinLevel: 'info',
  persistMinLevel: 'warn',
  batchFlushMs: 250,
  batchMaxItems: 64,
  perfSamplingMs: 1_000,
  retention: {
    maxTotalBytes: 150 * 1024 * 1024,
    errorDays: 14,
    infoDays: 3,
    debugCurrentSessionOnly: true,
  },
  modules: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function readTelemetryLevel(value: unknown, fallback: TelemetryLevel): TelemetryLevel {
  return typeof value === 'string' && TELEMETRY_LEVELS.includes(value as TelemetryLevel)
    ? (value as TelemetryLevel)
    : fallback;
}

function ensureTelemetryModulePolicy(value: unknown): TelemetryModulePolicy {
  const record = isRecord(value) ? value : null;
  const result: TelemetryModulePolicy = {};

  if (typeof record?.enabled === 'boolean') result.enabled = record.enabled;
  if (typeof record?.persist === 'boolean') result.persist = record.persist;
  if (typeof record?.perf === 'boolean') result.perf = record.perf;
  if (typeof record?.realtimeVerbose === 'boolean') result.realtimeVerbose = record.realtimeVerbose;
  if (typeof record?.level === 'string' && TELEMETRY_LEVELS.includes(record.level as TelemetryLevel)) {
    result.level = record.level as TelemetryLevel;
  }

  return result;
}

function ensureTelemetryRetentionPolicy(value: unknown): TelemetryRetentionPolicy {
  const record = isRecord(value) ? value : null;
  return {
    maxTotalBytes: readNumber(
      record?.maxTotalBytes,
      DEFAULT_TELEMETRY_POLICY.retention.maxTotalBytes,
      1 * 1024 * 1024,
      1024 * 1024 * 1024
    ),
    errorDays: readNumber(record?.errorDays, DEFAULT_TELEMETRY_POLICY.retention.errorDays, 1, 365),
    infoDays: readNumber(record?.infoDays, DEFAULT_TELEMETRY_POLICY.retention.infoDays, 1, 365),
    debugCurrentSessionOnly: readBoolean(
      record?.debugCurrentSessionOnly,
      DEFAULT_TELEMETRY_POLICY.retention.debugCurrentSessionOnly
    ),
  };
}

export function ensureTelemetryPolicy(value: unknown): TelemetryPolicy {
  const record = isRecord(value) ? value : null;
  const modulesRecord = isRecord(record?.modules) ? record.modules : null;
  const modules: Record<string, TelemetryModulePolicy> = {};

  if (modulesRecord) {
    for (const [moduleId, modulePolicy] of Object.entries(modulesRecord)) {
      const normalizedId = moduleId.trim();
      if (!normalizedId) continue;
      modules[normalizedId] = ensureTelemetryModulePolicy(modulePolicy);
    }
  }

  return {
    enabled: readBoolean(record?.enabled, DEFAULT_TELEMETRY_POLICY.enabled),
    uiTailEnabled: readBoolean(record?.uiTailEnabled, DEFAULT_TELEMETRY_POLICY.uiTailEnabled),
    frontendMinLevel: readTelemetryLevel(
      record?.frontendMinLevel,
      DEFAULT_TELEMETRY_POLICY.frontendMinLevel
    ),
    backendMinLevel: readTelemetryLevel(
      record?.backendMinLevel,
      DEFAULT_TELEMETRY_POLICY.backendMinLevel
    ),
    persistMinLevel: readTelemetryLevel(
      record?.persistMinLevel,
      DEFAULT_TELEMETRY_POLICY.persistMinLevel
    ),
    batchFlushMs: readNumber(record?.batchFlushMs, DEFAULT_TELEMETRY_POLICY.batchFlushMs, 25, 60_000),
    batchMaxItems: readNumber(record?.batchMaxItems, DEFAULT_TELEMETRY_POLICY.batchMaxItems, 1, 5_000),
    perfSamplingMs: readNumber(
      record?.perfSamplingMs,
      DEFAULT_TELEMETRY_POLICY.perfSamplingMs,
      100,
      60_000
    ),
    retention: ensureTelemetryRetentionPolicy(record?.retention),
    modules,
  };
}

export function compareTelemetryLevels(left: TelemetryLevel, right: TelemetryLevel): number {
  return TELEMETRY_LEVEL_ORDER[left] - TELEMETRY_LEVEL_ORDER[right];
}

export function isTelemetryLevelAtLeast(
  value: TelemetryLevel,
  minimum: TelemetryLevel
): boolean {
  return compareTelemetryLevels(value, minimum) >= 0;
}
