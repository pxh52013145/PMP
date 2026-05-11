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

type VisualizerCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const TWO_PI = Math.PI * 2;
const PROGRESS_COLOR: RgbColor = { r: 59, g: 130, b: 246 };
const FREQUENCY_COLOR: RgbColor = { r: 168, g: 85, b: 247 };
const PHASE_COLOR: RgbColor = { r: 20, g: 184, b: 166 };
const HIGHLIGHT_COLOR: RgbColor = { r: 245, g: 158, b: 11 };
const WAVE_COLOR: RgbColor = { r: 255, g: 88, b: 132 };
const CHORD_COLORS: RgbColor[] = [
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
];

function colorWithAlpha(color: RgbColor, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${clamp(alpha, 0, 1)})`;
}

function mixColor(left: RgbColor, right: RgbColor, ratio: number): RgbColor {
  const t = clamp(ratio, 0, 1);
  return {
    r: Math.round(left.r + (right.r - left.r) * t),
    g: Math.round(left.g + (right.g - left.g) * t),
    b: Math.round(left.b + (right.b - left.b) * t),
  };
}

function pointOnCircle(centerX: number, centerY: number, radius: number, angle: number): { x: number; y: number } {
  return {
    x: centerX + Math.cos(angle) * radius,
    y: centerY + Math.sin(angle) * radius,
  };
}

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const sec = Math.floor(safe % 60);
  return `${minutes}:${sec.toString().padStart(2, '0')}`;
}

function createIdleBands(targetBars: number, timestamp: number): number[] {
  return Array.from({ length: targetBars }, (_unused, index) => {
    const position = index / Math.max(1, targetBars - 1);
    const sweep = Math.sin(timestamp / 900 + index * 0.21) * 0.5 + 0.5;
    const breath = Math.sin(timestamp / 1700 + position * TWO_PI * 2.4) * 0.5 + 0.5;
    return 0.035 + sweep * 0.052 + breath * 0.038;
  });
}

function createSpectrumBands(values: Uint8Array, targetBars: number, timestamp: number): number[] {
  if (targetBars <= 0) return [];
  if (values.length === 0) return createIdleBands(targetBars, timestamp);

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

function drawBackgroundBloom(
  ctx: VisualizerCanvasContext,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
  energy: number
): void {
  const glowRadius = Math.max(width, height) * (0.42 + energy * 0.08);
  const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, glowRadius);
  gradient.addColorStop(0, colorWithAlpha(FREQUENCY_COLOR, 0.12 + energy * 0.12));
  gradient.addColorStop(0.35, colorWithAlpha(PHASE_COLOR, 0.05 + energy * 0.08));
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  [0.54, 0.78, 1, 1.2].forEach((scale) => {
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * scale, 0, TWO_PI);
    ctx.stroke();
  });
  ctx.restore();
}

function drawProgressRing(
  ctx: VisualizerCanvasContext,
  centerX: number,
  centerY: number,
  radius: number,
  progress: number,
  beatStrength: number,
  beatPhase: number
): void {
  const safeProgress = clamp(progress, 0, 1);
  const ringWidth = Math.max(3, radius * 0.016);
  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + safeProgress * TWO_PI;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
  ctx.lineWidth = ringWidth;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, TWO_PI);
  ctx.stroke();

  if (safeProgress > 0) {
    ctx.strokeStyle = colorWithAlpha(PROGRESS_COLOR, 0.74 + beatStrength * 0.18);
    ctx.shadowColor = colorWithAlpha(PROGRESS_COLOR, 0.5 + beatStrength * 0.25);
    ctx.shadowBlur = 14 + beatStrength * 18;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.stroke();

    const head = pointOnCircle(centerX, centerY, radius, endAngle);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.shadowColor = 'rgba(255, 255, 255, 0.86)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(head.x, head.y, Math.max(2.4, ringWidth * 0.92), 0, TWO_PI);
    ctx.fill();
  }

  const sweepAngle = startAngle + beatPhase * TWO_PI;
  ctx.strokeStyle = colorWithAlpha(HIGHLIGHT_COLOR, 0.18 + beatStrength * 0.34);
  ctx.shadowColor = colorWithAlpha(HIGHLIGHT_COLOR, 0.22 + beatStrength * 0.34);
  ctx.shadowBlur = 16 + beatStrength * 12;
  ctx.lineWidth = Math.max(1.5, ringWidth * 0.58);
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.82, sweepAngle - 0.22, sweepAngle + 0.22);
  ctx.stroke();
  ctx.restore();
}

function drawPhaseRibbon(
  ctx: VisualizerCanvasContext,
  bands: number[],
  centerX: number,
  centerY: number,
  radius: number,
  timestamp: number,
  energy: number
): void {
  if (bands.length === 0) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = colorWithAlpha(PHASE_COLOR, 0.22 + energy * 0.22);
  ctx.shadowColor = colorWithAlpha(PHASE_COLOR, 0.28 + energy * 0.24);
  ctx.shadowBlur = 10 + energy * 18;
  ctx.lineWidth = Math.max(1.2, radius * 0.006);
  ctx.beginPath();

  for (let index = 0; index <= bands.length; index += 1) {
    const band = bands[index % bands.length] ?? 0;
    const angle = -Math.PI / 2 + (index / bands.length) * TWO_PI + timestamp / 16000;
    const wobble = Math.sin(timestamp / 480 + index * 0.22) * radius * 0.012;
    const waveRadius = radius * 0.71 + band * radius * 0.13 + wobble;
    const point = pointOnCircle(centerX, centerY, waveRadius, angle);
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  }

  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawToneSegments(
  ctx: VisualizerCanvasContext,
  centerX: number,
  centerY: number,
  radius: number,
  bands: number[],
  beatStrength: number,
  timestamp: number
): void {
  const segmentRadius = radius * 0.54;
  const segmentWidth = Math.max(3, radius * 0.018);

  ctx.save();
  ctx.lineCap = 'round';
  CHORD_COLORS.forEach((color, index) => {
    const band = bands[(index * 11) % Math.max(1, bands.length)] ?? 0;
    const start = -Math.PI / 2 + (index / CHORD_COLORS.length) * TWO_PI + timestamp / 26000;
    const length = TWO_PI / CHORD_COLORS.length * (0.36 + band * 0.28);
    ctx.strokeStyle = colorWithAlpha(color, 0.16 + band * 0.26 + beatStrength * 0.08);
    ctx.shadowColor = colorWithAlpha(color, 0.18 + band * 0.2);
    ctx.shadowBlur = 8 + band * 14;
    ctx.lineWidth = segmentWidth;
    ctx.beginPath();
    ctx.arc(centerX, centerY, segmentRadius + band * radius * 0.035, start, start + length);
    ctx.stroke();
  });
  ctx.restore();
}

function drawRadialBars(
  ctx: VisualizerCanvasContext,
  bands: number[],
  centerX: number,
  centerY: number,
  radius: number,
  frame: VisualizerFrameInfo,
  energy: number
): void {
  if (bands.length === 0) return;

  const baseRadius = radius * 1.02;
  const maxLength = Math.max(24, radius * 0.26);
  const rotation = frame.globalRotation * 0.12;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'lighter';

  bands.forEach((band, index) => {
    const position = index / bands.length;
    const angle = -Math.PI / 2 + position * TWO_PI + rotation;
    const accentWave = Math.sin(frame.timestamp / 620 + index * 0.23) * 0.5 + 0.5;
    const value = clamp(Math.pow(band, 0.72) + accentWave * 0.035 + energy * 0.04, 0, 1);
    const length = 8 + value * maxLength;
    const startRadius = baseRadius + Math.sin(index * 0.19 + frame.timestamp / 1200) * 2;
    const start = pointOnCircle(centerX, centerY, startRadius, angle);
    const end = pointOnCircle(centerX, centerY, startRadius + length, angle);
    const color = mixColor(FREQUENCY_COLOR, PHASE_COLOR, 0.35 + Math.sin(position * TWO_PI) * 0.25);

    ctx.strokeStyle = colorWithAlpha(color, 0.18 + value * 0.58);
    ctx.shadowColor = colorWithAlpha(color, 0.28 + value * 0.38);
    ctx.shadowBlur = 6 + value * 18;
    ctx.lineWidth = Math.max(1.3, radius * 0.0045 + value * radius * 0.006);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  });

  ctx.restore();
}

function drawOrbitParticles(
  ctx: VisualizerCanvasContext,
  bands: number[],
  centerX: number,
  centerY: number,
  radius: number,
  timestamp: number,
  energy: number
): void {
  const count = 36;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let index = 0; index < count; index += 1) {
    const band = bands[(index * 7) % Math.max(1, bands.length)] ?? 0;
    const angle = -Math.PI / 2 + (index / count) * TWO_PI + timestamp / 9000;
    const orbitRadius = radius * (1.26 + Math.sin(timestamp / 1100 + index) * 0.015) + band * radius * 0.045;
    const point = pointOnCircle(centerX, centerY, orbitRadius, angle);
    const color = CHORD_COLORS[index % CHORD_COLORS.length];
    const size = 1.2 + band * 3.2 + energy * 1.6;

    ctx.fillStyle = colorWithAlpha(color, 0.12 + band * 0.36 + energy * 0.08);
    ctx.shadowColor = colorWithAlpha(color, 0.32 + band * 0.3);
    ctx.shadowBlur = 8 + band * 16;
    ctx.beginPath();
    ctx.arc(point.x, point.y, size, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

function drawBottomWave(
  ctx: VisualizerCanvasContext,
  bands: number[],
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
  audioSnapshot: VisualizerRenderContext['audioSnapshot'],
  timestamp: number
): void {
  if (bands.length === 0) return;

  const waveWidth = Math.min(width * 0.72, 860);
  const progressWidth = Math.min(width * 0.58, 700);
  const waveHeight = Math.max(34, Math.min(92, height * 0.11));
  const baselineY = Math.min(height - 76, Math.max(centerY + radius * 0.86, height * 0.72));
  const startX = centerX - waveWidth / 2;
  const points = Math.max(60, Math.min(144, Math.round(bands.length * 0.72)));
  const energy = audioSnapshot.analysis.smoothedEnergy;

  ctx.save();
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 2;
  ctx.beginPath();

  const resolvedPoints: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < points; index += 1) {
    const position = index / Math.max(1, points - 1);
    const bandIndex = Math.min(bands.length - 1, Math.floor(position * bands.length));
    const band = bands[bandIndex] ?? 0;
    const envelope = Math.sin(position * Math.PI);
    const pulse = Math.sin(timestamp / 380 + position * TWO_PI * 5.2) * 0.5 + 0.5;
    const value = clamp(band * 0.86 + pulse * 0.08 + energy * 0.09, 0, 1);
    const x = startX + position * waveWidth;
    const y = baselineY - value * waveHeight * envelope;
    resolvedPoints.push({ x, y });
  }

  resolvedPoints.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });

  ctx.strokeStyle = 'rgba(255, 245, 248, 0.92)';
  ctx.shadowColor = colorWithAlpha(WAVE_COLOR, 0.72);
  ctx.shadowBlur = 12 + energy * 14;
  ctx.lineWidth = 1.8;
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = colorWithAlpha(WAVE_COLOR, 0.42);
  ctx.lineWidth = 0.9;
  ctx.stroke();

  if (resolvedPoints.length > 1) {
    const fill = ctx.createLinearGradient(0, baselineY - waveHeight, 0, baselineY + 4);
    fill.addColorStop(0, colorWithAlpha(WAVE_COLOR, 0.14));
    fill.addColorStop(1, colorWithAlpha(WAVE_COLOR, 0));
    ctx.lineTo(startX + waveWidth, baselineY);
    ctx.lineTo(startX, baselineY);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  const progress = clamp(audioSnapshot.playback.progress, 0, 1);
  const progressY = baselineY + 18;
  const progressStart = centerX - progressWidth / 2;
  const progressEnd = centerX + progressWidth / 2;
  const thumbX = progressStart + progress * progressWidth;

  ctx.lineCap = 'round';
  ctx.strokeStyle = colorWithAlpha(WAVE_COLOR, 0.28);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(progressStart, progressY);
  ctx.lineTo(progressEnd, progressY);
  ctx.stroke();

  if (progress > 0) {
    ctx.strokeStyle = 'rgba(255, 228, 238, 0.94)';
    ctx.shadowColor = colorWithAlpha(WAVE_COLOR, 0.72);
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(progressStart, progressY);
    ctx.lineTo(thumbX, progressY);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.shadowColor = 'rgba(255, 255, 255, 0.72)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(thumbX - 5, progressY - 4);
  ctx.lineTo(thumbX + 7, progressY - 4);
  ctx.lineTo(thumbX + 5, progressY + 4);
  ctx.lineTo(thumbX - 7, progressY + 4);
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.font = '500 12px "Cascadia Mono", "SFMono-Regular", Consolas, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colorWithAlpha(WAVE_COLOR, 0.66);
  ctx.textAlign = 'right';
  ctx.fillText(formatTime(audioSnapshot.playback.currentTime), progressStart - 12, progressY);
  ctx.textAlign = 'left';
  ctx.fillText(formatTime(audioSnapshot.playback.duration), progressEnd + 12, progressY);
  ctx.restore();
}

function makeManifest(): VisualizerComponentManifest {
  return {
    id: '@pmp/frequency-spectrum',
    version: '1.0.0',
    formatVersion: 1,
    metadata: {
      name: 'Frequency Spectrum',
      description: 'Reference-style orbital spectrum layer for the full-screen visualizer.',
      author: 'Pixel Matrix Player',
      tags: ['audio', 'spectrum', 'orbital', 'waveform'],
      preview: 'Orbital Spectrum',
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
      defaultSize: { width: 3200, height: 2200 },
      hitShape: { type: 'auto' },
    },
    defaultTransform: {
      position: { x: 0.5, y: 0.5 },
      scale: 1,
      rotation: 0,
      zIndex: 10,
      opacity: 1,
      visible: true,
    },
  };
}

function createFrequencySpectrumComponent(): VisualizerComponent {
  const manifest = makeManifest();
  let lastQualityBars = 96;

  return {
    manifest,
    initialize(ctx: VisualizerComponentContext) {
      lastQualityBars = Math.max(64, ctx.quality.barCount);
    },
    render(frame: VisualizerFrameInfo, ctx: VisualizerRenderContext) {
      const { ctx: canvas, bounds, audioSnapshot, quality } = ctx;
      const barCount = Math.max(96, Math.min(240, Math.round((quality.barCount + lastQualityBars) * 0.72)));
      const bars = createSpectrumBands(audioSnapshot.frequency, barCount, frame.timestamp);
      const energy = audioSnapshot.analysis.smoothedEnergy;
      const beatStrength = clamp(audioSnapshot.analysis.beatStrength, 0, 1);
      const centerX = bounds.width / 2;
      const centerY = bounds.height * 0.47;
      const radius = Math.max(120, Math.min(bounds.width, bounds.height) * (0.25 + beatStrength * 0.014));

      drawBackgroundBloom(canvas, bounds.width, bounds.height, centerX, centerY, radius, energy);
      drawToneSegments(canvas, centerX, centerY, radius, bars, beatStrength, frame.timestamp);
      drawPhaseRibbon(canvas, bars, centerX, centerY, radius, frame.timestamp, energy);
      drawProgressRing(
        canvas,
        centerX,
        centerY,
        radius * 0.86,
        audioSnapshot.playback.progress,
        beatStrength,
        audioSnapshot.analysis.beatPhase
      );
      drawRadialBars(canvas, bars, centerX, centerY, radius, frame, energy);
      drawOrbitParticles(canvas, bars, centerX, centerY, radius, frame.timestamp, energy);
      drawBottomWave(canvas, bars, bounds.width, bounds.height, centerX, centerY, radius, audioSnapshot, frame.timestamp);

      lastQualityBars = quality.barCount;
    },
    dispose() {
      lastQualityBars = 96;
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
