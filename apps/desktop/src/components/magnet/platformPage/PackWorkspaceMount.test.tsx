import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => {
  const runtimeResources = {
    cleanup: vi.fn(async () => undefined),
  };
  const telemetryLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const runtimeEventDisposer = vi.fn(() => undefined);
  const sandboxAdapter = {
    handleSandboxMessage: vi.fn(),
    primeRuntimeHello: vi.fn(),
    port: { postMessage: vi.fn() },
  };
  const runtimeSession = {
    start: vi.fn(async () => undefined),
    revokeCapabilities: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
    emitRuntimeEvent: vi.fn(async () => undefined),
  };
  const navigationService = {
    navigateTo: vi.fn(),
    goBack: vi.fn(),
    getSnapshot: vi.fn(() => ({
      currentIndex: 0,
      items: [],
    })),
  };
  const kernel = {
    services: {
      get: vi.fn(() => navigationService),
      getOptional: vi.fn(() => null),
    },
    events: {
      on: vi.fn(() => () => undefined),
    },
  };
  const audioService = {
    getState: vi.fn(() => ({
      playbackState: 'paused',
      currentTrack: null,
    })),
  };
  const pluginMountApi = {
    navigation: {
      getSnapshot: vi.fn(() => ({
        currentIndex: 0,
        items: [],
      })),
    },
    config: {
      get: vi.fn(() => ({})),
      onChange: vi.fn(() => () => undefined),
    },
    host: {
      getInfo: vi.fn(() => ({
        hostId: 'pmp',
        hostVersion: 'test',
      })),
    },
    visualizer: {
      getSpectrum: vi.fn(() => null),
      getSpectrumFrame: vi.fn(() => null),
    },
  };

  return {
    runtimeResources,
    telemetryLogger,
    sandboxAdapter,
    runtimeSession,
    navigationService,
    kernel,
    audioService,
    pluginMountApi,
    disposeRuntimeEvents: vi.fn(() => undefined),
    buildRuntimeHelloSnapshot: vi.fn((input: Record<string, unknown>) => ({
      runtimeKind: input.runtimeKind,
      carrier: input.carrier,
      pluginId: input.pluginId,
    })),
    buildRuntimeInitSnapshot: vi.fn((input: Record<string, unknown>) => ({
      pluginId: input.pluginId,
      runtimeId: input.runtimeId,
      runtimeInstanceId: input.runtimeInstanceId,
    })),
    buildRuntimeActivateSnapshot: vi.fn((input: Record<string, unknown>) => ({
      payload: {
        surface: input.kind,
        surfaceId: input.surfaceId,
        mountContext: input.mountContext,
      },
      runtimeKind: 'webview',
      carrier: 'webview-frame',
    })),
    buildRuntimeHealthSnapshot: vi.fn((input: Record<string, unknown>) => ({
      pluginId: input.pluginId,
      runtimeId: input.runtimeId,
      runtimeInstanceId: input.runtimeInstanceId,
    })),
    buildViewMountRequestSnapshot: vi.fn((input: Record<string, unknown>) => ({
      viewId: input.surfaceId,
      viewType: input.viewType,
      surfaceSlot: input.surfaceSlot,
      mountMetadata: input.mountMetadata,
    })),
    buildRuntimeSandboxSrcDoc: vi.fn((frameId: string) => `<!doctype html><title>${frameId}</title>`),
    dispatchSandboxRpcRequest: vi.fn(async (_api: unknown, _permissions: unknown, request: { id?: string }) => ({
      type: 'sandbox:rpc-result',
      id: request.id ?? 'rpc-id',
    })),
    createRuntimeResourceRegistry: vi.fn(() => runtimeResources),
    createSandboxRuntimeSessionAdapter: vi.fn(() => sandboxAdapter),
    createRuntimeBridgeHostSession: vi.fn(() => runtimeSession),
    bindHostRuntimeEventChannel: vi.fn(() => runtimeEventDisposer),
    createPluginMountApi: vi.fn(() => pluginMountApi),
    runtimeEventDisposer,
  };
});

