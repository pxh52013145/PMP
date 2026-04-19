import { isTauriRuntime } from '../../utils/tauriRuntime';
import {
  callPlatformFacadeBinding,
  type PlatformFacadeRuntimeBucket,
} from './platformFacadeBindingClient';
import type { PlatformConnectorId } from './platformConnectorModel';

export type PlatformConnectorFacadeBindingCallOptions<T> = {
  instanceId?: string | null;
  bindingId: string;
  method: string;
  payload?: Record<string, unknown>;
  runtimeBucket: PlatformFacadeRuntimeBucket;
  runtimeMethods?: string[];
  map: (value: unknown) => T | undefined;
};

export function normalizePlatformFacadeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizePlatformFacadePositiveInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function readPlatformFacadeFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function asPlatformFacadeRecord(
  value: unknown
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function resolvePlatformConnectorFacadeCacheScopeKey(
  connectorId: PlatformConnectorId,
  instanceId?: string | null
): string {
  const normalizedInstanceId = normalizePlatformFacadeString(instanceId);
  return normalizedInstanceId || connectorId;
}

function isAbsoluteFileSystemPath(value: string): boolean {
  return (
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.startsWith('/') ||
    value.startsWith('\\\\')
  );
}

function normalizePotentialEncodedFsPath(value: string): string {
  if (!value.includes('%')) {
    return value;
  }

  try {
    const decoded = decodeURIComponent(value);
    return isAbsoluteFileSystemPath(decoded) ? decoded : value;
  } catch {
    return value;
  }
}

export async function normalizePlatformFacadeAssetUrl(
  value: unknown
): Promise<string | undefined> {
  const normalizedRaw = normalizePlatformFacadeString(value);
  const normalized = normalizePotentialEncodedFsPath(normalizedRaw);
  if (!normalized) return undefined;

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(normalized) && !/^[a-zA-Z]:[\\/]/.test(normalized)) {
    return normalized;
  }

  if (isAbsoluteFileSystemPath(normalized)) {
    if (isTauriRuntime()) {
      const tauriApi = await import('@tauri-apps/api/tauri');
      if (typeof tauriApi.convertFileSrc === 'function') {
        return tauriApi.convertFileSrc(normalized);
      }
    }
  }

  return normalized;
}

export function createPlatformConnectorFacadeCaller(options: {
  connectorId: PlatformConnectorId;
  displayName: string;
}) {
  return async function callConnectorBinding<T>(
    bindingOptions: PlatformConnectorFacadeBindingCallOptions<T>
  ): Promise<T> {
    return callPlatformFacadeBinding<T>({
      connectorId: options.connectorId,
      displayName: options.displayName,
      instanceId: bindingOptions.instanceId,
      bindingId: bindingOptions.bindingId,
      method: bindingOptions.method,
      payload: bindingOptions.payload,
      runtimeBucket: bindingOptions.runtimeBucket,
      runtimeMethods: bindingOptions.runtimeMethods,
      map: bindingOptions.map,
    });
  };
}
