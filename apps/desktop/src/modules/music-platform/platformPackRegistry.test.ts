import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const APP_DATA_DIR = 'C:/mock-appdata/com.pixelmatrix.player';

const connectorAuthState = vi.hoisted(() => ({
  adapters: new Map<string, unknown>(),
  compatRegistrations: new Map<string, unknown>(),
  initializers: [] as Array<() => void>,
}));

const bindingRuntimeMock = vi.hoisted(() => ({
  invokePlatformRuntimeBinding: vi.fn(async (request: unknown) => ({
    ok: true,
    data: request,
  })),
}));

const sidecarBridgeMock = vi.hoisted(() => ({
  invokePlatformPackSidecar: vi.fn(async (_connectorId: string, _entryPath: string, request: unknown) => request),
  disposePlatformPackSidecar: vi.fn(async () => {}),
}));

const tauriEventMock = vi.hoisted(() => ({
  emit: vi.fn(async () => undefined),
  listen: vi.fn(async () => () => undefined),
}));

const telemetryLoggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const tauriInvokeTelemetryMock = vi.hoisted(() => ({
  invokeWithTelemetry: vi.fn(async (command: string) => {
    if (command === 'plugin_sidecar_bridge_open') {
      return { sessionId: 'sidecar-session-1' };
    }
    return undefined;
  }),
}));

const fsState = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
}));

const fetchState = vi.hoisted(() => ({
  builtinPackIndexPayload: null as { packs: Array<Record<string, unknown>> } | null,
}));

vi.mock('./connectorAuth', () => ({
  createPassivePlatformConnectorAdapter: vi.fn((definition: Record<string, unknown>) => ({
    definition,
    async getAuthSnapshot() {
      return null;
    },
    async refreshAndEmitAuthSnapshot() {
      return null;
    },
  })),
  createPlatformCompatRuntimeFromConnectorAdapter: vi.fn(
    (_definition: Record<string, unknown>, _adapter: Record<string, unknown>) => ({
      auth: {
        async getSnapshot() {
          return { ok: false, error: { code: 'UNUSED_FALLBACK', message: 'unexpected fallback runtime' } };
        },
      },
      metadata: {
        source: 'connector-adapter',
        mode: 'fallback',
      },
    })
  ),
  listPlatformConnectorAdapters: vi.fn(() =>
    Array.from(connectorAuthState.adapters.values())
  ),
  registerPlatformCompatRegistrationForConnector: vi.fn((registration: { connectorId: string }) => {
    connectorAuthState.compatRegistrations.set(registration.connectorId, registration);
  }),
  registerPlatformConnectorAdapter: vi.fn((adapter: { definition: { connectorId: string } }) => {
    connectorAuthState.adapters.set(adapter.definition.connectorId, adapter);
  }),
  registerPlatformConnectorRegistryInitializer: vi.fn((initializer: () => void) => {
    connectorAuthState.initializers.push(initializer);
  }),
  unregisterPlatformCompatRegistrationForConnector: vi.fn((connectorId: string) => {
    connectorAuthState.compatRegistrations.delete(connectorId);
  }),
  unregisterPlatformConnectorAdapter: vi.fn((connectorId: string) => {
    connectorAuthState.adapters.delete(connectorId);
  }),
}));

vi.mock('./bindingRuntime', async () => {
  const actual = await vi.importActual<typeof import('./bindingRuntime')>('./bindingRuntime');
  return {
    ...actual,
    invokePlatformRuntimeBinding: bindingRuntimeMock.invokePlatformRuntimeBinding,
  };
});

vi.mock('./platformPackSidecarBridge', () => ({
  invokePlatformPackSidecar: sidecarBridgeMock.invokePlatformPackSidecar,
  disposePlatformPackSidecar: sidecarBridgeMock.disposePlatformPackSidecar,
  isExpectedPlatformPackSidecarLifecycleError: vi.fn(() => false),
}));

vi.mock('../../services/telemetry/TelemetryService', () => ({
  getTelemetryLogger: vi.fn(() => telemetryLoggerMock),
}));

vi.mock('../../services/telemetry/tauriInvokeTelemetry', () => ({
  invokeWithTelemetry: tauriInvokeTelemetryMock.invokeWithTelemetry,
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: tauriEventMock.emit,
  listen: tauriEventMock.listen,
}));

