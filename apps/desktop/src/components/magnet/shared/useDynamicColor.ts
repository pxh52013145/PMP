import { useEffect, useState } from 'react';
import {
  DEFAULT_DYNAMIC_COLORS,
  getDynamicColorsForImageUrl,
  type DynamicColors,
} from '../../../utils/dynamicColors';

export type { DynamicColors } from '../../../utils/dynamicColors';
export { DEFAULT_DYNAMIC_COLORS, buildCoverGradient } from '../../../utils/dynamicColors';

type DynamicColorSamplingSize = 'small' | 'medium' | 'large';

type UseDynamicColorOptions = {
  sampleSize?: DynamicColorSamplingSize;
  releaseAfterExtract?: boolean;
  cacheKey?: string;
};

function buildSamplingTarget(
  coverUrl: string,
  sampleSize: DynamicColorSamplingSize,
  explicitCacheKey?: string
): { url: string; cacheKey?: string } {
  const trimmed = coverUrl.trim();
  if (!trimmed) {
    return { url: '' };
  }

  const lower = trimmed.toLowerCase();
  if (!lower.startsWith('pmp://cover/')) {
    return { url: trimmed, cacheKey: explicitCacheKey };
  }

  const hashless = trimmed.split('#')[0] ?? trimmed;
  const [base, query = ''] = hashless.split('?', 2);
  const params = new URLSearchParams(query);
  params.set('size', sampleSize);
  const sampledUrl = `${base}?${params.toString()}`;

  const inferredCacheKey = (() => {
    const match = /^pmp:\/\/(?:localhost\/)?cover\/([^/?#]+)/i.exec(base);
    if (!match || !match[1]) return undefined;
    try {
      const decoded = decodeURIComponent(match[1]);
      if (!decoded) return undefined;
      return `pmp-cover:${decoded}:size=${sampleSize}`;
    } catch {
      return undefined;
    }
  })();

  return {
    url: sampledUrl,
    cacheKey: explicitCacheKey || inferredCacheKey,
  };
}

async function discardUnretainedMusicLibraryCoverUrls(urls: string[]): Promise<void> {
  const { getMusicLibraryService } = await import('../../../services/audio/MusicLibraryService');
  getMusicLibraryService().discardCoverUrls(urls);
}

export function useDynamicColor(
  coverUrl: string | undefined,
  enabled: boolean = true,
  options?: UseDynamicColorOptions
): DynamicColors {
  const sampleSize = options?.sampleSize ?? 'small';
  const releaseAfterExtract = options?.releaseAfterExtract === true;
  const explicitCacheKey = options?.cacheKey;
  const [colors, setColors] = useState<DynamicColors>(DEFAULT_DYNAMIC_COLORS);

  useEffect(() => {
    if (!enabled || !coverUrl) {
      setColors(DEFAULT_DYNAMIC_COLORS);
      return;
    }

    const target = buildSamplingTarget(coverUrl, sampleSize, explicitCacheKey);
    if (!target.url) {
      setColors(DEFAULT_DYNAMIC_COLORS);
      return;
    }

    let cancelled = false;
    getDynamicColorsForImageUrl(target.url, target.cacheKey).then((value) => {
      if (cancelled) return;
      setColors(value);

      if (releaseAfterExtract && target.url.toLowerCase().startsWith('pmp://cover/')) {
        void discardUnretainedMusicLibraryCoverUrls([target.url]).catch(() => undefined);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [coverUrl, enabled, explicitCacheKey, releaseAfterExtract, sampleSize]);

  return colors;
}
