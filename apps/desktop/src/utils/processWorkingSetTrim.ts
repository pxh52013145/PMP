import {
  trimProcessWorkingSet,
  type ProcessWorkingSetTrimTarget,
} from '../modules/debug';
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';
import { isTauriRuntime } from './tauriRuntime';

type ProcessWorkingSetTrimScheduleOptions = {
  delaysMs?: readonly number[];
  reason?: string;
};

export type ProcessWorkingSetTrimEvent = {
  timestampMs: number;
  target: ProcessWorkingSetTrimTarget;
  reason: string | null;
  succeeded: boolean;
  attemptedCount: number;
  trimmedCount: number;
  failedCount: number;
};

const DEFAULT_DELAYS_MS = [1000, 3200] as const;
const scheduledTrimTimers = new Map<
  ProcessWorkingSetTrimTarget,
  ReturnType<typeof setTimeout>[]
>();
let lastTrimEvent: ProcessWorkingSetTrimEvent | null = null;
const telemetry = getTelemetryLogger('memory-governance', 'processWorkingSetTrim');

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const timers of scheduledTrimTimers.values()) {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    }
    scheduledTrimTimers.clear();
    lastTrimEvent = null;
  });
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeDelays(delaysMs?: readonly number[]): number[] {
  const source = Array.isArray(delaysMs) && delaysMs.length > 0 ? delaysMs : DEFAULT_DELAYS_MS;
  return [...new Set(source)]
    .map((value) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0))
    .sort((left, right) => left - right);
}

function recordTrimEvent(
  target: ProcessWorkingSetTrimTarget,
  reason: string | null,
  result: Awaited<ReturnType<typeof trimProcessWorkingSet>>,
  fallbackSucceeded: boolean
): void {
  lastTrimEvent = {
    timestampMs:
      typeof result?.timestampMs === 'number' && Number.isFinite(result.timestampMs)
        ? Math.max(0, Math.floor(result.timestampMs))
        : Date.now(),
    target,
    reason,
    succeeded: Boolean(result) && fallbackSucceeded,
    attemptedCount: Array.isArray(result?.attemptedPids) ? result.attemptedPids.length : 0,
    trimmedCount: Array.isArray(result?.trimmedPids) ? result.trimmedPids.length : 0,
    failedCount: Array.isArray(result?.failedPids) ? result.failedPids.length : 0,
  };
}

export function getLastProcessWorkingSetTrimEvent(): ProcessWorkingSetTrimEvent | null {
  return lastTrimEvent ? { ...lastTrimEvent } : null;
}

function clearScheduledTarget(target: ProcessWorkingSetTrimTarget): void {
  const timers = scheduledTrimTimers.get(target);
  if (!timers) return;
  for (const timer of timers) {
    clearTimeout(timer);
  }
  scheduledTrimTimers.delete(target);
}

export function cancelScheduledProcessWorkingSetTrim(target?: ProcessWorkingSetTrimTarget): void {
  if (target) {
    clearScheduledTarget(target);
    return;
  }

  for (const scheduledTarget of scheduledTrimTimers.keys()) {
    clearScheduledTarget(scheduledTarget);
  }
}

export function scheduleProcessWorkingSetTrim(
  target: ProcessWorkingSetTrimTarget,
  options?: ProcessWorkingSetTrimScheduleOptions
): void {
  if (!isTauriRuntime()) return;

  clearScheduledTarget(target);

  const normalizedDelays = normalizeDelays(options?.delaysMs);
  const timers = normalizedDelays.map((delayMs, index) =>
    setTimeout(() => {
      if (index === normalizedDelays.length - 1) {
        scheduledTrimTimers.delete(target);
      }

      void trimProcessWorkingSet(target)
        .then((result) => {
          recordTrimEvent(target, options?.reason ?? null, result, result !== null);
          if (!result) {
            telemetry.warn('process_working_set_trim.failed', {
              fields: {
                target,
                reason: options?.reason ?? null,
              },
            });
          }
        })
        .catch((error) => {
          recordTrimEvent(target, options?.reason ?? null, null, false);
          telemetry.warn('process_working_set_trim.failed', {
            message: readErrorMessage(error),
            fields: {
              target,
              reason: options?.reason ?? null,
            },
          });
        });
    }, delayMs)
  );

  scheduledTrimTimers.set(target, timers);
}
