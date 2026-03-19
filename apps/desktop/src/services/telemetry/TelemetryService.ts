import { createServiceToken } from '../../kernel/tokens';
import {
  DEFAULT_TELEMETRY_POLICY,
  isTelemetryLevelAtLeast,
  type TelemetryFields,
  type TelemetryKind,
  type TelemetryLevel,
  type TelemetryPolicy,
  type TelemetryRecord,
  type TelemetryStatus,
} from '../../contracts/telemetry';
import {
  clearTelemetrySession,
  getDebugConfig,
  getTelemetryStatus,
  ingestTelemetryBatch,
  type DebugConfig,
} from '../../modules/debug';
import type {
  TelemetryListener,
  TelemetryLogOptions,
  TelemetryLogger,
  TelemetryRecordInput,
  TelemetryService,
  TelemetrySnapshot,
  TelemetrySpan,
  TelemetrySpanEndOptions,
  TelemetrySpanStartOptions,
} from './telemetryTypes';

const DEFAULT_UI_TAIL_CAPACITY = 2_000;
const DEFAULT_QUEUE_CAPACITY_MIN = 128;
const DEFAULT_QUEUE_CAPACITY_MAX = 2_048;
const DEFAULT_QUEUE_CAPACITY_MULTIPLIER = 8;

type TelemetryRuntimeDeps = {
  loadDebugConfig: () => Promise<DebugConfig>;
  loadStatus: () => Promise<TelemetryStatus | null>;
  ingestBatch: (records: TelemetryRecord[]) => Promise<{ status: TelemetryStatus } | null>;
  clearSession: () => Promise<{ status: TelemetryStatus } | null>;
  now: () => number;
};

export const TELEMETRY_SERVICE_TOKEN = createServiceToken<TelemetryService>('service.telemetry');

let globalTelemetryService: TelemetryService | null = null;
const globalLoggerCache = new Map<string, TelemetryLogger>();
const NOOP_SPAN: TelemetrySpan = {
  end() {
    // no-op
  },
};

function forwardToGlobalLogger(
  moduleId: string,
  component: string | null,
  callback: (logger: TelemetryLogger) => void
): void {
  const service = globalTelemetryService;
  if (!service) return;
  callback(service.getLogger(moduleId, component));
}

export function setGlobalTelemetryService(service: TelemetryService | null): void {
  globalTelemetryService = service;
}

export function getGlobalTelemetryService(): TelemetryService | null {
  return globalTelemetryService;
}

export function getTelemetryLogger(moduleId: string, component?: string | null): TelemetryLogger {
  const normalizedModuleId = normalizeModuleId(moduleId);
  const normalizedComponent = normalizeComponent(component);
  const cacheKey = `${normalizedModuleId}::${normalizedComponent ?? ''}`;
  const cached = globalLoggerCache.get(cacheKey);
  if (cached) return cached;

  const logger: TelemetryLogger = {
    log(level, event, options) {
      forwardToGlobalLogger(normalizedModuleId, normalizedComponent, (target) =>
        target.log(level, event, options)
      );
    },
    trace(event, options) {
      forwardToGlobalLogger(normalizedModuleId, normalizedComponent, (target) =>
        target.trace(event, options)
      );
    },
    debug(event, options) {
      forwardToGlobalLogger(normalizedModuleId, normalizedComponent, (target) =>
        target.debug(event, options)
      );
    },
    info(event, options) {
      forwardToGlobalLogger(normalizedModuleId, normalizedComponent, (target) =>
        target.info(event, options)
      );
    },
    warn(event, options) {
      forwardToGlobalLogger(normalizedModuleId, normalizedComponent, (target) =>
        target.warn(event, options)
      );
    },
    error(event, options) {
      forwardToGlobalLogger(normalizedModuleId, normalizedComponent, (target) =>
        target.error(event, options)
      );
    },
    fatal(event, options) {
      forwardToGlobalLogger(normalizedModuleId, normalizedComponent, (target) =>
        target.fatal(event, options)
      );
    },
    metric(event, fields, options) {
      forwardToGlobalLogger(normalizedModuleId, normalizedComponent, (target) =>
        target.metric(event, fields, options)
      );
    },
    startSpan(event, options) {
      const service = globalTelemetryService;
      if (!service) return NOOP_SPAN;
      return service.getLogger(normalizedModuleId, normalizedComponent).startSpan(event, options);
    },
  };

  globalLoggerCache.set(cacheKey, logger);
  return logger;
}

