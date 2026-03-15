import type { MagnetVariantPreset } from './shared/magnetVariantCatalog';
import { readBooleanProp } from './shared/skinPropUtils';

export interface MatrixChangeSkinProps {
  showLabel: boolean;
  showPresetsAction: boolean;
  showHistoryAction: boolean;
  showDangerActions: boolean;
}

export function parseMatrixChangeSkinProps(value: unknown): MatrixChangeSkinProps {
  return {
    showLabel: readBooleanProp(value, 'showLabel', true),
    showPresetsAction: readBooleanProp(value, 'showPresetsAction', true),
    showHistoryAction: readBooleanProp(value, 'showHistoryAction', true),
    showDangerActions: readBooleanProp(value, 'showDangerActions', true),
  };
}

export const MATRIX_CHANGE_VARIANT_PRESETS = [
  {
    id: 'default',
    labelKey: 'magnet.variants.btn-matrix-change.default.label',
    descriptionKey: 'magnet.variants.btn-matrix-change.default.description',
  },
  {
    id: 'badge-only',
    labelKey: 'magnet.variants.btn-matrix-change.badge-only.label',
    descriptionKey: 'magnet.variants.btn-matrix-change.badge-only.description',
    props: {
      showLabel: false,
      showPresetsAction: false,
      showHistoryAction: false,
      showDangerActions: false,
    },
  },
  {
    id: 'compact-panel',
    labelKey: 'magnet.variants.btn-matrix-change.compact-panel.label',
    descriptionKey: 'magnet.variants.btn-matrix-change.compact-panel.description',
    props: {
      showPresetsAction: true,
      showHistoryAction: false,
      showDangerActions: false,
    },
  },
] satisfies readonly MagnetVariantPreset<MatrixChangeSkinProps>[];
