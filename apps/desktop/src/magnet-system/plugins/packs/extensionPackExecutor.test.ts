import type { PluginReadInstallSourcePayload, PxpManifestV2 } from '@pixel-matrix/plugin-platform-contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionPackExecutorPreview } from './extensionPack';

const {
  appCacheDirMock,
  createDirMock,
  fileState,
  invokeWithTelemetryMock,
  installInstalledExtensionFromFilePathMock,
  isTauriRuntimeMock,
  joinMock,
  nativeDigestState,
  removeDirMock,
  writeBinaryFileMock,
} = vi.hoisted(() => {
  const appCacheRoot = 'C:/Users/test/AppData/Local/PMP/cache';
  const files = new Map<string, Uint8Array>();
  const nativeDigest = { value: 'a'.repeat(64) };
  const tauriRuntime = { value: true };
  const installedRecord = {
    manifest: {
      schemaVersion: '2.0',
      kind: 'extension',
      identity: {
        id: 'com.example.visualizer',
        publisher: 'example',
        version: '1.0.0',
        name: 'Example Visualizer',
      },
      hostTargets: [{ hostId: 'pmp', required: true }],
      runtimes: [
        {
          runtimeId: 'webview.main',
          kind: 'webview',
          entry: 'dist/index.js',
        },
      ],
    },
    installedAt: 1,
    packageDigest: 'a'.repeat(64),
    resolvedArtifacts: [
      {
        runtimeId: 'webview.main',
        path: 'C:/Users/test/AppData/Roaming/PMP/pmp-durable/extensions-v2/com.example.visualizer/a/dist/index.js',
        sha256: 'b'.repeat(64),
      },
    ],
    enabled: true,
  };
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+/g, '/');
  const buildScopedKey = (path: string, dir?: number) => `${dir ?? 'abs'}:${normalize(path)}`;

  function readAppCacheFile(rootDir: string, relativePath: string): Uint8Array | null {
    const rootRelativePath = normalize(rootDir).startsWith(`${appCacheRoot}/`)
      ? normalize(rootDir).slice(appCacheRoot.length + 1)
      : normalize(rootDir);
    return files.get(buildScopedKey(`${rootRelativePath}/${relativePath}`, 24)) ?? null;
  }

  const invokeWithTelemetry = vi.fn(
    async (
      command: string,
      args?: { filePath?: string }
    ): Promise<PluginReadInstallSourcePayload<PxpManifestV2>> => {
      if (command !== 'plugin_read_install_source') {
        throw new Error(`unexpected command: ${command}`);
      }

      const rootDir = normalize(args?.filePath ?? '');
      const manifestBytes = readAppCacheFile(rootDir, 'manifest.v2.json');
      if (!manifestBytes) {
        throw new Error(`missing materialized manifest: ${rootDir}/manifest.v2.json`);
      }

      const rootRelativePath = rootDir.startsWith(`${appCacheRoot}/`)
        ? rootDir.slice(appCacheRoot.length + 1)
        : rootDir;
      const scopedRoot = buildScopedKey(rootRelativePath, 24);
      const materializedFiles = Array.from(files.entries())
        .filter(([key]) => key.startsWith(`${scopedRoot}/`))
        .map(([key, bytes]) => ({
          relativePath: key.slice(`${scopedRoot}/`.length),
          bytes: Array.from(bytes),
          sha256: 'f'.repeat(64),
        }))
        .sort((left, right) =>
          left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
        );
      const manifestRaw = new TextDecoder().decode(manifestBytes);

      return {
        manifestPath: `${rootDir}/manifest.v2.json`,
        rootDir,
        manifestRaw,
        validatedManifest: JSON.parse(manifestRaw) as PxpManifestV2,
        validationDiagnostics: [],
        packageDigest: nativeDigest.value,
        files: materializedFiles,
      };
    }
  );

  return {
    appCacheDirMock: vi.fn(async () => appCacheRoot),
    createDirMock: vi.fn(async () => undefined),
    fileState: files,
    invokeWithTelemetryMock: invokeWithTelemetry,
    installInstalledExtensionFromFilePathMock: vi.fn(async () => installedRecord),
    isTauriRuntimeMock: vi.fn(() => tauriRuntime.value),
    joinMock: vi.fn(async (...parts: string[]) => normalize(parts.join('/'))),
    nativeDigestState: nativeDigest,
    removeDirMock: vi.fn(async (path: string, options?: { dir?: number }) => {
      const scopedPath = buildScopedKey(path, options?.dir);
      for (const key of Array.from(files.keys())) {
        if (key === scopedPath || key.startsWith(`${scopedPath}/`)) {
          files.delete(key);
        }
      }
    }),
    writeBinaryFileMock: vi.fn(
      async (
        file: string | { path: string; contents: Uint8Array },
        options?: { dir?: number }
      ) => {
        const path = typeof file === 'string' ? file : file.path;
        const contents = typeof file === 'string' ? new Uint8Array() : new Uint8Array(file.contents);
        files.set(buildScopedKey(path, options?.dir), contents);
      }
    ),
  };
});

