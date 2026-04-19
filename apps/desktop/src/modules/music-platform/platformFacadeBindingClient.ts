import type {
  PlatformApiResult,
  PlatformCompatRuntimeApi,
} from '@pixel-matrix/plugin-platform-contracts';

import { invokePlatformRuntimeBinding } from './bindingRuntime';
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
  const runtimeContext = resolveRuntimeContext({
    connectorId: options.connectorId,
    instanceId: options.instanceId,
  });

  if (runtimeContext && options.invokeRuntime) {
    const runtimePayload = buildBindingPayload(options.payload, runtimeContext.instanceId);
    const runtimeResult = await options.invokeRuntime(
      runtimeContext.runtime,
      runtimeContext.instanceId,
      runtimePayload
    );
    if (runtimeResult) {
      return ensureMappedResult(
        options.displayName,
        options.bindingId,
        options.method,
        runtimeResult,
        options.map
      );
    }
  }

  if (runtimeContext && options.runtimeBucket) {
    const runtimePayload = buildBindingPayload(options.payload, runtimeContext.instanceId);
    const runtimeResult = await invokeRuntimeBucketBinding(
      runtimeContext.runtime,
      options.runtimeBucket,
      options.runtimeMethods?.length ? options.runtimeMethods : [options.method],
      runtimePayload
    );
    if (runtimeResult) {
      return ensureMappedResult(
        options.displayName,
        options.bindingId,
        options.method,
        runtimeResult,
        options.map
      );
    }
  }

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

  return ensureMappedResult(
    options.displayName,
    options.bindingId,
    options.method,
    bindingResult,
    options.map
  );
}
