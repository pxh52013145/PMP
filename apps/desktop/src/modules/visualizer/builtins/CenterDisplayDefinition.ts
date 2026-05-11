import type {
  VisualizerAudioSnapshot,
  VisualizerComponent,
  VisualizerComponentContext,
  VisualizerComponentDefinition,
  VisualizerComponentManifest,
  VisualizerFrameInfo,
  VisualizerHitBounds,
  VisualizerRenderContext,
} from '../types';
import { clamp } from '../CoordinateSystem';

interface ParsedLyricLine {
  text: string;
  startMs?: number;
}

const TIME_TAG_PATTERN = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

function parseTimeTag(minutes: string, seconds: string, fraction: string | undefined): number {
  const min = Number.parseInt(minutes, 10);
  const sec = Number.parseInt(seconds, 10);
  const fractionText = fraction ?? '0';
  let ms = Number.parseInt(fractionText.slice(0, 3), 10);
  if (fractionText.length === 1) {
    ms = Number.parseInt(fractionText, 10) * 100;
  } else if (fractionText.length === 2) {
    ms = Number.parseInt(fractionText, 10) * 10;
  }
  return min * 60_000 + sec * 1000 + ms;
}

function parseLyrics(raw: string | undefined): ParsedLyricLine[] {
  const text = (raw ?? '').trim();
  if (!text) return [];

  const timedLines: ParsedLyricLine[] = [];
  const plainLines: ParsedLyricLine[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const timestamps: number[] = [];
    TIME_TAG_PATTERN.lastIndex = 0;
    let match = TIME_TAG_PATTERN.exec(line);
    while (match) {
      timestamps.push(parseTimeTag(match[1], match[2], match[3]));
      match = TIME_TAG_PATTERN.exec(line);
    }

    const lyricText = line.replace(TIME_TAG_PATTERN, '').trim();
    if (!lyricText) continue;

    if (timestamps.length > 0) {
      for (const startMs of timestamps) {
        timedLines.push({ text: lyricText, startMs });
      }
    } else {
      plainLines.push({ text: lyricText });
    }
  }

  if (timedLines.length > 0) {
    return timedLines.sort((left, right) => (left.startMs ?? 0) - (right.startMs ?? 0));
  }

  return plainLines;
}

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const sec = Math.floor(safe % 60);
  return `${minutes}:${sec.toString().padStart(2, '0')}`;
}

function makeFallbackLines(snapshot: VisualizerAudioSnapshot): ParsedLyricLine[] {
  const track = snapshot.track;
  if (track) {
    return [
      { text: track.title },
      ...(track.artist ? [{ text: track.artist }] : []),
      ...(track.album ? [{ text: track.album }] : []),
    ];
  }

  return [
    { text: 'SYSTEM STANDBY' },
    { text: 'AWAITING AUDIO INPUT' },
    { text: `${formatTime(snapshot.playback.currentTime)} / ${formatTime(snapshot.playback.duration)}` },
  ];
}

function resolveActiveLineIndex(lines: ParsedLyricLine[], snapshot: VisualizerAudioSnapshot): number {
  if (lines.length === 0) return -1;

  const hasTiming = lines.some((line) => typeof line.startMs === 'number');
  if (!hasTiming) {
    const index = Math.floor(clamp(snapshot.playback.progress, 0, 1) * lines.length);
    return Math.max(0, Math.min(lines.length - 1, index));
  }

  const currentMs = snapshot.playback.currentTime * 1000;
  let active = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const startMs = lines[index].startMs ?? 0;
    if (startMs <= currentMs) active = index;
    if (startMs > currentMs) break;
  }
  return active;
}

function resolveLineProgress(lines: ParsedLyricLine[], activeIndex: number, snapshot: VisualizerAudioSnapshot): number {
  if (activeIndex < 0) return 0;
  const line = lines[activeIndex];
  if (typeof line.startMs !== 'number') return clamp(snapshot.playback.progress, 0, 1);

  const nextStart = lines[activeIndex + 1]?.startMs;
  const endMs =
    typeof nextStart === 'number'
      ? nextStart
      : Math.max(line.startMs + 3000, snapshot.playback.duration * 1000);
  const span = Math.max(1, endMs - line.startMs);
  return clamp((snapshot.playback.currentTime * 1000 - line.startMs) / span, 0, 1);
}

