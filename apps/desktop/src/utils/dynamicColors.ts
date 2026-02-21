/**
 * Dynamic color extraction for cover images.
 *
 * Used by builtin magnets and the plugin Host API.
 */

export interface DynamicColors {
  dominantColor: string;
  accentColor: string;
  textColor: string;
}

export const DEFAULT_DYNAMIC_COLORS: DynamicColors = {
  dominantColor: '#1a1a1a',
  accentColor: 'rgba(255, 255, 255, 0.6)',
  textColor: 'rgba(255, 255, 255, 0.9)',
};

const CACHE_MAX_ENTRIES = 64;
const colorsCache = new Map<string, DynamicColors>();
const inflightCache = new Map<string, Promise<DynamicColors>>();

const HAS_CANVAS_2D = typeof CanvasRenderingContext2D !== 'undefined';

function pruneCache(): void {
  while (colorsCache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = colorsCache.keys().next().value as string | undefined;
    if (!oldestKey) return;
    colorsCache.delete(oldestKey);
  }
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && isFinite(value) ? value : fallback;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toPortableImageUrl(imageUrl: string): Promise<string | null> {
  if (!imageUrl) return Promise.resolve(null);

  const lower = imageUrl.toLowerCase();
  if (lower.startsWith('data:')) return Promise.resolve(imageUrl);
  if (lower.startsWith('http:') || lower.startsWith('https:')) return Promise.resolve(imageUrl);
  if (lower.startsWith('blob:')) return Promise.resolve(imageUrl);
  if (lower.startsWith('asset:') || lower.startsWith('tauri:')) return Promise.resolve(imageUrl);
  if (lower.startsWith('pmp://')) return Promise.resolve(imageUrl);

  return Promise.resolve(null);
}

async function extractColorsFromImageUrl(imageUrl: string, cacheKey?: string): Promise<DynamicColors> {
  if (!imageUrl) return DEFAULT_DYNAMIC_COLORS;
  if (typeof Image === 'undefined' || !HAS_CANVAS_2D) return DEFAULT_DYNAMIC_COLORS;

  const key = typeof cacheKey === 'string' && cacheKey.trim().length > 0 ? cacheKey : imageUrl;
  if (!key) return DEFAULT_DYNAMIC_COLORS;
  if (colorsCache.has(key)) return colorsCache.get(key) ?? DEFAULT_DYNAMIC_COLORS;
  if (inflightCache.has(key)) return inflightCache.get(key) ?? DEFAULT_DYNAMIC_COLORS;

  const promise = (async () => {
    const portableUrl = await toPortableImageUrl(imageUrl);
    if (!portableUrl) return DEFAULT_DYNAMIC_COLORS;

    return await new Promise<DynamicColors>((resolve) => {
      const img = new Image();
      const lowerPortableUrl = portableUrl.toLowerCase();
      if (lowerPortableUrl.startsWith('http:') || lowerPortableUrl.startsWith('https:')) {
        img.crossOrigin = 'anonymous';
      }

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      let settled = false;

      const finalize = (value: DynamicColors) => {
        if (settled) return;
        settled = true;

        try {
          img.onload = null;
          img.onerror = null;
          if (!portableUrl.startsWith('data:')) {
            img.src = '';
          }
        } catch {
          // best-effort
        }

        try {
          canvas.width = 0;
          canvas.height = 0;
        } catch {
          // best-effort
        }

        resolve(value);
      };

      if (!ctx) {
        finalize(DEFAULT_DYNAMIC_COLORS);
        return;
      }

      img.onload = () => {
        canvas.width = 50;
        canvas.height = 50;
        ctx.drawImage(img, 0, 0, 50, 50);

        try {
          const imageData = ctx.getImageData(0, 0, 50, 50);
          const data = imageData.data;

          let sumR = 0;
          let sumG = 0;
          let sumB = 0;
          let count = 0;

          let brightR = 0;
          let brightG = 0;
          let brightB = 0;
          let brightCount = 0;

          const colorMap = new Map<string, number>();

          for (let i = 0; i < data.length; i += 8) {
            const red = data[i] ?? 0;
            const green = data[i + 1] ?? 0;
            const blue = data[i + 2] ?? 0;
            const alpha = data[i + 3] ?? 0;

            if (alpha < 128) continue;

            const brightness = red * 0.299 + green * 0.587 + blue * 0.114;
            const max = Math.max(red, green, blue);
            const min = Math.min(red, green, blue);
            const saturation = max === 0 ? 0 : (max - min) / max;

            if (saturation > 0.2 && brightness > 20 && brightness < 240) {
              const qRed = Math.floor(red / 32) * 32;
              const qGreen = Math.floor(green / 32) * 32;
              const qBlue = Math.floor(blue / 32) * 32;
              const mapKey = `${qRed},${qGreen},${qBlue}`;

              colorMap.set(mapKey, (colorMap.get(mapKey) ?? 0) + 1);

              sumR += red;
              sumG += green;
              sumB += blue;
              count++;
            }

            if (brightness > 180 && saturation > 0.1) {
              brightR += red;
              brightG += green;
              brightB += blue;
              brightCount++;
            }
          }

          if (count <= 0) {
            finalize(DEFAULT_DYNAMIC_COLORS);
            return;
          }

          let dominant = { r: 0, g: 0, b: 0 };
          let maxCount = 0;
          colorMap.forEach((colorCount, colorKey) => {
            if (colorCount <= maxCount) return;
            maxCount = colorCount;
            const [dr, dg, db] = colorKey.split(',').map(Number);
            dominant = { r: toFiniteNumber(dr, 0), g: toFiniteNumber(dg, 0), b: toFiniteNumber(db, 0) };
          });

          let baseR = 0;
          let baseG = 0;
          let baseB = 0;
          if (maxCount > 0) {
            baseR = dominant.r;
            baseG = dominant.g;
            baseB = dominant.b;
          } else {
            baseR = sumR / count;
            baseG = sumG / count;
            baseB = sumB / count;
          }

          const enhanceSaturation = (r: number, g: number, b: number, factor: number) => {
            const avg = (r + g + b) / 3;
            return {
              r: clampByte(avg + (r - avg) * factor),
              g: clampByte(avg + (g - avg) * factor),
              b: clampByte(avg + (b - avg) * factor),
            };
          };

          const enhanced = enhanceSaturation(baseR, baseG, baseB, 1.5);

          const dominantColor = `rgb(${clampByte(enhanced.r * 0.6)}, ${clampByte(enhanced.g * 0.6)}, ${clampByte(enhanced.b * 0.6)})`;

          let accentColor: string;
          if (brightCount > 0) {
            const brightEnhanced = enhanceSaturation(brightR / brightCount, brightG / brightCount, brightB / brightCount, 1.3);
            accentColor = `rgba(${brightEnhanced.r}, ${brightEnhanced.g}, ${brightEnhanced.b}, 0.9)`;
          } else {
            accentColor = `rgba(${clampByte(enhanced.r * 1.3)}, ${clampByte(enhanced.g * 1.3)}, ${clampByte(enhanced.b * 1.3)}, 0.8)`;
          }

          const textColor = `rgba(${clampByte(enhanced.r * 1.5)}, ${clampByte(enhanced.g * 1.5)}, ${clampByte(enhanced.b * 1.5)}, 0.95)`;

          finalize({ dominantColor, accentColor, textColor });
        } catch {
          finalize(DEFAULT_DYNAMIC_COLORS);
        }
      };

      img.onerror = () => finalize(DEFAULT_DYNAMIC_COLORS);
      img.src = portableUrl;
    });
  })()
    .then((colors) => {
      colorsCache.set(key, colors);
      pruneCache();
      return colors;
    })
    .finally(() => {
      inflightCache.delete(key);
    });

  inflightCache.set(key, promise);
  return promise;
}

export function getDynamicColorsForImageUrl(imageUrl: string, cacheKey?: string): Promise<DynamicColors> {
  return extractColorsFromImageUrl(imageUrl, cacheKey);
}

export function buildCoverGradient(colors: DynamicColors, angleDeg: number = 90): string {
  const angle = typeof angleDeg === 'number' && isFinite(angleDeg) ? angleDeg : 90;
  return `linear-gradient(${angle}deg, ${colors.dominantColor}, ${colors.accentColor})`;
}
