import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closePluginWindow, openPluginWindow } from './pluginWindows';

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

describe('plugin windows', () => {
  beforeEach(() => {
    invokeWithTelemetryMock.mockReset();
    invokeWithTelemetryMock.mockResolvedValue(undefined);
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

  it('defaults plugin window helper calls to extv2 when sourceKind is omitted', async () => {
    await openPluginWindow({
      pluginId: 'demo-plugin',
      windowId: 'demo-window',
      title: 'Demo Window',
      width: 640,
      height: 480,
    });
    await closePluginWindow('demo-plugin', 'demo-window');

    expect(invokeWithTelemetryMock).toHaveBeenNthCalledWith(
      1,
      'open_plugin_window',
      expect.objectContaining({
        sourceKind: 'extv2',
        pluginId: 'demo-plugin',
        windowId: 'demo-window',
        title: 'Demo Window',
      }),
      expect.any(Object)
    );
    expect(invokeWithTelemetryMock).toHaveBeenNthCalledWith(
      2,
      'close_plugin_window',
      expect.objectContaining({
        sourceKind: 'extv2',
        pluginId: 'demo-plugin',
        windowId: 'demo-window',
      }),
      expect.any(Object)
    );
  });
});
