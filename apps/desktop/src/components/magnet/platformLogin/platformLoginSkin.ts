import type { MagnetVariantPreset } from '../shared/magnetVariantCatalog';
import { readBooleanProp, readIntegerProp, readStringProp } from '../shared/skinPropUtils';

export const PLATFORM_LOGIN_DEFAULT_QR_AUTO_POLL_INTERVAL_MS = 2_400;

export interface PlatformLoginSkinProps {
  defaultConnectorId?: string;
  openAuthOnTrigger: boolean;
  qrAutoPollIntervalMs: number;
  showSelectorTitle: boolean;
}

export function parsePlatformLoginSkinProps(value: unknown): PlatformLoginSkinProps {
  return {
    defaultConnectorId: readStringProp(value, 'defaultConnectorId'),
    openAuthOnTrigger: readBooleanProp(value, 'openAuthOnTrigger', false),
    qrAutoPollIntervalMs: readIntegerProp(
      value,
      'qrAutoPollIntervalMs',
      PLATFORM_LOGIN_DEFAULT_QR_AUTO_POLL_INTERVAL_MS,
      {
        min: 500,
        max: 10_000,
      }
    ),
    showSelectorTitle: readBooleanProp(value, 'showSelectorTitle', true),
  };
}

export const PLATFORM_LOGIN_VARIANT_PRESETS = [
  {
    id: 'default',
    labelKey: 'magnet.variants.btn-platform-login.default.label',
    descriptionKey: 'magnet.variants.btn-platform-login.default.description',
  },
  {
    id: 'quick-bilibili',
    labelKey: 'magnet.variants.btn-platform-login.quick-bilibili.label',
    descriptionKey: 'magnet.variants.btn-platform-login.quick-bilibili.description',
    props: {
      defaultConnectorId: 'bilibili',
      openAuthOnTrigger: true,
      qrAutoPollIntervalMs: 1_800,
      showSelectorTitle: false,
    },
  },
  {
    id: 'multi-platform',
    labelKey: 'magnet.variants.btn-platform-login.multi-platform.label',
    descriptionKey: 'magnet.variants.btn-platform-login.multi-platform.description',
    props: {
      showSelectorTitle: true,
      openAuthOnTrigger: false,
    },
  },
] satisfies readonly MagnetVariantPreset<PlatformLoginSkinProps>[];
