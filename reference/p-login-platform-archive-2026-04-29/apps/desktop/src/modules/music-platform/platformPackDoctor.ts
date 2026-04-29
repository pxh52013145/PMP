import {
  PLATFORM_COMPAT_PMP_SUPPORTED_BINDINGS,
  PlatformCompatContractFile,
  PlatformCompatRuntimeApi,
  type PlatformInstanceRecord,
  type PlatformRenderSelectionRecord,
} from '@pixel-matrix/plugin-platform-contracts';

import { isTauriRuntime } from '../../utils/tauriRuntime';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import {
  getMusicPlatformDurationMs,
  getMusicPlatformNowMs,
  readMusicPlatformDiagnosticErrorMessage,
} from './platformDiagnostics';
import {
  listPlatformConnectorDefinitions,
  type PlatformConnectorDefinition,
  type PlatformConnectorId,
} from './connectorAuth';
import {
  areInstalledPlatformPackArtifactsPresent,
  createInstalledPlatformPackEntryUrl,
  loadInstalledPlatformPackRecords,
  type InstalledPlatformPackRecord,
  type InstalledPlatformPackSourceType,
} from './installedPlatformPacks';
import { listPlatformInstances } from './instanceRegistry';
import {
  listPlatformImportedInstanceRecords,
  type PlatformImportedInstanceRecord,
} from './platformImportedInstanceRegistry';
import {
  getPlatformPackStartupHealth,
  inspectBuiltinPlatformPackStoreState,
  listBuiltinPlatformPackAssets,
  listPlatformPackReadinessDiagnostics,
  listPlatformPackRegistrations,
  inspectPlatformPackWorkspaceReadinessForInstallation,
  resolvePlatformPackWorkspaceSurfaceForInstallation,
  type BuiltinPlatformPackAssetDefinition,
  type BuiltinPlatformPackStoreInspection,
  type BuiltinPlatformPackStoreInspectionEntry,
  type PlatformPackReadinessDiagnostic,
  type PlatformPackRegistrationRecord,
  type PlatformPackWorkspaceReadinessDiagnostic,
  type PlatformPackWorkspaceReadiness,
  type PlatformPackStartupHealth,
} from './platformPackRegistry';
import {
  listPlatformRuntimeDescriptors,
  resolvePlatformRuntimeDescriptorByInstanceId,
  resolvePlatformWorkspaceRoutingForConnector,
  resolvePlatformWorkspaceRoutingForInstanceId,
  type PlatformRuntimeDescriptor,
  type PlatformRuntimeWorkspaceMount,
  type PlatformRuntimeWorkspaceRouting,
} from './platformRuntimeDescriptor';
import { inspectPlatformRenderSelectionPersistence } from './renderSelectionRegistry';

export type PlatformPackDoctorSeverity = 'info' | 'warn' | 'error';
export type PlatformPackDoctorStatus = 'ready' | 'degraded' | 'error';
export type PlatformPackDoctorFlowStatus = PlatformPackDoctorStatus | 'unsupported';
export type PlatformPackDoctorRuntimeBucket =
  | 'auth'
  | 'library'
  | 'recommendations'
  | 'search'
  | 'quality'
  | 'settings'
  | 'pages';

export interface PlatformPackDoctorIssue {
  code: string;
  severity: PlatformPackDoctorSeverity;
  fields?: Record<string, string | number | boolean | null>;
}

export interface PlatformPackDoctorRuntimeBucketCoverage {
  bucket: PlatformPackDoctorRuntimeBucket;
  bindingId: string;
  runtimeMethodNames: string[];
  expectedMethodNames: string[];
  missingMethodNames: string[];
}

export interface PlatformPackDoctorResolvedAssetStatus {
  path: string | null;
  resolved: boolean;
}

export interface PlatformPackDoctorWorkspaceSurfaceStatus {
  resolved: boolean;
  source: string | null;
  rootViewId: string | null;
  viewType: string | null;
  requiredRuntimeCarrier: string | null;
  runtimeImportUrl: string | null;
}

export interface PlatformPackDoctorInstanceWorkspaceMountStatus {
  resolutionSource: string | null;
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
  surfaceResolved: boolean;
  surfaceSource: string | null;
  rootViewId: string | null;
  viewType: string | null;
}

export interface PlatformPackDoctorRenderSelectionStatus {
  registryInitialized: boolean;
  currentPresent: boolean;
  currentMounted: boolean | null;
  currentMountedAtMs: number | null;
  currentOrder: number | null;
  persistedPresent: boolean;
  persistedMounted: boolean | null;
  persistedMountedAtMs: number | null;
  persistedOrder: number | null;
  inSync: boolean;
}

export interface PlatformPackDoctorInstallationReport {
  installationId: string;
  connectorId: PlatformConnectorId;
  platformId: string;
  packId: string;
  packVersion: string;
  sourceType: InstalledPlatformPackSourceType;
  source: string | null;
  installedAtMs: number;
  packageDigest: string | null;
  status: PlatformPackDoctorStatus;
  artifactsPresent: boolean;
  registrationPresent: boolean;
  activeConnectorRegistration: boolean;
  artifactRoot: PlatformPackDoctorResolvedAssetStatus;
  runtime: PlatformPackDoctorResolvedAssetStatus;
  icon: PlatformPackDoctorResolvedAssetStatus;
  workspaceSurface: PlatformPackDoctorWorkspaceSurfaceStatus;
  workspaceReadiness: PlatformPackWorkspaceReadiness;
  issues: PlatformPackDoctorIssue[];
}

export interface PlatformPackDoctorInstanceReport {
  instanceId: string;
  installationId: string | null;
  connectorId: PlatformConnectorId;
  platformId: string;
  sourceType: InstalledPlatformPackSourceType | null;
  source: string | null;
  displayName: string;
  instanceLabel: string;
  imported: boolean;
  instanceRecordPresent: boolean;
  importedRegistryPresent: boolean;
  descriptorPresent: boolean;
  installationPresent: boolean;
  authState: PlatformInstanceRecord['auth']['status'] | null;
  availability: PlatformInstanceRecord['availability'] | null;
  status: PlatformPackDoctorStatus;
  workspaceRouting: PlatformRuntimeWorkspaceRouting;
  workspaceMount: PlatformPackDoctorInstanceWorkspaceMountStatus;
  renderSelection: PlatformPackDoctorRenderSelectionStatus;
  issues: PlatformPackDoctorIssue[];
}

