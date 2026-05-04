import { isTauriRuntime } from '../../utils/tauriRuntime';
import type {
  TelemetryClearSessionResult,
  TelemetryExportBundle,
  TelemetryIngestBatchResult,
  TelemetryQueryInput,
  TelemetryQueryResult,
  TelemetryReadSessionResult,
  TelemetryRecentRecordsResult,
  TelemetryRecord,
  TelemetryStatus,
} from '../../contracts/telemetry';
import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';

export type { TelemetryReadSessionResult } from '../../contracts/telemetry';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readTelemetryLevel(value: unknown): TelemetryRecord['level'] {
  return value === 'trace' ||
    value === 'debug' ||
    value === 'info' ||
    value === 'warn' ||
    value === 'error' ||
    value === 'fatal'
    ? value
    : 'info';
}

function readTelemetryKind(value: unknown): TelemetryRecord['kind'] {
  return value === 'log' ||
    value === 'metric' ||
    value === 'span-start' ||
    value === 'span-end' ||
    value === 'snapshot' ||
    value === 'audit'
    ? value
    : 'log';
}

function readTelemetrySide(value: unknown): TelemetryRecord['side'] {
  return value === 'frontend' || value === 'backend' ? value : 'frontend';
}

function ensureTelemetryFields(value: unknown): TelemetryRecord['fields'] {
  if (!isRecord(value)) return null;
  return { ...value };
}

function ensureTelemetryRecord(value: unknown): TelemetryRecord | null {
  const record = isRecord(value) ? value : null;
  if (!record) return null;

  const moduleId = typeof record.moduleId === 'string' ? record.moduleId.trim() : '';
  const event = typeof record.event === 'string' ? record.event.trim() : '';
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : '';
  if (!moduleId || !event || !sessionId) return null;

  return {
    ts: readNumber(record.ts, 0),
    level: readTelemetryLevel(record.level),
    kind: readTelemetryKind(record.kind),
    side: readTelemetrySide(record.side),
    moduleId,
    event,
    sessionId,
    component: readString(record.component),
    message: readString(record.message),
    traceId: readString(record.traceId),
    spanId: readString(record.spanId),
    windowId: readString(record.windowId),
    fields: ensureTelemetryFields(record.fields),
  };
}

function ensureTelemetryStatus(value: unknown): TelemetryStatus {
  const record = isRecord(value) ? value : null;
  return {
    enabled: typeof record?.enabled === 'boolean' ? record.enabled : false,
    currentSessionId: typeof record?.currentSessionId === 'string' ? record.currentSessionId : 'unknown',
    queuedRecords: readNumber(record?.queuedRecords, 0),
    flushedRecords: readNumber(record?.flushedRecords, 0),
    droppedRecords: readNumber(record?.droppedRecords, 0),
    currentFileBytes: readNumber(record?.currentFileBytes, 0),
    currentFilePath: readString(record?.currentFilePath),
    frontendMinLevel:
      record?.frontendMinLevel === 'trace' ||
      record?.frontendMinLevel === 'debug' ||
      record?.frontendMinLevel === 'info' ||
      record?.frontendMinLevel === 'warn' ||
      record?.frontendMinLevel === 'error' ||
      record?.frontendMinLevel === 'fatal'
        ? record.frontendMinLevel
        : 'info',
    backendMinLevel:
      record?.backendMinLevel === 'trace' ||
      record?.backendMinLevel === 'debug' ||
      record?.backendMinLevel === 'info' ||
      record?.backendMinLevel === 'warn' ||
      record?.backendMinLevel === 'error' ||
      record?.backendMinLevel === 'fatal'
        ? record.backendMinLevel
        : 'info',
    persistMinLevel:
      record?.persistMinLevel === 'trace' ||
      record?.persistMinLevel === 'debug' ||
      record?.persistMinLevel === 'info' ||
      record?.persistMinLevel === 'warn' ||
      record?.persistMinLevel === 'error' ||
      record?.persistMinLevel === 'fatal'
        ? record.persistMinLevel
        : 'warn',
    lastError: readString(record?.lastError),
  };
}

function ensureTelemetryIngestBatchResult(value: unknown): TelemetryIngestBatchResult {
  const record = isRecord(value) ? value : null;
  return {
    acceptedCount: readNumber(record?.acceptedCount, 0),
    droppedCount: readNumber(record?.droppedCount, 0),
    status: ensureTelemetryStatus(record?.status),
  };
}

function ensureTelemetryClearSessionResult(value: unknown): TelemetryClearSessionResult {
  const record = isRecord(value) ? value : null;
  return {
    previousSessionId:
      typeof record?.previousSessionId === 'string' ? record.previousSessionId : 'unknown',
    status: ensureTelemetryStatus(record?.status),
  };
}

function ensureTelemetryReadSessionResult(value: unknown): TelemetryReadSessionResult {
  const record = isRecord(value) ? value : null;
  const recordsRaw = Array.isArray(record?.records) ? record.records : [];
  const records: TelemetryRecord[] = [];
  for (const item of recordsRaw) {
    const parsed = ensureTelemetryRecord(item);
    if (!parsed) continue;
    records.push(parsed);
  }

  return {
    status: ensureTelemetryStatus(record?.status),
    recordCount: readNumber(record?.recordCount, records.length),
    records,
  };
}

function ensureTelemetryCountBuckets(value: unknown): TelemetryQueryResult['moduleCounts'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = isRecord(item) ? item : null;
      const key = typeof record?.key === 'string' ? record.key.trim() : '';
      if (!key) return null;
      return {
        key,
        count: readNumber(record?.count, 0),
      };
    })
    .filter((item): item is TelemetryQueryResult['moduleCounts'][number] => item !== null);
}

