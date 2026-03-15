import type { MagnetVariantPreset } from '../shared/magnetVariantCatalog';
import { readBooleanProp, readEnumProp } from '../shared/skinPropUtils';

const WINDOW_PIN_IDLE_POSES = ['tilted', 'upright'] as const;

export type WindowPinIdlePose = (typeof WINDOW_PIN_IDLE_POSES)[number];

export interface WindowPinSkinProps {
  showPinnedAnchor: boolean;
  showPinnedShadow: boolean;
  idlePose: WindowPinIdlePose;
}

export function parseWindowPinSkinProps(value: unknown): WindowPinSkinProps {
  return {
    showPinnedAnchor: readBooleanProp(value, 'showPinnedAnchor', true),
    showPinnedShadow: readBooleanProp(value, 'showPinnedShadow', true),
    idlePose: readEnumProp(value, 'idlePose', WINDOW_PIN_IDLE_POSES, 'tilted'),
  };
}

export const WINDOW_PIN_VARIANT_PRESETS = [
  {
    id: 'default',
    labelKey: 'magnet.variants.btn-window-pin.default.label',
    descriptionKey: 'magnet.variants.btn-window-pin.default.description',
  },
  {
    id: 'minimal',
    labelKey: 'magnet.variants.btn-window-pin.minimal.label',
    descriptionKey: 'magnet.variants.btn-window-pin.minimal.description',
    props: {
      showPinnedAnchor: false,
      showPinnedShadow: false,
      idlePose: 'upright',
    },
  },
  {
    id: 'signal',
    labelKey: 'magnet.variants.btn-window-pin.signal.label',
    descriptionKey: 'magnet.variants.btn-window-pin.signal.description',
    props: {
      showPinnedAnchor: true,
      showPinnedShadow: true,
      idlePose: 'upright',
    },
  },
] satisfies readonly MagnetVariantPreset<WindowPinSkinProps>[];
