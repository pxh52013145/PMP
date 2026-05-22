import { createServiceToken } from '../../kernel';
import {
  requestProcessPerfSnapshot,
  requestProcessPerfTotalsSnapshot,
  type ProcessPerfRequestError,
  type ProcessPerfSnapshot,
  type ProcessPerfTotalsSnapshot,
} from '../../modules/debug/processPerf';
import type { TelemetryService, TelemetrySnapshot } from '../telemetry';

export type ProcessPerfAvailability = 'idle' | 'ready' | 'unsupported' | 'unavailable';
export type ProcessPerfDetailLevel = 'none' | 'totals' | 'full';

export type ProcessPerfPolicySnapshot = {
  samplingMs: number;
  perfTelemetryEnabled: boolean;
  realtimeVerbose: boolean;
};

export type ProcessPerfServiceSnapshot = {
  updatedAtMs: number;
  lastAttemptAtMs: number | null;
  lastSuccessAtMs: number | null;
  availability: ProcessPerfAvailability;
  detailLevel: ProcessPerfDetailLevel;
  lastError: string | null;
  fullSnapshot: ProcessPerfSnapshot | null;
  totalsSnapshot: ProcessPerfTotalsSnapshot | null;
  policy: ProcessPerfPolicySnapshot;
};

export type ProcessPerfRefreshOptions = {
  force?: boolean;
};

export type ProcessPerfSnapshotListener = (snapshot: ProcessPerfServiceSnapshot) => void;

export interface ProcessPerfService {
  getSnapshot(): ProcessPerfServiceSnapshot;
  subscribe(listener: ProcessPerfSnapshotListener): () => void;
  refreshSnapshot(options?: ProcessPerfRefreshOptions): Promise<ProcessPerfSnapshot | null>;
  refreshTotalsSnapshot(options?: ProcessPerfRefreshOptions): Promise<ProcessPerfTotalsSnapshot | null>;
  releaseRuntimeCaches(reason?: string): void;
  destroy(): void;
}

export const PROCESS_PERF_SERVICE_TOKEN =
  createServiceToken<ProcessPerfService>('service.processPerf');

const DEFAULT_PROCESS_PERF_POLICY: ProcessPerfPolicySnapshot = {
  samplingMs: 1_000,
  perfTelemetryEnabled: true,
  realtimeVerbose: false,
};

const DEFAULT_PROCESS_PERF_SERVICE_SNAPSHOT: ProcessPerfServiceSnapshot = {
  updatedAtMs: 0,
  lastAttemptAtMs: null,
  lastSuccessAtMs: null,
  availability: 'idle',
  detailLevel: 'none',
  lastError: null,
  fullSnapshot: null,
  totalsSnapshot: null,
  policy: DEFAULT_PROCESS_PERF_POLICY,
};

let globalProcessPerfService: ProcessPerfService | null = null;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (globalProcessPerfService) {
      globalProcessPerfService.destroy();
      globalProcessPerfService = null;
    }
  });
}

function cloneProcessPerfPolicy(policy: ProcessPerfPolicySnapshot): ProcessPerfPolicySnapshot {
  return {
    samplingMs: policy.samplingMs,
    perfTelemetryEnabled: policy.perfTelemetryEnabled,
    realtimeVerbose: policy.realtimeVerbose,
  };
}

function cloneProcessPerfServiceSnapshot(
  snapshot: ProcessPerfServiceSnapshot
): ProcessPerfServiceSnapshot {
  return {
    ...snapshot,
    policy: cloneProcessPerfPolicy(snapshot.policy),
  };
}

function detailRank(detailLevel: ProcessPerfDetailLevel): number {
  switch (detailLevel) {
    case 'full':
      return 2;
    case 'totals':
      return 1;
    case 'none':
    default:
      return 0;
  }
}