function clonePolicy(policy: TelemetryPolicy): TelemetryPolicy {
  return {
    ...policy,
    retention: { ...policy.retention },
    modules: Object.fromEntries(
      Object.entries(policy.modules).map(([moduleId, modulePolicy]) => [moduleId, { ...modulePolicy }])
    ),
  };
}

function cloneStatus(status: TelemetryStatus): TelemetryStatus {
  return {
    ...status,
    currentFilePath: status.currentFilePath ?? null,
    lastError: status.lastError ?? null,
  };
}

function cloneRecord(record: TelemetryRecord): TelemetryRecord {
  return {
    ...record,
    component: record.component ?? null,
    message: record.message ?? null,
    traceId: record.traceId ?? null,
    spanId: record.spanId ?? null,
    windowId: record.windowId ?? null,
    fields: record.fields ? { ...record.fields } : null,
  };
}

function buildDefaultStatus(policy: TelemetryPolicy, sessionId: string): TelemetryStatus {
  return {
    enabled: policy.enabled,
    currentSessionId: sessionId,
    queuedRecords: 0,
    flushedRecords: 0,
    droppedRecords: 0,
    currentFileBytes: 0,
    currentFilePath: null,
    frontendMinLevel: policy.frontendMinLevel,
    backendMinLevel: policy.backendMinLevel,
    persistMinLevel: policy.persistMinLevel,
    lastError: null,
  };
}

function normalizeModuleId(moduleId: string): string {
  const trimmed = moduleId.trim();
  return trimmed.length > 0 ? trimmed : 'unknown';
}

function normalizeComponent(component: string | null | undefined): string | null {
  if (typeof component !== 'string') return null;
  const trimmed = component.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEvent(event: string): string {
  const trimmed = event.trim();
  return trimmed.length > 0 ? trimmed : 'unknown';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorFields(error: unknown): TelemetryFields {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorStack: error.stack ?? null,
    };
  }
  return {
    errorValue: String(error),
  };
}

function createFallbackSessionId(now: number, sequence: number): string {
  return `frontend-${now}-${sequence}`;
}

function createTraceId(now: number, sequence: number): string {
  return `trace-${now}-${sequence}`;
}

function createSpanId(now: number, sequence: number): string {
  return `span-${now}-${sequence}`;
}

function resolveQueueCapacity(policy: TelemetryPolicy, explicitCapacity?: number): number {
  if (typeof explicitCapacity === 'number' && Number.isFinite(explicitCapacity)) {
    return Math.max(1, Math.floor(explicitCapacity));
  }
  const derived = Math.max(
    DEFAULT_QUEUE_CAPACITY_MIN,
    policy.batchMaxItems * DEFAULT_QUEUE_CAPACITY_MULTIPLIER
  );
  return Math.min(DEFAULT_QUEUE_CAPACITY_MAX, derived);
}

export class DefaultTelemetryService implements TelemetryService {
  private readonly listeners = new Set<TelemetryListener>();
  private readonly loggerCache = new Map<string, TelemetryLogger>();
  private readonly tailCapacity: number;
  private readonly deps: TelemetryRuntimeDeps;
  private readonly explicitQueueCapacity?: number;

