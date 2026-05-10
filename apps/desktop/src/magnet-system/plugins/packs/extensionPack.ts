import { strFromU8, unzip } from 'fflate';
import type {
  PluginReadInstallSourcePayload,
  PmpChecksumsV1,
  PmpExtensionPackManifestV1,
  PmpInstallPlanDiagnosticV1,
  PmpInstallPlanV1,
  PxpManifestV2,
} from '@pixel-matrix/plugin-platform-contracts';
import { validateInstalledExtensionManifest } from '../extensions';

export type ExtensionPackParseErrorCode =
  | 'INVALID_ZIP'
  | 'MANIFEST_MISSING'
  | 'MANIFEST_INVALID'
  | 'CHECKSUMS_MISSING'
  | 'CHECKSUMS_INVALID'
  | 'CHECKSUM_MISMATCH'
  | 'ENTRY_MISSING'
  | 'ENTRY_INVALID'
  | 'RUNTIME_ENTRY_MISSING';

export class ExtensionPackParseError extends Error {
  readonly code: ExtensionPackParseErrorCode;

  constructor(code: ExtensionPackParseErrorCode, message: string) {
    super(message);
    this.name = 'ExtensionPackParseError';
    this.code = code;
  }
}

export interface ParsedExtensionPack {
  manifest: PmpExtensionPackManifestV1;
  extensionManifest: PxpManifestV2;
  entryManifestPath: string;
  extensionRootPath: string;
  checksums: PmpChecksumsV1;
  plan: PmpInstallPlanV1;
  executorPreview: ExtensionPackExecutorPreview;
}

export type ExtensionPackExecutorPreviewMode = 'preview';

export interface ExtensionPackEmbeddedInstallSourcePreview
  extends PluginReadInstallSourcePayload<PxpManifestV2> {
  kind: 'embedded-manifest-v2-source';
  sourcePackageType: 'extension-pack';
  sourceRootPath: string;
}

export interface ExtensionPackExecutorPreview {
  mode: ExtensionPackExecutorPreviewMode;
  plan: PmpInstallPlanV1;
  installSource: ExtensionPackEmbeddedInstallSourcePreview;
  summary: {
    pluginId: string;
    version: string;
    fileCount: number;
    totalBytes: number;
    runtimeEntryRelativePaths: string[];
  };
  nextAction: {
    kind: 'materialize-embedded-source-and-install-manifest-v2';
    installStepId: string;
    manifestRelativePath: string;
  };
}

type ZipFiles = Record<string, Uint8Array>;

const textEncoder = new TextEncoder();

function compareZipPathStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function unzipAsync(bytes: Uint8Array): Promise<ZipFiles> {
  return await new Promise((resolve, reject) => {
    unzip(bytes, (err, data) => {
      if (err) {
        reject(new ExtensionPackParseError('INVALID_ZIP', `Invalid extension pack zip: ${err.message}`));
        return;
      }
      resolve(data);
    });
  });
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
}

function normalizeZipPath(path: string): string {
  const normalized = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/');

  if (!normalized) {
    throw new Error('path is required');
  }
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    throw new Error(`path must be relative: ${path}`);
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`path contains invalid segments: ${path}`);
  }
  return normalized;
}

function findZipEntry(files: ZipFiles, path: string): Uint8Array | undefined {
  const target = normalizeZipPath(path).toLowerCase();
  for (const [key, value] of Object.entries(files)) {
    if (normalizeZipPath(key).toLowerCase() === target) return value;
  }
  return undefined;
}

function assertUniqueZipEntryPaths(files: ZipFiles): void {
  const seen = new Map<string, string>();
  for (const rawPath of Object.keys(files)) {
    let normalized: string;
    try {
      normalized = normalizeZipPath(rawPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ExtensionPackParseError('INVALID_ZIP', `Invalid zip entry path "${rawPath}": ${message}`);
    }

    const lookupPath = normalized.toLowerCase();
    const existingPath = seen.get(lookupPath);
    if (existingPath) {
      throw new ExtensionPackParseError(
        'INVALID_ZIP',
        `Duplicate zip entry path after normalization: ${existingPath} and ${rawPath}`
      );
    }
    seen.set(lookupPath, rawPath);
  }
}

function getZipPathParent(path: string): string {
  const normalized = normalizeZipPath(path);
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex > 0 ? normalized.slice(0, slashIndex) : '';
}

function joinZipPath(root: string, path: string): string {
  const normalizedRoot = root ? normalizeZipPath(root) : '';
  const normalizedPath = normalizeZipPath(path);
  return normalizedRoot ? normalizeZipPath(`${normalizedRoot}/${normalizedPath}`) : normalizedPath;
}

function normalizeChecksumPath(path: string): string {
  return normalizeZipPath(path).toLowerCase();
}

function resolveChecksumKey(files: Record<string, string>, path: string): string | null {
  const target = normalizeChecksumPath(path);
  for (const key of Object.keys(files)) {
    if (normalizeChecksumPath(key) === target) return key;
  }
  return null;
}

function validateSha256(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value.trim())) {
    throw new Error(`${path} must be a sha256 hex digest`);
  }
  return value.trim().toLowerCase();
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

