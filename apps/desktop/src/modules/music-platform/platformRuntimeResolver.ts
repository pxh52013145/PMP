import type { PlatformCompatRuntimeApi } from '@pixel-matrix/plugin-platform-contracts';

import {
  resolveDefaultPlatformInstanceIdForConnector,
  resolvePlatformRuntimeDescriptorByInstanceId,
} from './platformRuntimeDescriptor';

export interface ResolvedPlatformRuntimeContext {
  instanceId: string;
  platformId: string;
  connectorId?: string;
  runtime: PlatformCompatRuntimeApi;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolvePlatformRuntimeContext(options: {
  instanceId?: string | null;
  connectorId?: string | null;
}): ResolvedPlatformRuntimeContext | null {
  const normalizedInstanceId = normalizeString(options.instanceId);
  const resolvedInstanceId =
    normalizedInstanceId ||
    resolveDefaultPlatformInstanceIdForConnector(normalizeString(options.connectorId));
  if (!resolvedInstanceId) return null;

  const descriptor = resolvePlatformRuntimeDescriptorByInstanceId(resolvedInstanceId);
  const instance = descriptor?.instanceRecord ?? null;
  const runtime = descriptor?.runtime ?? null;
  if (!descriptor || !instance || !runtime) return null;

  return {
    instanceId: instance.instanceId,
    platformId: instance.platformId,
    connectorId:
      typeof instance.metadata?.connectorId === 'string' ? instance.metadata.connectorId : undefined,
    runtime,
  };
}