vi.mock('../../../services/telemetry/tauriInvokeTelemetry', () => ({
  invokeWithTelemetry: invokeWithTelemetryMock,
}));

vi.mock('../../../utils/tauriRuntime', () => ({
  isTauriRuntime: isTauriRuntimeMock,
}));

vi.mock('../extensions', () => ({
  installInstalledExtensionFromFilePath: installInstalledExtensionFromFilePathMock,
}));

vi.mock('@tauri-apps/api/fs', () => ({
  BaseDirectory: {
    AppCache: 24,
  },
  createDir: createDirMock,
  removeDir: removeDirMock,
  writeBinaryFile: writeBinaryFileMock,
}));

vi.mock('@tauri-apps/api/path', () => ({
  appCacheDir: appCacheDirMock,
  join: joinMock,
}));

const encoder = new TextEncoder();

function bytes(value: string): number[] {
  return Array.from(encoder.encode(value));
}

function createPreview(overrides: Partial<ExtensionPackExecutorPreview> = {}): ExtensionPackExecutorPreview {
  const manifest: PxpManifestV2 = {
    schemaVersion: '2.0',
    kind: 'extension',
    identity: {
      id: 'com.example.visualizer',
      publisher: 'example',
      version: '1.0.0',
      name: 'Example Visualizer',
    },
    hostTargets: [{ hostId: 'pmp', required: true }],
    runtimes: [
      {
        runtimeId: 'webview.main',
        kind: 'webview',
        entry: 'dist/index.js',
      },
    ],
  };

  return {
    mode: 'preview',
    plan: {
      formatVersion: '1.0',
      id: 'extension-pack:com.example.visualizer:1.0.0',
      status: 'ready',
      source: {
        packageType: 'extension-pack',
        source: { kind: 'memory' },
      },
      summary: {
        title: 'Example Visualizer',
        packageType: 'extension-pack',
        extensionCount: 1,
      },
      steps: [
        {
          id: 'verify-integrity',
          kind: 'verify-integrity',
          source: { kind: 'memory' },
        },
        {
          id: 'install-extension:com.example.visualizer',
          kind: 'install-extension',
          pluginId: 'com.example.visualizer',
          manifestPath: 'extension/manifest.v2.json',
          source: { kind: 'embedded', path: 'extension' },
        },
        {
          id: 'refresh-plugin-registries',
          kind: 'refresh-plugin-registries',
        },
      ],
    },
    installSource: {
      kind: 'embedded-manifest-v2-source',
      sourcePackageType: 'extension-pack',
      sourceRootPath: 'extension',
      manifestPath: 'extension/manifest.v2.json',
      rootDir: 'extension',
      manifestRaw: JSON.stringify(manifest),
      validatedManifest: manifest,
      validationDiagnostics: [],
      packageDigest: 'a'.repeat(64),
      files: [
        {
          relativePath: 'dist/index.js',
          bytes: bytes('export function mount() {}\n'),
          sha256: 'b'.repeat(64),
        },
        {
          relativePath: 'manifest.v2.json',
          bytes: bytes(JSON.stringify(manifest)),
          sha256: 'c'.repeat(64),
        },
      ],
    },
    summary: {
      pluginId: 'com.example.visualizer',
      version: '1.0.0',
      fileCount: 2,
      totalBytes: 0,
      runtimeEntryRelativePaths: ['dist/index.js'],
    },
    nextAction: {
      kind: 'materialize-embedded-source-and-install-manifest-v2',
      installStepId: 'install-extension:com.example.visualizer',
      manifestRelativePath: 'manifest.v2.json',
    },
    ...overrides,
  };
}