function ensureTelemetryQueryResult(value: unknown): TelemetryQueryResult {
  const record = isRecord(value) ? value : null;
  const recordsRaw = Array.isArray(record?.records) ? record.records : [];
  const records: TelemetryRecord[] = [];
  for (const item of recordsRaw) {
    const parsed = ensureTelemetryRecord(item);
    if (!parsed) continue;
    records.push(parsed);
  }

  return {
    status: ensureTelemetryStatus(record?.status),
    scannedRecordCount: readNumber(record?.scannedRecordCount, 0),
    matchedRecordCount: readNumber(record?.matchedRecordCount, records.length),
    firstMatchedTs:
      typeof record?.firstMatchedTs === 'number' && Number.isFinite(record.firstMatchedTs)
        ? record.firstMatchedTs
        : null,
    lastMatchedTs:
      typeof record?.lastMatchedTs === 'number' && Number.isFinite(record.lastMatchedTs)
        ? record.lastMatchedTs
        : null,
    records,
    moduleCounts: ensureTelemetryCountBuckets(record?.moduleCounts),
    levelCounts: ensureTelemetryCountBuckets(record?.levelCounts),
    eventCounts: ensureTelemetryCountBuckets(record?.eventCounts),
  };
}

function ensureTelemetryRecentRecordsResult(value: unknown): TelemetryRecentRecordsResult {
  const record = isRecord(value) ? value : null;
  const recordsRaw = Array.isArray(record?.records) ? record.records : [];
  const records: TelemetryRecord[] = [];
  for (const item of recordsRaw) {
    const parsed = ensureTelemetryRecord(item);
    if (!parsed) continue;
    records.push(parsed);
  }

  return {
    status: ensureTelemetryStatus(record?.status),
    recordCount: readNumber(record?.recordCount, records.length),
    records,
  };
}

function ensureTelemetryExportBundle(value: unknown): TelemetryExportBundle {
  const record = isRecord(value) ? value : null;
  const envSnapshot: Record<string, string | null> = {};
  if (isRecord(record?.envSnapshot)) {
    for (const [key, item] of Object.entries(record.envSnapshot)) {
      envSnapshot[key] = typeof item === 'string' ? item : null;
    }
  }

  const query = isRecord(record?.query) ? (record.query as TelemetryQueryInput) : {};
  const queryResult = ensureTelemetryQueryResult(record?.queryResult);

  return {
    schemaVersion: record?.schemaVersion === 1 ? 1 : 1,
    generatedAtMs: readNumber(record?.generatedAtMs, 0),
    sessionId:
      typeof record?.sessionId === 'string' && record.sessionId.trim().length > 0
        ? record.sessionId
        : queryResult.status.currentSessionId,
    status: ensureTelemetryStatus(record?.status ?? queryResult.status),
    query,
    queryResult,
    debugConfig: Object.prototype.hasOwnProperty.call(record ?? {}, 'debugConfig')
      ? record?.debugConfig ?? null
      : null,
    envSnapshot,
    backendModules: Array.isArray(record?.backendModules) ? record.backendModules : [],
    registeredCommands: Array.isArray(record?.registeredCommands)
      ? record.registeredCommands.filter((item): item is string => typeof item === 'string')
      : [],
    processPerfTotals: Object.prototype.hasOwnProperty.call(record ?? {}, 'processPerfTotals')
      ? record?.processPerfTotals ?? null
      : null,
    errors: Array.isArray(record?.errors)
      ? record.errors.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

export async function ingestTelemetryBatch(
  records: TelemetryRecord[]
): Promise<TelemetryIngestBatchResult | null> {
  if (!isTauriRuntime()) return null;
  if (records.length === 0) {
    return null;
  }
  const raw = await invokeWithTelemetry<unknown>('debug_telemetry_ingest_batch', { records }).catch(
    () => null
  );
  if (!raw) return null;
  return ensureTelemetryIngestBatchResult(raw);
}

export async function getTelemetryStatus(): Promise<TelemetryStatus | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invokeWithTelemetry<unknown>('debug_telemetry_get_status').catch(() => null);
  if (!raw) return null;
  return ensureTelemetryStatus(raw);
}

export async function clearTelemetrySession(): Promise<TelemetryClearSessionResult | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invokeWithTelemetry<unknown>('debug_telemetry_clear_session').catch(() => null);
  if (!raw) return null;
  return ensureTelemetryClearSessionResult(raw);
}

export async function readCurrentTelemetrySession(): Promise<TelemetryReadSessionResult | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invokeWithTelemetry<unknown>('debug_telemetry_read_current_session').catch(
    () => null
  );
  if (!raw) return null;
  return ensureTelemetryReadSessionResult(raw);
}

export async function getRecentTelemetryRecords(
  limit: number = 160
): Promise<TelemetryRecentRecordsResult | null> {
  if (!isTauriRuntime()) return null;
  const normalizedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const raw = await invokeWithTelemetry<unknown>('debug_telemetry_get_recent', {
    limit: normalizedLimit,
  }).catch(() => null);
  if (!raw) return null;
  return ensureTelemetryRecentRecordsResult(raw);
}

export async function queryTelemetryCurrentSession(
  query: TelemetryQueryInput = {}
): Promise<TelemetryQueryResult | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invokeWithTelemetry<unknown>('debug_telemetry_query', { query }).catch(
    () => null
  );
  if (!raw) return null;
  return ensureTelemetryQueryResult(raw);
}

export async function exportTelemetryBundle(
  query: TelemetryQueryInput = {}
): Promise<TelemetryExportBundle | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invokeWithTelemetry<unknown>('debug_telemetry_export_bundle', { query }).catch(
    () => null
  );
  if (!raw) return null;
  return ensureTelemetryExportBundle(raw);
}
