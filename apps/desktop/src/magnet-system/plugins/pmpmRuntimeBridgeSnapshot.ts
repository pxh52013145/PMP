import {
  PMPM_BRIDGE_VERSION,
  PMPM_DEFAULT_RUNTIME_ID,
  mapPmpmPermissionToCapabilityId,
} from '@pixel-matrix/plugin-compat-pmpm';
import type {
  RuntimeCarrier,
  RuntimeActivate,
  RuntimeHealthResponse,
  RuntimeHello,
  RuntimeInit,
  RuntimeKind,
  ViewMountRequest,
} from '@pixel-matrix/plugin-platform-contracts';
import { APP_VERSION } from '../../constants/versions';
import { FALLBACK_LOCALE, getLocale } from '../../i18n/core';
import { listPluginHostCapabilities } from './host-api';

const PMPM_COMPAT_CAPABILITY_VERSION = 'compat.pmpm.v1';

type PmpmRuntimeInitSnapshotOptions = {
  pluginId: string;
  runtimeInstanceId: string;
  permissions: Iterable<string>;
  startupTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  unresponsiveTimeoutMs?: number;
  runtimeId?: string;
  hostId?: 'pmp';
  hostVersion?: string;
  trustLevel?: string;
};

type PmpmRuntimeHelloSnapshotOptions = {
  pluginId: string;
  runtimeInstanceId: string;
  runtimeKind: RuntimeKind;
  carrier: RuntimeCarrier;
  supportsViewMount: boolean;
  supportedDataPlanes?: RuntimeHello['supportedDataPlanes'];
  runtimeId?: string;
};

type PmpmRuntimeHealthSnapshotOptions = {
  pluginId: string;
  runtimeInstanceId: string;
  runtimeId?: string;
  requestId?: string;
  ready?: boolean;
  status?: RuntimeHealthResponse['status'];
  message?: string;
};

type PmpmRuntimeCompatSurfaceKind =
  | 'magnet'
  | 'settings'
  | 'page'
  | 'visualizer'
  | 'window'
  | 'command';

type PmpmRuntimeBridgeSurfaceOptions = {
  pluginId: string;
  runtimeInstanceId: string;
  kind: PmpmRuntimeCompatSurfaceKind;
  surfaceId?: string | null;
  mountContext?: unknown;
  commandArgs?: unknown;
  runtimeId?: string;
};

const VIEW_TYPE_BY_SURFACE: Record<
  Exclude<PmpmRuntimeCompatSurfaceKind, 'command'>,
  string
> = {
  magnet: 'magnet',
  settings: 'settings-panel',
  page: 'page',
  visualizer: 'visualizer',
  window: 'window',
};

const SURFACE_SLOT_BY_SURFACE: Record<
  Exclude<PmpmRuntimeCompatSurfaceKind, 'command'>,
  string
> = {
  magnet: 'host.pmp.surface.magnet',
  settings: 'host.pmp.surface.settings-panel',
  page: 'host.pmp.surface.page',
  visualizer: 'host.pmp.surface.visualizer',
  window: 'host.pmp.surface.window',
};

const PMPM_COMPAT_DATA_PLANES: NonNullable<RuntimeHello['supportedDataPlanes']> = ['inline-json'];

function normalizePositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function listGrantedCapabilities(
  permissions: Iterable<string>
): RuntimeInit['grantedCapabilities'] {
  const knownCapabilities = new Map(
    listPluginHostCapabilities().map((capability) => [capability.id, capability.version] as const)
  );
  const seen = new Set<string>();
  const granted: RuntimeInit['grantedCapabilities'] = [];

  for (const permission of permissions) {
    if (typeof permission !== 'string') continue;
    const normalizedPermission = permission.trim();
    if (!normalizedPermission) continue;

    const capabilityId = mapPmpmPermissionToCapabilityId(normalizedPermission);
    if (seen.has(capabilityId)) continue;
    seen.add(capabilityId);

    granted.push({
      capabilityId,
      version: knownCapabilities.get(capabilityId) ?? PMPM_COMPAT_CAPABILITY_VERSION,
      mode: 'required',
    });
  }

  return granted;
}

function resolveRuntimeId(runtimeId?: string): string {
  return runtimeId ?? PMPM_DEFAULT_RUNTIME_ID;
}

function buildCompatSurfacePayload(options: PmpmRuntimeBridgeSurfaceOptions): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    surface: options.kind,
    surfaceId: options.surfaceId ?? null,
  };

  if (typeof options.mountContext !== 'undefined') {
    payload.mountContext = options.mountContext;
  }

  if (options.kind === 'command') {
    payload.commandId = options.surfaceId ?? options.pluginId;
    payload.args = options.commandArgs;
  }

  return payload;
}

