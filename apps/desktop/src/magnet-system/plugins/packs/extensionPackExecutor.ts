import type {
  PluginReadInstallSourcePayload,
  PmpInstallPlanDiagnosticV1,
  PxpManifestV2,
} from '@pixel-matrix/plugin-platform-contracts';
import { invokeWithTelemetry } from '../../../services/telemetry/tauriInvokeTelemetry';
import { isTauriRuntime } from '../../../utils/tauriRuntime';
import {
  installInstalledExtensionFromFilePath,
  type InstalledHostExtensionRecord,
} from '../extensions';
import type { ExtensionPackExecutorPreview } from './extensionPack';
import {
  areStringArraysEqual,
  comparePathStrings,
  getParentPath,
  normalizeFsPath,
  normalizeRelativePath,
  normalizeSha256,
  splitRelativePath,
} from './packUtils';

export interface ExtensionPackMaterializeOptions {
  materializationId?: string;
}

export interface ExtensionPackCommitOptions extends ExtensionPackMaterializeOptions {
  defaultEnabled?: boolean;
  dryRun?: ExtensionPackExecutorDryRunResult;
}

export interface ExtensionPackMaterializedSource {
  baseDirectory: 'AppCache';
  rootRelativePath: string;
  rootDir: string;
  manifestPath: string;
  manifestRelativePath: string;
  fileCount: number;
  totalBytes: number;
}

export interface ExtensionPackExecutorDryRunCheckResult {
  packageDigestMatches: boolean;
  manifestIdentityMatches: boolean;
  fileListMatches: boolean;
  nativeValidationPassed: boolean;
}

export interface ExtensionPackExecutorDryRunResult {
  mode: 'dry-run';
  status: 'ready' | 'blocked';
  materializedSource: ExtensionPackMaterializedSource;
  nativeInstallSource: PluginReadInstallSourcePayload<PxpManifestV2>;
  checks: ExtensionPackExecutorDryRunCheckResult;
  diagnostics: PmpInstallPlanDiagnosticV1[];
}

export interface ExtensionPackExecutorCommitResult {
  mode: 'commit';
  status: 'installed' | 'blocked';
  dryRun: ExtensionPackExecutorDryRunResult;
  installedExtension?: InstalledHostExtensionRecord;
  diagnostics: PmpInstallPlanDiagnosticV1[];
  completedStepIds: string[];
}

function normalizeMaterializationId(id: string): string {
  const normalized = id.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized) {
    throw new Error('materialization id is required');
  }
  return normalized.slice(0, 160);
}

function createDefaultMaterializationId(preview: ExtensionPackExecutorPreview): string {
  const digestPrefix = preview.installSource.packageDigest?.slice(0, 12) ?? 'no-digest';
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return normalizeMaterializationId(
    `${preview.summary.pluginId}-${preview.summary.version}-${digestPrefix}-${timePart}-${randomPart}`
  );
}

function collectRelativeFilePaths(files: PluginReadInstallSourcePayload['files']): string[] {
  return files.map((file) => normalizeRelativePath(file.relativePath)).sort(comparePathStrings);
}

function findVerifyStepId(preview: ExtensionPackExecutorPreview): string | null {
  return preview.plan.steps.find((step) => step.kind === 'verify-integrity')?.id ?? null;
}

function findRefreshStepId(preview: ExtensionPackExecutorPreview): string | null {
  return preview.plan.steps.find((step) => step.kind === 'refresh-plugin-registries')?.id ?? null;
}

async function readMaterializedInstallSourceFromNative(
  rootDir: string
): Promise<PluginReadInstallSourcePayload<PxpManifestV2>> {
  return await invokeWithTelemetry<PluginReadInstallSourcePayload<PxpManifestV2>>(
    'plugin_read_install_source',
    {
      filePath: rootDir,
    },
    {
      moduleId: 'extension-pack',
      component: 'executorDryRun',
      event: 'plugin.extension_pack.install_source.read',
    }
  );
}

async function cleanupMaterializedSource(
  materializedSource: ExtensionPackMaterializedSource
): Promise<void> {
  if (!isTauriRuntime()) return;

  try {
    const fs = await import('@tauri-apps/api/fs');
    await fs.removeDir(materializedSource.rootRelativePath, {
      dir: fs.BaseDirectory.AppCache,
      recursive: true,
    });
  } catch {
    // best-effort cleanup
  }
}

