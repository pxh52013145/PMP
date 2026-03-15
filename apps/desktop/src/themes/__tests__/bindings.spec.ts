import { describe, expect, it } from 'vitest';

import { assignMagnetBindingFragment, materializeThemeBinding } from '../importAdapters';
import {
  assignThemeBinding,
  isThemeBindingEmpty,
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
          extends: 'primitive.card',
          parts: {
            root: {
              classes: ['page-settings-glass'],
              style: {
                opacity: 0.92,
              },
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
            motion: {
              enabled: true,
              mode: 'full',
              layout: {
                strategy: 'flip',
                largeChange: 'animate',
              },
              channels: {
                enter: {
                  preset: 'fade',
                  duration: 180,
                },
              },
            },
          },
        },
      },
    };

    const resolvedBinding = resolveThemeBinding(theme, 'page.settings');
    const materialized = materializeThemeBinding(theme, 'page.settings');

    expect(resolvedBinding.source).toBe('binding');
    expect(resolvedBinding.binding.surface).toBe('page.settings.glass');
    expect(materialized.extends).toBe('primitive.card');
    expect(materialized.parts?.root?.classes).toContain('page-settings-glass');
    expect(materialized.parts?.root?.style?.opacity).toBe(0.92);
    expect(materialized.variant).toBe('glass');
    expect(materialized.variantConfig?.layout).toBe('compact');
    expect(materialized.dynamicColor?.extractFromCover).toBe(true);
    expect(materialized.dynamicColor?.effect).toBe('gradient');
    expect(materialized.dynamicColor?.applyMode).toBe('blend');
    expect(materialized.dynamicColor?.blendRatio).toBe(0.4);
    expect(materialized.motionConfig?.layout?.strategy).toBe('flip');
    expect(materialized.motionConfig?.channels?.enter?.preset).toBe('fade');
  });

  it('materializes magnet binding overlays on top of runtime surface documents', () => {
    const theme: Theme = {
      ...createBaseTheme(),
      surfaces: {
        'magnet.track-info': {
          parts: {
            root: {
              classes: ['track-info-surface'],
            },
          },
        },
      },
      bindings: {
        'magnet.track-info': {
          variant: 'spinning-vinyl',
          props: {
            layout: 'full',
          },
          capabilities: {
            dynamicColor: {
              enabled: false,
              mode: 'tone',
            },
            motion: {
              enabled: true,
              channels: {
                hover: {
                  preset: 'lift-sm',
                  duration: 140,
                },
              },
            },
          },
        },
      },
    };

    const resolvedBinding = resolveThemeBinding(theme, 'magnet.track-info');
    const materialized = materializeThemeBinding(theme, 'magnet.track-info');

    expect(resolvedBinding.source).toBe('binding');
    expect(materialized.parts?.root?.classes).toContain('track-info-surface');
    expect(materialized.variant).toBe('spinning-vinyl');
    expect(materialized.variantConfig?.layout).toBe('full');
    expect(materialized.dynamicColor?.extractFromCover).toBe(false);
    expect(materialized.dynamicColor?.effect).toBe('tone');
    expect(materialized.motionConfig?.channels?.hover?.preset).toBe('lift-sm');
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

  it('writes magnet binding fragments into explicit self surfaces', () => {
    const theme = assignMagnetBindingFragment(createBaseTheme(), 'track-info', {
      variant: 'spinning-vinyl',
      variantConfig: {
        layout: 'full',
      },
      parts: {
        root: {
          style: {
            opacity: 0.9,
          },
        },
      },
      dynamicColor: {
        extractFromCover: true,
        effect: 'gradient',
      },
      motionConfig: {
        enabled: true,
        mode: 'full',
        layout: {
          strategy: 'flip',
          largeChange: 'animate',
          sharedKey: 'track-info',
        },
        channels: {
          spaceSwitch: {
            preset: 'shared-axis',
            duration: 240,
          },
          attention: {
            preset: 'pulse-soft',
            iterationCount: 2,
          },
        },
      },
    });

    expect(theme.bindings?.['magnet.track-info']?.variant).toBe('spinning-vinyl');
    expect(theme.bindings?.['magnet.track-info']?.props?.layout).toBe('full');
    expect(theme.bindings?.['magnet.track-info']?.capabilities?.dynamicColor?.enabled).toBe(true);
    expect(theme.bindings?.['magnet.track-info']?.capabilities?.dynamicColor?.mode).toBe('gradient');
    expect(theme.bindings?.['magnet.track-info']?.capabilities?.motion?.layout?.strategy).toBe('flip');
    expect(theme.bindings?.['magnet.track-info']?.capabilities?.motion?.channels?.spaceSwitch?.preset).toBe('shared-axis');
    expect(theme.surfaces?.['magnet.track-info']?.parts?.root?.style?.opacity).toBe(0.9);
    expect(theme.surfaces?.['magnet.track-info']?.variant).toBeUndefined();
  });

  it('removes empty bindings cleanly', () => {
    const themed = assignThemeBinding(createBaseTheme(), 'overlay.modal', {
      surface: 'overlay.modal.glass',
    });

    expect(isThemeBindingEmpty({})).toBe(true);
    expect(
      isThemeBindingEmpty({
        capabilities: {
          motion: {},
        },
      })
    ).toBe(true);

    const cleaned = removeThemeBinding(themed, 'overlay.modal');
    expect(cleaned.bindings?.['overlay.modal']).toBeUndefined();
  });
});
