import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  appDataDirMock,
  broadcastSignalMock,
  createDirMock,
  digestMock,
  fsState,
  joinMock,
  removeDirMock,
  readTextFileMock,
  removeFileMock,
  writeBinaryFileMock,
  writeFileMock,
} = vi.hoisted(() => {
  const appDataRoot = 'C:/Users/test/AppData/Roaming/PMP';
  const state = new Map<string, string | Uint8Array>();

  const buildKey = (path: string, dir?: number) => `${dir ?? 'abs'}:${path}`;
  const writeFile = vi.fn(async (file: string | { path: string; contents: string }, options?: { dir?: number }) => {
    const path = typeof file === 'string' ? file : file.path;
    const contents = typeof file === 'string' ? '' : file.contents;
    state.set(buildKey(path, options?.dir), contents);
  });
  const writeBinaryFile = vi.fn(
    async (
      file: string | { path: string; contents: Uint8Array },
      options?: { dir?: number }
    ) => {
      const path = typeof file === 'string' ? file : file.path;
      const contents = typeof file === 'string' ? new Uint8Array() : new Uint8Array(file.contents);
      state.set(buildKey(path, options?.dir), contents);
    }
  );
  const readTextFile = vi.fn(async (path: string, options?: { dir?: number }) => {
    const value = state.get(buildKey(path, options?.dir));
    return typeof value === 'string' ? value : null;
  });
  const removeFile = vi.fn(async (path: string, options?: { dir?: number }) => {
    state.delete(buildKey(path, options?.dir));
    state.delete(buildKey(path));
  });
  const removeDir = vi.fn(async (path: string, options?: { dir?: number; recursive?: boolean }) => {
    const scopedPrefix = `${buildKey(path, options?.dir)}/`;
    const absolutePrefix = `${buildKey(path)}/`;
    const normalizedRoot = path.replace(/\\/g, '/');
    const appDataRelative = normalizedRoot.startsWith(`${appDataRoot}/`)
      ? normalizedRoot.slice(appDataRoot.length + 1)
      : null;
    const appDataRelativePrefix =
      appDataRelative && appDataRelative.length > 0 ? `${buildKey(appDataRelative, 22)}/` : null;
    for (const key of Array.from(state.keys())) {
      if (key === buildKey(path, options?.dir) || key === buildKey(path)) {
        state.delete(key);
        continue;
      }
      if (appDataRelative && key === buildKey(appDataRelative, 22)) {
        state.delete(key);
        continue;
      }
      if (key.startsWith(scopedPrefix) || key.startsWith(absolutePrefix)) {
        state.delete(key);
        continue;
      }
      if (appDataRelativePrefix && key.startsWith(appDataRelativePrefix)) {
        state.delete(key);
      }
    }
  });

  return {
    fsState: state,
    createDirMock: vi.fn(async () => undefined),
    writeFileMock: writeFile,
    writeBinaryFileMock: writeBinaryFile,
    readTextFileMock: readTextFile,
    removeFileMock: removeFile,
    removeDirMock: removeDir,
    digestMock: vi.fn(async (_algorithm: AlgorithmIdentifier, data: BufferSource) => {
      const view = ArrayBuffer.isView(data)
        ? new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
        : new Uint8Array(data);
      const out = new Uint8Array(32);
      out[0] = view.byteLength % 251;
      return out.buffer;
    }),
    appDataDirMock: vi.fn(async () => appDataRoot),
    joinMock: vi.fn(async (...parts: string[]) => parts.join('/').replace(/\/+/g, '/')),
    broadcastSignalMock: vi.fn(async () => undefined),
  };
});

vi.mock('../../services/telemetry/TelemetryService', () => ({
  getTelemetryLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../utils/tauriRuntime', () => ({
  isTauriRuntime: () => true,
}));

