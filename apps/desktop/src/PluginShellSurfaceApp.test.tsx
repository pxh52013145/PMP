import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  appWindowMocks,
  buildPluginShellSurfaceEventPayloadMock,
  dismissPluginShellSurfaceMock,
  isTauriRuntimeMock,
  readPluginShellSurfaceDescriptorMock,
  resolvedPluginShellSurfaceHostMock,
  setupTauriListenerWithPayloadMock,
  windowActivityProviderMock,
} = vi.hoisted(() => ({
  appWindowMocks: {
    isFocused: vi.fn(async () => true),
    onFocusChanged: vi.fn(async () => () => {}),
    isMinimized: vi.fn(async () => false),
    onResized: vi.fn(async () => () => {}),
    isVisible: vi.fn(async () => true),
  },
  buildPluginShellSurfaceEventPayloadMock: vi.fn(
    (
      sourceKind: 'pmpm' | 'extv2',
      surfaceType: 'overlay' | 'desktop-widget',
      pluginId: string,
      surfaceId: string
    ) => `${sourceKind}/${surfaceType}/${pluginId}/${surfaceId}`
  ),
  dismissPluginShellSurfaceMock: vi.fn(async () => undefined),
  isTauriRuntimeMock: vi.fn(() => false),
  readPluginShellSurfaceDescriptorMock: vi.fn(),
  resolvedPluginShellSurfaceHostMock: vi.fn(),
  setupTauriListenerWithPayloadMock: vi.fn(async () => () => {}),
  windowActivityProviderMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  appWindow: appWindowMocks,
}));

vi.mock('./contexts/NavigationContext', () => ({
  NavigationProvider: ({ children }: { children?: ReactNode }) => children ?? null,
}));

vi.mock('./contexts/AudioEngineContext', () => ({
  AudioEngineProvider: ({ children }: { children?: ReactNode }) => children ?? null,
}));

vi.mock('./themes/contexts/ThemeContextWithSync', () => ({
  ThemeProvider: ({ children }: { children?: ReactNode }) => children ?? null,
}));

vi.mock('./contexts/WindowActivityContext', () => ({
  WindowActivityProvider: ({
    children,
    value,
  }: {
    children?: ReactNode;
    value: unknown;
  }) => {
    windowActivityProviderMock(value);
    return children ?? null;
  },
}));

vi.mock('./contexts/QualityContext', () => ({
  QualityProvider: ({ children }: { children?: ReactNode }) => children ?? null,
}));

vi.mock('./contexts/useAdaptiveRenderMode', () => ({
  useAdaptiveRenderMode: () => 'full',
}));

vi.mock('./contexts/usePerformanceControlSettings', () => ({
  usePerformanceControlSettings: () => ({
    settings: {
      backgroundRenderPolicy: 'full',
    },
  }),
}));

vi.mock('./services/telemetry/TelemetryService', () => ({
  getTelemetryLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('./utils/tauriRuntime', () => ({
  isTauriRuntime: isTauriRuntimeMock,
}));

vi.mock('./utils/windowCommunication', () => ({
  TAURI_EVENTS: {
    PLUGIN_SHELL_SURFACE_HIDDEN: 'plugin-shell-surface-hidden',
    PLUGIN_SHELL_SURFACE_SHOWN: 'plugin-shell-surface-shown',
  },
  setupTauriListenerWithPayload: setupTauriListenerWithPayloadMock,
}));

vi.mock('./magnet-system/plugins/ResolvedPluginHosts', () => ({
  ResolvedPluginShellSurfaceHost: (props: unknown) => {
    resolvedPluginShellSurfaceHostMock(props);
    return null;
  },
}));

vi.mock('./magnet-system/plugins/extensions', () => ({
  getInstalledExtensionsRevision: () => 0,
  subscribeInstalledExtensions: () => () => {},
}));

vi.mock('./magnet-system/plugins/shellSurfaceDescriptors', () => ({
  readPluginShellSurfaceDescriptor: readPluginShellSurfaceDescriptorMock,
}));

vi.mock('./utils/pluginShellSurfaces', () => ({
  buildPluginShellSurfaceEventPayload: buildPluginShellSurfaceEventPayloadMock,
  dismissPluginShellSurface: dismissPluginShellSurfaceMock,
}));

function createPresentLookup(
  overrides: Partial<{
    sourceKind: 'pmpm' | 'extv2';
    pluginId: string;
    pluginName: string;
    enabled: boolean;
    descriptor: Record<string, unknown>;
  }> = {}
) {
  return {
    status: 'present' as const,
    record: {
      sourceKind: overrides.sourceKind ?? 'extv2',
      pluginId: overrides.pluginId ?? 'demo-plugin',
      pluginName: overrides.pluginName ?? 'Demo Plugin',
      enabled: overrides.enabled ?? true,
      descriptor: {
        kind: 'shell-surface',
        id: 'demo-overlay',
        title: 'Demo Overlay',
        surfaceType: 'overlay',
        width: 360,
        height: 220,
        pointerPolicy: 'capture-input',
        ...overrides.descriptor,
      },
    },
  };
}

async function flushEffects() {
  await Promise.resolve();
  await Promise.resolve();
}

async function renderPluginShellSurfaceApp(hash: string): Promise<{
  container: HTMLDivElement;
  cleanup: () => Promise<void>;
}> {
  window.location.hash = hash;
  const { PluginShellSurfaceApp } = await import('./PluginShellSurfaceApp');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<PluginShellSurfaceApp />);
  });

  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function pressEscape(): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });

  await act(async () => {
    window.dispatchEvent(event);
    await flushEffects();
  });

  return event;
}

