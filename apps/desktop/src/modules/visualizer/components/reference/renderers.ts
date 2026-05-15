import type { VisualizerFrameInfo, VisualizerRenderContext } from '../../types';
import { clamp01 } from './styleModel';
import type { ReferenceTonalityFeatures } from './audioFeatures';
import { resolveChordIntensity, resolvePeakFrequency } from './audioFeatures';
import {
  CHORDS,
  COLORS,
  TWO_PI,
  drawDotText,
  formatTime,
  getReferenceRadii,
  pointOnCircle,
  stringToMorse,
  type ReferenceCanvasContext,
} from './styleModel';

export interface ReferenceParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface ReferenceMorseArc {
  angle: number;
  morse: string;
  life: number;
  radiusOffset: number;
}

export interface ReferenceSpectrumSmoothingState {
  values: Float32Array;
  lastUpdatedAt: number | null;
}

export interface ReferenceProgressSpectrumState {
  values: Float32Array;
  trackKey: string | null;
}

export function createReferenceSpectrumSmoothingState(): ReferenceSpectrumSmoothingState {
  return {
    values: new Float32Array(0),
    lastUpdatedAt: null,
  };
}

export function createReferenceProgressSpectrumState(): ReferenceProgressSpectrumState {
  return {
    values: new Float32Array(360),
    trackKey: null,
  };
}

function isLive(snapshot: VisualizerRenderContext['audioSnapshot']): boolean {
  return snapshot.frequency.length > 0;
}

function isPlaying(snapshot: VisualizerRenderContext['audioSnapshot']): boolean {
  return snapshot.playback.isPlaying;
}

function sampleSmoothedFrequencyValue(state: ReferenceSpectrumSmoothingState, ratio: number): number {
  const data = state.values;
  if (data.length === 0) return 0;
  if (data.length === 1) return data[0] ?? 0;

  const position = Math.max(0, Math.min(1, ratio)) * (data.length - 1);
  const leftIndex = Math.floor(position);
  const rightIndex = Math.min(data.length - 1, leftIndex + 1);
  const fraction = position - leftIndex;
  const left = data[leftIndex] ?? 0;
  const right = data[rightIndex] ?? left;
  return left + (right - left) * fraction;
}

function resolveProgressTrackKey(render: VisualizerRenderContext): string {
  const track = render.audioSnapshot.track;
  return [
    track?.title ?? '',
    track?.artist ?? '',
    track?.album ?? '',
    Math.round(render.audioSnapshot.playback.duration * 1000),
  ].join('|');
}

function resolveProgressSpectrumValue(state: ReferenceProgressSpectrumState, ratio: number): number {
  return state.values[Math.floor(clamp01(ratio) * Math.max(0, state.values.length - 1))] ?? 0;
}

export function updateReferenceSpectrumSmoothing(
  state: ReferenceSpectrumSmoothingState,
  render: VisualizerRenderContext,
  frame: VisualizerFrameInfo,
  alpha = 0.35
): void {
  const data = render.audioSnapshot.frequency;
  if (data.length === 0) {
    state.values = new Float32Array(0);
    state.lastUpdatedAt = null;
    return;
  }

  if (state.values.length !== data.length) {
    state.values = new Float32Array(data.length);
    for (let index = 0; index < data.length; index += 1) {
      state.values[index] = (data[index] ?? 0) / 255;
    }
    state.lastUpdatedAt = Number.isFinite(frame.timestamp) ? frame.timestamp : render.audioSnapshot.timestamp;
    return;
  }

  const timestamp = Number.isFinite(frame.timestamp) ? frame.timestamp : render.audioSnapshot.timestamp;
  const previousTimestamp = state.lastUpdatedAt ?? timestamp;
  const deltaFrames = Math.max(1, Math.min(6, Math.max(0, timestamp - previousTimestamp) / 16.67));
  const safeAlpha = 1 - Math.pow(1 - Math.max(0, Math.min(1, alpha)), deltaFrames);
  for (let index = 0; index < data.length; index += 1) {
    const target = (data[index] ?? 0) / 255;
    state.values[index] = (state.values[index] ?? 0) * (1 - safeAlpha) + target * safeAlpha;
  }
  state.lastUpdatedAt = timestamp;
}

