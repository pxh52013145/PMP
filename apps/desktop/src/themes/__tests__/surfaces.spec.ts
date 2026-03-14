import { describe, expect, it } from 'vitest';

import { assignThemeSurface, isComponentThemeEmpty, removeThemeSurface, resolveThemeSurface } from '../surfaces';
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

describe('theme surfaces', () => {
  it('resolves namespaced page, overlay, and primitive surfaces from theme.surfaces', () => {
    const theme = assignThemeSurface(
      assignThemeSurface(
        assignThemeSurface(
          assignThemeSurface(createBaseTheme(), 'page.music-library', { variant: 'dense' }),
          'overlay.context-menu',
          { variant: 'glass' }
        ),
        'primitive.switch.settings.checked',
        { variant: 'accented' }
      ),
      'primitive.checkbox.settings.checked',
      { variant: 'boxed' }
    );

    expect(resolveThemeSurface(theme, 'page.music-library').variant).toBe('dense');
    expect(resolveThemeSurface(theme, 'overlay.context-menu').variant).toBe('glass');
    expect(resolveThemeSurface(theme, 'primitive.switch.settings.checked').variant).toBe('accented');
    expect(resolveThemeSurface(theme, 'primitive.checkbox.settings.checked').variant).toBe('boxed');
  });

  it('resolves magnet surfaces from theme.surfaces', () => {
    const theme = assignThemeSurface(createBaseTheme(), 'magnet.track-info', {
      variant: 'spinning-vinyl',
    });

    expect(resolveThemeSurface(theme, 'magnet.track-info').variant).toBe('spinning-vinyl');
  });

  it('removes empty surface documents cleanly', () => {
    const themed = assignThemeSurface(createBaseTheme(), 'overlay.modal.glass', {
      styleOverride: {
        container: {
          opacity: 0.92,
        },
      },
    });

    expect(isComponentThemeEmpty({})).toBe(true);

    const cleaned = removeThemeSurface(themed, 'overlay.modal.glass');
    expect(cleaned.surfaces?.['overlay.modal.glass']).toBeUndefined();
  });
});
