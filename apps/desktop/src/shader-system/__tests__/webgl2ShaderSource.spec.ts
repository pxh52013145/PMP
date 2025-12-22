import { describe, expect, it } from 'vitest';
import { buildWebgl2ShaderSources, resolvePmpsEntryPoint } from '../webgl2ShaderSource';

describe('webgl2ShaderSource', () => {
  it('resolves entry point to shadertoy when only mainImage exists', () => {
    const code = `
      void mainImage(out vec4 fragColor, in vec2 fragCoord) {
        fragColor = vec4(1.0);
      }
    `;
    expect(resolvePmpsEntryPoint(code, 'auto')).toBe('shadertoy');
  });

  it('resolves entry point to main when main exists', () => {
    const code = `
      void mainImage(out vec4 fragColor, in vec2 fragCoord) {
        fragColor = vec4(1.0);
      }
      void main() {
        gl_FragColor = vec4(0.0);
      }
    `;
    expect(resolvePmpsEntryPoint(code, 'auto')).toBe('main');
  });

  it('wraps shadertoy shader with main() and injects uniforms', () => {
    const code = `
      void mainImage(out vec4 fragColor, in vec2 fragCoord) {
        fragColor = vec4(fragCoord.xy / iResolution.xy, 0.0, 1.0);
      }
    `;
    const sources = buildWebgl2ShaderSources({ fragmentCode: code, entryPoint: 'shadertoy' });
    expect(sources.fragmentSource).toMatch(/#version 300 es/);
    expect(sources.fragmentSource).toMatch(/uniform vec3 iResolution;/);
    expect(sources.fragmentSource).toMatch(/void main\(\) \{/);
    expect(sources.fragmentSource).toMatch(/mainImage\(color, gl_FragCoord\.xy\)/);
  });

  it('does not add wrapper main() for main-entry shaders', () => {
    const code = `
      precision mediump float;
      void main() {
        gl_FragColor = vec4(1.0);
      }
    `;
    const sources = buildWebgl2ShaderSources({ fragmentCode: code, entryPoint: 'main' });
    const matches = sources.fragmentSource.match(/\bvoid\s+main\s*\(/g);
    expect(matches?.length ?? 0).toBe(1);
    expect(sources.fragmentSource).toMatch(/#define gl_FragColor pmpFragColor/);
  });
});

