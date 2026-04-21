import {
  PLATFORM_COMPAT_PMP_SUPPORTED_BINDINGS,
  PlatformCompatContractFile,
  PlatformCompatRuntimeApi,
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
  loadInstalledPlatformPackRecords,
  type InstalledPlatformPackRecord,
} from './installedPlatformPacks';
import {
  getPlatformPackStartupHealth,
  inspectBuiltinPlatformPackStoreState,
  listBuiltinPlatformPackAssets,
  listPlatformPackReadinessDiagnostics,
  listPlatformPackRegistrations,
  type BuiltinPlatformPackAssetDefinition,
  type BuiltinPlatformPackStoreInspection,
  type BuiltinPlatformPackStoreInspectionEntry,
  type PlatformPackReadinessDiagnostic,
  type PlatformPackRegistrationRecord,
  type PlatformPackStartupHealth,
} from './platformPackRegistry';
import {
  listPlatformRuntimeDescriptors,
  type PlatformRuntimeDescriptor,
} from './platformRuntimeDescriptor';

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
  requiredFlows: {
    recommendations: PlatformPackDoctorFlowStatus;
    quality: PlatformPackDoctorFlowStatus;
    pages: PlatformPackDoctorFlowStatus;
  };
  bucketCoverage: PlatformPackDoctorRuntimeBucketCoverage[];
}

export interface PlatformPackDoctorReport {
  generatedAtMs: number;
  durationMs: number;
  status: PlatformPackDoctorStatus;
  expectedBuiltinCount: number;
  readyConnectorCount: number;
  degradedConnectorCount: number;
  errorConnectorCount: number;
  issues: PlatformPackDoctorIssue[];
  startupHealth: PlatformPackStartupHealth;
  connectors: PlatformPackDoctorConnectorReport[];
}

const telemetry = getTelemetryLogger('music-platform', 'platformPackDoctor');

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
}): PlatformConnectorId[] {
  return Array.from(
    new Set<PlatformConnectorId>([
      ...input.builtinAssets.map((asset) => asset.connectorId),
      ...input.installedRecords.map((record) => record.connectorId),
      ...input.registrations.map((record) => record.connectorId),
      ...input.descriptors.map((descriptor) => descriptor.connectorId),
      ...input.definitions.map((definition) => definition.connectorId),
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
  const readinessDiagnostics = listPlatformPackReadinessDiagnostics();
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

  const installedArtifactPresenceEntries = await Promise.all(
    installedRecords.map(async (record) => [
      record.connectorId,
      await areInstalledPlatformPackArtifactsPresent(record).catch(() => false),
    ] as const)
  );

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
  const installedRecordByConnectorId = new Map(
    installedRecords.map((record) => [record.connectorId, record] as const)
  );
  const installedArtifactsPresentByConnectorId = new Map(installedArtifactPresenceEntries);
  const storeEntryByConnectorId = new Map(
    (storeInspection?.entries ?? []).map((entry) => [entry.connectorId, entry] as const)
  );
  const readinessDiagnosticsByConnectorId = new Map<
    PlatformConnectorId,
    PlatformPackReadinessDiagnostic[]
  >();
  for (const diagnostic of readinessDiagnostics) {
    if (!diagnostic.connectorId) {
      pushIssueFromReadinessDiagnostic(reportIssues, diagnostic);
      continue;
    }
    const list = readinessDiagnosticsByConnectorId.get(diagnostic.connectorId) ?? [];
    list.push(diagnostic);
    readinessDiagnosticsByConnectorId.set(diagnostic.connectorId, list);
  }

  const connectors = pickConnectorIds({
    builtinAssets,
    installedRecords,
    registrations,
    descriptors,
    definitions,
    readinessDiagnostics,
  }).map((connectorId) => {
    const packAsset = builtinAssetByConnectorId.get(connectorId) ?? null;
    const definition = definitionByConnectorId.get(connectorId) ?? null;
    const registration = registrationByConnectorId.get(connectorId) ?? null;
    const descriptor = descriptorByConnectorId.get(connectorId) ?? null;
    const installedRecord = installedRecordByConnectorId.get(connectorId) ?? null;
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
      installedArtifactsPresentByConnectorId.get(connectorId) === false
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
      status: resolveStatusFromIssues(issues),
      issues: issues.sort(sortIssues),
      storeInspection: storeEntry,
      packAsset,
      installedRecord: {
        sourceType: installedRecord?.sourceType ?? null,
        source: normalizeString(installedRecord?.source) || null,
        installedAtMs: installedRecord?.installedAtMs ?? null,
        artifactsPresent:
          typeof installedRecord === 'object'
            ? installedArtifactsPresentByConnectorId.get(connectorId) ?? null
            : null,
      },
      registrationPresent: Boolean(registration),
      descriptorPresent: Boolean(descriptor),
      connectorDefinitionPresent: Boolean(definition),
      requiredFlows,
      bucketCoverage,
    };
  });

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
    readyConnectorCount,
    degradedConnectorCount,
    errorConnectorCount,
    issues: reportIssues.sort(sortIssues),
    startupHealth,
    connectors,
  };

  telemetry[status === 'error' ? 'error' : status === 'degraded' ? 'warn' : 'info'](
    'music-platform.pack.doctor.completed',
    {
      fields: {
        status,
        expectedBuiltinCount: report.expectedBuiltinCount,
        connectorCount: report.connectors.length,
        readyConnectorCount,
        degradedConnectorCount,
        errorConnectorCount,
        issueCount:
          report.issues.length +
          report.connectors.reduce((count, connector) => count + connector.issues.length, 0),
      },
    }
  );

  return report;
}
