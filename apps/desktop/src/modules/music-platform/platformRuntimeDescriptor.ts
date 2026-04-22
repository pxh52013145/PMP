import type {
  PlatformCompatAvailability,
  PlatformCompatRuntimeApi,
  PlatformCompatRuntimeAuthState,
  PlatformInstanceRecord,
} from '@pixel-matrix/plugin-platform-contracts';

import {
  listPlatformCompatRegistryRecords,
  type PlatformCompatRegistryRecord,
} from './contractRegistry';
import { listPlatformConnectorDefinitions } from './connectorAuth';
import { getPlatformInstance, listPlatformInstances } from './instanceRegistry';
import { getPlatformImportedInstanceRecord } from './platformImportedInstanceRegistry';
import {
  listPlatformPackRegistrations,
  inspectPlatformPackWorkspaceReadiness,
  inspectPlatformPackWorkspaceReadinessForInstallation,
  type PlatformPackWorkspaceReadiness,
  type PlatformPackWorkspaceReadinessDiagnostic,
  type PlatformPackRegistrationRecord,
} from './platformPackRegistry';
import {
  resolveMusicPlatformWorkspaceOwnershipMode,
  type MusicPlatformWorkspaceOwnershipMode,
} from './globalSettings';
import {
  normalizePlatformConnectorId,
  resolvePlatformConnectorTemplate,
  type PlatformConnectorDefinition,
  type PlatformConnectorId,
  type PlatformConnectorTemplate,
  type PlatformConnectorWorkspaceMode,
} from './platformConnectorModel';

export type PlatformRuntimeWorkspacePath = 'legacy' | 'pack' | 'none';
export type PlatformRuntimeWorkspacePathStatus = 'active' | 'fallback' | 'blocked';

export interface PlatformRuntimeWorkspaceRouting {
  ownershipMode: MusicPlatformWorkspaceOwnershipMode;
  path: PlatformRuntimeWorkspacePath;
  status: PlatformRuntimeWorkspacePathStatus;
  usesLegacyHostWorkspace: boolean;
  packWorkspaceReady: boolean;
  fallbackReasonCode: string | null;
  fallbackReasonMessage: string | null;
  diagnostics: PlatformPackWorkspaceReadinessDiagnostic[];
  packReadiness: PlatformPackWorkspaceReadiness;
}

export interface PlatformRuntimeDescriptor {
  connectorId: PlatformConnectorId;
  platformId: string | null;
  displayName: string;
  enabled: boolean;
  authState: PlatformCompatRuntimeAuthState;
  availability: PlatformCompatAvailability | null;
  availabilityMessage?: string;
  workspaceKind: string | null;
  workspaceMode: PlatformConnectorWorkspaceMode | null;
  platformTemplate: PlatformConnectorTemplate;
  sortOrder: number;
  sourceKind: 'pack' | 'builtin' | 'runtime' | 'unknown';
  connectorDefinition: PlatformConnectorDefinition | null;
  packRegistration: PlatformPackRegistrationRecord | null;
  compatRegistryRecord: PlatformCompatRegistryRecord | null;
  instanceRecord: PlatformInstanceRecord | null;
  runtime: PlatformCompatRuntimeApi | null;
  workspaceRouting: PlatformRuntimeWorkspaceRouting;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePlatformId(value: unknown): string {
  return normalizeString(value).toLowerCase();
}

function readConnectorIdFromMetadata(value: unknown): PlatformConnectorId | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return normalizePlatformConnectorId(
    (value as { connectorId?: unknown }).connectorId
  );
}

function readInstallationIdFromMetadata(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const installationId = normalizeString(
    (value as { installationId?: unknown }).installationId
  );
  return installationId || null;
}

function mapInstanceAuthState(
  value: PlatformInstanceRecord['auth']['status']
): PlatformCompatRuntimeAuthState {
  if (value === 'authorized') return 'authorized';
  if (value === 'authorizing') return 'pending';
  if (value === 'expired') return 'expired';
  if (value === 'error') return 'error';
  return 'unauthorized';
}

function readAuthPriority(value: PlatformInstanceRecord['auth']['status']): number {
  switch (value) {
    case 'authorized':
      return 5;
    case 'authorizing':
      return 4;
    case 'expired':
      return 3;
    case 'error':
      return 2;
    default:
      return 0;
  }
}

