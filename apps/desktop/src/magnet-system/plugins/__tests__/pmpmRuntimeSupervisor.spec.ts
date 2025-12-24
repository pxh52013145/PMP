import { beforeEach, describe, expect, it } from 'vitest';
import { readPmpmAuditLog } from '../pmpmGovernance';
import {
  readPmpmRuntimeRestartRequest,
  requestPmpmPluginRuntimeRestart,
} from '../pmpmRuntimeSupervisor';

beforeEach(() => {
  localStorage.clear();
});

describe('pmpmRuntimeSupervisor', () => {
  it('records restart requests and audits', () => {
    requestPmpmPluginRuntimeRestart('demo', { reason: 'manual' });

    const request = readPmpmRuntimeRestartRequest();
    expect(request?.pluginId).toBe('demo');
    expect(request?.reason).toBe('manual');
    expect(typeof request?.at).toBe('number');

    const audit = readPmpmAuditLog();
    expect(audit.some((e) => e.type === 'runtime-restart' && e.pluginId === 'demo')).toBe(true);
  });
});