vi.mock('@tauri-apps/api/tauri', () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path.replace(/\\/g, '/')}`),
}));

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(async () => APP_DATA_DIR),
  join: vi.fn(async (...parts: string[]) =>
    parts
      .flatMap((part) => String(part).replace(/\\/g, '/').split('/'))
      .filter((segment) => segment.length > 0)
      .join('/')
      .replace(/^([A-Za-z]:)/, '$1')
  ),
}));

vi.mock('@tauri-apps/api/fs', () => {
  const normalize = (input: string, dir?: string): string => {
    const normalized = String(input).replace(/\\/g, '/');
    if (dir === 'appData') {
      return `${APP_DATA_DIR}/${normalized}`.replace(/\/+/g, '/');
    }
    return normalized.replace(/\/+/g, '/');
  };

  return {
    BaseDirectory: {
      AppData: 'appData',
    },
    createDir: vi.fn(async () => undefined),
    writeBinaryFile: vi.fn(
      async (
        input: {
          path: string;
          contents: Uint8Array;
        },
        options?: { dir?: string }
      ) => {
        fsState.files.set(normalize(input.path, options?.dir), new Uint8Array(input.contents));
      }
    ),
    exists: vi.fn(async (path: string) => fsState.files.has(normalize(path))),
    readTextFile: vi.fn(async (path: string) => {
      const bytes = fsState.files.get(normalize(path));
      if (!bytes) {
        throw new Error(`ENOENT: ${path}`);
      }
      return new TextDecoder().decode(bytes);
    }),
    readBinaryFile: vi.fn(async (path: string) => {
      const bytes = fsState.files.get(normalize(path));
      if (!bytes) {
        throw new Error(`ENOENT: ${path}`);
      }
      return new Uint8Array(bytes);
    }),
  };
});

const OriginalBlob = globalThis.Blob;
const originalCrypto = globalThis.crypto;
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

class RuntimeCodeBlob {
  readonly __text: string;

  constructor(parts: Array<string | Uint8Array | ArrayBuffer>) {
    this.__text = parts
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part instanceof Uint8Array) return new TextDecoder().decode(part);
        return new TextDecoder().decode(new Uint8Array(part));
      })
      .join('');
  }
}

function repoPath(...segments: string[]): string {
  return resolve(process.cwd(), ...segments);
}

const builtinPackAssetBytes = {
  '/resource/music-platform/packs/dist/builtin-bilibili.pmpp': new Uint8Array(
    readFileSync(repoPath('../../resource/music-platform/packs/dist/builtin-bilibili.pmpp'))
  ),
  '/resource/music-platform/packs/dist/builtin-netease.pmpp': new Uint8Array(
    readFileSync(repoPath('../../resource/music-platform/packs/dist/builtin-netease.pmpp'))
  ),
};

const builtinPackAssetUrlByConnectorId = {
  'connector.platform.bilibili': '/resource/music-platform/packs/dist/builtin-bilibili.pmpp',
  'connector.platform.netease': '/resource/music-platform/packs/dist/builtin-netease.pmpp',
} as const;

type BuiltinPackIndexPayloadEntry = {
  source: string;
  connectorId: string;
  packId: string;
  packVersion: string;
  packageDigest?: string;
  packAssetUrl: string;
};

function installFetchMock(): void {
  globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const pathname = new URL(url, 'http://localhost:1420').pathname;
    if (pathname === '/resource/music-platform/packs/dist/builtin-pack-index.json') {
      if (!fetchState.builtinPackIndexPayload) {
        return new Response(null, { status: 404 });
      }
      return new Response(JSON.stringify(fetchState.builtinPackIndexPayload), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }
    const bytes = builtinPackAssetBytes[pathname as keyof typeof builtinPackAssetBytes];
    if (!bytes) {
      return new Response(null, { status: 404 });
    }
    return new Response(bytes.slice(), { status: 200 });
  }) as typeof fetch;
}

function buildBuiltinPackIndexPayload(records: Array<Record<string, unknown>>): {
  packs: BuiltinPackIndexPayloadEntry[];
} {
  const packs: BuiltinPackIndexPayloadEntry[] = [];
  for (const record of records) {
    const connectorId =
      typeof record.connectorId === 'string' ? record.connectorId : '';
    const packId = typeof record.packId === 'string' ? record.packId : '';
    const packVersion =
      typeof record.packVersion === 'string' ? record.packVersion : '';
    const packAssetUrl =
      builtinPackAssetUrlByConnectorId[
        connectorId as keyof typeof builtinPackAssetUrlByConnectorId
      ];
    if (!connectorId || !packId || !packVersion || !packAssetUrl) {
      continue;
    }
    packs.push({
      source:
        typeof record.source === 'string' && record.source.length > 0
          ? record.source
          : `builtin-pack:${connectorId.replace('connector.platform.', '')}`,
      connectorId,
      packId,
      packVersion,
      packageDigest:
        typeof record.packageDigest === 'string' && record.packageDigest.length > 0
          ? record.packageDigest
          : undefined,
      packAssetUrl,
    });
  }

  return {
    packs,
  };
}

const EXTERNAL_PROVIDER_ONLY_PACK_BASE64 =
  'UEsDBBQAAAAIAM98lVwTuGQCxgAAAKUBAAANAAAAbWFuaWZlc3QuanNvbnWPzQ6CMBCE7z4F4ayNXn0DY/TofdOupgIttAtKDO/utvwFoqe2821nZj+bJEnv1hVAN3ReW5Mek/Qg9uk2EGpLDEKZA4WpXQky61GBBAoIGAcTVrQKo/gmdAbyXVUVtdcyTjM1UESrldwsUjmX5S4GSGsMSrJuTpikU4yanmLsJ1buSntG7fV39su6zPNGeNYmGv7jF6vif4VKSyBUc0s05NpFQ3IgaagX7+LpecHB09WGdN9muDIeoeYvgYRT+OYRYzbdF1BLAwQUAAAACADPfJVckmpDCkkBAAAFAwAADQAAAGNvbnRyYWN0Lmpzb25tUrtuwzAM3PMVgefGaNdubaegSIcM3RmJcYjIoixRaY0i/17J8atuJkG8w92Jup/Vel0otuJBySf6QGyL53XxVD4WDxlzBuTIvk7DzJ1NtjoTm6aOgVRHTqCmkPD2A2q8gwYBIbVNfhmkdJbhUo1odI69hF00QlubyFZllSOYgIly7QJBlNMUxnBFdsf65uYHKY9NJI/hjflMo8YCfFGKo5XuHXN8yLHHY2JlM/FxCqDAwYEMCWH4s5XWUJA8mosd4cKepKPO5xrItHtUXNdodVoL2yUlIHiV7efDJkKybhdTCxeqOpF/GiJkq6W0g2pKNK3W0StZ3fP7h/X7Lk4cpHS1K9OvWVTCftNBvaKhgwefc03MoSkb6j+zHFijJX4L2r50veGofyvYeB3lykWrvtifgwOF7yn8ndaN+NATjZoUCOoux+r6C1BLAwQUAAAACADPfJVcuxFkSrkAAABTAQAACgAAAHJ1bnRpbWUuanOlzr0OgjAQAOCdp7gNTYiJK8ZBnRxMTIwPUOmpjdiD65WIhHe3gBKdndr7/yJ8FMQCGVknoLxc18ZqYy97pspoZFhCE0FXt5gJ8VanEI/RrMiVnInvs7K8e2eyOAnNytU2gwvKwarCXUkm034JAKN4ttD0lw6iBMO27k9snqjjBHyhQ1avZOdSmEO7CHNtEoX3R3r6X5mbEyuu0zdtQDM6yivcUIW8cg7lyPmo//LTLQVhjwOwJ36cL1BLAwQUAAAACADPfJVcVQF81ysAAAAqAAAACAAAAGljb24uc3ZnsykuS1eoyM3JK7ZVyigpKbDS1y8vL9crN9bLL0rXNzIwMNAHqlBS0LcDAFBLAQIUABQAAAAIAM98lVwTuGQCxgAAAKUBAAANAAAAAAAAAAAAAAAAAAAAAABtYW5pZmVzdC5qc29uUEsBAhQAFAAAAAgAz3yVXJJqQwpJAQAABQMAAA0AAAAAAAAAAAAAAAAA8QAAAGNvbnRyYWN0Lmpzb25QSwECFAAUAAAACADPfJVcuxFkSrkAAABTAQAACgAAAAAAAAAAAAAAAABlAgAAcnVudGltZS5qc1BLAQIUABQAAAAIAM98lVxVAXzXKwAAACoAAAAIAAAAAAAAAAAAAAAAAEYDAABpY29uLnN2Z1BLBQYAAAAABAAEAOQAAACXAwAAAAA=';

const EXTERNAL_BROKEN_PACK_BASE64 =
  'UEsDBBQAAAAIAM98lVwx8VDKxQAAAKMBAAANAAAAbWFuaWZlc3QuanNvbnWPzQ6CMBCE7z4F4SyNXn0DY/TofW1XU5EW2gVDDO/utvwFoqe2821nZj+bJEnv1hVAV3ReW5MeknQvduk2EGpLDEL5AgpTWQky71GBBAoIGAcTVrQKozdnczRZVRW11zLOMjNQRKOV3CwyOZXlLtpLawxKsm72n6RjDJqeYmwnVu5Ke0bt5Xf227rc8z540iYa/uNnq+J/hUpLIFRzSzTk2kVDciBpqBfv4ul5wcHT1YZ032a4Mh6h5i+BhFP45hFjNt0XUEsDBBQAAAAIAM98lVySakMKSQEAAAUDAAANAAAAY29udHJhY3QuanNvbm1Su27DMAzc8xWB58Zo125tp6BIhwzdGYlxiMiiLFFpjSL/Xsnxq24mQbzD3Ym6n9V6XSi24kHJJ/pAbIvndfFUPhYPGXMG5Mi+TsPMnU22OhObpo6BVEdOoKaQ8PYDaryDBgEhtU1+GaR0luFSjWh0jr2EXTRCW5vIVmWVI5iAiXLtAkGU0xTGcEV2x/rm5gcpj00kj+GN+UyjxgJ8UYqjle4dc3zIscdjYmUz8XEKoMDBgQwJYfizldZQkDyaix3hwp6ko87nGsi0e1Rc12h1WgvbJSUgeJXt58MmQrJuF1MLF6o6kX8aImSrpbSDako0rdbRK1nd8/uH9fsuThykdLUr069ZVMJ+00G9oqGDB59zTcyhKRvqP7McWKMlfgvavnS94ah/K9h4HeXKRau+2J+DA4XvKfyd1o340BONmhQI6i7H6voLUEsDBBQAAAAIAM98lVxFquC8FAAAABIAAAAKAAAAcnVudGltZS5qc0utKMgvKlFISU1LLM0pUaiutQYAUEsDBBQAAAAIAM98lVxVAXzXKwAAACoAAAAIAAAAaWNvbi5zdmezKS5LV6jIzckrtlXKKCkpsNLXLy8v1ys31ssvStc3MjAw0AeqUFLQtwMAUEsBAhQAFAAAAAgAz3yVXDHxUMrFAAAAowEAAA0AAAAAAAAAAAAAAAAAAAAAAG1hbmlmZXN0Lmpzb25QSwECFAAUAAAACADPfJVckmpDCkkBAAAFAwAADQAAAAAAAAAAAAAAAADwAAAAY29udHJhY3QuanNvblBLAQIUABQAAAAIAM98lVxFquC8FAAAABIAAAAKAAAAAAAAAAAAAAAAAGQCAABydW50aW1lLmpzUEsBAhQAFAAAAAgAz3yVXFUBfNcrAAAAKgAAAAgAAAAAAAAAAAAAAAAAoAIAAGljb24uc3ZnUEsFBgAAAAAEAAQA5AAAAPECAAAAAA==';

function decodePackArchive(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

function resetBootTestEnvironment(
  options: {
    clearStorage?: boolean;
    clearFs?: boolean;
    clearBuiltinPackIndex?: boolean;
  } = {}
): void {
  const {
    clearStorage = true,
    clearFs = true,
    clearBuiltinPackIndex = true,
  } = options;

  vi.resetModules();
  vi.useFakeTimers();

  connectorAuthState.adapters.clear();
  connectorAuthState.compatRegistrations.clear();
  connectorAuthState.initializers.length = 0;
  bindingRuntimeMock.invokePlatformRuntimeBinding.mockClear();
  sidecarBridgeMock.invokePlatformPackSidecar.mockClear();
  sidecarBridgeMock.disposePlatformPackSidecar.mockClear();
  tauriEventMock.emit.mockClear();
  tauriEventMock.listen.mockClear();
  tauriInvokeTelemetryMock.invokeWithTelemetry.mockClear();
  telemetryLoggerMock.debug.mockClear();
  telemetryLoggerMock.info.mockClear();
  telemetryLoggerMock.warn.mockClear();
  telemetryLoggerMock.error.mockClear();

  if (clearFs) {
    fsState.files.clear();
  }
  if (clearStorage) {
    localStorage.clear();
  }
  if (clearBuiltinPackIndex) {
    fetchState.builtinPackIndexPayload = null;
  }

  Object.defineProperty(window, '__TAURI__', {
    configurable: true,
    value: {},
  });
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
  });
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      subtle: {
        digest: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
      },
    },
  });

  installFetchMock();

  globalThis.Blob = RuntimeCodeBlob as unknown as typeof Blob;
  URL.createObjectURL = ((blob: unknown) => {
    const code =
      blob && typeof blob === 'object' && '__text' in blob
        ? String((blob as { __text: string }).__text)
        : '';
    return `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
}

