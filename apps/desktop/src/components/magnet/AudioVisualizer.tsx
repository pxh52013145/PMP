import React, { useEffect, useRef } from 'react';
import { useWindowActivity } from '../../contexts/WindowActivityContext';
import { useQuality } from '../../contexts/QualityContext';
import { BACKGROUND_RENDER_THROTTLE_FPS } from '../../contracts/performance';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import type {
  AudioVisualizerBackdropMode,
  AudioVisualizerDensity,
  AudioVisualizerEnergyProfile,
} from './audioVisualizerSkin';
import './AudioVisualizer.css';

type RgbColor = { r: number; g: number; b: number };

const DEFAULT_VISUALIZER_COLOR: RgbColor = { r: 23, g: 247, b: 0 };

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseCssColorToRgb(color: string | undefined): RgbColor | null {
  if (!color) return null;
  const value = color.trim();
  if (!value) return null;

  const rgbMatch = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+\s*)?\)$/i.exec(value);
  if (rgbMatch) {
    const red = Number(rgbMatch[1]);
    const green = Number(rgbMatch[2]);
    const blue = Number(rgbMatch[3]);
    if ([red, green, blue].every((channel) => Number.isFinite(channel))) {
      return { r: clampByte(red), g: clampByte(green), b: clampByte(blue) };
    }
  }

  const hexMatch = /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.exec(value);
  if (!hexMatch) return null;

  const hex = hexMatch[1] ?? '';
  if (hex.length === 3) {
    const red = parseInt(hex[0] + hex[0], 16);
    const green = parseInt(hex[1] + hex[1], 16);
    const blue = parseInt(hex[2] + hex[2], 16);
    return { r: red, g: green, b: blue };
  }

  const normalized = hex.length === 8 ? hex.slice(0, 6) : hex;
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return { r: red, g: green, b: blue };
}

interface AudioVisualizerProps {
  getFrequencyData: () => Uint8Array | null;
  isPlaying: boolean;
  accentColor?: string;
  fallbackAccentColor?: string;
  density?: AudioVisualizerDensity;
  energyProfile?: AudioVisualizerEnergyProfile;
  backdrop?: AudioVisualizerBackdropMode;
}

const DENSITY_SCALE: Record<AudioVisualizerDensity, number> = {
  sparse: 0.72,
  balanced: 1,
  dense: 1.28,
};

const ENERGY_PROFILE_STYLE: Record<
  AudioVisualizerEnergyProfile,
  {
    bandScale: number;
    strokeBaseAlpha: number;
    strokePulseAlpha: number;
    shadowBase: number;
    shadowPulse: number;
  }
> = {
  soft: {
    bandScale: 0.84,
    strokeBaseAlpha: 0.68,
    strokePulseAlpha: 0.12,
    shadowBase: 2,
    shadowPulse: 3.5,
  },
  balanced: {
    bandScale: 1,
    strokeBaseAlpha: 0.82,
    strokePulseAlpha: 0.16,
    shadowBase: 3,
    shadowPulse: 5,
  },
  bright: {
    bandScale: 1.16,
    strokeBaseAlpha: 0.9,
    strokePulseAlpha: 0.2,
    shadowBase: 4,
    shadowPulse: 7,
  },
};

const BACKDROP_ALPHA: Record<AudioVisualizerBackdropMode, number> = {
  none: 0,
  soft: 0.14,
  strong: 0.24,
};

const telemetry = getTelemetryLogger('visualizer', 'AudioVisualizer');

/**
 * Audio spectrum visualizer.
 *
 * Inspired by "017-audio-wave" radial waveform:
 * - Maps spectrum bins onto radial spokes
 * - Uses log-frequency mapping + perceptual tilt to avoid low-end dominance
 * - Smooths levels for a fluid pulse
 */
