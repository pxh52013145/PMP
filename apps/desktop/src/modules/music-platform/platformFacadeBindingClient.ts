import type {
  PlatformApiResult,
  PlatformCompatRuntimeApi,
} from '@pixel-matrix/plugin-platform-contracts';

import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { invokePlatformRuntimeBinding } from './bindingRuntime';
import {
  getMusicPlatformDurationMs,
  getMusicPlatformNowMs,
  readMusicPlatformDiagnosticErrorMessage,
  warnOnSlowMusicPlatformOperation,
} from './platformDiagnostics';
import {
  resolvePlatformRuntimeContext,
  type ResolvedPlatformRuntimeContext,
} from './platformRuntimeResolver';
import type { PlatformConnectorId } from './platformConnectorModel';

type RuntimeBindingInvoker = (
  runtime: PlatformCompatRuntimeApi,
  resolvedInstanceId: string,
  payload: Record<string, unknown>
) => Promise<PlatformApiResult<unknown>> | null | undefined;

export type PlatformFacadeRuntimeBucket =
  | 'auth'
  | 'library'
  | 'recommendations'
  | 'search'
  | 'quality'
  | 'pages';

const telemetry = getTelemetryLogger('music-platform', 'platformFacadeBindingClient');

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildBindingPayload(
  payload: Record<string, unknown> | undefined,
  instanceId: string | undefined
): Record<string, unknown> {
  if (!instanceId) {
    return payload ? { ...payload } : {};
  }
  return {
    ...(payload ?? {}),
    instanceId,
  };
}

function ensureMappedResult<T>(
  displayName: string,
  bindingId: string,
  method: string,
  result: PlatformApiResult<unknown>,
  map: (value: unknown) => T | undefined
): T {
  if (!result.ok) {
    throw new Error(result.error.message);
  }

  const mapped = map(result.data);
  if (typeof mapped === 'undefined') {
    throw new Error(
      `${displayName} binding ${bindingId}.${method} returned invalid data`
    );
  }

  return mapped;
}

function resolveRuntimeContext(options: {
  connectorId: PlatformConnectorId;
  instanceId?: string | null;
}): ResolvedPlatformRuntimeContext | null {
  return resolvePlatformRuntimeContext({
    connectorId: options.connectorId,
    instanceId: normalizeString(options.instanceId) || undefined,
  });
}

function invokeRuntimeBucketBinding(
  runtime: PlatformCompatRuntimeApi,
  bucket: PlatformFacadeRuntimeBucket,
  methodNames: string[],
  payload: Record<string, unknown>
): Promise<PlatformApiResult<unknown>> | null {
  const bucketRecord = runtime[bucket] as Record<string, unknown> | undefined;
  if (!bucketRecord) {
    return null;
  }

  for (const methodName of methodNames) {
    const fn = bucketRecord[methodName] as
      | ((input: Record<string, unknown>) => Promise<PlatformApiResult<unknown>>)
      | undefined;
    if (typeof fn === 'function') {
      return fn(payload);
    }
  }

  return null;
}

export async function callPlatformFacadeBinding<T>(options: {
  connectorId: PlatformConnectorId;
  displayName: string;
  instanceId?: string | null;
  bindingId: string;
  method: string;
  payload?: Record<string, unknown>;
  runtimeBucket?: PlatformFacadeRuntimeBucket;
  runtimeMethods?: string[];
  invokeRuntime?: RuntimeBindingInvoker;
  map: (value: unknown) => T | undefined;
}): Promise<T> {
  const startedAtMs = getMusicPlatformNowMs();
  const runtimeContext = resolveRuntimeContext({
    connectorId: options.connectorId,
    instanceId: options.instanceId,
  });
  let stage: 'runtime-explicit' | 'runtime-bucket' | 'binding' = 'binding';
  const diagnosticFields = {
    connectorId: options.connectorId,
    bindingId: options.bindingId,
    method: options.method,
    runtimeBucket: options.runtimeBucket ?? null,
    hasRuntimeContext: Boolean(runtimeContext),
    requestedInstanceIdPresent: Boolean(normalizeString(options.instanceId)),
    resolvedInstanceId:
      runtimeContext?.instanceId ?? (normalizeString(options.instanceId) || null),
    runtimePlatformId: runtimeContext?.platformId ?? null,
    runtimeConnectorId: runtimeContext?.connectorId ?? null,
  };

  try {
    if (runtimeContext && options.invokeRuntime) {
      stage = 'runtime-explicit';
      const runtimePayload = buildBindingPayload(options.payload, runtimeContext.instanceId);
      const runtimeResult = await options.invokeRuntime(
        runtimeContext.runtime,
        runtimeContext.instanceId,
        runtimePayload
      );
      if (runtimeResult) {
        const mapped = ensureMappedResult(
          options.displayName,
          options.bindingId,
          options.method,
          runtimeResult,
          options.map
        );
        warnOnSlowMusicPlatformOperation({
          logger: telemetry,
          event: 'music-platform.facade.call.slow',
          startedAtMs,
          fields: {
            ...diagnosticFields,
            stage,
          },
        });
        return mapped;
      }
    }

    if (runtimeContext && options.runtimeBucket) {
      stage = 'runtime-bucket';
      const runtimePayload = buildBindingPayload(options.payload, runtimeContext.instanceId);
      const runtimeResult = await invokeRuntimeBucketBinding(
        runtimeContext.runtime,
        options.runtimeBucket,
        options.runtimeMethods?.length ? options.runtimeMethods : [options.method],
        runtimePayload
      );
      if (runtimeResult) {
        const mapped = ensureMappedResult(
          options.displayName,
          options.bindingId,
          options.method,
          runtimeResult,
          options.map
        );
        warnOnSlowMusicPlatformOperation({
          logger: telemetry,
          event: 'music-platform.facade.call.slow',
          startedAtMs,
          fields: {
            ...diagnosticFields,
            stage,
          },
        });
        return mapped;
      }
    }

    stage = 'binding';
    const bindingInstanceId =
      runtimeContext?.instanceId || normalizeString(options.instanceId) || undefined;
    const bindingPayload = buildBindingPayload(options.payload, bindingInstanceId);
    const bindingResult = await invokePlatformRuntimeBinding({
      bindingId: options.bindingId,
      connectorId: options.connectorId,
      displayName: options.displayName,
      method: options.method,
      payload: bindingPayload,
    });

    const mapped = ensureMappedResult(
      options.displayName,
      options.bindingId,
      options.method,
      bindingResult,
      options.map
    );
    warnOnSlowMusicPlatformOperation({
      logger: telemetry,
      event: 'music-platform.facade.call.slow',
      startedAtMs,
      fields: {
        ...diagnosticFields,
        stage,
      },
    });
    return mapped;
  } catch (error) {
    telemetry.warn('music-platform.facade.call.failed', {
      message: readMusicPlatformDiagnosticErrorMessage(error),
      fields: {
        ...diagnosticFields,
        stage,
        durationMs: getMusicPlatformDurationMs(startedAtMs),
      },
    });
    throw error;
  }
}
