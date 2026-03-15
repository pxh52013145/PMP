import type { MagnetVariantPreset } from './shared/magnetVariantCatalog';
import { readBooleanProp, readEnumProp } from './shared/skinPropUtils';

const DSP_VST_LABEL_MODES = ['plugin', 'status', 'generic'] as const;
const DSP_VST_RING_VISIBILITIES = ['status', 'always', 'off'] as const;

export type DspVstLabelMode = (typeof DSP_VST_LABEL_MODES)[number];
export type DspVstRingVisibility = (typeof DSP_VST_RING_VISIBILITIES)[number];

export interface DspVstSkinProps {
  labelMode: DspVstLabelMode;
  showProgressDots: boolean;
  ringVisibility: DspVstRingVisibility;
}

export function parseDspVstSkinProps(value: unknown): DspVstSkinProps {
  return {
    labelMode: readEnumProp(value, 'labelMode', DSP_VST_LABEL_MODES, 'plugin'),
    showProgressDots: readBooleanProp(value, 'showProgressDots', true),
    ringVisibility: readEnumProp(value, 'ringVisibility', DSP_VST_RING_VISIBILITIES, 'status'),
  };
}

export const DSP_VST_VARIANT_PRESETS = [
  {
    id: 'default',
    labelKey: 'magnet.variants.dsp-vst.default.label',
    descriptionKey: 'magnet.variants.dsp-vst.default.description',
  },
  {
    id: 'status-chip',
    labelKey: 'magnet.variants.dsp-vst.status-chip.label',
    descriptionKey: 'magnet.variants.dsp-vst.status-chip.description',
    props: {
      labelMode: 'status',
      showProgressDots: false,
      ringVisibility: 'status',
    },
  },
  {
    id: 'compact',
    labelKey: 'magnet.variants.dsp-vst.compact.label',
    descriptionKey: 'magnet.variants.dsp-vst.compact.description',
    props: {
      labelMode: 'generic',
      showProgressDots: false,
      ringVisibility: 'off',
    },
  },
] satisfies readonly MagnetVariantPreset<DspVstSkinProps>[];