export interface PlatformPackDoctorConnectorReport {
  connectorId: PlatformConnectorId;
  displayName: string;
  expectedBuiltin: boolean;
  status: PlatformPackDoctorStatus;
  issues: PlatformPackDoctorIssue[];
  storeInspection: BuiltinPlatformPackStoreInspectionEntry | null;
  packAsset: BuiltinPlatformPackAssetDefinition | null;
  installedRecord: {
    sourceType: string | null;
    source: string | null;
    installedAtMs: number | null;
    artifactsPresent: boolean | null;
  };
  registrationPresent: boolean;
  descriptorPresent: boolean;
  connectorDefinitionPresent: boolean;
  workspaceRouting: PlatformRuntimeWorkspaceRouting;
  requiredFlows: {
    recommendations: PlatformPackDoctorFlowStatus;
    quality: PlatformPackDoctorFlowStatus;
    pages: PlatformPackDoctorFlowStatus;
  };
  bucketCoverage: PlatformPackDoctorRuntimeBucketCoverage[];
  installations: PlatformPackDoctorInstallationReport[];
  instances: PlatformPackDoctorInstanceReport[];
}

export interface PlatformPackDoctorReport {
  generatedAtMs: number;
  durationMs: number;
  status: PlatformPackDoctorStatus;
  expectedBuiltinCount: number;
  installationCount: number;
  instanceCount: number;
  readyConnectorCount: number;
  degradedConnectorCount: number;
  errorConnectorCount: number;
  issues: PlatformPackDoctorIssue[];
  startupHealth: PlatformPackStartupHealth;
  connectors: PlatformPackDoctorConnectorReport[];
}

const telemetry = getTelemetryLogger('music-platform', 'platformPackDoctor');
type ConsecutiveDoctorTelemetryFingerprint = {
  status: PlatformPackDoctorStatus;
  fingerprint: string;
};
let lastPlatformPackDoctorTelemetry: ConsecutiveDoctorTelemetryFingerprint | null = null;

const STANDARD_RUNTIME_METHODS: Readonly<Record<PlatformPackDoctorRuntimeBucket, readonly string[]>> = {
  auth: [
    'getSnapshot',
    'refreshSnapshot',
    'beginQrLogin',
    'pollQrLogin',
    'logout',
    'clearAuthCookies',
  ],
  library: [
    'listCollections',
    'listResources',
    'listPlaylistTracks',
    'createPlaylist',
    'deletePlaylist',
    'addTrackToPlaylist',
    'removeTrackFromPlaylist',
    'preparePlayback',
    'resolveLyricLocator',
    'resolveCoverAssetUrl',
  ],
  recommendations: ['listDaily', 'listRecommendedSongs', 'listRecommendedPlaylists'],
  search: ['query', 'resolveLocator', 'preparePlayback'],
  quality: ['listOptions', 'getCurrent', 'setPreferred'],
  settings: ['get', 'set', 'reset'],
  pages: ['getWorkspaceModel', 'listPages'],
};

const CONTRACT_BUCKET_BINDING_KEYS: Readonly<
  Record<PlatformPackDoctorRuntimeBucket, keyof PlatformCompatContractFile['apiBindings']>
> = {
  auth: 'auth',
  library: 'library',
  recommendations: 'recommendations',
  search: 'search',
  quality: 'quality',
  settings: 'settings',
  pages: 'pages',
};

const PMP_SUPPORTED_BINDINGS_BY_BUCKET: Partial<
  Record<PlatformPackDoctorRuntimeBucket, string>
> = {
  auth: PLATFORM_COMPAT_PMP_SUPPORTED_BINDINGS.auth,
  library: PLATFORM_COMPAT_PMP_SUPPORTED_BINDINGS.library,
  recommendations: PLATFORM_COMPAT_PMP_SUPPORTED_BINDINGS.recommendations,
  search: PLATFORM_COMPAT_PMP_SUPPORTED_BINDINGS.search,
  quality: PLATFORM_COMPAT_PMP_SUPPORTED_BINDINGS.quality,
  pages: PLATFORM_COMPAT_PMP_SUPPORTED_BINDINGS.pages,
};

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readConnectorIdFromInstanceRecord(
  record: PlatformInstanceRecord | null | undefined
): PlatformConnectorId | null {
  const connectorId = normalizeString(record?.metadata?.connectorId);
  if (!connectorId.startsWith('connector.platform.')) {
    return null;
  }
  return connectorId as PlatformConnectorId;
}

function readInstallationIdFromInstanceRecord(
  record: PlatformInstanceRecord | null | undefined
): string | null {
  const installationId = normalizeString(record?.metadata?.installationId);
  return installationId || null;
}

function buildInstalledPackSource(record: InstalledPlatformPackRecord): string {
  return (
    normalizeString(record.source) ||
    (record.sourceType === 'builtin'
      ? `builtin-pack:${record.packId}`
      : `installed-pack:${record.packId}:${record.installationId}`)
  );
}

function createResolvedAssetStatus(
  path: string | null | undefined,
  resolved: boolean
): PlatformPackDoctorResolvedAssetStatus {
  return {
    path: normalizeString(path) || null,
    resolved,
  };
}

function createInstanceWorkspaceMountStatus(
  workspaceMount: PlatformRuntimeWorkspaceMount | null | undefined
): PlatformPackDoctorInstanceWorkspaceMountStatus {
  return {
    resolutionSource: workspaceMount?.resolutionSource ?? null,
    installationId: workspaceMount?.installationId ?? null,
    sourceType: workspaceMount?.sourceType ?? null,
    source: normalizeString(workspaceMount?.source) || null,
    packId: normalizeString(workspaceMount?.packId) || null,
    packVersion: normalizeString(workspaceMount?.packVersion) || null,
    packageDigest: normalizeString(workspaceMount?.packageDigest) || null,
    artifactRootPath: normalizeString(workspaceMount?.artifactRootPath) || null,
    runtimePath: normalizeString(workspaceMount?.runtimePath) || null,
    runtimeImportUrl: normalizeString(workspaceMount?.runtimeImportUrl) || null,
    iconPath: normalizeString(workspaceMount?.iconPath) || null,
    surfaceResolved: Boolean(workspaceMount?.workspaceSurface),
    surfaceSource: normalizeString(workspaceMount?.workspaceSurface?.source) || null,
    rootViewId: normalizeString(workspaceMount?.workspaceSurface?.root.viewId) || null,
    viewType:
      normalizeString(workspaceMount?.workspaceSurface?.root.viewType) || null,
  };
}

function normalizeRenderSelectionNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.floor(value);
}

