import { invoke as tauriInvoke } from '@tauri-apps/api/tauri';
import type { TelemetryLevel } from '../../contracts/telemetry';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import type { TelemetryService, TelemetrySpan } from './telemetryTypes';

type InvokeArgs = Record<string, unknown> | undefined;

export type TauriInvokeTelemetryOptions = {
  moduleId?: string;
  component?: string | null;
  event?: string;
  successLevel?: TelemetryLevel;
  failureLevel?: TelemetryLevel;
  slowThresholdMs?: number;
  includeResultSize?: boolean;
};

const DEFAULT_INVOKE_SLOW_THRESHOLD_MS = 180;

let attachedService: TelemetryService | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeModuleId(value: string | undefined, command: string): string {
  const explicit = value?.trim();
  if (explicit) return explicit;

  if (command.startsWith('native_audio_')) return 'audio';
  if (command.startsWith('debug_')) return 'debug';
  if (command.startsWith('music_library_')) return 'music-library';
  if (command.startsWith('open_') || command.startsWith('close_') || command.startsWith('set_editor_')) {
    return 'windowing';
  }
  return 'tauri';
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function approxJsonBytes(value: unknown): number | null {
  try {
    const encoded = new TextEncoder().encode(JSON.stringify(value));
    return encoded.length;
  } catch {
    return null;
  }
}

function buildStartFields(command: string, args: InvokeArgs): Record<string, unknown> {
  return {
    command,
    argKeys: isRecord(args) ? Object.keys(args).slice(0, 12) : [],
    argApproxBytes: approxJsonBytes(args),
  };
}

function shouldBypassTelemetry(command: string): boolean {
  return command.startsWith('debug_telemetry_');
}

export function attachTauriInvokeTelemetry(service: TelemetryService): () => void {
  attachedService = service;
  return () => {
    if (attachedService === service) {
      attachedService = null;
    }
  };
}

export async function invokeWithTelemetry<T>(
  command: string,
  args?: InvokeArgs,
  options: TauriInvokeTelemetryOptions = {}
): Promise<T> {
  if (!isTauriRuntime() || shouldBypassTelemetry(command)) {
    return tauriInvoke<T>(command, args);
  }

  const service = attachedService;
  if (!service) {
    return tauriInvoke<T>(command, args);
  }

  const moduleId = normalizeModuleId(options.moduleId, command);
  const logger = service.getLogger(moduleId, options.component ?? 'tauri.invoke');
  const event = options.event ?? 'tauri.invoke';
  const startAtMs = Date.now();
  const span: TelemetrySpan = logger.startSpan(event, {
    level: 'debug',
    fields: buildStartFields(command, args),
  });

  try {
    const result = await tauriInvoke<T>(command, args);
    const durationMs = Date.now() - startAtMs;
    const successLevel =
      options.successLevel ??
      (durationMs >= (options.slowThresholdMs ?? DEFAULT_INVOKE_SLOW_THRESHOLD_MS) ? 'info' : 'debug');
    span.end({
      level: successLevel,
      fields: {
        command,
        status: 'ok',
        durationMs,
        resultApproxBytes: options.includeResultSize ? approxJsonBytes(result) : null,
      },
    });
    return result;
  } catch (error) {
    const durationMs = Date.now() - startAtMs;
    span.end({
      level: options.failureLevel ?? 'error',
      message: readErrorMessage(error),
      fields: {
        command,
        status: 'error',
        durationMs,
        errorMessage: readErrorMessage(error),
      },
    });
    throw error;
  }
}

export function detachTauriInvokeTelemetryForTests(): void {
  attachedService = null;
}