export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  getFrequencyData,
  isPlaying,
  accentColor,
  fallbackAccentColor,
  density = 'balanced',
  energyProfile = 'balanced',
  backdrop = 'soft',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>();
  const animationGenerationRef = useRef(0);
  const isPlayingRef = useRef(isPlaying);
  const animatingRef = useRef(false);
  const tickRef = useRef<((now: number) => void) | null>(null);
  const { renderMode } = useWindowActivity();
  const { effective: quality } = useQuality();

  useEffect(() => {
    telemetry.info('visualizer.audio.mount');
    return () => {
      telemetry.info('visualizer.audio.unmount');
    };
  }, []);

  useEffect(() => {
    telemetry.info('visualizer.audio.render-mode.changed', {
      fields: {
        renderMode,
        isPlaying,
      },
    });
  }, [isPlaying, renderMode]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    if (isPlaying && !animatingRef.current && tickRef.current) {
      animatingRef.current = true;
      rafRef.current = requestAnimationFrame(tickRef.current);
    }
  }, [isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const visualizerColor =
      parseCssColorToRgb(accentColor ?? fallbackAccentColor) ?? DEFAULT_VISUALIZER_COLOR;
    const densityScale = DENSITY_SCALE[density];
    const energyStyle = ENERGY_PROFILE_STYLE[energyProfile];
    const backdropAlpha = BACKDROP_ALPHA[backdrop];

    const animationGeneration = animationGenerationRef.current + 1;
    animationGenerationRef.current = animationGeneration;

    let cssWidth = 0;
    let cssHeight = 0;
    let dpr = 1;

    const resize = () => {
      const nextWidth = Math.max(1, Math.floor(container.clientWidth));
      const nextHeight = Math.max(1, Math.floor(container.clientHeight));
      const nextDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

      if (nextWidth === cssWidth && nextHeight === cssHeight && nextDpr === dpr) return;

      cssWidth = nextWidth;
      cssHeight = nextHeight;
      dpr = nextDpr;

      canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
      canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => resize())
        : null;
    resizeObserver?.observe(container);

    // Smoothed radial levels.
    let currentLevels: number[] = [];
    let targetLevels: number[] = [];
    let noiseSeeds: number[] = [];
    let phaseSeeds: number[] = [];
    let gainSeeds: number[] = [];
    let angleCache: Array<[number, number]> = [];
    let cachedLineCount = 0;

    const hash01 = (value: number) => {
      const s = Math.sin(value * 12.9898) * 43758.5453;
      return s - Math.floor(s);
    };

    const ensureLength = (len: number) => {
      if (targetLevels.length !== len) targetLevels = new Array(len).fill(0);
      if (currentLevels.length !== len) currentLevels = new Array(len).fill(0);
      if (noiseSeeds.length !== len) noiseSeeds = new Array(len).fill(0);
      if (phaseSeeds.length !== len) phaseSeeds = new Array(len).fill(0);
      if (gainSeeds.length !== len) gainSeeds = new Array(len).fill(0);
      if (cachedLineCount !== len) {
        cachedLineCount = len;
        angleCache = new Array(len);
        for (let i = 0; i < len; i++) {
          const angle = (i / len) * Math.PI * 2 - Math.PI / 2;
          angleCache[i] = [Math.cos(angle), Math.sin(angle)];
          const h1 = hash01(i * 1.37 + 0.1);
          const h2 = hash01(i * 2.17 + 0.7);
          noiseSeeds[i] = h1;
          phaseSeeds[i] = h2 * Math.PI * 2;
          gainSeeds[i] = 0.85 + 0.3 * h1;
        }
      }
    };

    const resolveTargetLevels = (bins: Uint8Array, lineCount: number, timeSec: number) => {
      ensureLength(lineCount);
      const binCount = bins.length;
      if (binCount <= 0) return;

      const minBin = 1;
      const maxBin = Math.max(minBin + 1, binCount - 1);
      const logMin = Math.log(minBin);
      const logMax = Math.log(maxBin);
      const logSpan = logMax - logMin;

      for (let i = 0; i < lineCount; i++) {
        const scramble = (i * 0.61803398875 + noiseSeeds[i] * 0.12) % 1;
        const t0 = scramble;
        const t1 = (scramble + 1 / lineCount) % 1;
        const idx0 = Math.floor(Math.exp(logMin + logSpan * t0));
        const idx1 = Math.max(idx0 + 1, Math.floor(Math.exp(logMin + logSpan * t1)));

        let acc = 0;
        let count = 0;
        for (let j = idx0; j < idx1 && j < binCount; j++) {
          acc += bins[j] ?? 0;
          count++;
        }
        const avg = count > 0 ? acc / count : 0;

        let normalized = avg / 255;
        normalized = Math.pow(normalized, 0.68); // compress dynamic range
        normalized = Math.min(1, normalized * gainSeeds[i]);

        const shimmer = Math.sin(timeSec * 3.2 + phaseSeeds[i]) * 0.04 * normalized;
        normalized = Math.max(0, Math.min(1, normalized + shimmer));

        targetLevels[i] = normalized;
      }
    };

    const applyEasing = (factor: number) => {
      for (let i = 0; i < targetLevels.length; i++) {
        currentLevels[i] += (targetLevels[i] - currentLevels[i]) * factor;
      }
    };

    const decay = (factor: number) => {
      for (let i = 0; i < currentLevels.length; i++) {
        currentLevels[i] *= factor;
      }
    };

    const drawRadial = () => {
      const width = cssWidth;
      const height = cssHeight;
      if (width <= 1 || height <= 1) return;

      ctx.clearRect(0, 0, width, height);

      // Soft overlay so the spokes read consistently on top of the magnet background.
      if (backdropAlpha > 0) {
        ctx.fillStyle = `rgba(0, 0, 0, ${backdropAlpha})`;
        ctx.fillRect(0, 0, width, height);
      }

      if (currentLevels.length < 2) return;

      // Bass energy drives a subtle glow.
      const bassBins = Math.max(1, Math.floor(currentLevels.length * 0.08));
      let bassEnergy = 0;
      for (let i = 0; i < bassBins; i++) bassEnergy += currentLevels[i] ?? 0;
      bassEnergy /= bassBins;
      const pulse = Math.min(1, bassEnergy * 1.8);

      const { r, g, b } = visualizerColor;

      const minSide = Math.min(width, height);
      const centerX = width / 2;
      const centerY = height / 2;
      const outerRadius = minSide * 0.48;
      const bandThickness = Math.max(8, outerRadius * 0.32 * energyStyle.bandScale);
      const midRadius = outerRadius - bandThickness * 0.5;

      // Spokes + glow.
      ctx.save();
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${energyStyle.strokeBaseAlpha + energyStyle.strokePulseAlpha * pulse})`;
      ctx.lineWidth = Math.max(0.9, Math.min(1.8, bandThickness * 0.02));
      ctx.lineJoin = 'miter';
      ctx.lineCap = 'butt';
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${0.16 + 0.28 * pulse})`;
      ctx.shadowBlur = energyStyle.shadowBase + pulse * energyStyle.shadowPulse;

      for (let i = 0; i < currentLevels.length; i++) {
        const raw = currentLevels[i] ?? 0;
        const level = Math.max(0, Math.min(1, raw));
        const length = Math.min(bandThickness, level * bandThickness);
        const half = length * 0.5;
        const [cos, sin] = angleCache[i] ?? [1, 0];
        const x1 = centerX + cos * (midRadius + half);
        const y1 = centerY + sin * (midRadius + half);
        const x2 = centerX + cos * (midRadius - half);
        const y2 = centerY + sin * (midRadius - half);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      ctx.restore();
    };

    let lastFrameAt = 0;
    let lastTickAt = 0;

    const baseFps = Math.max(1, Math.min(240, quality.fpsEffects));
    const targetFps =
      renderMode === 'throttle'
        ? Math.min(baseFps, quality.fpsBackground, BACKGROUND_RENDER_THROTTLE_FPS)
        : Math.min(baseFps, quality.fpsForeground > 0 ? quality.fpsForeground : baseFps);

    const tick = (now: number) => {
      if (animationGenerationRef.current !== animationGeneration) {
        return;
      }

      if (renderMode === 'pause') {
        ctx.clearRect(0, 0, cssWidth, cssHeight);
        return;
      }

      if (targetFps) {
        const minDeltaMs = 1000 / targetFps;
        const sinceLast = now - lastFrameAt;
        if (sinceLast < minDeltaMs) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        lastFrameAt = now - (sinceLast % minDeltaMs);
      }

      const elapsedMs = lastTickAt ? now - lastTickAt : targetFps ? 1000 / targetFps : 16.7;
      lastTickAt = now;

      const frequencyData = getFrequencyData();
      const maxLines = Math.max(48, Math.round(Math.max(180, Math.min(260, quality.visualizerBars * 5)) * densityScale));
      const lineCount = Math.min(maxLines, frequencyData?.length ? maxLines : 0);

      const playing = isPlayingRef.current;
      if (frequencyData && playing && lineCount > 1) {
        resolveTargetLevels(frequencyData, lineCount, now / 1000);
        applyEasing(0.24);
      } else {
        const decaySeconds = 1.1;
        const decayFactor = Math.exp(-elapsedMs / 1000 / decaySeconds);
        decay(decayFactor);
      }

      drawRadial();

      const shouldContinue = playing || currentLevels.some((value) => value > 0.002);
      if (shouldContinue) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        animatingRef.current = false;
      }
    };

    tickRef.current = tick;
    animatingRef.current = true;
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationGenerationRef.current === animationGeneration) {
        animationGenerationRef.current = animationGeneration + 1;
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      animatingRef.current = false;
      resizeObserver?.disconnect();
    };
  }, [
    accentColor,
    backdrop,
    density,
    energyProfile,
    fallbackAccentColor,
    getFrequencyData,
    quality.fpsBackground,
    quality.fpsEffects,
    quality.fpsForeground,
    quality.visualizerBars,
    renderMode,
  ]);

  return (
    <div ref={containerRef} className="audio-visualizer">
      <canvas ref={canvasRef} className="visualizer-canvas" />
    </div>
  );
};
