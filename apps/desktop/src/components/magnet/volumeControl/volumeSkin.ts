import type { PopupPlacement } from '../../core/CollisionAwarePopup';
import type { MagnetVariantPreset } from '../shared/magnetVariantCatalog';
import { readBooleanProp, readEnumProp } from '../shared/skinPropUtils';

const VOLUME_POPUP_PLACEMENTS = [
  'top-start',
  'top-center',
  'top-end',
  'bottom-start',
  'bottom-center',
  'bottom-end',
] as const satisfies readonly PopupPlacement[];

export type VolumePopupPlacement = (typeof VOLUME_POPUP_PLACEMENTS)[number];

export interface VolumeSkinProps {
  popupPlacement: VolumePopupPlacement;
  showValue: boolean;
  showMuteToggle: boolean;
}

export function parseVolumeSkinProps(value: unknown): VolumeSkinProps {
  return {
    popupPlacement: readEnumProp(value, 'popupPlacement', VOLUME_POPUP_PLACEMENTS, 'top-center'),
    showValue: readBooleanProp(value, 'showValue', true),
    showMuteToggle: readBooleanProp(value, 'showMuteToggle', true),
  };
}

export const VOLUME_VARIANT_PRESETS = [
  {
    id: 'default',
    labelKey: 'magnet.variants.btn-volume.default.label',
    descriptionKey: 'magnet.variants.btn-volume.default.description',
  },
  {
    id: 'compact',
    labelKey: 'magnet.variants.btn-volume.compact.label',
    descriptionKey: 'magnet.variants.btn-volume.compact.description',
    props: {
      showValue: false,
      showMuteToggle: false,
    },
  },
  {
    id: 'dock-start',
    labelKey: 'magnet.variants.btn-volume.dock-start.label',
    descriptionKey: 'magnet.variants.btn-volume.dock-start.description',
    props: {
      popupPlacement: 'top-start',
      showValue: false,
    },
  },
] satisfies readonly MagnetVariantPreset<VolumeSkinProps>[];