export function updateReferenceProgressSpectrum(
  state: ReferenceProgressSpectrumState,
  render: VisualizerRenderContext
): void {
  if (state.values.length !== 360) {
    state.values = new Float32Array(360);
  }

  const { audioSnapshot } = render;
  const trackKey = resolveProgressTrackKey(render);
  if (state.trackKey !== trackKey) {
    state.values = new Float32Array(360);
    state.trackKey = trackKey;
  }

  if (audioSnapshot.frequency.length === 0 || !audioSnapshot.playback.isPlaying) {
    return;
  }

  const progress = clamp01(audioSnapshot.playback.progress);
  const centerIndex = Math.max(0, Math.min(359, Math.floor(progress * 360)));
  const energy = Math.max(
    audioSnapshot.analysis.bass * 0.45 + audioSnapshot.analysis.mid * 0.35 + audioSnapshot.analysis.treble * 0.2,
    audioSnapshot.analysis.smoothedEnergy * 0.65
  );
  const shaped = Math.max(0.04, Math.min(1, Math.pow(energy, 0.72)));

  for (let offset = -2; offset <= 2; offset += 1) {
    const index = (centerIndex + offset + 360) % 360;
    const falloff = 1 - Math.abs(offset) / 3;
    const target = shaped * falloff;
    state.values[index] = Math.max(state.values[index] ?? 0, target);
  }

  for (let index = 0; index < state.values.length; index += 1) {
    const previous = state.values[(index - 1 + state.values.length) % state.values.length] ?? 0;
    const current = state.values[index] ?? 0;
    const next = state.values[(index + 1) % state.values.length] ?? 0;
    state.values[index] = current * 0.86 + ((previous + next) / 2) * 0.08;
  }
}

export function createReferenceParticle(originX: number, originY: number, baseAngle: number): ReferenceParticle {
  const trailAngle = baseAngle - Math.PI / 2;
  const spreadAngle = trailAngle + (Math.random() - 0.5) * Math.PI;
  const speed = Math.random() * 1.5 + 0.5;
  const maxLife = Math.random() * 40 + 20;

  return {
    x: originX,
    y: originY,
    vx: Math.cos(spreadAngle) * speed,
    vy: Math.sin(spreadAngle) * speed,
    maxLife,
    life: maxLife,
    size: Math.random() * 2 + 0.5,
    color: COLORS.chords[Math.floor(Math.random() * COLORS.chords.length)] ?? COLORS.progress,
  };
}

function drawParticle(
  ctx: ReferenceCanvasContext,
  particle: ReferenceParticle,
  energy: number
): boolean {
  particle.x += particle.vx * (1 + energy * 2);
  particle.y += particle.vy * (1 + energy * 2);
  particle.vx *= 0.98;
  particle.vy *= 0.98;
  particle.life -= 1;

  if (particle.life <= 0) return false;

  const alpha = Math.max(0, particle.life / particle.maxLife) * 0.8;
  ctx.beginPath();
  ctx.arc(particle.x, particle.y, particle.size, 0, TWO_PI);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = particle.color;
  ctx.fill();
  ctx.globalAlpha = 1;
  return true;
}

