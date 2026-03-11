import type { MagnetJoinEdges } from './layoutAdaptive';

export const DEFAULT_MAGNET_CORNER_RADIUS = '2px';

export const CONTENT_STYLE_KEYS = new Set([
  'padding',
  'display',
  'alignItems',
  'justifyContent',
  'flexDirection',
  'gap',
  'color',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'fontVariantNumeric',
  'textAlign',
]);

export function splitMagnetStyleTokens(style: Record<string, string | number | undefined>) {
  const chromeStyle: Record<string, string | number | undefined> = {};
  const contentStyle: Record<string, string | number | undefined> = {};

  for (const [key, value] of Object.entries(style)) {
    if (CONTENT_STYLE_KEYS.has(key)) {
      contentStyle[key] = value;
      continue;
    }

    chromeStyle[key] = value;
  }

  return { chromeStyle, contentStyle };
}

function normalizeRadiusValue(value: string | number | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${Math.max(0, Math.floor(value))}px`;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    const pxMatch = normalized.match(/^([0-9.]+)px$/i);
    if (pxMatch) {
      return `${Math.max(0, Math.floor(Number.parseFloat(pxMatch[1] ?? '0')))}px`;
    }

    if (normalized) return normalized;
  }

  return DEFAULT_MAGNET_CORNER_RADIUS;
}

export function resolveMagnetCornerRadii(
  borderRadius: string | number | undefined,
  joinEdges?: MagnetJoinEdges
): Record<string, string> {
  const normalizedRadius = normalizeRadiusValue(borderRadius);

  if (!joinEdges || (!joinEdges.left && !joinEdges.right && !joinEdges.top && !joinEdges.bottom)) {
    return { borderRadius: normalizedRadius };
  }

  return {
    borderTopLeftRadius: joinEdges.left || joinEdges.top ? '0px' : normalizedRadius,
    borderTopRightRadius: joinEdges.right || joinEdges.top ? '0px' : normalizedRadius,
    borderBottomRightRadius: joinEdges.right || joinEdges.bottom ? '0px' : normalizedRadius,
    borderBottomLeftRadius: joinEdges.left || joinEdges.bottom ? '0px' : normalizedRadius,
  };
}