vi.mock('../../../contexts/KernelContext', () => ({
  useKernel: () => testState.kernel,
}));

vi.mock('../../../contexts/AudioEngineContext', () => ({
  useAudioService: () => testState.audioService,
}));

vi.mock('../../../i18n', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('../../../services/telemetry/TelemetryService', () => ({
  getTelemetryLogger: () => testState.telemetryLogger,
}));

vi.mock('../../../magnet-system/plugins/runtimeBridgeSnapshots', () => ({
  buildRuntimeActivateSnapshot: testState.buildRuntimeActivateSnapshot,
  buildRuntimeHealthSnapshot: testState.buildRuntimeHealthSnapshot,
  buildRuntimeHelloSnapshot: testState.buildRuntimeHelloSnapshot,
  buildRuntimeInitSnapshot: testState.buildRuntimeInitSnapshot,
  buildViewMountRequestSnapshot: testState.buildViewMountRequestSnapshot,
}));

vi.mock('../../../magnet-system/plugins/runtimeSandboxSrcDoc', () => ({
  buildRuntimeSandboxSrcDoc: testState.buildRuntimeSandboxSrcDoc,
}));

vi.mock('../../../magnet-system/plugins/runtime/sandboxCapabilityTransport', () => ({
  dispatchSandboxRpcRequest: testState.dispatchSandboxRpcRequest,
}));

vi.mock('../../../magnet-system/plugins/runtime/runtimeResourceRegistry', () => ({
  createRuntimeResourceRegistry: testState.createRuntimeResourceRegistry,
}));

vi.mock('../../../magnet-system/plugins/runtime/sandboxRuntimeSessionAdapter', () => ({
  createSandboxRuntimeSessionAdapter: testState.createSandboxRuntimeSessionAdapter,
}));

vi.mock('../../../magnet-system/plugins/runtime/runtimeBridgeHostSession', () => ({
  createRuntimeBridgeHostSession: testState.createRuntimeBridgeHostSession,
}));

vi.mock('../../../magnet-system/plugins/runtime/runtimeEventChannel', () => ({
  bindHostRuntimeEventChannel: testState.bindHostRuntimeEventChannel,
}));

vi.mock('../../../magnet-system/plugins/pluginHostApi', () => ({
  createPluginMountApi: testState.createPluginMountApi,
}));

import { PLUGIN_PERMISSIONS } from '../../../magnet-system/plugins/host-api/permissions';
import type { PlatformPackWorkspaceSurfaceRecord } from '../../../modules/music-platform/platformWorkspaceSurface';
import { PackWorkspaceMount } from './PackWorkspaceMount';

function createSurface(): PlatformPackWorkspaceSurfaceRecord {
  return {
    connectorId: 'connector.platform.netease',
    platformId: 'netease',
    displayName: 'Netease',
    packId: 'builtin-netease',
    packVersion: '1.1.0',
    source: 'builtin-pack:netease',
    runtimeCode: 'export function mountPage() { return () => {}; }',
    runtimeImportUrl: 'app://builtin-netease/runtime.js',
    workspace: {
      ownership: 'pack' as const,
      requiredRuntimeCarrier: 'webview-frame' as const,
      root: {
        viewId: 'netease.workspace.root',
        viewType: 'music-platform.workspace-root',
      },
      capabilityFamilies: {
        required: ['host.pmp.music-platform.workspace'],
        optional: ['host.pmp.connector-auth'],
      },
      context: {
        scope: 'platform-instance' as const,
        fields: ['connectorId', 'instanceId', 'cacheScope'],
      },
    },
    root: {
      viewId: 'netease.workspace.root',
      viewType: 'music-platform.workspace-root',
    },
    requiredRuntimeCarrier: 'webview-frame' as const,
  };
}

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function dispatchFrameMessage(
  iframeWindow: object,
  data: Record<string, unknown>
): Promise<void> {
  const event = new MessageEvent('message', {
    data,
  });
  Object.defineProperty(event, 'source', {
    configurable: true,
    value: iframeWindow,
  });

  await act(async () => {
    window.dispatchEvent(event);
    await flushEffects();
  });
}

async function renderMount(
  surface: PlatformPackWorkspaceSurfaceRecord = createSurface()
): Promise<{
  container: HTMLDivElement;
  root: Root;
  iframe: HTMLIFrameElement;
  iframeWindow: { postMessage: ReturnType<typeof vi.fn> };
}> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <PackWorkspaceMount
        connectorId="connector.platform.netease"
        displayName="Netease"
        instanceId="netease:builtin"
        surface={surface}
      />
    );
    await flushEffects();
  });

  const iframe = container.querySelector('iframe');
  expect(iframe).toBeTruthy();
  const iframeWindow = {
    postMessage: vi.fn(),
  };
  Object.defineProperty(iframe as HTMLIFrameElement, 'contentWindow', {
    configurable: true,
    value: iframeWindow,
  });

  return {
    container,
    root,
    iframe: iframe as HTMLIFrameElement,
    iframeWindow,
  };
}