function resolveViewId(options: PmpmRuntimeBridgeSurfaceOptions): string {
  if (options.kind === 'magnet') {
    return options.pluginId;
  }

  const normalizedSurfaceId =
    typeof options.surfaceId === 'string' ? options.surfaceId.trim() : '';
  return normalizedSurfaceId.length > 0 ? normalizedSurfaceId : options.pluginId;
}

export function buildPmpmRuntimeInitSnapshot(
  options: PmpmRuntimeInitSnapshotOptions
): RuntimeInit {
  const startupTimeoutMs = normalizePositiveInt(options.startupTimeoutMs);
  const heartbeatIntervalMs = normalizePositiveInt(options.heartbeatIntervalMs);
  const unresponsiveTimeoutMs = normalizePositiveInt(options.unresponsiveTimeoutMs);

  return {
    bridgeVersion: PMPM_BRIDGE_VERSION,
    op: 'runtime.init',
    pluginId: options.pluginId,
    runtimeId: options.runtimeId ?? PMPM_DEFAULT_RUNTIME_ID,
    runtimeInstanceId: options.runtimeInstanceId,
    hostId: options.hostId ?? 'pmp',
    hostVersion: options.hostVersion ?? APP_VERSION,
    trustLevel: options.trustLevel ?? 'sandboxed',
    grantedCapabilities: listGrantedCapabilities(options.permissions),
    runtimePolicy:
      startupTimeoutMs || heartbeatIntervalMs || unresponsiveTimeoutMs
        ? {
            startupTimeoutMs,
            heartbeatIntervalMs,
            unresponsiveTimeoutMs,
          }
        : undefined,
    locale: {
      active: getLocale(),
      fallback: FALLBACK_LOCALE,
    },
  };
}

export function buildPmpmRuntimeHelloSnapshot(
  options: PmpmRuntimeHelloSnapshotOptions
): RuntimeHello {
  return {
    bridgeVersion: PMPM_BRIDGE_VERSION,
    op: 'runtime.hello',
    pluginId: options.pluginId,
    runtimeId: resolveRuntimeId(options.runtimeId),
    runtimeInstanceId: options.runtimeInstanceId,
    supportedBridgeVersions: [PMPM_BRIDGE_VERSION],
    runtimeKind: options.runtimeKind,
    carrier: options.carrier,
    supportsViewMount: options.supportsViewMount,
    supportedDataPlanes: [...(options.supportedDataPlanes ?? PMPM_COMPAT_DATA_PLANES)],
  };
}

export function buildPmpmRuntimeActivateSnapshot(
  options: PmpmRuntimeBridgeSurfaceOptions
): RuntimeActivate {
  return {
    bridgeVersion: PMPM_BRIDGE_VERSION,
    op: 'runtime.activate',
    pluginId: options.pluginId,
    runtimeId: resolveRuntimeId(options.runtimeId),
    runtimeInstanceId: options.runtimeInstanceId,
    cause: options.kind === 'command' ? 'command' : 'view',
    payload: buildCompatSurfacePayload(options),
  };
}

export function buildPmpmRuntimeHealthSnapshot(
  options: PmpmRuntimeHealthSnapshotOptions
): RuntimeHealthResponse {
  return {
    bridgeVersion: PMPM_BRIDGE_VERSION,
    op: 'runtime.health.response',
    pluginId: options.pluginId,
    runtimeId: resolveRuntimeId(options.runtimeId),
    runtimeInstanceId: options.runtimeInstanceId,
    requestId: options.requestId ?? `runtime-health:${options.runtimeInstanceId}`,
    ready: options.ready ?? true,
    status: options.status ?? 'healthy',
    message: options.message,
  };
}

export function buildPmpmViewMountRequestSnapshot(
  options: PmpmRuntimeBridgeSurfaceOptions
): ViewMountRequest | null {
  if (options.kind === 'command') {
    return null;
  }

  const viewType = VIEW_TYPE_BY_SURFACE[options.kind];
  const viewId = resolveViewId(options);
  const viewInstanceId = `${options.runtimeInstanceId}:${viewType}:${viewId}`;

  return {
    bridgeVersion: PMPM_BRIDGE_VERSION,
    op: 'view.mount.request',
    pluginId: options.pluginId,
    runtimeId: resolveRuntimeId(options.runtimeId),
    runtimeInstanceId: options.runtimeInstanceId,
    requestId: `view-mount:${viewInstanceId}`,
    viewInstanceId,
    viewId,
    viewType,
    surfaceSlot: SURFACE_SLOT_BY_SURFACE[options.kind],
    props: buildCompatSurfacePayload(options),
  };
}