export function validateExtensionPackManifestV1(
  value: unknown
): asserts value is PmpExtensionPackManifestV1 {
  assertObject(value, 'manifest');
  if (value.formatVersion !== '1.0') {
    throw new Error('manifest.formatVersion must be "1.0"');
  }
  if (value.type !== 'extension-pack') {
    throw new Error('manifest.type must be "extension-pack"');
  }

  assertObject(value.metadata, 'manifest.metadata');
  validatePackageId(value.metadata.id, 'manifest.metadata.id');
  validateNonEmptyString(value.metadata.name, 'manifest.metadata.name');
  validateNonEmptyString(value.metadata.version, 'manifest.metadata.version');

  assertObject(value.entry, 'manifest.entry');
  const entryManifest = normalizeZipPath(validateNonEmptyString(value.entry.manifest, 'manifest.entry.manifest'));
  if (!entryManifest.endsWith('/manifest.v2.json') && entryManifest !== 'manifest.v2.json') {
    throw new Error('manifest.entry.manifest must point to manifest.v2.json');
  }
  value.entry.manifest = entryManifest;
}

function validateChecksums(value: unknown): PmpChecksumsV1 {
  assertObject(value, 'checksums');
  if (value.formatVersion !== '1.0') {
    throw new Error('checksums.formatVersion must be "1.0"');
  }
  if (value.algorithm !== 'sha256') {
    throw new Error('checksums.algorithm must be "sha256"');
  }
  assertObject(value.files, 'checksums.files');

  const files: Record<string, string> = {};
  const seenPaths = new Map<string, string>();
  for (const [path, digest] of Object.entries(value.files)) {
    const normalizedPath = normalizeZipPath(path);
    const lookupPath = normalizedPath.toLowerCase();
    const existingPath = seenPaths.get(lookupPath);
    if (existingPath) {
      throw new Error(`checksums.files contains duplicate path entries: ${existingPath} and ${path}`);
    }
    seenPaths.set(lookupPath, path);
    files[normalizedPath] = validateSha256(digest, `checksums.files["${path}"]`);
  }

  return {
    formatVersion: '1.0',
    algorithm: 'sha256',
    files,
  };
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle?.digest) {
    throw new Error('crypto.subtle.digest is not available');
  }

  const digest = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyChecksums(files: ZipFiles, checksums: PmpChecksumsV1, requiredPaths: string[]): Promise<void> {
  for (const path of requiredPaths) {
    const key = resolveChecksumKey(checksums.files, path);
    if (!key) {
      throw new ExtensionPackParseError(
        'CHECKSUMS_INVALID',
        `checksums.json missing required file entry: ${normalizeZipPath(path)}`
      );
    }
  }

  for (const path of Object.keys(files)) {
    if (normalizeChecksumPath(path) === 'checksums.json') continue;
    const key = resolveChecksumKey(checksums.files, path);
    if (!key) {
      throw new ExtensionPackParseError(
        'CHECKSUMS_INVALID',
        `checksums.json missing zip file entry: ${normalizeZipPath(path)}`
      );
    }
  }

  for (const [path, expected] of Object.entries(checksums.files)) {
    const bytes = findZipEntry(files, path);
    if (!bytes) {
      throw new ExtensionPackParseError(
        'CHECKSUMS_INVALID',
        `checksums.json references missing file: ${normalizeZipPath(path)}`
      );
    }
    const computed = await sha256Hex(bytes);
    if (computed !== expected) {
      throw new ExtensionPackParseError(
        'CHECKSUM_MISMATCH',
        `Integrity check failed (sha256 mismatch): ${normalizeZipPath(path)}`
      );
    }
  }
}

