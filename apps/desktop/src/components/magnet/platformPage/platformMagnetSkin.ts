import type { MagnetVariantPreset } from '../shared/magnetVariantCatalog';
import { readBooleanProp, readEnumProp, readIntegerProp } from '../shared/skinPropUtils';

export const PLATFORM_MAGNET_DEFAULT_SEARCH_LIMIT = 30;

const PLATFORM_MAGNET_DEFAULT_MODES = ['generic', 'bilibili', 'netease'] as const;

export type PlatformMagnetDefaultMode = (typeof PLATFORM_MAGNET_DEFAULT_MODES)[number];

export interface PlatformMagnetSkinProps {
  defaultMode: PlatformMagnetDefaultMode;
  searchLimit: number;
  showSummary: boolean;
}

export function parsePlatformMagnetSkinProps(value: unknown): PlatformMagnetSkinProps {
  return {
    defaultMode: readEnumProp(value, 'defaultMode', PLATFORM_MAGNET_DEFAULT_MODES, 'generic'),
    searchLimit: readIntegerProp(value, 'searchLimit', PLATFORM_MAGNET_DEFAULT_SEARCH_LIMIT, {
      min: 1,
      max: 100,
    }),
    showSummary: readBooleanProp(value, 'showSummary', true),
  };
}

export const PLATFORM_MAGNET_VARIANT_PRESETS = [
  {
    id: 'default',
    labelKey: 'magnet.variants.platform-magnet.default.label',
    descriptionKey: 'magnet.variants.platform-magnet.default.description',
  },
  {
    id: 'search-focus',
    labelKey: 'magnet.variants.platform-magnet.search-focus.label',
    descriptionKey: 'magnet.variants.platform-magnet.search-focus.description',
    props: {
      defaultMode: 'generic',
      searchLimit: 12,
      showSummary: false,
    },
  },
  {
    id: 'workspace-bilibili',
    labelKey: 'magnet.variants.platform-magnet.workspace-bilibili.label',
    descriptionKey: 'magnet.variants.platform-magnet.workspace-bilibili.description',
    props: {
      defaultMode: 'bilibili',
      showSummary: false,
    },
  },
] satisfies readonly MagnetVariantPreset<PlatformMagnetSkinProps>[];