function pickPreferredInstanceRecord(
  records: PlatformInstanceRecord[]
): PlatformInstanceRecord | null {
  if (records.length < 1) {
    return null;
  }

  return records.reduce<PlatformInstanceRecord | null>((best, current) => {
    if (!best) return current;

    const authPriorityDelta =
      readAuthPriority(current.auth.status) - readAuthPriority(best.auth.status);
    if (authPriorityDelta !== 0) {
      return authPriorityDelta > 0 ? current : best;
    }

    const currentBuiltin = current.instanceId.endsWith(':builtin') ? 1 : 0;
    const bestBuiltin = best.instanceId.endsWith(':builtin') ? 1 : 0;
    if (currentBuiltin !== bestBuiltin) {
      return currentBuiltin > bestBuiltin ? current : best;
    }

    const currentUpdatedAt = current.auth.cookieUpdatedAtMs ?? 0;
    const bestUpdatedAt = best.auth.cookieUpdatedAtMs ?? 0;
    if (currentUpdatedAt !== bestUpdatedAt) {
      return currentUpdatedAt > bestUpdatedAt ? current : best;
    }

    return current.instanceId.localeCompare(best.instanceId, 'zh-CN') < 0
      ? current
      : best;
  }, null);
}

function sortWorkspaceDiagnostics(
  left: PlatformPackWorkspaceReadinessDiagnostic,
  right: PlatformPackWorkspaceReadinessDiagnostic
): number {
  const severityWeight = (
    value: PlatformPackWorkspaceReadinessDiagnostic['severity']
  ): number => {
    switch (value) {
      case 'error':
        return 3;
      case 'warn':
        return 2;
      case 'info':
      default:
        return 1;
    }
  };
  const severityDelta = severityWeight(right.severity) - severityWeight(left.severity);
  if (severityDelta !== 0) {
    return severityDelta;
  }
  return left.code.localeCompare(right.code, 'en');
}

function pickPrimaryWorkspaceDiagnostic(
  diagnostics: readonly PlatformPackWorkspaceReadinessDiagnostic[]
): PlatformPackWorkspaceReadinessDiagnostic | null {
  return diagnostics.slice().sort(sortWorkspaceDiagnostics)[0] ?? null;
}

function buildPlatformWorkspaceRouting(
  ownershipMode: MusicPlatformWorkspaceOwnershipMode,
  packReadiness: PlatformPackWorkspaceReadiness
): PlatformRuntimeWorkspaceRouting {
  const primaryDiagnostic = pickPrimaryWorkspaceDiagnostic(packReadiness.diagnostics);

  if (ownershipMode === 'legacy') {
    return {
      ownershipMode,
      path: 'legacy',
      status: 'active',
      usesLegacyHostWorkspace: true,
      packWorkspaceReady: packReadiness.ready,
      fallbackReasonCode: null,
      fallbackReasonMessage: null,
      diagnostics: packReadiness.diagnostics,
      packReadiness,
    };
  }

  if (packReadiness.ready) {
    return {
      ownershipMode,
      path: 'pack',
      status: 'active',
      usesLegacyHostWorkspace: false,
      packWorkspaceReady: true,
      fallbackReasonCode: null,
      fallbackReasonMessage: null,
      diagnostics: packReadiness.diagnostics,
      packReadiness,
    };
  }

  if (ownershipMode === 'auto') {
    return {
      ownershipMode,
      path: 'legacy',
      status: 'fallback',
      usesLegacyHostWorkspace: true,
      packWorkspaceReady: false,
      fallbackReasonCode: primaryDiagnostic?.code ?? 'workspace.pack.unavailable',
      fallbackReasonMessage:
        primaryDiagnostic?.message ??
        'Pack-owned workspace is unavailable; falling back to legacy host workspace.',
      diagnostics: packReadiness.diagnostics,
      packReadiness,
    };
  }

  return {
    ownershipMode,
    path: 'none',
    status: 'blocked',
    usesLegacyHostWorkspace: false,
    packWorkspaceReady: false,
    fallbackReasonCode: primaryDiagnostic?.code ?? 'workspace.pack.unavailable',
    fallbackReasonMessage:
      primaryDiagnostic?.message ??
      'Pack-owned workspace is unavailable and pack mode does not allow legacy fallback.',
    diagnostics: packReadiness.diagnostics,
    packReadiness,
  };
}