function createRenderSelectionDoctorStatus(input: {
  initialized: boolean;
  current: PlatformRenderSelectionRecord | null | undefined;
  persisted: PlatformRenderSelectionRecord | null | undefined;
}): PlatformPackDoctorRenderSelectionStatus {
  const currentPresent = Boolean(input.current);
  const persistedPresent = Boolean(input.persisted);
  const currentMounted = currentPresent ? input.current?.mounted === true : null;
  const currentMountedAtMs = currentPresent
    ? normalizeRenderSelectionNumber(input.current?.mountedAtMs)
    : null;
  const currentOrder = currentPresent ? normalizeRenderSelectionNumber(input.current?.order) : null;
  const persistedMounted = persistedPresent ? input.persisted?.mounted === true : null;
  const persistedMountedAtMs = persistedPresent
    ? normalizeRenderSelectionNumber(input.persisted?.mountedAtMs)
    : null;
  const persistedOrder = persistedPresent
    ? normalizeRenderSelectionNumber(input.persisted?.order)
    : null;
  const inSync =
    currentPresent === persistedPresent &&
    (!currentPresent ||
      (currentMounted === persistedMounted &&
        currentMountedAtMs === persistedMountedAtMs &&
        currentOrder === persistedOrder));

  return {
    registryInitialized: input.initialized,
    currentPresent,
    currentMounted,
    currentMountedAtMs,
    currentOrder,
    persistedPresent,
    persistedMounted,
    persistedMountedAtMs,
    persistedOrder,
    inSync,
  };
}

function toDoctorIssueFromWorkspaceDiagnostic(
  diagnostic: PlatformPackWorkspaceReadinessDiagnostic
): PlatformPackDoctorIssue {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    fields: Object.fromEntries(
      Object.entries(diagnostic.fields ?? {})
        .filter(([, value]) => value !== null)
        .map(([key, value]) => [key, String(value)])
    ),
  };
}

function resolveStatusWithWorkspaceDiagnostics(input: {
  issues: PlatformPackDoctorIssue[];
  workspaceDiagnostics?: readonly PlatformPackWorkspaceReadinessDiagnostic[];
}): PlatformPackDoctorStatus {
  return resolveStatusFromIssues([
    ...input.issues,
    ...(input.workspaceDiagnostics ?? []).map(toDoctorIssueFromWorkspaceDiagnostic),
  ]);
}

function pushWorkspaceRoutingIssue(
  issues: PlatformPackDoctorIssue[],
  workspaceRouting: PlatformRuntimeWorkspaceRouting | null | undefined
): void {
  if (!workspaceRouting) {
    return;
  }

  if (workspaceRouting.status === 'fallback') {
    pushIssue(issues, 'workspace.fallback-to-legacy', 'warn', {
      ownershipMode: workspaceRouting.ownershipMode,
      path: workspaceRouting.path,
      reasonCode: workspaceRouting.fallbackReasonCode,
      reasonMessage: workspaceRouting.fallbackReasonMessage,
      packReady: workspaceRouting.packWorkspaceReady,
    });
    return;
  }

  if (workspaceRouting.status === 'blocked') {
    pushIssue(issues, 'workspace.pack-mode-blocked', 'error', {
      ownershipMode: workspaceRouting.ownershipMode,
      path: workspaceRouting.path,
      reasonCode: workspaceRouting.fallbackReasonCode,
      reasonMessage: workspaceRouting.fallbackReasonMessage,
      packReady: workspaceRouting.packWorkspaceReady,
    });
  }
}

function sortInstallationReports(
  left: PlatformPackDoctorInstallationReport,
  right: PlatformPackDoctorInstallationReport
): number {
  const installedAtDiff = left.installedAtMs - right.installedAtMs;
  if (installedAtDiff !== 0) return installedAtDiff;
  return left.installationId.localeCompare(right.installationId, 'zh-CN');
}

function sortInstanceReports(
  left: PlatformPackDoctorInstanceReport,
  right: PlatformPackDoctorInstanceReport
): number {
  const importedDiff = Number(right.imported) - Number(left.imported);
  if (importedDiff !== 0) return importedDiff;
  const displayNameDiff = left.displayName.localeCompare(right.displayName, 'zh-CN');
  if (displayNameDiff !== 0) return displayNameDiff;
  return left.instanceId.localeCompare(right.instanceId, 'zh-CN');
}

function normalizeDiagnosticFingerprintValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDiagnosticFingerprintValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([key, item]) => [key, normalizeDiagnosticFingerprintValue(item)])
    );
  }
  return value ?? null;
}

function buildPlatformPackDoctorTelemetryFingerprint(
  report: PlatformPackDoctorReport
): string {
  return JSON.stringify(
    normalizeDiagnosticFingerprintValue({
      status: report.status,
      expectedBuiltinCount: report.expectedBuiltinCount,
      installationCount: report.installationCount,
      instanceCount: report.instanceCount,
      readyConnectorCount: report.readyConnectorCount,
      degradedConnectorCount: report.degradedConnectorCount,
      errorConnectorCount: report.errorConnectorCount,
      issues: report.issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        fields: issue.fields ?? null,
      })),
      connectors: report.connectors.map((connector) => ({
        connectorId: connector.connectorId,
        status: connector.status,
        workspaceRouting: {
          status: connector.workspaceRouting.status,
          path: connector.workspaceRouting.path,
          ownershipMode: connector.workspaceRouting.ownershipMode,
          packWorkspaceReady: connector.workspaceRouting.packWorkspaceReady,
          fallbackReasonCode: connector.workspaceRouting.fallbackReasonCode,
        },
        requiredFlows: connector.requiredFlows,
        issues: connector.issues.map((issue) => ({
          code: issue.code,
          severity: issue.severity,
          fields: issue.fields ?? null,
        })),
        installations: connector.installations.map((installation) => ({
          installationId: installation.installationId,
          status: installation.status,
          sourceType: installation.sourceType,
          source: installation.source,
          packageDigest: installation.packageDigest,
          artifactsPresent: installation.artifactsPresent,
          registrationPresent: installation.registrationPresent,
          activeConnectorRegistration: installation.activeConnectorRegistration,
          workspaceSurfaceResolved: installation.workspaceSurface.resolved,
          workspaceSurfaceRuntimeImportUrl: installation.workspaceSurface.runtimeImportUrl,
          workspaceReadinessReady: installation.workspaceReadiness.ready,
          issues: installation.issues.map((issue) => ({
            code: issue.code,
            severity: issue.severity,
            fields: issue.fields ?? null,
          })),
        })),
        instances: connector.instances.map((instance) => ({
          instanceId: instance.instanceId,
          installationId: instance.installationId,
          status: instance.status,
          imported: instance.imported,
          instanceRecordPresent: instance.instanceRecordPresent,
          importedRegistryPresent: instance.importedRegistryPresent,
          descriptorPresent: instance.descriptorPresent,
          installationPresent: instance.installationPresent,
          workspaceRouting: {
            status: instance.workspaceRouting.status,
            path: instance.workspaceRouting.path,
            ownershipMode: instance.workspaceRouting.ownershipMode,
            packWorkspaceReady: instance.workspaceRouting.packWorkspaceReady,
            fallbackReasonCode: instance.workspaceRouting.fallbackReasonCode,
          },
          workspaceMount: {
            resolutionSource: instance.workspaceMount.resolutionSource,
            installationId: instance.workspaceMount.installationId,
            sourceType: instance.workspaceMount.sourceType,
            source: instance.workspaceMount.source,
            packId: instance.workspaceMount.packId,
            packVersion: instance.workspaceMount.packVersion,
            packageDigest: instance.workspaceMount.packageDigest,
            artifactRootPath: instance.workspaceMount.artifactRootPath,
            runtimePath: instance.workspaceMount.runtimePath,
            runtimeImportUrl: instance.workspaceMount.runtimeImportUrl,
            iconPath: instance.workspaceMount.iconPath,
            surfaceResolved: instance.workspaceMount.surfaceResolved,
            surfaceSource: instance.workspaceMount.surfaceSource,
            rootViewId: instance.workspaceMount.rootViewId,
            viewType: instance.workspaceMount.viewType,
          },
          issues: instance.issues.map((issue) => ({
            code: issue.code,
            severity: issue.severity,
            fields: issue.fields ?? null,
          })),
        })),
      })),
    })
  );
}

