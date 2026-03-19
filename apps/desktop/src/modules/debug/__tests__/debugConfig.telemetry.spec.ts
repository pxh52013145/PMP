import { describe, expect, it } from 'vitest';
import { ensureDebugConfig, getDefaultDebugConfig } from '../debugConfig';

describe('debugConfig telemetry integration', () => {
  it('backfills telemetry policy defaults for legacy config payloads', () => {
    const config = ensureDebugConfig({
      version: 1,
      enabled: true,
      vstBridge: {
        stderr: true,
      },
    });

    expect(config.telemetry.enabled).toBe(true);
    expect(config.telemetry.batchFlushMs).toBe(250);
    expect(config.telemetry.batchMaxItems).toBe(64);
    expect(config.telemetry.persistMinLevel).toBe('warn');
    expect(config.telemetry.modules).toEqual({});
  });

  it('returns cloned default telemetry policy objects', () => {
    const left = getDefaultDebugConfig();
    const right = getDefaultDebugConfig();

    left.telemetry.modules.alpha = { enabled: false };
    expect(right.telemetry.modules.alpha).toBeUndefined();
  });
});
