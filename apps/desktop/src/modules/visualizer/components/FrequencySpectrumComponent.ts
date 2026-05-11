import type {
  VisualizerComponent,
  VisualizerComponentContext,
  VisualizerComponentDefinition,
  VisualizerComponentManifest,
  VisualizerFrameInfo,
  VisualizerHitBounds,
  VisualizerRenderContext,
} from '../types';
import { clamp } from '../CoordinateSystem';

const DEFAULT_COLOR = { r: 74, g: 222, b: 128 };
const SECONDARY_COLOR = { r: 56, g: 189, b: 248 };
const ACCENT_COLOR = { r: 251, g: 191, b: 36 };

function drawRoundedRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function parseColor(value: string | undefined, fallback = DEFAULT_COLOR): { r: number; g: number; b: number } {
  if (!value) return fallback;
  const match =
    value.match(/^#([0-9a-f]{6})$/i) ||
    value.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (!match) return fallback;
  if (match[1].length === 6) {
    const hex = match[1];
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }
  return {
    r: Number(match[1] ?? fallback.r),
    g: Number(match[2] ?? fallback.g),
    b: Number(match[3] ?? fallback.b),
  };
}

function colorWithAlpha(color: { r: number; g: number; b: number }, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${clamp(alpha, 0, 1)})`;
}

function createSpectrumBars(values: Uint8Array, targetBars: number): number[] {
  if (targetBars <= 0 || values.length === 0) return [];
  const bars: number[] = [];
  const normalizedLength = values.length - 1;
  for (let bar = 0; bar < targetBars; bar += 1) {
    const start = Math.floor((bar / targetBars) * values.length);
    const end = Math.max(start + 1, Math.floor(((bar + 1) / targetBars) * values.length));
    let total = 0;
    let count = 0;
    for (let index = start; index < end; index += 1) {
      total += values[index] ?? 0;
      count += 1;
    }
    const average = count > 0 ? total / count : 0;
    const taper = normalizedLength > 0 ? Math.pow(bar / Math.max(1, targetBars - 1), 0.78) : 1;
    bars.push((average / 255) * (0.55 + taper * 0.55));
  }
  return bars;
}

function makeManifest(): VisualizerComponentManifest {
  return {
    id: '@pmp/frequency-spectrum',
    version: '1.0.0',
    formatVersion: 1,
    metadata: {
      name: 'Frequency Spectrum',
      description: 'Canvas spectrum bars for the full-screen visualizer.',
      author: 'Pixel Matrix Player',
      tags: ['audio', 'spectrum', 'bars'],
      preview: 'Spectrum',
    },
    engine: {
      apiVersion: '1.0.0',
      renderer: { type: 'canvas2d' },
      minFPS: 30,
    },
    capabilities: [
      { id: 'audio.spectrum', required: true, reason: 'The spectrum visualizer needs live frequency bins.' },
      { id: 'audio.analysis', required: true, reason: 'The spectrum visualizer uses energy and centroid analysis.' },
    ],
    geometry: {
      type: 'rectangular',
      defaultSize: { width: 1280, height: 420 },
      hitShape: { type: 'auto' },
    },
    defaultTransform: {
      position: { x: 0.5, y: 0.74 },
      scale: 1,
      rotation: 0,
      zIndex: 20,
      opacity: 1,
      visible: true,
    },
  };
}

function createFrequencySpectrumComponent(): VisualizerComponent {
  const manifest = makeManifest();
  let lastQualityBars = 32;

  return {
    manifest,
    initialize(ctx: VisualizerComponentContext) {
      lastQualityBars = Math.max(16, ctx.quality.barCount);
    },
    render(_frame: VisualizerFrameInfo, ctx: VisualizerRenderContext) {
      const { ctx: canvas, bounds, audioSnapshot, quality } = ctx;
      const barCount = Math.max(16, Math.min(160, Math.round((quality.barCount + lastQualityBars) / 2)));
      const bars = createSpectrumBars(audioSnapshot.frequency, barCount);
      const energy = audioSnapshot.analysis.smoothedEnergy;
      const energyPulse = 0.45 + Math.max(0, energy) * 0.55;
      const primary = parseColor('rgb(74, 222, 128)');
      const secondary = parseColor('rgb(56, 189, 248)', SECONDARY_COLOR);
      const accent = parseColor('rgb(251, 191, 36)', ACCENT_COLOR);

      canvas.save();
      drawRoundedRect(canvas, 0, 0, bounds.width, bounds.height, 24);
      canvas.fillStyle = 'rgba(4, 10, 16, 0.58)';
      canvas.fill();
      canvas.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      canvas.lineWidth = 1;
      canvas.stroke();

      const innerX = 28;
      const innerY = 24;
      const innerWidth = Math.max(1, bounds.width - innerX * 2);
      const innerHeight = Math.max(1, bounds.height - innerY * 2);
      const barGap = Math.max(1, Math.round(innerWidth / Math.max(1, barCount * 2.6)));
      const barWidth = Math.max(2, Math.floor((innerWidth - barGap * (barCount - 1)) / Math.max(1, barCount)));
      const maxBarHeight = Math.max(24, innerHeight * 0.92);
      const baseLine = innerY + innerHeight;

      canvas.save();
      canvas.translate(innerX, innerY);
      canvas.shadowBlur = 18 + energyPulse * 26;
      canvas.shadowColor = colorWithAlpha(primary, 0.44);
      canvas.fillStyle = colorWithAlpha(primary, 0.78);

      bars.forEach((bar, index) => {
        const value = clamp(bar, 0, 1);
        const height = Math.max(6, value * maxBarHeight);
        const x = index * (barWidth + barGap);
        const t = bars.length > 1 ? index / (bars.length - 1) : 0;
        const color =
          t < 0.5
            ? colorWithAlpha(primary, 0.58 + value * 0.36)
            : colorWithAlpha(secondary, 0.56 + value * 0.38);

        canvas.fillStyle = color;
        drawRoundedRect(canvas, x, innerHeight - height, barWidth, height, 999);
        canvas.fill();

        if (index % 9 === 0) {
          canvas.fillStyle = colorWithAlpha(accent, 0.14 + value * 0.2);
          drawRoundedRect(canvas, x, innerHeight - height - 4, barWidth, Math.max(3, height * 0.1), 999);
          canvas.fill();
        }
      });
      canvas.restore();

      canvas.beginPath();
      canvas.moveTo(28, baseLine - 2);
      canvas.lineTo(bounds.width - 28, baseLine - 2);
      canvas.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      canvas.lineWidth = 1;
      canvas.stroke();
      canvas.restore();

      lastQualityBars = quality.barCount;
    },
    dispose() {
      lastQualityBars = 32;
    },
    getHitBounds(): VisualizerHitBounds {
      const defaultSize = manifest.geometry.defaultSize as { width: number; height: number };
      return { type: 'rect', width: defaultSize.width, height: defaultSize.height };
    },
  };
}

export const FREQUENCY_SPECTRUM_COMPONENT_DEFINITION: VisualizerComponentDefinition = {
  manifest: makeManifest(),
  create: createFrequencySpectrumComponent,
};