function resolvePlatformWorkspaceRoutingForNormalizedConnector(
  connectorId: PlatformConnectorId
): PlatformRuntimeWorkspaceRouting {
  const ownershipMode = resolveMusicPlatformWorkspaceOwnershipMode(connectorId);
  return buildPlatformWorkspaceRouting(
    ownershipMode,
    inspectPlatformPackWorkspaceReadiness(connectorId)
  );
}

function resolvePlatformWorkspaceRoutingForInstallation(
  connectorId: PlatformConnectorId,
  installationId: string
): PlatformRuntimeWorkspaceRouting {
  const ownershipMode = resolveMusicPlatformWorkspaceOwnershipMode(connectorId);
  return buildPlatformWorkspaceRouting(
    ownershipMode,
    inspectPlatformPackWorkspaceReadinessForInstallation(installationId)
  );
}

type PlatformRuntimeDescriptorMaps = {
  definitionsByConnectorId: Map<PlatformConnectorId, PlatformConnectorDefinition>;
  packsByConnectorId: Map<PlatformConnectorId, PlatformPackRegistrationRecord>;
  compatByConnectorId: Map<PlatformConnectorId, PlatformCompatRegistryRecord>;
  compatByPlatformId: Map<string, PlatformCompatRegistryRecord>;
  instancesByConnectorId: Map<PlatformConnectorId, PlatformInstanceRecord[]>;
  instancesByPlatformId: Map<string, PlatformInstanceRecord[]>;
};

function createPlatformRuntimeDescriptorMaps(): PlatformRuntimeDescriptorMaps {
  const definitionsByConnectorId = new Map<PlatformConnectorId, PlatformConnectorDefinition>();
  for (const definition of listPlatformConnectorDefinitions()) {
    definitionsByConnectorId.set(definition.connectorId, definition);
  }

  const packsByConnectorId = new Map<PlatformConnectorId, PlatformPackRegistrationRecord>();
  for (const registration of listPlatformPackRegistrations()) {
    packsByConnectorId.set(registration.connectorId, registration);
  }

  const compatByConnectorId = new Map<PlatformConnectorId, PlatformCompatRegistryRecord>();
  const compatByPlatformId = new Map<string, PlatformCompatRegistryRecord>();
  for (const record of listPlatformCompatRegistryRecords()) {
    const normalizedPlatformId = normalizePlatformId(record.platformId);
    if (normalizedPlatformId) {
      compatByPlatformId.set(normalizedPlatformId, record);
    }

    const connectorId = readConnectorIdFromMetadata(record.metadata);
    if (connectorId) {
      compatByConnectorId.set(connectorId, record);
    }
  }

  const instancesByConnectorId = new Map<PlatformConnectorId, PlatformInstanceRecord[]>();
  const instancesByPlatformId = new Map<string, PlatformInstanceRecord[]>();
  for (const instance of listPlatformInstances()) {
    const connectorId = readConnectorIdFromMetadata(instance.metadata);
    if (connectorId) {
      const connectorBucket = instancesByConnectorId.get(connectorId) ?? [];
      connectorBucket.push(instance);
      instancesByConnectorId.set(connectorId, connectorBucket);
    }

    const platformId = normalizePlatformId(instance.platformId);
    if (platformId) {
      const platformBucket = instancesByPlatformId.get(platformId) ?? [];
      platformBucket.push(instance);
      instancesByPlatformId.set(platformId, platformBucket);
    }
  }

  return {
    definitionsByConnectorId,
    packsByConnectorId,
    compatByConnectorId,
    compatByPlatformId,
    instancesByConnectorId,
    instancesByPlatformId,
  };
}

function determineSourceKind(input: {
  connectorDefinition: PlatformConnectorDefinition | null;
  packRegistration: PlatformPackRegistrationRecord | null;
  compatRegistryRecord: PlatformCompatRegistryRecord | null;
}): PlatformRuntimeDescriptor['sourceKind'] {
  if (input.packRegistration) {
    return 'pack';
  }
  if (input.connectorDefinition?.source === 'builtin') {
    return 'builtin';
  }
  if (input.connectorDefinition?.source === 'runtime') {
    return 'runtime';
  }
  if (input.compatRegistryRecord?.source.startsWith('builtin')) {
    return 'builtin';
  }
  if (input.compatRegistryRecord?.source.startsWith('runtime')) {
    return 'runtime';
  }
  if (input.compatRegistryRecord?.source.startsWith('platform-pack')) {
    return 'pack';
  }
  return 'unknown';
}

