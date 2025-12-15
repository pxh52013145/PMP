/**
 * 动态颜色提取 Hook
 * 从封面图片中提取主色调
 */

import { useState, useEffect } from 'react';

export interface DynamicColors {
  dominantColor: string;
  accentColor: string;
  textColor: string;
}

const DEFAULT_COLORS: DynamicColors = {
  dominantColor: '#1a1a1a',
  accentColor: 'rgba(255, 255, 255, 0.6)', // 明显的白色光效
  textColor: 'rgba(255, 255, 255, 0.9)',
};

/**
 * 从图片提取颜色
 */
function extractColorFromImage(imageUrl: string): Promise<DynamicColors> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(DEFAULT_COLORS);
        return;
      }

      // 使用小尺寸采样以提高性能
      canvas.width = 50;
      canvas.height = 50;
      ctx.drawImage(img, 0, 0, 50, 50);

      try {
        const imageData = ctx.getImageData(0, 0, 50, 50);
        const data = imageData.data;

        let r = 0,
          g = 0,
          b = 0;
        let brightR = 0,
          brightG = 0,
          brightB = 0;
        let count = 0;
        let brightCount = 0;

        // 色彩统计
        const colorMap = new Map<string, number>();

        for (let i = 0; i < data.length; i += 8) {
          const red = data[i];
          const green = data[i + 1];
          const blue = data[i + 2];
          const alpha = data[i + 3];

          if (alpha < 128) continue;

          const brightness = red * 0.299 + green * 0.587 + blue * 0.114;
          const max = Math.max(red, green, blue);
          const min = Math.min(red, green, blue);
          const saturation = max === 0 ? 0 : (max - min) / max;

          if (saturation > 0.2 && brightness > 20 && brightness < 240) {
            const qRed = Math.floor(red / 32) * 32;
            const qGreen = Math.floor(green / 32) * 32;
            const qBlue = Math.floor(blue / 32) * 32;
            const key = `${qRed},${qGreen},${qBlue}`;

            colorMap.set(key, (colorMap.get(key) || 0) + 1);

            r += red;
            g += green;
            b += blue;
            count++;
          }

          if (brightness > 180 && saturation > 0.1) {
            brightR += red;
            brightG += green;
            brightB += blue;
            brightCount++;
          }
        }

        if (count > 0) {
          let dominantRgb = { r: 0, g: 0, b: 0 };
          let maxCount = 0;

          colorMap.forEach((colorCount, colorKey) => {
            if (colorCount > maxCount) {
              maxCount = colorCount;
              const [dr, dg, db] = colorKey.split(',').map(Number);
              dominantRgb = { r: dr, g: dg, b: db };
            }
          });

          if (maxCount > 0) {
            r = dominantRgb.r;
            g = dominantRgb.g;
            b = dominantRgb.b;
          } else {
            r = Math.floor(r / count);
            g = Math.floor(g / count);
            b = Math.floor(b / count);
          }

          // 增强饱和度
          const enhanceSaturation = (r: number, g: number, b: number, factor: number) => {
            const avg = (r + g + b) / 3;

            return {
              r: Math.min(255, avg + (r - avg) * factor),
              g: Math.min(255, avg + (g - avg) * factor),
              b: Math.min(255, avg + (b - avg) * factor),
            };
          };

          const enhanced = enhanceSaturation(r, g, b, 1.5);

          // 主色调
          const dominantColor = `rgb(${Math.floor(enhanced.r * 0.6)}, ${Math.floor(enhanced.g * 0.6)}, ${Math.floor(enhanced.b * 0.6)})`;

          // 光效颜色
          let accentColor: string;
          if (brightCount > 0) {
            brightR = Math.floor(brightR / brightCount);
            brightG = Math.floor(brightG / brightCount);
            brightB = Math.floor(brightB / brightCount);

            const brightEnhanced = enhanceSaturation(brightR, brightG, brightB, 1.3);
            accentColor = `rgba(${brightEnhanced.r}, ${brightEnhanced.g}, ${brightEnhanced.b}, 0.9)`;
          } else {
            accentColor = `rgba(${Math.min(255, enhanced.r * 1.3)}, ${Math.min(255, enhanced.g * 1.3)}, ${Math.min(255, enhanced.b * 1.3)}, 0.8)`;
          }

          // 文字颜色
          const textColor = `rgba(${Math.min(255, enhanced.r * 1.5)}, ${Math.min(255, enhanced.g * 1.5)}, ${Math.min(255, enhanced.b * 1.5)}, 0.95)`;

          resolve({
            dominantColor,
            accentColor,
            textColor,
          });
        } else {
          resolve(DEFAULT_COLORS);
        }
      } catch (e) {
        console.error('Failed to extract color:', e);
        resolve(DEFAULT_COLORS);
      }
    };

    img.onerror = () => {
      resolve(DEFAULT_COLORS);
    };

    img.src = imageUrl;
  });
}

/**
 * 使用动态颜色Hook
 */
export function useDynamicColor(
  coverUrl: string | undefined,
  enabled: boolean = true
): DynamicColors {
  const [colors, setColors] = useState<DynamicColors>(DEFAULT_COLORS);

  useEffect(() => {
    if (!enabled || !coverUrl) {
      setColors(DEFAULT_COLORS);
      return;
    }

    extractColorFromImage(coverUrl).then(setColors);
  }, [coverUrl, enabled]);

  return colors;
}