function sortConnectorIds(left: PlatformConnectorId, right: PlatformConnectorId): number {
  return left.localeCompare(right, 'zh-CN');
}

function sortIssues(left: PlatformPackDoctorIssue, right: PlatformPackDoctorIssue): number {
  const severityWeight = (value: PlatformPackDoctorSeverity): number => {
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

function dedupeAndSortStringArray(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => normalizeString(value).length > 0))].sort((left, right) =>
    left.localeCompare(right, 'en')
  );
}

function listRuntimeMethodNames(
  runtime: PlatformCompatRuntimeApi | null | undefined,
  bucket: PlatformPackDoctorRuntimeBucket
): string[] {
  const bucketRecord = runtime?.[bucket];
  if (!bucketRecord || typeof bucketRecord !== 'object' || Array.isArray(bucketRecord)) {
    return [];
  }

  return dedupeAndSortStringArray(
    Object.entries(bucketRecord)
      .filter(([, value]) => typeof value === 'function')
      .map(([key]) => key)
  );
}

function resolveDisplayName(input: {
  connectorId: PlatformConnectorId;
  definition: PlatformConnectorDefinition | null;
  registration: PlatformPackRegistrationRecord | null;
  descriptor: PlatformRuntimeDescriptor | null;
  installedRecord: InstalledPlatformPackRecord | null;
}): string {
  return (
    normalizeString(input.definition?.displayName) ||
    normalizeString(input.registration?.definition.displayName) ||
    normalizeString(input.descriptor?.displayName) ||
    normalizeString(input.installedRecord?.manifest.connector.displayName) ||
    input.connectorId.replace(/^connector\.platform\./i, '') ||
    input.connectorId
  );
}

function resolveContract(input: {
  registration: PlatformPackRegistrationRecord | null;
  descriptor: PlatformRuntimeDescriptor | null;
  installedRecord: InstalledPlatformPackRecord | null;
}): PlatformCompatContractFile | null {
  return (
    input.registration?.compat.contract ??
    input.descriptor?.compatRegistryRecord?.contract ??
    input.installedRecord?.contract ??
    null
  );
}

function resolveRuntime(input: {
  registration: PlatformPackRegistrationRecord | null;
  descriptor: PlatformRuntimeDescriptor | null;
}): PlatformCompatRuntimeApi | null {
  return input.registration?.compat.runtime ?? input.descriptor?.runtime ?? null;
}

function pushIssue(
  issues: PlatformPackDoctorIssue[],
  code: string,
  severity: PlatformPackDoctorSeverity,
  fields?: Record<string, string | number | boolean | null>
): void {
  issues.push({
    code,
    severity,
    fields,
  });
}

function mapReadinessDiagnosticSeverity(
  severity: PlatformPackReadinessDiagnostic['severity']
): PlatformPackDoctorSeverity {
  return severity;
}

function pushIssueFromReadinessDiagnostic(
  issues: PlatformPackDoctorIssue[],
  diagnostic: PlatformPackReadinessDiagnostic
): void {
  pushIssue(issues, diagnostic.code, mapReadinessDiagnosticSeverity(diagnostic.severity), {
    phase: diagnostic.phase,
    message: diagnostic.message,
    sourceType: diagnostic.sourceType,
    source: diagnostic.source,
    packId: diagnostic.packId,
    packVersion: diagnostic.packVersion,
    ...(diagnostic.fields ?? {}),
  });
}

function resolveStatusFromIssues(issues: readonly PlatformPackDoctorIssue[]): PlatformPackDoctorStatus {
  if (issues.some((issue) => issue.severity === 'error')) {
    return 'error';
  }
  if (issues.some((issue) => issue.severity === 'warn')) {
    return 'degraded';
  }
  return 'ready';
}

function resolveBindingId(
  contract: PlatformCompatContractFile | null,
  bucket: PlatformPackDoctorRuntimeBucket
): string {
  if (!contract) return '';
  const bindingKey = CONTRACT_BUCKET_BINDING_KEYS[bucket];
  return normalizeString(contract.apiBindings[bindingKey]);
}

function resolveSupportedBindingId(
  bucket: PlatformPackDoctorRuntimeBucket
): string {
  return normalizeString(PMP_SUPPORTED_BINDINGS_BY_BUCKET[bucket]);
}

function createBucketCoverage(
  contract: PlatformCompatContractFile | null,
  runtime: PlatformCompatRuntimeApi | null,
  bucket: PlatformPackDoctorRuntimeBucket
): PlatformPackDoctorRuntimeBucketCoverage | null {
  const bindingId = resolveBindingId(contract, bucket);
  if (!bindingId) {
    return null;
  }

  const expectedMethodNames = [...STANDARD_RUNTIME_METHODS[bucket]];
  const runtimeMethodNames = listRuntimeMethodNames(runtime, bucket);
  const runtimeMethodNameSet = new Set(runtimeMethodNames);
  const missingMethodNames = expectedMethodNames.filter(
    (methodName) => !runtimeMethodNameSet.has(methodName)
  );

  return {
    bucket,
    bindingId,
    runtimeMethodNames,
    expectedMethodNames,
    missingMethodNames,
  };
}

function resolveFlowStatus(
  contract: PlatformCompatContractFile | null,
  coverage: PlatformPackDoctorRuntimeBucketCoverage | null,
  capability: boolean
): PlatformPackDoctorFlowStatus {
  if (!capability) {
    return 'unsupported';
  }
  if (!contract) {
    return 'error';
  }
  if (!coverage) {
    return 'error';
  }
  return coverage.missingMethodNames.length > 0 ? 'degraded' : 'ready';
}

