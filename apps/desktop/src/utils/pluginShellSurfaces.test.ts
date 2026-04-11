import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  calculatePluginShellSurfacePosition,
  openPluginShellSurface,
  resolvePluginShellSurfaceDefaults,
} from './pluginShellSurfaces';

const { invokeWithTelemetryMock, getMainWindowBoundsMock } = vi.hoisted(() => ({
  invokeWithTelemetryMock: vi.fn(),
  getMainWindowBoundsMock: vi.fn(),
}));

vi.mock('../services/telemetry/TelemetryService', () => ({
  getTelemetryLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../services/telemetry/tauriInvokeTelemetry', () => ({
  invokeWithTelemetry: invokeWithTelemetryMock,
}));

vi.mock('./editorWindows', () => ({
  getMainWindowBounds: getMainWindowBoundsMock,
}));

vi.mock('./tauriRuntime', () => ({
  isTauriRuntime: () => true,
}));

describe('plugin shell surfaces', () => {
  beforeEach(() => {
    invokeWithTelemetryMock.mockReset();
    getMainWindowBoundsMock.mockReset();
    getMainWindowBoundsMock.mockResolvedValue({
      x: 100,
      y: 80,
      width: 1200,
      height: 800,
    });
    Object.defineProperty(window, 'screen', {
      configurable: true,
      value: {
        availWidth: 1920,
        availHeight: 1080,
      },
    });
  });

  it('derives unified overlay and desktop-widget defaults from pointer policy', () => {
    expect(
      resolvePluginShellSurfaceDefaults({
        surfaceType: 'overlay',
        pointerPolicy: 'capture-input',
      })
    ).toEqual({
      width: 480,
      height: 320,
      alwaysOnTop: true,
      focusable: true,
      pointerPolicy: 'capture-input',
    });

    expect(
      resolvePluginShellSurfaceDefaults({
        surfaceType: 'desktop-widget',
        pointerPolicy: 'passthrough',
      })
    ).toEqual({
      width: 320,
      height: 240,
      alwaysOnTop: false,
      focusable: false,
      pointerPolicy: 'passthrough',
    });
  });

  it('places overlays near the main window center and widgets near the bottom-right work area', async () => {
    await expect(
      calculatePluginShellSurfacePosition({
        surfaceType: 'overlay',
        width: 400,
        height: 300,
      })
    ).resolves.toEqual({
      x: 500,
      y: 330,
      width: 400,
      height: 300,
    });

    await expect(
      calculatePluginShellSurfacePosition({
        surfaceType: 'desktop-widget',
        width: 320,
        height: 240,
      })
    ).resolves.toEqual({
      x: 1576,
      y: 816,
      width: 320,
      height: 240,
    });
  });

  it('opens managed shell surfaces through the unified host contract with resolved defaults', async () => {
    invokeWithTelemetryMock.mockResolvedValue(undefined);

    await openPluginShellSurface({
      sourceKind: 'extv2',
      pluginId: 'demo-plugin',
      surfaceId: 'demo-overlay',
      surfaceType: 'overlay',
      title: 'Demo Overlay',
      pointerPolicy: 'passthrough',
      width: 360,
      height: 220,
    });

    expect(invokeWithTelemetryMock).toHaveBeenCalledWith(
      'open_plugin_shell_surface',
      {
        sourceKind: 'extv2',
        pluginId: 'demo-plugin',
        surfaceId: 'demo-overlay',
        surfaceType: 'overlay',
        title: 'Demo Overlay',
        x: 520,
        y: 370,
        width: 360,
        height: 220,
        alwaysOnTop: true,
        focusable: false,
        pointerPolicy: 'passthrough',
      },
      expect.objectContaining({
        event: 'window.plugin-shell-surface.open',
      })
    );
  });
});
