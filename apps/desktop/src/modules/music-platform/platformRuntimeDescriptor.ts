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
import {
  getPlatformImportedInstanceRecord,
  listPlatformImportedInstanceRecords,
  type PlatformImportedInstanceRecord,
} from './platformImportedInstanceRegistry';
import {
  getInstalledPlatformPackRecord,
  listInstalledPlatformPackRecords,
  type InstalledPlatformPackRecord,
  type InstalledPlatformPackSourceType,
} from './installedPlatformPacks';
import {
  listPlatformPackRegistrations,
  inspectPlatformPackWorkspaceReadiness,
  inspectPlatformPackWorkspaceReadinessForInstallation,
  resolvePlatformPackRegistrationForInstallation,
  resolvePlatformPackWorkspaceSurface,
  resolvePlatformPackWorkspaceSurfaceForInstallation,
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
import { getActiveMusicPlatformInstanceId } from './activeInstanceRegistry';
import type { PlatformPackWorkspaceSurfaceRecord } from './platformWorkspaceSurface';

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

export type PlatformRuntimeWorkspaceMountResolutionSource =
  | 'imported-instance'
  | 'instance-metadata'
  | 'builtin-installation'
  | 'registration-installation'
  | 'connector-installation'
  | 'connector-surface'
  | 'unresolved';

export interface PlatformRuntimeWorkspaceMount {
  resolutionSource: PlatformRuntimeWorkspaceMountResolutionSource;
  installationId: string | null;
  sourceType: InstalledPlatformPackSourceType | null;
  source: string | null;
  packId: string | null;
  packVersion: string | null;
  packageDigest: string | null;
  artifactRootPath: string | null;
  runtimePath: string | null;
  runtimeImportUrl: string | null;
  iconPath: string | null;
  workspaceSurface: PlatformPackWorkspaceSurfaceRecord | null;
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
  workspaceMount: PlatformRuntimeWorkspaceMount;
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

function readInstallationIdFromPackSource(value: unknown): string | null {
  const source = normalizeString(value);
  if (!source.startsWith('installed-pack:')) {
    return null;
  }
  const segments = source.split(':');
  const installationId = normalizeString(segments[segments.length - 1]);
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
  installedRecordsByInstallationId: Map<string, InstalledPlatformPackRecord>;
  installedRecordsByConnectorId: Map<PlatformConnectorId, InstalledPlatformPackRecord[]>;
  importedInstancesByInstanceId: Map<string, PlatformImportedInstanceRecord>;
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

  const installedRecordsByInstallationId = new Map<string, InstalledPlatformPackRecord>();
  const installedRecordsByConnectorId = new Map<
    PlatformConnectorId,
    InstalledPlatformPackRecord[]
  >();
  for (const record of listInstalledPlatformPackRecords()) {
    installedRecordsByInstallationId.set(record.installationId, record);
    const connectorBucket = installedRecordsByConnectorId.get(record.connectorId) ?? [];
    connectorBucket.push(record);
    installedRecordsByConnectorId.set(record.connectorId, connectorBucket);
  }

  const importedInstancesByInstanceId = new Map<string, PlatformImportedInstanceRecord>();
  for (const importedRecord of listPlatformImportedInstanceRecords()) {
    importedInstancesByInstanceId.set(importedRecord.instanceId, importedRecord);
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
    installedRecordsByInstallationId,
    installedRecordsByConnectorId,
    importedInstancesByInstanceId,
    instancesByConnectorId,
    instancesByPlatformId,
  };
}

function sortInstalledRecordsForMountSelection(
  left: InstalledPlatformPackRecord,
  right: InstalledPlatformPackRecord
): number {
  const installedAtDelta = right.installedAtMs - left.installedAtMs;
  if (installedAtDelta !== 0) {
    return installedAtDelta;
  }
  return right.installationId.localeCompare(left.installationId, 'zh-CN');
}

function pickInstalledRecordForConnector(
  connectorId: PlatformConnectorId,
  maps: PlatformRuntimeDescriptorMaps,
  options: {
    preferredSourceType?: InstalledPlatformPackSourceType | null;
  } = {}
): InstalledPlatformPackRecord | null {
  const records = maps.installedRecordsByConnectorId.get(connectorId) ?? [];
  if (records.length < 1) {
    return null;
  }

  const preferredSourceType = options.preferredSourceType ?? null;
  const preferredRecords =
    preferredSourceType === null
      ? records
      : records.filter((record) => record.sourceType === preferredSourceType);
  const candidates = preferredRecords.length > 0 ? preferredRecords : records;
  return candidates.slice().sort(sortInstalledRecordsForMountSelection)[0] ?? null;
}

function createPlatformRuntimeWorkspaceMountFromInstallation(input: {
  installationId: string;
  resolutionSource: PlatformRuntimeWorkspaceMountResolutionSource;
  maps: PlatformRuntimeDescriptorMaps;
}): PlatformRuntimeWorkspaceMount {
  const installedRecord =
    input.maps.installedRecordsByInstallationId.get(input.installationId) ??
    getInstalledPlatformPackRecord(input.installationId);
  const packRegistration = resolvePlatformPackRegistrationForInstallation(
    input.installationId
  );
  const workspaceSurface = resolvePlatformPackWorkspaceSurfaceForInstallation(
    input.installationId
  );

  return {
    resolutionSource: input.resolutionSource,
    installationId: input.installationId,
    sourceType: installedRecord?.sourceType ?? null,
    source:
      normalizeString(installedRecord?.source) ||
      normalizeString(workspaceSurface?.source) ||
      normalizeString(packRegistration?.source) ||
      null,
    packId:
      normalizeString(installedRecord?.packId) ||
      normalizeString(workspaceSurface?.packId) ||
      normalizeString(packRegistration?.packId) ||
      null,
    packVersion:
      normalizeString(installedRecord?.packVersion) ||
      normalizeString(workspaceSurface?.packVersion) ||
      normalizeString(packRegistration?.packVersion) ||
      null,
    packageDigest: normalizeString(installedRecord?.packageDigest) || null,
    artifactRootPath: normalizeString(installedRecord?.artifactRootPath) || null,
    runtimePath: normalizeString(installedRecord?.runtimePath) || null,
    runtimeImportUrl: normalizeString(workspaceSurface?.runtimeImportUrl) || null,
    iconPath: normalizeString(installedRecord?.iconPath) || null,
    workspaceSurface,
  };
}

function createPlatformRuntimeWorkspaceMountFromConnectorSurface(
  connectorId: PlatformConnectorId
): PlatformRuntimeWorkspaceMount {
  const workspaceSurface = resolvePlatformPackWorkspaceSurface(connectorId);
  return {
    resolutionSource: workspaceSurface ? 'connector-surface' : 'unresolved',
    installationId: null,
    sourceType: null,
    source: normalizeString(workspaceSurface?.source) || null,
    packId: normalizeString(workspaceSurface?.packId) || null,
    packVersion: normalizeString(workspaceSurface?.packVersion) || null,
    packageDigest: null,
    artifactRootPath: null,
    runtimePath: null,
    runtimeImportUrl: normalizeString(workspaceSurface?.runtimeImportUrl) || null,
    iconPath: null,
    workspaceSurface,
  };
}

function resolvePlatformWorkspaceMount(input: {
  connectorId: PlatformConnectorId;
  instanceRecord: PlatformInstanceRecord | null;
  packRegistration: PlatformPackRegistrationRecord | null;
  maps: PlatformRuntimeDescriptorMaps;
}): PlatformRuntimeWorkspaceMount {
  const importedInstance =
    input.instanceRecord
      ? input.maps.importedInstancesByInstanceId.get(input.instanceRecord.instanceId) ?? null
      : null;
  const importedInstallationId = importedInstance?.installationId ?? null;
  if (importedInstallationId) {
    return createPlatformRuntimeWorkspaceMountFromInstallation({
      installationId: importedInstallationId,
      resolutionSource: 'imported-instance',
      maps: input.maps,
    });
  }

  const metadataInstallationId = readInstallationIdFromMetadata(input.instanceRecord?.metadata);
  if (metadataInstallationId) {
    return createPlatformRuntimeWorkspaceMountFromInstallation({
      installationId: metadataInstallationId,
      resolutionSource: 'instance-metadata',
      maps: input.maps,
    });
  }

  if (input.instanceRecord?.instanceId.endsWith(':builtin')) {
    const builtinRecord = pickInstalledRecordForConnector(input.connectorId, input.maps, {
      preferredSourceType: 'builtin',
    });
    if (builtinRecord) {
      return createPlatformRuntimeWorkspaceMountFromInstallation({
        installationId: builtinRecord.installationId,
        resolutionSource: 'builtin-installation',
        maps: input.maps,
      });
    }
  }

  const registrationInstallationId = readInstallationIdFromPackSource(
    input.packRegistration?.source
  );
  if (registrationInstallationId) {
    return createPlatformRuntimeWorkspaceMountFromInstallation({
      installationId: registrationInstallationId,
      resolutionSource: 'registration-installation',
      maps: input.maps,
    });
  }

  const connectorInstalledRecord = pickInstalledRecordForConnector(
    input.connectorId,
    input.maps,
    {
      preferredSourceType:
        input.instanceRecord?.instanceId.endsWith(':builtin') === true ? 'builtin' : null,
    }
  );
  if (connectorInstalledRecord) {
    return createPlatformRuntimeWorkspaceMountFromInstallation({
      installationId: connectorInstalledRecord.installationId,
      resolutionSource: 'connector-installation',
      maps: input.maps,
    });
  }

  return createPlatformRuntimeWorkspaceMountFromConnectorSurface(input.connectorId);
}

function resolveEffectivePlatformPackRegistration(
  workspaceMount: PlatformRuntimeWorkspaceMount,
  fallback: PlatformPackRegistrationRecord | null
): PlatformPackRegistrationRecord | null {
  const installationId = normalizeString(workspaceMount.installationId);
  if (!installationId) {
    return fallback;
  }

  return resolvePlatformPackRegistrationForInstallation(installationId) ?? fallback;
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
  const connectorPackRegistration = maps.packsByConnectorId.get(connectorId) ?? null;
  const compatRegistryRecord =
    maps.compatByConnectorId.get(connectorId) ??
    (connectorPackRegistration
      ? maps.compatByPlatformId.get(
          normalizePlatformId(connectorPackRegistration.platformId)
        ) ?? null
      : null) ??
    null;
  const activeInstanceId = getActiveMusicPlatformInstanceId({ connectorId });
  const connectorInstances = maps.instancesByConnectorId.get(connectorId) ?? [];
  const activeInstanceRecord =
    connectorInstances.find((record) => record.instanceId === activeInstanceId) ??
    (compatRegistryRecord
      ? (
          maps.instancesByPlatformId.get(
            normalizePlatformId(compatRegistryRecord.platformId)
          ) ?? []
        ).find((record) => record.instanceId === activeInstanceId) ?? null
      : null);
  const instanceRecord =
    activeInstanceRecord ??
    pickPreferredInstanceRecord(connectorInstances) ??
    (compatRegistryRecord
      ? pickPreferredInstanceRecord(
          maps.instancesByPlatformId.get(
            normalizePlatformId(compatRegistryRecord.platformId)
          ) ?? []
        )
      : null) ??
    null;
  const workspaceMount = resolvePlatformWorkspaceMount({
    connectorId,
    instanceRecord,
    packRegistration: connectorPackRegistration,
    maps,
  });
  const packRegistration = resolveEffectivePlatformPackRegistration(
    workspaceMount,
    connectorPackRegistration
  );
  const connectorDefinition =
    maps.definitionsByConnectorId.get(connectorId) ?? packRegistration?.definition ?? null;

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
  const workspaceRouting = workspaceMount.installationId
    ? resolvePlatformWorkspaceRoutingForInstallation(connectorId, workspaceMount.installationId)
    : resolvePlatformWorkspaceRoutingForNormalizedConnector(connectorId);

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
    runtime: packRegistration?.compat?.runtime ?? compatRegistryRecord?.runtime ?? null,
    workspaceRouting,
    workspaceMount,
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
  const workspaceMount = resolvePlatformWorkspaceMount({
    connectorId,
    instanceRecord,
    packRegistration: descriptor.packRegistration,
    maps,
  });
  const packRegistration = resolveEffectivePlatformPackRegistration(
    workspaceMount,
    descriptor.packRegistration
  );
  const connectorDefinition =
    descriptor.connectorDefinition ?? packRegistration?.definition ?? null;
  const workspaceKind =
    normalizeString(connectorDefinition?.workspaceKind) ||
    normalizeString(packRegistration?.definition.workspaceKind) ||
    descriptor.workspaceKind ||
    null;
  const workspaceMode =
    connectorDefinition?.workspaceMode ??
    packRegistration?.definition.workspaceMode ??
    descriptor.workspaceMode ??
    null;
  return {
    ...descriptor,
    platformId: normalizePlatformId(instanceRecord.platformId) || descriptor.platformId,
    displayName: normalizeString(instanceRecord.displayName) || descriptor.displayName,
    authState: mapInstanceAuthState(instanceRecord.auth.status),
    availability: instanceRecord.availability,
    availabilityMessage: instanceRecord.availabilityMessage,
    workspaceKind,
    workspaceMode,
    platformTemplate: resolvePlatformConnectorTemplate({
      platformTemplate:
        connectorDefinition?.platformTemplate ?? packRegistration?.definition.platformTemplate,
      workspaceKind: workspaceKind ?? 'generic',
    }),
    sourceKind: determineSourceKind({
      connectorDefinition,
      packRegistration,
      compatRegistryRecord: descriptor.compatRegistryRecord,
    }),
    connectorDefinition,
    packRegistration,
    instanceRecord,
    runtime: packRegistration?.compat?.runtime ?? descriptor.runtime,
    workspaceRouting: workspaceMount.installationId
      ? resolvePlatformWorkspaceRoutingForInstallation(
          connectorId,
          workspaceMount.installationId
        )
      : resolvePlatformWorkspaceRoutingForInstanceId(instanceRecord.instanceId) ??
        descriptor.workspaceRouting,
    workspaceMount,
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

  const maps = createPlatformRuntimeDescriptorMaps();
  const workspaceMount = resolvePlatformWorkspaceMount({
    connectorId,
    instanceRecord,
    packRegistration: maps.packsByConnectorId.get(connectorId) ?? null,
    maps,
  });
  if (workspaceMount.installationId) {
    return resolvePlatformWorkspaceRoutingForInstallation(
      connectorId,
      workspaceMount.installationId
    );
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