function collectRuntimeEntryPaths(extensionRootPath: string, manifest: PxpManifestV2): string[] {
  return manifest.runtimes.map((runtime) => joinZipPath(extensionRootPath, runtime.entry));
}

function collectRuntimeEntryRelativePaths(manifest: PxpManifestV2): string[] {
  return manifest.runtimes.map((runtime) => normalizeZipPath(runtime.entry));
}

function collectExtensionSourceFiles(
  files: ZipFiles,
  extensionRootPath: string,
  checksums: PmpChecksumsV1
): Array<{ zipPath: string; relativePath: string; bytes: Uint8Array; sha256?: string }> {
  const normalizedRoot = extensionRootPath ? normalizeZipPath(extensionRootPath) : '';
  const sourceFiles: Array<{ zipPath: string; relativePath: string; bytes: Uint8Array; sha256?: string }> = [];

  for (const [rawZipPath, bytes] of Object.entries(files)) {
    const zipPath = normalizeZipPath(rawZipPath);
    if (zipPath === 'manifest.json' || zipPath === 'checksums.json') continue;

    const relativePath = normalizedRoot
      ? zipPath.startsWith(`${normalizedRoot}/`)
        ? zipPath.slice(normalizedRoot.length + 1)
        : ''
      : zipPath;
    if (!relativePath) continue;

    const checksumKey = resolveChecksumKey(checksums.files, zipPath);
    sourceFiles.push({
      zipPath,
      relativePath: normalizeZipPath(relativePath),
      bytes,
      sha256: checksumKey ? checksums.files[checksumKey] : undefined,
    });
  }

  return sourceFiles.sort((left, right) =>
    compareZipPathStrings(left.relativePath, right.relativePath)
  );
}

function collectIgnoredNonExtensionZipPaths(files: ZipFiles, extensionRootPath: string): string[] {
  const normalizedRoot = extensionRootPath ? normalizeZipPath(extensionRootPath) : '';
  if (!normalizedRoot) return [];

  const ignoredPaths: string[] = [];
  for (const rawZipPath of Object.keys(files)) {
    const zipPath = normalizeZipPath(rawZipPath);
    if (zipPath === 'manifest.json' || zipPath === 'checksums.json') continue;
    if (!zipPath.startsWith(`${normalizedRoot}/`)) {
      ignoredPaths.push(zipPath);
    }
  }

  return ignoredPaths.sort(compareZipPathStrings);
}

function buildInstallPlanDiagnostics(options: {
  files: ZipFiles;
  extensionRootPath: string;
  installStepId: string;
}): PmpInstallPlanDiagnosticV1[] {
  const diagnostics: PmpInstallPlanDiagnosticV1[] = [];
  const ignoredZipPaths = collectIgnoredNonExtensionZipPaths(
    options.files,
    options.extensionRootPath
  );

  if (ignoredZipPaths.length > 0) {
    diagnostics.push({
      severity: 'info',
      code: 'extension-pack.ignored-non-extension-files',
      message: `${ignoredZipPaths.length} checksum-verified file(s) are outside the extension root and will not be installed.`,
      targetStepId: options.installStepId,
      details: {
        count: ignoredZipPaths.length,
        paths: ignoredZipPaths,
      },
    });
  }

  const rootDepth = options.extensionRootPath
    ? normalizeZipPath(options.extensionRootPath).split('/').length
    : 0;
  if (rootDepth > 1) {
    diagnostics.push({
      severity: 'warning',
      code: 'extension-pack.deep-entry-root',
      message: `Extension entry manifest is nested under "${options.extensionRootPath}". The pack remains valid, but the recommended layout is extension/manifest.v2.json.`,
      targetStepId: options.installStepId,
      details: {
        extensionRootPath: options.extensionRootPath,
      },
    });
  }

  return diagnostics;
}

async function computeTreeDigest(
  files: Array<{ relativePath: string; bytes: Uint8Array }>
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for (const file of [...files].sort((left, right) =>
    compareZipPathStrings(left.relativePath, right.relativePath)
  )) {
    const header = textEncoder.encode(`${file.relativePath}\u0000`);
    const footer = new Uint8Array([0]);
    chunks.push(header, file.bytes, footer);
    totalLength += header.byteLength + file.bytes.byteLength + footer.byteLength;
  }

  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return await sha256Hex(merged);
}

