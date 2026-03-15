import { describe, expect, it } from 'vitest';

import { createResolvedSkinSurfaceModel, resolveThemePart } from '../skinSurface';
import type { ComponentTheme, Theme } from '../types/theme';

function createBaseTheme(): Theme {
  return {
    id: 'theme-default',
    name: 'Default Theme',
    version: '1.0.0',
    tokens: {
      color: {
        'bg.surface': '#101010',
        'fg.default': '#f5f5f5',
      },
    },
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

describe('skinSurface', () => {
  it('resolves tokens, parts, and states into css vars and styles', () => {
    const theme = createBaseTheme();
    const surfaceTheme: ComponentTheme = {
      variant: 'glass',
      tokens: {
        'color.surface': '{color.bg.surface}',
      },
      parts: {
        root: {
          classes: ['surface-root'],
          style: {
            backdropFilter: 'blur(12px)',
          },
        },
        header: {
          classes: ['surface-header'],
          tokens: {
            'color.text': '{color.fg.default}',
          },
          states: {
            active: {
              style: {
                opacity: 1,
              },
            },
          },
        },
      },
      states: {
        active: {
          parts: {
            header: {
              style: {
                borderBottomWidth: 1,
              },
            },
          },
        },
      },
    };

    const header = resolveThemePart(theme, surfaceTheme, 'header', { state: 'active' });

    expect(header.classes).toContain('surface-header');
    expect((header.style as Record<string, string>)['--pmp-color-text']).toBe('#f5f5f5');
    expect(header.style.opacity).toBe(1);
    expect(header.style.borderBottomWidth).toBe(1);
  });

  it('emits stable data-pmp attributes for resolved elements', () => {
    const theme = createBaseTheme();
    const surface = createResolvedSkinSurfaceModel(theme, 'page.settings', {
      variant: 'glass',
      parts: {
        root: {
          classes: ['page-settings-root'],
        },
      },
    });

    const props = surface.getElementProps({
      part: 'root',
      state: 'active',
      primitive: 'card',
      bindingId: 'page.settings',
      className: 'settings-shell',
    });

    expect(props.className).toContain('settings-shell');
    expect(props.className).toContain('page-settings-root');
    expect(props['data-pmp-surface']).toBe('page.settings');
    expect(props['data-pmp-part']).toBe('root');
    expect(props['data-pmp-state']).toBe('active');
    expect(props['data-pmp-primitive']).toBe('card');
    expect(props['data-pmp-binding']).toBe('page.settings');
    expect(props['data-pmp-variant']).toBe('glass');
  });
});
