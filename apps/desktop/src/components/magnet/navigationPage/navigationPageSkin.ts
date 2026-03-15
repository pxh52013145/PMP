import type { MagnetVariantPreset } from '../shared/magnetVariantCatalog';
import { readBooleanProp, readEnumProp } from '../shared/skinPropUtils';

const NAVIGATION_PAGE_SOURCE_SWITCHER_MODES = ['popup', 'inline'] as const;
const NAVIGATION_PAGE_PLACEHOLDER_MODES = ['icon', 'minimal'] as const;

export type NavigationPageSourceSwitcherMode = (typeof NAVIGATION_PAGE_SOURCE_SWITCHER_MODES)[number];
export type NavigationPagePlaceholderMode = (typeof NAVIGATION_PAGE_PLACEHOLDER_MODES)[number];

export interface NavigationPageSkinProps {
  sourceSwitcherMode: NavigationPageSourceSwitcherMode;
  showLibraryStats: boolean;
  placeholderMode: NavigationPagePlaceholderMode;
}

export function parseNavigationPageSkinProps(value: unknown): NavigationPageSkinProps {
  return {
    sourceSwitcherMode: readEnumProp(
      value,
      'sourceSwitcherMode',
      NAVIGATION_PAGE_SOURCE_SWITCHER_MODES,
      'popup'
    ),
    showLibraryStats: readBooleanProp(value, 'showLibraryStats', true),
    placeholderMode: readEnumProp(
      value,
      'placeholderMode',
      NAVIGATION_PAGE_PLACEHOLDER_MODES,
      'icon'
    ),
  };
}

export const NAVIGATION_PAGE_VARIANT_PRESETS = [
  {
    id: 'default',
    labelKey: 'magnet.variants.navigation-page.default.label',
    descriptionKey: 'magnet.variants.navigation-page.default.description',
  },
  {
    id: 'inline-sources',
    labelKey: 'magnet.variants.navigation-page.inline-sources.label',
    descriptionKey: 'magnet.variants.navigation-page.inline-sources.description',
    props: {
      sourceSwitcherMode: 'inline',
    },
  },
  {
    id: 'compact-meta',
    labelKey: 'magnet.variants.navigation-page.compact-meta.label',
    descriptionKey: 'magnet.variants.navigation-page.compact-meta.description',
    props: {
      showLibraryStats: false,
      placeholderMode: 'minimal',
    },
  },
] satisfies readonly MagnetVariantPreset<NavigationPageSkinProps>[];
