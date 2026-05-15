import { clamp } from '../../CoordinateSystem';
import type {
  VisualizerCapabilityRequirement,
  VisualizerComponentGeometry,
  VisualizerComponentManifest,
  VisualizerComponentTransform,
  VisualizerRenderContext,
} from '../../types';

export type ReferenceCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type ReferenceComponentId =
  | 'freq'
  | 'phase'
  | 'progress'
  | 'chords'
  | 'morse'
  | 'center'
  | 'particles'
  | 'hud';

export interface ReferenceRadii extends Record<ReferenceComponentId, number> {
  freq: number;
  phase: number;
  progress: number;
  chords: number;
  morse: number;
  center: number;
  particles: number;
  hud: number;
}

export const TWO_PI = Math.PI * 2;

export const REFERENCE_COMPONENT_IDS = {
  freq: 'freq',
  phase: 'phase',
  progress: 'progress',
  chords: 'chords',
  morse: 'morse',
  center: 'center',
  particles: 'particles',
  hud: 'hud',
} as const satisfies Record<ReferenceComponentId, ReferenceComponentId>;

export const REFERENCE_RENDER_ORDER: ReferenceComponentId[] = [
  'phase',
  'freq',
  'chords',
  'progress',
  'particles',
  'morse',
  'center',
  'hud',
];

export const REFERENCE_HIT_ORDER: ReferenceComponentId[] = [
  'hud',
  'particles',
  'morse',
  'center',
  'chords',
  'progress',
  'phase',
  'freq',
];

export const CHORDS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
export const CHORDS_CHROMATIC = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
export const CHROMATIC_NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
export const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export const COLORS = {
  ringBg: 'rgba(255,255,255,0.1)',
  progress: '#3b82f6',
  freq: '#a855f7',
  phase: '#14b8a6',
  highlight: '#f59e0b',
  chords: [
    '#ef4444',
    '#f97316',
    '#f59e0b',
    '#84cc16',
    '#22c55e',
    '#14b8a6',
    '#06b6d4',
    '#3b82f6',
    '#6366f1',
    '#8b5cf6',
    '#d946ef',
    '#f43f5e',
  ],
};

export const MORSE_MAP: Record<string, string> = {
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
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  A: '.-',
  B: '-...',
  M: '--',
  I: '..',
  N: '-.',
  J: '.---',
  S: '...',
  Y: '-.--',
  '-': '-....-',
  '#': '.-..-',
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

export function getReferenceRadii(bounds: VisualizerRenderContext['bounds']): ReferenceRadii {
  const minDim = Math.min(bounds.width, bounds.height);
  return {
    freq: minDim * 0.43,
    phase: minDim * 0.36,
    progress: minDim * 0.28,
    particles: minDim * 0.28,
    chords: Math.max(minDim * 0.21, 60),
    morse: minDim * 0.43 + 20,
    center: minDim * 0.21 - 5,
    hud: 0,
  };
}

export function stringToMorse(value: string): string {
  return value
    .split('')
    .map((char) => MORSE_MAP[char.toUpperCase()] ?? ' ')
    .join(' ');
}

export function drawDotText(
  ctx: ReferenceCanvasContext,
  text: string,
  x: number,
  y: number,
  dotSize: number,
  gap: number,
  color: string
): void {
  ctx.fillStyle = color;
  const charWidth = 5 * dotSize + 4 * gap;
  const padding = 2 * gap;
  const totalWidth = text.length * charWidth + (text.length > 0 ? (text.length - 1) * padding : 0);
  let currentX = x - totalWidth / 2;

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
}

export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const sec = Math.floor(safe % 60);
  const centiseconds = Math.floor((safe % 1) * 100);
  return `${minutes.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${centiseconds
    .toString()
    .padStart(2, '0')}`;
}

export function pointOnCircle(radius: number, angle: number): { x: number; y: number } {
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

export function createReferenceProgressSpectrum(): number[] {
  const raw = Array.from({ length: 360 }, () => Math.random() * 0.8 + 0.2);
  return raw.map((value, index) => {
    const previous = raw[(index - 1 + raw.length) % raw.length] ?? value;
    const next = raw[(index + 1) % raw.length] ?? value;
    return (previous + value * 2 + next) / 4;
  });
}

export function getUniformTransformScale(transform: VisualizerComponentTransform): number {
  if (typeof transform.scale === 'number') {
    return Number.isFinite(transform.scale) ? Math.max(0.05, transform.scale) : 1;
  }
  const x = Number.isFinite(transform.scale.x) ? transform.scale.x : 1;
  const y = Number.isFinite(transform.scale.y) ? transform.scale.y : 1;
  return Math.max(0.05, (x + y) / 2);
}

export function createReferenceManifest(options: {
  id: ReferenceComponentId;
  name: string;
  description: string;
  tags: string[];
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
      author: 'Reference Visualizer',
      tags: options.tags,
      preview: options.name,
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

export function createReferenceCircularGeometry(): VisualizerComponentGeometry {
  return {
    type: 'circular',
    defaultSize: { radius: 420 },
    hitShape: { type: 'circle', radius: 420 },
  };
}

export function createReferenceHudGeometry(): VisualizerComponentGeometry {
  return {
    type: 'rectangular',
    defaultSize: { width: 320, height: 90 },
    hitShape: { type: 'rect', width: 320, height: 90 },
  };
}

export function createReferenceDefaultTransform(
  id: ReferenceComponentId,
  zIndex: number
): VisualizerComponentTransform {
  return {
    position: id === 'hud' ? { x: -280, y: -200 } : { x: 0, y: 0 },
    scale: 1,
    rotation: 0,
    zIndex,
    opacity: 1,
    visible: true,
  };
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
