import type { PmpsEntryPoint } from './pmps';

export type ResolvedPmpsEntryPoint = 'main' | 'shadertoy';

function hasMainFunction(source: string): boolean {
  return /\bvoid\s+main\s*\(/.test(source);
}

function hasMainImageFunction(source: string): boolean {
  return /\bvoid\s+mainImage\s*\(/.test(source);
}

export function resolvePmpsEntryPoint(
  fragmentCode: string,
  requested: PmpsEntryPoint | undefined
): ResolvedPmpsEntryPoint {
  const entryPoint = requested ?? 'auto';
  if (entryPoint === 'main' || entryPoint === 'shadertoy') return entryPoint;

  const hasMain = hasMainFunction(fragmentCode);
  const hasMainImage = hasMainImageFunction(fragmentCode);

  if (hasMainImage && !hasMain) return 'shadertoy';
  return 'main';
}

function stripBom(source: string): string {
  return source.replace(/^\uFEFF/, '');
}

function stripVersionDirectives(source: string): string {
  return source.replace(/^\s*#version\s+.*$/gm, '');
}

function ensureDefaultPrecision(source: string): string[] {
  const hasFloatPrecision = /\bprecision\s+(lowp|mediump|highp)\s+float\s*;/.test(source);
  const hasIntPrecision = /\bprecision\s+(lowp|mediump|highp)\s+int\s*;/.test(source);

  const lines: string[] = [];
  if (!hasFloatPrecision) {
    lines.push('precision highp float;');
  }
  if (!hasIntPrecision) {
    lines.push('precision highp int;');
  }
  return lines;
}

export function buildWebgl2ShaderSources(options: {
  fragmentCode: string;
  entryPoint: ResolvedPmpsEntryPoint;
}): { vertexSource: string; fragmentSource: string } {
  const userSource = stripVersionDirectives(stripBom(options.fragmentCode));
  const precisionLines = ensureDefaultPrecision(userSource);

  const vertexSource = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 aPosition;',
    'void main() {',
    '  gl_Position = vec4(aPosition, 0.0, 1.0);',
    '}',
    '',
  ].join('\n');

  const fragmentHeader = [
    '#version 300 es',
    ...precisionLines,
    '',
    '#define texture2D texture',
    '#define textureCube texture',
    '',
    'uniform vec3 iResolution;',
    'uniform float iTime;',
    'uniform float iTimeDelta;',
    'uniform float iFrameRate;',
    'uniform int iFrame;',
    'uniform vec4 iMouse;',
    'uniform vec4 iDate;',
    '',
    'uniform sampler2D iChannel0;',
    'uniform sampler2D iChannel1;',
    'uniform sampler2D iChannel2;',
    'uniform sampler2D iChannel3;',
    'uniform vec3 iChannelResolution[4];',
    'uniform float iChannelTime[4];',
    '',
    'out vec4 pmpFragColor;',
    '#define gl_FragColor pmpFragColor',
    '',
  ].join('\n');

  const fragmentParts: string[] = [fragmentHeader, userSource.trim(), ''];

  if (options.entryPoint === 'shadertoy') {
    fragmentParts.push(
      'void main() {',
      '  vec4 color = vec4(0.0);',
      '  mainImage(color, gl_FragCoord.xy);',
      '  pmpFragColor = color;',
      '}',
      ''
    );
  }

  return {
    vertexSource,
    fragmentSource: fragmentParts.join('\n'),
  };
}

