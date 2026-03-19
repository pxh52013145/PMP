import type { TelemetryFields, TelemetryLevel } from '../../contracts/telemetry';
import { getProcessPerfTotalsSnapshot } from '../../modules/debug/processPerf';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { getTelemetryLogger } from './TelemetryService';

type CaptureTelemetryScenarioSnapshotOptions = {
  moduleId: string;
  component?: string | null;
  event: string;
  level?: TelemetryLevel;
  message?: string | null;
  fields?: TelemetryFields | null;
  includeProcessPerf?: boolean;
  dedupeKey?: string;
  minIntervalMs?: number;
};

const lastCaptureAtByKey = new Map<string, number>();

function normalizeMinIntervalMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function captureTelemetryScenarioSnapshot(
  options: CaptureTelemetryScenarioSnapshotOptions
): void {
  const logger = getTelemetryLogger(options.moduleId, options.component);
  const dedupeKey =
    options.dedupeKey ?? `${options.moduleId}:${options.component ?? ''}:${options.event}`;
  const minIntervalMs = normalizeMinIntervalMs(options.minIntervalMs);
  const now = Date.now();
  const lastCapturedAtMs = lastCaptureAtByKey.get(dedupeKey) ?? 0;
  if (minIntervalMs > 0 && now - lastCapturedAtMs < minIntervalMs) {
    return;
  }
  lastCaptureAtByKey.set(dedupeKey, now);

  void (async () => {
    const nextFields: TelemetryFields = options.fields ? { ...options.fields } : {};
    if (options.includeProcessPerf !== false && isTauriRuntime()) {
      const perfTotals = await getProcessPerfTotalsSnapshot().catch(() => null);
      if (perfTotals) {
        nextFields.processPerfCapturedAtMs = perfTotals.timestampMs;
        nextFields.webview2PrivateBytes = perfTotals.totals.webview2PrivateBytes ?? null;
        nextFields.webview2WorkingSetBytes = perfTotals.totals.webview2WorkingSetBytes ?? null;
        nextFields.treePrivateBytes = perfTotals.totals.privateBytes ?? null;
        nextFields.treeWorkingSetBytes = perfTotals.totals.workingSetBytes ?? null;
      }
    }

    logger.log(options.level ?? 'info', options.event, {
      kind: 'snapshot',
      message: options.message ?? null,
      fields: nextFields,
    });
  })();
}