let mountedRoot: { cleanup: () => Promise<void> } | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  dismissPluginShellSurfaceMock.mockReset();
  dismissPluginShellSurfaceMock.mockResolvedValue(undefined);
  buildPluginShellSurfaceEventPayloadMock.mockClear();
  isTauriRuntimeMock.mockReset();
  isTauriRuntimeMock.mockReturnValue(false);
  readPluginShellSurfaceDescriptorMock.mockReset();
  resolvedPluginShellSurfaceHostMock.mockReset();
  setupTauriListenerWithPayloadMock.mockReset();
  setupTauriListenerWithPayloadMock.mockResolvedValue(() => {});
  windowActivityProviderMock.mockReset();
  appWindowMocks.isFocused.mockReset();
  appWindowMocks.isFocused.mockResolvedValue(true);
  appWindowMocks.onFocusChanged.mockReset();
  appWindowMocks.onFocusChanged.mockResolvedValue(() => {});
  appWindowMocks.isMinimized.mockReset();
  appWindowMocks.isMinimized.mockResolvedValue(false);
  appWindowMocks.onResized.mockReset();
  appWindowMocks.onResized.mockResolvedValue(() => {});
  appWindowMocks.isVisible.mockReset();
  appWindowMocks.isVisible.mockResolvedValue(true);
  Object.defineProperty(document, 'hasFocus', {
    configurable: true,
    value: () => true,
  });
  window.location.hash = '';
});

afterEach(async () => {
  vi.useRealTimers();
  if (mountedRoot) {
    await mountedRoot.cleanup();
    mountedRoot = null;
  }
  document.body.innerHTML = '';
  window.location.hash = '';
});

