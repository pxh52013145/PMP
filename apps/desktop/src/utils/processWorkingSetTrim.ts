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

const DEFAULT_DELAYS_MS = [1000, 3200] as const;
const scheduledTrimTimers = new Map<
  ProcessWorkingSetTrimTarget,
  ReturnType<typeof setTimeout>[]
>();
const telemetry = getTelemetryLogger('memory-governance', 'processWorkingSetTrim');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeDelays(delaysMs?: readonly number[]): number[] {
  const source = Array.isArray(delaysMs) && delaysMs.length > 0 ? delaysMs : DEFAULT_DELAYS_MS;
  return [...new Set(source)]
    .map((value) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0))
    .sort((left, right) => left - right);
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

      void trimProcessWorkingSet(target).catch((error) => {
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
