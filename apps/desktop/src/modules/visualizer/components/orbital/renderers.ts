import type { VisualizerFrameInfo, VisualizerRenderContext } from '../../types';
import { clamp } from '../../CoordinateSystem';
import type { TonalityFeatures } from './audioFeatures';
import { resolveChordIntensity, resolvePeakFrequency } from './audioFeatures';
import {
  buildFrequencyBands,
  colorWithAlpha,
  createStaticSpectrum,
  drawDotText,
  formatClock,
  getOrbitalRadii,
  mixColor,
  ORBITAL_CHORDS,
  ORBITAL_COLORS,
  pointOnCircle,
  stringToMorse,
  TWO_PI,
  type VisualizerCanvasContext,
} from './styleModel';

export interface OrbitalParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  colorIndex: number;
  size: number;
}

export interface MorseArc {
  angle: number;
  morse: string;
  life: number;
  radiusOffset: number;
}

export function drawPhaseScope(ctx: VisualizerCanvasContext, frame: VisualizerFrameInfo, render: VisualizerRenderContext): void {
  const { bounds, audioSnapshot } = render;
  const radius = getOrbitalRadii(bounds).phase;
  const energy = audioSnapshot.analysis.smoothedEnergy;
  const timeDomain = audioSnapshot.timeDomain;

  ctx.save();
  ctx.translate(bounds.width / 2, bounds.height / 2);
  ctx.strokeStyle = colorWithAlpha(ORBITAL_COLORS.phase, 0.06 + energy * 0.62);
  ctx.lineWidth = 1 + energy * 2;
  ctx.shadowColor = colorWithAlpha(ORBITAL_COLORS.phase, 0.32 + energy * 0.28);
  ctx.shadowBlur = energy * 16;
  ctx.beginPath();
  ctx.moveTo(0, -radius);
  ctx.lineTo(radius, 0);
  ctx.lineTo(0, radius);
  ctx.lineTo(-radius, 0);
  ctx.closePath();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -radius);
  ctx.lineTo(0, radius);
  ctx.moveTo(-radius, 0);
  ctx.lineTo(radius, 0);
  ctx.stroke();

  ctx.fillStyle = 'rgba(167, 243, 208, 0.72)';
  const sampleCount = timeDomain.length > 0 ? Math.max(0, Math.min(timeDomain.length - 4, 512)) : 180;
  for (let index = 0; index < sampleCount; index += 2) {
    const left = timeDomain.length > 0
      ? ((timeDomain[index] ?? 128) / 128) - 1
      : Math.sin(index * 0.1 + frame.globalRotation * 10) * Math.sin(index * 0.05) * 0.8;
    const right = timeDomain.length > 0
      ? ((timeDomain[index + 4] ?? 128) / 128) - 1
      : Math.cos(index * 0.12 + frame.globalRotation * 12) * Math.cos(index * 0.07) * 0.8;
    const x = (right - left) * (radius * 0.45);
    const y = -(left + right) * (radius * 0.45);
    ctx.globalAlpha = timeDomain.length > 0 ? 0.8 : 0.22;
    ctx.fillRect(x, y, timeDomain.length > 0 ? 1.5 : 1, timeDomain.length > 0 ? 1.5 : 1);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

export function drawFrequencyRing(ctx: VisualizerCanvasContext, frame: VisualizerFrameInfo, render: VisualizerRenderContext): void {
  const { bounds, audioSnapshot } = render;
  const radius = getOrbitalRadii(bounds).frequency;
  const energy = audioSnapshot.analysis.smoothedEnergy;
  const barCount = Math.max(96, Math.min(360, Math.round(render.quality.barCount || 180)));
  const bars = buildFrequencyBands(audioSnapshot.frequency, barCount, frame.timestamp);

  ctx.save();
  ctx.translate(bounds.width / 2, bounds.height / 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TWO_PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(0, radius - 5), 0, TWO_PI);
  ctx.stroke();

  ctx.globalCompositeOperation = 'lighter';
  bars.forEach((value, index) => {
    const angle = (index / bars.length) * TWO_PI;
    const length = Math.max(4, Math.pow(value, 0.72) * radius * 0.16 + energy * radius * 0.02);
    const inner = radius - length * 0.5;
    const outer = radius + length * 0.5;
    const start = pointOnCircle(inner, angle);
    const end = pointOnCircle(outer, angle);
    const color = mixColor(ORBITAL_COLORS.phase, ORBITAL_COLORS.frequency, 0.35 + value * 0.55);

    ctx.strokeStyle = colorWithAlpha(color, 0.2 + value * 0.65);
    ctx.shadowColor = colorWithAlpha(color, 0.3 + value * 0.3);
    ctx.shadowBlur = 4 + value * 16;
    ctx.lineWidth = 1.2 + value * 1.6;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  });
  ctx.restore();
}

export function drawChordWheel(
  ctx: VisualizerCanvasContext,
  frame: VisualizerFrameInfo,
  render: VisualizerRenderContext,
  features: TonalityFeatures
): void {
  const { bounds, audioSnapshot } = render;
  const radius = getOrbitalRadii(bounds).chords;

  ctx.save();
  ctx.translate(bounds.width / 2, bounds.height / 2);
  ctx.rotate(frame.globalRotation * 0.5);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TWO_PI);
  ctx.stroke();
  ctx.font = '10px "Cascadia Mono", "SFMono-Regular", Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ORBITAL_CHORDS.forEach((chord, index) => {
    const intensity = resolveChordIntensity(features.chroma, index, audioSnapshot.playback.progress);
    const angle = (index / ORBITAL_CHORDS.length) * TWO_PI - Math.PI / 2;
    const point = pointOnCircle(radius, angle);

    ctx.fillStyle = intensity > 0.5 ? '#ffffff' : '#444444';
    ctx.shadowColor = colorWithAlpha(ORBITAL_COLORS.highlight, 0.35 + intensity * 0.4);
    ctx.shadowBlur = intensity > 0.5 ? 5 + intensity * 15 : 0;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 2 + intensity * 4.5, 0, TWO_PI);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.save();
    ctx.translate(Math.cos(angle) * (radius - 18), Math.sin(angle) * (radius - 18));
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.38 + intensity * 0.62})`;
    ctx.fillText(chord, 0, 0);
    ctx.restore();
  });
  ctx.restore();
}

export function drawProgressOrbit(
  ctx: VisualizerCanvasContext,
  render: VisualizerRenderContext,
  staticSpectrum: number[]
): void {
  const { bounds, audioSnapshot } = render;
  const radius = getOrbitalRadii(bounds).progress;
  const progress = clamp(audioSnapshot.playback.progress, 0, 1);

  ctx.save();
  ctx.translate(bounds.width / 2, bounds.height / 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TWO_PI);
  ctx.stroke();

  const segments = staticSpectrum.length > 0 ? staticSpectrum : createStaticSpectrum(180);
  segments.forEach((value, index) => {
    const ratio = index / segments.length;
    const angle = ratio * TWO_PI - Math.PI / 2;
    const extend = Math.max(1, value * 15);
    const start = pointOnCircle(radius - extend, angle);
    const end = pointOnCircle(radius + extend, angle);
    const isPlayed = ratio <= progress;
    const color = ORBITAL_COLORS.chords[Math.floor(ratio * ORBITAL_COLORS.chords.length)] ?? ORBITAL_COLORS.progress;

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.lineCap = 'round';
    ctx.strokeStyle = isPlayed ? colorWithAlpha(color, 0.9) : 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = isPlayed ? 3 : 1.5;
    ctx.stroke();
  });

  if (progress > 0) {
    const angle = progress * TWO_PI - Math.PI / 2;
    const indicator = pointOnCircle(radius, angle);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(indicator.x, indicator.y, 4, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

export function drawParticleFlow(
  ctx: VisualizerCanvasContext,
  render: VisualizerRenderContext,
  particles: OrbitalParticle[]
): void {
  const { bounds, audioSnapshot } = render;
  const radius = getOrbitalRadii(bounds).progress;
  const progress = clamp(audioSnapshot.playback.progress, 0, 1);
  const angle = progress * TWO_PI - Math.PI / 2;
  const origin = pointOnCircle(radius, angle);
  const energy = audioSnapshot.analysis.smoothedEnergy;

  ctx.save();
  ctx.translate(bounds.width / 2, bounds.height / 2);
  if (progress > 0 && audioSnapshot.playback.isPlaying) {
    const emitCount = Math.floor(Math.random() * (1 + energy * 8));
    for (let index = 0; index < emitCount; index += 1) {
      const trailAngle = angle - Math.PI / 2 + (Math.random() - 0.5) * Math.PI;
      const speed = Math.random() * 1.5 + 0.5;
      particles.push({
        x: origin.x,
        y: origin.y,
        vx: Math.cos(trailAngle) * speed,
        vy: Math.sin(trailAngle) * speed,
        maxLife: Math.random() * 40 + 20,
        life: Math.random() * 40 + 20,
        colorIndex: Math.floor(Math.random() * ORBITAL_COLORS.chords.length),
        size: Math.random() * 2 + 0.5,
      });
    }
  }

  ctx.globalCompositeOperation = 'lighter';
  for (let index = particles.length - 1; index >= 0; index -= 1) {
    const particle = particles[index];
    if (!particle) continue;

    particle.x += particle.vx * (1 + energy * 2);
    particle.y += particle.vy * (1 + energy * 2);
    particle.vx *= 0.98;
    particle.vy *= 0.98;
    particle.life -= 1;

    if (particle.life <= 0) {
      particles.splice(index, 1);
      continue;
    }

    const color = ORBITAL_COLORS.chords[particle.colorIndex] ?? ORBITAL_COLORS.progress;
    const alpha = Math.max(0, particle.life / particle.maxLife) * 0.8;
    ctx.fillStyle = colorWithAlpha(color, alpha);
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, TWO_PI);
    ctx.fill();
  }

  if (particles.length > 300) {
    particles.splice(0, particles.length - 300);
  }
  ctx.restore();
}

export function updateMorseArcs(render: VisualizerRenderContext, frame: VisualizerFrameInfo, arcs: MorseArc[]): void {
  if (frame.frameNumber % 10 === 0 && render.audioSnapshot.playback.isPlaying) {
    const peak = resolvePeakFrequency(render.audioSnapshot);
    const source = peak > 0 ? String(peak) : 'SYS';
    arcs.push({
      angle: Math.random() * TWO_PI,
      morse: stringToMorse(source),
      life: 1,
      radiusOffset: 10 + Math.random() * 20,
    });
  }

  for (let index = arcs.length - 1; index >= 0; index -= 1) {
    const arc = arcs[index];
    if (!arc) continue;
    arc.life -= 0.015;
    if (arc.life <= 0) {
      arcs.splice(index, 1);
    }
  }
}

export function drawMorseTelemetry(ctx: VisualizerCanvasContext, render: VisualizerRenderContext, arcs: MorseArc[]): void {
  const { bounds } = render;
  const radius = getOrbitalRadii(bounds).morse;

  ctx.save();
  ctx.translate(bounds.width / 2, bounds.height / 2);
  for (const arc of arcs) {
    let currentAngle = arc.angle;
    const drawRadius = radius + arc.radiusOffset;
    ctx.strokeStyle = colorWithAlpha(ORBITAL_COLORS.phase, arc.life * 0.6);
    ctx.lineWidth = 2;
    ctx.shadowColor = colorWithAlpha(ORBITAL_COLORS.phase, 0.4);
    ctx.shadowBlur = 5 * arc.life;

    for (const char of arc.morse) {
      ctx.beginPath();
      if (char === '.') {
        ctx.arc(0, 0, drawRadius, currentAngle, currentAngle + 0.015);
        ctx.stroke();
        currentAngle += 0.03;
      } else if (char === '-') {
        ctx.arc(0, 0, drawRadius, currentAngle, currentAngle + 0.05);
        ctx.stroke();
        currentAngle += 0.065;
      } else {
        currentAngle += 0.04;
      }
    }
  }
  ctx.restore();
}

export function drawCenterConsole(
  ctx: VisualizerCanvasContext,
  render: VisualizerRenderContext,
  features: TonalityFeatures
): void {
  const { bounds, audioSnapshot } = render;
  const radii = getOrbitalRadii(bounds);
  const outerRadius = Math.max(0, radii.chords + 5);
  const innerRadius = Math.max(0, radii.chords - 5);
  const currentTime = formatClock(audioSnapshot.playback.currentTime, { centiseconds: true });

  ctx.save();
  ctx.translate(bounds.width / 2, bounds.height / 2);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, innerRadius);
  gradient.addColorStop(0, 'rgba(5, 5, 5, 0.95)');
  gradient.addColorStop(0.7, 'rgba(5, 5, 5, 0.85)');
  gradient.addColorStop(1, 'rgba(5, 5, 5, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, outerRadius, 0, TWO_PI);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(0, radii.chords - 15), 0, TWO_PI);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (audioSnapshot.playback.isPlaying) {
    drawDotText(ctx, currentTime, 0, -20, 2, 1.5, '#eeeeee');
    ctx.font = '12px "Cascadia Mono", "SFMono-Regular", Consolas, monospace';
    ctx.fillStyle = colorWithAlpha(ORBITAL_COLORS.highlight, 0.92);
    ctx.fillText(features.chord, 0, 12);
    ctx.font = '10px "Cascadia Mono", "SFMono-Regular", Consolas, monospace';
    ctx.fillStyle = colorWithAlpha(ORBITAL_COLORS.progress, 0.8);
    ctx.fillText(`KEY: ${features.key}`, 0, 28);
  } else {
    drawDotText(ctx, currentTime, 0, -15, 2, 1.5, '#cccccc');
    ctx.font = '12px "Cascadia Mono", "SFMono-Regular", Consolas, monospace';
    ctx.fillStyle = colorWithAlpha(ORBITAL_COLORS.progress, 0.6);
    ctx.fillText('SYS_STANDBY', 0, 15);
  }
  ctx.restore();
}

export function drawTrackHeader(ctx: VisualizerCanvasContext, render: VisualizerRenderContext): void {
  const { bounds, audioSnapshot } = render;
  const title = audioSnapshot.track?.title?.trim() || 'VISUALIZER';
  const subtitle = audioSnapshot.track?.artist?.trim() || (audioSnapshot.playback.isPlaying ? 'SIGNAL ONLINE' : 'SYSTEM READY');

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '760 24px "Segoe UI", Inter, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
  ctx.shadowColor = 'rgba(255, 255, 255, 0.18)';
  ctx.shadowBlur = 10;
  ctx.fillText(title, bounds.width / 2, 28, Math.max(160, bounds.width - 20));
  ctx.shadowBlur = 0;

  if (subtitle) {
    ctx.font = '600 12px "Segoe UI", Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
    ctx.fillText(subtitle, bounds.width / 2, 54, Math.max(160, bounds.width - 40));
  }
  ctx.restore();
}