export function drawReferencePhase(
  ctx: ReferenceCanvasContext,
  frame: VisualizerFrameInfo,
  render: VisualizerRenderContext
): void {
  const { bounds, audioSnapshot } = render;
  const radius = getReferenceRadii(bounds).phase;
  const energy = audioSnapshot.analysis.smoothedEnergy;
  const timeData = audioSnapshot.timeDomain;
  const live = isLive(audioSnapshot) && timeData.length > 0;

  ctx.save();
  ctx.translate(bounds.width / 2, bounds.height / 2);

  const phaseGlow = live ? 0.05 + energy * 0.8 : 0.05;
  ctx.strokeStyle = `rgba(20, 184, 166, ${phaseGlow})`;
  ctx.lineWidth = 1 + energy * 2;
  ctx.shadowColor = 'rgba(20, 184, 166, 0.5)';
  ctx.shadowBlur = energy * 15;

  ctx.beginPath();
  ctx.moveTo(0, -radius);
  ctx.lineTo(radius, 0);
  ctx.lineTo(0, radius);
  ctx.lineTo(-radius, 0);
  ctx.closePath();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -radius);
  ctx.lineTo(0, radius);
  ctx.moveTo(-radius, 0);
  ctx.lineTo(radius, 0);
  ctx.stroke();

  if (live) {
    ctx.fillStyle = 'rgba(167, 243, 208, 0.8)';
    const maxDots = 360;
    const stride = Math.max(2, Math.floor((timeData.length - 4) / maxDots));
    const channelOffset = Math.max(4, Math.floor(stride * 1.75));
    for (let index = 0; index < timeData.length - channelOffset; index += stride) {
      const left = ((timeData[index] ?? 128) / 128) - 1;
      const right = ((timeData[index + channelOffset] ?? 128) / 128) - 1;
      const phaseSpread = Math.max(0.5, 1 + audioSnapshot.analysis.spectralCentroid * 0.7);
      const x = (right - left) * (radius * 0.5) * phaseSpread;
      const y = -(left + right) * (radius * 0.42);
      const dot = 1.5;
      ctx.fillRect(x, y, dot, dot);
    }
  } else {
    ctx.fillStyle = 'rgba(167, 243, 208, 0.2)';
    for (let index = 0; index < 150; index += 1) {
      const left = Math.sin(index * 0.1 + frame.globalRotation * 10) * Math.sin(index * 0.05) * 0.8;
      const right = Math.cos(index * 0.12 + frame.globalRotation * 12) * Math.cos(index * 0.07) * 0.8;
      const x = (right - left) * (radius * 0.45);
      const y = -(left + right) * (radius * 0.45);
      const dot = 1;
      ctx.fillRect(x, y, dot, dot);
    }
  }

  ctx.restore();
}

export function drawReferenceFrequency(
  ctx: ReferenceCanvasContext,
  frame: VisualizerFrameInfo,
  render: VisualizerRenderContext,
  smoothing: ReferenceSpectrumSmoothingState
): void {
  const { bounds } = render;
  const radius = getReferenceRadii(bounds).freq;

  ctx.save();
  ctx.translate(bounds.width / 2, bounds.height / 2);
  ctx.rotate(-frame.globalRotation * 0.2);
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TWO_PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(0, radius - 5), 0, TWO_PI);
  ctx.stroke();

  if (smoothing.values.length > 0) {
    const bars = 180;
    for (let index = 0; index < bars; index += 1) {
      const value = sampleSmoothedFrequencyValue(smoothing, index / Math.max(1, bars - 1));
      const angle = (index / bars) * TWO_PI;
      const length = Math.pow(value, 0.72) * 58;
      const innerRadius = radius - length * 0.5;
      const outerRadius = radius + length * 0.5;
      const inner = pointOnCircle(innerRadius, angle);
      const outer = pointOnCircle(outerRadius, angle);

      ctx.strokeStyle = `hsla(${180 + value * 160}, 100%, 60%, 0.8)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(inner.x, inner.y);
      ctx.lineTo(outer.x, outer.y);
      ctx.stroke();
    }
  }

  ctx.restore();
}

export function drawReferenceChords(
  ctx: ReferenceCanvasContext,
  frame: VisualizerFrameInfo,
  render: VisualizerRenderContext,
  features: ReferenceTonalityFeatures
): void {
  const { bounds, audioSnapshot } = render;
  const radius = getReferenceRadii(bounds).chords;
  const currentChordIndex = Math.floor(audioSnapshot.playback.currentTime / 5) % CHORDS.length;

  ctx.save();
  ctx.translate(bounds.width / 2, bounds.height / 2);
  ctx.rotate(frame.globalRotation * 0.5);

  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TWO_PI);
  ctx.stroke();

  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  CHORDS.forEach((chord, index) => {
    const intensity = isLive(audioSnapshot)
      ? resolveChordIntensity(features.chroma, index, currentChordIndex)
      : index === currentChordIndex
        ? 1
        : 0;
    const angle = (index / CHORDS.length) * TWO_PI - Math.PI / 2;
    const point = pointOnCircle(radius, angle);

    ctx.fillStyle = `rgba(245, 158, 11, ${0.2 + intensity * 0.8})`;
    if (intensity > 0.5) {
      ctx.shadowColor = COLORS.highlight;
      ctx.shadowBlur = 5 + intensity * 15;
      ctx.fillStyle = '#fff';
    } else {
      ctx.fillStyle = '#444';
    }

    ctx.beginPath();
    ctx.arc(point.x, point.y, 2 + intensity * 4.5, 0, TWO_PI);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.save();
    ctx.translate(Math.cos(angle) * (radius - 18), Math.sin(angle) * (radius - 18));
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + intensity * 0.6})`;
    ctx.fillText(chord, 0, 0);
    ctx.restore();
  });

  ctx.restore();
}

