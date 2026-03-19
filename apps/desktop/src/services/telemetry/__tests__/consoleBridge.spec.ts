import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelemetryService } from '../telemetryTypes';
import {
  attachConsoleBridge,
  installConsoleBridge,
  restoreConsoleBridgeForTests,
} from '../consoleBridge';

function createTelemetryServiceStub() {
  const ingest = vi.fn();
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
    getLogger: vi.fn(() => {
      throw new Error('unused');
    }),
    ingest,
    destroy: vi.fn(),
  };
  return { service, ingest };
}

describe('consoleBridge', () => {
  const restoreSpies: Array<() => void> = [];

  beforeEach(() => {
    restoreConsoleBridgeForTests();
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      const spy = vi.spyOn(console, method).mockImplementation(() => {});
      restoreSpies.push(() => spy.mockRestore());
    }
  });

  afterEach(() => {
    while (restoreSpies.length > 0) {
      restoreSpies.pop()?.();
    }
    restoreConsoleBridgeForTests();
  });

  it('buffers console entries before attachment and flushes them into telemetry', () => {
    const { service, ingest } = createTelemetryServiceStub();

    installConsoleBridge();
    console.warn('[MusicLibrary] Failed to probe cover', new Error('end of stream'));
    attachConsoleBridge(service);

    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith(
      'music-library',
      expect.objectContaining({
        event: 'console.warn',
        level: 'warn',
        component: 'MusicLibrary',
        message: expect.stringContaining('Failed to probe cover'),
      }),
      'MusicLibrary'
    );
  });

  it('normalizes console.log into debug telemetry under the console module when no prefix exists', () => {
    const { service, ingest } = createTelemetryServiceStub();

    attachConsoleBridge(service);
    console.log('plain log message', { foo: 'bar' });

    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith(
      'console',
      expect.objectContaining({
        event: 'console.log',
        level: 'debug',
        component: null,
        message: expect.stringContaining('plain log message'),
      }),
      null
    );
  });
});
