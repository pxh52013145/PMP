import { useEffect, useState } from 'react';
import {
  DEFAULT_DYNAMIC_COLORS,
  getDynamicColorsForImageUrl,
  type DynamicColors,
} from '../../../utils/dynamicColors';

export type { DynamicColors } from '../../../utils/dynamicColors';
export { DEFAULT_DYNAMIC_COLORS, buildCoverGradient } from '../../../utils/dynamicColors';

export function useDynamicColor(coverUrl: string | undefined, enabled: boolean = true): DynamicColors {
  const [colors, setColors] = useState<DynamicColors>(DEFAULT_DYNAMIC_COLORS);

  useEffect(() => {
    if (!enabled || !coverUrl) {
      setColors(DEFAULT_DYNAMIC_COLORS);
      return;
    }

    let cancelled = false;
    getDynamicColorsForImageUrl(coverUrl).then((value) => {
      if (cancelled) return;
      setColors(value);
    });

    return () => {
      cancelled = true;
    };
  }, [coverUrl, enabled]);

  return colors;
}
