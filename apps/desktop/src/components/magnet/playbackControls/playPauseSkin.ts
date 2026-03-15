import type { MagnetVariantPreset } from '../shared/magnetVariantCatalog';
import { readBooleanProp, readEnumProp } from '../shared/skinPropUtils';

const PLAY_PAUSE_PULSE_MODES = ['playing', 'always', 'none'] as const;

export type PlayPausePulseMode = (typeof PLAY_PAUSE_PULSE_MODES)[number];

export interface PlayPauseSkinProps {
  showStateLabel: boolean;
  showQueueCount: boolean;
  pulseMode: PlayPausePulseMode;
}

export function parsePlayPauseSkinProps(value: unknown): PlayPauseSkinProps {
  return {
    showStateLabel: readBooleanProp(value, 'showStateLabel', false),
    showQueueCount: readBooleanProp(value, 'showQueueCount', false),
    pulseMode: readEnumProp(value, 'pulseMode', PLAY_PAUSE_PULSE_MODES, 'playing'),
  };
}

export const PLAY_PAUSE_VARIANT_PRESETS = [
  {
    id: 'default',
    labelKey: 'magnet.variants.btn-play-pause.default.label',
    descriptionKey: 'magnet.variants.btn-play-pause.default.description',
  },
  {
    id: 'labeled',
    labelKey: 'magnet.variants.btn-play-pause.labeled.label',
    descriptionKey: 'magnet.variants.btn-play-pause.labeled.description',
    props: {
      showStateLabel: true,
    },
  },
  {
    id: 'queue-chip',
    labelKey: 'magnet.variants.btn-play-pause.queue-chip.label',
    descriptionKey: 'magnet.variants.btn-play-pause.queue-chip.description',
    props: {
      showQueueCount: true,
      pulseMode: 'none',
    },
  },
  {
    id: 'ambient',
    labelKey: 'magnet.variants.btn-play-pause.ambient.label',
    descriptionKey: 'magnet.variants.btn-play-pause.ambient.description',
    props: {
      showStateLabel: true,
      showQueueCount: true,
      pulseMode: 'always',
    },
  },
] satisfies readonly MagnetVariantPreset<PlayPauseSkinProps>[];