  private policy = clonePolicy(DEFAULT_TELEMETRY_POLICY);
  private status = buildDefaultStatus(this.policy, createFallbackSessionId(Date.now(), 0));
  private transportAvailable = false;
  private bootstrapState: TelemetrySnapshot['bootstrapState'] = 'idle';
  private lastFlushAtMs: number | null = null;
  private lastBootstrapAtMs: number | null = null;
  private queueDroppedRecords = 0;
  private tailDroppedRecords = 0;
  private bufferedRecords: TelemetryRecord[] = [];
  private tail: TelemetryRecord[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushInFlight: Promise<void> | null = null;
  private sequence = 1;
  private destroyed = false;
  private queueCapacity: number;

  constructor(options: {
    tailCapacity?: number;
    queueCapacity?: number;
    runtimeDeps?: Partial<TelemetryRuntimeDeps>;
  } = {}) {
    this.tailCapacity = Math.max(1, Math.floor(options.tailCapacity ?? DEFAULT_UI_TAIL_CAPACITY));
    this.explicitQueueCapacity = options.queueCapacity;
    this.queueCapacity = resolveQueueCapacity(this.policy, options.queueCapacity);
    this.deps = {
      loadDebugConfig: getDebugConfig,
      loadStatus: getTelemetryStatus,
      ingestBatch: ingestTelemetryBatch,
      clearSession: clearTelemetrySession,
      now: () => Date.now(),
      ...options.runtimeDeps,
    };
    this.status = buildDefaultStatus(this.policy, createFallbackSessionId(this.deps.now(), 0));
    this.syncFlushTimer();
  }

  getSnapshot(): TelemetrySnapshot {
    return {
      policy: clonePolicy(this.policy),
      status: cloneStatus(this.status),
      tail: this.tail.map(cloneRecord),
      bufferedRecords: this.bufferedRecords.length,
      queueDroppedRecords: this.queueDroppedRecords,
      tailDroppedRecords: this.tailDroppedRecords,
      transportAvailable: this.transportAvailable,
      bootstrapState: this.bootstrapState,
      lastFlushAtMs: this.lastFlushAtMs,
      lastBootstrapAtMs: this.lastBootstrapAtMs,
    };
  }

  subscribe(listener: TelemetryListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  async refreshRuntime(): Promise<TelemetrySnapshot> {
    if (this.destroyed) return this.getSnapshot();

    this.bootstrapState = 'loading';
    this.emitChanged();

    const [config, status] = await Promise.all([
      this.deps.loadDebugConfig().catch(() => null),
      this.deps.loadStatus().catch(() => null),
    ]);

    if (this.destroyed) {
      return this.getSnapshot();
    }

    if (config) {
      this.applyPolicy(config.telemetry);
    }

    if (status) {
      this.status = cloneStatus(status);
      this.transportAvailable = true;
    } else {
      this.transportAvailable = false;
      this.status = {
        ...this.status,
        enabled: this.policy.enabled,
        frontendMinLevel: this.policy.frontendMinLevel,
        backendMinLevel: this.policy.backendMinLevel,
        persistMinLevel: this.policy.persistMinLevel,
      };
    }

    if (!this.status.currentSessionId.trim()) {
      this.status.currentSessionId = createFallbackSessionId(this.deps.now(), this.sequence);
    }

    this.lastBootstrapAtMs = this.deps.now();
    this.bootstrapState = 'ready';
    this.syncFlushTimer();
    this.emitChanged();
    return this.getSnapshot();
  }

  async clearSession(): Promise<void> {
    const result = await this.deps.clearSession().catch(() => null);
    if (this.destroyed) return;
    if (result?.status) {
      this.status = cloneStatus(result.status);
      this.transportAvailable = true;
    } else {
      this.transportAvailable = false;
      this.status = {
        ...this.status,
        currentSessionId: createFallbackSessionId(this.deps.now(), this.nextSequence()),
      };
    }
    this.bufferedRecords = [];
    this.emitChanged();
  }

  async flushNow(): Promise<void> {
    if (this.flushInFlight) {
      await this.flushInFlight;
      return;
    }

    this.flushInFlight = this.flushLoop().finally(() => {
      this.flushInFlight = null;
    });
    await this.flushInFlight;
  }

  getLogger(moduleId: string, component?: string | null): TelemetryLogger {
    const normalizedModuleId = normalizeModuleId(moduleId);
    const normalizedComponent = normalizeComponent(component);
    const cacheKey = `${normalizedModuleId}::${normalizedComponent ?? ''}`;
    const cached = this.loggerCache.get(cacheKey);
    if (cached) return cached;

    const logWithLevel = (
      level: TelemetryLevel,
      event: string,
      options?: TelemetryLogOptions
    ): void => {
      this.ingest(
        normalizedModuleId,
        {
          level,
          event,
          kind: options?.kind,
          component: options?.component,
          message: options?.message,
          traceId: options?.traceId,
          spanId: options?.spanId,
          windowId: options?.windowId,
          fields: options?.fields,
        },
        normalizedComponent
      );
    };

    const logger: TelemetryLogger = {
      log: logWithLevel,
      trace: (event, options) => logWithLevel('trace', event, options),
      debug: (event, options) => logWithLevel('debug', event, options),
      info: (event, options) => logWithLevel('info', event, options),
      warn: (event, options) => logWithLevel('warn', event, options),
      error: (event, options) => logWithLevel('error', event, options),
      fatal: (event, options) => logWithLevel('fatal', event, options),
      metric: (event, fields, options) =>
        this.ingest(
          normalizedModuleId,
          {
            level: options?.level ?? 'info',
            event,
            kind: 'metric',
            component: options?.component,
            message: options?.message,
            traceId: options?.traceId,
            spanId: options?.spanId,
            windowId: options?.windowId,
            fields,
          },
          normalizedComponent
        ),
      startSpan: (event, options) => this.startSpan(normalizedModuleId, normalizedComponent, event, options),
    };

    this.loggerCache.set(cacheKey, logger);
    return logger;
  }

  ingest(moduleId: string, record: TelemetryRecordInput, component?: string | null): void {
    if (this.destroyed) return;

    const normalizedModuleId = normalizeModuleId(moduleId);
    const normalized = this.normalizeRecord(normalizedModuleId, record, component);
    const modulePolicy = this.policy.modules[normalizedModuleId];
    const acceptedForUi = this.shouldAcceptForTail(modulePolicy, normalized.level);
    const acceptedForPersist = this.shouldAcceptForPersist(modulePolicy, normalized.level);

    if (!acceptedForUi && !acceptedForPersist) {
      return;
    }

    if (acceptedForUi) {
      this.pushTail(normalized);
    }

    if (acceptedForPersist && this.transportAvailable) {
      this.pushBufferedRecord(normalized);
    }

    this.emitChanged();

    if (acceptedForPersist && this.transportAvailable && this.bufferedRecords.length >= this.policy.batchMaxItems) {
      void this.flushNow();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.stopFlushTimer();
    void this.flushNow();
    this.destroyed = true;
    this.listeners.clear();
    this.loggerCache.clear();
  }

  private startSpan(
    moduleId: string,
    component: string | null,
    event: string,
    options?: TelemetrySpanStartOptions
  ): TelemetrySpan {
    const now = this.deps.now();
    const traceId = options?.traceId ?? createTraceId(now, this.nextSequence());
    const spanId = options?.spanId ?? createSpanId(now, this.nextSequence());

    this.ingest(
      moduleId,
      {
        level: options?.level ?? 'info',
        event,
        kind: 'span-start',
        component: options?.component,
        message: options?.message,
        traceId,
        spanId,
        windowId: options?.windowId,
        fields: options?.fields,
      },
      component
    );

    return {
      end: (endOptions?: TelemetrySpanEndOptions) => {
        this.ingest(
          moduleId,
          {
            level: endOptions?.level ?? options?.level ?? 'info',
            event: endOptions?.event ?? `${event}.end`,
            kind: 'span-end',
            component: endOptions?.component,
            message: endOptions?.message,
            traceId,
            spanId,
            windowId: endOptions?.windowId,
            fields: endOptions?.fields,
          },
          component
        );
      },
    };
  }

  private normalizeRecord(
    moduleId: string,
    record: TelemetryRecordInput,
    fallbackComponent?: string | null
  ): TelemetryRecord {
    const event = normalizeEvent(record.event);
    const now = this.deps.now();

    return {
      ts: typeof record.ts === 'number' && Number.isFinite(record.ts) ? Math.floor(record.ts) : now,
      level: record.level,
      kind: (record.kind ?? 'log') as TelemetryKind,
      side: record.side ?? 'frontend',
      moduleId,
      event,
      sessionId:
        typeof record.sessionId === 'string' && record.sessionId.trim().length > 0
          ? record.sessionId
          : this.status.currentSessionId,
      component: normalizeComponent(record.component ?? fallbackComponent),
      message: normalizeComponent(record.message),
      traceId: normalizeComponent(record.traceId),
      spanId: normalizeComponent(record.spanId),
      windowId: normalizeComponent(record.windowId),
      fields: this.normalizeFields(record.fields),
    };
  }

  private normalizeFields(fields: TelemetryFields | null | undefined): TelemetryFields | null {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
    return { ...fields };
  }

  private shouldAcceptForTail(
    modulePolicy: TelemetryPolicy['modules'][string] | undefined,
    level: TelemetryLevel
  ): boolean {
    if (!this.policy.enabled || !this.policy.uiTailEnabled) {
      return false;
    }
    if (modulePolicy?.enabled === false) {
      return false;
    }
    const minLevel = modulePolicy?.level ?? this.policy.frontendMinLevel;
    return isTelemetryLevelAtLeast(level, minLevel);
  }

  private shouldAcceptForPersist(
    modulePolicy: TelemetryPolicy['modules'][string] | undefined,
    level: TelemetryLevel
  ): boolean {
    if (!this.policy.enabled) {
      return false;
    }
    if (modulePolicy?.enabled === false || modulePolicy?.persist === false) {
      return false;
    }
    const minLevel = modulePolicy?.level ?? this.policy.frontendMinLevel;
    return (
      isTelemetryLevelAtLeast(level, minLevel) &&
      isTelemetryLevelAtLeast(level, this.policy.persistMinLevel)
    );
  }

  private pushTail(record: TelemetryRecord): void {
    if (!this.policy.uiTailEnabled || this.tailCapacity <= 0) {
      return;
    }
    this.tail.push(record);
    const overflow = this.tail.length - this.tailCapacity;
    if (overflow > 0) {
      this.tail.splice(0, overflow);
      this.tailDroppedRecords += overflow;
    }
  }

  private pushBufferedRecord(record: TelemetryRecord): void {
    this.bufferedRecords.push(record);
    const overflow = this.bufferedRecords.length - this.queueCapacity;
    if (overflow > 0) {
      this.bufferedRecords.splice(0, overflow);
      this.queueDroppedRecords += overflow;
    }
  }

  private async flushLoop(): Promise<void> {
    if (!this.policy.enabled || !this.transportAvailable || this.bufferedRecords.length === 0) {
      return;
    }

    while (this.transportAvailable && this.bufferedRecords.length > 0) {
      const batchSize = Math.max(1, this.policy.batchMaxItems);
      const batch = this.bufferedRecords.splice(0, batchSize);
      const result = await this.deps.ingestBatch(batch).catch(() => null);

      if (!result?.status) {
        this.bufferedRecords = batch.concat(this.bufferedRecords).slice(0, this.queueCapacity);
        this.transportAvailable = false;
        this.emitChanged();
        return;
      }

      this.transportAvailable = true;
      this.status = cloneStatus(result.status);
      this.lastFlushAtMs = this.deps.now();
      this.emitChanged();
    }
  }

  private applyPolicy(policy: TelemetryPolicy): void {
    this.policy = clonePolicy(policy);
    this.queueCapacity = resolveQueueCapacity(this.policy, this.explicitQueueCapacity);
    if (!this.policy.enabled) {
      this.bufferedRecords = [];
    }
    if (!this.policy.uiTailEnabled) {
      this.tail = [];
    }
    if (this.bufferedRecords.length > this.queueCapacity) {
      const overflow = this.bufferedRecords.length - this.queueCapacity;
      this.bufferedRecords.splice(0, overflow);
      this.queueDroppedRecords += overflow;
    }
    this.status = {
      ...this.status,
      enabled: this.policy.enabled,
      frontendMinLevel: this.policy.frontendMinLevel,
      backendMinLevel: this.policy.backendMinLevel,
      persistMinLevel: this.policy.persistMinLevel,
    };
    this.syncFlushTimer();
  }

  private syncFlushTimer(): void {
    this.stopFlushTimer();
    if (!this.policy.enabled) {
      return;
    }
    const intervalMs = Math.max(25, this.policy.batchFlushMs);
    this.flushTimer = setInterval(() => {
      void this.flushNow();
    }, intervalMs);
  }

  private stopFlushTimer(): void {
    if (!this.flushTimer) return;
    clearInterval(this.flushTimer);
    this.flushTimer = null;
  }

  private emitChanged(): void {
    const snapshot = this.getSnapshot();
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(snapshot);
      } catch (error) {
        const record = this.normalizeRecord(
          'telemetry',
          {
            level: 'warn',
            event: 'telemetry.listener_failed',
            component: 'TelemetryService',
            message: getErrorMessage(error),
            fields: getErrorFields(error),
          },
          'TelemetryService'
        );
        const modulePolicy = this.policy.modules[record.moduleId];
        if (this.shouldAcceptForTail(modulePolicy, record.level)) {
          this.pushTail(record);
        }
        if (this.shouldAcceptForPersist(modulePolicy, record.level) && this.transportAvailable) {
          this.pushBufferedRecord(record);
        }
      }
    }
  }

  private nextSequence(): number {
    const next = this.sequence;
    this.sequence += 1;
    return next;
  }
}