function buildPlatformRuntimeDescriptorForConnector(
  connectorId: PlatformConnectorId,
  maps: PlatformRuntimeDescriptorMaps
): PlatformRuntimeDescriptor {
  const connectorDefinition =
    maps.definitionsByConnectorId.get(connectorId) ??
    maps.packsByConnectorId.get(connectorId)?.definition ??
    null;
  const packRegistration = maps.packsByConnectorId.get(connectorId) ?? null;
  const compatRegistryRecord =
    maps.compatByConnectorId.get(connectorId) ??
    (packRegistration
      ? maps.compatByPlatformId.get(normalizePlatformId(packRegistration.platformId)) ?? null
      : null) ??
    null;
  const instanceRecord =
    pickPreferredInstanceRecord(maps.instancesByConnectorId.get(connectorId) ?? []) ??
    (compatRegistryRecord
      ? pickPreferredInstanceRecord(
          maps.instancesByPlatformId.get(
            normalizePlatformId(compatRegistryRecord.platformId)
          ) ?? []
        )
      : null) ??
    null;

  const platformId =
    normalizePlatformId(instanceRecord?.platformId) ||
    normalizePlatformId(compatRegistryRecord?.platformId) ||
    normalizePlatformId(packRegistration?.platformId) ||
    null;
  const displayName =
    normalizeString(instanceRecord?.displayName) ||
    normalizeString(connectorDefinition?.displayName) ||
    normalizeString(packRegistration?.definition.displayName) ||
    normalizeString(compatRegistryRecord?.contract.platform.displayName) ||
    connectorId.replace(/^connector\.platform\./i, '') ||
    connectorId;
  const workspaceKind =
    normalizeString(connectorDefinition?.workspaceKind) ||
    normalizeString(packRegistration?.definition.workspaceKind) ||
    null;
  const workspaceMode =
    connectorDefinition?.workspaceMode ??
    packRegistration?.definition.workspaceMode ??
    null;

  return {
    connectorId,
    platformId,
    displayName,
    enabled: connectorDefinition?.enabled !== false,
    authState: instanceRecord ? mapInstanceAuthState(instanceRecord.auth.status) : 'unauthorized',
    availability: instanceRecord?.availability ?? null,
    availabilityMessage: instanceRecord?.availabilityMessage,
    workspaceKind,
    workspaceMode,
    platformTemplate: resolvePlatformConnectorTemplate({
      platformTemplate:
        connectorDefinition?.platformTemplate ??
        packRegistration?.definition.platformTemplate,
      workspaceKind: workspaceKind ?? 'generic',
    }),
    sortOrder: connectorDefinition?.sortOrder ?? packRegistration?.definition.sortOrder ?? 1000,
    sourceKind: determineSourceKind({
      connectorDefinition,
      packRegistration,
      compatRegistryRecord,
    }),
    connectorDefinition,
    packRegistration,
    compatRegistryRecord,
    instanceRecord,
    runtime: compatRegistryRecord?.runtime ?? null,
    workspaceRouting: resolvePlatformWorkspaceRoutingForNormalizedConnector(connectorId),
  };
}

function buildPlatformRuntimeDescriptorForInstance(
  instanceRecord: PlatformInstanceRecord,
  maps: PlatformRuntimeDescriptorMaps
): PlatformRuntimeDescriptor | null {
  const connectorId =
    readConnectorIdFromMetadata(instanceRecord.metadata) ??
    readConnectorIdFromMetadata(
      maps.compatByPlatformId.get(normalizePlatformId(instanceRecord.platformId))?.metadata
    );
  if (!connectorId) {
    return null;
  }

  const descriptor = buildPlatformRuntimeDescriptorForConnector(connectorId, maps);
  return {
    ...descriptor,
    platformId: normalizePlatformId(instanceRecord.platformId) || descriptor.platformId,
    displayName: normalizeString(instanceRecord.displayName) || descriptor.displayName,
    authState: mapInstanceAuthState(instanceRecord.auth.status),
    availability: instanceRecord.availability,
    availabilityMessage: instanceRecord.availabilityMessage,
    instanceRecord,
    workspaceRouting:
      resolvePlatformWorkspaceRoutingForInstanceId(instanceRecord.instanceId) ??
      descriptor.workspaceRouting,
  };
}

