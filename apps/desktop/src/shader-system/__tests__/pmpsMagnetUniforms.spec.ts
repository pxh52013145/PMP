import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import type { PmpsManifest } from '../pmps';
import {
  getPmpsMagnetUniformOverrides,
  getPmpsUniformDefaultValues,
  removePmpsMagnetUniformOverrides,
  resolvePmpsUniformValues,
  setPmpsMagnetUniformValue,
} from '../pmpsMagnetUniforms';

beforeEach(() => {
  localStorage.clear();
});

describe('pmps magnet uniforms', () => {
  const manifest: PmpsManifest = {
    formatVersion: '2.0',
    type: 'shader-pack',
    metadata: { id: 'shader-demo', name: 'Demo', version: '1.0.0' },
    entry: { fragment: 'fragment.glsl', entryPoint: 'auto' },
    uniforms: [
      { name: 'uGain', type: 'float', default: 0.5, min: 0, max: 1 },
      { name: 'uSteps', type: 'int', default: 4, min: 1, max: 8 },
      { name: 'uEnabled', type: 'bool', default: true },
      { name: 'uOffset', type: 'vec2', default: [0, 0] },
      { name: 'uTint', type: 'color', default: '#ff00ff80' },
    ],
  };

  it('builds defaults from manifest', () => {
    const defaults = getPmpsUniformDefaultValues(manifest);
    expect(defaults.uGain).toBe(0.5);
    expect(defaults.uSteps).toBe(4);
    expect(defaults.uEnabled).toBe(true);
    expect(defaults.uOffset).toEqual([0, 0]);
    expect(defaults.uTint).toBe('#ff00ff80');
  });

  it('resolves values and clamps coercible types', () => {
    const resolved = resolvePmpsUniformValues(manifest, {
      uGain: 999,
      uSteps: 9,
      uEnabled: 0,
      uOffset: [1, 2],
      uTint: [1, 0, 0, 0.25],
      extra: 1,
    });

    expect(resolved.uGain).toBe(1);
    expect(resolved.uSteps).toBe(8);
    expect(resolved.uEnabled).toBe(false);
    expect(resolved.uOffset).toEqual([1, 2]);
    expect(resolved.uTint).toBe('#ff000040');
    expect(resolved.extra).toBe(1);
  });

  it('stores per magnetId and shaderId', () => {
    expect(getPmpsMagnetUniformOverrides('track-info', 'shader-demo')).toEqual({});
    setPmpsMagnetUniformValue('track-info', 'shader-demo', 'uGain', 0.9);
    expect(getPmpsMagnetUniformOverrides('track-info', 'shader-demo')).toEqual({ uGain: 0.9 });

    removePmpsMagnetUniformOverrides('track-info', 'shader-demo');
    expect(getPmpsMagnetUniformOverrides('track-info', 'shader-demo')).toEqual({});
  });
});

