import type { TelemetryFields } from '../../contracts/telemetry';
import type { TelemetryLogger } from '../../services/telemetry/telemetryTypes';

export const MUSIC_PLATFORM_SLOW_OPERATION_THRESHOLD_MS = 1_200;
export const MUSIC_PLATFORM_VERY_SLOW_OPERATION_THRESHOLD_MS = 4_000;
export const MUSIC_PLATFORM_UI_STALL_THRESHOLD_MS = 2_000;

export function getMusicPlatformNowMs(): number {
  if (typeof globalThis.performance?.now === 'function') {
    return globalThis.performance.now();
  }
  return Date.now();
}

export function getMusicPlatformDurationMs(startedAtMs: number): number {
  return Math.max(0, Math.round(getMusicPlatformNowMs() - startedAtMs));
}

export function readMusicPlatformDiagnosticErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message || error.name || 'Unknown error';
  }
  if (typeof error === 'string') {
    const message = error.trim();
    return message || 'Unknown error';
  }
  return String(error);
}

export function warnOnSlowMusicPlatformOperation(options: {
  logger: TelemetryLogger;
  event: string;
  startedAtMs: number;
  thresholdMs?: number;
  message?: string;
  fields?: TelemetryFields;
}): number {
  const durationMs = getMusicPlatformDurationMs(options.startedAtMs);
  const thresholdMs = Math.max(
    1,
    Math.floor(options.thresholdMs ?? MUSIC_PLATFORM_SLOW_OPERATION_THRESHOLD_MS)
  );

  if (durationMs >= thresholdMs) {
    options.logger.warn(options.event, {
      message: options.message,
      fields: {
        ...(options.fields ?? {}),
        durationMs,
        thresholdMs,
      },
    });
  }

  return durationMs;
}
