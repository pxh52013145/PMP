import {
  normalizePlatformConnectorId,
  type PlatformConnectorId,
} from './platformConnectorModel';
import {
  listPlatformPackAuthAdapters,
  resolvePlatformPackAuthAdapter,
} from './platformPackRegistry';

export type PlatformInstanceAuthAdapterSnapshot = {
  authState?: unknown;
  accountUid?: unknown;
  updatedAtMs?: unknown;
  expiresAtMs?: unknown;
  availability?: unknown;
  availabilityMessage?: unknown;
};

export type PlatformInstanceAuthAdapterQrSession = {
  sessionId?: unknown;
  qrcodeKey?: unknown;
  qrKey?: unknown;
  qrUrl?: unknown;
  qrImageDataUrl?: unknown;
  generatedAtMs?: unknown;
  expiresAtMs?: unknown;
};

export type PlatformInstanceAuthAdapterQrPollResult = {
  sessionId?: unknown;
  state?: unknown;
  stateCode?: unknown;
  stateMessage?: unknown;
  authState?: unknown;
  accountUid?: unknown;
  expiresAtMs?: unknown;
};

export interface PlatformInstanceAuthAdapter {
  connectorId: PlatformConnectorId;
  getSnapshot: (
    instanceId: string
  ) => Promise<PlatformInstanceAuthAdapterSnapshot | null>;
  refreshSnapshot?: (
    instanceId: string
  ) => Promise<PlatformInstanceAuthAdapterSnapshot | null>;
  beginQrLogin?: (
    instanceId: string
  ) => Promise<PlatformInstanceAuthAdapterQrSession | null>;
  pollQrLogin?: (
    sessionId: string
  ) => Promise<PlatformInstanceAuthAdapterQrPollResult | null>;
  logout?: (
    instanceId: string
  ) => Promise<PlatformInstanceAuthAdapterSnapshot | null>;
  clearAuthCookies?: (
    instanceId: string
  ) => Promise<PlatformInstanceAuthAdapterSnapshot | null>;
  invalidateConnectorCaches?: (instanceId: string) => Promise<void> | void;
}

export type CreatePlatformInstanceAuthAdapterOptions = {
  connectorId: PlatformConnectorId;
  getSnapshot: (
    instanceId: string
  ) => Promise<PlatformInstanceAuthAdapterSnapshot | null>;
  refreshSnapshot?: (
    instanceId: string
  ) => Promise<PlatformInstanceAuthAdapterSnapshot | null>;
  beginQrLogin?: (
    instanceId: string
  ) => Promise<PlatformInstanceAuthAdapterQrSession | null>;
  pollQrLogin?: (
    sessionId: string
  ) => Promise<PlatformInstanceAuthAdapterQrPollResult | null>;
  logout?: (
    instanceId: string
  ) => Promise<PlatformInstanceAuthAdapterSnapshot | null>;
  clearAuthCookies?: (
    instanceId: string
  ) => Promise<PlatformInstanceAuthAdapterSnapshot | null>;
  invalidateConnectorCaches?: (instanceId: string) => Promise<void> | void;
};

const dynamicPlatformInstanceAuthAdapters = new Map<
  PlatformConnectorId,
  PlatformInstanceAuthAdapter
>();

export function createPlatformInstanceAuthAdapter(
  options: CreatePlatformInstanceAuthAdapterOptions
): PlatformInstanceAuthAdapter {
  return {
    connectorId: options.connectorId,
    getSnapshot: options.getSnapshot,
    refreshSnapshot: options.refreshSnapshot ?? options.getSnapshot,
    beginQrLogin: options.beginQrLogin,
    pollQrLogin: options.pollQrLogin,
    logout: options.logout,
    clearAuthCookies: options.clearAuthCookies,
    invalidateConnectorCaches: options.invalidateConnectorCaches,
  };
}

export function getPlatformInstanceAuthAdapter(
  connectorId: string
): PlatformInstanceAuthAdapter | null {
  const normalizedConnectorId = normalizePlatformConnectorId(connectorId);
  if (!normalizedConnectorId) return null;

  return (
    dynamicPlatformInstanceAuthAdapters.get(normalizedConnectorId) ??
    resolvePlatformPackAuthAdapter(normalizedConnectorId) ??
    null
  );
}

export function registerPlatformInstanceAuthAdapter(
  adapter: PlatformInstanceAuthAdapter
): void {
  dynamicPlatformInstanceAuthAdapters.set(adapter.connectorId, adapter);
}

export function unregisterPlatformInstanceAuthAdapter(connectorId: string): boolean {
  const normalizedConnectorId = normalizePlatformConnectorId(connectorId);
  if (!normalizedConnectorId) return false;
  return dynamicPlatformInstanceAuthAdapters.delete(normalizedConnectorId);
}

export function listPlatformInstanceAuthAdapters(): PlatformInstanceAuthAdapter[] {
  const adapters = new Map<PlatformConnectorId, PlatformInstanceAuthAdapter>();
  for (const adapter of listPlatformPackAuthAdapters()) {
    adapters.set(adapter.connectorId, adapter);
  }
  for (const [connectorId, adapter] of dynamicPlatformInstanceAuthAdapters.entries()) {
    adapters.set(connectorId, adapter);
  }
  return Array.from(adapters.values());
}
