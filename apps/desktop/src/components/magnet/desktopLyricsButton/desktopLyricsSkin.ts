import type { MagnetVariantPreset } from '../shared/magnetVariantCatalog';
import { readBooleanProp, readEnumProp } from '../shared/skinPropUtils';

const DESKTOP_LYRICS_LABEL_MODES = ['short', 'full', 'icon'] as const;

export type DesktopLyricsLabelMode = (typeof DESKTOP_LYRICS_LABEL_MODES)[number];

export interface DesktopLyricsSkinProps {
  labelMode: DesktopLyricsLabelMode;
  showActiveIndicator: boolean;
  showClickThroughBadge: boolean;
}

export function parseDesktopLyricsSkinProps(value: unknown): DesktopLyricsSkinProps {
  return {
    labelMode: readEnumProp(value, 'labelMode', DESKTOP_LYRICS_LABEL_MODES, 'short'),
    showActiveIndicator: readBooleanProp(value, 'showActiveIndicator', false),
    showClickThroughBadge: readBooleanProp(value, 'showClickThroughBadge', false),
  };
}

export const DESKTOP_LYRICS_VARIANT_PRESETS = [
  {
    id: 'default',
    labelKey: 'magnet.variants.btn-desktop-lyrics.default.label',
    descriptionKey: 'magnet.variants.btn-desktop-lyrics.default.description',
  },
  {
    id: 'status-dot',
    labelKey: 'magnet.variants.btn-desktop-lyrics.status-dot.label',
    descriptionKey: 'magnet.variants.btn-desktop-lyrics.status-dot.description',
    props: {
      showActiveIndicator: true,
    },
  },
  {
    id: 'full-label',
    labelKey: 'magnet.variants.btn-desktop-lyrics.full-label.label',
    descriptionKey: 'magnet.variants.btn-desktop-lyrics.full-label.description',
    props: {
      labelMode: 'full',
      showActiveIndicator: true,
    },
  },
  {
    id: 'compact-icon',
    labelKey: 'magnet.variants.btn-desktop-lyrics.compact-icon.label',
    descriptionKey: 'magnet.variants.btn-desktop-lyrics.compact-icon.description',
    props: {
      labelMode: 'icon',
      showActiveIndicator: true,
      showClickThroughBadge: true,
    },
  },
] satisfies readonly MagnetVariantPreset<DesktopLyricsSkinProps>[];