let mountedRoot: { root: Root; container: HTMLDivElement } | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useRealTimers();

  testState.runtimeResources.cleanup.mockClear();
  testState.telemetryLogger.info.mockClear();
  testState.telemetryLogger.warn.mockClear();
  testState.telemetryLogger.error.mockClear();
  testState.telemetryLogger.debug.mockClear();
  testState.sandboxAdapter.handleSandboxMessage.mockClear();
  testState.sandboxAdapter.primeRuntimeHello.mockClear();
  testState.runtimeSession.start.mockClear();
  testState.runtimeSession.revokeCapabilities.mockClear();
  testState.runtimeSession.dispose.mockClear();
  testState.runtimeSession.emitRuntimeEvent.mockClear();
  testState.navigationService.navigateTo.mockClear();
  testState.navigationService.goBack.mockClear();
  testState.navigationService.getSnapshot.mockClear();
  testState.navigationService.getSnapshot.mockReturnValue({
    currentIndex: 0,
    items: [],
  });
  testState.kernel.services.get.mockClear();
  testState.kernel.services.getOptional.mockClear();
  testState.kernel.events.on.mockClear();
  testState.audioService.getState.mockClear();
  testState.audioService.getState.mockReturnValue({
    playbackState: 'paused',
    currentTrack: null,
  });
  testState.pluginMountApi.navigation.getSnapshot.mockClear();
  testState.pluginMountApi.navigation.getSnapshot.mockReturnValue({
    currentIndex: 0,
    items: [],
  });
  testState.pluginMountApi.config.get.mockClear();
  testState.pluginMountApi.config.get.mockReturnValue({});
  testState.pluginMountApi.config.onChange.mockClear();
  testState.pluginMountApi.host.getInfo.mockClear();
  testState.pluginMountApi.host.getInfo.mockReturnValue({
    hostId: 'pmp',
    hostVersion: 'test',
  });
  testState.pluginMountApi.visualizer.getSpectrum.mockClear();
  testState.pluginMountApi.visualizer.getSpectrum.mockReturnValue(null);
  testState.pluginMountApi.visualizer.getSpectrumFrame.mockClear();
  testState.pluginMountApi.visualizer.getSpectrumFrame.mockReturnValue(null);
  testState.runtimeEventDisposer.mockClear();
  testState.buildRuntimeHelloSnapshot.mockClear();
  testState.buildRuntimeInitSnapshot.mockClear();
  testState.buildRuntimeActivateSnapshot.mockClear();
  testState.buildRuntimeHealthSnapshot.mockClear();
  testState.buildViewMountRequestSnapshot.mockClear();
  testState.buildRuntimeSandboxSrcDoc.mockClear();
  testState.dispatchSandboxRpcRequest.mockClear();
  testState.createRuntimeResourceRegistry.mockClear();
  testState.createSandboxRuntimeSessionAdapter.mockClear();
  testState.createRuntimeBridgeHostSession.mockClear();
  testState.bindHostRuntimeEventChannel.mockClear();
  testState.createPluginMountApi.mockClear();
});

