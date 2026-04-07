import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  broadcastDataUpdateMock,
  clearPmpmPluginRuntimeCacheMock,
  recordInstalledExtensionAuditEventMock,
  recordPmpmAuditEventMock,
} = vi.hoisted(() => ({
  broadcastDataUpdateMock: vi.fn(async (storageKey: string, data: unknown) => {
    localStorage.setItem(storageKey, JSON.stringify(data));
  }),
  clearPmpmPluginRuntimeCacheMock: vi.fn(),
  recordInstalledExtensionAuditEventMock: vi.fn(),
  recordPmpmAuditEventMock: vi.fn(),
}));

vi.mock('../../services/telemetry/TelemetryService', () => ({
  getTelemetryLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../utils/windowCommunication', () => ({
  STORAGE_KEYS: {
    PMPM_RUNTIME_RESTART_V1: 'test:pmpm-runtime-restart-v1',
    EXTENSIONS_V2_RUNTIME_RESTART_V1: 'test:extensions-v2-runtime-restart-v1',
  },
  broadcastDataUpdate: broadcastDataUpdateMock,
  setupStorageListener: vi.fn(() => () => {}),
}));

vi.mock('./pmpmRuntime', () => ({
  clearPmpmPluginRuntimeCache: clearPmpmPluginRuntimeCacheMock,
}));

vi.mock('./pmpmGovernance', () => ({
  recordPmpmAuditEvent: recordPmpmAuditEventMock,
}));

vi.mock('./extensionsGovernance', () => ({
  recordInstalledExtensionAuditEvent: recordInstalledExtensionAuditEventMock,
}));

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('host extension runtime supervisor', () => {
  it('routes pmpm runtime restarts through the legacy storage key and audit channel', async () => {
    const { readHostExtensionRuntimeRestartRequest, requestHostExtensionRuntimeRestart } =
      await import('./hostExtensionRuntimeSupervisor');

    requestHostExtensionRuntimeRestart('pmpm', 'demo.plugin', { reason: 'manual' });

    expect(clearPmpmPluginRuntimeCacheMock).toHaveBeenCalledWith('demo.plugin');
    expect(recordPmpmAuditEventMock).toHaveBeenCalledWith({
      type: 'runtime-restart',
      pluginId: 'demo.plugin',
      reason: 'manual',
    });
    expect(recordInstalledExtensionAuditEventMock).not.toHaveBeenCalled();
    expect(readHostExtensionRuntimeRestartRequest('pmpm')).toMatchObject({
      kind: 'pmpm',
      pluginId: 'demo.plugin',
      reason: 'manual',
    });
  });

  it('routes manifest-v2 runtime restarts through the native storage key and audit channel', async () => {
    const { readHostExtensionRuntimeRestartRequest, requestHostExtensionRuntimeRestart } =
      await import('./hostExtensionRuntimeSupervisor');

    requestHostExtensionRuntimeRestart('extv2', 'native.demo', { reason: 'capabilities-updated' });

    expect(clearPmpmPluginRuntimeCacheMock).not.toHaveBeenCalled();
    expect(recordInstalledExtensionAuditEventMock).toHaveBeenCalledWith({
      type: 'runtime-restart',
      pluginId: 'native.demo',
      reason: 'capabilities-updated',
    });
    expect(recordPmpmAuditEventMock).not.toHaveBeenCalled();
    expect(readHostExtensionRuntimeRestartRequest('extv2')).toMatchObject({
      kind: 'extv2',
      pluginId: 'native.demo',
      reason: 'capabilities-updated',
    });
  });
});