export function listPlatformRuntimeDescriptors(): PlatformRuntimeDescriptor[] {
  const maps = createPlatformRuntimeDescriptorMaps();
  const connectorIds = new Set<PlatformConnectorId>([
    ...maps.definitionsByConnectorId.keys(),
    ...maps.packsByConnectorId.keys(),
    ...maps.compatByConnectorId.keys(),
    ...maps.instancesByConnectorId.keys(),
  ]);

  return Array.from(connectorIds)
    .map((connectorId) => buildPlatformRuntimeDescriptorForConnector(connectorId, maps))
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder;
      }
      return left.displayName.localeCompare(right.displayName, 'zh-CN');
    });
}

export function resolvePlatformWorkspaceRoutingForConnector(
  connectorId: string
): PlatformRuntimeWorkspaceRouting | null {
  const normalizedConnectorId = normalizePlatformConnectorId(connectorId);
  if (!normalizedConnectorId) {
    return null;
  }

  return resolvePlatformWorkspaceRoutingForNormalizedConnector(normalizedConnectorId);
}

export function resolvePlatformWorkspaceRoutingForInstanceId(
  instanceId: string
): PlatformRuntimeWorkspaceRouting | null {
  const normalizedInstanceId = normalizeString(instanceId);
  if (!normalizedInstanceId) {
    return null;
  }

  const importedInstance = getPlatformImportedInstanceRecord(normalizedInstanceId);
  if (importedInstance) {
    return resolvePlatformWorkspaceRoutingForInstallation(
      importedInstance.connectorId,
      importedInstance.installationId
    );
  }

  const instanceRecord = getPlatformInstance(normalizedInstanceId);
  if (!instanceRecord) {
    return null;
  }

  const connectorId =
    readConnectorIdFromMetadata(instanceRecord.metadata) ??
    normalizePlatformConnectorId(`connector.platform.${instanceRecord.platformId}`);
  if (!connectorId) {
    return null;
  }

  const installationId = readInstallationIdFromMetadata(instanceRecord.metadata);
  if (installationId) {
    return resolvePlatformWorkspaceRoutingForInstallation(connectorId, installationId);
  }

  return resolvePlatformWorkspaceRoutingForNormalizedConnector(connectorId);
}

export function resolvePreferredPlatformRuntimeDescriptorForConnector(
  connectorId: string
): PlatformRuntimeDescriptor | null {
  const normalizedConnectorId = normalizePlatformConnectorId(connectorId);
  if (!normalizedConnectorId) {
    return null;
  }

  const maps = createPlatformRuntimeDescriptorMaps();
  const descriptor = buildPlatformRuntimeDescriptorForConnector(
    normalizedConnectorId,
    maps
  );
  return descriptor.platformId ||
    descriptor.connectorDefinition ||
    descriptor.packRegistration ||
    descriptor.compatRegistryRecord ||
    descriptor.instanceRecord
    ? descriptor
    : null;
}

export function resolvePlatformRuntimeDescriptorByInstanceId(
  instanceId: string
): PlatformRuntimeDescriptor | null {
  const normalizedInstanceId = normalizeString(instanceId);
  if (!normalizedInstanceId) {
    return null;
  }

  const instanceRecord = getPlatformInstance(normalizedInstanceId);
  if (!instanceRecord) {
    return null;
  }

  return buildPlatformRuntimeDescriptorForInstance(
    instanceRecord,
    createPlatformRuntimeDescriptorMaps()
  );
}

export function resolveDefaultPlatformInstanceIdForConnector(
  connectorId: string
): string | null {
  const descriptor = resolvePreferredPlatformRuntimeDescriptorForConnector(connectorId);
  if (!descriptor) {
    return null;
  }
  if (descriptor.instanceRecord) {
    return descriptor.instanceRecord.instanceId;
  }
  return descriptor.platformId ? `${descriptor.platformId}:builtin` : null;
}
