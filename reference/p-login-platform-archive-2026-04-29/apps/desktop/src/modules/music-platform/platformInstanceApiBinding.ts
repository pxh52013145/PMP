import type { PlatformApiResult } from '@pixel-matrix/plugin-platform-contracts';

import {
  isPlatformBindingPayloadError,
} from './platformBindingErrors';
import {
  normalizePlatformConnectorId,
  type PlatformConnectorId,
} from './platformConnectorModel';
import {
  listPlatformPackInstanceApiBindingProviders,
  resolvePlatformPackInstanceApiBindingProvider,
} from './platformPackRegistry';
import { isExpectedPlatformPackSidecarLifecycleError } from './platformPackSidecarBridge';

export const PLATFORM_LIBRARY_BINDING_ID = 'host.pmp.platform-instance.library';
export const PLATFORM_RECOMMENDATIONS_BINDING_ID =
  'host.pmp.platform-instance.recommendations';
export const PLATFORM_SEARCH_BINDING_ID = 'host.pmp.platform-instance.search';
export const PLATFORM_QUALITY_BINDING_ID = 'host.pmp.platform-instance.quality';
export const PLATFORM_PAGES_BINDING_ID = 'host.pmp.platform-instance.pages';

export type PlatformInstanceApiBindingInvokeOptions = {
  bindingId: string;
  connectorId: PlatformConnectorId;
  displayName: string;
  method: string;
  payload?: Record<string, unknown>;
};

type PlatformInstanceApiBindingContext = {
  instanceId: string;
  options: PlatformInstanceApiBindingInvokeOptions;
};

type PlatformInstanceApiBindingMethod = (
  context: PlatformInstanceApiBindingContext
) => Promise<unknown>;

type PlatformInstanceApiBindingBucket = Record<
  string,
  PlatformInstanceApiBindingMethod | undefined
>;

export interface PlatformInstanceApiBindingProvider {
  connectorId: PlatformConnectorId;
  library?: PlatformInstanceApiBindingBucket;
  recommendations?: PlatformInstanceApiBindingBucket;
  search?: PlatformInstanceApiBindingBucket;
  quality?: PlatformInstanceApiBindingBucket;
  pages?: PlatformInstanceApiBindingBucket;
}

const dynamicPlatformInstanceApiBindingProviders = new Map<
  PlatformConnectorId,
  PlatformInstanceApiBindingProvider
>();

function ok<T>(data: T): PlatformApiResult<T> {
  return { ok: true, data };
}

function err(code: string, message: string, details?: unknown): PlatformApiResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      details,
    },
  };
}

function resolveBucketBindingKey(
  bindingId: string
):
  | keyof Pick<
      PlatformInstanceApiBindingProvider,
      'library' | 'recommendations' | 'search' | 'quality' | 'pages'
    >
  | null {
  switch (bindingId) {
    case PLATFORM_LIBRARY_BINDING_ID:
      return 'library';
    case PLATFORM_RECOMMENDATIONS_BINDING_ID:
      return 'recommendations';
    case PLATFORM_SEARCH_BINDING_ID:
      return 'search';
    case PLATFORM_QUALITY_BINDING_ID:
      return 'quality';
    case PLATFORM_PAGES_BINDING_ID:
      return 'pages';
    default:
      return null;
  }
}

function createUnsupportedBindingResult(
  options: PlatformInstanceApiBindingInvokeOptions
): PlatformApiResult<never> {
  return err(
    'UNSUPPORTED_CAPABILITY',
    `${options.displayName} runtime binding ${options.bindingId}.${options.method} is not implemented`
  );
}

export function createDefaultPlatformInstanceApiBindingProvider(
  connectorId: PlatformConnectorId
): PlatformInstanceApiBindingProvider | null {
  return resolvePlatformPackInstanceApiBindingProvider(connectorId);
}

export function registerPlatformInstanceApiBindingProvider(
  provider: PlatformInstanceApiBindingProvider
): void {
  dynamicPlatformInstanceApiBindingProviders.set(provider.connectorId, provider);
}

export function unregisterPlatformInstanceApiBindingProvider(connectorId: string): boolean {
  const normalizedConnectorId = normalizePlatformConnectorId(connectorId);
  if (!normalizedConnectorId) return false;
  return dynamicPlatformInstanceApiBindingProviders.delete(normalizedConnectorId);
}

export function listPlatformInstanceApiBindingProviders(): PlatformInstanceApiBindingProvider[] {
  const providers = new Map<PlatformConnectorId, PlatformInstanceApiBindingProvider>();
  for (const provider of listPlatformPackInstanceApiBindingProviders()) {
    providers.set(provider.connectorId, provider);
  }
  for (const [connectorId, provider] of dynamicPlatformInstanceApiBindingProviders.entries()) {
    providers.set(connectorId, provider);
  }
  return Array.from(providers.values());
}

export async function invokePlatformInstanceApiBinding(
  options: PlatformInstanceApiBindingInvokeOptions,
  instanceId: string
): Promise<PlatformApiResult<unknown>> {
  const normalizedConnectorId = normalizePlatformConnectorId(options.connectorId);
  if (!normalizedConnectorId) {
    return err('INVALID_PAYLOAD', 'connectorId is required');
  }

  const bucketKey = resolveBucketBindingKey(options.bindingId);
  if (!bucketKey) {
    return err(
      'UNSUPPORTED_CAPABILITY',
      `${options.displayName} runtime binding ${options.bindingId}.${options.method} is not registered`
    );
  }

  const provider =
    dynamicPlatformInstanceApiBindingProviders.get(normalizedConnectorId) ??
    createDefaultPlatformInstanceApiBindingProvider(normalizedConnectorId);
  const bucket = provider?.[bucketKey];
  const handler = bucket?.[options.method];
  if (typeof handler !== 'function') {
    return createUnsupportedBindingResult(options);
  }

  try {
    const data = await handler({
      instanceId,
      options,
    });
    if (data === null && options.method === 'preparePlayback') {
      return err('API_UNAVAILABLE', `${options.displayName} playback preparation is unavailable`);
    }
    return ok(data);
  } catch (error) {
    if (isExpectedPlatformPackSidecarLifecycleError(error)) {
      return err(
        'RUNTIME_RELOADING',
        `${options.displayName} runtime is reloading, please retry in a moment`
      );
    }
    return err(
      isPlatformBindingPayloadError(error) ? 'INVALID_PAYLOAD' : 'API_UNAVAILABLE',
      error instanceof Error ? error.message : String(error)
    );
  }
}
