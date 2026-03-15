import type { MagnetVariantPreset } from '../shared/magnetVariantCatalog';
import { readBooleanProp, readEnumProp } from '../shared/skinPropUtils';

const BACK_BUTTON_ICON_STYLES = ['filled', 'outline'] as const;

export type BackButtonIconStyle = (typeof BACK_BUTTON_ICON_STYLES)[number];

export interface BackButtonSkinProps {
  iconStyle: BackButtonIconStyle;
  showHistoryCount: boolean;
}

export function parseBackButtonSkinProps(value: unknown): BackButtonSkinProps {
  return {
    iconStyle: readEnumProp(value, 'iconStyle', BACK_BUTTON_ICON_STYLES, 'filled'),
    showHistoryCount: readBooleanProp(value, 'showHistoryCount', false),
  };
}

export const BACK_BUTTON_VARIANT_PRESETS = [
  {
    id: 'default',
    labelKey: 'magnet.variants.btn-back.default.label',
    descriptionKey: 'magnet.variants.btn-back.default.description',
  },
  {
    id: 'outline',
    labelKey: 'magnet.variants.btn-back.outline.label',
    descriptionKey: 'magnet.variants.btn-back.outline.description',
    props: {
      iconStyle: 'outline',
    },
  },
  {
    id: 'history-chip',
    labelKey: 'magnet.variants.btn-back.history-chip.label',
    descriptionKey: 'magnet.variants.btn-back.history-chip.description',
    props: {
      iconStyle: 'outline',
      showHistoryCount: true,
    },
  },
] satisfies readonly MagnetVariantPreset<BackButtonSkinProps>[];