function validateNativeInstallSourceForPreview(options: {
  preview: ExtensionPackExecutorPreview;
  materializedSource: ExtensionPackMaterializedSource;
  nativeInstallSource: PluginReadInstallSourcePayload<PxpManifestV2>;
}): {
  checks: ExtensionPackExecutorDryRunCheckResult;
  diagnostics: PmpInstallPlanDiagnosticV1[];
  status: 'ready' | 'blocked';
} {
  const { preview, materializedSource, nativeInstallSource } = options;
  const previewManifest = preview.installSource.validatedManifest;
  if (!previewManifest) {
    throw new Error('Extension pack executor preview is missing a validated manifest');
  }

  const diagnostics: PmpInstallPlanDiagnosticV1[] = [];
  const expectedDigest = normalizeSha256(preview.installSource.packageDigest);
  const actualDigest = normalizeSha256(nativeInstallSource.packageDigest);
  const packageDigestMatches =
    typeof expectedDigest === 'string' &&
    typeof actualDigest === 'string' &&
    expectedDigest === actualDigest;

  if (!packageDigestMatches) {
    diagnostics.push({
      severity: 'error',
      code: 'extension-pack.executor.digest-mismatch',
      message: 'Materialized extension source packageDigest does not match the parser preview.',
      targetStepId: preview.nextAction.installStepId,
      details: {
        expectedDigest,
        actualDigest,
      },
    });
  }

  const nativeManifest = nativeInstallSource.validatedManifest ?? null;
  const manifestIdentityMatches =
    Boolean(nativeManifest) &&
    nativeManifest?.identity?.id === previewManifest.identity.id &&
    nativeManifest?.identity?.version === previewManifest.identity.version;

  if (!manifestIdentityMatches) {
    diagnostics.push({
      severity: 'error',
      code: 'extension-pack.executor.manifest-identity-mismatch',
      message: 'Materialized extension manifest identity does not match the parser preview.',
      targetStepId: preview.nextAction.installStepId,
      details: {
        expected: {
          id: previewManifest.identity.id,
          version: previewManifest.identity.version,
        },
        actual: nativeManifest
          ? {
              id: nativeManifest.identity?.id,
              version: nativeManifest.identity?.version,
            }
          : null,
      },
    });
  }

  const expectedFilePaths = collectRelativeFilePaths(preview.installSource.files);
  const actualFilePaths = collectRelativeFilePaths(nativeInstallSource.files);
  const fileListMatches = areStringArraysEqual(expectedFilePaths, actualFilePaths);

  if (!fileListMatches) {
    diagnostics.push({
      severity: 'error',
      code: 'extension-pack.executor.file-list-mismatch',
      message: 'Materialized extension file list does not match the parser preview.',
      targetStepId: preview.nextAction.installStepId,
      details: {
        expectedFilePaths,
        actualFilePaths,
      },
    });
  }

  const nativeValidationErrors = (nativeInstallSource.validationDiagnostics ?? []).filter(
    (diagnostic) => diagnostic.severity === 'error'
  );
  const nativeValidationPassed = nativeValidationErrors.length === 0 && Boolean(nativeManifest);

  if (!nativeValidationPassed) {
    diagnostics.push({
      severity: 'error',
      code: 'extension-pack.executor.native-validation-failed',
      message: 'Materialized extension source did not pass native manifest-v2 validation.',
      targetStepId: preview.nextAction.installStepId,
      details: {
        validationDiagnostics: nativeInstallSource.validationDiagnostics ?? [],
      },
    });
  }

  const nativeRootDir = normalizeFsPath(nativeInstallSource.rootDir);
  const materializedRootDir = normalizeFsPath(materializedSource.rootDir);
  if (nativeRootDir !== materializedRootDir) {
    diagnostics.push({
      severity: 'warning',
      code: 'extension-pack.executor.root-normalized',
      message: 'Native install-source reader resolved the materialized root directory to a different display path.',
      targetStepId: preview.nextAction.installStepId,
      details: {
        materializedRootDir,
        nativeRootDir,
      },
    });
  }

  return {
    checks: {
      packageDigestMatches,
      manifestIdentityMatches,
      fileListMatches,
      nativeValidationPassed,
    },
    diagnostics,
    status: diagnostics.some((diagnostic) => diagnostic.severity === 'error')
      ? 'blocked'
      : 'ready',
  };
}

