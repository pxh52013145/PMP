import type { MagnetVariantPreset } from '../shared/magnetVariantCatalog';
import { readBooleanProp } from '../shared/skinPropUtils';

export interface PlaybackStepSkinProps {
  showQueueCount: boolean;
  showLabel: boolean;
}

export function parsePlaybackStepSkinProps(value: unknown): PlaybackStepSkinProps {
  return {
    showQueueCount: readBooleanProp(value, 'showQueueCount', false),
    showLabel: readBooleanProp(value, 'showLabel', false),
  };
}

export const PLAYBACK_STEP_VARIANT_PRESETS = [
  {
    id: 'default',
    labelKey: 'magnet.variants.playback-step.default.label',
    descriptionKey: 'magnet.variants.playback-step.default.description',
  },
  {
    id: 'queue-hint',
    labelKey: 'magnet.variants.playback-step.queue-hint.label',
    descriptionKey: 'magnet.variants.playback-step.queue-hint.description',
    props: {
      showQueueCount: true,
    },
  },
  {
    id: 'labeled',
    labelKey: 'magnet.variants.playback-step.labeled.label',
    descriptionKey: 'magnet.variants.playback-step.labeled.description',
    props: {
      showQueueCount: true,
      showLabel: true,
    },
  },
] satisfies readonly MagnetVariantPreset<PlaybackStepSkinProps>[];
