import type { MagnetVariantPreset } from '../shared/magnetVariantCatalog';
import { readBooleanProp } from '../shared/skinPropUtils';

export interface PlayQueueSkinProps {
  showCountBadge: boolean;
  showEditAction: boolean;
  showAddAction: boolean;
  showClearAction: boolean;
  autoScrollToActive: boolean;
}

export function parsePlayQueueSkinProps(value: unknown): PlayQueueSkinProps {
  return {
    showCountBadge: readBooleanProp(value, 'showCountBadge', true),
    showEditAction: readBooleanProp(value, 'showEditAction', true),
    showAddAction: readBooleanProp(value, 'showAddAction', true),
    showClearAction: readBooleanProp(value, 'showClearAction', true),
    autoScrollToActive: readBooleanProp(value, 'autoScrollToActive', true),
  };
}

export const PLAY_QUEUE_VARIANT_PRESETS = [
  {
    id: 'default',
    labelKey: 'magnet.variants.btn-play-queue.default.label',
    descriptionKey: 'magnet.variants.btn-play-queue.default.description',
  },
  {
    id: 'monitor',
    labelKey: 'magnet.variants.btn-play-queue.monitor.label',
    descriptionKey: 'magnet.variants.btn-play-queue.monitor.description',
    props: {
      showEditAction: false,
      showAddAction: false,
      showClearAction: false,
    },
  },
  {
    id: 'minimal',
    labelKey: 'magnet.variants.btn-play-queue.minimal.label',
    descriptionKey: 'magnet.variants.btn-play-queue.minimal.description',
    props: {
      showCountBadge: false,
      showEditAction: false,
      showAddAction: false,
      showClearAction: false,
      autoScrollToActive: false,
    },
  },
] satisfies readonly MagnetVariantPreset<PlayQueueSkinProps>[];
