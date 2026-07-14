import type { MagnetVariantPreset } from '../shared/magnetVariantCatalog';

export const TRACK_INFO_VARIANT_PRESETS = [
  {
    id: 'spinning-vinyl',
    labelKey: 'magnet.variants.track-info.spinning-vinyl.label',
    descriptionKey: 'magnet.variants.track-info.spinning-vinyl.description',
  },
  {
    id: 'minimal',
    labelKey: 'magnet.variants.track-info.minimal.label',
    descriptionKey: 'magnet.variants.track-info.minimal.description',
  },
] satisfies readonly MagnetVariantPreset<object>[];