async function flushBootLifecycle(): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await Promise.resolve();
    await Promise.resolve();
    await vi.runAllTimersAsync();
  }
}

async function bootPlatformPackRegistry() {
  const registry = await import('./platformPackRegistry');
  const windowCommunication = await import('../../utils/windowCommunication');
  const expectedBuiltinCount = registry.listBuiltinPlatformPackAssets().length;
  registry.listPlatformPackRegistrations();
  await flushBootLifecycle();
  await registry.awaitBuiltinPlatformPackRegistrationsReady();
  for (let attempt = 0; attempt < 16; attempt += 1) {
    await flushBootLifecycle();
    if (registry.listPlatformPackRegistrations().length >= expectedBuiltinCount) {
      break;
    }
  }
  if (registry.listPlatformPackRegistrations().length < expectedBuiltinCount) {
    const directInstallErrors: string[] = [];
    for (const [assetUrl, bytes] of Object.entries(builtinPackAssetBytes)) {
      try {
        await registry.installPlatformPackFromZipBytes(bytes, {
          source: `test:${assetUrl}`,
        });
      } catch (error) {
        directInstallErrors.push(`${assetUrl}: ${String(error)}`);
      }
    }
    await flushBootLifecycle();
  }
  if (registry.listPlatformPackRegistrations().length < expectedBuiltinCount) {
    throw new Error(
      JSON.stringify(
        {
          directInstallErrors: [],
          fetchCalls:
            typeof globalThis.fetch === 'function' && 'mock' in globalThis.fetch
              ? (globalThis.fetch as unknown as { mock?: { calls?: unknown[] } }).mock?.calls
                  ?.length ?? 0
              : -1,
          adapterCount: connectorAuthState.adapters.size,
          compatCount: connectorAuthState.compatRegistrations.size,
          fsPaths: Array.from(fsState.files.keys()),
          telemetryWarns: telemetryLoggerMock.warn.mock.calls,
          telemetryErrors: telemetryLoggerMock.error.mock.calls,
        },
        null,
        2
      )
    );
  }
  return {
    registry,
    windowCommunication,
  };
}