vi.mock('../../utils/windowCommunication', () => ({
  STORAGE_KEYS: {
    PMPM_ALLOW_UNSIGNED_PLUGINS: 'test:pmpm-allow-unsigned',
    PMPM_PLUGINS: 'test:pmpm-plugins',
    PMPM_DURABLE_MIGRATION_V1_REPORT: 'test:pmpm-migration-report',
    PMPM_DURABLE_MIGRATION_V1: 'test:pmpm-migration-flag',
  },
  TAURI_EVENTS: {
    PMPM_PLUGINS_UPDATED: 'test:pmpm-plugins-updated',
  },
  broadcastSignal: broadcastSignalMock,
}));

vi.mock('@tauri-apps/api/fs', () => ({
  BaseDirectory: {
    AppData: 22,
  },
  createDir: createDirMock,
  writeFile: writeFileMock,
  writeBinaryFile: writeBinaryFileMock,
  readTextFile: readTextFileMock,
  removeFile: removeFileMock,
  removeDir: removeDirMock,
}));

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: appDataDirMock,
  join: joinMock,
}));

vi.mock('./PluginMagnetHost', () => ({
  PluginMagnetHost: () => null,
}));

function createSidecarPackageBytes(): Uint8Array {
  return Uint8Array.from(
    Buffer.from(
      'UEsDBBQAAAAIADOeh1xPtydvEAEAAFkCAAANAAAAbWFuaWZlc3QuanNvblVRu26EMBDs+QqLOkfu2vzBdSiR0kQpFnDIJn7JXtCdIv49a7DBVyFmZndm1n+VEPWX9RroXfqA1tQvor405/opMnR3MgIaRiPp5NQ0otkoLQkGIGA6LmEEhygNOMgefKllzoBeF71trGgf2PmwPjfZnPFBht6jo8RdTSBQCjolRbIRvdUazCD8ZAjZgweXNZ805O+tRUNFqmfZf9tT0jY/YauSZ/cmCbiWhRoNR+BfNCWX4c7jMK493c012WZDm/mSZYEDd/YWdQYIZ7n35Xu2CswRJXkFBj4SwJBDfpb0+7l+l713b7k4dlM8WhxLldKdykXZoeiTVClP8arcpQQJSa09XxlPcIywxVmqpfoHUEsDBBQAAAAIADOeh1yN5/JtNgAAAEIAAAAXAAAAc2lkZWNhci9lY2hvLXJ1bnRpbWUuanMrKMpPTi0u1isuScnM08vP01BKSSxJVNJR0EjOKM3L1lSwtVNAUpNfWqJXXpRZkgqV1rTmAgBQSwECFAAUAAAACAAznodcT7cnbxABAABZAgAADQAAAAAAAAAAAAAAAAAAAAAAbWFuaWZlc3QuanNvblBLAQIUABQAAAAIADOeh1yN5/JtNgAAAEIAAAAXAAAAAAAAAAAAAAAAADsBAABzaWRlY2FyL2VjaG8tcnVudGltZS5qc1BLBQYAAAAAAgACAIAAAACmAQAAAAA=',
      'base64'
    )
  );
}