function createStoreIssueFields(
  inspection: BuiltinPlatformPackStoreInspectionEntry
): Record<string, string | number | boolean | null> {
  return {
    reasonCodes:
      inspection.effectiveReasonCodes.length > 0
        ? inspection.effectiveReasonCodes.join(',')
        : null,
    storedRecordFound: inspection.storedRecordFound,
    artifactsPresent: inspection.artifactsPresent,
    storedSourceType: inspection.storedSourceType,
    storedPackVersion: inspection.storedPackVersion,
    indexEntryPresent: inspection.indexEntryPresent,
    indexPackVersion: inspection.indexPackVersion,
  };
}

function pickConnectorIds(input: {
  builtinAssets: BuiltinPlatformPackAssetDefinition[];
  installedRecords: InstalledPlatformPackRecord[];
  registrations: PlatformPackRegistrationRecord[];
  descriptors: PlatformRuntimeDescriptor[];
  definitions: PlatformConnectorDefinition[];
  readinessDiagnostics: PlatformPackReadinessDiagnostic[];
  importedInstances: PlatformImportedInstanceRecord[];
  platformInstances: PlatformInstanceRecord[];
}): PlatformConnectorId[] {
  return Array.from(
    new Set<PlatformConnectorId>([
      ...input.builtinAssets.map((asset) => asset.connectorId),
      ...input.installedRecords.map((record) => record.connectorId),
      ...input.registrations.map((record) => record.connectorId),
      ...input.descriptors.map((descriptor) => descriptor.connectorId),
      ...input.definitions.map((definition) => definition.connectorId),
      ...input.importedInstances.map((record) => record.connectorId),
      ...input.platformInstances
        .map((record) => readConnectorIdFromInstanceRecord(record))
        .filter((connectorId): connectorId is PlatformConnectorId => Boolean(connectorId)),
      ...input.readinessDiagnostics
        .map((diagnostic) => diagnostic.connectorId)
        .filter((connectorId): connectorId is PlatformConnectorId => Boolean(connectorId)),
    ])
  ).sort(sortConnectorIds);
}