describe('platformPackRegistry builtin pack boot', () => {
  beforeEach(() => {
    resetBootTestEnvironment();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    globalThis.Blob = OriginalBlob;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  });

  it('reinstalls builtin packs from assets and registers them after installed state is cleared', async () => {
    const { registry, windowCommunication } = await bootPlatformPackRegistry();
    const registrations = registry.listPlatformPackRegistrations();

    expect(registrations.map((item) => item.connectorId)).toEqual([
      'connector.platform.bilibili',
      'connector.platform.netease',
    ]);
    expect(connectorAuthState.adapters.size).toBe(2);
    expect(connectorAuthState.compatRegistrations.size).toBe(2);

    const storedRecords = JSON.parse(
      localStorage.getItem(windowCommunication.STORAGE_KEYS.PLATFORM_PACKS_V1) ?? '[]'
    ) as Array<Record<string, unknown>>;

    expect(storedRecords).toHaveLength(2);
    expect(storedRecords.map((item) => item.connectorId)).toEqual([
      'connector.platform.bilibili',
      'connector.platform.netease',
    ]);
    expect(storedRecords.every((item) => item.sourceType === 'builtin')).toBe(true);
    expect(
      storedRecords.every(
        (item) =>
          typeof item.runtimePath === 'string' &&
          item.runtimePath.startsWith(`${APP_DATA_DIR}/pmp-durable/music-platform-packs/`)
      )
    ).toBe(true);
    expect(
      storedRecords.every(
        (item) =>
          typeof item.sidecarPath === 'string' &&
          item.sidecarPath.startsWith(`${APP_DATA_DIR}/pmp-durable/music-platform-packs/`)
      )
    ).toBe(true);

    expect(
      Array.from(fsState.files.keys()).filter((path) => path.includes('/pmp-durable/music-platform-packs/'))
        .length
    ).toBeGreaterThanOrEqual(10);
  });

  it('keeps builtin runtime and sidecar on the standard pack binding path without bootstrap fallback', async () => {
    const { registry } = await bootPlatformPackRegistry();
    const bilibiliRegistration = registry
      .listPlatformPackRegistrations()
      .find((item) => item.connectorId === 'connector.platform.bilibili');

    expect(bilibiliRegistration).toBeTruthy();
    expect(bilibiliRegistration?.compat.metadata).toMatchObject({
      runtimeAdapter: 'platformPackRuntime',
      connectorId: 'connector.platform.bilibili',
      platformPackId: 'builtin-bilibili',
      platformPackVersion: '1.0.0',
    });
    expect((bilibiliRegistration?.compat.runtime as { metadata?: unknown }).metadata).toMatchObject({
      source: 'platform-pack',
      mode: 'binding-runtime',
    });

    const runtimeLibrary = bilibiliRegistration?.compat.runtime.library as
      | {
          resolveCoverAssetUrl?: (input: Record<string, unknown>) => Promise<unknown>;
        }
      | undefined;
    const runtimeResult = await runtimeLibrary?.resolveCoverAssetUrl?.({
      instanceId: 'bilibili:builtin',
      coverUrl: 'https://example.test/cover.jpg',
    });
    expect(runtimeResult).toMatchObject({
      ok: true,
    });
    expect(bindingRuntimeMock.invokePlatformRuntimeBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: 'host.pmp.platform-instance.library',
        connectorId: 'connector.platform.bilibili',
        method: 'resolveCoverAssetUrl',
        payload: {
          instanceId: 'bilibili:builtin',
          coverUrl: 'https://example.test/cover.jpg',
        },
      })
    );

    const hostSupport = registry.resolvePlatformPackHostRuntimeSupport('connector.platform.bilibili');
    expect(hostSupport).toBeTruthy();

    const authSnapshot = await hostSupport?.authBindingProvider?.getSnapshot({
      instanceId: 'bilibili:builtin',
      options: {
        bindingId: 'host.pmp.connector-auth',
        connectorId: 'connector.platform.bilibili',
        displayName: 'Bilibili',
        method: 'getSnapshot',
      },
    });
    const sidecarLibrary = hostSupport?.apiBindingProvider?.library as
      | {
          resolveCoverAssetUrl?: (context: {
            instanceId: string;
            options: {
              bindingId: string;
              connectorId: string;
              displayName: string;
              method: string;
              payload?: Record<string, unknown>;
            };
          }) => Promise<unknown>;
        }
      | undefined;
    const coverResult = await sidecarLibrary?.resolveCoverAssetUrl?.({
      instanceId: 'bilibili:builtin',
      options: {
        bindingId: 'host.pmp.platform-instance.library',
        connectorId: 'connector.platform.bilibili',
        displayName: 'Bilibili',
        method: 'resolveCoverAssetUrl',
        payload: {
          coverUrl: 'https://example.test/runtime-cover.jpg',
        },
      },
    });

    expect(authSnapshot).toMatchObject({
      channel: 'auth',
      method: 'getSnapshot',
      instanceId: 'bilibili:builtin',
    });
    expect(coverResult).toMatchObject({
      channel: 'api',
      bindingId: 'host.pmp.platform-instance.library',
      method: 'resolveCoverAssetUrl',
      instanceId: 'bilibili:builtin',
      payload: {
        coverUrl: 'https://example.test/runtime-cover.jpg',
      },
    });
    expect(sidecarBridgeMock.invokePlatformPackSidecar).toHaveBeenCalledWith(
      'connector.platform.bilibili',
      expect.stringContaining('/bin/pmp-platform-bilibili-sidecar.exe'),
      expect.objectContaining({
        channel: 'auth',
        method: 'getSnapshot',
        instanceId: 'bilibili:builtin',
      })
    );
    expect(sidecarBridgeMock.invokePlatformPackSidecar).toHaveBeenCalledWith(
      'connector.platform.bilibili',
      expect.stringContaining('/bin/pmp-platform-bilibili-sidecar.exe'),
      expect.objectContaining({
        channel: 'api',
        bindingId: 'host.pmp.platform-instance.library',
        method: 'resolveCoverAssetUrl',
        instanceId: 'bilibili:builtin',
      })
    );
  });

  it('skips builtin pack asset reconcile when installed builtin packs already match the lightweight index', async () => {
    const { registry, windowCommunication } = await bootPlatformPackRegistry();
    expect(registry.listPlatformPackRegistrations()).toHaveLength(2);

    const storedRecords = JSON.parse(
      localStorage.getItem(windowCommunication.STORAGE_KEYS.PLATFORM_PACKS_V1) ?? '[]'
    ) as Array<Record<string, unknown>>;

    fetchState.builtinPackIndexPayload = buildBuiltinPackIndexPayload(storedRecords);
    resetBootTestEnvironment({
      clearStorage: false,
      clearFs: false,
      clearBuiltinPackIndex: false,
    });

    const secondBoot = await bootPlatformPackRegistry();
    expect(secondBoot.registry.listPlatformPackRegistrations().map((item) => item.connectorId)).toEqual([
      'connector.platform.bilibili',
      'connector.platform.netease',
    ]);

    const fetchCalls =
      'mock' in globalThis.fetch
        ? (globalThis.fetch as unknown as { mock: { calls: Array<[string | URL | Request]> } }).mock
            .calls
            .map(([input]) => {
              const url =
                typeof input === 'string'
                  ? input
                  : input instanceof URL
                    ? input.toString()
                    : input.url;
              return new URL(url, 'http://localhost:1420').pathname;
            })
        : [];

    expect(fetchCalls).toContain('/resource/music-platform/packs/dist/builtin-pack-index.json');
    expect(fetchCalls).not.toContain('/resource/music-platform/packs/dist/builtin-bilibili.pmpp');
    expect(fetchCalls).not.toContain('/resource/music-platform/packs/dist/builtin-netease.pmpp');
  });

  it('treats an exact-match external install as current and skips builtin background reconcile', async () => {
    const { registry, windowCommunication } = await bootPlatformPackRegistry();
    expect(registry.listPlatformPackRegistrations()).toHaveLength(2);

    const storedRecords = JSON.parse(
      localStorage.getItem(windowCommunication.STORAGE_KEYS.PLATFORM_PACKS_V1) ?? '[]'
    ) as Array<Record<string, unknown>>;
    expect(storedRecords).toHaveLength(2);

    const mutatedRecords = storedRecords.map((record) =>
      record.connectorId === 'connector.platform.netease'
        ? {
            ...record,
            sourceType: 'external',
            source: 'file:netease-copy.pmpp',
          }
        : record
    );
    const mutatedNeteaseRecord = mutatedRecords.find(
      (record) => record.connectorId === 'connector.platform.netease'
    );
    localStorage.setItem(
      windowCommunication.STORAGE_KEYS.PLATFORM_PACKS_V1,
      JSON.stringify(mutatedRecords)
    );
    fetchState.builtinPackIndexPayload = buildBuiltinPackIndexPayload(storedRecords);

    resetBootTestEnvironment({
      clearStorage: false,
      clearFs: false,
      clearBuiltinPackIndex: false,
    });

    const secondBoot = await bootPlatformPackRegistry();
    const inspection = await secondBoot.registry.inspectBuiltinPlatformPackStoreState();
    const neteaseEntry = inspection.entries.find(
      (entry) => entry.connectorId === 'connector.platform.netease'
    );
    const health = secondBoot.registry.getPlatformPackStartupHealth();

    expect(secondBoot.registry.listPlatformPackRegistrations().map((item) => item.connectorId)).toEqual([
      'connector.platform.bilibili',
      'connector.platform.netease',
    ]);
    expect(inspection.current).toBe(true);
    expect(inspection.staleConnectorIds).toEqual([]);
    expect(neteaseEntry).toMatchObject({
      storedRecordFound: true,
      storedSourceType: 'external',
      storedPackId: mutatedNeteaseRecord?.packId,
      storedPackVersion: mutatedNeteaseRecord?.packVersion,
      effectiveReasonCodes: [],
    });
    expect(health.backgroundReconcileScheduled).toBe(false);
    expect(
      health.recentStages.some((entry) => entry.stage === 'background-reconcile')
    ).toBe(false);
  });

  it('keeps restored builtin packs when the lightweight index is temporarily unavailable', async () => {
    const { registry, windowCommunication } = await bootPlatformPackRegistry();
    expect(registry.listPlatformPackRegistrations()).toHaveLength(2);

    const storedRecords = JSON.parse(
      localStorage.getItem(windowCommunication.STORAGE_KEYS.PLATFORM_PACKS_V1) ?? '[]'
    ) as Array<Record<string, unknown>>;
    expect(storedRecords).toHaveLength(2);

    resetBootTestEnvironment({
      clearStorage: false,
      clearFs: false,
      clearBuiltinPackIndex: true,
    });

    const secondBoot = await bootPlatformPackRegistry();
    expect(secondBoot.registry.listPlatformPackRegistrations().map((item) => item.connectorId)).toEqual([
      'connector.platform.bilibili',
      'connector.platform.netease',
    ]);

    const fetchCalls =
      'mock' in globalThis.fetch
        ? (globalThis.fetch as unknown as { mock: { calls: Array<[string | URL | Request]> } }).mock
            .calls
            .map(([input]) => {
              const url =
                typeof input === 'string'
                  ? input
                  : input instanceof URL
                    ? input.toString()
                    : input.url;
              return new URL(url, 'http://localhost:1420').pathname;
            })
        : [];

    expect(fetchCalls).toContain('/resource/music-platform/packs/dist/builtin-pack-index.json');
    expect(fetchCalls).not.toContain('/resource/music-platform/packs/dist/builtin-bilibili.pmpp');
    expect(fetchCalls).not.toContain('/resource/music-platform/packs/dist/builtin-netease.pmpp');
  });

  it('keeps restored builtin packs in dev when the lightweight index only differs by digest', async () => {
    const { registry, windowCommunication } = await bootPlatformPackRegistry();
    expect(registry.listPlatformPackRegistrations()).toHaveLength(2);

    const storedRecords = JSON.parse(
      localStorage.getItem(windowCommunication.STORAGE_KEYS.PLATFORM_PACKS_V1) ?? '[]'
    ) as Array<Record<string, unknown>>;
    expect(storedRecords).toHaveLength(2);

    fetchState.builtinPackIndexPayload = buildBuiltinPackIndexPayload(
      storedRecords.map((record, index) => ({
        ...record,
        packageDigest: `dev-digest-${index + 1}`,
      }))
    );
    resetBootTestEnvironment({
      clearStorage: false,
      clearFs: false,
      clearBuiltinPackIndex: false,
    });

    const secondBoot = await bootPlatformPackRegistry();
    expect(secondBoot.registry.listPlatformPackRegistrations().map((item) => item.connectorId)).toEqual([
      'connector.platform.bilibili',
      'connector.platform.netease',
    ]);

    const fetchCalls =
      'mock' in globalThis.fetch
        ? (globalThis.fetch as unknown as { mock: { calls: Array<[string | URL | Request]> } }).mock
            .calls
            .map(([input]) => {
              const url =
                typeof input === 'string'
                  ? input
                  : input instanceof URL
                    ? input.toString()
                    : input.url;
              return new URL(url, 'http://localhost:1420').pathname;
            })
        : [];

    expect(fetchCalls).toContain('/resource/music-platform/packs/dist/builtin-pack-index.json');
    expect(fetchCalls).not.toContain('/resource/music-platform/packs/dist/builtin-bilibili.pmpp');
    expect(fetchCalls).not.toContain('/resource/music-platform/packs/dist/builtin-netease.pmpp');
  });

  it('exposes ready startup health after builtin pack boot completes', async () => {
    const { registry } = await bootPlatformPackRegistry();

    const health = registry.getPlatformPackStartupHealth();
    expect(health.state).toBe('ready');
    expect(health.currentStage).toBe('completed');
    expect(health.registeredBuiltinCount).toBe(2);
    expect(health.expectedBuiltinCount).toBe(2);
    expect(health.backgroundReconcileScheduled).toBe(false);
    expect(health.backgroundReconcileRunning).toBe(false);
    expect(health.recentStages.some((entry) => entry.stage === 'restore-store')).toBe(true);
    expect(
      health.recentStages.some(
        (entry) => entry.stage === 'completed' && entry.state === 'ready'
      )
    ).toBe(true);
    expect(telemetryLoggerMock.info).toHaveBeenCalledWith(
      'music-platform.pack.boot.completed',
      expect.objectContaining({
        fields: expect.objectContaining({
          state: 'ready',
          registeredBuiltinCount: 2,
          expectedBuiltinCount: 2,
        }),
      })
    );
  });

  it('reports Phase 3 netease pack workspace readiness and resolves a mountable workspace surface', async () => {
    const { registry } = await bootPlatformPackRegistry();

    const readiness = registry.inspectPlatformPackWorkspaceReadiness(
      'connector.platform.netease'
    );
    const surface = registry.resolvePlatformPackWorkspaceSurface(
      'connector.platform.netease'
    );

    expect(readiness.hostRouterReady).toBe(true);
    expect(readiness.ready).toBe(true);
    expect(readiness.workspaceOwnershipDeclared).toBe(true);
    expect(readiness.mountSurfaceDeclared).toBe(true);
    expect(readiness.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'workspace.host-router.unavailable',
        }),
        expect.objectContaining({
          code: 'workspace.pack-ownership.undeclared',
        }),
        expect.objectContaining({
          code: 'workspace.pack-mount.undeclared',
        }),
      ])
    );
    expect(surface).toMatchObject({
      connectorId: 'connector.platform.netease',
      platformId: 'netease',
      root: {
        viewId: 'netease.workspace.root',
        viewType: 'music-platform.workspace-root',
      },
      requiredRuntimeCarrier: 'webview-frame',
      workspace: {
        ownership: 'pack',
      },
    });
  });

  it('records background reconcile in startup health when the restored store is stale', async () => {
    const { registry, windowCommunication } = await bootPlatformPackRegistry();
    expect(registry.listPlatformPackRegistrations()).toHaveLength(2);

    const storedRecords = JSON.parse(
      localStorage.getItem(windowCommunication.STORAGE_KEYS.PLATFORM_PACKS_V1) ?? '[]'
    ) as Array<Record<string, unknown>>;
    expect(storedRecords).toHaveLength(2);

    fetchState.builtinPackIndexPayload = buildBuiltinPackIndexPayload(
      storedRecords.map((record, index) => ({
        ...record,
        packVersion: index === 0 ? '9.9.9' : record.packVersion,
      }))
    );
    resetBootTestEnvironment({
      clearStorage: false,
      clearFs: false,
      clearBuiltinPackIndex: false,
    });

    const secondBoot = await bootPlatformPackRegistry();
    let health = secondBoot.registry.getPlatformPackStartupHealth();
    for (
      let attempt = 0;
      attempt < 8 &&
      !health.recentStages.some((entry) => entry.stage === 'background-reconcile');
      attempt += 1
    ) {
      await flushBootLifecycle();
      health = secondBoot.registry.getPlatformPackStartupHealth();
    }

    expect(['running', 'ready']).toContain(health.state);
    expect(health.recentStages.some((entry) => entry.stage === 'background-reconcile')).toBe(true);
  });
});

