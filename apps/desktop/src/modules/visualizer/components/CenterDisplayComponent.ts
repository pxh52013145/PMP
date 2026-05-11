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

function fitText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  initialFontSize: number,
  fontFamily: string
): { fontSize: number; text: string } {
  const limit = Math.max(10, initialFontSize);
  for (let size = limit; size >= 10; size -= 1) {
    ctx.font = `600 ${size}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth) {
      return { fontSize: size, text };
    }
  }

  ctx.font = `600 10px ${fontFamily}`;
  const ellipsis = '...';
  if (ctx.measureText(ellipsis).width >= maxWidth) {
    return { fontSize: 10, text: ellipsis };
  }

  let output = text;
  while (output.length > 0 && ctx.measureText(`${output}${ellipsis}`).width > maxWidth) {
    output = output.slice(0, -1);
  }
  return { fontSize: 10, text: `${output}${ellipsis}` };
}

function makeManifest(): VisualizerComponentManifest {
  return {
    id: '@pmp/center-display',
    version: '1.0.0',
    formatVersion: 1,
    metadata: {
      name: 'Center Display',
      description: 'Track information and pulse ring for the visualizer core.',
      author: 'Pixel Matrix Player',
      tags: ['audio', 'track', 'center'],
      preview: 'Center',
    },
    engine: {
      apiVersion: '1.0.0',
      renderer: { type: 'canvas2d' },
      minFPS: 30,
    },
    capabilities: [
      { id: 'audio.state', required: true, reason: 'The center display shows track and playback state.' },
      { id: 'audio.analysis', required: true, reason: 'The center display uses energy and beat information.' },
    ],
    geometry: {
      type: 'rectangular',
      defaultSize: { width: 720, height: 250 },
      hitShape: { type: 'auto' },
    },
    defaultTransform: {
      position: { x: 0.5, y: 0.42 },
      scale: 1,
      rotation: 0,
      zIndex: 10,
      opacity: 1,
      visible: true,
    },
  };
}

function createCenterDisplayComponent(): VisualizerComponent {
  const manifest = makeManifest();

  return {
    manifest,
    initialize(_ctx: VisualizerComponentContext) {
      // No-op for the MVP runtime.
    },
    render(frame: VisualizerFrameInfo, ctx: VisualizerRenderContext) {
      const { ctx: canvas, bounds, audioSnapshot } = ctx;
      const track = audioSnapshot.track;
      const energy = audioSnapshot.analysis.smoothedEnergy;
      const beatPulse = clamp(audioSnapshot.analysis.beatStrength, 0, 1);
      const progress = clamp(audioSnapshot.playback.progress, 0, 1);
      const title = track?.title ?? '';
      const subtitle = [track?.artist, track?.album].filter(Boolean).join(' / ');
      const width = bounds.width;
      const height = bounds.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const outerRadius = Math.min(width, height) * 0.42;
      const innerRadius = outerRadius * (0.64 + beatPulse * 0.06);
      const ringRadius = outerRadius * (0.86 + energy * 0.08);

      canvas.save();
      drawRoundedRect(canvas, 0, 0, width, height, 28);
      canvas.fillStyle = 'rgba(5, 11, 18, 0.52)';
      canvas.fill();
      canvas.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      canvas.lineWidth = 1;
      canvas.stroke();

      canvas.translate(centerX, centerY);
      canvas.save();
      canvas.rotate(frame.globalRotation * 0.18);
      canvas.strokeStyle = `rgba(56, 189, 248, ${0.16 + beatPulse * 0.22})`;
      canvas.lineWidth = Math.max(2, outerRadius * 0.08);
      canvas.shadowBlur = 20 + beatPulse * 24;
      canvas.shadowColor = `rgba(251, 191, 36, ${0.35 + beatPulse * 0.15})`;
      canvas.beginPath();
      canvas.arc(0, 0, ringRadius, 0, Math.PI * 2);
      canvas.stroke();
      canvas.restore();

      canvas.strokeStyle = `rgba(74, 222, 128, ${0.1 + energy * 0.26})`;
      canvas.lineWidth = Math.max(1.5, outerRadius * 0.04);
      canvas.beginPath();
      canvas.arc(0, 0, innerRadius, 0, Math.PI * 2);
      canvas.stroke();

      canvas.strokeStyle = `rgba(255, 255, 255, 0.12)`;
      canvas.lineWidth = 2;
      canvas.beginPath();
      canvas.arc(0, 0, innerRadius * 0.72, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      canvas.stroke();

      canvas.fillStyle = 'rgba(255, 255, 255, 0.95)';
      canvas.textAlign = 'center';
      canvas.textBaseline = 'middle';
      canvas.font = `600 26px Inter, "Segoe UI", sans-serif`;
      const titleWidth = Math.max(1, width * 0.78);
      const fittedTitle = title ? fitText(canvas, title, titleWidth, 26, 'Inter, "Segoe UI", sans-serif') : null;
      if (fittedTitle) {
        canvas.font = `600 ${fittedTitle.fontSize}px Inter, "Segoe UI", sans-serif`;
        canvas.fillText(fittedTitle.text, 0, -18);
      }

      if (subtitle) {
        const fittedSubtitle = fitText(canvas, subtitle, width * 0.68, 14, 'Inter, "Segoe UI", sans-serif');
        canvas.font = `500 ${fittedSubtitle.fontSize}px Inter, "Segoe UI", sans-serif`;
        canvas.fillStyle = 'rgba(255, 255, 255, 0.68)';
        canvas.fillText(fittedSubtitle.text, 0, 16);
      }

      const timeText = `${Math.floor(audioSnapshot.playback.currentTime)} / ${Math.floor(audioSnapshot.playback.duration || 0)}s`;
      canvas.font = '500 12px Inter, "Segoe UI", sans-serif';
      canvas.fillStyle = 'rgba(255, 255, 255, 0.48)';
      canvas.fillText(timeText, 0, 42);

      canvas.restore();
    },
    dispose() {
      // No-op for the MVP runtime.
    },
    getHitBounds(): VisualizerHitBounds {
      const defaultSize = manifest.geometry.defaultSize as { width: number; height: number };
      return { type: 'rect', width: defaultSize.width, height: defaultSize.height };
    },
  };
}

export const CENTER_DISPLAY_COMPONENT_DEFINITION: VisualizerComponentDefinition = {
  manifest: makeManifest(),
  create: createCenterDisplayComponent,
};
