import type { MagnetVariantPreset } from '../shared/magnetVariantCatalog';
import { readBooleanProp, readEnumProp } from '../shared/skinPropUtils';

const PLAY_MODE_RING_VISIBILITIES = ['hover', 'always', 'off'] as const;

export type PlayModeRingVisibility = (typeof PLAY_MODE_RING_VISIBILITIES)[number];

export interface PlayModeSkinProps {
  showModeBadge: boolean;
  ringVisibility: PlayModeRingVisibility;
  pulseOnSwitch: boolean;
}

export function parsePlayModeSkinProps(value: unknown): PlayModeSkinProps {
  return {
    showModeBadge: readBooleanProp(value, 'showModeBadge', false),
    ringVisibility: readEnumProp(value, 'ringVisibility', PLAY_MODE_RING_VISIBILITIES, 'hover'),
    pulseOnSwitch: readBooleanProp(value, 'pulseOnSwitch', true),
  };
}

export const PLAY_MODE_VARIANT_PRESETS = [
  {
    id: 'default',
    labelKey: 'magnet.variants.btn-mode.default.label',
    descriptionKey: 'magnet.variants.btn-mode.default.description',
  },
  {
    id: 'badge-chip',
    labelKey: 'magnet.variants.btn-mode.badge-chip.label',
    descriptionKey: 'magnet.variants.btn-mode.badge-chip.description',
    props: {
      showModeBadge: true,
      ringVisibility: 'off',
    },
  },
  {
    id: 'ambient',
    labelKey: 'magnet.variants.btn-mode.ambient.label',
    descriptionKey: 'magnet.variants.btn-mode.ambient.description',
    props: {
      showModeBadge: true,
      ringVisibility: 'always',
      pulseOnSwitch: false,
    },
  },
] satisfies readonly MagnetVariantPreset<PlayModeSkinProps>[];
