import type {
  TelemetryFields,
  TelemetryKind,
  TelemetryLevel,
  TelemetryPolicy,
  TelemetryRecord,
  TelemetrySide,
  TelemetryStatus,
} from '../../contracts/telemetry';

export type TelemetryRecordInput = {
  level: TelemetryLevel;
  event: string;
  kind?: TelemetryKind;
  side?: TelemetrySide;
  ts?: number;
  sessionId?: string | null;
  component?: string | null;
  message?: string | null;
  traceId?: string | null;
  spanId?: string | null;
  windowId?: string | null;
  fields?: TelemetryFields | null;
};

export type TelemetryLogOptions = Omit<
  TelemetryRecordInput,
  'event' | 'level' | 'sessionId' | 'side' | 'ts'
>;

export type TelemetryMetricOptions = Omit<TelemetryLogOptions, 'kind'> & {
  level?: TelemetryLevel;
};

export type TelemetrySpanStartOptions = TelemetryLogOptions & {
  level?: TelemetryLevel;
};

export type TelemetrySpanEndOptions = Omit<TelemetryLogOptions, 'kind' | 'traceId'> & {
  event?: string;
  level?: TelemetryLevel;
};

export type TelemetrySnapshot = {
  policy: TelemetryPolicy;
  status: TelemetryStatus;
  tail: TelemetryRecord[];
  bufferedRecords: number;
  queueDroppedRecords: number;
  tailDroppedRecords: number;
  transportAvailable: boolean;
  bootstrapState: 'idle' | 'loading' | 'ready';
  lastFlushAtMs: number | null;
  lastBootstrapAtMs: number | null;
};

export type TelemetryListener = (snapshot: TelemetrySnapshot) => void;

export interface TelemetrySpan {
  end(options?: TelemetrySpanEndOptions): void;
}

export interface TelemetryLogger {
  log(level: TelemetryLevel, event: string, options?: TelemetryLogOptions): void;
  trace(event: string, options?: TelemetryLogOptions): void;
  debug(event: string, options?: TelemetryLogOptions): void;
  info(event: string, options?: TelemetryLogOptions): void;
  warn(event: string, options?: TelemetryLogOptions): void;
  error(event: string, options?: TelemetryLogOptions): void;
  fatal(event: string, options?: TelemetryLogOptions): void;
  metric(event: string, fields?: TelemetryFields | null, options?: TelemetryMetricOptions): void;
  startSpan(event: string, options?: TelemetrySpanStartOptions): TelemetrySpan;
}

export interface TelemetryService {
  getSnapshot(): TelemetrySnapshot;
  subscribe(listener: TelemetryListener): () => void;
  refreshRuntime(): Promise<TelemetrySnapshot>;
  clearSession(): Promise<void>;
  flushNow(): Promise<void>;
  getLogger(moduleId: string, component?: string | null): TelemetryLogger;
  ingest(moduleId: string, record: TelemetryRecordInput, component?: string | null): void;
  destroy(): void;
}
