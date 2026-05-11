import type {
  VisualizerCapabilityRequirement,
  VisualizerComponentGeometry,
  VisualizerComponentManifest,
  VisualizerComponentTransform,
  VisualizerRenderContext,
} from '../../types';
import { clamp } from '../../CoordinateSystem';

export type VisualizerCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface OrbitalRadii {
  frequency: number;
  phase: number;
  progress: number;
  chords: number;
  center: number;
  morse: number;
  wave: number;
}

export const TWO_PI = Math.PI * 2;

export const ORBITAL_COMPONENT_IDS = {
  phaseScope: '@pmp/orbital/phase-scope',
  frequencyRing: '@pmp/orbital/frequency-ring',
  chordWheel: '@pmp/orbital/chord-wheel',
  progressOrbit: '@pmp/orbital/progress-orbit',
  particleFlow: '@pmp/orbital/particle-flow',
  morseTelemetry: '@pmp/orbital/morse-telemetry',
  centerConsole: '@pmp/orbital/center-console',
  trackHeader: '@pmp/orbital/track-header',
} as const;

export const ORBITAL_COLORS = {
  ringBg: { r: 255, g: 255, b: 255 },
  progress: { r: 59, g: 130, b: 246 },
  frequency: { r: 168, g: 85, b: 247 },
  phase: { r: 20, g: 184, b: 166 },
  highlight: { r: 245, g: 158, b: 11 },
  wave: { r: 255, g: 88, b: 132 },
  chords: [
    { r: 239, g: 68, b: 68 },
    { r: 249, g: 115, b: 22 },
    { r: 245, g: 158, b: 11 },
    { r: 132, g: 204, b: 22 },
    { r: 34, g: 197, b: 94 },
    { r: 20, g: 184, b: 166 },
    { r: 6, g: 182, b: 212 },
    { r: 59, g: 130, b: 246 },
    { r: 99, g: 102, b: 241 },
    { r: 139, g: 92, b: 246 },
    { r: 217, g: 70, b: 239 },
    { r: 244, g: 63, b: 94 },
  ],
} satisfies Record<string, RgbColor | RgbColor[]>;

export const ORBITAL_CHORDS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
export const ORBITAL_CHORDS_CHROMATIC = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

export const ORBITAL_MORSE_MAP: Record<string, string> = {
  '0': '-----',
  '1': '.----',
  '2': '..---',
  '3': '...--',
  '4': '....-',
  '5': '.....',
  '6': '-....',
  '7': '--...',
  '8': '---..',
  '9': '----.',
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  I: '..',
  J: '.---',
  M: '--',
  N: '-.',
  S: '...',
  Y: '-.--',
  '#': '.-..-',
  '-': '-....-',
  ' ': ' ',
};