describe('extensionPack executor dry-run', () => {
  beforeEach(() => {
    fileState.clear();
    nativeDigestState.value = 'a'.repeat(64);
    isTauriRuntimeMock.mockReturnValue(true);
    createDirMock.mockClear();
    writeBinaryFileMock.mockClear();
    invokeWithTelemetryMock.mockClear();
    installInstalledExtensionFromFilePathMock.mockClear();
    removeDirMock.mockClear();
    appCacheDirMock.mockClear();
    joinMock.mockClear();
  });

  it('materializes preview files into an AppCache extv2 source', async () => {
    const { materializeExtensionPackExecutorPreview } = await import('./extensionPackExecutor');

    const materialized = await materializeExtensionPackExecutorPreview(createPreview(), {
      materializationId: 'test-source',
    });

    expect(materialized).toMatchObject({
      baseDirectory: 'AppCache',
      rootRelativePath: 'pmp-temp/extension-packs/test-source',
      rootDir: 'C:/Users/test/AppData/Local/PMP/cache/pmp-temp/extension-packs/test-source',
      manifestPath:
        'C:/Users/test/AppData/Local/PMP/cache/pmp-temp/extension-packs/test-source/manifest.v2.json',
      manifestRelativePath: 'manifest.v2.json',
      fileCount: 2,
    });
    expect(createDirMock).toHaveBeenCalledWith('pmp-temp/extension-packs/test-source', {
      dir: 24,
      recursive: true,
    });
    expect(writeBinaryFileMock).toHaveBeenCalledTimes(2);
    expect(fileState.has('24:pmp-temp/extension-packs/test-source/manifest.v2.json')).toBe(true);
    expect(fileState.has('24:pmp-temp/extension-packs/test-source/dist/index.js')).toBe(true);
  });

  it('runs native install-source dry-run and reports a ready result when checks match', async () => {
    const { dryRunExtensionPackExecutorPreview } = await import('./extensionPackExecutor');

    const result = await dryRunExtensionPackExecutorPreview(createPreview(), {
      materializationId: 'test-source',
    });

    expect(result.status).toBe('ready');
    expect(result.checks).toEqual({
      packageDigestMatches: true,
      manifestIdentityMatches: true,
      fileListMatches: true,
      nativeValidationPassed: true,
    });
    expect(result.diagnostics).toEqual([]);
    expect(invokeWithTelemetryMock).toHaveBeenCalledWith(
      'plugin_read_install_source',
      {
        filePath: 'C:/Users/test/AppData/Local/PMP/cache/pmp-temp/extension-packs/test-source',
      },
      expect.objectContaining({
        moduleId: 'extension-pack',
        component: 'executorDryRun',
      })
    );
  });

  it('blocks dry-run when native packageDigest differs from the parser preview', async () => {
    const { dryRunExtensionPackExecutorPreview } = await import('./extensionPackExecutor');
    nativeDigestState.value = 'd'.repeat(64);

    const result = await dryRunExtensionPackExecutorPreview(createPreview(), {
      materializationId: 'digest-mismatch',
    });

    expect(result.status).toBe('blocked');
    expect(result.checks.packageDigestMatches).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'extension-pack.executor.digest-mismatch',
      })
    );
  });

  it('commits a ready dry-run through the existing manifest-v2 install chain', async () => {
    const { commitExtensionPackExecutorPreview } = await import('./extensionPackExecutor');

    const result = await commitExtensionPackExecutorPreview(createPreview(), {
      materializationId: 'commit-source',
      defaultEnabled: false,
    });

    expect(result.status).toBe('installed');
    expect(result.installedExtension).toMatchObject({
      manifest: {
        identity: {
          id: 'com.example.visualizer',
          version: '1.0.0',
        },
      },
      packageDigest: 'a'.repeat(64),
    });
    expect(result.completedStepIds).toEqual([
      'verify-integrity',
      'install-extension:com.example.visualizer',
      'refresh-plugin-registries',
    ]);
    expect(installInstalledExtensionFromFilePathMock).toHaveBeenCalledWith(
      'C:/Users/test/AppData/Local/PMP/cache/pmp-temp/extension-packs/commit-source',
      { defaultEnabled: false }
    );
    expect(removeDirMock).toHaveBeenCalledWith('pmp-temp/extension-packs/commit-source', {
      dir: 24,
      recursive: true,
    });
    expect(fileState.has('24:pmp-temp/extension-packs/commit-source/manifest.v2.json')).toBe(false);
  });

  it('can commit from an existing ready dry-run without repeating materialization work', async () => {
    const {
      commitExtensionPackExecutorPreview,
      dryRunExtensionPackExecutorPreview,
    } = await import('./extensionPackExecutor');
    const preview = createPreview();
    const dryRun = await dryRunExtensionPackExecutorPreview(preview, {
      materializationId: 'existing-dry-run',
    });
    invokeWithTelemetryMock.mockClear();
    writeBinaryFileMock.mockClear();

    const result = await commitExtensionPackExecutorPreview(preview, {
      dryRun,
      defaultEnabled: true,
    });

    expect(result.status).toBe('installed');
    expect(invokeWithTelemetryMock).toHaveBeenCalledTimes(1);
    expect(writeBinaryFileMock).not.toHaveBeenCalled();
    expect(installInstalledExtensionFromFilePathMock).toHaveBeenCalledWith(
      'C:/Users/test/AppData/Local/PMP/cache/pmp-temp/extension-packs/existing-dry-run',
      { defaultEnabled: true }
    );
    expect(removeDirMock).toHaveBeenCalledWith('pmp-temp/extension-packs/existing-dry-run', {
      dir: 24,
      recursive: true,
    });
  });

  it('blocks commit when the materialized source changes after dry-run', async () => {
    const {
      commitExtensionPackExecutorPreview,
      dryRunExtensionPackExecutorPreview,
    } = await import('./extensionPackExecutor');
    const preview = createPreview();
    const dryRun = await dryRunExtensionPackExecutorPreview(preview, {
      materializationId: 'stale-source',
    });
    nativeDigestState.value = 'd'.repeat(64);
    invokeWithTelemetryMock.mockClear();

    const result = await commitExtensionPackExecutorPreview(preview, { dryRun });

    expect(result.status).toBe('blocked');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'extension-pack.executor.digest-mismatch',
      })
    );
    expect(invokeWithTelemetryMock).toHaveBeenCalledTimes(1);
    expect(installInstalledExtensionFromFilePathMock).not.toHaveBeenCalled();
    expect(removeDirMock).toHaveBeenCalledWith('pmp-temp/extension-packs/stale-source', {
      dir: 24,
      recursive: true,
    });
  });

  it('does not commit when dry-run diagnostics block the executor', async () => {
    const { commitExtensionPackExecutorPreview } = await import('./extensionPackExecutor');
    nativeDigestState.value = 'd'.repeat(64);

    const result = await commitExtensionPackExecutorPreview(createPreview(), {
      materializationId: 'blocked-source',
    });

    expect(result.status).toBe('blocked');
    expect(result.completedStepIds).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'extension-pack.executor.digest-mismatch',
      })
    );
    expect(installInstalledExtensionFromFilePathMock).not.toHaveBeenCalled();
    expect(removeDirMock).toHaveBeenCalledWith('pmp-temp/extension-packs/blocked-source', {
      dir: 24,
      recursive: true,
    });
  });

  it('requires the Tauri desktop runtime', async () => {
    const { materializeExtensionPackExecutorPreview } = await import('./extensionPackExecutor');
    isTauriRuntimeMock.mockReturnValue(false);

    await expect(
      materializeExtensionPackExecutorPreview(createPreview(), {
        materializationId: 'browser-source',
      })
    ).rejects.toThrow('requires the Tauri desktop runtime');
  });
});
