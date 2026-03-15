import type { MagnetVariantPreset } from '../shared/magnetVariantCatalog';
import { readBooleanProp, readEnumProp } from '../shared/skinPropUtils';

const PROGRESS_BAR_TRACK_DENSITIES = ['thin', 'standard', 'thick'] as const;
const PROGRESS_BAR_BUFFER_LAYERS = ['all', 'single', 'none'] as const;
const PROGRESS_BAR_THUMB_VISIBILITIES = ['hover', 'always', 'hidden'] as const;

export type ProgressBarTrackDensity = (typeof PROGRESS_BAR_TRACK_DENSITIES)[number];
export type ProgressBarBufferLayers = (typeof PROGRESS_BAR_BUFFER_LAYERS)[number];
export type ProgressBarThumbVisibility = (typeof PROGRESS_BAR_THUMB_VISIBILITIES)[number];

export interface ProgressBarSkinProps {
  showTimeLabels: boolean;
  trackDensity: ProgressBarTrackDensity;
  bufferLayers: ProgressBarBufferLayers;
  thumbVisibility: ProgressBarThumbVisibility;
}

export function parseProgressBarSkinProps(value: unknown): ProgressBarSkinProps {
  return {
    showTimeLabels: readBooleanProp(value, 'showTimeLabels', true),
    trackDensity: readEnumProp(value, 'trackDensity', PROGRESS_BAR_TRACK_DENSITIES, 'standard'),
    bufferLayers: readEnumProp(value, 'bufferLayers', PROGRESS_BAR_BUFFER_LAYERS, 'all'),
    thumbVisibility: readEnumProp(value, 'thumbVisibility', PROGRESS_BAR_THUMB_VISIBILITIES, 'hover'),
  };
}

export const PROGRESS_BAR_VARIANT_PRESETS = [
  {
    id: 'default',
    labelKey: 'magnet.variants.progress-bar.default.label',
    descriptionKey: 'magnet.variants.progress-bar.default.description',
  },
  {
    id: 'minimal',
    labelKey: 'magnet.variants.progress-bar.minimal.label',
    descriptionKey: 'magnet.variants.progress-bar.minimal.description',
    props: {
      showTimeLabels: false,
      trackDensity: 'thin',
      bufferLayers: 'none',
      thumbVisibility: 'hidden',
    },
  },
  {
    id: 'monitor',
    labelKey: 'magnet.variants.progress-bar.monitor.label',
    descriptionKey: 'magnet.variants.progress-bar.monitor.description',
    props: {
      trackDensity: 'thick',
      bufferLayers: 'all',
      thumbVisibility: 'always',
    },
  },
] satisfies readonly MagnetVariantPreset<ProgressBarSkinProps>[];