const DOT_FONT_5X7: Record<string, number[][]> = {
  '0': [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 1, 1],
    [1, 0, 1, 0, 1],
    [1, 1, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ],
  '1': [
    [0, 0, 1, 0, 0],
    [0, 1, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 1, 1, 1, 0],
  ],
  '2': [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [0, 0, 0, 0, 1],
    [0, 0, 1, 1, 0],
    [0, 1, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 1, 1, 1, 1],
  ],
  '3': [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [0, 0, 0, 0, 1],
    [0, 0, 1, 1, 0],
    [0, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ],
  '4': [
    [0, 0, 0, 1, 0],
    [0, 0, 1, 1, 0],
    [0, 1, 0, 1, 0],
    [1, 0, 0, 1, 0],
    [1, 1, 1, 1, 1],
    [0, 0, 0, 1, 0],
    [0, 0, 0, 1, 0],
  ],
  '5': [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0],
    [1, 1, 1, 1, 0],
    [0, 0, 0, 0, 1],
    [0, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ],
  '6': [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 0],
    [1, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ],
  '7': [
    [1, 1, 1, 1, 1],
    [0, 0, 0, 0, 1],
    [0, 0, 0, 1, 0],
    [0, 0, 1, 0, 0],
    [0, 1, 0, 0, 0],
    [0, 1, 0, 0, 0],
    [0, 1, 0, 0, 0],
  ],
  '8': [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ],
  '9': [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 1],
    [0, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ],
  ':': [
    [0, 0, 0, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 0, 0, 0],
  ],
  '.': [
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 1, 1, 0],
    [0, 0, 1, 1, 0],
  ],
  '/': [
    [0, 0, 0, 0, 1],
    [0, 0, 0, 0, 1],
    [0, 0, 0, 1, 0],
    [0, 0, 1, 0, 0],
    [0, 1, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
  ],
};

export function colorWithAlpha(color: RgbColor, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${clamp(alpha, 0, 1)})`;
}

export function mixColor(left: RgbColor, right: RgbColor, ratio: number): RgbColor {
  const t = clamp(ratio, 0, 1);
  return {
    r: Math.round(left.r + (right.r - left.r) * t),
    g: Math.round(left.g + (right.g - left.g) * t),
    b: Math.round(left.b + (right.b - left.b) * t),
  };
}

export function pointOnCircle(radius: number, angle: number): { x: number; y: number } {
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

export function getOrbitalRadii(bounds: VisualizerRenderContext['bounds']): OrbitalRadii {
  const minDim = Math.min(bounds.width, bounds.height);
  return {
    frequency: minDim * 0.43,
    phase: minDim * 0.36,
    progress: minDim * 0.28,
    chords: Math.max(minDim * 0.21, 60),
    center: Math.max(minDim * 0.17, 48),
    morse: minDim * 0.43 + 20,
    wave: minDim * 0.3,
  };
}

export function formatClock(seconds: number, options: { centiseconds?: boolean } = {}): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const sec = Math.floor(safe % 60);
  if (!options.centiseconds) {
    return `${minutes}:${sec.toString().padStart(2, '0')}`;
  }
  const centiseconds = Math.floor((safe % 1) * 100);
  return `${minutes.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
}

export function buildFrequencyBands(values: Uint8Array, targetBars: number, timestamp: number): number[] {
  if (targetBars <= 0) return [];
  if (values.length === 0) {
    return Array.from({ length: targetBars }, (_unused, index) => {
      const position = index / Math.max(1, targetBars - 1);
      const sweep = Math.sin(timestamp / 900 + index * 0.21) * 0.5 + 0.5;
      const breath = Math.sin(timestamp / 1700 + position * TWO_PI * 2.4) * 0.5 + 0.5;
      return 0.035 + sweep * 0.052 + breath * 0.038;
    });
  }

  const bars: number[] = [];
  for (let bar = 0; bar < targetBars; bar += 1) {
    const startRatio = Math.pow(bar / targetBars, 1.7);
    const endRatio = Math.pow((bar + 1) / targetBars, 1.7);
    const start = Math.floor(startRatio * values.length);
    const end = Math.max(start + 1, Math.floor(endRatio * values.length));
    let total = 0;
    let peak = 0;
    let count = 0;
    for (let index = start; index < end; index += 1) {
      const value = values[index] ?? 0;
      total += value;
      peak = Math.max(peak, value);
      count += 1;
    }
    const average = count > 0 ? total / count : 0;
    const normalized = (average * 0.72 + peak * 0.28) / 255;
    const position = bar / Math.max(1, targetBars - 1);
    const envelope = 0.72 + Math.sin(position * Math.PI) * 0.2 + Math.cos(position * TWO_PI * 2) * 0.045;
    bars.push(clamp(normalized * envelope, 0, 1));
  }
  return bars;
}

export function createStaticSpectrum(count: number): number[] {
  const raw = Array.from({ length: count }, (_unused, index) => {
    const phase = index / Math.max(1, count - 1);
    return 0.2 + Math.sin(phase * TWO_PI * 3.7) * 0.13 + Math.sin(phase * TWO_PI * 13.1) * 0.07;
  });
  return raw.map((value, index) => {
    const prev = raw[(index - 1 + raw.length) % raw.length] ?? value;
    const next = raw[(index + 1) % raw.length] ?? value;
    return clamp((prev + value * 2 + next) / 4, 0.08, 0.86);
  });
}

export function stringToMorse(value: string): string {
  return value
    .split('')
    .map((char) => ORBITAL_MORSE_MAP[char.toUpperCase()] ?? ' ')
    .join(' ');
}

export function drawDotText(
  ctx: VisualizerCanvasContext,
  text: string,
  x: number,
  y: number,
  dotSize: number,
  gap: number,
  color: string
): void {
  const charWidth = 5 * dotSize + 4 * gap;
  const padding = 2 * gap;
  const totalWidth = text.length * charWidth + Math.max(0, text.length - 1) * padding;
  let currentX = x - totalWidth / 2;

  ctx.save();
  ctx.fillStyle = color;
  for (const char of text) {
    if (char === ' ') {
      currentX += charWidth + padding;
      continue;
    }

    const matrix = DOT_FONT_5X7[char];
    if (matrix) {
      for (let row = 0; row < 7; row += 1) {
        for (let col = 0; col < 5; col += 1) {
          if (matrix[row]?.[col]) {
            ctx.beginPath();
            ctx.arc(
              currentX + col * (dotSize + gap),
              y + row * (dotSize + gap) - (7 * (dotSize + gap)) / 2,
              dotSize / 2,
              0,
              TWO_PI
            );
            ctx.fill();
          }
        }
      }
    }
    currentX += charWidth + padding;
  }
  ctx.restore();
}

export function createOrbitalManifest(options: {
  id: string;
  name: string;
  description: string;
  tags: string[];
  preview: string;
  geometry: VisualizerComponentGeometry;
  defaultTransform: VisualizerComponentTransform;
  capabilities: VisualizerCapabilityRequirement[];
}): VisualizerComponentManifest {
  return {
    id: options.id,
    version: '1.0.0',
    formatVersion: 1,
    metadata: {
      name: options.name,
      description: options.description,
      author: 'Pixel Matrix Player',
      tags: options.tags,
      preview: options.preview,
    },
    engine: {
      apiVersion: '1.0.0',
      renderer: { type: 'canvas2d' },
      minFPS: 30,
    },
    capabilities: options.capabilities,
    geometry: options.geometry,
    defaultTransform: options.defaultTransform,
  };
}

export function circularStageGeometry(): VisualizerComponentGeometry {
  return {
    type: 'circular',
    defaultSize: { radius: 1600 },
    hitShape: { type: 'circle', radius: 1600 },
  };
}

export function centeredTransform(zIndex: number): VisualizerComponentTransform {
  return {
    position: { x: 0, y: 0 },
    scale: 1,
    rotation: 0,
    zIndex,
    opacity: 1,
    visible: true,
  };
}