describe('platformPackRegistry external pack readiness', () => {
  beforeEach(() => {
    resetBootTestEnvironment();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    globalThis.Blob = OriginalBlob;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  });

  it('hydrates provider-only external packs through the binding-contract runtime path', async () => {
    const registry = await import('./platformPackRegistry');
    const bytes = decodePackArchive(EXTERNAL_PROVIDER_ONLY_PACK_BASE64);

    const registration = await registry.installPlatformPackFromZipBytes(bytes, {
      source: 'file:qqmusic.pmpp',
    });

    expect(registration.connectorId).toBe('connector.platform.qqmusic');
    expect(registration.compat.metadata).toMatchObject({
      runtimeAdapter: 'bindingContract',
      connectorAdapterMode: 'bindingContract',
      platformPackId: 'external-qqmusic',
    });
    expect((registration.compat.runtime as { metadata?: unknown }).metadata).toMatchObject({
      connectorId: 'connector.platform.qqmusic',
      source: 'binding-contract-runtime',
    });

    const result = await registration.compat.runtime.library?.resolveCoverAssetUrl?.({
      instanceId: 'qqmusic:builtin',
      coverUrl: 'https://example.test/cover.jpg',
    });
    expect(result).toMatchObject({ ok: true });

    const hostSupport = registry.resolvePlatformPackHostRuntimeSupport('connector.platform.qqmusic');
    expect(hostSupport).toBeTruthy();

    const authSnapshot = await hostSupport?.authBindingProvider?.getSnapshot({
      instanceId: 'qqmusic:builtin',
      options: {
        bindingId: 'host.pmp.connector-auth',
        connectorId: 'connector.platform.qqmusic',
        displayName: 'qqmusic',
        method: 'getSnapshot',
      },
    });
    const providerLibrary = hostSupport?.apiBindingProvider?.library as
      | {
          resolveCoverAssetUrl?: (context: {
            instanceId: string;
            options: {
              bindingId: string;
              connectorId: string;
              displayName: string;
              method: string;
              payload?: Record<string, unknown>;
            };
          }) => Promise<unknown>;
        }
      | undefined;
    const providerResult = await providerLibrary?.resolveCoverAssetUrl?.({
      instanceId: 'qqmusic:builtin',
      options: {
        bindingId: 'host.pmp.platform-instance.library',
        connectorId: 'connector.platform.qqmusic',
        displayName: 'qqmusic',
        method: 'resolveCoverAssetUrl',
        payload: {
          coverUrl: 'https://example.test/provider-cover.jpg',
        },
      },
    });

    expect(authSnapshot).toMatchObject({
      authState: 'authorized',
      updatedAtMs: 1,
    });
    expect(providerResult).toMatchObject({
      ok: true,
    });
    expect(registry.listPlatformPackReadinessDiagnostics()).toEqual([]);
  });

  it('creates a distinct installation and imported instance for each repeated external import', async () => {
    const registry = await import('./platformPackRegistry');
    const installedPacks = await import('./installedPlatformPacks');
    const importedInstances = await import('./platformImportedInstanceRegistry');
    const bytes = decodePackArchive(EXTERNAL_PROVIDER_ONLY_PACK_BASE64);

    const first = await registry.installPlatformPackFromZipBytes(bytes, {
      source: 'file:qqmusic-a.pmpp',
    });
    await flushBootLifecycle();

    const second = await registry.installPlatformPackFromZipBytes(bytes, {
      source: 'file:qqmusic-b.pmpp',
    });
    await flushBootLifecycle();

    expect(first.installationId).toBeTruthy();
    expect(second.installationId).toBeTruthy();
    expect(first.installationId).not.toBe(second.installationId);
    expect(first.importedInstanceId).toBeTruthy();
    expect(second.importedInstanceId).toBeTruthy();
    expect(first.importedInstanceId).not.toBe(second.importedInstanceId);

    const storedRecords = installedPacks
      .loadInstalledPlatformPackRecords()
      .filter((record) => record.connectorId === 'connector.platform.qqmusic');
    expect(storedRecords).toHaveLength(2);
    expect(new Set(storedRecords.map((record) => record.installationId)).size).toBe(2);

    const importedRecords = importedInstances
      .listPlatformImportedInstanceRecords()
      .filter((record) => record.connectorId === 'connector.platform.qqmusic');
    expect(importedRecords).toHaveLength(2);
    expect(new Set(importedRecords.map((record) => record.instanceId)).size).toBe(2);
    expect(
      [...importedRecords.map((record) => record.installationId)].sort()
    ).toEqual([...storedRecords.map((record) => record.installationId)].sort());
  });

  it('records structured diagnostics when an external pack has no compatible runtime path', async () => {
    const registry = await import('./platformPackRegistry');
    const bytes = decodePackArchive(EXTERNAL_BROKEN_PACK_BASE64);

    await expect(
      registry.installPlatformPackFromZipBytes(bytes, {
        source: 'file:broken-qqmusic.pmpp',
      })
    ).rejects.toThrow(/could not resolve a compatible runtime\/adapter path/i);

    expect(registry.listPlatformPackRegistrations()).toEqual([]);
    expect(registry.listPlatformPackReadinessDiagnostics()).toEqual([
      expect.objectContaining({
        code: 'register.failed',
        phase: 'register',
        severity: 'error',
        connectorId: 'connector.platform.qqmusic',
        packId: 'broken-qqmusic',
        packVersion: '1.0.0',
        sourceType: 'external',
        source: 'file:broken-qqmusic.pmpp',
      }),
    ]);
  });
});