export function drawReferenceProgress(
  ctx: ReferenceCanvasContext,
  render: VisualizerRenderContext,
  spectrumState: ReferenceProgressSpectrumState
): void {
  const { bounds, audioSnapshot } = render;
  const radius = getReferenceRadii(bounds).progress;
  const progress = clamp01(audioSnapshot.playback.progress);

  ctx.save();
  ctx.translate(bounds.width / 2, bounds.height / 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TWO_PI);
  ctx.stroke();

  const segCount = 180;
  for (let index = 0; index < segCount; index += 1) {
    const angle = (index / segCount) * TWO_PI - Math.PI / 2;
    const ratio = index / segCount;
    const dataVal = resolveProgressSpectrumValue(spectrumState, ratio);
    const isPlayed = index / segCount <= progress;
    const centroid = audioSnapshot.analysis.spectralCentroid;
    const extendDist = Math.max(1, dataVal * 15);
    const inner = pointOnCircle(radius - extendDist, angle);
    const outer = pointOnCircle(radius + extendDist, angle);

    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(outer.x, outer.y);
    ctx.lineCap = 'round';
    if (isPlayed) {
      const chordIndex = Math.floor((ratio + centroid * 0.25) * COLORS.chords.length) % COLORS.chords.length;
      ctx.strokeStyle = COLORS.chords[chordIndex] ?? COLORS.progress;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2.6 + dataVal * 1.8;
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5;
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  if (progress > 0) {
    const currentAngle = progress * TWO_PI - Math.PI / 2;
    const indicator = pointOnCircle(radius, currentAngle);
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(indicator.x, indicator.y, 4, 0, TWO_PI);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

export function drawReferenceProgressTooltip(ctx: ReferenceCanvasContext, render: VisualizerRenderContext): void {
  const { bounds, audioSnapshot, config } = render;
  const radius = getReferenceRadii(bounds).progress;
  const hoverInfo = config.hoverInfo as { active: boolean; angle: number; distance: number } | undefined;
  const duration = audioSnapshot.playback.duration;
  if (!hoverInfo?.active || !duration) return;

  let hoverAngleFromTop = hoverInfo.angle + Math.PI / 2;
  if (hoverAngleFromTop < 0) hoverAngleFromTop += TWO_PI;

  const hoverTime = (hoverAngleFromTop / TWO_PI) * duration;
  const rootIndex = Math.floor(hoverTime / 2) % CHORDS.length;
  const quality = Math.floor(hoverTime) % 2 === 0 ? 'Maj' : 'Min';
  const hoverChord = `${CHORDS[rootIndex]} ${quality}`;
  const hover = pointOnCircle(radius, hoverInfo.angle);

  ctx.save();
  ctx.translate(bounds.width / 2, bounds.height / 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(hover.x * 0.8, hover.y * 0.8);
  ctx.lineTo(hover.x, hover.y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(hover.x, hover.y, 4, 0, TWO_PI);
  ctx.fill();

  const tooltip = pointOnCircle(radius + 35, hoverInfo.angle);
  ctx.translate(tooltip.x, tooltip.y);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = 'rgba(10, 10, 10, 0.9)';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.roundRect(-45, -25, 90, 50, 4);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#fff';
  ctx.font = '12px monospace';
  ctx.fillText(formatTime(hoverTime), 0, -8);

  ctx.fillStyle = COLORS.highlight;
  ctx.font = '10px monospace';
  ctx.fillText(`EST: ${hoverChord}`, 0, 10);
  ctx.restore();
}

export function drawReferenceParticles(
  ctx: ReferenceCanvasContext,
  render: VisualizerRenderContext,
  particles: ReferenceParticle[]
): void {
  const { bounds, audioSnapshot } = render;
  const radius = getReferenceRadii(bounds).progress;
  const progress = clamp01(audioSnapshot.playback.progress);
  const currentAngle = progress * TWO_PI - Math.PI / 2;
  const energy = audioSnapshot.analysis.smoothedEnergy;

  ctx.save();
  ctx.translate(bounds.width / 2, bounds.height / 2);
  if (progress > 0 && isPlaying(audioSnapshot)) {
    const origin = pointOnCircle(radius, currentAngle);
    const emitCount = Math.floor(Math.random() * (1 + energy * 8));
    for (let index = 0; index < emitCount; index += 1) {
      particles.push(createReferenceParticle(origin.x, origin.y, currentAngle));
    }
  }

  for (let index = particles.length - 1; index >= 0; index -= 1) {
    const particle = particles[index];
    if (!particle) continue;
    if (!drawParticle(ctx, particle, energy)) {
      particles.splice(index, 1);
    }
  }

  if (particles.length > 300) {
    particles.splice(0, particles.length - 300);
  }
  ctx.restore();
}

export function updateReferenceMorseArcs(
  render: VisualizerRenderContext,
  frame: VisualizerFrameInfo,
  arcs: ReferenceMorseArc[]
): void {
  if (frame.frameNumber % 10 === 0 && render.audioSnapshot.playback.isPlaying) {
    const peak = resolvePeakFrequency(render.audioSnapshot);
    if (peak.value > 50 || render.audioSnapshot.frequency.length === 0) {
      arcs.push({
        angle: Math.random() * TWO_PI,
        morse: stringToMorse(render.audioSnapshot.frequency.length > 0 ? String(peak.frequency) : 'SYS'),
        life: 1,
        radiusOffset: 10 + Math.random() * 20,
      });
    }
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

export function drawReferenceMorse(
  ctx: ReferenceCanvasContext,
  render: VisualizerRenderContext,
  arcs: ReferenceMorseArc[]
): void {
  const { bounds } = render;
  const radius = getReferenceRadii(bounds).freq;

  ctx.save();
  ctx.translate(bounds.width / 2, bounds.height / 2);
  for (const arc of arcs) {
    let currentAngle = arc.angle;
    const drawRadius = radius + arc.radiusOffset;
    ctx.strokeStyle = `rgba(20, 184, 166, ${arc.life * 0.6})`;
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(20, 184, 166, 0.4)';
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
      } else if (char === ' ') {
        currentAngle += 0.04;
      }
    }
  }
  ctx.restore();
}

export function drawReferenceCenter(
  ctx: ReferenceCanvasContext,
  render: VisualizerRenderContext,
  features: ReferenceTonalityFeatures
): void {
  const { bounds, audioSnapshot } = render;
  const radiusChords = getReferenceRadii(bounds).chords;
  const currentTime = audioSnapshot.playback.currentTime;

  ctx.save();
  ctx.translate(bounds.width / 2, bounds.height / 2);

  const outerRadius = Math.max(0, radiusChords + 5);
  const innerRadius = Math.max(0, radiusChords - 5);
  const centerBg = ctx.createRadialGradient(0, 0, 0, 0, 0, innerRadius);
  centerBg.addColorStop(0, 'rgba(5, 5, 5, 0.72)');
  centerBg.addColorStop(0.58, 'rgba(5, 5, 5, 0.52)');
  centerBg.addColorStop(0.82, 'rgba(5, 5, 5, 0.24)');
  centerBg.addColorStop(1, 'rgba(5, 5, 5, 0)');
  ctx.fillStyle = centerBg;
  ctx.beginPath();
  ctx.arc(0, 0, outerRadius, 0, TWO_PI);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  const rimRadius = Math.max(0, radiusChords - 15);
  ctx.beginPath();
  ctx.arc(0, 0, rimRadius, 0, TWO_PI);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const timeStr = formatTime(currentTime);
  if (audioSnapshot.playback.isPlaying) {
    drawDotText(ctx, timeStr, 0, -20, 2, 1.5, '#eee');

    ctx.font = '12px monospace';
    ctx.fillStyle = COLORS.highlight;
    ctx.fillText(features.chord, 0, 12);

    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.fillText(`KEY: ${features.key}`, 0, 28);
  } else {
    drawDotText(ctx, timeStr, 0, -15, 2, 1.5, '#ccc');

    ctx.font = '12px monospace';
    ctx.fillStyle = 'rgba(59, 130, 246, 0.6)';
    ctx.fillText('SYS_STANDBY', 0, 15);
  }

  ctx.restore();
}

export function drawReferenceHud(
  ctx: ReferenceCanvasContext,
  frame: VisualizerFrameInfo,
  render: VisualizerRenderContext,
  smoothing: ReferenceSpectrumSmoothingState
): void {
  const { bounds, audioSnapshot } = render;

  ctx.save();
  ctx.translate(bounds.width / 2, bounds.height / 2);

  const halfWidth = 160;
  const halfHeight = 45;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.shadowColor = 'rgba(255, 255, 255, 0.4)';
  ctx.shadowBlur = 4;

  ctx.beginPath();
  ctx.moveTo(-halfWidth, -halfHeight);
  ctx.lineTo(halfWidth - 35, -halfHeight);
  ctx.lineTo(halfWidth, -halfHeight + 35);
  ctx.lineTo(halfWidth, halfHeight - 15);
  ctx.lineTo(halfWidth - 15, halfHeight);
  ctx.lineTo(50, halfHeight);
  ctx.lineTo(35, halfHeight - 15);
  ctx.lineTo(-halfWidth + 45, halfHeight - 15);
  ctx.lineTo(-halfWidth, halfHeight - 60);
  ctx.closePath();
  ctx.stroke();
  ctx.shadowBlur = 0;

  const bars = 45;
  const startX = -115;
  const areaWidth = 250;
  const barWidth = 2.5;
  const barSpacing = areaWidth / bars;
  const maxBarHeight = 45;

  ctx.fillStyle = '#ffffff';
  for (let index = 0; index < bars; index += 1) {
    let value = 0;
    if (smoothing.values.length > 0 && audioSnapshot.playback.isPlaying) {
      value = sampleSmoothedFrequencyValue(smoothing, (index / Math.max(1, bars - 1)) * 0.4);
      const envelope = Math.sin((index / (bars - 1)) * Math.PI);
      value *= envelope;
    } else {
      const envelope = Math.sin((index / (bars - 1)) * Math.PI);
      value = (Math.sin(frame.frameNumber * 0.05 + index * 0.3) * 0.2 + 0.2) * envelope;
    }

    value = Math.max(0.06, Math.pow(value, 0.68));
    const barHeight = value * maxBarHeight;
    const x = startX + index * barSpacing;
    const centerLine = -8;
    ctx.fillRect(x, centerLine - barHeight / 2, barWidth, barHeight);
  }

  ctx.restore();
}
