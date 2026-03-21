import { describe, expect, it } from 'vitest';
import { parseMagnetShaderConfig } from '../magnetShaderConfig';

describe('parseMagnetShaderConfig', () => {
  it('returns null when skinProps is not an object', () => {
    expect(parseMagnetShaderConfig(null)).toBeNull();
    expect(parseMagnetShaderConfig('shader-demo')).toBeNull();
  });

  it('parses shorthand string form', () => {
    expect(parseMagnetShaderConfig({ shader: 'shader-demo' })).toEqual({
      shaderId: 'shader-demo',
      enabled: true,
    });
  });

  it('parses object form with render overrides', () => {
    expect(
      parseMagnetShaderConfig({
        shader: { shaderId: 'shader-demo', entryPoint: 'shadertoy', fpsLimit: 30, resolutionScale: 0.5 },
      })
    ).toEqual({
      shaderId: 'shader-demo',
      enabled: true,
      entryPoint: 'shadertoy',
      fpsLimit: 30,
      resolutionScale: 0.5,
    });
  });

  it('supports top-level shaderPackId shortcut', () => {
    expect(parseMagnetShaderConfig({ shaderPackId: 'shader-demo' })).toEqual({
      shaderId: 'shader-demo',
      enabled: true,
      entryPoint: undefined,
      fpsLimit: undefined,
      resolutionScale: undefined,
    });
  });

  it('treats enabled=false as disabled (returns enabled=false)', () => {
    expect(parseMagnetShaderConfig({ shader: { shaderId: 'shader-demo', enabled: false } })).toEqual({
      shaderId: 'shader-demo',
      enabled: false,
    });
  });
});
