import React, { useEffect, useRef } from 'react';
import { useWindowActivity } from '../../contexts/WindowActivityContext';
import { useQuality } from '../../contexts/QualityContext';
import { BACKGROUND_RENDER_THROTTLE_FPS } from '../../contracts/performance';
import './AudioVisualizer.css';

interface AudioVisualizerProps {
  getFrequencyData: () => Uint8Array | null;
  isPlaying: boolean;
}

/**
 * Audio spectrum visualizer.
 *
 * Inspired by VCP's smoother "curve + glow" style:
 * - Uses easing to smooth FFT bins over time
 * - Draws a filled bezier curve with a subtle glow
 * - Responsive canvas sizing (ResizeObserver + DPR-aware)
 */
export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ getFrequencyData, isPlaying }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>();
  const { renderMode } = useWindowActivity();
  const { effective: quality } = useQuality();

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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

    // Smoothed spectrum data (VCP-style easing).
    let currentCurve: number[] = [];
    let targetCurve: number[] = [];

    const ensureLength = (len: number) => {
      if (targetCurve.length !== len) targetCurve = new Array(len).fill(0);
      if (currentCurve.length !== len) currentCurve = new Array(len).fill(0);
    };

    const resolveTargetCurve = (bins: Uint8Array, points: number) => {
      ensureLength(points);
      const binsPerPoint = bins.length / points;

      for (let i = 0; i < points; i++) {
        const start = Math.floor(i * binsPerPoint);
        const end = Math.max(start + 1, Math.floor((i + 1) * binsPerPoint));

        let max = 0;
        for (let j = start; j < end && j < bins.length; j++) {
          const v = bins[j] ?? 0;
          if (v > max) max = v;
        }

        let normalized = max / 255;
        normalized = Math.pow(normalized, 0.72); // perceptual shaping
        targetCurve[i] = normalized;
      }
    };

    const applyEasing = (factor: number) => {
      for (let i = 0; i < targetCurve.length; i++) {
        currentCurve[i] += (targetCurve[i] - currentCurve[i]) * factor;
      }
    };

    const decay = (factor: number) => {
      for (let i = 0; i < currentCurve.length; i++) {
        currentCurve[i] *= factor;
      }
    };

    const drawCurve = () => {
      const width = cssWidth;
      const height = cssHeight;
      if (width <= 1 || height <= 1) return;

      ctx.clearRect(0, 0, width, height);

      // Soft overlay so the curve reads consistently on top of the magnet background.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
      ctx.fillRect(0, 0, width, height);

      if (currentCurve.length < 2) return;

      // Bass energy drives a subtle glow.
      const bassBins = Math.max(1, Math.floor(currentCurve.length * 0.06));
      let bassEnergy = 0;
      for (let i = 0; i < bassBins; i++) bassEnergy += currentCurve[i] ?? 0;
      bassEnergy /= bassBins;
      const pulse = Math.min(1, bassEnergy * 1.8);

      const r = 0;
      const g = 255;
      const b = 136;

      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.65 + 0.25 * pulse})`);
      gradient.addColorStop(0.6, `rgba(${r}, ${g}, ${b}, ${0.22 + 0.12 * pulse})`);
      gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.02)`);

      const amplitude = 1.18;
      const points = currentCurve.length;
      const sliceWidth = width / (points - 1);

      const getPoint = (index: number) => {
        const value = currentCurve[index] ?? 0;
        const x = index * sliceWidth;
        const y = height - Math.min(1, value) * height * amplitude;
        return [x, Math.max(0, Math.min(height, y))] as const;
      };

      const tension = 0.5;

      // Filled smooth curve.
      ctx.save();
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(0, height);
      const [startX, startY] = getPoint(0);
      ctx.lineTo(startX, startY);
      for (let i = 0; i < points - 1; i++) {
        const [x1, y1] = getPoint(i);
        const [x2, y2] = getPoint(i + 1);
        const [prevX, prevY] = i > 0 ? getPoint(i - 1) : [x1, y1];
        const [nextX, nextY] = i < points - 2 ? getPoint(i + 2) : [x2, y2];

        const cp1x = x1 + ((x2 - prevX) / 6) * tension;
        const cp1y = y1 + ((y2 - prevY) / 6) * tension;
        const cp2x = x2 - ((nextX - x1) / 6) * tension;
        const cp2y = y2 - ((nextY - y1) / 6) * tension;

        if (i === 0) ctx.lineTo(x1, y1);
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Stroke + dots.
      ctx.save();
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.82 + 0.15 * pulse})`;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${0.35 + 0.35 * pulse})`;
      ctx.shadowBlur = 6 + pulse * 8;

      ctx.beginPath();
      ctx.moveTo(startX, startY);
      for (let i = 0; i < points - 1; i++) {
        const [x1, y1] = getPoint(i);
        const [x2, y2] = getPoint(i + 1);
        const [prevX, prevY] = i > 0 ? getPoint(i - 1) : [x1, y1];
        const [nextX, nextY] = i < points - 2 ? getPoint(i + 2) : [x2, y2];

        const cp1x = x1 + ((x2 - prevX) / 6) * tension;
        const cp1y = y1 + ((y2 - prevY) / 6) * tension;
        const cp2x = x2 - ((nextX - x1) / 6) * tension;
        const cp2y = y2 - ((nextY - y1) / 6) * tension;

        if (i === 0) ctx.lineTo(x1, y1);
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
      }
      ctx.stroke();

      const dotRadius = 0.9 + 0.6 * pulse;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.7 + 0.2 * pulse})`;
      for (let i = 0; i < points; i += 2) {
        const [x, y] = getPoint(i);
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    };

    let lastFrameAt = 0;

    const baseFps = Math.max(1, Math.min(240, quality.fpsEffects));
    const targetFps =
      renderMode === 'throttle'
        ? Math.min(baseFps, quality.fpsBackground, BACKGROUND_RENDER_THROTTLE_FPS)
        : Math.min(baseFps, quality.fpsForeground > 0 ? quality.fpsForeground : baseFps);

    const tick = (now: number) => {
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

      const frequencyData = getFrequencyData();
      const maxPoints = Math.max(12, Math.min(64, quality.visualizerBars));
      const pointCount = Math.min(maxPoints, frequencyData?.length ?? 0);

      if (frequencyData && isPlaying && pointCount > 1) {
        resolveTargetCurve(frequencyData, pointCount);
        applyEasing(0.18);
      } else {
        decay(0.88);
      }

      drawCurve();

      const shouldContinue = isPlaying || currentCurve.some((value) => value > 0.002);
      if (shouldContinue) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      resizeObserver?.disconnect();
    };
  }, [
    getFrequencyData,
    isPlaying,
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