afterEach(async () => {
  vi.useRealTimers();
  if (mountedRoot) {
    await act(async () => {
      mountedRoot?.root.unmount();
      await flushEffects();
    });
    mountedRoot = null;
  }
  document.body.innerHTML = '';
});

describe('PackWorkspaceMount', () => {
  it('boots a pack-owned workspace runtime after iframe ready and clears loading after mount', async () => {
    const mounted = await renderMount();
    mountedRoot = {
      root: mounted.root,
      container: mounted.container,
    };

    expect(mounted.container.textContent).toContain(
      'magnet.platform.workspace.packMount.loadingTitle'
    );
    expect(testState.createPluginMountApi).toHaveBeenCalledWith(
      expect.objectContaining({
        hostLabel: 'PlatformPackWorkspaceMount',
        permissions: expect.any(Set),
      })
    );

    const mountApiCall = testState.createPluginMountApi.mock.calls.at(0) as
      | [{ permissions: Set<string> }]
      | undefined;
    expect(mountApiCall).toBeTruthy();
    expect(Array.from(mountApiCall?.[0].permissions ?? [])).toEqual(
      expect.arrayContaining([
        PLUGIN_PERMISSIONS.host,
        PLUGIN_PERMISSIONS.hostCapabilityInvoke,
        PLUGIN_PERMISSIONS.musicPlatformWorkspace,
      ])
    );
    expect(Array.from(mountApiCall?.[0].permissions ?? [])).not.toContain(
      PLUGIN_PERMISSIONS.audioVisual
    );

    const frameId = testState.buildRuntimeSandboxSrcDoc.mock.calls[0]?.[0];
    expect(frameId).toBeTruthy();

    await dispatchFrameMessage(mounted.iframeWindow, {
      frameId,
      type: 'sandbox:iframe-ready',
    });

    expect(testState.buildViewMountRequestSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        surfaceId: 'netease.workspace.root',
        viewType: 'music-platform.workspace-root',
        mountMetadata: expect.objectContaining({
          connectorId: 'connector.platform.netease',
          platformId: 'netease',
          instanceId: 'netease:builtin',
          capabilityFamilies: {
            required: ['host.pmp.music-platform.workspace'],
            optional: ['host.pmp.connector-auth'],
          },
        }),
      })
    );
    expect(testState.createSandboxRuntimeSessionAdapter).toHaveBeenCalledTimes(1);
    expect(testState.sandboxAdapter.primeRuntimeHello).toHaveBeenCalledTimes(1);
    expect(testState.createRuntimeBridgeHostSession).toHaveBeenCalledTimes(1);
    expect(testState.runtimeSession.start).toHaveBeenCalledTimes(1);
    expect(testState.pluginMountApi.visualizer.getSpectrum).not.toHaveBeenCalled();
    expect(testState.pluginMountApi.visualizer.getSpectrumFrame).not.toHaveBeenCalled();

    const runtimeEventChannelCall = testState.bindHostRuntimeEventChannel.mock.calls.at(0) as
      | [
          {
            permissions: ReadonlySet<string>;
            getSpectrum?: unknown;
            getSpectrumFrame?: unknown;
          },
        ]
      | undefined;
    expect(runtimeEventChannelCall?.[0].permissions.has(PLUGIN_PERMISSIONS.audioVisual)).toBe(
      false
    );
    expect(runtimeEventChannelCall?.[0].getSpectrum).toBeUndefined();
    expect(runtimeEventChannelCall?.[0].getSpectrumFrame).toBeUndefined();

    await dispatchFrameMessage(mounted.iframeWindow, {
      frameId,
      type: 'sandbox:mounted',
    });

    expect(testState.sandboxAdapter.handleSandboxMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sandbox:mounted',
      })
    );
    expect(mounted.container.textContent).not.toContain(
      'magnet.platform.workspace.packMount.loadingTitle'
    );

    await act(async () => {
      mounted.root.unmount();
      await flushEffects();
    });

    expect(testState.runtimeSession.revokeCapabilities).toHaveBeenCalledWith(
      undefined,
      'runtime-dispose',
      expect.objectContaining({
        timeoutMs: expect.any(Number),
      })
    );
    expect(testState.runtimeSession.dispose).toHaveBeenCalledWith('runtime-dispose');
    expect(testState.runtimeEventDisposer).toHaveBeenCalledTimes(1);

    mountedRoot = null;
  });

  it('enables audio visual bridge only when the workspace declares analysis capability', async () => {
    const surface = createSurface();
    surface.workspace.capabilityFamilies = {
      required: [...(surface.workspace.capabilityFamilies?.required ?? [])],
      optional: [
        ...(surface.workspace.capabilityFamilies?.optional ?? []),
        'host.pmp.audio-engine.analysis',
      ],
    };

    const mounted = await renderMount(surface);
    mountedRoot = {
      root: mounted.root,
      container: mounted.container,
    };

    const frameId = testState.buildRuntimeSandboxSrcDoc.mock.calls[0]?.[0];
    expect(frameId).toBeTruthy();

    await dispatchFrameMessage(mounted.iframeWindow, {
      frameId,
      type: 'sandbox:iframe-ready',
    });

    const mountApiCall = testState.createPluginMountApi.mock.calls.at(0) as
      | [{ permissions: Set<string> }]
      | undefined;
    expect(Array.from(mountApiCall?.[0].permissions ?? [])).toContain(
      PLUGIN_PERMISSIONS.audioVisual
    );
    expect(testState.pluginMountApi.visualizer.getSpectrum).toHaveBeenCalledTimes(1);
    expect(testState.pluginMountApi.visualizer.getSpectrumFrame).toHaveBeenCalledTimes(2);

    const runtimeEventChannelCall = testState.bindHostRuntimeEventChannel.mock.calls.at(0) as
      | [
          {
            permissions: ReadonlySet<string>;
            getSpectrum?: unknown;
            getSpectrumFrame?: unknown;
          },
        ]
      | undefined;
    expect(runtimeEventChannelCall?.[0].permissions.has(PLUGIN_PERMISSIONS.audioVisual)).toBe(
      true
    );
    expect(typeof runtimeEventChannelCall?.[0].getSpectrum).toBe('function');
    expect(typeof runtimeEventChannelCall?.[0].getSpectrumFrame).toBe('function');

    await act(async () => {
      mounted.root.unmount();
      await flushEffects();
    });

    mountedRoot = null;
  });

  it('surfaces a diagnostic-first timeout error when the iframe never becomes ready', async () => {
    vi.useFakeTimers();
    const mounted = await renderMount();
    mountedRoot = {
      root: mounted.root,
      container: mounted.container,
    };
    const frameId = testState.buildRuntimeSandboxSrcDoc.mock.calls[0]?.[0];
    expect(frameId).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      await flushEffects();
    });

    expect(mounted.container.textContent).toContain(
      'magnet.platform.workspace.packMount.errorTitle'
    );
    expect(mounted.container.textContent).toContain('Pack workspace webview boot timeout');
    expect(testState.runtimeResources.cleanup).toHaveBeenCalledWith('runtime-crash');

    await act(async () => {
      mounted.root.unmount();
      await flushEffects();
    });

    mountedRoot = null;
  });
});