function buildInstallPlan(options: {
  manifest: PmpExtensionPackManifestV1;
  extensionManifest: PxpManifestV2;
  entryManifestPath: string;
  extensionRootPath: string;
  checksums: PmpChecksumsV1;
  files: ZipFiles;
}): PmpInstallPlanV1 {
  const pluginId = options.extensionManifest.identity.id;
  const version = options.extensionManifest.identity.version;
  const verifyStepId = 'verify-integrity';
  const installStepId = `install-extension:${pluginId}`;
  const refreshStepId = 'refresh-plugin-registries';
  const diagnostics = buildInstallPlanDiagnostics({
    files: options.files,
    extensionRootPath: options.extensionRootPath,
    installStepId,
  });

  return {
    formatVersion: '1.0',
    id: `extension-pack:${pluginId}:${version}`,
    status: 'ready',
    source: {
      packageType: 'extension-pack',
      source: {
        kind: 'memory',
        label: `${options.manifest.metadata.name}.pmpe`,
      },
      metadata: options.manifest.metadata,
      integrity: options.manifest.integrity,
    },
    summary: {
      title: options.manifest.metadata.name,
      description: options.manifest.metadata.description,
      packageType: 'extension-pack',
      extensionCount: 1,
      requiresNetwork: Boolean(options.extensionManifest.trustHints?.requiresNetwork),
      hasNativeSidecar: options.extensionManifest.runtimes.some((runtime) => runtime.kind === 'sidecar'),
      destructive: false,
    },
    steps: [
      {
        id: verifyStepId,
        kind: 'verify-integrity',
        required: true,
        source: {
          kind: 'memory',
          label: `${options.manifest.metadata.name}.pmpe`,
        },
        checksumsPath: 'checksums.json',
      },
      {
        id: installStepId,
        kind: 'install-extension',
        required: true,
        dependsOn: [verifyStepId],
        pluginId,
        versionRange: version,
        manifestPath: options.entryManifestPath,
        source: {
          kind: 'embedded',
          path: options.extensionRootPath || '.',
        },
        hostTargets: options.extensionManifest.hostTargets,
        capabilities: [
          ...(options.extensionManifest.requiresCapabilities ?? []),
          ...(options.extensionManifest.optionalCapabilities ?? []),
        ],
      },
      {
        id: refreshStepId,
        kind: 'refresh-plugin-registries',
        required: true,
        dependsOn: [installStepId],
      },
    ],
    dependencies: options.extensionManifest.dependencies,
    reviewItems: [
      {
        id: 'signature:unsigned',
        kind: 'signature',
        required: false,
        title: 'Unsigned extension pack',
        message: 'Signature verification is not implemented for extension packs yet.',
      },
    ],
    diagnostics,
  };
}

async function buildExecutorPreview(options: {
  files: ZipFiles;
  plan: PmpInstallPlanV1;
  extensionManifest: PxpManifestV2;
  entryManifestPath: string;
  extensionRootPath: string;
  checksums: PmpChecksumsV1;
}): Promise<ExtensionPackExecutorPreview> {
  const sourceFiles = collectExtensionSourceFiles(
    options.files,
    options.extensionRootPath,
    options.checksums
  );
  const manifestRelativePath = options.extensionRootPath
    ? normalizeZipPath(options.entryManifestPath).slice(normalizeZipPath(options.extensionRootPath).length + 1)
    : normalizeZipPath(options.entryManifestPath);
  const manifestFile = sourceFiles.find((file) => file.relativePath === manifestRelativePath);
  if (!manifestFile) {
    throw new ExtensionPackParseError(
      'ENTRY_MISSING',
      `Extension manifest is missing from embedded install source: ${manifestRelativePath}`
    );
  }

  const installStep = options.plan.steps.find((step) => step.kind === 'install-extension');
  if (!installStep) {
    throw new ExtensionPackParseError('MANIFEST_INVALID', 'Install plan is missing install-extension step');
  }

  const totalBytes = sourceFiles.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  const packageDigest = await computeTreeDigest(sourceFiles);
  const rootDir = options.extensionRootPath || '.';
  const manifestPath = options.entryManifestPath;
  const runtimeEntryRelativePaths = collectRuntimeEntryRelativePaths(options.extensionManifest);

  return {
    mode: 'preview',
    plan: options.plan,
    installSource: {
      kind: 'embedded-manifest-v2-source',
      sourcePackageType: 'extension-pack',
      sourceRootPath: options.extensionRootPath || '.',
      manifestPath,
      rootDir,
      manifestRaw: strFromU8(manifestFile.bytes),
      validatedManifest: options.extensionManifest,
      validationDiagnostics: [],
      packageDigest,
      files: sourceFiles.map((file) => ({
        relativePath: file.relativePath,
        bytes: Array.from(file.bytes),
        sha256: file.sha256,
      })),
    },
    summary: {
      pluginId: options.extensionManifest.identity.id,
      version: options.extensionManifest.identity.version,
      fileCount: sourceFiles.length,
      totalBytes,
      runtimeEntryRelativePaths,
    },
    nextAction: {
      kind: 'materialize-embedded-source-and-install-manifest-v2',
      installStepId: installStep.id,
      manifestRelativePath,
    },
  };
}

