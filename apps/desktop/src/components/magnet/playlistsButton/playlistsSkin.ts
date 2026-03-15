import type { MagnetVariantPreset } from '../shared/magnetVariantCatalog';
import { readBooleanProp } from '../shared/skinPropUtils';

export interface PlaylistsSkinProps {
  showCountBadge: boolean;
  showLabel: boolean;
  showActiveIndicator: boolean;
}

export function parsePlaylistsSkinProps(value: unknown): PlaylistsSkinProps {
  return {
    showCountBadge: readBooleanProp(value, 'showCountBadge', false),
    showLabel: readBooleanProp(value, 'showLabel', false),
    showActiveIndicator: readBooleanProp(value, 'showActiveIndicator', false),
  };
}

export const PLAYLISTS_VARIANT_PRESETS = [
  {
    id: 'default',
    labelKey: 'magnet.variants.btn-playlists.default.label',
    descriptionKey: 'magnet.variants.btn-playlists.default.description',
  },
  {
    id: 'badge',
    labelKey: 'magnet.variants.btn-playlists.badge.label',
    descriptionKey: 'magnet.variants.btn-playlists.badge.description',
    props: {
      showCountBadge: true,
      showActiveIndicator: true,
    },
  },
  {
    id: 'chip',
    labelKey: 'magnet.variants.btn-playlists.chip.label',
    descriptionKey: 'magnet.variants.btn-playlists.chip.description',
    props: {
      showCountBadge: true,
      showLabel: true,
      showActiveIndicator: true,
    },
  },
] satisfies readonly MagnetVariantPreset<PlaylistsSkinProps>[];
