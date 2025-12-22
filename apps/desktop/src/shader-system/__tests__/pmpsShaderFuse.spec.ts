import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import {
  clearPmpsShaderFuse,
  getPmpsShaderFuseRecord,
  isPmpsShaderFused,
  recordPmpsShaderError,
} from '../pmpsShaderFuse';
import type { ShaderRuntimeError } from '../webgl2Runtime';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pmps shader fuse', () => {
  it('fuses after repeated runtime errors within a window', () => {
    const magnetId = 'audio-visualizer';
    const shaderId = 'shader-demo';
    const error: ShaderRuntimeError = { shaderId, stage: 'runtime', message: 'boom' };

    recordPmpsShaderError(magnetId, shaderId, error);
    recordPmpsShaderError(magnetId, shaderId, error);
    expect(isPmpsShaderFused(magnetId, shaderId)).toBe(false);

    recordPmpsShaderError(magnetId, shaderId, error);
    expect(isPmpsShaderFused(magnetId, shaderId)).toBe(true);

    const record = getPmpsShaderFuseRecord(magnetId, shaderId);
    expect(record?.errorCount).toBeGreaterThanOrEqual(3);
    expect(record?.disabledUntil).toBeDefined();
  });

  it('fuses immediately on compile/link errors', () => {
    const magnetId = 'audio-visualizer';
    const shaderId = 'shader-demo';
    const error: ShaderRuntimeError = { shaderId, stage: 'compile', message: 'syntax' };

    recordPmpsShaderError(magnetId, shaderId, error);
    expect(isPmpsShaderFused(magnetId, shaderId)).toBe(true);
  });

  it('clears fuse record', () => {
    const magnetId = 'audio-visualizer';
    const shaderId = 'shader-demo';
    const error: ShaderRuntimeError = { shaderId, stage: 'compile', message: 'syntax' };

    recordPmpsShaderError(magnetId, shaderId, error);
    expect(getPmpsShaderFuseRecord(magnetId, shaderId)).not.toBeNull();

    clearPmpsShaderFuse(magnetId, shaderId);
    expect(getPmpsShaderFuseRecord(magnetId, shaderId)).toBeNull();
  });
});
