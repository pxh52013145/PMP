import { describe, expect, it } from 'vitest';

import {
  assignMagnetComponentTheme,
  assignThemeBinding,
  isThemeBindingEmpty,
  materializeThemeBinding,
  removeThemeBinding,
  resolveThemeBinding,
} from '../bindings';
import type { Theme } from '../types/theme';

function createBaseTheme(): Theme {
  return {
    id: 'theme-default',
    name: 'Default Theme',
    version: '1.0.0',
    pixel: {
      shape: 'circle',
      size: 1,
      opacity: 1,
      colors: {
        default: { slot: 'primary', alpha: 0.6 },
        hover: { slot: 'accent', state: 'hover' },
        active: { slot: 'primary', state: 'active' },
        occupied: { slot: 'secondary', alpha: 0.3 },
      },
    },
    background: {
      maximized: {
        type: 'color',
        color: '#000000',
      },
      windowed: {
        type: 'color',
        color: '#111111',
      },
    },
    fonts: {
      primary: 'Inter, sans-serif',
    },
  };
}

describe('theme bindings', () => {
  it('resolves explicit bindings and merges the referenced surface with binding data', () => {
    const theme: Theme = {
      ...createBaseTheme(),
      surfaces: {
        'page.settings.glass': {
          classNameOverride: {
            container: 'page-settings-glass',
          },
          styleOverride: {
            container: {
              opacity: 0.92,
            },
          },
        },
      },
      bindings: {
        'page.settings': {
          surface: 'page.settings.glass',
          variant: 'glass',
          props: {
            layout: 'compact',
          },
          capabilities: {
            dynamicColor: {
              enabled: true,
              mode: 'gradient',
              apply: 'blend',
              blendRatio: 0.4,
            },
          },
        },
      },
    };

    const resolvedBinding = resolveThemeBinding(theme, 'page.settings');
    const materialized = materializeThemeBinding(theme, 'page.settings');

    expect(resolvedBinding.source).toBe('binding');
    expect(resolvedBinding.binding.surface).toBe('page.settings.glass');
    expect(materialized.classNameOverride?.container).toBe('page-settings-glass');
    expect(materialized.styleOverride?.container?.opacity).toBe(0.92);
    expect(materialized.variant).toBe('glass');
    expect(materialized.variantConfig?.layout).toBe('compact');
    expect(materialized.dynamicColor?.extractFromCover).toBe(true);
    expect(materialized.dynamicColor?.effect).toBe('gradient');
    expect(materialized.dynamicColor?.applyMode).toBe('blend');
    expect(materialized.dynamicColor?.blendRatio).toBe(0.4);
  });

  it('resolves self surface documents for magnet bindings', () => {
    const theme: Theme = {
      ...createBaseTheme(),
      surfaces: {
        'magnet.track-info': {
          variant: 'spinning-vinyl',
          variantConfig: {
            layout: 'full',
          },
          dynamicColor: {
            extractFromCover: false,
            effect: 'tone',
          },
        },
      },
    };

    const resolvedBinding = resolveThemeBinding(theme, 'magnet.track-info');
    const materialized = materializeThemeBinding(theme, 'magnet.track-info');

    expect(resolvedBinding.source).toBe('surface');
    expect(resolvedBinding.binding.surface).toBe('magnet.track-info');
    expect(materialized.variant).toBe('spinning-vinyl');
    expect(materialized.variantConfig?.layout).toBe('full');
    expect(materialized.dynamicColor?.extractFromCover).toBe(false);
    expect(materialized.dynamicColor?.effect).toBe('tone');
  });

  it('writes bindings back to theme.bindings', () => {
    const theme = assignThemeBinding(createBaseTheme(), 'primitive.button.primary', {
      surface: 'primitive.button.primary',
      variant: 'primary',
      props: {
        emphasis: 'high',
      },
    });

    expect(theme.bindings?.['primitive.button.primary']?.variant).toBe('primary');
    expect(theme.bindings?.['primitive.button.primary']?.props?.emphasis).toBe('high');
  });

  it('writes magnet component themes into explicit self surfaces', () => {
    const theme = assignMagnetComponentTheme(createBaseTheme(), 'track-info', {
      variant: 'spinning-vinyl',
      dynamicColor: {
        extractFromCover: true,
        effect: 'gradient',
      },
    });

    expect(theme.bindings?.['magnet.track-info']?.surface).toBe('magnet.track-info');
    expect(theme.surfaces?.['magnet.track-info']?.variant).toBe('spinning-vinyl');
    expect(theme.surfaces?.['magnet.track-info']?.dynamicColor?.extractFromCover).toBe(true);
    expect(theme.surfaces?.['magnet.track-info']?.dynamicColor?.effect).toBe('gradient');
  });

  it('removes empty bindings cleanly', () => {
    const themed = assignThemeBinding(createBaseTheme(), 'overlay.modal', {
      surface: 'overlay.modal.glass',
    });

    expect(isThemeBindingEmpty({})).toBe(true);

    const cleaned = removeThemeBinding(themed, 'overlay.modal');
    expect(cleaned.bindings?.['overlay.modal']).toBeUndefined();
  });
});