export async function materializeExtensionPackExecutorPreview(
  preview: ExtensionPackExecutorPreview,
  options: ExtensionPackMaterializeOptions = {}
): Promise<ExtensionPackMaterializedSource> {
  if (!isTauriRuntime()) {
    throw new Error('Materializing .pmpe extension packs requires the Tauri desktop runtime');
  }

  const [fs, pathApi] = await Promise.all([
    import('@tauri-apps/api/fs'),
    import('@tauri-apps/api/path'),
  ]);

  const materializationId = normalizeMaterializationId(
    options.materializationId ?? createDefaultMaterializationId(preview)
  );
  const rootRelativePath = normalizeRelativePath(`pmp-temp/extension-packs/${materializationId}`);

  await fs.createDir(rootRelativePath, {
    dir: fs.BaseDirectory.AppCache,
    recursive: true,
  });

  let totalBytes = 0;
  for (const file of preview.installSource.files) {
    const relativePath = normalizeRelativePath(file.relativePath);
    const targetPath = normalizeRelativePath(`${rootRelativePath}/${relativePath}`);
    const targetDir = getParentPath(targetPath);
    const bytes = Uint8Array.from(file.bytes);
    totalBytes += bytes.byteLength;

    if (targetDir) {
      await fs.createDir(targetDir, {
        dir: fs.BaseDirectory.AppCache,
        recursive: true,
      });
    }

    await fs.writeBinaryFile(
      {
        path: targetPath,
        contents: bytes,
      },
      { dir: fs.BaseDirectory.AppCache }
    );
  }

  const appCacheDir = await pathApi.appCacheDir();
  const rootDir = await pathApi.join(appCacheDir, ...splitRelativePath(rootRelativePath));
  const manifestRelativePath = normalizeRelativePath(preview.nextAction.manifestRelativePath);
  const manifestPath = await pathApi.join(rootDir, ...splitRelativePath(manifestRelativePath));

  return {
    baseDirectory: 'AppCache',
    rootRelativePath,
    rootDir,
    manifestPath,
    manifestRelativePath,
    fileCount: preview.installSource.files.length,
    totalBytes,
  };
}

export async function cleanupExtensionPackMaterializedSource(
  materializedSource: ExtensionPackMaterializedSource | null | undefined
): Promise<void> {
  if (!materializedSource) return;
  await cleanupMaterializedSource(materializedSource);
}

export async function dryRunExtensionPackExecutorPreview(
  preview: ExtensionPackExecutorPreview,
  options: ExtensionPackMaterializeOptions = {}
): Promise<ExtensionPackExecutorDryRunResult> {
  const previewManifest = preview.installSource.validatedManifest;
  if (!previewManifest) {
    throw new Error('Extension pack executor preview is missing a validated manifest');
  }

  const materializedSource = await materializeExtensionPackExecutorPreview(preview, options);
  const nativeInstallSource = await readMaterializedInstallSourceFromNative(
    materializedSource.rootDir
  );
  const validation = validateNativeInstallSourceForPreview({
    preview,
    materializedSource,
    nativeInstallSource,
  });

  return {
    mode: 'dry-run',
    status: validation.status,
    materializedSource,
    nativeInstallSource,
    checks: validation.checks,
    diagnostics: validation.diagnostics,
  };
}

export async function commitExtensionPackExecutorPreview(
  preview: ExtensionPackExecutorPreview,
  options: ExtensionPackCommitOptions = {}
): Promise<ExtensionPackExecutorCommitResult> {
  const dryRun = options.dryRun ?? (await dryRunExtensionPackExecutorPreview(preview, options));
  const verifyStepId = findVerifyStepId(preview);
  const refreshStepId = findRefreshStepId(preview);
  const completedStepIds =
    dryRun.status === 'ready' && verifyStepId ? [verifyStepId] : [];

  if (dryRun.status !== 'ready') {
    await cleanupMaterializedSource(dryRun.materializedSource);
    return {
      mode: 'commit',
      status: 'blocked',
      dryRun,
      diagnostics: dryRun.diagnostics,
      completedStepIds,
    };
  }

  try {
    const commitInstallSource = await readMaterializedInstallSourceFromNative(
      dryRun.materializedSource.rootDir
    );
    const commitValidation = validateNativeInstallSourceForPreview({
      preview,
      materializedSource: dryRun.materializedSource,
      nativeInstallSource: commitInstallSource,
    });

    if (commitValidation.status !== 'ready') {
      await cleanupMaterializedSource(dryRun.materializedSource);
      return {
        mode: 'commit',
        status: 'blocked',
        dryRun,
        diagnostics: commitValidation.diagnostics,
        completedStepIds,
      };
    }

    const installedExtension = await installInstalledExtensionFromFilePath(
      dryRun.materializedSource.rootDir,
      {
        defaultEnabled: options.defaultEnabled,
      }
    );

    await cleanupMaterializedSource(dryRun.materializedSource);
    return {
      mode: 'commit',
      status: 'installed',
      dryRun,
      installedExtension,
      diagnostics: [
        ...dryRun.diagnostics,
        ...commitValidation.diagnostics,
      ],
      completedStepIds: [
        ...completedStepIds,
        preview.nextAction.installStepId,
        ...(refreshStepId ? [refreshStepId] : []),
      ],
    };
  } catch (error) {
    await cleanupMaterializedSource(dryRun.materializedSource);
    throw error;
  }
}
