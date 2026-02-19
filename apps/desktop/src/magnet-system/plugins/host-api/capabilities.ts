import { HOST_API_VERSION } from '../../../constants/versions';

export type PluginHostCapabilityInfo = {
  id: string;
  version: string;
  permission?: string;
  description?: string;
  experimental?: boolean;
};

export type PluginHostCapabilityInvokeContext = {
  pluginId: string;
  hostLabel: string;
  permissions: ReadonlySet<string>;
};

export type PluginHostCapabilityInvokeRequest = {
  method: string;
  payload: unknown;
  context: PluginHostCapabilityInvokeContext;
};

export type PluginHostCapabilityHandler = (
  request: PluginHostCapabilityInvokeRequest
) => Promise<unknown> | unknown;

export type PluginHostCapabilityRegistration = PluginHostCapabilityInfo & {
  handler?: PluginHostCapabilityHandler;
};

type PluginHostCapabilityEntry = PluginHostCapabilityRegistration & {
  source: 'builtin' | 'runtime';
};

const entries = new Map<string, PluginHostCapabilityEntry>();
let initialized = false;

const BUILTIN_CAPABILITIES: PluginHostCapabilityRegistration[] = [
  {
    id: 'core.host-api',
    version: HOST_API_VERSION,
    description: 'Core PMPM host API surface',
  },
  {
    id: 'foundation.capability-registry',
    version: '1.0.0',
    permission: 'api:host',
    description: 'Capability discovery and invocation contract',
  },
  {
    id: 'foundation.ai-adapter',
    version: '0.1.0',
    permission: 'api:ai-runtime',
    experimental: true,
    description: 'Reserved capability namespace for AI runtime adapters',
  },
  {
    id: 'foundation.desktop-pet-runtime',
    version: '0.1.0',
    permission: 'api:desktop-pet',
    experimental: true,
    description: 'Reserved capability namespace for desktop companion runtime',
  },
  {
    id: 'foundation.voice-training-runtime',
    version: '0.1.0',
    permission: 'api:voice-training',
    experimental: true,
    description: 'Reserved capability namespace for voice training/runtime tasks',
  },
];

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

function toCapabilityInfo(entry: PluginHostCapabilityEntry): PluginHostCapabilityInfo {
  return {
    id: entry.id,
    version: entry.version,
    permission: entry.permission,
    description: entry.description,
    experimental: entry.experimental,
  };
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

