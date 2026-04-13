import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  broadcastDataUpdateMock,
  recordInstalledExtensionAuditEventMock,
  telemetryLoggerMock,
} = vi.hoisted(() => ({
  broadcastDataUpdateMock: vi.fn(async (storageKey: string, data: unknown) => {
    localStorage.setItem(storageKey, JSON.stringify(data));
  }),
  recordInstalledExtensionAuditEventMock: vi.fn(),
  telemetryLoggerMock: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../services/telemetry/TelemetryService', () => ({
  getTelemetryLogger: () => telemetryLoggerMock,
}));

vi.mock('../../utils/windowCommunication', () => ({
  STORAGE_KEYS: {
    EXTENSIONS_V2_RUNTIME_RESTART_V1: 'test:extensions-v2-runtime-restart-v1',
  },
  broadcastDataUpdate: broadcastDataUpdateMock,
  setupStorageListener: vi.fn(() => () => {}),
}));

vi.mock('./extensionsGovernance', () => ({
  recordInstalledExtensionAuditEvent: recordInstalledExtensionAuditEventMock,
}));

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('host extension runtime supervisor', () => {
  it('routes extv2 runtime restarts through the native storage key and audit channel', async () => {
    const { readHostExtensionRuntimeRestartRequest, requestHostExtensionRuntimeRestart } =
      await import('./hostExtensionRuntimeSupervisor');

    requestHostExtensionRuntimeRestart('native.demo', { reason: 'capabilities-updated' });

    expect(recordInstalledExtensionAuditEventMock).toHaveBeenCalledWith({
      type: 'runtime-restart',
      pluginId: 'native.demo',
      reason: 'capabilities-updated',
    });
    expect(telemetryLoggerMock.info).toHaveBeenCalledWith(
      'plugin.governance.runtime-restart.requested',
      expect.objectContaining({
        fields: expect.objectContaining({
          kind: 'extv2',
          pluginId: 'native.demo',
          reason: 'capabilities-updated',
        }),
      })
    );
    expect(readHostExtensionRuntimeRestartRequest()).toMatchObject({
      kind: 'extv2',
      pluginId: 'native.demo',
      reason: 'capabilities-updated',
    });
  });
});
