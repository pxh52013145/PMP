import type { MagnetVariantPreset } from '../shared/magnetVariantCatalog';
import { readBooleanProp } from '../shared/skinPropUtils';

export interface MusicLibrarySkinProps {
  showLabel: boolean;
  showActiveIndicator: boolean;
}

export function parseMusicLibrarySkinProps(value: unknown): MusicLibrarySkinProps {
  return {
    showLabel: readBooleanProp(value, 'showLabel', false),
    showActiveIndicator: readBooleanProp(value, 'showActiveIndicator', false),
  };
}

export const MUSIC_LIBRARY_VARIANT_PRESETS = [
  {
    id: 'default',
    labelKey: 'magnet.variants.btn-music-library.default.label',
    descriptionKey: 'magnet.variants.btn-music-library.default.description',
  },
  {
    id: 'indicator',
    labelKey: 'magnet.variants.btn-music-library.indicator.label',
    descriptionKey: 'magnet.variants.btn-music-library.indicator.description',
    props: {
      showActiveIndicator: true,
    },
  },
  {
    id: 'chip',
    labelKey: 'magnet.variants.btn-music-library.chip.label',
    descriptionKey: 'magnet.variants.btn-music-library.chip.description',
    props: {
      showLabel: true,
      showActiveIndicator: true,
    },
  },
] satisfies readonly MagnetVariantPreset<MusicLibrarySkinProps>[];