function classifyAvailability(error: ProcessPerfRequestError): ProcessPerfAvailability {
  return error.code === 'unsupported' ? 'unsupported' : 'unavailable';
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeSamplingMs(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PROCESS_PERF_POLICY.samplingMs;
  return Math.max(250, Math.floor(value));
}

function readPolicy(snapshot: TelemetrySnapshot): ProcessPerfPolicySnapshot {
  const modulePolicy = snapshot.policy.modules.performance;
  return {
    samplingMs: normalizeSamplingMs(snapshot.policy.perfSamplingMs),
    perfTelemetryEnabled:
      snapshot.policy.enabled && modulePolicy?.enabled !== false && modulePolicy?.perf !== false,
    realtimeVerbose: modulePolicy?.realtimeVerbose === true,
  };
}

function deriveTotalsSnapshot(snapshot: ProcessPerfSnapshot): ProcessPerfTotalsSnapshot {
  return {
    timestampMs: snapshot.timestampMs,
    sampleIntervalMs: snapshot.sampleIntervalMs,
    cpuCount: snapshot.cpuCount,
    rootPid: snapshot.rootPid,
    systemMemory: snapshot.systemMemory,
    totals: snapshot.totals,
  };
}

function hasRequestedDetail(
  snapshot: ProcessPerfServiceSnapshot,
  requestedDetail: ProcessPerfDetailLevel
): boolean {
  if (requestedDetail === 'full') {
    return snapshot.fullSnapshot !== null;
  }
  if (requestedDetail === 'totals') {
    return snapshot.totalsSnapshot !== null;
  }
  return true;
}

export function setGlobalProcessPerfService(service: ProcessPerfService | null): void {
  globalProcessPerfService = service;
}

export function getGlobalProcessPerfService(): ProcessPerfService | null {
  return globalProcessPerfService;
}

export class DefaultProcessPerfService implements ProcessPerfService {
  private readonly listeners = new Set<ProcessPerfSnapshotListener>();
  private readonly unsubscribeTelemetry: () => void;

  private snapshot = cloneProcessPerfServiceSnapshot(DEFAULT_PROCESS_PERF_SERVICE_SNAPSHOT);
  private inFlight: Promise<ProcessPerfServiceSnapshot> | null = null;
  private inFlightDetail: ProcessPerfDetailLevel = 'none';
  private destroyed = false;

  constructor(telemetryService: TelemetryService) {
    this.applyTelemetrySnapshot(telemetryService.getSnapshot());
    this.unsubscribeTelemetry = telemetryService.subscribe((snapshot) => {
      this.applyTelemetrySnapshot(snapshot);
    });
  }

  getSnapshot(): ProcessPerfServiceSnapshot {
    return cloneProcessPerfServiceSnapshot(this.snapshot);
  }

  subscribe(listener: ProcessPerfSnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  async refreshSnapshot(options: ProcessPerfRefreshOptions = {}): Promise<ProcessPerfSnapshot | null> {
    const snapshot = await this.refresh('full', options.force === true);
    return snapshot.availability === 'ready' ? snapshot.fullSnapshot : null;
  }

  async refreshTotalsSnapshot(
    options: ProcessPerfRefreshOptions = {}
  ): Promise<ProcessPerfTotalsSnapshot | null> {
    const snapshot = await this.refresh('totals', options.force === true);
    return snapshot.availability === 'ready' ? snapshot.totalsSnapshot : null;
  }

  releaseRuntimeCaches(_reason: string = 'runtime-capsule-reclaim'): void {
    this.snapshot = {
      ...this.snapshot,
      updatedAtMs: Date.now(),
      availability: 'idle',
      detailLevel: 'none',
      lastError: null,
      fullSnapshot: null,
      totalsSnapshot: null,
    };
    this.emitChanged();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribeTelemetry();
    this.listeners.clear();
  }

  private applyTelemetrySnapshot(snapshot: TelemetrySnapshot): void {
    const nextPolicy = readPolicy(snapshot);
    const currentPolicy = this.snapshot.policy;
    if (
      currentPolicy.samplingMs === nextPolicy.samplingMs &&
      currentPolicy.perfTelemetryEnabled === nextPolicy.perfTelemetryEnabled &&
      currentPolicy.realtimeVerbose === nextPolicy.realtimeVerbose
    ) {
      return;
    }

    this.snapshot = {
      ...this.snapshot,
      updatedAtMs: Date.now(),
      policy: nextPolicy,
    };
    this.emitChanged();
  }

  private async refresh(
    requestedDetail: ProcessPerfDetailLevel,
    force: boolean
  ): Promise<ProcessPerfServiceSnapshot> {
    const now = Date.now();
    const withinCadence =
      this.snapshot.updatedAtMs > 0 &&
      now - this.snapshot.updatedAtMs < this.snapshot.policy.samplingMs;

    if (!force && withinCadence) {
      if (this.snapshot.availability !== 'ready') {
        return this.getSnapshot();
      }
      if (hasRequestedDetail(this.snapshot, requestedDetail)) {
        return this.getSnapshot();
      }
    }

    if (
      this.inFlight &&
      detailRank(this.inFlightDetail) >= detailRank(requestedDetail) &&
      !force
    ) {
      return this.inFlight.then((snapshot) => cloneProcessPerfServiceSnapshot(snapshot));
    }

    this.inFlightDetail = requestedDetail;
    this.inFlight = this.runRefresh(requestedDetail).finally(() => {
      this.inFlight = null;
      this.inFlightDetail = 'none';
    });
    return this.inFlight.then((snapshot) => cloneProcessPerfServiceSnapshot(snapshot));
  }

  private async runRefresh(
    requestedDetail: ProcessPerfDetailLevel
  ): Promise<ProcessPerfServiceSnapshot> {
    const attemptedAtMs = Date.now();

    try {
      if (requestedDetail === 'full') {
        const fullSnapshot = await requestProcessPerfSnapshot();
        this.snapshot = {
          ...this.snapshot,
          updatedAtMs: attemptedAtMs,
          lastAttemptAtMs: attemptedAtMs,
          lastSuccessAtMs: attemptedAtMs,
          availability: 'ready',
          detailLevel: 'full',
          lastError: null,
          fullSnapshot,
          totalsSnapshot: deriveTotalsSnapshot(fullSnapshot),
        };
      } else {
        const totalsSnapshot = await requestProcessPerfTotalsSnapshot();
        this.snapshot = {
          ...this.snapshot,
          updatedAtMs: attemptedAtMs,
          lastAttemptAtMs: attemptedAtMs,
          lastSuccessAtMs: attemptedAtMs,
          availability: 'ready',
          detailLevel:
            this.snapshot.fullSnapshot !== null && this.snapshot.lastSuccessAtMs !== null
              ? 'full'
              : 'totals',
          lastError: null,
          totalsSnapshot,
        };
      }
    } catch (error) {
      const normalizedError = error as ProcessPerfRequestError;
      this.snapshot = {
        ...this.snapshot,
        updatedAtMs: attemptedAtMs,
        lastAttemptAtMs: attemptedAtMs,
        availability: classifyAvailability(normalizedError),
        lastError: readErrorMessage(normalizedError),
      };
    }

    this.emitChanged();
    return this.snapshot;
  }

  private emitChanged(): void {
    const snapshot = this.getSnapshot();
    for (const listener of Array.from(this.listeners)) {
      listener(snapshot);
    }
  }
}
