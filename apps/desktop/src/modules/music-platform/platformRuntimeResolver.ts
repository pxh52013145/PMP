import type { PlatformCompatRuntimeApi } from '@pixel-matrix/plugin-platform-contracts';

import { getPlatformCompatRuntimeApi } from './contractRegistry';
import { getPlatformInstance } from './instanceRegistry';
import { resolvePlatformInstanceId } from './platformInstanceAuth';

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
  const instanceId = resolvePlatformInstanceId({
    instanceId: normalizeString(options.instanceId) || undefined,
    connectorId: normalizeString(options.connectorId) || undefined,
  });
  if (!instanceId) return null;

  const instance = getPlatformInstance(instanceId);
  if (!instance) return null;

  const runtime = getPlatformCompatRuntimeApi(instance.platformId);
  if (!runtime) return null;

  return {
    instanceId: instance.instanceId,
    platformId: instance.platformId,
    connectorId:
      typeof instance.metadata?.connectorId === 'string' ? instance.metadata.connectorId : undefined,
    runtime,
  };
}
