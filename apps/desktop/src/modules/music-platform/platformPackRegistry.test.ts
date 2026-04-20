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

vi.mock('./bindingRuntime', () => ({
  invokePlatformRuntimeBinding: bindingRuntimeMock.invokePlatformRuntimeBinding,
}));

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
  registry.listPlatformPackRegistrations();
  await flushBootLifecycle();
  await registry.awaitBuiltinPlatformPackRegistrationsReady();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await flushBootLifecycle();
    if (registry.listPlatformPackRegistrations().length >= 2) {
      break;
    }
  }
  if (registry.listPlatformPackRegistrations().length < 1) {
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
    throw new Error(
      JSON.stringify(
        {
          directInstallErrors,
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