export async function parseExtensionPackFromZipBytes(bytes: Uint8Array): Promise<ParsedExtensionPack> {
  const files = await unzipAsync(bytes);
  assertUniqueZipEntryPaths(files);

  const manifestBytes = findZipEntry(files, 'manifest.json');
  if (!manifestBytes) {
    throw new ExtensionPackParseError('MANIFEST_MISSING', 'Invalid extension pack: missing manifest.json');
  }

  let manifestUnknown: unknown;
  try {
    manifestUnknown = JSON.parse(strFromU8(manifestBytes)) as unknown;
    validateExtensionPackManifestV1(manifestUnknown);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ExtensionPackParseError('MANIFEST_INVALID', message);
  }
  const manifest = manifestUnknown;

  const checksumsBytes = findZipEntry(files, 'checksums.json');
  if (!checksumsBytes) {
    throw new ExtensionPackParseError('CHECKSUMS_MISSING', 'Invalid extension pack: missing checksums.json');
  }

  let checksums: PmpChecksumsV1;
  try {
    checksums = validateChecksums(JSON.parse(strFromU8(checksumsBytes)) as unknown);
  } catch (error) {
    if (error instanceof ExtensionPackParseError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ExtensionPackParseError('CHECKSUMS_INVALID', message);
  }

  const entryManifestPath = manifest.entry.manifest;
  const entryManifestBytes = findZipEntry(files, entryManifestPath);
  if (!entryManifestBytes) {
    throw new ExtensionPackParseError(
      'ENTRY_MISSING',
      `Extension manifest is missing from pack: ${entryManifestPath}`
    );
  }

  let extensionManifest: PxpManifestV2;
  try {
    const parsed = JSON.parse(strFromU8(entryManifestBytes)) as unknown;
    validateInstalledExtensionManifest(parsed);
    extensionManifest = parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ExtensionPackParseError('ENTRY_INVALID', message);
  }

  if (manifest.metadata.id !== extensionManifest.identity.id) {
    throw new ExtensionPackParseError(
      'ENTRY_INVALID',
      `manifest.metadata.id must match extension identity id: ${extensionManifest.identity.id}`
    );
  }
  if (manifest.metadata.version !== extensionManifest.identity.version) {
    throw new ExtensionPackParseError(
      'ENTRY_INVALID',
      `manifest.metadata.version must match extension identity version: ${extensionManifest.identity.version}`
    );
  }

  const extensionRootPath = getZipPathParent(entryManifestPath);
  const runtimeEntryPaths = collectRuntimeEntryPaths(extensionRootPath, extensionManifest);
  for (const runtimeEntryPath of runtimeEntryPaths) {
    if (!findZipEntry(files, runtimeEntryPath)) {
      throw new ExtensionPackParseError(
        'RUNTIME_ENTRY_MISSING',
        `Runtime entry is missing from extension pack: ${runtimeEntryPath}`
      );
    }
  }

  await verifyChecksums(files, checksums, [
    'manifest.json',
    entryManifestPath,
    ...runtimeEntryPaths,
  ]);

  const plan = buildInstallPlan({
    manifest,
    extensionManifest,
    entryManifestPath,
    extensionRootPath,
    checksums,
    files,
  });
  const executorPreview = await buildExecutorPreview({
    files,
    plan,
    extensionManifest,
    entryManifestPath,
    extensionRootPath,
    checksums,
  });

  return {
    manifest,
    extensionManifest,
    entryManifestPath,
    extensionRootPath,
    checksums,
    plan,
    executorPreview,
  };
}