describe('PluginShellSurfaceApp', () => {
  it('dismisses overlay shell surfaces on Escape by default', async () => {
    readPluginShellSurfaceDescriptorMock.mockReturnValue(createPresentLookup());

    mountedRoot = await renderPluginShellSurfaceApp(
      '#/plugin-shell-surface/extv2/overlay/demo-plugin/demo-overlay'
    );

    expect(
      document.querySelector('[data-surface-type="overlay"]')
    ).not.toBeNull();
    expect(resolvedPluginShellSurfaceHostMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: 'demo-plugin',
        surfaceId: 'demo-overlay',
        surfaceType: 'overlay',
      })
    );
    expect(readPluginShellSurfaceDescriptorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKind: 'extv2',
        pluginId: 'demo-plugin',
        surfaceId: 'demo-overlay',
        surfaceType: 'overlay',
      })
    );

    const event = await pressEscape();

    expect(event.defaultPrevented).toBe(true);
    expect(dismissPluginShellSurfaceMock).toHaveBeenCalledWith(
      'demo-plugin',
      'demo-overlay',
      'overlay',
      'extv2'
    );
  });

  it('keeps legacy pmpm window events while resolving descriptors from extv2 records', async () => {
    readPluginShellSurfaceDescriptorMock.mockReturnValue(createPresentLookup());

    mountedRoot = await renderPluginShellSurfaceApp(
      '#/plugin-shell-surface/pmpm/overlay/demo-plugin/demo-overlay'
    );

    expect(buildPluginShellSurfaceEventPayloadMock).toHaveBeenCalledWith(
      'pmpm',
      'overlay',
      'demo-plugin',
      'demo-overlay'
    );
    expect(readPluginShellSurfaceDescriptorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKind: 'extv2',
        pluginId: 'demo-plugin',
        surfaceId: 'demo-overlay',
        surfaceType: 'overlay',
      })
    );

    const event = await pressEscape();

    expect(event.defaultPrevented).toBe(true);
    expect(dismissPluginShellSurfaceMock).toHaveBeenCalledWith(
      'demo-plugin',
      'demo-overlay',
      'overlay',
      'pmpm'
    );
  });

  it('lets the descriptor opt out of Escape dismissal', async () => {
    readPluginShellSurfaceDescriptorMock.mockReturnValue(
      createPresentLookup({
        descriptor: {
          dismissOnEscape: false,
        },
      })
    );

    mountedRoot = await renderPluginShellSurfaceApp(
      '#/plugin-shell-surface/extv2/overlay/demo-plugin/demo-overlay'
    );

    const event = await pressEscape();

    expect(event.defaultPrevented).toBe(false);
    expect(dismissPluginShellSurfaceMock).not.toHaveBeenCalled();
  });

  it('reacts to matching tauri hidden/shown events for shell-surface window visibility', async () => {
    const listeners = new Map<string, (payload: string) => void>();
    isTauriRuntimeMock.mockReturnValue(true);
    setupTauriListenerWithPayloadMock.mockImplementation(
      (async (eventName: string, listener: (payload: string) => void) => {
        listeners.set(eventName, listener);
        return () => {
          listeners.delete(eventName);
        };
      }) as never
    );
    readPluginShellSurfaceDescriptorMock.mockReturnValue(createPresentLookup());

    mountedRoot = await renderPluginShellSurfaceApp(
      '#/plugin-shell-surface/extv2/overlay/demo-plugin/demo-overlay'
    );

    expect(setupTauriListenerWithPayloadMock).toHaveBeenCalledTimes(2);
    expect(windowActivityProviderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isVisible: true,
        isActive: true,
        renderMode: 'full',
      })
    );

    await act(async () => {
      listeners.get('plugin-shell-surface-hidden')?.(
        'extv2/overlay/demo-plugin/demo-overlay'
      );
      await flushEffects();
    });

    expect(windowActivityProviderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isVisible: false,
        isActive: false,
        renderMode: 'full',
      })
    );

    await act(async () => {
      listeners.get('plugin-shell-surface-shown')?.(
        'extv2/overlay/demo-plugin/demo-overlay'
      );
      await flushEffects();
    });

    expect(windowActivityProviderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isVisible: true,
        isActive: true,
        renderMode: 'full',
      })
    );
  });

  it('drops activity while the page is frozen and restores it on resume', async () => {
    readPluginShellSurfaceDescriptorMock.mockReturnValue(createPresentLookup());

    mountedRoot = await renderPluginShellSurfaceApp(
      '#/plugin-shell-surface/extv2/overlay/demo-plugin/demo-overlay'
    );

    expect(windowActivityProviderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isActive: true,
      })
    );

    await act(async () => {
      document.dispatchEvent(new Event('freeze'));
      await flushEffects();
    });

    expect(windowActivityProviderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isActive: false,
      })
    );

    await act(async () => {
      document.dispatchEvent(new Event('resume'));
      await flushEffects();
    });

    expect(windowActivityProviderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isActive: true,
      })
    );
  });

  it('debounces blur before marking the shell-surface window inactive', async () => {
    vi.useFakeTimers();
    readPluginShellSurfaceDescriptorMock.mockReturnValue(createPresentLookup());

    mountedRoot = await renderPluginShellSurfaceApp(
      '#/plugin-shell-surface/extv2/overlay/demo-plugin/demo-overlay'
    );

    await act(async () => {
      window.dispatchEvent(new Event('blur'));
      await flushEffects();
    });

    expect(windowActivityProviderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isActive: true,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(161);
      await flushEffects();
    });

    expect(windowActivityProviderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isActive: false,
      })
    );
  });

  it('marks the shell-surface inactive when tauri reports the window as minimized', async () => {
    let resizedListener: (() => void) | null = null;
    isTauriRuntimeMock.mockReturnValue(true);
    appWindowMocks.onResized.mockImplementation(
      (async (listener: () => void) => {
        resizedListener = listener;
        return () => {
          resizedListener = null;
        };
      }) as never
    );
    appWindowMocks.isMinimized
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    readPluginShellSurfaceDescriptorMock.mockReturnValue(createPresentLookup());

    mountedRoot = await renderPluginShellSurfaceApp(
      '#/plugin-shell-surface/extv2/overlay/demo-plugin/demo-overlay'
    );
    await act(async () => {
      await flushEffects();
    });

    expect(windowActivityProviderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isActive: true,
      })
    );

    await act(async () => {
      resizedListener?.();
      await flushEffects();
    });

    expect(windowActivityProviderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isActive: false,
      })
    );
  });
});
