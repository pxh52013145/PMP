import {
  DEFAULT_EXTENSION_RUNTIME_ID,
  EXTENSION_BRIDGE_VERSION,
  mapPermissionToCapabilityId,
} from '@pixel-matrix/plugin-platform-contracts';
import type {
  CapabilityRevoke,
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
import {
  getPmpHostCapabilityPackDescriptor,
  listPmpHostCapabilityFamilies,
  listPluginHostCapabilities,
} from './host-api';

const SANDBOX_CAPABILITY_VERSION = 'pxp.capability.v1';

type RuntimeInitSnapshotOptions = {
  pluginId: string;
  runtimeInstanceId: string;
  permissions: Iterable<string>;
  manifestPermissions?: Iterable<string>;
  deniedPermissions?: Iterable<string>;
  requiredPermissions?: Iterable<string>;
  optionalPermissions?: Iterable<string>;
  startupTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  unresponsiveTimeoutMs?: number;
  runtimeId?: string;
  hostId?: 'pmp';
  hostVersion?: string;
  trustLevel?: string;
};

type RuntimeHelloSnapshotOptions = {
  pluginId: string;
  runtimeInstanceId: string;
  runtimeKind: RuntimeKind;
  carrier: RuntimeCarrier;
  supportsViewMount: boolean;
  supportedDataPlanes?: RuntimeHello['supportedDataPlanes'];
  runtimeId?: string;
};

type RuntimeHealthSnapshotOptions = {
  pluginId: string;
  runtimeInstanceId: string;
  runtimeId?: string;
  requestId?: string;
  ready?: boolean;
  status?: RuntimeHealthResponse['status'];
  message?: string;
};

type RuntimeCapabilityRevokeDrillSnapshotOptions = {
  pluginId: string;
  runtimeInstanceId: string;
  capabilityIds?: Iterable<string>;
  requestId?: string;
  reason?: string;
  runtimeId?: string;
};

type RuntimeBridgeSurfaceKind =
  | 'magnet'
  | 'settings'
  | 'page'
  | 'visualizer'
  | 'window'
  | 'overlay'
  | 'desktop-widget'
  | 'command';

type RuntimeBridgeSurfaceOptions = {
  pluginId: string;
  runtimeInstanceId: string;
  kind: RuntimeBridgeSurfaceKind;
  surfaceId?: string | null;
  mountContext?: unknown;
  commandArgs?: unknown;
  runtimeId?: string;
};

const VIEW_TYPE_BY_SURFACE: Record<Exclude<RuntimeBridgeSurfaceKind, 'command'>, string> = {
  magnet: 'magnet',
  settings: 'settings-panel',
  page: 'page',
  visualizer: 'visualizer',
  window: 'window',
  overlay: 'overlay',
  'desktop-widget': 'desktop-widget',
};

const SURFACE_SLOT_BY_SURFACE: Record<Exclude<RuntimeBridgeSurfaceKind, 'command'>, string> = {
  magnet: 'host.pmp.surface.magnet',
  settings: 'host.pmp.surface.settings-panel',
  page: 'host.pmp.surface.page',
  visualizer: 'host.pmp.surface.visualizer',
  window: 'host.pmp.surface.window',
  overlay: 'host.pmp.surface.overlay',
  'desktop-widget': 'host.pmp.surface.desktop-widget',
};

const SANDBOX_DATA_PLANES: NonNullable<RuntimeHello['supportedDataPlanes']> = ['inline-json'];

function normalizePositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function normalizePermissionList(permissions?: Iterable<string>): string[] {
  if (!permissions) return [];
  const normalized = new Set<string>();
  for (const permission of permissions) {
    if (typeof permission !== 'string') continue;
    const trimmed = permission.trim();
    if (!trimmed) continue;
    normalized.add(trimmed);
  }
  return Array.from(normalized.values());
}

function normalizeCapabilityIdList(capabilityIds?: Iterable<string>): string[] {
  if (!capabilityIds) return [];
  const normalized = new Set<string>();
  for (const capabilityId of capabilityIds) {
    if (typeof capabilityId !== 'string') continue;
    const trimmed = capabilityId.trim();
    if (!trimmed) continue;
    normalized.add(trimmed);
  }
  return Array.from(normalized.values());
}

function normalizeHostCapabilityFamilyIds(familyIds: Iterable<string>): string[] {
  const normalized = new Set<string>();
  for (const familyId of familyIds) {
    if (typeof familyId !== 'string') continue;
    const trimmed = familyId.trim();
    if (!trimmed.startsWith('host.pmp.')) continue;
    normalized.add(trimmed);
  }
  return Array.from(normalized.values()).sort((left, right) => left.localeCompare(right));
}

function resolveHostCapabilityFamilyId(
  capabilityId: string,
  familyIds: readonly string[]
): string | null {
  if (!capabilityId.startsWith('host.pmp.')) return null;
  for (const familyId of familyIds) {
    if (capabilityId === familyId || capabilityId.startsWith(`${familyId}.`)) {
      return familyId;
    }
  }
  return null;
}

function assertHostCapabilityPackNegotiation(
  descriptorFamilyIds: readonly string[],
  exportedFamilyIds: readonly string[]
): void {
  const descriptorFamilies = new Set(descriptorFamilyIds);
  const exportedFamilies = new Set(exportedFamilyIds);

  for (const familyId of descriptorFamilies) {
    if (exportedFamilies.has(familyId)) continue;
    throw new Error(
      `Host capability pack negotiation failed: descriptor family not exported (${familyId})`
    );
  }

  for (const familyId of exportedFamilies) {
    if (descriptorFamilies.has(familyId)) continue;
    throw new Error(
      `Host capability pack negotiation failed: exported family not declared (${familyId})`
    );
  }
}

function resolveNegotiatedCapabilityVersion(
  capabilityId: string,
  permission: string,
  knownCapabilities: ReadonlyMap<string, string>,
  descriptorFamilyIds: readonly string[]
): string {
  const knownVersion = knownCapabilities.get(capabilityId);

  if (capabilityId.startsWith('host.pmp.')) {
    const familyId = resolveHostCapabilityFamilyId(capabilityId, descriptorFamilyIds);
    if (!familyId) {
      throw new Error(
        `Host capability negotiation failed: ${capabilityId} from permission ${permission} is outside declared host pack families`
      );
    }
    if (!knownVersion) {
      throw new Error(
        `Host capability negotiation failed: ${capabilityId} from permission ${permission} is not registered`
      );
    }
    return knownVersion;
  }

  if (capabilityId.startsWith('core.')) {
    if (!knownVersion) {
      throw new Error(
        `Core capability negotiation failed: ${capabilityId} from permission ${permission} is not registered`
      );
    }
    return knownVersion;
  }

  return knownVersion ?? SANDBOX_CAPABILITY_VERSION;
}

function resolveCapabilityGrantMode(
  permission: string,
  capabilityId: string,
  requiredPermissions: ReadonlySet<string>,
  optionalPermissions: ReadonlySet<string>
): 'required' | 'optional' {
  if (requiredPermissions.has(permission)) {
    return 'required';
  }
  if (optionalPermissions.has(permission)) {
    return 'optional';
  }
  if (capabilityId.startsWith('core.')) {
    return 'required';
  }
  return 'optional';
}

function collectNegotiatedGrantedPermissions(options: {
  permissions: Iterable<string>;
  manifestPermissions?: Iterable<string>;
  deniedPermissions?: Iterable<string>;
}): string[] {
  const grantedPermissions = normalizePermissionList(options.permissions);
  const manifestPermissions = normalizePermissionList(options.manifestPermissions);
  const deniedPermissions = new Set(normalizePermissionList(options.deniedPermissions));
  const grantedSet = new Set(grantedPermissions);
  const orderedDeclaredPermissions =
    manifestPermissions.length > 0 ? manifestPermissions : grantedPermissions;

  const negotiated = new Set<string>();
  for (const permission of orderedDeclaredPermissions) {
    if (deniedPermissions.has(permission)) continue;
    if (!grantedSet.has(permission)) continue;
    negotiated.add(permission);
  }

  for (const permission of grantedPermissions) {
    if (deniedPermissions.has(permission)) continue;
    negotiated.add(permission);
  }

  return Array.from(negotiated.values());
}

function listGrantedCapabilities(
  options: Pick<
    RuntimeInitSnapshotOptions,
    | 'permissions'
    | 'manifestPermissions'
    | 'deniedPermissions'
    | 'requiredPermissions'
    | 'optionalPermissions'
  >
): RuntimeInit['grantedCapabilities'] {
  const hostCapabilityPack = getPmpHostCapabilityPackDescriptor();
  if (hostCapabilityPack.hostId !== 'pmp') {
    throw new Error(
      `Host capability pack negotiation failed: unsupported host id ${hostCapabilityPack.hostId}`
    );
  }
  if (!hostCapabilityPack.packVersion.trim()) {
    throw new Error('Host capability pack negotiation failed: packVersion is required');
  }
  if (!hostCapabilityPack.coreCompatibility.trim()) {
    throw new Error('Host capability pack negotiation failed: coreCompatibility is required');
  }

  const descriptorFamilyIds = normalizeHostCapabilityFamilyIds(
    hostCapabilityPack.capabilityFamilies
  );
  const exportedFamilyIds = normalizeHostCapabilityFamilyIds(listPmpHostCapabilityFamilies());
  assertHostCapabilityPackNegotiation(descriptorFamilyIds, exportedFamilyIds);

  const knownCapabilities = new Map(
    listPluginHostCapabilities().map((capability) => [capability.id, capability.version] as const)
  );
  const requiredPermissions = new Set(normalizePermissionList(options.requiredPermissions));
  const optionalPermissions = new Set(normalizePermissionList(options.optionalPermissions));
  const negotiatedPermissions = collectNegotiatedGrantedPermissions(options);
  const seen = new Set<string>();
  const granted: RuntimeInit['grantedCapabilities'] = [];

  for (const permission of negotiatedPermissions) {
    const capabilityId = mapPermissionToCapabilityId(permission);
    if (seen.has(capabilityId)) continue;
    seen.add(capabilityId);

    granted.push({
      capabilityId,
      version: resolveNegotiatedCapabilityVersion(
        capabilityId,
        permission,
        knownCapabilities,
        descriptorFamilyIds
      ),
      mode: resolveCapabilityGrantMode(
        permission,
        capabilityId,
        requiredPermissions,
        optionalPermissions
      ),
    });
  }

  return granted;
}

function resolveRuntimeId(runtimeId?: string): string {
  return runtimeId ?? DEFAULT_EXTENSION_RUNTIME_ID;
}

function buildSurfacePayload(
  options: RuntimeBridgeSurfaceOptions
): Record<string, unknown> {
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

function resolveViewId(options: RuntimeBridgeSurfaceOptions): string {
  if (options.kind === 'magnet') {
    return options.pluginId;
  }

  const normalizedSurfaceId = typeof options.surfaceId === 'string' ? options.surfaceId.trim() : '';
  return normalizedSurfaceId.length > 0 ? normalizedSurfaceId : options.pluginId;
}

export function buildRuntimeInitSnapshot(options: RuntimeInitSnapshotOptions): RuntimeInit {
  const startupTimeoutMs = normalizePositiveInt(options.startupTimeoutMs);
  const heartbeatIntervalMs = normalizePositiveInt(options.heartbeatIntervalMs);
  const unresponsiveTimeoutMs = normalizePositiveInt(options.unresponsiveTimeoutMs);

  return {
    bridgeVersion: EXTENSION_BRIDGE_VERSION,
    op: 'runtime.init',
    pluginId: options.pluginId,
    runtimeId: options.runtimeId ?? DEFAULT_EXTENSION_RUNTIME_ID,
    runtimeInstanceId: options.runtimeInstanceId,
    hostId: options.hostId ?? 'pmp',
    hostVersion: options.hostVersion ?? APP_VERSION,
    trustLevel: options.trustLevel ?? 'sandboxed',
    grantedCapabilities: listGrantedCapabilities(options),
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

export function buildRuntimeCapabilityRevokeDrillSnapshot(
  options: RuntimeCapabilityRevokeDrillSnapshotOptions
): CapabilityRevoke {
  const capabilityIds = normalizeCapabilityIdList(options.capabilityIds);
  return {
    bridgeVersion: EXTENSION_BRIDGE_VERSION,
    op: 'runtime.capabilities.revoke',
    pluginId: options.pluginId,
    runtimeId: resolveRuntimeId(options.runtimeId),
    runtimeInstanceId: options.runtimeInstanceId,
    requestId: options.requestId ?? `runtime-capability-revoke:${options.runtimeInstanceId}`,
    capabilityIds: capabilityIds.length > 0 ? capabilityIds : ['pxp.permission.noop'],
    reason: options.reason ?? 'sandbox-drill:no-op',
  };
}

export function buildRuntimeHelloSnapshot(
  options: RuntimeHelloSnapshotOptions
): RuntimeHello {
  return {
    bridgeVersion: EXTENSION_BRIDGE_VERSION,
    op: 'runtime.hello',
    pluginId: options.pluginId,
    runtimeId: resolveRuntimeId(options.runtimeId),
    runtimeInstanceId: options.runtimeInstanceId,
    supportedBridgeVersions: [EXTENSION_BRIDGE_VERSION],
    runtimeKind: options.runtimeKind,
    carrier: options.carrier,
    supportsViewMount: options.supportsViewMount,
    supportedDataPlanes: [...(options.supportedDataPlanes ?? SANDBOX_DATA_PLANES)],
  };
}

export function buildRuntimeActivateSnapshot(
  options: RuntimeBridgeSurfaceOptions
): RuntimeActivate {
  return {
    bridgeVersion: EXTENSION_BRIDGE_VERSION,
    op: 'runtime.activate',
    pluginId: options.pluginId,
    runtimeId: resolveRuntimeId(options.runtimeId),
    runtimeInstanceId: options.runtimeInstanceId,
    cause: options.kind === 'command' ? 'command' : 'view',
    payload: buildSurfacePayload(options),
  };
}

export function buildRuntimeHealthSnapshot(
  options: RuntimeHealthSnapshotOptions
): RuntimeHealthResponse {
  return {
    bridgeVersion: EXTENSION_BRIDGE_VERSION,
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

export function buildViewMountRequestSnapshot(
  options: RuntimeBridgeSurfaceOptions
): ViewMountRequest | null {
  if (options.kind === 'command') {
    return null;
  }

  const viewType = VIEW_TYPE_BY_SURFACE[options.kind];
  const viewId = resolveViewId(options);
  const viewInstanceId = `${options.runtimeInstanceId}:${viewType}:${viewId}`;

  return {
    bridgeVersion: EXTENSION_BRIDGE_VERSION,
    op: 'view.mount.request',
    pluginId: options.pluginId,
    runtimeId: resolveRuntimeId(options.runtimeId),
    runtimeInstanceId: options.runtimeInstanceId,
    requestId: `view-mount:${viewInstanceId}`,
    viewInstanceId,
    viewId,
    viewType,
    surfaceSlot: SURFACE_SLOT_BY_SURFACE[options.kind],
    props: buildSurfacePayload(options),
  };
}