describe('pmpm install artifacts', () => {
  beforeEach(() => {
    localStorage.clear();
    fsState.clear();
    vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(digestMock);
    createDirMock.mockClear();
    digestMock.mockClear();
    writeFileMock.mockClear();
    writeBinaryFileMock.mockClear();
    readTextFileMock.mockClear();
    removeFileMock.mockClear();
    removeDirMock.mockClear();
    appDataDirMock.mockClear();
    joinMock.mockClear();
    broadcastSignalMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('materializes sidecar PMPM entry files into resolved artifacts and skips magnet renderer registration', async () => {
    const {
      getInstalledPmpmExtensionRecord,
      getPluginRendererDefinition,
      installPmpmPluginFromZipBytes,
      supportsPmpmPluginMagnetSurface,
    } = await import('./pmpm');

    const installed = await installPmpmPluginFromZipBytes(createSidecarPackageBytes());
    const projected = getInstalledPmpmExtensionRecord('sidecar-plugin');
    const artifactDigest = installed.packageSha256 ?? installed.entrySha256;
    const artifactRootRelative = `pmp-durable/pmpm-artifacts/sidecar-plugin/${artifactDigest}`;
    const artifactEntryRelative = `${artifactRootRelative}/sidecar/echo-runtime.js`;
    const artifactManifestRelative = `${artifactRootRelative}/manifest.json`;
    const artifactEntryAbsolute = `C:/Users/test/AppData/Roaming/PMP/${artifactEntryRelative}`;

    expect(installed.resolvedArtifacts).toEqual([
      {
        runtimeId: 'sidecar.main',
        path: artifactEntryAbsolute,
        sha256: installed.entrySha256,
      },
    ]);
    expect(projected?.resolvedArtifacts).toEqual(installed.resolvedArtifacts);
    expect(supportsPmpmPluginMagnetSurface(installed)).toBe(false);
    expect(getPluginRendererDefinition('sidecar-plugin')).toBeNull();

    expect(writeBinaryFileMock).toHaveBeenCalledWith(
      {
        path: artifactEntryRelative,
        contents: expect.any(Uint8Array),
      },
      { dir: 22 }
    );
    expect(fsState.get(`22:${artifactEntryRelative}`)).toEqual(
      Uint8Array.from(
        Buffer.from('process.stdin.on("data", (chunk) => process.stdout.write(chunk));\n', 'utf8')
      )
    );
    expect(Buffer.from(fsState.get(`22:${artifactManifestRelative}`) as Uint8Array).toString('utf8')).toContain(
      '"entryPoint": "sidecar/echo-runtime.js"'
    );
  });

  it('removes persisted sidecar artifacts on uninstall', async () => {
    const { installPmpmPluginFromZipBytes, uninstallPmpmPlugin } = await import('./pmpm');

    const installed = await installPmpmPluginFromZipBytes(createSidecarPackageBytes());
    const artifactDigest = installed.packageSha256 ?? installed.entrySha256;
    const artifactRootAbsolute =
      `C:/Users/test/AppData/Roaming/PMP/pmp-durable/pmpm-artifacts/sidecar-plugin/${artifactDigest}`;
    const artifactEntryRelative = `pmp-durable/pmpm-artifacts/sidecar-plugin/${artifactDigest}/sidecar/echo-runtime.js`;

    uninstallPmpmPlugin('sidecar-plugin');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(removeDirMock).toHaveBeenCalledWith(artifactRootAbsolute, { recursive: true });
    expect(
      removeFileMock.mock.calls.some(
        (call) => call[0] === 'pmp-durable/pmpm-entry/sidecar-plugin.txt' && call[1]?.dir === 22
      )
    ).toBe(true);
    expect(fsState.has(`22:${artifactEntryRelative}`)).toBe(false);
  });

  it('requires clearing quarantine before PMPM recovery can be re-enabled', async () => {
    const {
      clearPmpmPluginQuarantine,
      getInstalledPmpmPlugin,
      installPmpmPluginFromZipBytes,
      quarantinePmpmPlugin,
      setPmpmPluginEnabled,
    } = await import('./pmpm');
    const { readPmpmAuditLog } = await import('./pmpmGovernance');

    await installPmpmPluginFromZipBytes(createSidecarPackageBytes());
    quarantinePmpmPlugin('sidecar-plugin', {
      surface: 'command',
      message: 'Plugin command timeout (25ms)',
      timeoutMs: 25,
    });

    expect(getInstalledPmpmPlugin('sidecar-plugin')).toMatchObject({
      enabled: false,
      disabledReason: 'quarantine',
    });

    setPmpmPluginEnabled('sidecar-plugin', true);
    expect(getInstalledPmpmPlugin('sidecar-plugin')).toMatchObject({
      enabled: false,
      disabledReason: 'quarantine',
    });

    clearPmpmPluginQuarantine('sidecar-plugin');
    expect(getInstalledPmpmPlugin('sidecar-plugin')).toMatchObject({
      enabled: false,
      disabledReason: 'manual',
    });

    setPmpmPluginEnabled('sidecar-plugin', true);
    expect(getInstalledPmpmPlugin('sidecar-plugin')).toMatchObject({
      enabled: true,
    });

    expect(readPmpmAuditLog().map((event) => event.type)).toEqual([
      'runtime-unresponsive',
      'quarantined',
      'quarantine-cleared',
      'enabled',
    ]);
  });
});