export async function inspectPlatformPackDoctor(): Promise<PlatformPackDoctorReport> {
  const startedAtMs = getMusicPlatformNowMs();
  const generatedAtMs = Date.now();
  const startupHealth = getPlatformPackStartupHealth();
  const builtinAssets = listBuiltinPlatformPackAssets();
  const definitions = listPlatformConnectorDefinitions();
  const registrations = listPlatformPackRegistrations();
  const descriptors = listPlatformRuntimeDescriptors();
  const installedRecords = loadInstalledPlatformPackRecords();
  const importedInstances = listPlatformImportedInstanceRecords();
  const platformInstances = listPlatformInstances();
  const readinessDiagnostics = listPlatformPackReadinessDiagnostics();
  const renderSelectionInspection = inspectPlatformRenderSelectionPersistence();
  const reportIssues: PlatformPackDoctorIssue[] = [];
  let storeInspection: BuiltinPlatformPackStoreInspection | null = null;

  if (isTauriRuntime()) {
    try {
      storeInspection = await inspectBuiltinPlatformPackStoreState();
    } catch (error) {
      pushIssue(reportIssues, 'store-inspection.failed', 'error', {
        message: readMusicPlatformDiagnosticErrorMessage(error),
      });
    }
  }

  const [
    installedArtifactPresenceEntries,
    installedRuntimeResolutionEntries,
    installedIconResolutionEntries,
  ] = await Promise.all([
    Promise.all(
      installedRecords.map(async (record) => [
        record.installationId,
        await areInstalledPlatformPackArtifactsPresent(record).catch(() => false),
      ] as const)
    ),
    Promise.all(
      installedRecords.map(async (record) => [
        record.installationId,
        await createInstalledPlatformPackEntryUrl(record.runtimePath)
          .then(() => true)
          .catch(() => false),
      ] as const)
    ),
    Promise.all(
      installedRecords.map(async (record) => [
        record.installationId,
        await createInstalledPlatformPackEntryUrl(record.iconPath)
          .then(() => true)
          .catch(() => false),
      ] as const)
    ),
  ]);

  const builtinAssetByConnectorId = new Map(
    builtinAssets.map((asset) => [asset.connectorId, asset] as const)
  );
  const definitionByConnectorId = new Map(
    definitions.map((definition) => [definition.connectorId, definition] as const)
  );
  const registrationByConnectorId = new Map(
    registrations.map((registration) => [registration.connectorId, registration] as const)
  );
  const descriptorByConnectorId = new Map(
    descriptors.map((descriptor) => [descriptor.connectorId, descriptor] as const)
  );
  const installedRecordsByConnectorId = new Map<
    PlatformConnectorId,
    InstalledPlatformPackRecord[]
  >();
  for (const record of installedRecords) {
    const bucket = installedRecordsByConnectorId.get(record.connectorId) ?? [];
    bucket.push(record);
    installedRecordsByConnectorId.set(record.connectorId, bucket);
  }
  const installedRecordByInstallationId = new Map(
    installedRecords.map((record) => [record.installationId, record] as const)
  );
  const installedArtifactsPresentByInstallationId = new Map(
    installedArtifactPresenceEntries
  );
  const runtimeResolvedByInstallationId = new Map(installedRuntimeResolutionEntries);
  const iconResolvedByInstallationId = new Map(installedIconResolutionEntries);
  const storeEntryByConnectorId = new Map(
    (storeInspection?.entries ?? []).map((entry) => [entry.connectorId, entry] as const)
  );
  const importedInstancesByConnectorId = new Map<
    PlatformConnectorId,
    PlatformImportedInstanceRecord[]
  >();
  const importedInstanceById = new Map(
    importedInstances.map((record) => [record.instanceId, record] as const)
  );
  for (const record of importedInstances) {
    const bucket = importedInstancesByConnectorId.get(record.connectorId) ?? [];
    bucket.push(record);
    importedInstancesByConnectorId.set(record.connectorId, bucket);
  }
  const instanceRecordsByConnectorId = new Map<
    PlatformConnectorId,
    PlatformInstanceRecord[]
  >();
  const instanceRecordById = new Map(
    platformInstances.map((record) => [record.instanceId, record] as const)
  );
  const currentRenderSelectionByInstanceId = new Map(
    renderSelectionInspection.live.map((record) => [record.instanceId, record] as const)
  );
  const persistedRenderSelectionByInstanceId = new Map(
    renderSelectionInspection.persisted.map((record) => [record.instanceId, record] as const)
  );
  for (const record of platformInstances) {
    const connectorId = readConnectorIdFromInstanceRecord(record);
    if (!connectorId) continue;
    const bucket = instanceRecordsByConnectorId.get(connectorId) ?? [];
    bucket.push(record);
    instanceRecordsByConnectorId.set(connectorId, bucket);
  }
  const readinessDiagnosticsByConnectorId = new Map<
    PlatformConnectorId,
    PlatformPackReadinessDiagnostic[]
  >();
  const readinessDiagnosticsBySource = new Map<string, PlatformPackReadinessDiagnostic[]>();
  for (const diagnostic of readinessDiagnostics) {
    if (!diagnostic.connectorId) {
      pushIssueFromReadinessDiagnostic(reportIssues, diagnostic);
    } else {
      const connectorList = readinessDiagnosticsByConnectorId.get(diagnostic.connectorId) ?? [];
      connectorList.push(diagnostic);
      readinessDiagnosticsByConnectorId.set(diagnostic.connectorId, connectorList);
    }
    const source = normalizeString(diagnostic.source);
    if (source) {
      const sourceList = readinessDiagnosticsBySource.get(source) ?? [];
      sourceList.push(diagnostic);
      readinessDiagnosticsBySource.set(source, sourceList);
    }
  }

  const connectors = pickConnectorIds({
    builtinAssets,
    installedRecords,
    registrations,
    descriptors,
    definitions,
    readinessDiagnostics,
    importedInstances,
    platformInstances,
  }).map((connectorId) => {
    const connectorInstalledRecords =
      installedRecordsByConnectorId.get(connectorId) ?? [];
    const packAsset = builtinAssetByConnectorId.get(connectorId) ?? null;
    const definition = definitionByConnectorId.get(connectorId) ?? null;
    const registration = registrationByConnectorId.get(connectorId) ?? null;
    const descriptor = descriptorByConnectorId.get(connectorId) ?? null;
    const workspaceRouting =
      descriptor?.workspaceRouting ??
      resolvePlatformWorkspaceRoutingForConnector(connectorId);
    const installedRecord =
      connectorInstalledRecords.find(
        (record) => registration?.source === buildInstalledPackSource(record)
      ) ??
      connectorInstalledRecords[connectorInstalledRecords.length - 1] ??
      null;
    const storeEntry = storeEntryByConnectorId.get(connectorId) ?? null;
    const contract = resolveContract({
      registration,
      descriptor,
      installedRecord,
    });
    const runtime = resolveRuntime({
      registration,
      descriptor,
    });
    const issues: PlatformPackDoctorIssue[] = [];
    const connectorReadinessDiagnostics =
      readinessDiagnosticsByConnectorId.get(connectorId) ?? [];

    if (storeEntry && storeEntry.effectiveReasonCodes.length > 0) {
      pushIssue(issues, 'store.stale', 'warn', createStoreIssueFields(storeEntry));
    } else if (
      !packAsset &&
      installedRecord &&
      installedArtifactsPresentByInstallationId.get(installedRecord.installationId) === false
    ) {
      pushIssue(issues, 'store.artifacts-missing', 'warn', {
        sourceType: installedRecord.sourceType,
      });
    }

    if (packAsset && !registration) {
      pushIssue(issues, 'registration.missing', 'error', {
        expectedBuiltin: true,
      });
    }
    if (!packAsset && installedRecord && !registration) {
      pushIssue(issues, 'registration.missing', 'error', {
        expectedBuiltin: false,
        sourceType: installedRecord.sourceType,
      });
    }
    if (packAsset && !descriptor) {
      pushIssue(issues, 'descriptor.missing', 'error', {
        expectedBuiltin: true,
      });
    }
    if (!packAsset && (installedRecord || registration) && !descriptor) {
      pushIssue(issues, 'descriptor.missing', 'error', {
        expectedBuiltin: false,
        sourceType: installedRecord?.sourceType ?? null,
      });
    }
    if ((packAsset || registration || installedRecord) && !definition) {
      pushIssue(issues, 'connector-definition.missing', 'error');
    }
    if ((packAsset || registration || installedRecord) && !contract) {
      pushIssue(issues, 'contract.missing', 'error');
    }

    for (const diagnostic of connectorReadinessDiagnostics) {
      pushIssueFromReadinessDiagnostic(issues, diagnostic);
    }

    pushWorkspaceRoutingIssue(issues, workspaceRouting);

    const bucketCoverage = ([
      'auth',
      'library',
      'recommendations',
      'search',
      'quality',
      'pages',
    ] as const)
      .map((bucket) => createBucketCoverage(contract, runtime, bucket))
      .filter(
        (coverage): coverage is PlatformPackDoctorRuntimeBucketCoverage => Boolean(coverage)
      );

    for (const coverage of bucketCoverage) {
      if (!runtime || coverage.runtimeMethodNames.length < 1) {
        pushIssue(issues, 'runtime.bucket-missing', 'warn', {
          bucket: coverage.bucket,
          bindingId: coverage.bindingId,
        });
        continue;
      }
      if (coverage.missingMethodNames.length > 0) {
        pushIssue(issues, 'runtime.methods-missing', 'warn', {
          bucket: coverage.bucket,
          bindingId: coverage.bindingId,
          missingMethods: coverage.missingMethodNames.join(','),
        });
      }
    }

    if (contract) {
      for (const bucket of [
        'auth',
        'library',
        'recommendations',
        'search',
        'quality',
        'settings',
        'pages',
      ] as const) {
        const bindingId = resolveBindingId(contract, bucket);
        if (!bindingId) {
          continue;
        }
        const supportedBindingId = resolveSupportedBindingId(bucket);
        if (supportedBindingId && bindingId !== supportedBindingId) {
          pushIssue(issues, 'contract.binding-unsupported', 'warn', {
            bucket,
            bindingId,
            supportedBindingId,
          });
        } else if (!supportedBindingId) {
          pushIssue(issues, 'contract.binding-unsupported', 'warn', {
            bucket,
            bindingId,
            supportedBindingId: null,
          });
        }
      }

      const capabilityChecks = [
        {
          bucket: 'recommendations' as const,
          capability: contract.capabilities.dailyRecommendations,
        },
        {
          bucket: 'quality' as const,
          capability: contract.capabilities.quality,
        },
        {
          bucket: 'pages' as const,
          capability: contract.capabilities.pages,
        },
      ];

      for (const check of capabilityChecks) {
        if (!check.capability) {
          continue;
        }
        const bindingId = resolveBindingId(contract, check.bucket);
        if (!bindingId) {
          pushIssue(issues, 'contract.binding-missing', 'error', {
            bucket: check.bucket,
          });
        }
      }
    }

    const coverageByBucket = new Map(bucketCoverage.map((coverage) => [coverage.bucket, coverage] as const));
    const requiredFlows = {
      recommendations: resolveFlowStatus(
        contract,
        coverageByBucket.get('recommendations') ?? null,
        contract?.capabilities.dailyRecommendations === true
      ),
      quality: resolveFlowStatus(
        contract,
        coverageByBucket.get('quality') ?? null,
        contract?.capabilities.quality === true
      ),
      pages: resolveFlowStatus(
        contract,
        coverageByBucket.get('pages') ?? null,
        contract?.capabilities.pages === true
      ),
    };

    const installations = connectorInstalledRecords
      .map((record) => {
        const source = buildInstalledPackSource(record);
        const artifactsPresent =
          installedArtifactsPresentByInstallationId.get(record.installationId) ?? false;
        const workspaceReadiness = inspectPlatformPackWorkspaceReadinessForInstallation(
          record.installationId
        );
        const workspaceSurface = resolvePlatformPackWorkspaceSurfaceForInstallation(
          record.installationId
        );
        const installationIssues: PlatformPackDoctorIssue[] = [];

        for (const diagnostic of readinessDiagnosticsBySource.get(source) ?? []) {
          pushIssueFromReadinessDiagnostic(installationIssues, diagnostic);
        }

        if (!artifactsPresent) {
          pushIssue(installationIssues, 'installation.artifacts-missing', 'warn', {
            installationId: record.installationId,
            sourceType: record.sourceType,
          });
        }
        if (!(runtimeResolvedByInstallationId.get(record.installationId) ?? false)) {
          pushIssue(installationIssues, 'installation.runtime-entry.unresolved', 'warn', {
            installationId: record.installationId,
            runtimePath: record.runtimePath,
          });
        }
        if (!(iconResolvedByInstallationId.get(record.installationId) ?? false)) {
          pushIssue(installationIssues, 'installation.icon-entry.unresolved', 'warn', {
            installationId: record.installationId,
            iconPath: record.iconPath,
          });
        }
        if (!workspaceReadiness.registrationPresent) {
          pushIssue(installationIssues, 'installation.registration.missing', 'error', {
            installationId: record.installationId,
            sourceType: record.sourceType,
            source,
          });
        }

        return {
          installationId: record.installationId,
          connectorId: record.connectorId,
          platformId: record.platformId,
          packId: record.packId,
          packVersion: record.packVersion,
          sourceType: record.sourceType,
          source: normalizeString(record.source) || source,
          installedAtMs: record.installedAtMs,
          packageDigest: normalizeString(record.packageDigest) || null,
          status: resolveStatusWithWorkspaceDiagnostics({
            issues: installationIssues,
            workspaceDiagnostics: workspaceReadiness.diagnostics,
          }),
          artifactsPresent,
          registrationPresent: workspaceReadiness.registrationPresent,
          activeConnectorRegistration: registration?.source === source,
          artifactRoot: createResolvedAssetStatus(
            record.artifactRootPath,
            normalizeString(record.artifactRootPath).length > 0
          ),
          runtime: createResolvedAssetStatus(
            record.runtimePath,
            runtimeResolvedByInstallationId.get(record.installationId) ?? false
          ),
          icon: createResolvedAssetStatus(
            record.iconPath,
            iconResolvedByInstallationId.get(record.installationId) ?? false
          ),
          workspaceSurface: {
            resolved: Boolean(workspaceSurface),
            source: workspaceSurface?.source ?? null,
            rootViewId: workspaceSurface?.root.viewId ?? null,
            viewType: workspaceSurface?.root.viewType ?? null,
            requiredRuntimeCarrier: workspaceSurface?.requiredRuntimeCarrier ?? null,
            runtimeImportUrl: normalizeString(workspaceSurface?.runtimeImportUrl) || null,
          },
          workspaceReadiness,
          issues: installationIssues.sort(sortIssues),
        } satisfies PlatformPackDoctorInstallationReport;
      })
      .sort(sortInstallationReports);

    const connectorInstanceIds = new Set<string>([
      ...(importedInstancesByConnectorId.get(connectorId) ?? []).map((record) => record.instanceId),
      ...(instanceRecordsByConnectorId.get(connectorId) ?? []).map((record) => record.instanceId),
    ]);
    if (descriptor?.instanceRecord?.instanceId) {
      connectorInstanceIds.add(descriptor.instanceRecord.instanceId);
    }

    const instances = Array.from(connectorInstanceIds)
      .map((instanceId) => {
        const importedRecord = importedInstanceById.get(instanceId) ?? null;
        const instanceRecord = instanceRecordById.get(instanceId) ?? null;
        const runtimeDescriptor = resolvePlatformRuntimeDescriptorByInstanceId(instanceId);
        const installationId =
          importedRecord?.installationId ?? readInstallationIdFromInstanceRecord(instanceRecord);
        const runtimeDescriptorRouting =
          runtimeDescriptor?.workspaceRouting ??
          resolvePlatformWorkspaceRoutingForInstanceId(instanceId) ??
          resolvePlatformWorkspaceRoutingForConnector(connectorId);
        const runtimeDescriptorMount = runtimeDescriptor?.workspaceMount ?? null;
        const resolvedInstallationId =
          runtimeDescriptorMount?.installationId ?? installationId ?? null;
        const installationRecord = resolvedInstallationId
          ? installedRecordByInstallationId.get(resolvedInstallationId) ?? null
          : null;
        const renderSelection = createRenderSelectionDoctorStatus({
          initialized: renderSelectionInspection.initialized,
          current: currentRenderSelectionByInstanceId.get(instanceId),
          persisted: persistedRenderSelectionByInstanceId.get(instanceId),
        });
        const instanceIssues: PlatformPackDoctorIssue[] = [];

        if (importedRecord && !instanceRecord) {
          pushIssue(instanceIssues, 'instance.record.missing', 'error', {
            instanceId,
            installationId: importedRecord.installationId,
          });
        }
        if (instanceRecord && !runtimeDescriptor) {
          pushIssue(instanceIssues, 'instance.descriptor.missing', 'error', {
            instanceId,
            connectorId,
          });
        }
        if (resolvedInstallationId && !installationRecord) {
          pushIssue(instanceIssues, 'instance.installation.missing', 'error', {
            instanceId,
            installationId: resolvedInstallationId,
          });
        }
        if (renderSelection.registryInitialized && !renderSelection.currentPresent) {
          pushIssue(instanceIssues, 'render-selection.current.missing', 'warn', {
            instanceId,
          });
        }
        if (renderSelection.registryInitialized && !renderSelection.inSync) {
          pushIssue(instanceIssues, 'render-selection.persistence.mismatch', 'warn', {
            instanceId,
            currentPresent: renderSelection.currentPresent,
            currentMounted: renderSelection.currentMounted,
            currentMountedAtMs: renderSelection.currentMountedAtMs,
            currentOrder: renderSelection.currentOrder,
            persistedPresent: renderSelection.persistedPresent,
            persistedMounted: renderSelection.persistedMounted,
            persistedMountedAtMs: renderSelection.persistedMountedAtMs,
            persistedOrder: renderSelection.persistedOrder,
          });
        }
        pushWorkspaceRoutingIssue(instanceIssues, runtimeDescriptorRouting);

        const metadataSourceType = normalizeString(instanceRecord?.metadata?.sourceType);
        const sourceType =
          runtimeDescriptorMount?.sourceType ??
          installationRecord?.sourceType ??
          (metadataSourceType === 'builtin' || metadataSourceType === 'external'
            ? metadataSourceType
            : null);
        const source =
          normalizeString(runtimeDescriptorMount?.source) ||
          normalizeString(installationRecord?.source) ||
          normalizeString(instanceRecord?.metadata?.source) ||
          null;
        const displayName =
          normalizeString(runtimeDescriptor?.displayName) ||
          normalizeString(instanceRecord?.displayName) ||
          normalizeString(importedRecord?.displayName) ||
          instanceId;
        const instanceLabel =
          normalizeString(instanceRecord?.instanceLabel) ||
          normalizeString(importedRecord?.instanceLabel) ||
          displayName;
        const platformId =
          normalizeString(importedRecord?.platformId) ||
          normalizeString(runtimeDescriptor?.platformId) ||
          normalizeString(instanceRecord?.platformId) ||
          normalizeString(installationRecord?.platformId) ||
          connectorId.replace(/^connector\.platform\./i, '') ||
          'unknown';

        return {
          instanceId,
          installationId: resolvedInstallationId,
          connectorId,
          platformId,
          sourceType,
          source,
          displayName,
          instanceLabel,
          imported:
            Boolean(importedRecord) || instanceRecord?.metadata?.imported === true,
          instanceRecordPresent: Boolean(instanceRecord),
          importedRegistryPresent: Boolean(importedRecord),
          descriptorPresent: Boolean(runtimeDescriptor),
          installationPresent: resolvedInstallationId ? Boolean(installationRecord) : true,
          authState: instanceRecord?.auth.status ?? null,
          availability: instanceRecord?.availability ?? null,
          status: resolveStatusWithWorkspaceDiagnostics({
            issues: instanceIssues,
            workspaceDiagnostics: runtimeDescriptorRouting?.diagnostics ?? [],
          }),
          workspaceRouting:
            runtimeDescriptorRouting ?? resolvePlatformWorkspaceRoutingForConnector(connectorId)!,
          workspaceMount: createInstanceWorkspaceMountStatus(runtimeDescriptorMount),
          renderSelection,
          issues: instanceIssues.sort(sortIssues),
        } satisfies PlatformPackDoctorInstanceReport;
      })
      .sort(sortInstanceReports);

    const status = resolveStatusFromIssues([
      ...issues,
      ...installations.flatMap((installation) => installation.issues),
      ...installations.flatMap((installation) =>
        installation.workspaceReadiness.diagnostics.map(toDoctorIssueFromWorkspaceDiagnostic)
      ),
      ...instances.flatMap((instance) => instance.issues),
      ...instances.flatMap((instance) =>
        instance.workspaceRouting.diagnostics.map(toDoctorIssueFromWorkspaceDiagnostic)
      ),
    ]);

    return {
      connectorId,
      displayName: resolveDisplayName({
        connectorId,
        definition,
        registration,
        descriptor,
        installedRecord,
      }),
      expectedBuiltin: Boolean(packAsset),
      status,
      issues: issues.sort(sortIssues),
      storeInspection: storeEntry,
      packAsset,
      installedRecord: {
        sourceType: installedRecord?.sourceType ?? null,
        source: normalizeString(installedRecord?.source) || null,
        installedAtMs: installedRecord?.installedAtMs ?? null,
        artifactsPresent:
          typeof installedRecord === 'object'
            ? installedArtifactsPresentByInstallationId.get(installedRecord.installationId) ??
              null
            : null,
      },
      registrationPresent: Boolean(registration),
      descriptorPresent: Boolean(descriptor),
      connectorDefinitionPresent: Boolean(definition),
      workspaceRouting: workspaceRouting ?? resolvePlatformWorkspaceRoutingForConnector(connectorId)!,
      requiredFlows,
      bucketCoverage,
      installations,
      instances,
    };
  });

  const installationCount = connectors.reduce(
    (count, connector) => count + connector.installations.length,
    0
  );
  const instanceCount = connectors.reduce(
    (count, connector) => count + connector.instances.length,
    0
  );
  const readyConnectorCount = connectors.filter((connector) => connector.status === 'ready').length;
  const degradedConnectorCount = connectors.filter(
    (connector) => connector.status === 'degraded'
  ).length;
  const errorConnectorCount = connectors.filter((connector) => connector.status === 'error').length;
  const status: PlatformPackDoctorStatus =
    errorConnectorCount > 0 ? 'error' : degradedConnectorCount > 0 ? 'degraded' : 'ready';
  const report: PlatformPackDoctorReport = {
    generatedAtMs,
    durationMs: getMusicPlatformDurationMs(startedAtMs),
    status,
    expectedBuiltinCount: builtinAssets.length,
    installationCount,
    instanceCount,
    readyConnectorCount,
    degradedConnectorCount,
    errorConnectorCount,
    issues: reportIssues.sort(sortIssues),
    startupHealth,
    connectors,
  };

  const reportTelemetryFingerprint: ConsecutiveDoctorTelemetryFingerprint = {
    status,
    fingerprint: buildPlatformPackDoctorTelemetryFingerprint(report),
  };
  if (
    !lastPlatformPackDoctorTelemetry ||
    lastPlatformPackDoctorTelemetry.status !== reportTelemetryFingerprint.status ||
    lastPlatformPackDoctorTelemetry.fingerprint !== reportTelemetryFingerprint.fingerprint
  ) {
    telemetry[status === 'error' ? 'error' : status === 'degraded' ? 'warn' : 'info'](
      'music-platform.pack.doctor.completed',
      {
        fields: {
          status,
          expectedBuiltinCount: report.expectedBuiltinCount,
          installationCount: report.installationCount,
          instanceCount: report.instanceCount,
          connectorCount: report.connectors.length,
          readyConnectorCount,
          degradedConnectorCount,
          errorConnectorCount,
          issueCount:
            report.issues.length +
            report.connectors.reduce(
              (count, connector) =>
                count +
                connector.issues.length +
                connector.installations.reduce(
                  (installationCount, installation) =>
                    installationCount + installation.issues.length,
                  0
                ) +
                connector.instances.reduce(
                  (instanceIssueCount, instance) =>
                    instanceIssueCount + instance.issues.length,
                  0
                ),
              0
            ),
        },
      }
    );
    lastPlatformPackDoctorTelemetry = reportTelemetryFingerprint;
  }

  return report;
}
