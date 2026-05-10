import { strFromU8 } from 'fflate';
import type {
  PmpChecksumsV1,
  PmpExperiencePackManifestV1,
  PmpExperiencePackResourceDependencyV1,
  PmpExperiencePackSpaceApplyMode,
  PmpInstallPlanDiagnosticV1,
  PmpInstallPlanReviewItemV1,
  PmpInstallPlanStepV1,
  PmpInstallPlanV1,
} from '@pixel-matrix/plugin-platform-contracts';
import type { ProfilePackProfileV1 } from '../../../themes/packs/profilePack';
import { parseExtensionPackFromZipBytes, type ParsedExtensionPack } from './extensionPack';
import type {
  InstallPlanEmbeddedResourceSource,
  InstallPlanProfileSource,
  InstallPlanThemeSource,
} from './installPlanExecutorTypes';
import {
  assertUniquePackEntryPaths,
  comparePathStrings,
  findPackEntry,
  getPackPathParent,
  joinPackPath,
  normalizePackPath,
  unzipPackAsync,
  validateChecksumsObject,
  verifyPackChecksums,
  type PackZipFiles,
} from './packUtils';

export type ExperiencePackParseErrorCode =
  | 'INVALID_ZIP'
  | 'MANIFEST_MISSING'
  | 'MANIFEST_INVALID'
  | 'CHECKSUMS_MISSING'
  | 'CHECKSUMS_INVALID'
  | 'CHECKSUM_MISMATCH'
  | 'ENTRY_MISSING'
  | 'ENTRY_INVALID';

export class ExperiencePackParseError extends Error {
  readonly code: ExperiencePackParseErrorCode;

  constructor(code: ExperiencePackParseErrorCode, message: string) {
    super(message);
    this.name = 'ExperiencePackParseError';
    this.code = code;
  }
}

export interface ExperiencePackExecutorPreview {
  mode: 'preview';
  manifest: PmpExperiencePackManifestV1;
  plan: PmpInstallPlanV1;
  extensionPacksByStepId: Record<string, ParsedExtensionPack>;
  resourceSourcesByStepId: Record<string, InstallPlanEmbeddedResourceSource>;
  themeSourcesByPath: Record<string, InstallPlanThemeSource>;
  profileSourcesByPath: Record<string, InstallPlanProfileSource>;
  summary: {
    extensionCount: number;
    resourceCount: number;
    appliesTheme: boolean;
    appliesProfile: boolean;
    appliesSpaces: boolean;
    unsigned: boolean;
  };
}

export interface ParsedExperiencePack {
  manifest: PmpExperiencePackManifestV1;
  checksums: PmpChecksumsV1;
  plan: PmpInstallPlanV1;
  executorPreview: ExperiencePackExecutorPreview;
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
}

function validatePackageId(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value.trim())) {
    throw new Error(`${path} must be a valid package id`);
  }
  return value.trim();
}

function validateNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} is required`);
  }
  return value.trim();
}

function validateEmbeddedSource(value: unknown, path: string): { kind: 'embedded'; path: string } | undefined {
  if (typeof value === 'undefined') return undefined;
  assertObject(value, path);
  if (value.kind !== 'embedded') {
    throw new Error(`${path}.kind must be "embedded" for local .pmpex import`);
  }
  return {
    kind: 'embedded',
    path: normalizePackPath(validateNonEmptyString(value.path, `${path}.path`)),
  };
}

function validateSpaceApplyMode(value: unknown, path: string): PmpExperiencePackSpaceApplyMode | undefined {
  if (typeof value === 'undefined') return undefined;
  if (
    value === 'prompt' ||
    value === 'create-new-spaces' ||
    value === 'map-one-space' ||
    value === 'replace-all'
  ) {
    return value;
  }
  throw new Error(`${path} must be prompt, create-new-spaces, map-one-space, or replace-all`);
}

function normalizeProfilePath(value: unknown, path: string): string {
  return normalizePackPath(validateNonEmptyString(value, path));
}

export function validateExperiencePackManifestV1(
  value: unknown
): asserts value is PmpExperiencePackManifestV1 {
  assertObject(value, 'manifest');
  if (value.formatVersion !== '1.0') {
    throw new Error('manifest.formatVersion must be "1.0"');
  }
  if (value.type !== 'experience-pack') {
    throw new Error('manifest.type must be "experience-pack"');
  }

  assertObject(value.metadata, 'manifest.metadata');
  validatePackageId(value.metadata.id, 'manifest.metadata.id');
  validateNonEmptyString(value.metadata.name, 'manifest.metadata.name');
  validateNonEmptyString(value.metadata.version, 'manifest.metadata.version');

  if (typeof value.plugins !== 'undefined') {
    if (!Array.isArray(value.plugins)) throw new Error('manifest.plugins must be an array');
    value.plugins = value.plugins.map((plugin, index) => {
      assertObject(plugin, `manifest.plugins[${index}]`);
      const id = validatePackageId(plugin.id, `manifest.plugins[${index}].id`);
      const source = validateEmbeddedSource(plugin.source, `manifest.plugins[${index}].source`);
      return {
        id,
        ...(typeof plugin.versionRange === 'string' ? { versionRange: plugin.versionRange } : {}),
        ...(typeof plugin.required === 'boolean' ? { required: plugin.required } : {}),
        ...(source ? { source } : {}),
      };
    });
  }

  if (typeof value.resources !== 'undefined') {
    if (!Array.isArray(value.resources)) throw new Error('manifest.resources must be an array');
    value.resources = value.resources.map((resource, index) => {
      assertObject(resource, `manifest.resources[${index}]`);
      const id = validatePackageId(resource.id, `manifest.resources[${index}].id`);
      if (
        resource.kind !== 'shader-pack' &&
        resource.kind !== 'theme-pack' &&
        resource.kind !== 'profile-pack' &&
        resource.kind !== 'variant-preset' &&
        resource.kind !== 'resource-pack'
      ) {
        throw new Error(`manifest.resources[${index}].kind is invalid`);
      }
      const source = validateEmbeddedSource(resource.source, `manifest.resources[${index}].source`);
      return {
        id,
        kind: resource.kind,
        ...(typeof resource.versionRange === 'string' ? { versionRange: resource.versionRange } : {}),
        ...(typeof resource.required === 'boolean' ? { required: resource.required } : {}),
        ...(source ? { source } : {}),
      };
    });
  }

  if (typeof value.profile !== 'undefined') {
    assertObject(value.profile, 'manifest.profile');
    value.profile.path = normalizeProfilePath(value.profile.path, 'manifest.profile.path');
    if (typeof value.profile.apply !== 'undefined') {
      assertObject(value.profile.apply, 'manifest.profile.apply');
      if (
        typeof value.profile.apply.theme !== 'undefined' &&
        typeof value.profile.apply.theme !== 'boolean'
      ) {
        throw new Error('manifest.profile.apply.theme must be a boolean');
      }
      if (
        typeof value.profile.apply.magnets !== 'undefined' &&
        typeof value.profile.apply.magnets !== 'boolean'
      ) {
        throw new Error('manifest.profile.apply.magnets must be a boolean');
      }
      value.profile.apply.spaces = validateSpaceApplyMode(
        value.profile.apply.spaces,
        'manifest.profile.apply.spaces'
      );
    }
  }
}

function validateProfileEntry(value: unknown): ProfilePackProfileV1 {
  assertObject(value, 'profile');
  if (value.formatVersion !== '1.0') {
    throw new Error('profile.formatVersion must be "1.0"');
  }
  return value as ProfilePackProfileV1;
}

function findThemeEntry(files: PackZipFiles, profilePath: string, profile: ProfilePackProfileV1): InstallPlanThemeSource | null {
  const sourcePath = profile.theme?.source?.path;
  const normalizedSourcePath = typeof sourcePath === 'string' ? sourcePath.trim() : '';
  if (!normalizedSourcePath) return null;

  const candidates = [
    normalizePackPath(normalizedSourcePath),
    joinPackPath(getPackPathParent(profilePath), normalizedSourcePath),
  ];

  for (const candidate of [...new Set(candidates)]) {
    const bytes = findPackEntry(files, candidate);
    if (bytes) {
      return {
        path: candidate,
        text: strFromU8(bytes),
      };
    }
  }

  throw new ExperiencePackParseError('ENTRY_MISSING', `Theme entry is missing from experience pack: ${normalizedSourcePath}`);
}

function buildPlanDiagnostics(manifest: PmpExperiencePackManifestV1): PmpInstallPlanDiagnosticV1[] {
  const diagnostics: PmpInstallPlanDiagnosticV1[] = [];
  if (!manifest.signature) {
    diagnostics.push({
      severity: 'warning',
      code: 'experience-pack.signature.unsigned',
      message: 'Signature verification is not implemented; this local experience pack will be imported as unsigned.',
    });
  }
  for (const dependency of manifest.dependencies ?? []) {
    diagnostics.push({
      severity: 'warning',
      code: 'experience-pack.dependencies.declaration-only',
      message: `Dependency "${dependency.id}" is declared but local import does not auto-install dependencies.`,
      details: dependency,
    });
  }
  for (const plugin of manifest.plugins ?? []) {
    if (!plugin.source) {
      diagnostics.push({
        severity: plugin.required === false ? 'info' : 'warning',
        code: 'experience-pack.plugin.declaration-only',
        message: `Plugin dependency "${plugin.id}" has no embedded source and will not be auto-installed.`,
        details: plugin,
      });
    }
  }
  return diagnostics;
}

function createReviewItems(
  manifest: PmpExperiencePackManifestV1,
  extensionPacks: ParsedExtensionPack[]
): PmpInstallPlanReviewItemV1[] {
  const reviewItems: PmpInstallPlanReviewItemV1[] = [
    {
      id: 'signature:unsigned',
      kind: 'signature',
      required: false,
      title: 'Unsigned experience pack',
      message: 'Signature verification is not implemented for local experience packs yet.',
    },
  ];

  for (const dependency of manifest.dependencies ?? []) {
    reviewItems.push({
      id: `dependency:${dependency.id}`,
      kind: 'dependency',
      required: !(dependency.optional ?? false),
      title: dependency.id,
      message: 'Declared dependency; local import does not auto-install dependencies.',
      details: dependency,
    });
  }

  for (const parsed of extensionPacks) {
    for (const capability of [
      ...(parsed.extensionManifest.requiresCapabilities ?? []),
      ...(parsed.extensionManifest.optionalCapabilities ?? []),
    ]) {
      reviewItems.push({
        id: `capability:${parsed.extensionManifest.identity.id}:${capability.capabilityId}`,
        kind: 'capability',
        required: parsed.extensionManifest.requiresCapabilities?.some(
          (item) => item.capabilityId === capability.capabilityId
        ),
        title: capability.capabilityId,
        details: capability,
      });
    }
    if (parsed.extensionManifest.runtimes.some((runtime) => runtime.kind === 'sidecar')) {
      reviewItems.push({
        id: `native-sidecar:${parsed.extensionManifest.identity.id}`,
        kind: 'native-sidecar',
        required: true,
        title: parsed.extensionManifest.identity.id,
        message: 'This extension includes a native sidecar runtime.',
      });
    }
  }

  return reviewItems;
}

function createInstallPlan(options: {
  manifest: PmpExperiencePackManifestV1;
  extensionPacksByStepId: Record<string, ParsedExtensionPack>;
  resourceSourcesByStepId: Record<string, InstallPlanEmbeddedResourceSource>;
  profileSource: InstallPlanProfileSource | null;
  themeSource: InstallPlanThemeSource | null;
}): PmpInstallPlanV1 {
  const diagnostics = buildPlanDiagnostics(options.manifest);
  const steps: PmpInstallPlanStepV1[] = [];
  const verifyStepId = 'verify-integrity';
  steps.push({
    id: verifyStepId,
    kind: 'verify-integrity',
    required: true,
    source: {
      kind: 'memory',
      label: `${options.manifest.metadata.name}.pmpex`,
    },
    checksumsPath: 'checksums.json',
    ...(options.manifest.signature ? { signaturePath: options.manifest.signature.path } : {}),
  });

  const installStepIds: string[] = [];
  for (const [stepId, parsed] of Object.entries(options.extensionPacksByStepId).sort(([left], [right]) =>
    comparePathStrings(left, right)
  )) {
    steps.push({
      id: stepId,
      kind: 'install-extension',
      required: true,
      dependsOn: [verifyStepId],
      pluginId: parsed.extensionManifest.identity.id,
      versionRange: parsed.extensionManifest.identity.version,
      manifestPath: parsed.entryManifestPath,
      source: {
        kind: 'embedded',
        path: parsed.manifest.metadata.id,
      },
      hostTargets: parsed.extensionManifest.hostTargets,
      capabilities: [
        ...(parsed.extensionManifest.requiresCapabilities ?? []),
        ...(parsed.extensionManifest.optionalCapabilities ?? []),
      ],
    });
    installStepIds.push(stepId);
  }

  for (const source of Object.values(options.resourceSourcesByStepId).sort((left, right) =>
    comparePathStrings(left.stepId, right.stepId)
  )) {
    const resource = (options.manifest.resources ?? []).find((item) => item.id === source.resourceId);
    steps.push({
      id: source.stepId,
      kind: 'install-resource',
      required: resource?.required ?? true,
      dependsOn: [verifyStepId],
      resourceId: source.resourceId,
      resourceType: source.resourceType as PmpExperiencePackResourceDependencyV1['kind'],
      versionRange: resource?.versionRange,
      source: {
        kind: 'embedded',
        path: source.sourcePath,
      },
    });
  }

  const refreshStepId = 'refresh-plugin-registries';
  if (installStepIds.length > 0) {
    steps.push({
      id: refreshStepId,
      kind: 'refresh-plugin-registries',
      required: true,
      dependsOn: installStepIds,
    });
  }

  let lastMutatingDependency = installStepIds.length > 0 ? refreshStepId : verifyStepId;
  const profile = options.manifest.profile;
  if (profile && options.themeSource && profile.apply?.theme !== false) {
    const applyThemeStepId = 'apply-theme';
    steps.push({
      id: applyThemeStepId,
      kind: 'apply-theme',
      required: true,
      dependsOn: [lastMutatingDependency],
      source: {
        kind: 'embedded',
        path: options.themeSource.path,
      },
      themePath: options.themeSource.path,
    });
    lastMutatingDependency = applyThemeStepId;
  }

  if (profile && options.profileSource && profile.apply?.magnets !== false) {
    const applyProfileStepId = 'apply-profile';
    steps.push({
      id: applyProfileStepId,
      kind: 'apply-profile',
      required: true,
      dependsOn: [lastMutatingDependency],
      source: {
        kind: 'embedded',
        path: options.profileSource.path,
      },
      profilePath: options.profileSource.path,
      applyTheme: false,
      applyMagnets: true,
    });
    lastMutatingDependency = applyProfileStepId;
  }

  if (profile?.apply?.spaces && options.profileSource) {
    steps.push({
      id: 'apply-space-layout',
      kind: 'apply-space-layout',
      required: true,
      dependsOn: [lastMutatingDependency],
      source: {
        kind: 'embedded',
        path: options.profileSource.path,
      },
      profilePath: options.profileSource.path,
      mode: profile.apply.spaces,
    });
    lastMutatingDependency = 'apply-space-layout';
  }

  if (diagnostics.length > 0) {
    steps.push({
      id: 'report',
      kind: 'report',
      required: false,
      dependsOn: [lastMutatingDependency],
      diagnostics,
    });
  }

  const extensionPacks = Object.values(options.extensionPacksByStepId);
  const resourceCount = Object.keys(options.resourceSourcesByStepId).length;
  return {
    formatVersion: '1.0',
    id: `experience-pack:${options.manifest.metadata.id}:${options.manifest.metadata.version}`,
    status: 'ready',
    source: {
      packageType: 'experience-pack',
      source: {
        kind: 'memory',
        label: `${options.manifest.metadata.name}.pmpex`,
      },
      metadata: options.manifest.metadata,
    },
    summary: {
      title: options.manifest.metadata.name,
      description: options.manifest.metadata.description,
      packageType: 'experience-pack',
      extensionCount: extensionPacks.length,
      resourceCount,
      appliesTheme: Boolean(options.themeSource && options.manifest.profile?.apply?.theme !== false),
      appliesProfile: Boolean(options.profileSource && options.manifest.profile?.apply?.magnets !== false),
      appliesSpaces: Boolean(options.manifest.profile?.apply?.spaces),
      hasNativeSidecar: extensionPacks.some((parsed) =>
        parsed.extensionManifest.runtimes.some((runtime) => runtime.kind === 'sidecar')
      ),
      destructive: Boolean(options.profileSource),
    },
    steps,
    dependencies: [
      ...(options.manifest.dependencies ?? []),
      ...extensionPacks.flatMap((parsed) => parsed.extensionManifest.dependencies ?? []),
    ],
    reviewItems: createReviewItems(options.manifest, extensionPacks),
    diagnostics,
  };
}

async function collectEmbeddedExtensionPacks(
  files: PackZipFiles,
  manifest: PmpExperiencePackManifestV1
): Promise<Record<string, ParsedExtensionPack>> {
  const result: Record<string, ParsedExtensionPack> = {};
  for (const plugin of manifest.plugins ?? []) {
    if (!plugin.source || plugin.source.kind !== 'embedded') continue;
    const bytes = findPackEntry(files, plugin.source.path);
    if (!bytes) {
      throw new ExperiencePackParseError('ENTRY_MISSING', `Embedded plugin package is missing: ${plugin.source.path}`);
    }
    if (!plugin.source.path.toLowerCase().endsWith('.pmpe')) {
      throw new ExperiencePackParseError(
        'ENTRY_INVALID',
        `Embedded plugin source must be a .pmpe file: ${plugin.source.path}`
      );
    }
    const parsed = await parseExtensionPackFromZipBytes(bytes);
    if (parsed.extensionManifest.identity.id !== plugin.id) {
      throw new ExperiencePackParseError(
        'ENTRY_INVALID',
        `Embedded plugin id mismatch: ${plugin.id} != ${parsed.extensionManifest.identity.id}`
      );
    }
    result[`install-extension:${parsed.extensionManifest.identity.id}`] = parsed;
  }
  return result;
}

function collectEmbeddedResources(
  files: PackZipFiles,
  manifest: PmpExperiencePackManifestV1
): Record<string, InstallPlanEmbeddedResourceSource> {
  const result: Record<string, InstallPlanEmbeddedResourceSource> = {};
  for (const resource of manifest.resources ?? []) {
    if (!resource.source || resource.source.kind !== 'embedded') continue;
    const bytes = findPackEntry(files, resource.source.path);
    if (!bytes) {
      throw new ExperiencePackParseError('ENTRY_MISSING', `Embedded resource package is missing: ${resource.source.path}`);
    }
    const stepId = `install-resource:${resource.kind}:${resource.id}`;
    result[stepId] = {
      stepId,
      resourceId: resource.id,
      resourceType: resource.kind,
      sourcePath: resource.source.path,
      bytes,
    };
  }
  return result;
}

function collectProfileSource(
  files: PackZipFiles,
  manifest: PmpExperiencePackManifestV1
): { profileSource: InstallPlanProfileSource | null; themeSource: InstallPlanThemeSource | null } {
  const profileEntry = manifest.profile;
  if (!profileEntry) return { profileSource: null, themeSource: null };

  const profileBytes = findPackEntry(files, profileEntry.path);
  if (!profileBytes) {
    throw new ExperiencePackParseError('ENTRY_MISSING', `Profile entry is missing: ${profileEntry.path}`);
  }

  try {
    const text = strFromU8(profileBytes);
    const profile = validateProfileEntry(JSON.parse(text) as unknown);
    return {
      profileSource: {
        path: profileEntry.path,
        text,
        profile,
      },
      themeSource: findThemeEntry(files, profileEntry.path, profile),
    };
  } catch (error) {
    if (error instanceof ExperiencePackParseError) throw error;
    throw new ExperiencePackParseError(
      'ENTRY_INVALID',
      error instanceof Error ? error.message : String(error)
    );
  }
}

export async function parseExperiencePackFromZipBytes(bytes: Uint8Array): Promise<ParsedExperiencePack> {
  let files: PackZipFiles;
  try {
    files = await unzipPackAsync(bytes);
    assertUniquePackEntryPaths(
      files,
      (message) => new ExperiencePackParseError('INVALID_ZIP', message)
    );
  } catch (error) {
    if (error instanceof ExperiencePackParseError) throw error;
    throw new ExperiencePackParseError(
      'INVALID_ZIP',
      error instanceof Error ? error.message : String(error)
    );
  }

  const manifestBytes = findPackEntry(files, 'manifest.json');
  if (!manifestBytes) {
    throw new ExperiencePackParseError('MANIFEST_MISSING', 'Invalid experience pack: missing manifest.json');
  }

  let manifestUnknown: unknown;
  try {
    manifestUnknown = JSON.parse(strFromU8(manifestBytes)) as unknown;
    validateExperiencePackManifestV1(manifestUnknown);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ExperiencePackParseError('MANIFEST_INVALID', message);
  }
  const manifest = manifestUnknown;

  const checksumsBytes = findPackEntry(files, 'checksums.json');
  if (!checksumsBytes) {
    throw new ExperiencePackParseError('CHECKSUMS_MISSING', 'Invalid experience pack: missing checksums.json');
  }

  let checksums: PmpChecksumsV1;
  try {
    checksums = validateChecksumsObject(JSON.parse(strFromU8(checksumsBytes)) as unknown);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ExperiencePackParseError('CHECKSUMS_INVALID', message);
  }

  await verifyPackChecksums(files, checksums, ['manifest.json'], {
    createError: (code, message) => new ExperiencePackParseError(code, message),
  });

  const extensionPacksByStepId = await collectEmbeddedExtensionPacks(files, manifest);
  const resourceSourcesByStepId = collectEmbeddedResources(files, manifest);
  const { profileSource, themeSource } = collectProfileSource(files, manifest);
  const plan = createInstallPlan({
    manifest,
    extensionPacksByStepId,
    resourceSourcesByStepId,
    profileSource,
    themeSource,
  });

  return {
    manifest,
    checksums,
    plan,
    executorPreview: {
      mode: 'preview',
      manifest,
      plan,
      extensionPacksByStepId,
      resourceSourcesByStepId,
      themeSourcesByPath: themeSource ? { [themeSource.path]: themeSource } : {},
      profileSourcesByPath: profileSource ? { [profileSource.path]: profileSource } : {},
      summary: {
        extensionCount: Object.keys(extensionPacksByStepId).length,
        resourceCount: Object.keys(resourceSourcesByStepId).length,
        appliesTheme: Boolean(themeSource && manifest.profile?.apply?.theme !== false),
        appliesProfile: Boolean(profileSource && manifest.profile?.apply?.magnets !== false),
        appliesSpaces: Boolean(manifest.profile?.apply?.spaces),
        unsigned: !manifest.signature,
      },
    },
  };
}
