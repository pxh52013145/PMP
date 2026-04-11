import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  appDataDirMock,
  basenameMock,
  broadcastDataUpdateMock,
  broadcastSignalMock,
  createDirMock,
  digestMock,
  dirnameMock,
  existsMock,
  fileState,
  fsState,
  invokeWithTelemetryMock,
  joinMock,
  readBinaryFileMock,
  readDirMock,
  readTextFileMock,
  removeDirMock,
  writeBinaryFileMock,
} = vi.hoisted(() => {
  const sourceState = new Map<string, Uint8Array>();
  const durableState = new Map<string, Uint8Array>();
  const appDataRoot = 'C:/Users/test/AppData/Roaming/PMP';
  const fixtureRoot = 'D:/fixtures/sidecar-capability-demo';

  const normalize = (value: string) => value.replace(/\\/g, '/');
  const buildScopedKey = (path: string, dir?: number) => `${dir ?? 'abs'}:${normalize(path)}`;

  const readDir = vi.fn(async (dir: string) => {
    const normalized = normalize(dir);
    if (normalized !== fixtureRoot) {
      return [];
    }
    return [
      {
        path: `${fixtureRoot}/manifest.v2.json`,
        name: 'manifest.v2.json',
      },
      {
        path: `${fixtureRoot}/bin`,
        name: 'bin',
        children: [
          {
            path: `${fixtureRoot}/bin/sidecar-capability-demo.js`,
            name: 'sidecar-capability-demo.js',
          },
        ],
      },
    ];
  });

  const invokeWithTelemetry = vi.fn(
    async (command: string, args?: { filePath?: string }) => {
      if (command !== 'plugin_read_install_source') {
        throw new Error(`unexpected command: ${command}`);
      }

      const normalizedPath = normalize(args?.filePath ?? '');
      const manifestPath = normalizedPath.endsWith('/manifest.v2.json')
        ? normalizedPath
        : `${normalizedPath}/manifest.v2.json`;
      const rootDir = manifestPath.slice(0, manifestPath.lastIndexOf('/'));
      const manifestBytes = sourceState.get(manifestPath);
      if (!manifestBytes) {
        throw new Error(`missing manifest: ${manifestPath}`);
      }

      const files = Array.from(sourceState.entries())
        .filter(([path]) => path === manifestPath || path.startsWith(`${rootDir}/`))
        .map(([path, bytes]) => ({
          relativePath: path.slice(rootDir.length + 1),
          bytes: Array.from(bytes),
        }))
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

      return {
        manifestPath,
        rootDir,
        manifestRaw: Buffer.from(manifestBytes).toString('utf8'),
        files,
      };
    }
  );

  return {
    fileState: sourceState,
    fsState: durableState,
    invokeWithTelemetryMock: invokeWithTelemetry,
    createDirMock: vi.fn(async () => undefined),
    readDirMock: readDir,
    readTextFileMock: vi.fn(async (path: string) => {
      const value = sourceState.get(normalize(path));
      if (!value) {
        const durable = durableState.get(buildScopedKey(path, 22));
        return durable ? Buffer.from(durable).toString('utf8') : '';
      }
      return Buffer.from(value).toString('utf8');
    }),
    readBinaryFileMock: vi.fn(async (path: string) => {
      const value = sourceState.get(normalize(path));
      if (!value) {
        throw new Error(`missing file: ${path}`);
      }
      return new Uint8Array(value);
    }),
    writeBinaryFileMock: vi.fn(
      async (
        file: string | { path: string; contents: Uint8Array },
        options?: { dir?: number }
      ) => {
        const path = typeof file === 'string' ? file : file.path;
        const contents = typeof file === 'string' ? new Uint8Array() : new Uint8Array(file.contents);
        durableState.set(buildScopedKey(path, options?.dir), contents);
      }
    ),
    removeDirMock: vi.fn(async (path: string) => {
      const normalized = normalize(path);
      const relativeFromAppData = normalized.startsWith(`${appDataRoot}/`)
        ? normalized.slice(appDataRoot.length + 1)
        : null;
      const scopedPrefix = relativeFromAppData ? buildScopedKey(relativeFromAppData, 22) : null;
      for (const key of Array.from(durableState.keys())) {
        if (
          (scopedPrefix && (key === scopedPrefix || key.startsWith(`${scopedPrefix}/`))) ||
          key === buildScopedKey(path) ||
          key.startsWith(`${buildScopedKey(path)}/`)
        ) {
          durableState.delete(key);
        }
      }
    }),
    existsMock: vi.fn(async (path: string) => {
      const normalized = normalize(path);
      if (sourceState.has(normalized)) return true;
      return (
        normalized === fixtureRoot ||
        normalized === `${fixtureRoot}/bin` ||
        normalized === `${fixtureRoot}/manifest.v2.json` ||
        normalized === `${fixtureRoot}/bin/sidecar-capability-demo.js`
      );
    }),
    joinMock: vi.fn(async (...parts: string[]) => normalize(parts.join('/').replace(/\/+/g, '/'))),
    dirnameMock: vi.fn(async (path: string) => {
      const normalized = normalize(path);
      return normalized.slice(0, normalized.lastIndexOf('/'));
    }),
    basenameMock: vi.fn(async (path: string) => {
      const normalized = normalize(path);
      return normalized.slice(normalized.lastIndexOf('/') + 1);
    }),
    appDataDirMock: vi.fn(async () => appDataRoot),
    digestMock: vi.fn(async (_algorithm: AlgorithmIdentifier, data: BufferSource) => {
      const view = ArrayBuffer.isView(data)
        ? new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
        : new Uint8Array(data);
      const out = new Uint8Array(32);
      out[0] = view.byteLength % 251;
      return out.buffer;
    }),
    broadcastDataUpdateMock: vi.fn(async (storageKey: string, data: unknown) => {
      localStorage.setItem(storageKey, JSON.stringify(data));
    }),
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

vi.mock('../../services/telemetry/tauriInvokeTelemetry', () => ({
  invokeWithTelemetry: invokeWithTelemetryMock,
}));

vi.mock('../../utils/tauriRuntime', () => ({
  isTauriRuntime: () => true,
}));

vi.mock('../../utils/windowCommunication', () => ({
  STORAGE_KEYS: {
    EXTENSIONS_V2: 'test:extensions-v2',
    EXTENSIONS_V2_AUDIT_LOG_V1: 'test:extensions-v2-audit-log-v1',
    EXTENSIONS_V2_RUNTIME_RESTART_V1: 'test:extensions-v2-runtime-restart-v1',
  },
  TAURI_EVENTS: {
    EXTENSIONS_V2_UPDATED: 'test:extensions-v2-updated',
  },
  broadcastDataUpdate: broadcastDataUpdateMock,
  setupStorageListener: vi.fn(() => () => {}),
  broadcastSignal: broadcastSignalMock,
}));

vi.mock('@tauri-apps/api/fs', () => ({
  BaseDirectory: {
    AppData: 22,
  },
  createDir: createDirMock,
  readDir: readDirMock,
  readTextFile: readTextFileMock,
  readBinaryFile: readBinaryFileMock,
  writeBinaryFile: writeBinaryFileMock,
  removeDir: removeDirMock,
  exists: existsMock,
}));

vi.mock('@tauri-apps/api/path', () => ({
  join: joinMock,
  dirname: dirnameMock,
  basename: basenameMock,
  appDataDir: appDataDirMock,
}));

describe('manifest-v2 host contribution validation', () => {
  it('accepts host.pmp view surfaces and magnet descriptors', async () => {
    const { validateInstalledExtensionManifest } = await import('./extensions');

    expect(() =>
      validateInstalledExtensionManifest({
        schemaVersion: '2.0',
        kind: 'extension',
        identity: {
          id: 'view-surface-demo',
          publisher: 'pixel-matrix.dev',
          version: '0.1.0',
          name: 'view-surface-demo',
        },
        hostTargets: [{ hostId: 'pmp', required: true }],
        runtimes: [
          {
            runtimeId: 'webview.main',
            kind: 'webview',
            entry: 'index.js',
          },
        ],
        contributes: {
          host: {
            pmp: {
              settingsPanels: [
                {
                  id: 'demo-settings',
                  kind: 'settings-panel',
                  title: 'Demo Settings',
                },
              ],
              pages: [
                {
                  id: 'demo-page',
                  kind: 'page',
                  title: 'Demo Page',
                },
              ],
              windows: [
                {
                  id: 'demo-window',
                  kind: 'window',
                  title: 'Demo Window',
                  width: 900,
                  height: 560,
                },
              ],
              shellSurfaces: [
                {
                  id: 'demo-overlay',
                  kind: 'shell-surface',
                  title: 'Demo Overlay',
                  surfaceType: 'overlay',
                  width: 480,
                  height: 320,
                  pointerPolicy: 'capture-input',
                },
                {
                  id: 'demo-widget',
                  kind: 'shell-surface',
                  title: 'Demo Widget',
                  surfaceType: 'desktop-widget',
                  width: 320,
                  height: 240,
                  pointerPolicy: 'passthrough',
                  dismissOnEscape: false,
                },
              ],
              visualizers: [
                {
                  id: 'demo-visualizer',
                  kind: 'visualizer',
                  title: 'Demo Visualizer',
                  inputs: ['spectrum'],
                },
              ],
              magnets: {
                defaultAnchor: {
                  type: 'range',
                  coordinates: [
                    { x: 0, y: 0 },
                    { x: 1, y: 0 },
                  ],
                },
                defaultVariant: 'compact',
                variants: [
                  {
                    id: 'compact',
                    label: 'Compact',
                  },
                ],
              },
            },
          },
        },
      })
    ).not.toThrow();
  });

  it('rejects invalid host.pmp shell surface pointer policies', async () => {
    const { validateInstalledExtensionManifest } = await import('./extensions');

    expect(() =>
      validateInstalledExtensionManifest({
        schemaVersion: '2.0',
        kind: 'extension',
        identity: {
          id: 'invalid-shell-surface-demo',
          publisher: 'pixel-matrix.dev',
          version: '0.1.0',
          name: 'invalid-shell-surface-demo',
        },
        hostTargets: [{ hostId: 'pmp', required: true }],
        runtimes: [
          {
            runtimeId: 'webview.main',
            kind: 'webview',
            entry: 'index.js',
          },
        ],
        contributes: {
          host: {
            pmp: {
              shellSurfaces: [
                {
                  id: 'bad-overlay',
                  kind: 'shell-surface',
                  title: 'Bad Overlay',
                  surfaceType: 'overlay',
                  pointerPolicy: 'hover-only',
                },
              ],
            },
          },
        },
      })
    ).toThrow(
      'contributes.host.pmp.shellSurfaces["bad-overlay"].pointerPolicy must be "capture-input" or "passthrough"'
    );
  });

  it('rejects host.pmp magnet defaultVariant values that are not declared', async () => {
    const { validateInstalledExtensionManifest } = await import('./extensions');

    expect(() =>
      validateInstalledExtensionManifest({
        schemaVersion: '2.0',
        kind: 'extension',
        identity: {
          id: 'invalid-view-surface-demo',
          publisher: 'pixel-matrix.dev',
          version: '0.1.0',
          name: 'invalid-view-surface-demo',
        },
        hostTargets: [{ hostId: 'pmp', required: true }],
        runtimes: [
          {
            runtimeId: 'webview.main',
            kind: 'webview',
            entry: 'index.js',
          },
        ],
        contributes: {
          host: {
            pmp: {
              magnets: {
                defaultVariant: 'expanded',
                variants: [
                  {
                    id: 'compact',
                    label: 'Compact',
                  },
                ],
              },
            },
          },
        },
      })
    ).toThrowError(
      'manifest.contributes.host.pmp.magnets.defaultVariant must exist in manifest.contributes.host.pmp.magnets.variants'
    );
  });
});

describe('manifest-v2 extension install artifacts', () => {
  const manifestPath = 'D:/fixtures/sidecar-capability-demo/manifest.v2.json';

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    fileState.clear();
    fsState.clear();
    createDirMock.mockClear();
    readDirMock.mockClear();
    readTextFileMock.mockClear();
    readBinaryFileMock.mockClear();
    writeBinaryFileMock.mockClear();
    removeDirMock.mockClear();
    existsMock.mockClear();
    invokeWithTelemetryMock.mockClear();
    joinMock.mockClear();
    dirnameMock.mockClear();
    basenameMock.mockClear();
    appDataDirMock.mockClear();
    broadcastDataUpdateMock.mockClear();
    broadcastSignalMock.mockClear();
    vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(digestMock);

    fileState.set(
      manifestPath,
      Uint8Array.from(
        Buffer.from(
          JSON.stringify(
            {
              schemaVersion: '2.0',
              kind: 'extension',
              identity: {
                id: 'sidecar-capability-demo',
                publisher: 'pixel-matrix.dev',
                version: '0.1.0',
                name: 'sidecar-capability-demo',
                displayName: 'Sidecar Capability Demo',
              },
              hostTargets: [{ hostId: 'pmp', required: true }],
              runtimes: [
                {
                  runtimeId: 'sidecar.main',
                  kind: 'sidecar',
                  entry: 'bin/sidecar-capability-demo.js',
                  priority: 10,
                  sandbox: 'native',
                  bridge: 'pxp.runtime.bridge.v1',
                  dataPlane: { kinds: ['pipe'] },
                },
              ],
              activationEvents: ['onCommand:sidecar-capability-demo.smoke'],
              requiresCapabilities: [{ capabilityId: 'core.capability-registry' }],
              optionalCapabilities: [{ capabilityId: 'host.pmp.audio-engine.analysis' }],
              contributes: {
                core: {
                  commands: [
                    {
                      kind: 'command',
                      id: 'sidecar-capability-demo.smoke',
                      title: 'Run Sidecar Capability Demo',
                    },
                  ],
                },
              },
            },
            null,
            2
          ),
          'utf8'
        )
      )
    );
    fileState.set(
      'D:/fixtures/sidecar-capability-demo/bin/sidecar-capability-demo.js',
      Uint8Array.from(
        Buffer.from('process.stdin.on("data", () => undefined);\n', 'utf8')
      )
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('installs manifest-v2 sidecar extensions into durable resolved artifacts', async () => {
    const {
      getInstalledExtensionRecord,
      installInstalledExtensionFromFilePath,
      listInstalledExtensionCompatPermissions,
    } = await import('./extensions');

    const installed = await installInstalledExtensionFromFilePath(manifestPath);
    const stored = getInstalledExtensionRecord('sidecar-capability-demo');
    const artifactRoot = `pmp-durable/extensions-v2/sidecar-capability-demo/${installed.packageDigest ?? 'current'}`;
    const artifactRelative = `${artifactRoot}/bin/sidecar-capability-demo.js`;

    expect(installed.resolvedArtifacts).toEqual([
      {
        runtimeId: 'sidecar.main',
        path: `C:/Users/test/AppData/Roaming/PMP/${artifactRelative}`,
        sha256: expect.any(String),
      },
    ]);
    expect(stored?.resolvedArtifacts).toEqual(installed.resolvedArtifacts);
    expect(listInstalledExtensionCompatPermissions(installed)).toEqual([
      'api:audio-visual',
      'api:host',
      'api:host-capability',
    ]);
    expect(writeBinaryFileMock).toHaveBeenCalledWith(
      {
        path: artifactRelative,
        contents: expect.any(Uint8Array),
      },
      { dir: 22 }
    );
    expect(fsState.has(`22:${artifactRelative}`)).toBe(true);
  }, 10_000);

  it('accepts file:// manifest paths from the native picker', async () => {
    const { parseInstalledExtensionFromFilePath } = await import('./extensions');

    const parsed = await parseInstalledExtensionFromFilePath(
      'file:///D:/fixtures/sidecar-capability-demo/manifest.v2.json'
    );

    expect(parsed.manifest.identity.id).toBe('sidecar-capability-demo');
  }, 10_000);

  it('removes persisted manifest-v2 artifacts on uninstall', async () => {
    const { installInstalledExtensionFromFilePath, uninstallInstalledExtension } = await import(
      './extensions'
    );

    const installed = await installInstalledExtensionFromFilePath(manifestPath);
    const artifactRootAbsolute = `C:/Users/test/AppData/Roaming/PMP/pmp-durable/extensions-v2/sidecar-capability-demo/${installed.packageDigest ?? 'current'}`;
    const artifactRelative = `pmp-durable/extensions-v2/sidecar-capability-demo/${installed.packageDigest ?? 'current'}/bin/sidecar-capability-demo.js`;

    uninstallInstalledExtension('sidecar-capability-demo');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(removeDirMock).toHaveBeenCalledWith(artifactRootAbsolute, { recursive: true });
    expect(fsState.has(`22:${artifactRelative}`)).toBe(false);
  }, 10_000);

  it('updates denied capabilities and removes derived compat permissions', async () => {
    const {
      getInstalledExtensionRecord,
      installInstalledExtensionFromFilePath,
      listInstalledExtensionCapabilityBindings,
      listInstalledExtensionCompatPermissions,
      setInstalledExtensionDeniedCapabilities,
    } = await import('./extensions');

    await installInstalledExtensionFromFilePath(manifestPath);
    setInstalledExtensionDeniedCapabilities('sidecar-capability-demo', [
      'core.capability-registry',
      'missing.capability',
    ]);

    const stored = getInstalledExtensionRecord('sidecar-capability-demo');
    expect(stored?.deniedCapabilities).toEqual(['core.capability-registry']);
    expect(listInstalledExtensionCapabilityBindings(stored!)).toEqual([
      {
        capabilityId: 'core.capability-registry',
        granted: false,
        required: true,
      },
      {
        capabilityId: 'host.pmp.audio-engine.analysis',
        granted: true,
        required: false,
      },
    ]);
    expect(listInstalledExtensionCompatPermissions(stored!)).toEqual(['api:audio-visual']);
  }, 10_000);

  it('records governance audit events for install, capability changes, disable, crash, clear, and uninstall', async () => {
    const {
      clearInstalledExtensionLastError,
      installInstalledExtensionFromFilePath,
      recordInstalledExtensionCrash,
      setInstalledExtensionDeniedCapabilities,
      setInstalledExtensionEnabled,
      uninstallInstalledExtension,
    } = await import('./extensions');
    const { readInstalledExtensionAuditLog } = await import('./extensionsGovernance');

    await installInstalledExtensionFromFilePath(manifestPath);
    setInstalledExtensionDeniedCapabilities('sidecar-capability-demo', ['core.capability-registry']);
    setInstalledExtensionEnabled('sidecar-capability-demo', false);
    recordInstalledExtensionCrash('sidecar-capability-demo', new Error('boom'));
    clearInstalledExtensionLastError('sidecar-capability-demo');
    uninstallInstalledExtension('sidecar-capability-demo');

    expect(readInstalledExtensionAuditLog().map((event) => event.type)).toEqual([
      'installed',
      'capabilities-updated',
      'disabled',
      'crash',
      'errors-cleared',
      'uninstalled',
    ]);
  }, 10_000);

  it('records runtime restart requests for manifest-v2 governance', async () => {
    const { installInstalledExtensionFromFilePath } = await import('./extensions');
    const { readInstalledExtensionAuditLog } = await import('./extensionsGovernance');
    const { requestInstalledExtensionRuntimeRestart } = await import('./hostExtensionRuntimeSupervisor');

    await installInstalledExtensionFromFilePath(manifestPath);
    requestInstalledExtensionRuntimeRestart('sidecar-capability-demo', { reason: 'manual' });

    const auditLog = readInstalledExtensionAuditLog();
    expect(auditLog.at(-1)).toMatchObject({
      type: 'runtime-restart',
      pluginId: 'sidecar-capability-demo',
      reason: 'manual',
    });
    expect(
      JSON.parse(localStorage.getItem('test:extensions-v2-runtime-restart-v1') ?? 'null')
    ).toMatchObject({
      pluginId: 'sidecar-capability-demo',
      reason: 'manual',
    });
  }, 10_000);

  it('requests a runtime restart when reinstalling an existing manifest-v2 extension', async () => {
    const { installInstalledExtensionFromFilePath } = await import('./extensions');

    await installInstalledExtensionFromFilePath(manifestPath);
    localStorage.removeItem('test:extensions-v2-runtime-restart-v1');

    await installInstalledExtensionFromFilePath(manifestPath);

    expect(
      JSON.parse(localStorage.getItem('test:extensions-v2-runtime-restart-v1') ?? 'null')
    ).toMatchObject({
      pluginId: 'sidecar-capability-demo',
      reason: 'install-update',
    });
  }, 10_000);

  it('clears stale lastError metadata when reinstalling an existing manifest-v2 extension', async () => {
    const {
      getInstalledExtensionRecord,
      installInstalledExtensionFromFilePath,
      recordInstalledExtensionCrash,
    } = await import('./extensions');

    await installInstalledExtensionFromFilePath(manifestPath);
    recordInstalledExtensionCrash('sidecar-capability-demo', new Error('stale error'));

    await installInstalledExtensionFromFilePath(manifestPath);

    const record = getInstalledExtensionRecord('sidecar-capability-demo');
    expect(record).toMatchObject({
      manifest: {
        identity: {
          id: 'sidecar-capability-demo',
        },
      },
    });
    expect(record).not.toHaveProperty('lastError');
    expect(record).not.toHaveProperty('lastErrorAt');
  }, 10_000);
});
