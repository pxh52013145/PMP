import { HOST_API_VERSION } from '../../../constants/versions';
import { hasPermission } from './permissions';
import type {
  PluginHostCapabilityHandler,
  PluginHostCapabilityInfo,
  PluginHostCapabilityInvokeRequest,
  PluginHostCapabilityRegistration,
  PluginHostCapabilityResult,
} from './types';

type PluginHostCapabilityEntry = PluginHostCapabilityRegistration & {
  source: 'builtin' | 'runtime';
};

const entries = new Map<string, PluginHostCapabilityEntry>();
let initialized = false;

function resultOk<T>(data: T): PluginHostCapabilityResult<T> {
  return {
    ok: true,
    data,
  };
}

function resultError(
  code: string,
  message: string,
  options?: { retryable?: boolean; details?: unknown }
): PluginHostCapabilityResult {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: options?.retryable,
      details: options?.details,
    },
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function toCapabilityInfo(entry: PluginHostCapabilityEntry): PluginHostCapabilityInfo {
  return {
    id: entry.id,
    version: entry.version,
    permission: entry.permission,
    description: entry.description,
    experimental: entry.experimental,
  };
}

function isVisibleToCaller(
  entry: PluginHostCapabilityEntry,
  permissions: ReadonlySet<string>
): boolean {
  if (!entry.permission) return true;
  return hasPermission(permissions, entry.permission);
}

function listVisibleCapabilities(permissions: ReadonlySet<string>): PluginHostCapabilityInfo[] {
  return Array.from(entries.values())
    .filter((entry) => isVisibleToCaller(entry, permissions))
    .map(toCapabilityInfo)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function assertCapabilityId(id: string): void {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(id)) {
    throw new Error(`Invalid capability id: "${id}"`);
  }
}

function assertVersion(version: string): void {
  if (typeof version !== 'string' || version.trim().length < 1) {
    throw new Error('Capability version is required');
  }
}

function createReservedRuntimeHandler(
  capabilityId: string,
  domain: string,
  stage: 'planning' | 'prototype'
): PluginHostCapabilityHandler {
  return async (request) => {
    switch (request.method) {
      case 'describe':
        return resultOk({
          capabilityId,
          domain,
          stage,
          ready: false,
          implementation: 'reserved',
        });
      case 'health':
        return resultOk({
          capabilityId,
          status: 'idle',
          ready: false,
          reason: 'not-configured',
        });
      default:
        return resultError('NOT_IMPLEMENTED', `${capabilityId}.${request.method} is not implemented`);
    }
  };
}

function createRegistryHandler(): PluginHostCapabilityHandler {
  return async (request) => {
    switch (request.method) {
      case 'list': {
        return resultOk(listVisibleCapabilities(request.context.permissions));
      }
      case 'get': {
        const payload = asObject(request.payload);
        const capabilityId = asNonEmptyString(payload?.id);
        if (!capabilityId) {
          return resultError('INVALID_PAYLOAD', 'payload.id is required');
        }

        const entry = entries.get(capabilityId);
        if (!entry) {
          return resultError('NOT_FOUND', `Unknown capability: ${capabilityId}`);
        }

        if (!isVisibleToCaller(entry, request.context.permissions)) {
          return resultError('FORBIDDEN', `Permission denied for capability: ${capabilityId}`);
        }

        return resultOk(toCapabilityInfo(entry));
      }
      case 'has': {
        const payload = asObject(request.payload);
        const capabilityId = asNonEmptyString(payload?.id);
        if (!capabilityId) {
          return resultError('INVALID_PAYLOAD', 'payload.id is required');
        }

        const entry = entries.get(capabilityId);
        const visible = Boolean(entry && isVisibleToCaller(entry, request.context.permissions));
        return resultOk({ id: capabilityId, visible });
      }
      default:
        return resultError(
          'METHOD_NOT_SUPPORTED',
          `Unsupported registry method: ${request.method}`
        );
    }
  };
}

const BUILTIN_CAPABILITIES: PluginHostCapabilityRegistration[] = [
  {
    id: 'core.host-api',
    version: HOST_API_VERSION,
    description: 'Core PMPM host API surface',
  },
  {
    id: 'foundation.capability-registry',
    version: '1.1.0',
    permission: 'api:host',
    description: 'Capability discovery and invocation contract',
    handler: createRegistryHandler(),
  },
  {
    id: 'foundation.ai-adapter',
    version: '0.2.0',
    permission: 'api:ai-runtime',
    experimental: true,
    description: 'Reserved capability namespace for AI runtime adapters',
    handler: createReservedRuntimeHandler('foundation.ai-adapter', 'ai-runtime', 'planning'),
  },
  {
    id: 'foundation.desktop-pet-runtime',
    version: '0.2.0',
    permission: 'api:desktop-pet',
    experimental: true,
    description: 'Reserved capability namespace for desktop companion runtime',
    handler: createReservedRuntimeHandler(
      'foundation.desktop-pet-runtime',
      'desktop-pet',
      'planning'
    ),
  },
  {
    id: 'foundation.voice-training-runtime',
    version: '0.2.0',
    permission: 'api:voice-training',
    experimental: true,
    description: 'Reserved capability namespace for voice training/runtime tasks',
    handler: createReservedRuntimeHandler(
      'foundation.voice-training-runtime',
      'voice-training',
      'prototype'
    ),
  },
];

function bootstrapBuiltins(): void {
  if (initialized) return;
  initialized = true;

  for (const builtin of BUILTIN_CAPABILITIES) {
    entries.set(builtin.id, {
      ...builtin,
      source: 'builtin',
    });
  }
}

export function listPluginHostCapabilities(): PluginHostCapabilityInfo[] {
  bootstrapBuiltins();
  return Array.from(entries.values())
    .map(toCapabilityInfo)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function getPluginHostCapability(capabilityId: string): PluginHostCapabilityInfo | null {
  bootstrapBuiltins();
  const entry = entries.get(capabilityId);
  if (!entry) return null;
  return toCapabilityInfo(entry);
}

export async function invokePluginHostCapability(
  capabilityId: string,
  request: PluginHostCapabilityInvokeRequest
): Promise<unknown> {
  bootstrapBuiltins();
  const entry = entries.get(capabilityId);
  if (!entry) {
    throw new Error(`Unknown host capability: ${capabilityId}`);
  }
  if (typeof entry.handler !== 'function') {
    throw new Error(`Host capability is not invokable: ${capabilityId}`);
  }
  return await entry.handler(request);
}

export function registerPluginHostCapability(
  registration: PluginHostCapabilityRegistration
): () => void {
  bootstrapBuiltins();

  const id = typeof registration.id === 'string' ? registration.id.trim() : '';
  const version = typeof registration.version === 'string' ? registration.version.trim() : '';

  assertCapabilityId(id);
  assertVersion(version);

  if (entries.has(id)) {
    throw new Error(`Plugin host capability already exists: ${id}`);
  }

  entries.set(id, {
    ...registration,
    id,
    version,
    source: 'runtime',
  });

  return () => {
    const current = entries.get(id);
    if (!current || current.source !== 'runtime') return;
    entries.delete(id);
  };
}
