import type { MagnetVariantPreset } from '../shared/magnetVariantCatalog';
import { readEnumProp } from '../shared/skinPropUtils';

const DEBUG_BUTTON_ACTIVE_INDICATORS = ['glow', 'dot', 'none'] as const;
const DEBUG_BUTTON_SPIN_MODES = ['none', 'hover', 'active'] as const;

export type DebugButtonActiveIndicator = (typeof DEBUG_BUTTON_ACTIVE_INDICATORS)[number];
export type DebugButtonSpinMode = (typeof DEBUG_BUTTON_SPIN_MODES)[number];

export interface DebugButtonSkinProps {
  activeIndicator: DebugButtonActiveIndicator;
  spinMode: DebugButtonSpinMode;
}

export function parseDebugButtonSkinProps(value: unknown): DebugButtonSkinProps {
  return {
    activeIndicator: readEnumProp(value, 'activeIndicator', DEBUG_BUTTON_ACTIVE_INDICATORS, 'glow'),
    spinMode: readEnumProp(value, 'spinMode', DEBUG_BUTTON_SPIN_MODES, 'none'),
  };
}

export const DEBUG_BUTTON_VARIANT_PRESETS = [
  {
    id: 'default',
    labelKey: 'magnet.variants.btn-debug.default.label',
    descriptionKey: 'magnet.variants.btn-debug.default.description',
  },
  {
    id: 'status-dot',
    labelKey: 'magnet.variants.btn-debug.status-dot.label',
    descriptionKey: 'magnet.variants.btn-debug.status-dot.description',
    props: {
      activeIndicator: 'dot',
      spinMode: 'active',
    },
  },
  {
    id: 'quiet',
    labelKey: 'magnet.variants.btn-debug.quiet.label',
    descriptionKey: 'magnet.variants.btn-debug.quiet.description',
    props: {
      activeIndicator: 'none',
      spinMode: 'none',
    },
  },
] satisfies readonly MagnetVariantPreset<DebugButtonSkinProps>[];
