import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTauriPmpmBridgeSidecarPortController } from './tauriSidecarPortController';

const { listenMock, invokeWithTelemetryMock } = vi.hoisted(() => ({
  listenMock: vi.fn(),
  invokeWithTelemetryMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

vi.mock('../../../services/telemetry/tauriInvokeTelemetry', () => ({
  invokeWithTelemetry: invokeWithTelemetryMock,
}));

describe('createTauriPmpmBridgeSidecarPortController', () => {
  beforeEach(() => {
    (window as typeof window & {
      __TAURI__?: { convertFileSrc: (src: string, protocol: string) => string };
    }).__TAURI__ = {
      convertFileSrc: (src, _protocol) => src,
    };
    listenMock.mockReset();
    invokeWithTelemetryMock.mockReset();
  });

  afterEach(() => {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, '__TAURI__');
  });

  it('buffers sidecar messages that arrive before open resolves and flushes them to listeners', async () => {
    let runtimeListener: ((event: { payload: unknown }) => void) | null = null;
    const unlisten = vi.fn();

    listenMock.mockImplementation(async (_eventName: string, listener: typeof runtimeListener) => {
      runtimeListener = listener;
      return unlisten;
    });

    invokeWithTelemetryMock.mockImplementation(async (command: string) => {
      if (command === 'plugin_sidecar_bridge_open') {
        runtimeListener?.({
          payload: {
            sessionId: 'sidecar-session-1',
            runtimeInstanceId: 'runtime-instance-1',
            message: {
              bridgeVersion: '1.0',
              op: 'runtime.hello',
              pluginId: 'sidecar-plugin',
              runtimeId: 'sidecar.main',
              runtimeInstanceId: 'runtime-instance-1',
              supportedBridgeVersions: ['1.0'],
              runtimeKind: 'sidecar',
              carrier: 'native-process',
              supportsViewMount: false,
            },
          },
        });

        return {
          sessionId: 'sidecar-session-1',
        };
      }

      if (command === 'plugin_sidecar_bridge_close') {
        return undefined;
      }

      throw new Error(`Unexpected invoke command: ${command}`);
    });

    const controller = await createTauriPmpmBridgeSidecarPortController({
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId: 'runtime-instance-1',
      entryPath: 'C:/demo/sidecar.js',
      commandId: 'sidecar-plugin.run',
      timeoutMs: 2_000,
    });

    const received: unknown[] = [];
    controller.port.onMessage((message) => {
      received.push(message);
    });

    expect(received).toEqual([
      expect.objectContaining({
        op: 'runtime.hello',
        runtimeInstanceId: 'runtime-instance-1',
      }),
    ]);

    await controller.dispose('test-finished');
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('sends bridge messages through the Tauri invoke bridge and disposes the session best-effort', async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    invokeWithTelemetryMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'plugin_sidecar_bridge_open') {
        return { sessionId: 'sidecar-session-2' };
      }

      if (command === 'plugin_sidecar_bridge_send') {
        expect(args).toEqual({
          sessionId: 'sidecar-session-2',
          message: {
            bridgeVersion: '1.0',
            op: 'runtime.init',
            pluginId: 'sidecar-plugin',
            runtimeId: 'sidecar.main',
            runtimeInstanceId: 'runtime-instance-2',
            hostId: 'pmp',
            trustLevel: 'sandboxed',
            grantedCapabilities: [],
          },
        });
        return undefined;
      }

      if (command === 'plugin_sidecar_bridge_close') {
        expect(args).toEqual({
          sessionId: 'sidecar-session-2',
          reason: 'runtime-command-finished',
        });
        return undefined;
      }

      throw new Error(`Unexpected invoke command: ${command}`);
    });

    const controller = await createTauriPmpmBridgeSidecarPortController({
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId: 'runtime-instance-2',
      entryPath: 'C:/demo/sidecar.js',
      commandId: 'sidecar-plugin.run',
      timeoutMs: 2_000,
    });

    await controller.port.postMessage({
      bridgeVersion: '1.0',
      op: 'runtime.init',
      pluginId: 'sidecar-plugin',
      runtimeId: 'sidecar.main',
      runtimeInstanceId: 'runtime-instance-2',
      hostId: 'pmp',
      trustLevel: 'sandboxed',
      grantedCapabilities: [],
    });

    await controller.dispose();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
