import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TelemetryLogger, TelemetryService, TelemetrySpan } from '../telemetryTypes';
import {
  attachTauriInvokeTelemetry,
  detachTauriInvokeTelemetryForTests,
  invokeWithTelemetry,
} from '../tauriInvokeTelemetry';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: (command: string, args?: Record<string, unknown>) => invokeMock(command, args),
}));

vi.mock('../../../utils/tauriRuntime', () => ({
  isTauriRuntime: () => true,
}));

function createServiceStub() {
  const end = vi.fn();
  const span: TelemetrySpan = { end };
  const startSpan = vi.fn(() => span);
  const logger: TelemetryLogger = {
    log: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    metric: vi.fn(),
    startSpan,
  };
  const getLogger = vi.fn(() => logger);
  const service: TelemetryService = {
    getSnapshot: vi.fn(() => {
      throw new Error('unused');
    }),
    subscribe: vi.fn(() => () => {}),
    refreshRuntime: vi.fn(async () => {
      throw new Error('unused');
    }),
    clearSession: vi.fn(async () => {}),
    flushNow: vi.fn(async () => {}),
    getLogger,
    ingest: vi.fn(),
    destroy: vi.fn(),
  };
  return { service, getLogger, startSpan, end };
}

describe('invokeWithTelemetry', () => {
  afterEach(() => {
    detachTauriInvokeTelemetryForTests();
    invokeMock.mockReset();
  });

  it('records a slow successful invoke through the attached telemetry service', async () => {
    const { service, getLogger, startSpan, end } = createServiceStub();
    invokeMock.mockResolvedValue({ ok: true });
    attachTauriInvokeTelemetry(service);

    const result = await invokeWithTelemetry<{ ok: boolean }>(
      'debug_get_config',
      undefined,
      {
        moduleId: 'debug',
        component: 'unit-test',
        event: 'debug.config.get',
        slowThresholdMs: 0,
        includeResultSize: true,
      }
    );

    expect(result).toEqual({ ok: true });
    expect(getLogger).toHaveBeenCalledWith('debug', 'unit-test');
    expect(startSpan).toHaveBeenCalledWith(
      'debug.config.get',
      expect.objectContaining({
        level: 'debug',
        fields: expect.objectContaining({
          command: 'debug_get_config',
        }),
      })
    );
    expect(end).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        fields: expect.objectContaining({
          command: 'debug_get_config',
          status: 'ok',
        }),
      })
    );
  });

  it('records invoke failures as error span endings and rethrows', async () => {
    const { service, end } = createServiceStub();
    invokeMock.mockRejectedValue(new Error('boom'));
    attachTauriInvokeTelemetry(service);

    await expect(
      invokeWithTelemetry('app_request_exit', undefined, {
        moduleId: 'windowing',
        component: 'windowClose',
        event: 'window.main.request-exit',
      })
    ).rejects.toThrow('boom');

    expect(end).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        message: 'boom',
        fields: expect.objectContaining({
          command: 'app_request_exit',
          status: 'error',
          errorMessage: 'boom',
        }),
      })
    );
  });

  it('bypasses telemetry for telemetry transport commands to avoid recursion', async () => {
    const { service, getLogger } = createServiceStub();
    invokeMock.mockResolvedValue({ acceptedCount: 1 });
    attachTauriInvokeTelemetry(service);

    await invokeWithTelemetry('debug_telemetry_ingest_batch', { records: [] });

    expect(getLogger).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith('debug_telemetry_ingest_batch', { records: [] });
  });
});