function fitText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  initialFontSize: number,
  fontFamily: string,
  weight: number
): { fontSize: number; text: string } {
  const minSize = 12;
  for (let size = initialFontSize; size >= minSize; size -= 1) {
    ctx.font = `${weight} ${size}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth) {
      return { fontSize: size, text };
    }
  }

  ctx.font = `${weight} ${minSize}px ${fontFamily}`;
  const ellipsis = '...';
  if (ctx.measureText(ellipsis).width >= maxWidth) {
    return { fontSize: minSize, text: ellipsis };
  }

  let output = text;
  while (output.length > 0 && ctx.measureText(`${output}${ellipsis}`).width > maxWidth) {
    output = output.slice(0, -1);
  }
  return { fontSize: minSize, text: `${output}${ellipsis}` };
}

function drawText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: {
    maxWidth: number;
    size: number;
    weight: number;
    color: string;
    alpha?: number;
  }
): { width: number; fontSize: number; text: string } {
  const fontFamily = '"Segoe UI", Inter, system-ui, sans-serif';
  const fitted = fitText(ctx, text, options.maxWidth, options.size, fontFamily, options.weight);
  ctx.save();
  ctx.globalAlpha *= options.alpha ?? 1;
  ctx.font = `${options.weight} ${fitted.fontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = options.color;
  ctx.fillText(fitted.text, x, y);
  const width = ctx.measureText(fitted.text).width;
  ctx.restore();
  return { width, fontSize: fitted.fontSize, text: fitted.text };
}

function drawProgressText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: {
    maxWidth: number;
    size: number;
    weight: number;
    progress: number;
  }
): void {
  const base = drawText(ctx, text, x, y, {
    maxWidth: options.maxWidth,
    size: options.size,
    weight: options.weight,
    color: 'rgba(255, 255, 255, 0.42)',
  });

  ctx.save();
  ctx.beginPath();
  ctx.rect(x - base.width / 2 - 2, y - base.fontSize, (base.width + 4) * clamp(options.progress, 0, 1), base.fontSize * 2);
  ctx.clip();
  drawText(ctx, base.text, x, y, {
    maxWidth: options.maxWidth,
    size: base.fontSize,
    weight: options.weight,
    color: '#ffffff',
  });
  ctx.restore();
}

function drawTopMetadata(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  bounds: VisualizerRenderContext['bounds'],
  snapshot: VisualizerAudioSnapshot
): void {
  const title = snapshot.track?.title ?? 'VISUALIZER';
  const artist = snapshot.track?.artist ?? (snapshot.playback.isPlaying ? '' : 'SYSTEM READY');
  const centerX = bounds.width / 2;
  const topY = 68;

  drawText(ctx, title, centerX, topY, {
    maxWidth: Math.min(560, bounds.width - 180),
    size: 24,
    weight: 760,
    color: 'rgba(255, 255, 255, 0.88)',
  });

  if (artist) {
    drawText(ctx, artist, centerX, topY + 28, {
      maxWidth: Math.min(460, bounds.width - 180),
      size: 14,
      weight: 520,
      color: 'rgba(255, 255, 255, 0.52)',
    });
  }
}

function drawLyricStack(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  bounds: VisualizerRenderContext['bounds'],
  snapshot: VisualizerAudioSnapshot,
  lines: ParsedLyricLine[]
): void {
  if (lines.length === 0) return;

  const activeIndex = resolveActiveLineIndex(lines, snapshot);
  const lineProgress = resolveLineProgress(lines, activeIndex, snapshot);
  const centerX = bounds.width / 2;
  const centerY = bounds.height * 0.46;
  const rowStep = 58;
  const maxWidth = Math.min(980, bounds.width - 150);

  for (let offset = -4; offset <= 4; offset += 1) {
    const index = activeIndex + offset;
    if (index < 0 || index >= lines.length) continue;

    const y = centerY + offset * rowStep;
    const absOffset = Math.abs(offset);
    const isActive = offset === 0;
    const alpha = isActive ? 1 : Math.max(0.08, 0.45 - absOffset * 0.09);
    const size = isActive ? 30 : absOffset === 1 ? 21 : 19;
    const weight = isActive ? 760 : 650;
    let color = 'rgba(255, 255, 255, 0.94)';
    if (offset < 0) {
      color = 'rgba(255, 255, 255, 0.34)';
    } else if (offset > 0) {
      color = 'rgba(255, 255, 255, 0.23)';
    }

    if (isActive) {
      drawProgressText(ctx, lines[index].text, centerX, y, {
        maxWidth,
        size,
        weight,
        progress: lineProgress,
      });
    } else {
      drawText(ctx, lines[index].text, centerX, y, {
        maxWidth,
        size,
        weight,
        color,
        alpha,
      });
    }
  }
}

function drawTimeBadge(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  bounds: VisualizerRenderContext['bounds'],
  snapshot: VisualizerAudioSnapshot
): void {
  const text = `${formatTime(snapshot.playback.currentTime)} / ${formatTime(snapshot.playback.duration)}`;
  drawText(ctx, text, bounds.width / 2, bounds.height * 0.68, {
    maxWidth: 260,
    size: 13,
    weight: 560,
    color: 'rgba(255, 210, 226, 0.64)',
    alpha: snapshot.playback.duration > 0 ? 1 : 0.64,
  });
}

function makeManifest(): VisualizerComponentManifest {
  return {
    id: '@pmp/center-display',
    version: '1.0.0',
    formatVersion: 1,
    metadata: {
      name: 'Center Display',
      description: 'Track and lyric display layer for the full-screen visualizer.',
      author: 'Pixel Matrix Player',
      tags: ['audio', 'track', 'lyrics', 'center'],
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
      defaultSize: { width: 1400, height: 900 },
      hitShape: { type: 'auto' },
    },
    defaultTransform: {
      position: { x: 0.5, y: 0.52 },
      scale: 1,
      rotation: 0,
      zIndex: 30,
      opacity: 1,
      visible: true,
    },
  };
}

function createCenterDisplayComponent(): VisualizerComponent {
  const manifest = makeManifest();
  let cachedLyricsRaw = '';
  let cachedLines: ParsedLyricLine[] = [];

  return {
    manifest,
    initialize(_ctx: VisualizerComponentContext) {
      // No-op for the MVP runtime.
    },
    render(_frame: VisualizerFrameInfo, ctx: VisualizerRenderContext) {
      const { ctx: canvas, bounds, audioSnapshot } = ctx;
      const lyricsRaw = audioSnapshot.track?.lyrics ?? '';

      if (lyricsRaw !== cachedLyricsRaw) {
        cachedLyricsRaw = lyricsRaw;
        cachedLines = parseLyrics(lyricsRaw);
      }

      const lines = cachedLines.length > 0 ? cachedLines : makeFallbackLines(audioSnapshot);

      canvas.save();
      drawTopMetadata(canvas, bounds, audioSnapshot);
      drawLyricStack(canvas, bounds, audioSnapshot, lines);
      drawTimeBadge(canvas, bounds, audioSnapshot);
      canvas.restore();
    },
    dispose() {
      cachedLyricsRaw = '';
      cachedLines = [];
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
